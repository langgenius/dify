import logging
from datetime import datetime
from typing import Optional

import flask_login
import requests
from flask import request, redirect, current_app, session
from flask_login import current_user, login_required
from flask_restful import Resource
from werkzeug.exceptions import Forbidden
from libs.oauth_data_source import NotionOAuth
from .. import api
from ..setup import setup_required
from ..wraps import account_initialization_required


def get_oauth_providers():
    with current_app.app_context():
        notion_oauth = NotionOAuth(client_id=current_app.config.get('NOTION_CLIENT_ID'),
                                   client_secret=current_app.config.get(
                                       'NOTION_CLIENT_SECRET'),
                                   redirect_uri=current_app.config.get(
                                       'CONSOLE_URL') + '/console/api/oauth/data-source/authorize/notion')

        OAUTH_PROVIDERS = {
            'notion': notion_oauth
        }
        return OAUTH_PROVIDERS


class OAuthDataSource(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider: str):
        # The role of the current user in the table must be admin or owner
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
            print(vars(oauth_provider))
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400

        auth_url = oauth_provider.get_authorization_url()
        return redirect(auth_url)


class OAuthDataSourceCallback(Resource):
    def get(self, provider: str):
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400

        code = request.args.get('code')
        try:
            oauth_provider.get_access_token(code)
        except requests.exceptions.HTTPError as e:
            logging.exception(
                f"An error occurred during the OAuthCallback process with {provider}: {e.response.text}")
            return {'error': 'OAuth data source process failed'}, 400

        return redirect(f'{current_app.config.get("CONSOLE_URL")}?oauth_data_source=success')


api.add_resource(OAuthDataSource, '/oauth/data-source/<provider>')
api.add_resource(OAuthDataSourceCallback, '/oauth/data-source/authorize/<provider>')
