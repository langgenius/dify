import json
import logging
import secrets

import httpx
from flask import current_app, redirect, request, session
from flask_restx import Resource
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from constants.languages import languages
from controllers.console.wraps import account_initialization_required, setup_required
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.helper import extract_remote_ip
from libs.login import current_account_with_tenant, login_required
from libs.oauth import AceDataCloudOAuth, GitHubOAuth, GoogleOAuth, OAuthUserInfo
from libs.token import (
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
)
from models import Account, AccountIntegrate, AccountStatus
from services.account_service import AccountService, RegisterService, TenantService
from services.billing_service import BillingService
from services.errors.account import AccountNotFoundError, AccountRegisterError
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkSpaceNotFoundError
from services.feature_service import FeatureService

from .. import console_ns

logger = logging.getLogger(__name__)

ACEDATACLOUD_PROVIDER = "acedatacloud"


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
        if dify_config.ACEDATACLOUD_AUTH_BASE_URL:
            acedatacloud_oauth = AceDataCloudOAuth(
                base_url=dify_config.ACEDATACLOUD_AUTH_BASE_URL,
                login_path=dify_config.ACEDATACLOUD_AUTH_LOGIN_PATH,
                redirect_uri=dify_config.CONSOLE_API_URL + f"{dify_config.OAUTH_REDIRECT_PATH}/{ACEDATACLOUD_PROVIDER}",
            )
        else:
            acedatacloud_oauth = None

        OAUTH_PROVIDERS = {
            "github": github_oauth,
            "google": google_oauth,
            ACEDATACLOUD_PROVIDER: acedatacloud_oauth,
        }
        return OAUTH_PROVIDERS


@console_ns.route("/oauth/login/<provider>")
class OAuthLogin(Resource):
    @console_ns.doc("oauth_login")
    @console_ns.doc(description="Initiate OAuth login process")
    @console_ns.doc(
        params={
            "provider": "OAuth provider name (github/google/acedatacloud)",
            "invite_token": "Optional invitation token",
        }
    )
    @console_ns.response(302, "Redirect to OAuth authorization URL")
    @console_ns.response(400, "Invalid provider")
    def get(self, provider: str):
        invite_token = request.args.get("invite_token") or None
        if dify_config.ENABLE_ACEDATACLOUD_OAUTH_LOGIN and provider != ACEDATACLOUD_PROVIDER:
            return {"error": "Invalid provider"}, 400
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400

        nonce = secrets.token_urlsafe(32)
        session[f"oauth_state_{provider}"] = {
            "nonce": nonce,
            "invite_token": invite_token,
        }

        redirect_override = None
        if provider == ACEDATACLOUD_PROVIDER:
            redirect_override = f"{request.host_url.rstrip('/')}{dify_config.OAUTH_REDIRECT_PATH}/{provider}"

        auth_url = oauth_provider.get_authorization_url(state=nonce, redirect_override=redirect_override)
        response = redirect(auth_url)
        if provider == ACEDATACLOUD_PROVIDER:
            response.delete_cookie("no_acedatacloud_oauth", path="/")
        return response


@console_ns.route("/oauth/authorize/<provider>")
class OAuthCallback(Resource):
    @console_ns.doc("oauth_callback")
    @console_ns.doc(description="Handle OAuth callback and complete login process")
    @console_ns.doc(
        params={
            "provider": "OAuth provider name (github/google/acedatacloud)",
            "code": "Authorization code from OAuth provider",
            "state": "Optional state parameter (used for invite token)",
        }
    )
    @console_ns.response(302, "Redirect to console with access token")
    @console_ns.response(400, "OAuth process failed")
    def get(self, provider: str):
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400

        code = request.args.get("code")
        state = request.args.get("state")
        session_key = f"oauth_state_{provider}"
        state_payload = session.pop(session_key, None)

        if not code:
            return {"error": "Authorization code is required"}, 400
        invite_token = None
        if state_payload and state and state_payload.get("nonce") == state:
            invite_token = state_payload.get("invite_token")
        elif state_payload:
            return {"error": "Invalid or expired OAuth state"}, 400

        token_response: dict | None = None
        try:
            if provider == ACEDATACLOUD_PROVIDER and isinstance(oauth_provider, AceDataCloudOAuth):
                token_response = oauth_provider.exchange_code_for_token(code)
                access_token = token_response.get("access_token")
                if not access_token:
                    raise ValueError(f"Error in AceDataCloud OAuth: {token_response}")
                user_info = oauth_provider.get_user_info(access_token)
            else:
                token = oauth_provider.get_access_token(code)
                user_info = oauth_provider.get_user_info(token)
        except httpx.HTTPError as e:
            error_text = str(e)
            if isinstance(e, httpx.HTTPStatusError):
                error_text = e.response.text
            logger.exception("An error occurred during the OAuth process with %s: %s", provider, error_text)
            return {"error": "OAuth process failed"}, 400
        except Exception:
            logger.exception("An error occurred during the OAuth process with %s", provider)
            return {"error": "OAuth process failed"}, 400

        if invite_token and RegisterService.is_valid_invite_token(invite_token):
            invitation = RegisterService.get_invitation_by_token(token=invite_token)
            if invitation:
                invitation_email = invitation.get("email", None)
                if invitation_email != user_info.email:
                    return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Invalid invitation token.")

            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin/invite-settings?invite_token={invite_token}")

        try:
            account, oauth_new_user = _generate_account(provider, user_info)
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
            if provider == ACEDATACLOUD_PROVIDER and dify_config.ACEDATACLOUD_AUTH_AUTO_REGISTER:
                TenantService.create_owner_tenant_if_not_exist(account, is_setup=True)
            else:
                TenantService.create_owner_tenant_if_not_exist(account)
        except Unauthorized:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Workspace not found.")
        except WorkSpaceNotAllowedCreateError:
            return redirect(
                f"{dify_config.CONSOLE_WEB_URL}/signin"
                "?message=Workspace not found, please contact system admin to invite you to join in a workspace."
            )

        if provider == ACEDATACLOUD_PROVIDER and token_response:
            _persist_acedatacloud_token(account=account, open_id=user_info.id, token_response=token_response)

        token_pair = AccountService.login(
            account=account,
            ip_address=extract_remote_ip(request),
        )

        base_url = dify_config.CONSOLE_WEB_URL
        query_char = "&" if "?" in base_url else "?"
        target_url = f"{base_url}{query_char}oauth_new_user={str(oauth_new_user).lower()}"
        response = redirect(target_url)

        set_access_token_to_cookie(request, response, token_pair.access_token)
        set_refresh_token_to_cookie(request, response, token_pair.refresh_token)
        set_csrf_token_to_cookie(request, response, token_pair.csrf_token)
        return response


@console_ns.route("/oauth/acedatacloud/session")
class AceDataCloudOAuthSession(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        """
        Return the latest persisted AceDataCloud OAuth tokens and user info for the current account.

        This endpoint is designed for the console frontend to persist these values client-side when needed.
        """
        account, current_tenant_id = current_account_with_tenant()

        account_integrate: AccountIntegrate | None = (
            db.session.query(AccountIntegrate).filter_by(account_id=account.id, provider=ACEDATACLOUD_PROVIDER).first()
        )
        token_file = (account_integrate.encrypted_token if account_integrate else "") or ""
        if not token_file:
            return {"result": "success", "data": None}

        try:
            from core.helper.encrypter import decrypt_token
            from extensions.ext_storage import storage

            raw = storage.load(token_file)
            token_doc = json.loads(raw.decode("utf-8"))
            encrypted_payload = token_doc.get("encrypted_payload")
            tenant_id = token_doc.get("tenant_id") or current_tenant_id

            if not encrypted_payload or not tenant_id:
                return {"result": "success", "data": None}

            decrypted_payload = decrypt_token(tenant_id, encrypted_payload)
            token_payload = json.loads(decrypted_payload) if decrypted_payload else {}
        except Exception:
            logger.exception("Failed to load AceDataCloud token for account %s", account.id)
            return {"result": "success", "data": None}

        access_token = token_payload.get("access_token")
        user_info: OAuthUserInfo | None = None

        try:
            if access_token:
                oauth_provider = get_oauth_providers().get(ACEDATACLOUD_PROVIDER)
                if isinstance(oauth_provider, AceDataCloudOAuth):
                    user_info = oauth_provider.get_user_info(access_token)
        except Exception:
            logger.exception("Failed to fetch AceDataCloud user info for account %s", account.id)

        return {
            "result": "success",
            "data": {
                **token_payload,
                "provider": ACEDATACLOUD_PROVIDER,
                "user_info": user_info.__dict__ if user_info else None,
            },
        }


def _persist_acedatacloud_token(*, account: Account, open_id: str, token_response: dict) -> None:
    """
    Persist AceDataCloud access/refresh tokens for later use.
    We store an encrypted payload in object storage and keep a short reference path in DB.
    """
    try:
        from core.helper.encrypter import encrypt_token
        from extensions.ext_storage import storage

        tenants = TenantService.get_join_tenants(account)
        tenant_id = account.current_tenant_id or (tenants[0].id if tenants else None)
        if not tenant_id:
            logger.warning("Skip persisting AceDataCloud token: missing tenant for account %s", account.id)
            return

        payload = {
            "access_token": token_response.get("access_token"),
            "refresh_token": token_response.get("refresh_token"),
            "expires_in": token_response.get("expires_in"),
            "obtained_at": naive_utc_now().isoformat(),
        }
        encrypted_payload = encrypt_token(tenant_id, json.dumps(payload))

        token_file = f"account_integrates/{account.id}/{ACEDATACLOUD_PROVIDER}.json"
        storage.save(
            token_file,
            json.dumps(
                {
                    "version": 1,
                    "tenant_id": tenant_id,
                    "encrypted_payload": encrypted_payload,
                }
            ).encode("utf-8"),
        )

        AccountService.link_account_integrate(
            provider=ACEDATACLOUD_PROVIDER, open_id=open_id, account=account, encrypted_token=token_file
        )

        if dify_config.ACEDATACLOUD_AUTO_PROVISION_PLUGIN_CREDENTIALS:
            from tasks.provision_acedatacloud_plugin_credentials_task import (
                provision_acedatacloud_plugin_credentials_task,
            )

            access_token = token_response.get("access_token")
            if not access_token:
                raise ValueError("AceDataCloud access_token is required for auto-provisioning")

            for tenant in tenants:
                provision_acedatacloud_plugin_credentials_task.delay(
                    tenant_id=str(tenant.id),
                    account_id=str(account.id),
                    acedatacloud_user_id=str(open_id),
                    acedatacloud_access_token=str(access_token),
                )
    except Exception:
        logger.exception("Failed to persist AceDataCloud token for account %s", account.id)


def _get_account_by_openid_or_email(provider: str, user_info: OAuthUserInfo) -> Account | None:
    account: Account | None = Account.get_by_openid(provider, user_info.id)

    if not account:
        with Session(db.engine) as session:
            account = session.execute(select(Account).filter_by(email=user_info.email)).scalar_one_or_none()

    return account


def _generate_account(provider: str, user_info: OAuthUserInfo) -> tuple[Account, bool]:
    # Get account by openid or email.
    account = _get_account_by_openid_or_email(provider, user_info)
    oauth_new_user = False

    if account:
        tenants = TenantService.get_join_tenants(account)
        if not tenants:
            allow_create_workspace = FeatureService.get_system_features().is_allow_create_workspace
            if provider == ACEDATACLOUD_PROVIDER and dify_config.ACEDATACLOUD_AUTH_AUTO_REGISTER:
                allow_create_workspace = True

            if not allow_create_workspace:
                raise WorkSpaceNotAllowedCreateError()
            else:
                if provider == ACEDATACLOUD_PROVIDER and dify_config.ACEDATACLOUD_AUTH_AUTO_REGISTER:
                    new_tenant = TenantService.create_tenant(f"{account.name}'s Workspace", is_setup=True)
                else:
                    new_tenant = TenantService.create_tenant(f"{account.name}'s Workspace")
                TenantService.create_tenant_member(new_tenant, account, role="owner")
                account.current_tenant = new_tenant
                tenant_was_created.send(new_tenant)

    if not account:
        oauth_new_user = True
        allow_register = FeatureService.get_system_features().is_allow_register
        if provider == ACEDATACLOUD_PROVIDER and dify_config.ACEDATACLOUD_AUTH_AUTO_REGISTER:
            allow_register = True

        if not allow_register:
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

    return account, oauth_new_user
