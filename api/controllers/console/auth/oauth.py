import logging
from datetime import datetime, timezone
from typing import Optional

import requests
from flask import current_app, redirect, request
from flask_restful import Resource

from constants.languages import languages
from extensions.ext_database import db
from libs.helper import get_remote_ip
from libs.oauth import GitHubOAuth, GoogleOAuth, OAuthUserInfo
from models.account import Account, AccountStatus
from services.account_service import AccountService, RegisterService, TenantService

from .. import api


def get_oauth_providers():
    with current_app.app_context():
        github_oauth = GitHubOAuth(client_id=current_app.config.get('GITHUB_CLIENT_ID'),
                                   client_secret=current_app.config.get(
                                       'GITHUB_CLIENT_SECRET'),
                                   redirect_uri=current_app.config.get(
                                       'CONSOLE_API_URL') + '/console/api/oauth/authorize/github')

        google_oauth = GoogleOAuth(client_id=current_app.config.get('GOOGLE_CLIENT_ID'),
                                   client_secret=current_app.config.get(
                                       'GOOGLE_CLIENT_SECRET'),
                                   redirect_uri=current_app.config.get(
                                       'CONSOLE_API_URL') + '/console/api/oauth/authorize/google')

        OAUTH_PROVIDERS = {
            'github': github_oauth,
            'google': google_oauth
        }
        return OAUTH_PROVIDERS


class OAuthLogin(Resource):
    def get(self, provider: str):
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
            print(vars(oauth_provider))
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400

        auth_url = oauth_provider.get_authorization_url()
        return redirect(auth_url)


class OAuthCallback(Resource):
    def get(self, provider: str):
        OAUTH_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_PROVIDERS.get(provider)
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400

        code = request.args.get('code')
        try:
            token = oauth_provider.get_access_token(code)
            user_info = oauth_provider.get_user_info(token)
        except requests.exceptions.HTTPError as e:
            logging.exception(
                f"An error occurred during the OAuth process with {provider}: {e.response.text}")
            return {'error': 'OAuth process failed'}, 400

        account = _generate_account(provider, user_info)
        # Check account status
        if account.status == AccountStatus.BANNED.value or account.status == AccountStatus.CLOSED.value:
            return {'error': 'Account is banned or closed.'}, 403

        if account.status == AccountStatus.PENDING.value:
            account.status = AccountStatus.ACTIVE.value
            account.initialized_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.session.commit()

        TenantService.create_owner_tenant_if_not_exist(account)

        token = AccountService.login(account, ip_address=get_remote_ip(request))

        return redirect(f'{current_app.config.get("CONSOLE_WEB_URL")}?console_token={token}')


def _get_account_by_openid_or_email(provider: str, user_info: OAuthUserInfo) -> Optional[Account]:
    account = Account.get_by_openid(provider, user_info.id)

    if not account:
        account = Account.query.filter_by(email=user_info.email).first()

    return account


def _generate_account(provider: str, user_info: OAuthUserInfo):
    # Get account by openid or email.
    account = _get_account_by_openid_or_email(provider, user_info)

    if not account:
        # Create account
        account_name = user_info.name if user_info.name else 'Dify'
        account = RegisterService.register(
            email=user_info.email,
            name=account_name,
            password=None,
            open_id=user_info.id,
            provider=provider
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


api.add_resource(OAuthLogin, '/oauth/login/<provider>')
api.add_resource(OAuthCallback, '/oauth/authorize/<provider>')
