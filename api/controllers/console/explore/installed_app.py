from datetime import datetime, timezone

from flask_login import current_user
from flask_restful import Resource, inputs, marshal_with, reqparse
from sqlalchemy import and_
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from controllers.console import api
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import account_initialization_required, cloud_edition_billing_resource_check
from extensions.ext_database import db
from fields.installed_app_fields import installed_app_list_fields
from libs.login import login_required
from models import App, InstalledApp, RecommendedApp
from services.account_service import TenantService


class InstalledAppsListApi(Resource):
    @login_required
    @account_initialization_required
    @marshal_with(installed_app_list_fields)
    def get(self):
        current_tenant_id = current_user.current_tenant_id
        installed_apps = db.session.query(InstalledApp).filter(InstalledApp.tenant_id == current_tenant_id).all()

        current_user.role = TenantService.get_user_role(current_user, current_user.current_tenant)
        installed_apps = [
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
        installed_apps.sort(
            key=lambda app: (
                -app["is_pinned"],
                app["last_used_at"] is None,
                -app["last_used_at"].timestamp() if app["last_used_at"] is not None else 0,
            )
        )

        return {"installed_apps": installed_apps}

    @login_required
    @account_initialization_required
    @cloud_edition_billing_resource_check("apps")
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("app_id", type=str, required=True, help="Invalid app_id")
        args = parser.parse_args()

        recommended_app = RecommendedApp.query.filter(RecommendedApp.app_id == args["app_id"]).first()
        if recommended_app is None:
            raise NotFound("App not found")

        current_tenant_id = current_user.current_tenant_id
        app = db.session.query(App).filter(App.id == args["app_id"]).first()

        if app is None:
            raise NotFound("App not found")

        if not app.is_public:
            raise Forbidden("You can't install a non-public app")

        installed_app = InstalledApp.query.filter(
            and_(InstalledApp.app_id == args["app_id"], InstalledApp.tenant_id == current_tenant_id)
        ).first()

        if installed_app is None:
            # todo: position
            recommended_app.install_count += 1

            new_installed_app = InstalledApp(
                app_id=args["app_id"],
                tenant_id=current_tenant_id,
                app_owner_tenant_id=app.tenant_id,
                is_pinned=False,
                last_used_at=datetime.now(timezone.utc).replace(tzinfo=None),
            )
            db.session.add(new_installed_app)
            db.session.commit()

        return {"message": "App installed successfully"}


class InstalledAppApi(InstalledAppResource):
    """
    update and delete an installed app
    use InstalledAppResource to apply default decorators and get installed_app
    """

    def delete(self, installed_app):
        if installed_app.app_owner_tenant_id == current_user.current_tenant_id:
            raise BadRequest("You can't uninstall an app owned by the current tenant")

        db.session.delete(installed_app)
        db.session.commit()

        return {"result": "success", "message": "App uninstalled successfully"}

    def patch(self, installed_app):
        parser = reqparse.RequestParser()
        parser.add_argument("is_pinned", type=inputs.boolean)
        args = parser.parse_args()

        commit_args = False
        if "is_pinned" in args:
            installed_app.is_pinned = args["is_pinned"]
            commit_args = True

        if commit_args:
            db.session.commit()

        return {"result": "success", "message": "App info updated successfully"}


api.add_resource(InstalledAppsListApi, "/installed-apps")
api.add_resource(InstalledAppApi, "/installed-apps/<uuid:installed_app_id>")
