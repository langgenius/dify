import logging
from typing import Any

from flask import request
from flask_restx import Resource, inputs, marshal_with, reqparse
from sqlalchemy import and_, select
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.console import console_ns
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from extensions.ext_database import db
from fields.installed_app_fields import installed_app_list_fields
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant, login_required
from models import App, InstalledApp, RecommendedApp
from services.account_service import TenantService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService

logger = logging.getLogger(__name__)


@console_ns.route("/installed-apps")
class InstalledAppsListApi(Resource):
    @login_required
    @account_initialization_required
    @marshal_with(installed_app_list_fields)
    def get(self):
        app_id = request.args.get("app_id", default=None, type=str)
        current_user, current_tenant_id = current_account_with_tenant()

        if app_id:
            installed_apps = db.session.scalars(
                select(InstalledApp).where(
                    and_(InstalledApp.tenant_id == current_tenant_id, InstalledApp.app_id == app_id)
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

        return {"installed_apps": installed_app_list}

    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("apps")
    def post(self):
        parser = reqparse.RequestParser().add_argument("app_id", type=str, required=True, help="Invalid app_id")
        args = parser.parse_args()

        recommended_app = db.session.query(RecommendedApp).where(RecommendedApp.app_id == args["app_id"]).first()
        if recommended_app is None:
            raise NotFound("App not found")

        _, current_tenant_id = current_account_with_tenant()

        app = db.session.query(App).where(App.id == args["app_id"]).first()

        if app is None:
            raise NotFound("App not found")

        if not app.is_public:
            raise Forbidden("You can't install a non-public app")

        installed_app = (
            db.session.query(InstalledApp)
            .where(and_(InstalledApp.app_id == args["app_id"], InstalledApp.tenant_id == current_tenant_id))
            .first()
        )

        if installed_app is None:
            # todo: position
            recommended_app.install_count += 1

            new_installed_app = InstalledApp(
                app_id=args["app_id"],
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
        parser = reqparse.RequestParser().add_argument("is_pinned", type=inputs.boolean)
        args = parser.parse_args()

        commit_args = False
        if "is_pinned" in args:
            installed_app.is_pinned = args["is_pinned"]
            commit_args = True

        if commit_args:
            db.session.commit()

        return {"result": "success", "message": "App info updated successfully"}
