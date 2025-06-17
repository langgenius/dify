from datetime import UTC, datetime
from functools import wraps

from flask import request
from flask_restful import Resource
from werkzeug.exceptions import BadRequest, NotFound, Unauthorized

from controllers.web.error import WebAppAuthAccessDeniedError, WebAppAuthRequiredError
from extensions.ext_database import db
from libs.passport import PassportService
from models.model import App, EndUser, Site
from services.enterprise.enterprise_service import EnterpriseService, WebAppSettings
from services.feature_service import FeatureService
from services.webapp_auth_service import WebAppAuthService


def validate_jwt_token(view=None):
    def decorator(view):
        @wraps(view)
        def decorated(*args, **kwargs):
            app_model, end_user = decode_jwt_token()

            return view(app_model, end_user, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)
    return decorator


def decode_jwt_token():
    system_features = FeatureService.get_system_features()
    app_code = str(request.headers.get("X-App-Code"))
    try:
        auth_header = request.headers.get("Authorization")
        if auth_header is None:
            raise Unauthorized("Authorization header is missing.")

        if " " not in auth_header:
            raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")

        auth_scheme, tk = auth_header.split(None, 1)
        auth_scheme = auth_scheme.lower()

        if auth_scheme != "bearer":
            raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")
        decoded = PassportService().verify(tk)
        app_code = decoded.get("app_code")
        app_id = decoded.get("app_id")
        app_model = db.session.query(App).filter(App.id == app_id).first()
        site = db.session.query(Site).filter(Site.code == app_code).first()
        if not app_model:
            raise NotFound()
        if not app_code or not site:
            raise BadRequest("Site URL is no longer valid.")
        if app_model.enable_site is False:
            raise BadRequest("Site is disabled.")
        end_user_id = decoded.get("end_user_id")
        end_user = db.session.query(EndUser).filter(EndUser.id == end_user_id).first()
        if not end_user:
            raise NotFound()

        # for enterprise webapp auth
        app_web_auth_enabled = False
        webapp_settings = None
        if system_features.webapp_auth.enabled:
            webapp_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_code(app_code=app_code)
            if not webapp_settings:
                raise NotFound("Web app settings not found.")
            app_web_auth_enabled = webapp_settings.access_mode != "public"

        _validate_webapp_token(decoded, app_web_auth_enabled, system_features.webapp_auth.enabled)
        _validate_user_accessibility(
            decoded, app_code, app_web_auth_enabled, system_features.webapp_auth.enabled, webapp_settings
        )

        return app_model, end_user
    except Unauthorized as e:
        if system_features.webapp_auth.enabled:
            if not app_code:
                raise Unauthorized("Please re-login to access the web app.")
            app_web_auth_enabled = (
                EnterpriseService.WebAppAuth.get_app_access_mode_by_code(app_code=str(app_code)).access_mode != "public"
            )
            if app_web_auth_enabled:
                raise WebAppAuthRequiredError()

        raise Unauthorized(e.description)


def _validate_webapp_token(decoded, app_web_auth_enabled: bool, system_webapp_auth_enabled: bool):
    # Check if authentication is enforced for web app, and if the token source is not webapp,
    # raise an error and redirect to login
    if system_webapp_auth_enabled and app_web_auth_enabled:
        source = decoded.get("token_source")
        if not source or source != "webapp":
            raise WebAppAuthRequiredError()

    # Check if authentication is not enforced for web, and if the token source is webapp,
    # raise an error and redirect to normal passport login
    if not system_webapp_auth_enabled or not app_web_auth_enabled:
        source = decoded.get("token_source")
        if source and source == "webapp":
            raise Unauthorized("webapp token expired.")


def _validate_user_accessibility(
    decoded,
    app_code,
    app_web_auth_enabled: bool,
    system_webapp_auth_enabled: bool,
    webapp_settings: WebAppSettings | None,
):
    if system_webapp_auth_enabled and app_web_auth_enabled:
        # Check if the user is allowed to access the web app
        user_id = decoded.get("user_id")
        if not user_id:
            raise WebAppAuthRequiredError()

        if not webapp_settings:
            raise WebAppAuthRequiredError("Web app settings not found.")

        if WebAppAuthService.is_app_require_permission_check(access_mode=webapp_settings.access_mode):
            if not EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(user_id, app_code=app_code):
                raise WebAppAuthAccessDeniedError()

        auth_type = decoded.get("auth_type")
        granted_at = decoded.get("granted_at")
        if not auth_type:
            raise WebAppAuthAccessDeniedError("Missing auth_type in the token.")
        if not granted_at:
            raise WebAppAuthAccessDeniedError("Missing granted_at in the token.")
        # check if sso has been updated
        if auth_type == "external":
            last_update_time = EnterpriseService.get_app_sso_settings_last_update_time()
            if granted_at and datetime.fromtimestamp(granted_at, tz=UTC) < last_update_time:
                raise WebAppAuthAccessDeniedError("SSO settings have been updated. Please re-login.")
        elif auth_type == "internal":
            last_update_time = EnterpriseService.get_workspace_sso_settings_last_update_time()
            if granted_at and datetime.fromtimestamp(granted_at, tz=UTC) < last_update_time:
                raise WebAppAuthAccessDeniedError("SSO settings have been updated. Please re-login.")


class WebApiResource(Resource):
    method_decorators = [validate_jwt_token]
