import logging

import httpx
from flask import current_app, redirect, request
from flask_restx import Resource
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from constants.languages import languages
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.helper import extract_remote_ip
from libs.oauth import GitHubOAuth, GoogleOAuth, OAuthUserInfo
from libs.token import (
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
)
from models import Account, AccountStatus
from services.account_service import AccountService, RegisterService, TenantService
from services.billing_service import BillingService
from services.errors.account import AccountNotFoundError, AccountRegisterError
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkSpaceNotFoundError
from services.feature_service import FeatureService

from .. import api, console_ns

logger = logging.getLogger(__name__)


def get_oauth_providers():
    with current_app.app_context():
        if not dify_config.GITHUB_CLIENT_ID or not dify_config.GITHUB_CLIENT_SECRET:
            github_oauth = None
        else:
            github_oauth = GitHubOAuth(
                client_id=dify_config.GITHUB_CLIENT_ID,
                client_secret=dify_config.GITHUB_CLIENT_SECRET,
                redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/authorize/github",
            )
        if not dify_config.GOOGLE_CLIENT_ID or not dify_config.GOOGLE_CLIENT_SECRET:
            google_oauth = None
        else:
            google_oauth = GoogleOAuth(
                client_id=dify_config.GOOGLE_CLIENT_ID,
                client_secret=dify_config.GOOGLE_CLIENT_SECRET,
                redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/authorize/google",
            )

        OAUTH_PROVIDERS = {"github": github_oauth, "google": google_oauth}
        return OAUTH_PROVIDERS


@console_ns.route("/oauth/login/<provider>")
class OAuthLogin(Resource):
    @api.doc("oauth_login")
    @api.doc(description="Initiate OAuth login process")
    @api.doc(params={"provider": "OAuth provider name (github/google)", "invite_token": "Optional invitation token"})
    @api.response(302, "Redirect to OAuth authorization URL")
    @api.response(400, "Invalid provider")
    def get(self, provider: str):
        invite_token = request.args.get("invite_token") or None
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400

        auth_url = oauth_provider.get_authorization_url(invite_token=invite_token)
        return redirect(auth_url)


@console_ns.route("/oauth/authorize/<provider>")
class OAuthCallback(Resource):
    @api.doc("oauth_callback")
    @api.doc(description="Handle OAuth callback and complete login process")
    @api.doc(
        params={
            "provider": "OAuth provider name (github/google)",
            "code": "Authorization code from OAuth provider",
            "state": "Optional state parameter (used for invite token)",
        }
    )
    @api.response(302, "Redirect to console with access token")
    @api.response(400, "OAuth process failed")
    def get(self, provider: str):
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400

        code = request.args.get("code")
        state = request.args.get("state")
        invite_token = None
        if state:
            invite_token = state

        if not code:
            return {"error": "Authorization code is required"}, 400

        try:
            token = oauth_provider.get_access_token(code)
            user_info = oauth_provider.get_user_info(token)
        except httpx.RequestError as e:
            error_text = str(e)
            if isinstance(e, httpx.HTTPStatusError):
                error_text = e.response.text
            logger.exception("An error occurred during the OAuth process with %s: %s", provider, error_text)
            return {"error": "OAuth process failed"}, 400

        if invite_token and RegisterService.is_valid_invite_token(invite_token):
            invitation = RegisterService.get_invitation_by_token(token=invite_token)
            if invitation:
                invitation_email = invitation.get("email", None)
                if invitation_email != user_info.email:
                    return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Invalid invitation token.")

            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin/invite-settings?invite_token={invite_token}")

        try:
            account = _generate_account(provider, user_info)
        except AccountNotFoundError:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Account not found.")
        except (WorkSpaceNotFoundError, WorkSpaceNotAllowedCreateError):
            return redirect(
                f"{dify_config.CONSOLE_WEB_URL}/signin"
                "?message=Workspace not found, please contact system admin to invite you to join in a workspace."
            )
        except AccountRegisterError as e:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message={e.description}")

        # Check account status
        if account.status == AccountStatus.BANNED:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Account is banned.")

        if account.status == AccountStatus.PENDING:
            account.status = AccountStatus.ACTIVE
            account.initialized_at = naive_utc_now()
            db.session.commit()

        try:
            TenantService.create_owner_tenant_if_not_exist(account)
        except Unauthorized:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Workspace not found.")
        except WorkSpaceNotAllowedCreateError:
            return redirect(
                f"{dify_config.CONSOLE_WEB_URL}/signin"
                "?message=Workspace not found, please contact system admin to invite you to join in a workspace."
            )

        token_pair = AccountService.login(
            account=account,
            ip_address=extract_remote_ip(request),
        )

        response = redirect(f"{dify_config.CONSOLE_WEB_URL}")

        set_access_token_to_cookie(request, response, token_pair.access_token)
        set_refresh_token_to_cookie(request, response, token_pair.refresh_token)
        set_csrf_token_to_cookie(request, response, token_pair.csrf_token)
        return response


def _get_account_by_openid_or_email(provider: str, user_info: OAuthUserInfo) -> Account | None:
    account: Account | None = Account.get_by_openid(provider, user_info.id)

    if not account:
        with Session(db.engine) as session:
            account = session.execute(select(Account).filter_by(email=user_info.email)).scalar_one_or_none()

    return account


def _generate_account(provider: str, user_info: OAuthUserInfo):
    # Get account by openid or email.
    account = _get_account_by_openid_or_email(provider, user_info)

    if account:
        tenants = TenantService.get_join_tenants(account)
        if not tenants:
            if not FeatureService.get_system_features().is_allow_create_workspace:
                raise WorkSpaceNotAllowedCreateError()
            else:
                new_tenant = TenantService.create_tenant(f"{account.name}'s Workspace")
                TenantService.create_tenant_member(new_tenant, account, role="owner")
                account.current_tenant = new_tenant
                tenant_was_created.send(new_tenant)

    if not account:
        if not FeatureService.get_system_features().is_allow_register:
            if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(user_info.email):
                raise AccountRegisterError(
                    description=(
                        "This email account has been deleted within the past "
                        "30 days and is temporarily unavailable for new account registration"
                    )
                )
            else:
                raise AccountRegisterError(description=("Invalid email or password"))
        account_name = user_info.name or "Dify"
        account = RegisterService.register(
            email=user_info.email, name=account_name, password=None, open_id=user_info.id, provider=provider
        )

        # Set interface language
        preferred_lang = request.accept_languages.best_match(languages)
        if preferred_lang and preferred_lang in languages:
            interface_language = preferred_lang
        else:
            interface_language = languages[0]
        account.interface_language = interface_language
        db.session.commit()

    # Link account
    AccountService.link_account_integrate(provider, user_info.id, account)

    return account
