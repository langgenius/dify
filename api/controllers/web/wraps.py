from collections.abc import Callable
from datetime import UTC, datetime
from functools import wraps
from typing import Concatenate, ParamSpec, TypeVar

from flask import request
from flask_restx import Resource
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound, Unauthorized

from constants import HEADER_NAME_APP_CODE
from controllers.web.error import WebAppAuthAccessDeniedError, WebAppAuthRequiredError
from extensions.ext_database import db
from libs.passport import PassportService
from libs.token import extract_webapp_passport
from models.model import App, EndUser, Site
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseService, WebAppSettings
from services.feature_service import FeatureService
from services.webapp_auth_service import WebAppAuthService

P = ParamSpec("P")
R = TypeVar("R")


def validate_jwt_token(view: Callable[Concatenate[App, EndUser, P], R] | None = None):
    def decorator(view: Callable[Concatenate[App, EndUser, P], R]):
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs):
            app_model, end_user = decode_jwt_token()
            return view(app_model, end_user, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)
    return decorator


def decode_jwt_token(app_code: str | None = None):
    system_features = FeatureService.get_system_features()
    if not app_code:
        app_code = str(request.headers.get(HEADER_NAME_APP_CODE))
    try:
        tk = extract_webapp_passport(app_code, request)
        if not tk:
            raise Unauthorized("App token is missing.")
        decoded = PassportService().verify(tk)
        app_code = decoded.get("app_code")
        app_id = decoded.get("app_id")
        with Session(db.engine, expire_on_commit=False) as session:
            app_model = session.scalar(select(App).where(App.id == app_id))
            site = session.scalar(select(Site).where(Site.code == app_code))
            if not app_model:
                raise NotFound()
            if not app_code or not site:
                raise BadRequest("Site URL is no longer valid.")
            if app_model.enable_site is False:
                raise BadRequest("Site is disabled.")
            end_user_id = decoded.get("end_user_id")
            end_user = session.scalar(select(EndUser).where(EndUser.id == end_user_id))
            if not end_user:
                raise NotFound()

        # for enterprise webapp auth
        app_web_auth_enabled = False
        webapp_settings = None
        if system_features.webapp_auth.enabled:
            app_id = AppService.get_app_id_by_code(app_code)
            webapp_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id)
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
            app_id = AppService.get_app_id_by_code(app_code)
            app_web_auth_enabled = (
                EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=app_id).access_mode != "public"
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
            app_id = AppService.get_app_id_by_code(app_code)
            if not EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(user_id, app_id):
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
