import logging
from datetime import datetime
from typing import Optional

import flask_login
import requests
from flask import request, redirect, current_app, session
from flask_restful import Resource

from libs.oauth import OAuthUserInfo, NotionOAuth
from extensions.ext_database import db
from models.account import Account, AccountStatus
from services.account_service import AccountService, RegisterService
from .. import api


def get_oauth_providers():
    with current_app.app_context():
        notion_oauth = NotionOAuth(client_id=current_app.config.get('NOTION_CLIENT_ID'),
                                   client_secret=current_app.config.get(
                                       'NOTION_CLIENT_SECRET'),
                                   redirect_uri=current_app.config.get(
                                       'CONSOLE_URL') + '/console/api/oauth/authorize/github')

        OAUTH_PROVIDERS = {
            'notion': notion_oauth
        }
        return OAUTH_PROVIDERS


class OAuthDataSource(Resource):
    def get(self, provider: str):
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
            print(vars(oauth_provider))
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400

        auth_url = oauth_provider.get_authorization_url()
        return redirect(auth_url)


class OAuthCallback(Resource):
    def get(self, provider: str):
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400

        code = request.args.get('code')
        try:
            token = oauth_provider.get_access_token(code)
        except requests.exceptions.HTTPError as e:
            logging.exception(
                f"An error occurred during the OAuthCallback process with {provider}: {e.response.text}")
            return {'error': 'OAuth process failed'}, 400

        return redirect(f'{current_app.config.get("CONSOLE_URL")}?oauth_login=success')


def _bind_access_token(provider: str, user_info: OAuthUserInfo):

    # Link account
    return


api.add_resource(OAuthDataSource, '/oauth/login/<provider>')
api.add_resource(OAuthCallback, '/oauth/authorize/<provider>')
