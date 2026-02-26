from flask import make_response, request
from flask_restx import Resource
from jwt import InvalidTokenError
from pydantic import BaseModel, Field, field_validator

import services
from configs import dify_config
from controllers.common.schema import register_schema_models
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    InvalidEmailError,
)
from controllers.console.error import AccountBannedError
from controllers.console.wraps import (
    decrypt_code_field,
    decrypt_password_field,
    only_edition_enterprise,
    setup_required,
)
from controllers.web import web_ns
from controllers.web.wraps import decode_jwt_token
from libs.helper import EmailStr
from libs.passport import PassportService
from libs.password import valid_password
from libs.token import (
    clear_webapp_access_token_from_cookie,
    extract_webapp_access_token,
)
from services.account_service import AccountService
from services.app_service import AppService
from services.webapp_auth_service import WebAppAuthService


class LoginPayload(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return valid_password(value)


class EmailCodeLoginSendPayload(BaseModel):
    email: EmailStr
    language: str | None = None


class EmailCodeLoginVerifyPayload(BaseModel):
    email: EmailStr
    code: str
    token: str = Field(min_length=1)


register_schema_models(web_ns, LoginPayload, EmailCodeLoginSendPayload, EmailCodeLoginVerifyPayload)


@web_ns.route("/login")
class LoginApi(Resource):
    """Resource for web app email/password login."""

    @web_ns.expect(web_ns.models[LoginPayload.__name__])
    @setup_required
    @only_edition_enterprise
    @web_ns.doc("web_app_login")
    @web_ns.doc(description="Authenticate user for web application access")
    @web_ns.doc(
        responses={
            200: "Authentication successful",
            400: "Bad request - invalid email or password format",
            401: "Authentication failed - email or password mismatch",
            403: "Account banned or login disabled",
            404: "Account not found",
        }
    )
    @decrypt_password_field
    def post(self):
        """Authenticate user and login."""
        payload = LoginPayload.model_validate(web_ns.payload or {})

        try:
            account = WebAppAuthService.authenticate(payload.email, payload.password)
        except services.errors.account.AccountLoginError:
            raise AccountBannedError()
        except services.errors.account.AccountPasswordError:
            raise AuthenticationFailedError()
        except services.errors.account.AccountNotFoundError:
            raise AuthenticationFailedError()

        token = WebAppAuthService.login(account=account)
        response = make_response({"result": "success", "data": {"access_token": token}})
        # set_access_token_to_cookie(request, response, token, samesite="None", httponly=False)
        return response


# this api helps frontend to check whether user is authenticated
# TODO: remove in the future. frontend should redirect to login page by catching 401 status
@web_ns.route("/login/status")
class LoginStatusApi(Resource):
    @setup_required
    @web_ns.doc("web_app_login_status")
    @web_ns.doc(description="Check login status")
    @web_ns.doc(
        responses={
            200: "Login status",
            401: "Login status",
        }
    )
    def get(self):
        app_code = request.args.get("app_code")
        user_id = request.args.get("user_id")
        token = extract_webapp_access_token(request)
        if not app_code:
            return {
                "logged_in": bool(token),
                "app_logged_in": False,
            }
        app_id = AppService.get_app_id_by_code(app_code)
        is_public = not dify_config.ENTERPRISE_ENABLED or not WebAppAuthService.is_app_require_permission_check(
            app_id=app_id
        )
        user_logged_in = False

        if is_public:
            user_logged_in = True
        else:
            try:
                PassportService().verify(token=token)
                user_logged_in = True
            except Exception:
                user_logged_in = False

        try:
            _ = decode_jwt_token(app_code=app_code, user_id=user_id)
            app_logged_in = True
        except Exception:
            app_logged_in = False

        return {
            "logged_in": user_logged_in,
            "app_logged_in": app_logged_in,
        }


@web_ns.route("/logout")
class LogoutApi(Resource):
    @setup_required
    @web_ns.doc("web_app_logout")
    @web_ns.doc(description="Logout user from web application")
    @web_ns.doc(
        responses={
            200: "Logout successful",
        }
    )
    def post(self):
        response = make_response({"result": "success"})
        # enterprise SSO sets same site to None in https deployment
        # so we need to logout by calling api
        clear_webapp_access_token_from_cookie(response, samesite="None")
        return response


@web_ns.route("/email-code-login")
class EmailCodeLoginSendEmailApi(Resource):
    @setup_required
    @only_edition_enterprise
    @web_ns.doc("send_email_code_login")
    @web_ns.doc(description="Send email verification code for login")
    @web_ns.expect(web_ns.models[EmailCodeLoginSendPayload.__name__])
    @web_ns.doc(
        responses={
            200: "Email code sent successfully",
            400: "Bad request - invalid email format",
            404: "Account not found",
        }
    )
    def post(self):
        payload = EmailCodeLoginSendPayload.model_validate(web_ns.payload or {})

        if payload.language == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"

        account = WebAppAuthService.get_user_through_email(payload.email)
        if account is None:
            raise AuthenticationFailedError()
        else:
            token = WebAppAuthService.send_email_code_login_email(account=account, language=language)
        return {"result": "success", "data": token}


@web_ns.route("/email-code-login/validity")
class EmailCodeLoginApi(Resource):
    @setup_required
    @only_edition_enterprise
    @web_ns.doc("verify_email_code_login")
    @web_ns.doc(description="Verify email code and complete login")
    @web_ns.expect(web_ns.models[EmailCodeLoginVerifyPayload.__name__])
    @web_ns.doc(
        responses={
            200: "Email code verified and login successful",
            400: "Bad request - invalid code or token",
            401: "Invalid token or expired code",
            404: "Account not found",
        }
    )
    @decrypt_code_field
    def post(self):
        payload = EmailCodeLoginVerifyPayload.model_validate(web_ns.payload or {})

        user_email = payload.email.lower()

        token_data = WebAppAuthService.get_email_code_login_data(payload.token)
        if token_data is None:
            raise InvalidTokenError()

        token_email = token_data.get("email")
        if not isinstance(token_email, str):
            raise InvalidEmailError()
        normalized_token_email = token_email.lower()
        if normalized_token_email != user_email:
            raise InvalidEmailError()

        if token_data["code"] != payload.code:
            raise EmailCodeError()

        WebAppAuthService.revoke_email_code_login_token(payload.token)
        account = WebAppAuthService.get_user_through_email(token_email)
        if not account:
            raise AuthenticationFailedError()

        token = WebAppAuthService.login(account=account)
        AccountService.reset_login_error_rate_limit(user_email)
        response = make_response({"result": "success", "data": {"access_token": token}})
        # set_access_token_to_cookie(request, response, token, samesite="None", httponly=False)
        return response
