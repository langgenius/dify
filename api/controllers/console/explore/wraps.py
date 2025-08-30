from functools import wraps

from flask_login import current_user
from flask_restx import Resource
from werkzeug.exceptions import NotFound

from controllers.console.explore.error import AppAccessDeniedError
from controllers.console.wraps import account_initialization_required
from extensions.ext_database import db
from libs.login import login_required
from models import InstalledApp
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService


def installed_app_required(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            if not kwargs.get("installed_app_id"):
                raise ValueError("missing installed_app_id in path parameters")

            installed_app_id = kwargs.get("installed_app_id")
            installed_app_id = str(installed_app_id)

            del kwargs["installed_app_id"]

            installed_app = (
                db.session.query(InstalledApp)
                .where(
                    InstalledApp.id == str(installed_app_id), InstalledApp.tenant_id == current_user.current_tenant_id
                )
                .first()
            )

            if installed_app is None:
                raise NotFound("Installed app not found")

            if not installed_app.app:
                db.session.delete(installed_app)
                db.session.commit()

                raise NotFound("Installed app not found")

            return view(installed_app, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)
    return decorator


def user_allowed_to_access_app(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(installed_app: InstalledApp, *args, **kwargs):
            feature = FeatureService.get_system_features()
            if feature.webapp_auth.enabled:
                app_id = installed_app.app_id
                app_code = AppService.get_app_code_by_id(app_id)
                res = EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(
                    user_id=str(current_user.id),
                    app_code=app_code,
                )
                if not res:
                    raise AppAccessDeniedError()

            return view(installed_app, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)
    return decorator


class InstalledAppResource(Resource):
    # must be reversed if there are multiple decorators

    method_decorators = [
        user_allowed_to_access_app,
        installed_app_required,
        account_initialization_required,
        login_required,
    ]
