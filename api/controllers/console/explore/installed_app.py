import base64
import binascii
import logging

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, computed_field
from werkzeug.exceptions import BadRequest, NotFound

from controllers.common.fields import SimpleResultMessageResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.explore.installed_app_admission import get_installed_app
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from graphon.file import helpers as file_helpers
from libs.helper import dump_response, to_timestamp
from machinery.context import RequestContext
from models.model import AppMode, IconType
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_service import (
    InstalledAppCursor,
    InstalledAppOwnedByWorkspaceError,
    InstalledAppRecord,
)


class InstalledAppUpdatePayload(BaseModel):
    is_pinned: bool | None = None


class InstalledAppsListQuery(BaseModel):
    app_id: str | None = Field(default=None, description="App ID to filter by")
    name: str | None = Field(default=None, max_length=100, description="App name to search for")
    cursor: str | None = Field(default=None, description="Opaque cursor returned by the previous page")
    limit: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Number of installed apps to return",
    )


logger = logging.getLogger(__name__)


def _build_icon_url(icon_type: IconType | None, icon: str | None) -> str | None:
    if icon is None or icon_type is None:
        return None
    if icon_type != IconType.IMAGE:
        return None
    return file_helpers.get_signed_file_url(icon)


def _encode_installed_app_cursor(cursor: InstalledAppCursor) -> str:
    payload = cursor.model_dump_json().encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_installed_app_cursor(cursor: str | None) -> InstalledAppCursor | None:
    if cursor is None:
        return None

    try:
        padded_cursor = cursor + "=" * (-len(cursor) % 4)
        payload = base64.b64decode(padded_cursor, altchars=b"-_", validate=True)
        return InstalledAppCursor.model_validate_json(payload)
    except (binascii.Error, UnicodeDecodeError, ValueError):
        raise BadRequest("Invalid cursor") from None


class InstalledAppInfoResponse(ResponseModel):
    id: str
    name: str
    description: str
    mode: AppMode
    icon_type: IconType | None
    icon: str | None
    icon_background: str | None
    use_icon_as_answer_icon: bool

    @computed_field(return_type=str | None)  # type: ignore[prop-decorator]
    @property
    def icon_url(self) -> str | None:
        return _build_icon_url(self.icon_type, self.icon)


class InstalledAppResponse(ResponseModel):
    id: str
    app: InstalledAppInfoResponse
    app_owner_tenant_id: str
    is_pinned: bool
    last_used_at: int | None
    editable: bool
    uninstallable: bool


class InstalledAppListResponse(ResponseModel):
    installed_apps: list[InstalledAppResponse]
    has_more: bool
    next_cursor: str | None


def _installed_app_response_data(
    installed_app: InstalledAppRecord,
    *,
    current_tenant_id: str,
    editable: bool,
) -> InstalledAppResponse:
    return InstalledAppResponse(
        id=installed_app.id,
        app=InstalledAppInfoResponse.model_validate(installed_app.app, from_attributes=True),
        app_owner_tenant_id=installed_app.app_owner_tenant_id,
        is_pinned=installed_app.is_pinned,
        last_used_at=to_timestamp(installed_app.last_used_at),
        editable=editable,
        uninstallable=current_tenant_id == installed_app.app_owner_tenant_id,
    )


register_schema_models(
    console_ns,
    InstalledAppUpdatePayload,
    InstalledAppsListQuery,
)
register_response_schema_models(
    console_ns,
    InstalledAppInfoResponse,
    InstalledAppResponse,
    InstalledAppListResponse,
    SimpleResultMessageResponse,
)


@console_ns.route("/installed-apps")
class InstalledAppsListApi(Resource):
    @console_ns.doc(params=query_params_from_model(InstalledAppsListQuery))
    @console_ns.response(200, "Success", console_ns.models[InstalledAppListResponse.__name__])
    @console_account_admission()
    def get(self, request_context: RequestContext) -> dict[str, object]:
        query = InstalledAppsListQuery.model_validate(request.args.to_dict())
        cursor = _decode_installed_app_cursor(query.cursor)
        page = application_services().installed_apps.get_visible_page(
            tenant_id=request_context.active_workspace_id,
            user_id=request_context.account_id,
            cursor=cursor,
            limit=query.limit,
            app_id=query.app_id,
            name=query.name,
        )
        installed_app_list = [
            _installed_app_response_data(
                installed_app,
                current_tenant_id=request_context.active_workspace_id,
                editable=page.editable,
            )
            for installed_app in page.data
        ]

        logger.debug("installed_app_list: %s, user_id: %s", installed_app_list, request_context.account_id)
        return dump_response(
            InstalledAppListResponse,
            {
                "installed_apps": installed_app_list,
                "has_more": page.has_more,
                "next_cursor": _encode_installed_app_cursor(page.next_cursor) if page.next_cursor else None,
            },
        )


@console_ns.route("/installed-apps/<uuid:installed_app_id>")
class InstalledAppApi(Resource):
    """Read, update, or uninstall an admitted workspace installation."""

    @console_ns.response(200, "Success", console_ns.models[InstalledAppResponse.__name__])
    @console_account_admission()
    @get_installed_app
    def get(
        self,
        request_context: RequestContext,
        installed_app: InstalledAppRef,
    ) -> dict[str, object]:
        try:
            detail = application_services().installed_apps.get_detail(
                installed_app=installed_app, account_id=request_context.account_id
            )
        except InstalledAppNotFoundError:
            raise NotFound("Installed app not found") from None
        return dump_response(
            InstalledAppResponse,
            _installed_app_response_data(
                detail.installation,
                current_tenant_id=request_context.active_workspace_id,
                editable=detail.editable,
            ),
        )

    @console_ns.response(204, "App uninstalled successfully")
    @console_account_admission()
    @get_installed_app
    def delete(self, request_context: RequestContext, installed_app: InstalledAppRef) -> tuple[str, int]:
        try:
            application_services().installed_apps.uninstall(installed_app=installed_app)
        except InstalledAppOwnedByWorkspaceError:
            raise BadRequest("You can't uninstall an app owned by the current tenant") from None
        except InstalledAppNotFoundError:
            raise NotFound("Installed app not found") from None

        return "", 204

    @console_ns.response(200, "Success", console_ns.models[SimpleResultMessageResponse.__name__])
    @console_ns.expect(console_ns.models[InstalledAppUpdatePayload.__name__])
    @console_account_admission()
    @get_installed_app
    @model_validate(InstalledAppUpdatePayload)
    def patch(
        self, req_data: InstalledAppUpdatePayload, request_context: RequestContext, installed_app: InstalledAppRef
    ) -> dict[str, str]:
        try:
            application_services().installed_apps.set_pinned(installed_app=installed_app, is_pinned=req_data.is_pinned)
        except InstalledAppNotFoundError:
            raise NotFound("Installed app not found") from None

        return {"result": "success", "message": "App info updated successfully"}
