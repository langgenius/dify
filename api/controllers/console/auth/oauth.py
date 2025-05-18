import logging
import time
import hashlib
from datetime import UTC, datetime
from typing import Optional

import requests
from flask import current_app, redirect, request
from flask_restful import Resource  # type: ignore
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from constants.languages import languages
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from libs.helper import extract_remote_ip
from libs.oauth import DigitalBaseOAuth, GitHubOAuth, GoogleOAuth, OAuthUserInfo
from models import Account
from models.account import AccountStatus
from services.account_service import AccountService, RegisterService, TenantService
from services.errors.account import AccountNotFoundError, AccountRegisterError
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkSpaceNotFoundError
from services.feature_service import FeatureService

from .. import api

BASE_OAUTH_CLIENT_ID="4e2c105294fe46a1862a273ea54f469c"
BASE_OAUTH_CLIENT_SECRET="02f551ecffb244c69f10eb792f37c3c71cbbcc97c43c5a83240416a6f7a0cec1c4"
BASE_OAUTH_URL="http://192.168.0.215:9002/schoolbase"
DIFY_WEB_URL="http://120.46.81.72:1349/apps"
DIFY_WEB_KB_URL="http://120.46.81.72:1349/datasets"

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

        # if not dify_config.DIGITAL_BASE_CLIENT_ID or not dify_config.DIGITAL_BASE_CLIENT_SECRET or not dify_config.DIGITAL_BASE_URL:
        #     digital_base_oauth = None
        # else:
        #     digital_base_oauth = DigitalBaseOAuth(
        #         client_id=dify_config.DIGITAL_BASE_CLIENT_ID,
        #         client_secret=dify_config.DIGITAL_BASE_CLIENT_SECRET,
        #         redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/authorize/digitalbase",
        #         base_url=dify_config.DIGITAL_BASE_URL,
        #     )
        digital_base_oauth = DigitalBaseOAuth(
            client_id=BASE_OAUTH_CLIENT_ID,
            client_secret=BASE_OAUTH_CLIENT_SECRET,
            redirect_uri=dify_config.CONSOLE_API_URL + "/console/api/oauth/authorize/digitalbase",
            base_url=BASE_OAUTH_URL,
        )
        OAUTH_PROVIDERS = {"github": github_oauth, "google": google_oauth, "digitalbase": digital_base_oauth}
        return OAUTH_PROVIDERS


class OAuthLogin(Resource):
    def get(self, provider: str):
        invite_token = request.args.get("invite_token") or None
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
        if not oauth_provider:
            return {"error": "Invalid provider"}, 400

        auth_url = oauth_provider.get_authorization_url(invite_token=invite_token)
        return redirect(auth_url)


class OAuthCallback(Resource):
    def get(self, provider: str):
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
        if not oauth_provider:
            logging.error(f"无效的认证提供方: {provider}")
            return {"error": "Invalid provider"}, 400

        code = request.args.get("code")
        state = request.args.get("state")
        invite_token = None
        if state:
            invite_token = state

        try:
            token = oauth_provider.get_access_token(code)
            user_info = oauth_provider.get_user_info(token)
        except requests.exceptions.RequestException as e:
            error_text = e.response.text if e.response else str(e)
            logging.exception(f"OAuth认证过程中发生错误，认证提供方: {provider}，错误信息: {error_text}")
            return {"error": "OAuth process failed"}, 400

        if invite_token and RegisterService.is_valid_invite_token(invite_token):
            invitation = RegisterService._get_invitation_by_token(token=invite_token)
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
        if account.status == AccountStatus.BANNED.value:
            return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?message=Account is banned.")

        if account.status == AccountStatus.PENDING.value:
            account.status = AccountStatus.ACTIVE.value
            account.initialized_at = datetime.now(UTC).replace(tzinfo=None)
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
        
        kb = request.args.get("kb")
        if kb:
            return redirect(
            # f"{dify_config.CONSOLE_WEB_URL}?access_token={token_pair.access_token}&refresh_token={token_pair.refresh_token}"
            f"{DIFY_WEB_KB_URL}?access_token={token_pair.access_token}&refresh_token={token_pair.refresh_token}"
        )


        return redirect(
            # f"{dify_config.CONSOLE_WEB_URL}?access_token={token_pair.access_token}&refresh_token={token_pair.refresh_token}"
            f"{DIFY_WEB_URL}?access_token={token_pair.access_token}&refresh_token={token_pair.refresh_token}"
        )


def _get_account_by_openid_or_email(provider: str, user_info: OAuthUserInfo) -> Optional[Account]:
    account: Optional[Account] = Account.get_by_openid(provider, user_info.id)

    if not account:
        with Session(db.engine) as session:
            account = session.execute(select(Account).filter_by(email=user_info.email)).scalar_one_or_none()

    return account


def _generate_account(provider: str, user_info: OAuthUserInfo):
    # Get account by openid or email.
    account = _get_account_by_openid_or_email(provider, user_info)

    if account:
        tenant = TenantService.get_join_tenants(account)
        if not tenant:
            # if not FeatureService.get_system_features().is_allow_create_workspace:
            if tenant:
                raise WorkSpaceNotAllowedCreateError()
            else:
                tenant = TenantService.create_tenant(f"{account.name}'s Workspace")
                TenantService.create_tenant_member(tenant, account, role="owner")
                account.current_tenant = tenant
                tenant_was_created.send(tenant)

    if not account:
        # if not FeatureService.get_system_features().is_allow_register:
        #     raise AccountNotFoundError()
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


api.add_resource(OAuthLogin, "/oauth/login/<provider>")
api.add_resource(OAuthCallback, "/oauth/authorize/<provider>")
