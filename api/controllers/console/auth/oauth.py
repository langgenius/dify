import logging
import urllib.parse

import httpx
from flask import current_app, redirect, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from constants.languages import languages
from controllers.common.fields import RedirectResponse
from controllers.common.schema import query_params_from_model, register_response_schema_model, register_schema_models
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.helper import extract_remote_ip
from libs.helper import timezone as validate_timezone_string
from libs.oauth import GitHubOAuth, GoogleOAuth, OAuthUserInfo, decode_oauth_state
from libs.token import (
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
)
from models import Account, AccountStatus
from services.account_service import AccountService, RegisterService, TenantService
from services.billing_service import BillingService
from services.errors.account import AccountNotFoundError, AccountRegisterError, SeatsLimitExceededError
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkSpaceNotFoundError
from services.feature_service import FeatureService

from .. import console_ns

logger = logging.getLogger(__name__)


class OAuthLoginQuery(BaseModel):
    invite_token: str | None = Field(default=None, description="Optional invitation token")
    timezone: str | None = Field(default=None, description="Preferred timezone")
    language: str | None = Field(default=None, description="Preferred interface language")
    redirect_url: str | None = Field(default=None, description="Relative page to resume after login")


class OAuthCallbackQuery(BaseModel):
    code: str = Field(description="Authorization code from OAuth provider")
    state: str | None = Field(default=None, description="OAuth state parameter")


register_schema_models(console_ns, OAuthLoginQuery, OAuthCallbackQuery)
register_response_schema_model(console_ns, RedirectResponse)


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


def _validated_timezone(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return validate_timezone_string(value)
    except ValueError:
        return None


def _validated_language(value: str | None) -> str | None:
    if value and value in languages:
        return value
    return None


def _url_origin(url: str) -> tuple[str, str, int] | None:
    parsed_url = urllib.parse.urlsplit(url)
    if parsed_url.scheme not in {"http", "https"} or parsed_url.hostname is None:
        return None

    try:
        port = parsed_url.port
    except ValueError:
        return None

    if port is None:
        port = 443 if parsed_url.scheme == "https" else 80
    return parsed_url.scheme, parsed_url.hostname, port


def _get_redirect_target(redirect_url: str | None) -> str:
    if not redirect_url:
        return dify_config.CONSOLE_WEB_URL

    parsed_url = urllib.parse.urlsplit(redirect_url)
    normalized_path = redirect_url.lstrip().replace("\\", "/")
    if not parsed_url.scheme and not parsed_url.netloc and not normalized_path.startswith("//"):
        return redirect_url

    redirect_origin = _url_origin(redirect_url)
    if redirect_origin is not None and redirect_origin == _url_origin(dify_config.CONSOLE_WEB_URL):
        return redirect_url
    return dify_config.CONSOLE_WEB_URL


def _preferred_interface_language(language: str | None = None) -> str:
    if language:
        return language

    preferred_lang = request.accept_languages.best_match(languages)
    if preferred_lang and preferred_lang in languages:
        return preferred_lang
    return languages[0]


@console_ns.route("/oauth/login/<provider>")
class OAuthLogin(Resource):
    @console_ns.doc("oauth_login")
    @console_ns.doc(description="Initiate OAuth login process")
    @console_ns.doc(params={"provider": "OAuth provider name (github/google)"})
    @console_ns.doc(params=query_params_from_model(OAuthLoginQuery))
    @console_ns.response(302, "Redirect to OAuth authorization URL", console_ns.models[RedirectResponse.__name__])
    @console_ns.response(400, "Invalid provider")
    def get(self, provider: str):
        invite_token = request.args.get("invite_token") or None
        timezone = _validated_timezone(request.args.get("timezone") or None)
        language = _validated_language(request.args.get("language") or None)
        redirect_url = request.args.get("redirect_url") or None
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400

        auth_url = oauth_provider.get_authorization_url(
            invite_token=invite_token,
            timezone=timezone,
            language=language,
            redirect_url=redirect_url,
        )
        return redirect(auth_url)


@console_ns.route("/oauth/authorize/<provider>")
class OAuthCallback(Resource):
    @console_ns.doc("oauth_callback")
    @console_ns.doc(description="Handle OAuth callback and complete login process")
    @console_ns.doc(params={"provider": "OAuth provider name (github/google)"})
    @console_ns.doc(params=query_params_from_model(OAuthCallbackQuery))
    @console_ns.response(302, "Redirect to console with access token", console_ns.models[RedirectResponse.__name__])
    @console_ns.response(400, "OAuth process failed")
    def get(self, provider: str):
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400

        code = request.args.get("code")
        state = request.args.get("state")
        oauth_state = decode_oauth_state(state)
        invite_token = oauth_state.get("invite_token")
        timezone = _validated_timezone(oauth_state.get("timezone"))
        language = _validated_language(oauth_state.get("language"))
        redirect_url = oauth_state.get("redirect_url")

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
        except ValueError as e:
            logger.warning("OAuth error with %s", provider, exc_info=True)
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message={urllib.parse.quote(str(e))}")

        if invite_token and RegisterService.is_valid_invite_token(invite_token):
            invitation = RegisterService.get_invitation_by_token(token=invite_token)
            if invitation:
                invitation_email = invitation.get("email", None)
                invitation_email_normalized = (
                    invitation_email.lower() if isinstance(invitation_email, str) else invitation_email
                )
                if invitation_email_normalized != user_info.email.lower():
                    return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Invalid invitation token.")

            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin/invite-settings?invite_token={invite_token}")

        try:
            account, oauth_new_user = _generate_account(provider, user_info, timezone=timezone, language=language)
        except AccountNotFoundError:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Account not found.")
        except (WorkSpaceNotFoundError, WorkSpaceNotAllowedCreateError):
            return redirect(
                f"{dify_config.CONSOLE_WEB_URL}/signin"
                "?message=Workspace not found, please contact system admin to invite you to join in a workspace."
            )
        except SeatsLimitExceededError:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Licensed seats limit exceeded.")
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
            TenantService.create_owner_tenant_if_not_exist(account, session=db.session)
        except Unauthorized:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Workspace not found.")
        except WorkSpaceNotAllowedCreateError:
            return redirect(
                f"{dify_config.CONSOLE_WEB_URL}/signin"
                "?message=Workspace not found, please contact system admin to invite you to join in a workspace."
            )

        token_pair = AccountService.login(
            account=account,
            session=db.session,
            ip_address=extract_remote_ip(request),
        )

        target_url = _get_redirect_target(redirect_url)
        query_char = "&" if "?" in target_url else "?"
        target_url = f"{target_url}{query_char}oauth_new_user={str(oauth_new_user).lower()}"
        response = redirect(target_url)

        set_access_token_to_cookie(request, response, token_pair.access_token)
        set_refresh_token_to_cookie(request, response, token_pair.refresh_token)
        set_csrf_token_to_cookie(request, response, token_pair.csrf_token)
        return response


def _get_account_by_openid_or_email(provider: str, user_info: OAuthUserInfo) -> Account | None:
    account: Account | None = Account.get_by_openid(provider, user_info.id)

    if not account:
        account = AccountService.get_account_by_email_with_case_fallback(db.session, user_info.email)

    return account


def _generate_account(
    provider: str,
    user_info: OAuthUserInfo,
    timezone: str | None = None,
    language: str | None = None,
) -> tuple[Account, bool]:
    # Get account by openid or email.
    account = _get_account_by_openid_or_email(provider, user_info)
    oauth_new_user = False

    if account:
        tenants = TenantService.get_join_tenants(account, session=db.session)
        if not tenants:
            if not FeatureService.get_system_features().is_allow_create_workspace:
                raise WorkSpaceNotAllowedCreateError()
            else:
                TenantService.create_owner_tenant(account, session=db.session())

    if not account:
        normalized_email = user_info.email.lower()
        oauth_new_user = True
        if not FeatureService.get_system_features().is_allow_register:
            if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(normalized_email):
                raise AccountRegisterError(
                    description=(
                        "This email account has been deleted within the past "
                        "30 days and is temporarily unavailable for new account registration"
                    )
                )
            raise AccountRegisterError(description=("Invalid email or password"))
        account_name = user_info.name or "Dify"
        interface_language = _preferred_interface_language(language)
        account = RegisterService.register(
            email=normalized_email,
            name=account_name,
            password=None,
            open_id=user_info.id,
            provider=provider,
            language=interface_language,
            timezone=timezone,
            session=db.session,
        )

    # Link account
    AccountService.link_account_integrate(provider, user_info.id, account, session=db.session)

    return account, oauth_new_user
