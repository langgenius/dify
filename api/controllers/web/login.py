from flask import make_response, request
from flask_restx import Resource, reqparse
from jwt import InvalidTokenError

import services
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    InvalidEmailError,
)
from controllers.console.error import AccountBannedError
from controllers.console.wraps import only_edition_enterprise, setup_required
from controllers.web import web_ns
from libs.helper import email
from libs.passport import PassportService
from libs.password import valid_password
from libs.token import (
    clear_access_token_from_cookie,
    clear_webapp_token_from_cookie,
    set_access_token_to_cookie,
    extract_access_token,
    extract_webapp_passport,
    clear_csrf_token_from_cookie
)
from services.account_service import AccountService
from services.webapp_auth_service import WebAppAuthService


@web_ns.route("/login")
class LoginApi(Resource):
    """Resource for web app email/password login."""

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
    def post(self):
        """Authenticate user and login."""
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("password", type=valid_password, required=True, location="json")
        args = parser.parse_args()

        try:
            account = WebAppAuthService.authenticate(args["email"], args["password"])
        except services.errors.account.AccountLoginError:
            raise AccountBannedError()
        except services.errors.account.AccountPasswordError:
            raise AuthenticationFailedError()
        except services.errors.account.AccountNotFoundError:
            raise AuthenticationFailedError()

        token = WebAppAuthService.login(account=account)
        response = make_response({"result": "success", "data": {"access_token": token}})
        set_access_token_to_cookie(request, response, token, samesite="None")
        return response

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
        token = extract_access_token(request)
        if not app_code:
            return {
                "logged_in": bool(token),
                "app_logged_in": False,
            }
        passport: str | None = extract_webapp_passport(app_code, request)
        try:
            verified = PassportService().verify(passport)
            return {
                "logged_in": bool(token),
                "app_logged_in": bool(app_code) and verified.get("app_code") == app_code,
            }
        except Exception:
            return {
                "logged_in": bool(token),
                "app_logged_in": False,
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
        app_code = request.args.get("app_code")
        clear_access_token_from_cookie(request, response, samesite="None")
        clear_webapp_token_from_cookie(app_code, request, response, samesite="None")
        return response


@web_ns.route("/email-code-login")
class EmailCodeLoginSendEmailApi(Resource):
    @setup_required
    @only_edition_enterprise
    @web_ns.doc("send_email_code_login")
    @web_ns.doc(description="Send email verification code for login")
    @web_ns.doc(
        responses={
            200: "Email code sent successfully",
            400: "Bad request - invalid email format",
            404: "Account not found",
        }
    )
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("language", type=str, required=False, location="json")
        args = parser.parse_args()

        if args["language"] is not None and args["language"] == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"

        account = WebAppAuthService.get_user_through_email(args["email"])
        if account is None:
            raise AuthenticationFailedError()
        else:
            token = WebAppAuthService.send_email_code_login_email(account=account, language=language)
        response = make_response({"result": "success", "data": {"access_token": token}})
        set_access_token_to_cookie(request, response, token, samesite="None")
        return response


@web_ns.route("/email-code-login/validity")
class EmailCodeLoginApi(Resource):
    @setup_required
    @only_edition_enterprise
    @web_ns.doc("verify_email_code_login")
    @web_ns.doc(description="Verify email code and complete login")
    @web_ns.doc(
        responses={
            200: "Email code verified and login successful",
            400: "Bad request - invalid code or token",
            401: "Invalid token or expired code",
            404: "Account not found",
        }
    )
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=str, required=True, location="json")
        parser.add_argument("code", type=str, required=True, location="json")
        parser.add_argument("token", type=str, required=True, location="json")
        args = parser.parse_args()

        user_email = args["email"]

        token_data = WebAppAuthService.get_email_code_login_data(args["token"])
        if token_data is None:
            raise InvalidTokenError()

        if token_data["email"] != args["email"]:
            raise InvalidEmailError()

        if token_data["code"] != args["code"]:
            raise EmailCodeError()

        WebAppAuthService.revoke_email_code_login_token(args["token"])
        account = WebAppAuthService.get_user_through_email(user_email)
        if not account:
            raise AuthenticationFailedError()

        token = WebAppAuthService.login(account=account)
        AccountService.reset_login_error_rate_limit(args["email"])
        response = make_response({"result": "success", "data": {"access_token": token}})
        set_access_token_to_cookie(request, response, token, samesite="None")
        return response
