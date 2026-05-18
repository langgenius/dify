import logging
from datetime import datetime
from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, computed_field, field_validator
from sqlalchemy import and_, select
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from extensions.ext_database import db
from fields.base import ResponseModel
from graphon.file import helpers as file_helpers
from libs.datetime_utils import naive_utc_now
from libs.helper import to_timestamp
from libs.login import current_account_with_tenant, login_required
from models import App, InstalledApp, RecommendedApp
from models.model import IconType
from services.account_service import TenantService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService


class InstalledAppCreatePayload(BaseModel):
    app_id: str


class InstalledAppUpdatePayload(BaseModel):
    is_pinned: bool | None = None


class InstalledAppsListQuery(BaseModel):
    app_id: str | None = Field(default=None, description="App ID to filter by")


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


class InstalledAppInfoResponse(ResponseModel):
    id: str
    name: str | None = None
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


register_schema_models(
    console_ns,
    InstalledAppCreatePayload,
    InstalledAppUpdatePayload,
    InstalledAppsListQuery,
    InstalledAppInfoResponse,
    InstalledAppResponse,
    InstalledAppListResponse,
)


@console_ns.route("/installed-apps")
class InstalledAppsListApi(Resource):
    @login_required
    @account_initialization_required
    @console_ns.response(200, "Success", console_ns.models[InstalledAppListResponse.__name__])
    def get(self):
        query = InstalledAppsListQuery.model_validate(request.args.to_dict())
        current_user, current_tenant_id = current_account_with_tenant()

        if query.app_id:
            installed_apps = db.session.scalars(
                select(InstalledApp).where(
                    and_(InstalledApp.tenant_id == current_tenant_id, InstalledApp.app_id == query.app_id)
                )
            ).all()
        else:
            installed_apps = db.session.scalars(
                select(InstalledApp).where(InstalledApp.tenant_id == current_tenant_id)
            ).all()

        if current_user.current_tenant is None:
            raise ValueError("current_user.current_tenant must not be None")
        current_user.role = TenantService.get_user_role(current_user, current_user.current_tenant)
        installed_app_list: list[dict[str, Any]] = [
            {
                "id": installed_app.id,
                "app": installed_app.app,
                "app_owner_tenant_id": installed_app.app_owner_tenant_id,
                "is_pinned": installed_app.is_pinned,
                "last_used_at": installed_app.last_used_at,
                "editable": current_user.role in {"owner", "admin"},
                "uninstallable": current_tenant_id == installed_app.app_owner_tenant_id,
            }
            for installed_app in installed_apps
            if installed_app.app is not None
        ]

        # filter out apps that user doesn't have access to
        if FeatureService.get_system_features().webapp_auth.enabled:
            user_id = current_user.id
            app_ids = [installed_app["app"].id for installed_app in installed_app_list]
            webapp_settings = EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id(app_ids)

            # Pre-filter out apps without setting or with sso_verified
            filtered_installed_apps = []

            for installed_app in installed_app_list:
                app_id = installed_app["app"].id
                webapp_setting = webapp_settings.get(app_id)
                if not webapp_setting or webapp_setting.access_mode == "sso_verified":
                    continue
                filtered_installed_apps.append(installed_app)

            # Batch permission check
            app_ids = [installed_app["app"].id for installed_app in filtered_installed_apps]
            permissions = EnterpriseService.WebAppAuth.batch_is_user_allowed_to_access_webapps(
                user_id=user_id,
                app_ids=app_ids,
            )

            # Keep only allowed apps
            res = []
            for installed_app in filtered_installed_apps:
                app_id = installed_app["app"].id
                if permissions.get(app_id):
                    res.append(installed_app)

            installed_app_list = res
            logger.debug("installed_app_list: %s, user_id: %s", installed_app_list, user_id)

        installed_app_list.sort(
            key=lambda app: (
                -app["is_pinned"],
                app["last_used_at"] is None,
                -app["last_used_at"].timestamp() if app["last_used_at"] is not None else 0,
            )
        )

        return InstalledAppListResponse.model_validate(
            {"installed_apps": installed_app_list}, from_attributes=True
        ).model_dump(mode="json")

    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("apps")
    def post(self):
        payload = InstalledAppCreatePayload.model_validate(console_ns.payload or {})

        recommended_app = db.session.scalar(
            select(RecommendedApp).where(RecommendedApp.app_id == payload.app_id).limit(1)
        )
        if recommended_app is None:
            raise NotFound("Recommended app not found")

        _, current_tenant_id = current_account_with_tenant()

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
    update and delete an installed app
    use InstalledAppResource to apply default decorators and get installed_app
    """

    def delete(self, installed_app):
        _, current_tenant_id = current_account_with_tenant()
        if installed_app.app_owner_tenant_id == current_tenant_id:
            raise BadRequest("You can't uninstall an app owned by the current tenant")

        db.session.delete(installed_app)
        db.session.commit()

        return {"result": "success", "message": "App uninstalled successfully"}, 204

    def patch(self, installed_app):
        payload = InstalledAppUpdatePayload.model_validate(console_ns.payload or {})

        commit_args = False
        if payload.is_pinned is not None:
            installed_app.is_pinned = payload.is_pinned
            commit_args = True

        if commit_args:
            db.session.commit()

        return {"result": "success", "message": "App info updated successfully"}
