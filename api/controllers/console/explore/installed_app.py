import base64
import binascii
import logging
from datetime import datetime
from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, computed_field, field_validator
from sqlalchemy import and_, exists, or_, select
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.common.fields import SimpleMessageResponse, SimpleResultMessageResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_resource_check,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from graphon.file import helpers as file_helpers
from libs.datetime_utils import naive_utc_now
from libs.helper import dump_response, escape_like_pattern, to_timestamp
from libs.login import login_required
from models import Account, App, AppModelConfig, InstalledApp, RecommendedApp, Workflow
from models.model import AppMode, IconType
from services.account_service import TenantService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService


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


class InstalledAppCursor(BaseModel):
    is_pinned: bool
    last_used_at: datetime | None
    installed_app_id: str


logger = logging.getLogger(__name__)


def _build_icon_url(icon_type: str | IconType | None, icon: str | None) -> str | None:
    if icon is None or icon_type is None:
        return None
    icon_type_value = icon_type.value if isinstance(icon_type, IconType) else str(icon_type)
    if icon_type_value.lower() != IconType.IMAGE:
        return None
    return file_helpers.get_signed_file_url(icon)


def _safe_primitive(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool, datetime)):
        return value
    return None


def _published_app_filter():
    """Return the SQL predicate for installed-app web API availability.

    The installed-app parameters endpoint reads the published workflow for
    workflow-style apps and the published app model config for easy UI apps.
    Keep the list endpoint aligned in SQL so it does not return entries that
    will immediately fail with app_unavailable when opened.
    """
    workflow_app_modes = (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW)
    has_published_workflow = exists(select(Workflow.id).where(Workflow.id == App.workflow_id))
    has_published_model_config = exists(select(AppModelConfig.id).where(AppModelConfig.id == App.app_model_config_id))

    return and_(
        App.mode != AppMode.AGENT,
        or_(
            and_(App.mode.in_(workflow_app_modes), App.workflow_id.isnot(None), has_published_workflow),
            and_(~App.mode.in_(workflow_app_modes), App.app_model_config_id.isnot(None), has_published_model_config),
        ),
    )


def _encode_installed_app_cursor(installed_app: InstalledApp) -> str:
    cursor = InstalledAppCursor(
        is_pinned=installed_app.is_pinned,
        last_used_at=installed_app.last_used_at,
        installed_app_id=installed_app.id,
    )
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


def _installed_app_cursor_filter(cursor: InstalledAppCursor):
    same_pin_group = InstalledApp.is_pinned == cursor.is_pinned
    if cursor.last_used_at is None:
        later_in_pin_group = and_(
            InstalledApp.last_used_at.is_(None),
            InstalledApp.id > cursor.installed_app_id,
        )
    else:
        later_in_pin_group = or_(
            InstalledApp.last_used_at < cursor.last_used_at,
            InstalledApp.last_used_at.is_(None),
            and_(
                InstalledApp.last_used_at == cursor.last_used_at,
                InstalledApp.id > cursor.installed_app_id,
            ),
        )

    if cursor.is_pinned:
        return or_(
            InstalledApp.is_pinned.is_(False),
            and_(same_pin_group, later_in_pin_group),
        )
    return and_(same_pin_group, later_in_pin_group)


def _installed_app_order_by():
    return (
        InstalledApp.is_pinned.desc(),
        InstalledApp.last_used_at.desc().nulls_last(),
        InstalledApp.id.asc(),
    )


def _filter_rows_by_webapp_auth(
    rows: list[tuple[InstalledApp, App]],
    *,
    user_id: str,
) -> list[tuple[InstalledApp, App]]:
    if not rows:
        return []

    app_ids = [app.id for _, app in rows]
    webapp_settings = EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(app_ids)
    candidates = [
        (installed_app, app)
        for installed_app, app in rows
        if (setting := webapp_settings.get(app.id)) is not None and setting.access_mode != "sso_verified"
    ]
    permissions = EnterpriseService.WebAppAuth.batch_is_user_allowed_to_access_webapps(
        user_id=user_id,
        app_ids=[app.id for _, app in candidates],
    )
    return [(installed_app, app) for installed_app, app in candidates if permissions.get(app.id)]


def _get_visible_installed_app_page(
    stmt,
    *,
    current_user: Account,
    cursor: InstalledAppCursor | None,
    limit: int,
) -> tuple[list[tuple[InstalledApp, App]], bool, str | None]:
    """Scan ordered candidates until one page of authorized apps is complete."""
    webapp_auth_enabled = FeatureService.get_system_features().webapp_auth.enabled
    scan_size = limit * 2 if webapp_auth_enabled else limit + 1
    visible_rows: list[tuple[InstalledApp, App]] = []
    scan_cursor = cursor
    has_more = False
    last_consumed_app: InstalledApp | None = None

    while True:
        page_stmt = stmt
        if scan_cursor is not None:
            page_stmt = page_stmt.where(_installed_app_cursor_filter(scan_cursor))
        candidate_result = db.session.execute(page_stmt.order_by(*_installed_app_order_by()).limit(scan_size)).all()
        candidate_rows = [(installed_app, app) for installed_app, app in candidate_result]
        if not candidate_rows:
            break

        authorized_rows = candidate_rows
        if webapp_auth_enabled:
            authorized_rows = _filter_rows_by_webapp_auth(
                candidate_rows,
                user_id=str(current_user.id),
            )

        authorized_installed_app_ids = {installed_app.id for installed_app, _ in authorized_rows}
        for row in candidate_rows:
            installed_app = row[0]
            if installed_app.id not in authorized_installed_app_ids:
                last_consumed_app = installed_app
                continue
            if len(visible_rows) == limit:
                has_more = True
                break
            visible_rows.append(row)
            last_consumed_app = installed_app
        if has_more:
            break

        if len(candidate_rows) < scan_size:
            break
        last_scanned_app = candidate_rows[-1][0]
        scan_cursor = InstalledAppCursor(
            is_pinned=last_scanned_app.is_pinned,
            last_used_at=last_scanned_app.last_used_at,
            installed_app_id=last_scanned_app.id,
        )

    next_cursor = _encode_installed_app_cursor(last_consumed_app) if has_more and last_consumed_app else None
    return visible_rows, has_more, next_cursor


def _installed_app_response_data(
    installed_app: InstalledApp,
    app_model: App,
    *,
    current_tenant_id: str,
    current_user: Account,
) -> dict[str, Any]:
    return {
        "id": installed_app.id,
        "app": app_model,
        "app_owner_tenant_id": installed_app.app_owner_tenant_id,
        "is_pinned": installed_app.is_pinned,
        "last_used_at": installed_app.last_used_at,
        "editable": current_user.role in {"owner", "admin"},
        "uninstallable": current_tenant_id == installed_app.app_owner_tenant_id,
    }


class InstalledAppInfoResponse(ResponseModel):
    id: str
    name: str | None = None
    description: str | None = None
    mode: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    use_icon_as_answer_icon: bool | None = None

    @field_validator("mode", "icon_type", mode="before")
    @classmethod
    def _normalize_enum_like(cls, value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @computed_field(return_type=str | None)  # type: ignore[prop-decorator]
    @property
    def icon_url(self) -> str | None:
        return _build_icon_url(self.icon_type, self.icon)


class InstalledAppResponse(ResponseModel):
    id: str
    app: InstalledAppInfoResponse
    app_owner_tenant_id: str
    is_pinned: bool
    last_used_at: int | None = None
    editable: bool
    uninstallable: bool

    @field_validator("app", mode="before")
    @classmethod
    def _normalize_app(cls, value: Any) -> Any:
        if isinstance(value, dict):
            return value
        return {
            "id": _safe_primitive(getattr(value, "id", "")) or "",
            "name": _safe_primitive(getattr(value, "name", None)),
            "description": _safe_primitive(getattr(value, "description", None)),
            "mode": _safe_primitive(getattr(value, "mode", None)),
            "icon_type": _safe_primitive(getattr(value, "icon_type", None)),
            "icon": _safe_primitive(getattr(value, "icon", None)),
            "icon_background": _safe_primitive(getattr(value, "icon_background", None)),
            "use_icon_as_answer_icon": _safe_primitive(getattr(value, "use_icon_as_answer_icon", None)),
        }

    @field_validator("last_used_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class InstalledAppListResponse(ResponseModel):
    installed_apps: list[InstalledAppResponse]
    has_more: bool
    next_cursor: str | None = None


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

        stmt = (
            select(InstalledApp, App)
            .join(App, App.id == InstalledApp.app_id)
            .where(InstalledApp.tenant_id == current_tenant_id, _published_app_filter())
        )
        if query.app_id:
            stmt = stmt.where(InstalledApp.app_id == query.app_id)
        if query.name and (name := query.name.strip()):
            escaped_name = escape_like_pattern(name)
            stmt = stmt.where(App.name.ilike(f"%{escaped_name}%", escape="\\"))

        installed_apps, has_more, next_cursor = _get_visible_installed_app_page(
            stmt,
            current_user=current_user,
            cursor=cursor,
            limit=query.limit,
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
                "next_cursor": next_cursor,
            },
        )

    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("apps")
    @console_ns.expect(console_ns.models[InstalledAppCreatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleMessageResponse.__name__])
    @with_current_tenant_id
    def post(self, current_tenant_id: str):
        payload = InstalledAppCreatePayload.model_validate(console_ns.payload or {})

        recommended_app = db.session.scalar(
            select(RecommendedApp).where(RecommendedApp.app_id == payload.app_id).limit(1)
        )
        if recommended_app is None:
            raise NotFound("Recommended app not found")

        app = db.session.get(App, payload.app_id)

        if app is None:
            raise NotFound("App entity not found")

        if not app.is_public:
            raise Forbidden("You can't install a non-public app")

        installed_app = db.session.scalar(
            select(InstalledApp)
            .where(and_(InstalledApp.app_id == payload.app_id, InstalledApp.tenant_id == current_tenant_id))
            .limit(1)
        )

        if installed_app is None:
            # todo: position
            recommended_app.install_count += 1

            new_installed_app = InstalledApp(
                app_id=payload.app_id,
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
        app_model = db.session.scalar(
            select(App).where(App.id == installed_app.app_id, _published_app_filter()).limit(1)
        )
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
    def patch(self, installed_app: InstalledApp):
        payload = InstalledAppUpdatePayload.model_validate(console_ns.payload or {})

        commit_args = False
        if payload.is_pinned is not None:
            installed_app.is_pinned = payload.is_pinned
            commit_args = True

        if commit_args:
            db.session.commit()

        return {"result": "success", "message": "App info updated successfully"}
