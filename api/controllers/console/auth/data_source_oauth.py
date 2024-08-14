import logging

import requests
from flask import current_app, redirect, request
from flask_login import current_user
from flask_restful import Resource
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.console import api
from libs.login import login_required
from libs.oauth_data_source import NotionOAuth

from ..setup import setup_required
from ..wraps import account_initialization_required


def get_oauth_providers():
    with current_app.app_context():
        notion_oauth = NotionOAuth(client_id=dify_config.NOTION_CLIENT_ID,
                                   client_secret=dify_config.NOTION_CLIENT_SECRET,
                                   redirect_uri=dify_config.CONSOLE_API_URL + '/console/api/oauth/data-source/callback/notion')

        OAUTH_PROVIDERS = {
            'notion': notion_oauth
        }
        return OAUTH_PROVIDERS


class OAuthDataSource(Resource):
    def get(self, provider: str):
        # The role of the current user in the table must be admin or owner
        if not current_user.is_admin_or_owner:
            raise Forbidden()
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
            print(vars(oauth_provider))
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400
        if dify_config.NOTION_INTEGRATION_TYPE == 'internal':
            internal_secret = dify_config.NOTION_INTERNAL_SECRET
            if not internal_secret:
                return {'error': 'Internal secret is not set'},
            oauth_provider.save_internal_access_token(internal_secret)
            return { 'data': '' }
        else:
            auth_url = oauth_provider.get_authorization_url()
            return { 'data': auth_url }, 200




class OAuthDataSourceCallback(Resource):
    def get(self, provider: str):
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400
        if 'code' in request.args:
            code = request.args.get('code')

            return redirect(f'{dify_config.CONSOLE_WEB_URL}?type=notion&code={code}')
        elif 'error' in request.args:
            error = request.args.get('error')

            return redirect(f'{dify_config.CONSOLE_WEB_URL}?type=notion&error={error}')
        else:
            return redirect(f'{dify_config.CONSOLE_WEB_URL}?type=notion&error=Access denied')
        

class OAuthDataSourceBinding(Resource):
    def get(self, provider: str):
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400
        if 'code' in request.args:
            code = request.args.get('code')
            try:
                oauth_provider.get_access_token(code)
            except requests.exceptions.HTTPError as e:
                logging.exception(
                    f"An error occurred during the OAuthCallback process with {provider}: {e.response.text}")
                return {'error': 'OAuth data source process failed'}, 400

            return {'result': 'success'}, 200


class OAuthDataSourceSync(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider, binding_id):
        provider = str(provider)
        binding_id = str(binding_id)
        OAUTH_DATASOURCE_PROVIDERS = get_oauth_providers()
        with current_app.app_context():
            oauth_provider = OAUTH_DATASOURCE_PROVIDERS.get(provider)
        if not oauth_provider:
            return {'error': 'Invalid provider'}, 400
        try:
            oauth_provider.sync_data_source(binding_id)
        except requests.exceptions.HTTPError as e:
            logging.exception(
                f"An error occurred during the OAuthCallback process with {provider}: {e.response.text}")
            return {'error': 'OAuth data source process failed'}, 400

        return {'result': 'success'}, 200


api.add_resource(OAuthDataSource, '/oauth/data-source/<string:provider>')
api.add_resource(OAuthDataSourceCallback, '/oauth/data-source/callback/<string:provider>')
api.add_resource(OAuthDataSourceBinding, '/oauth/data-source/binding/<string:provider>')
api.add_resource(OAuthDataSourceSync, '/oauth/data-source/<string:provider>/<uuid:binding_id>/sync')
