import flask_login
from flask import make_response, request
from flask_restx import Resource, reqparse

import services
from configs import dify_config
from constants.languages import get_valid_language
from controllers.console import console_ns
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
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
    WorkspacesLimitExceeded,
)
from controllers.console.wraps import email_password_login_enabled, setup_required
from events.tenant_event import tenant_was_created
from libs.helper import email, extract_remote_ip
from libs.login import current_account_with_tenant
from libs.token import (
    clear_access_token_from_cookie,
    clear_csrf_token_from_cookie,
    clear_refresh_token_from_cookie,
    extract_refresh_token,
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
)
from services.account_service import AccountService, RegisterService, TenantService
from services.billing_service import BillingService
from services.errors.account import AccountRegisterError
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError
from services.feature_service import FeatureService


@console_ns.route("/login")
class LoginApi(Resource):
    """Resource for user login."""

    @setup_required
    @email_password_login_enabled
    def post(self):
        """Authenticate user and login."""
        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=email, required=True, location="json")
            .add_argument("password", type=str, required=True, location="json")
            .add_argument("remember_me", type=bool, required=False, default=False, location="json")
            .add_argument("invite_token", type=str, required=False, default=None, location="json")
        )
        args = parser.parse_args()

        if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(args["email"]):
            raise AccountInFreezeError()

        is_login_error_rate_limit = AccountService.is_login_error_rate_limit(args["email"])
        if is_login_error_rate_limit:
            raise EmailPasswordLoginLimitError()

        invitation = args["invite_token"]
        if invitation:
            invitation = RegisterService.get_invitation_if_token_valid(None, args["email"], invitation)

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
            raise AuthenticationFailedError()
        # SELF_HOSTED only have one workspace
        tenants = TenantService.get_join_tenants(account)
        if len(tenants) == 0:
            system_features = FeatureService.get_system_features()

            if system_features.is_allow_create_workspace and not system_features.license.workspaces.is_available():
                raise WorkspacesLimitExceeded()
            else:
                return {
                    "result": "fail",
                    "data": "workspace not found, please contact system admin to invite you to join in a workspace",
                }

        token_pair = AccountService.login(account=account, ip_address=extract_remote_ip(request))
        AccountService.reset_login_error_rate_limit(args["email"])

        # Create response with cookies instead of returning tokens in body
        response = make_response({"result": "success"})

        set_access_token_to_cookie(request, response, token_pair.access_token)
        set_refresh_token_to_cookie(request, response, token_pair.refresh_token)
        set_csrf_token_to_cookie(request, response, token_pair.csrf_token)

        return response


@console_ns.route("/logout")
class LogoutApi(Resource):
    @setup_required
    def post(self):
        current_user, _ = current_account_with_tenant()
        account = current_user
        if isinstance(account, flask_login.AnonymousUserMixin):
            response = make_response({"result": "success"})
        else:
            AccountService.logout(account=account)
            flask_login.logout_user()
            response = make_response({"result": "success"})

        # Clear cookies on logout
        clear_access_token_from_cookie(response)
        clear_refresh_token_from_cookie(response)
        clear_csrf_token_from_cookie(response)

        return response


@console_ns.route("/reset-password")
class ResetPasswordSendEmailApi(Resource):
    @setup_required
    @email_password_login_enabled
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=email, required=True, location="json")
            .add_argument("language", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        if args["language"] is not None and args["language"] == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"
        try:
            account = AccountService.get_user_through_email(args["email"])
        except AccountRegisterError:
            raise AccountInFreezeError()

        token = AccountService.send_reset_password_email(
            email=args["email"],
            account=account,
            language=language,
            is_allow_register=FeatureService.get_system_features().is_allow_register,
        )

        return {"result": "success", "data": token}


@console_ns.route("/email-code-login")
class EmailCodeLoginSendEmailApi(Resource):
    @setup_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=email, required=True, location="json")
            .add_argument("language", type=str, required=False, location="json")
        )
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
        except AccountRegisterError:
            raise AccountInFreezeError()

        if account is None:
            if FeatureService.get_system_features().is_allow_register:
                token = AccountService.send_email_code_login_email(email=args["email"], language=language)
            else:
                raise AccountNotFound()
        else:
            token = AccountService.send_email_code_login_email(account=account, language=language)

        return {"result": "success", "data": token}


@console_ns.route("/email-code-login/validity")
class EmailCodeLoginApi(Resource):
    @setup_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=str, required=True, location="json")
            .add_argument("code", type=str, required=True, location="json")
            .add_argument("token", type=str, required=True, location="json")
            .add_argument("language", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        user_email = args["email"]
        language = args["language"]

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
        except AccountRegisterError:
            raise AccountInFreezeError()
        if account:
            tenants = TenantService.get_join_tenants(account)
            if not tenants:
                workspaces = FeatureService.get_system_features().license.workspaces
                if not workspaces.is_available():
                    raise WorkspacesLimitExceeded()
                if not FeatureService.get_system_features().is_allow_create_workspace:
                    raise NotAllowedCreateWorkspace()
                else:
                    new_tenant = TenantService.create_tenant(f"{account.name}'s Workspace")
                    TenantService.create_tenant_member(new_tenant, account, role="owner")
                    account.current_tenant = new_tenant
                    tenant_was_created.send(new_tenant)

        if account is None:
            try:
                account = AccountService.create_account_and_tenant(
                    email=user_email,
                    name=user_email,
                    interface_language=get_valid_language(language),
                )
            except WorkSpaceNotAllowedCreateError:
                raise NotAllowedCreateWorkspace()
            except AccountRegisterError:
                raise AccountInFreezeError()
            except WorkspacesLimitExceededError:
                raise WorkspacesLimitExceeded()
        token_pair = AccountService.login(account, ip_address=extract_remote_ip(request))
        AccountService.reset_login_error_rate_limit(args["email"])

        # Create response with cookies instead of returning tokens in body
        response = make_response({"result": "success"})

        set_csrf_token_to_cookie(request, response, token_pair.csrf_token)
        # Set HTTP-only secure cookies for tokens
        set_access_token_to_cookie(request, response, token_pair.access_token)
        set_refresh_token_to_cookie(request, response, token_pair.refresh_token)
        return response


@console_ns.route("/refresh-token")
class RefreshTokenApi(Resource):
    def post(self):
        # Get refresh token from cookie instead of request body
        refresh_token = extract_refresh_token(request)

        if not refresh_token:
            return {"result": "fail", "message": "No refresh token provided"}, 401

        try:
            new_token_pair = AccountService.refresh_token(refresh_token)

            # Create response with new cookies
            response = make_response({"result": "success"})

            # Update cookies with new tokens
            set_csrf_token_to_cookie(request, response, new_token_pair.csrf_token)
            set_access_token_to_cookie(request, response, new_token_pair.access_token)
            set_refresh_token_to_cookie(request, response, new_token_pair.refresh_token)
            return response
        except Exception as e:
            return {"result": "fail", "message": str(e)}, 401
