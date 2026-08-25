import base64
import binascii
import logging

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, computed_field
from sqlalchemy import and_, select
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.common.fields import SimpleMessageResponse, SimpleResultMessageResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    model_validate,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from graphon.file import helpers as file_helpers
from libs.datetime_utils import naive_utc_now
from libs.helper import dump_response, to_timestamp
from libs.login import login_required
from models import Account, App, InstalledApp, RecommendedApp
from models.model import AppMode, IconType
from services.account_service import TenantService
from services.installed_app_service import InstalledAppCursor, InstalledAppService


class InstalledAppCreatePayload(BaseModel):
    app_id: str


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
    installed_app: InstalledApp,
    app_model: App,
    *,
    current_tenant_id: str,
    current_user: Account,
) -> InstalledAppResponse:
    return InstalledAppResponse(
        id=installed_app.id,
        app=InstalledAppInfoResponse.model_validate(app_model),
        app_owner_tenant_id=installed_app.app_owner_tenant_id,
        is_pinned=installed_app.is_pinned,
        last_used_at=to_timestamp(installed_app.last_used_at),
        editable=current_user.role in {"owner", "admin"},
        uninstallable=current_tenant_id == installed_app.app_owner_tenant_id,
    )


register_schema_models(
    console_ns,
    InstalledAppCreatePayload,
    InstalledAppUpdatePayload,
    InstalledAppsListQuery,
)
register_response_schema_models(
    console_ns,
    InstalledAppInfoResponse,
    InstalledAppResponse,
    InstalledAppListResponse,
    SimpleMessageResponse,
    SimpleResultMessageResponse,
)


@console_ns.route("/installed-apps")
class InstalledAppsListApi(Resource):
    @login_required
    @account_initialization_required
    @console_ns.doc(params=query_params_from_model(InstalledAppsListQuery))
    @console_ns.response(200, "Success", console_ns.models[InstalledAppListResponse.__name__])
    @with_current_user
    @with_current_tenant_id
    def get(self, current_tenant_id: str, current_user: Account):
        query = InstalledAppsListQuery.model_validate(request.args.to_dict())
        cursor = _decode_installed_app_cursor(query.cursor)
        if current_user.current_tenant is None:
            raise ValueError("current_user.current_tenant must not be None")

        installed_apps, has_more, next_cursor = InstalledAppService.get_visible_page(
            tenant_id=current_tenant_id,
            user_id=str(current_user.id),
            cursor=cursor,
            limit=query.limit,
            app_id=query.app_id,
            name=query.name,
            session=db.session,
        )

        current_user.role = TenantService.get_user_role(current_user, current_user.current_tenant, session=db.session())
        installed_app_list = [
            _installed_app_response_data(
                installed_app,
                app_model,
                current_tenant_id=current_tenant_id,
                current_user=current_user,
            )
            for installed_app, app_model in installed_apps
        ]

        logger.debug("installed_app_list: %s, user_id: %s", installed_app_list, current_user.id)
        return dump_response(
            InstalledAppListResponse,
            {
                "installed_apps": installed_app_list,
                "has_more": has_more,
                "next_cursor": _encode_installed_app_cursor(next_cursor) if next_cursor else None,
            },
        )

    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("apps")
    @console_ns.expect(console_ns.models[InstalledAppCreatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleMessageResponse.__name__])
    @with_current_tenant_id
    @model_validate(InstalledAppCreatePayload)
    def post(self, req_data: InstalledAppCreatePayload, current_tenant_id: str):
        recommended_app = db.session.scalar(
            select(RecommendedApp).where(RecommendedApp.app_id == req_data.app_id).limit(1)
        )
        if recommended_app is None:
            raise NotFound("Recommended app not found")

        app = db.session.get(App, req_data.app_id)

        if app is None:
            raise NotFound("App entity not found")

        if not app.is_public:
            raise Forbidden("You can't install a non-public app")

        installed_app = db.session.scalar(
            select(InstalledApp)
            .where(and_(InstalledApp.app_id == req_data.app_id, InstalledApp.tenant_id == current_tenant_id))
            .limit(1)
        )

        if installed_app is None:
            # todo: position
            recommended_app.install_count += 1

            new_installed_app = InstalledApp(
                app_id=req_data.app_id,
                tenant_id=current_tenant_id,
                app_owner_tenant_id=app.tenant_id,
                is_pinned=False,
                last_used_at=naive_utc_now(),
            )
            db.session.add(new_installed_app)
            db.session.commit()

        return {"message": "App installed successfully"}


@console_ns.route("/installed-apps/<uuid:installed_app_id>")
class InstalledAppApi(InstalledAppResource):
    """
    get, update, and delete an installed app
    use InstalledAppResource to apply default decorators and get installed_app
    """

    @console_ns.response(200, "Success", console_ns.models[InstalledAppResponse.__name__])
    @with_current_user
    @with_current_tenant_id
    def get(
        self,
        current_tenant_id: str,
        current_user: Account,
        installed_app: InstalledApp,
    ):
        app_model = InstalledAppService.get_published_app(installed_app.app_id, session=db.session)
        if app_model is None:
            raise NotFound("Installed app not found")
        if current_user.current_tenant is None:
            raise ValueError("current_user.current_tenant must not be None")

        current_user.role = TenantService.get_user_role(current_user, current_user.current_tenant, session=db.session())
        return dump_response(
            InstalledAppResponse,
            _installed_app_response_data(
                installed_app,
                app_model,
                current_tenant_id=current_tenant_id,
                current_user=current_user,
            ),
        )

    @console_ns.response(204, "App uninstalled successfully")
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, installed_app: InstalledApp):
        if installed_app.app_owner_tenant_id == current_tenant_id:
            raise BadRequest("You can't uninstall an app owned by the current tenant")

        db.session.delete(installed_app)
        db.session.commit()

        return "", 204

    @console_ns.response(200, "Success", console_ns.models[SimpleResultMessageResponse.__name__])
    @console_ns.expect(console_ns.models[InstalledAppUpdatePayload.__name__])
    @model_validate(InstalledAppUpdatePayload)
    def patch(self, req_data: InstalledAppUpdatePayload, installed_app: InstalledApp):
        commit_args = False
        if req_data.is_pinned is not None:
            installed_app.is_pinned = req_data.is_pinned
            commit_args = True

        if commit_args:
            db.session.commit()

        return {"result": "success", "message": "App info updated successfully"}
