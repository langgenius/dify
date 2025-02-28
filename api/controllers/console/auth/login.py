from typing import cast

import flask_login  # type: ignore
from flask import request
from flask_restful import Resource, reqparse  # type: ignore

import services
from configs import dify_config
from constants.languages import languages
from controllers.console import api
from controllers.console.auth.error import (
    EmailCodeError,
    EmailOrPasswordMismatchError,
    EmailPasswordLoginLimitError,
    InvalidEmailError,
    InvalidTokenError,
)
from controllers.console.error import (
    AccountBannedError,
    AccountInFreezeError,
    AccountNotFound,
    EmailSendIpLimitError,
    NotAllowedCreateWorkspace,
)
from controllers.console.wraps import setup_required
from events.tenant_event import tenant_was_created
from libs.helper import email, extract_remote_ip
from libs.password import valid_password
from models.account import Account
from services.account_service import AccountService, RegisterService, TenantService
from services.billing_service import BillingService
from services.errors.account import AccountRegisterError
from services.errors.workspace import WorkSpaceNotAllowedCreateError
from services.feature_service import FeatureService


class LoginApi(Resource):
    """Resource for user login."""

    @setup_required
    def post(self):
        """Authenticate user and login."""
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("password", type=valid_password, required=True, location="json")
        parser.add_argument("remember_me", type=bool, required=False, default=False, location="json")
        parser.add_argument("invite_token", type=str, required=False, default=None, location="json")
        parser.add_argument("language", type=str, required=False, default="en-US", location="json")
        args = parser.parse_args()

        if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(args["email"]):
            raise AccountInFreezeError()

        is_login_error_rate_limit = AccountService.is_login_error_rate_limit(args["email"])
        if is_login_error_rate_limit:
            raise EmailPasswordLoginLimitError()

        invitation = args["invite_token"]
        if invitation:
            invitation = RegisterService.get_invitation_if_token_valid(None, args["email"], invitation)

        if args["language"] is not None and args["language"] == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"

        try:
            if invitation:
                data = invitation.get("data", {})
                invitee_email = data.get("email") if data else None
                if invitee_email != args["email"]:
                    raise InvalidEmailError()
                account = AccountService.authenticate(args["email"], args["password"], args["invite_token"])
            else:
                account = AccountService.authenticate(args["email"], args["password"])
        except services.errors.account.AccountLoginError:
            raise AccountBannedError()
        except services.errors.account.AccountPasswordError:
            AccountService.add_login_error_rate_limit(args["email"])
            raise EmailOrPasswordMismatchError()
        except services.errors.account.AccountNotFoundError:
            if FeatureService.get_system_features().is_allow_register:
                token = AccountService.send_reset_password_email(email=args["email"], language=language)
                return {"result": "fail", "data": token, "code": "account_not_found"}
            else:
                raise AccountNotFound()
        # SELF_HOSTED only have one workspace
        tenants = TenantService.get_join_tenants(account)
        if len(tenants) == 0:
            return {
                "result": "fail",
                "data": "workspace not found, please contact system admin to invite you to join in a workspace",
            }

        token_pair = AccountService.login(account=account, ip_address=extract_remote_ip(request))
        AccountService.reset_login_error_rate_limit(args["email"])
        return {"result": "success", "data": token_pair.model_dump()}


class LogoutApi(Resource):
    @setup_required
    def get(self):
        account = cast(Account, flask_login.current_user)
        if isinstance(account, flask_login.AnonymousUserMixin):
            return {"result": "success"}
        AccountService.logout(account=account)
        flask_login.logout_user()
        return {"result": "success"}


class ResetPasswordSendEmailApi(Resource):
    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("language", type=str, required=False, location="json")
        args = parser.parse_args()

        if args["language"] is not None and args["language"] == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"
        try:
            account = AccountService.get_user_through_email(args["email"])
        except AccountRegisterError as are:
            raise AccountInFreezeError()
        if account is None:
            if FeatureService.get_system_features().is_allow_register:
                token = AccountService.send_reset_password_email(email=args["email"], language=language)
            else:
                raise AccountNotFound()
        else:
            token = AccountService.send_reset_password_email(account=account, language=language)

        return {"result": "success", "data": token}


class EmailCodeLoginSendEmailApi(Resource):
    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("language", type=str, required=False, location="json")
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        if args["language"] is not None and args["language"] == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"
        try:
            account = AccountService.get_user_through_email(args["email"])
        except AccountRegisterError as are:
            raise AccountInFreezeError()

        if account is None:
            if FeatureService.get_system_features().is_allow_register:
                token = AccountService.send_email_code_login_email(email=args["email"], language=language)
            else:
                raise AccountNotFound()
        else:
            token = AccountService.send_email_code_login_email(account=account, language=language)

        return {"result": "success", "data": token}


class EmailCodeLoginApi(Resource):
    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=str, required=True, location="json")
        parser.add_argument("code", type=str, required=True, location="json")
        parser.add_argument("token", type=str, required=True, location="json")
        args = parser.parse_args()

        user_email = args["email"]

        token_data = AccountService.get_email_code_login_data(args["token"])
        if token_data is None:
            raise InvalidTokenError()

        if token_data["email"] != args["email"]:
            raise InvalidEmailError()

        if token_data["code"] != args["code"]:
            raise EmailCodeError()

        AccountService.revoke_email_code_login_token(args["token"])
        try:
            account = AccountService.get_user_through_email(user_email)
        except AccountRegisterError as are:
            raise AccountInFreezeError()
        if account:
            tenant = TenantService.get_join_tenants(account)
            if not tenant:
                if not FeatureService.get_system_features().is_allow_create_workspace:
                    raise NotAllowedCreateWorkspace()
                else:
                    tenant = TenantService.create_tenant(f"{account.name}'s Workspace")
                    TenantService.create_tenant_member(tenant, account, role="owner")
                    account.current_tenant = tenant
                    tenant_was_created.send(tenant)

        if account is None:
            try:
                account = AccountService.create_account_and_tenant(
                    email=user_email, name=user_email, interface_language=languages[0]
                )
            except WorkSpaceNotAllowedCreateError:
                return NotAllowedCreateWorkspace()
            except AccountRegisterError as are:
                raise AccountInFreezeError()
        token_pair = AccountService.login(account, ip_address=extract_remote_ip(request))
        AccountService.reset_login_error_rate_limit(args["email"])
        return {"result": "success", "data": token_pair.model_dump()}


class RefreshTokenApi(Resource):
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("refresh_token", type=str, required=True, location="json")
        args = parser.parse_args()

        try:
            new_token_pair = AccountService.refresh_token(args["refresh_token"])
            return {"result": "success", "data": new_token_pair.model_dump()}
        except Exception as e:
            return {"result": "fail", "data": str(e)}, 401


api.add_resource(LoginApi, "/login")
api.add_resource(LogoutApi, "/logout")
api.add_resource(EmailCodeLoginSendEmailApi, "/email-code-login")
api.add_resource(EmailCodeLoginApi, "/email-code-login/validity")
api.add_resource(ResetPasswordSendEmailApi, "/reset-password")
api.add_resource(RefreshTokenApi, "/refresh-token")
