from collections.abc import Callable
from datetime import UTC, datetime
from functools import wraps
from typing import Concatenate

from flask import request
from flask_restx import Resource
from werkzeug.exceptions import NotFound, Unauthorized

from constants import HEADER_NAME_APP_CODE
from controllers.web.error import (
    WebAppAccessServiceUnavailableError,
    WebAppAuthAccessDeniedError,
    WebAppAuthRequiredError,
    WebAppNotFoundError,
)
from core.logging.context import set_identity_context
from extensions.ext_application_services import application_services
from libs.passport import PassportService
from libs.token import extract_webapp_passport
from models.model import App, EndUser
from repositories.web_passport_repository import get_web_passport_identity
from services.enterprise.enterprise_service import EnterpriseService, WebAppAccessMode, WebAppSettings
from services.system_feature_service import SystemFeatureService
from services.web_passport_gateways import resolve_web_app_auth_type
from services.webapp_access_query_service import WebAppAccessAppNotFoundError, WebAppAccessUnavailableError


def validate_jwt_token[**P, R](
    view: Callable[Concatenate[App, EndUser, P], R] | None = None,
) -> Callable[P, R] | Callable[[Callable[Concatenate[App, EndUser, P], R]], Callable[P, R]]:
    def decorator(view: Callable[Concatenate[App, EndUser, P], R]) -> Callable[P, R]:
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            app_model, end_user = decode_jwt_token()
            set_identity_context(
                tenant_id=end_user.tenant_id,
                user_id=end_user.id,
                user_type=end_user.type or "end_user",
            )
            return view(app_model, end_user, *args, **kwargs)

        return decorated

    if view:
        return decorator(view)
    return decorator


def resolve_web_app_id(app_code: str) -> str:
    """Translate app lookup failures at the WebApp authentication boundary."""
    try:
        return application_services().webapp_access.get_app_id_by_code(app_code)
    except WebAppAccessAppNotFoundError as exc:
        raise WebAppNotFoundError() from exc
    except WebAppAccessUnavailableError as exc:
        raise WebAppAccessServiceUnavailableError() from exc


def decode_jwt_token(app_code: str | None = None, user_id: str | None = None) -> tuple[App, EndUser]:
    webapp_auth_enabled = SystemFeatureService.is_webapp_auth_enabled()
    if not app_code:
        app_code = str(request.headers.get(HEADER_NAME_APP_CODE))
    try:
        tk = extract_webapp_passport(app_code, request)
        if not tk:
            raise Unauthorized("App token is missing.")
        decoded = PassportService().verify(tk)
        app_code = decoded.get("app_code")
        if not isinstance(app_code, str) or not app_code:
            raise WebAppNotFoundError()
        app_id = decoded.get("app_id")
        app_model, end_user = get_web_passport_identity(app_id, app_code, decoded.get("end_user_id"))
        if app_model is None:
            raise WebAppNotFoundError()
        if end_user is None:
            raise NotFound()

        # Validate user_id against end_user's session_id if provided.
        if user_id is not None and end_user.session_id != user_id:
            raise Unauthorized("Authentication has expired.")

        # for enterprise webapp auth
        app_web_auth_enabled = False
        webapp_settings = None
        if webapp_auth_enabled:
            app_id = resolve_web_app_id(app_code)
            webapp_settings = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id)
            if not webapp_settings:
                raise NotFound("Web app settings not found.")
            app_web_auth_enabled = webapp_settings.access_mode != WebAppAccessMode.PUBLIC

        _validate_webapp_token(decoded, app_web_auth_enabled, webapp_auth_enabled)
        _validate_user_accessibility(decoded, app_code, app_web_auth_enabled, webapp_auth_enabled, webapp_settings)

        return app_model, end_user
    except Unauthorized as e:
        if webapp_auth_enabled:
            if not app_code:
                raise Unauthorized("Please re-login to access the web app.")
            app_id = resolve_web_app_id(app_code)
            app_web_auth_enabled = (
                EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id=app_id).access_mode
                != WebAppAccessMode.PUBLIC
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

        auth_type = decoded.get("auth_type")
        if not auth_type:
            raise WebAppAuthRequiredError("Missing auth_type in the token.")

        expected_auth_type = resolve_web_app_auth_type(webapp_settings.access_mode)
        if auth_type != expected_auth_type:
            raise WebAppAuthRequiredError()

        if application_services().webapp_access.is_permission_check_required(webapp_settings.access_mode):
            app_id = resolve_web_app_id(app_code)
            if not EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(user_id, app_id):
                raise WebAppAuthAccessDeniedError()

        granted_at = decoded.get("granted_at")
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
