from flask_restful import Resource, reqparse
from jwt import InvalidTokenError  # type: ignore

import services
from controllers.console.auth.error import EmailCodeError, EmailOrPasswordMismatchError, InvalidEmailError
from controllers.console.error import AccountBannedError, AccountNotFound
from controllers.console.wraps import only_edition_enterprise, setup_required
from controllers.web import api
from libs.helper import email
from libs.password import valid_password
from services.account_service import AccountService
from services.webapp_auth_service import WebAppAuthService


class LoginApi(Resource):
    """Resource for web app email/password login."""

    @setup_required
    @only_edition_enterprise
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
            raise EmailOrPasswordMismatchError()
        except services.errors.account.AccountNotFoundError:
            raise AccountNotFound()

        token = WebAppAuthService.login(account=account)
        return {"result": "success", "data": {"access_token": token}}


# class LogoutApi(Resource):
#     @setup_required
#     def get(self):
#         account = cast(Account, flask_login.current_user)
#         if isinstance(account, flask_login.AnonymousUserMixin):
#             return {"result": "success"}
#         flask_login.logout_user()
#         return {"result": "success"}


class EmailCodeLoginSendEmailApi(Resource):
    @setup_required
    @only_edition_enterprise
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
            raise AccountNotFound()
        else:
            token = WebAppAuthService.send_email_code_login_email(account=account, language=language)

        return {"result": "success", "data": token}


class EmailCodeLoginApi(Resource):
    @setup_required
    @only_edition_enterprise
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
            raise AccountNotFound()

        token = WebAppAuthService.login(account=account)
        AccountService.reset_login_error_rate_limit(args["email"])
        return {"result": "success", "data": {"access_token": token}}


api.add_resource(LoginApi, "/login")
# api.add_resource(LogoutApi, "/logout")
api.add_resource(EmailCodeLoginSendEmailApi, "/email-code-login")
api.add_resource(EmailCodeLoginApi, "/email-code-login/validity")
