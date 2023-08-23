# -*- coding:utf-8 -*-
from flask_login import current_user
from core.login.login import login_required
from flask_restful import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_providers.providers.base import CredentialsValidateFailedError
from models.provider import ProviderType
from services.provider_service import ProviderService


class ProviderListApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        tenant_id = current_user.current_tenant_id

        """
        If the type is AZURE_OPENAI, decode and return the four fields of azure_api_type, azure_api_version:, 
        azure_api_base, azure_api_key as an object, where azure_api_key displays the first 6 bits in plaintext, and the 
        rest is replaced by * and the last two bits are displayed in plaintext
        
        If the type is other, decode and return the Token field directly, the field displays the first 6 bits in 
        plaintext, the rest is replaced by * and the last two bits are displayed in plaintext
        """

        provider_service = ProviderService()
        provider_info_list = provider_service.get_provider_list(tenant_id)

        provider_list = [
            {
                'provider_name': p['provider_name'],
                'provider_type': p['provider_type'],
                'is_valid': p['is_valid'],
                'last_used': p['last_used'],
                'is_enabled': p['is_valid'],
                **({
                       'quota_type': p['quota_type'],
                       'quota_limit': p['quota_limit'],
                       'quota_used': p['quota_used']
                   } if p['provider_type'] == ProviderType.SYSTEM.value else {}),
                'token': (p['config'] if p['provider_name'] != 'openai' else p['config']['openai_api_key'])
                        if p['config'] else None
            }
            for name, provider_info in provider_info_list.items()
            for p in provider_info['providers']
        ]

        return provider_list


class ProviderTokenApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        # The role of the current user in the ta table must be admin or owner
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument('token', required=True, nullable=False, location='json')
        args = parser.parse_args()

        if provider == 'openai':
            args['token'] = {
                'openai_api_key': args['token']
            }

        provider_service = ProviderService()
        try:
            provider_service.save_custom_provider_config(
                tenant_id=current_user.current_tenant_id,
                provider_name=provider,
                config=args['token']
            )
        except CredentialsValidateFailedError as ex:
            raise ValueError(str(ex))

        return {'result': 'success'}, 201


class ProviderTokenValidateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        parser = reqparse.RequestParser()
        parser.add_argument('token', required=True, nullable=False, location='json')
        args = parser.parse_args()

        provider_service = ProviderService()

        if provider == 'openai':
            args['token'] = {
                'openai_api_key': args['token']
            }

        result = True
        error = None

        try:
            provider_service.custom_provider_config_validate(
                provider_name=provider,
                config=args['token']
            )
        except CredentialsValidateFailedError as ex:
            result = False
            error = str(ex)

        response = {'result': 'success' if result else 'error'}

        if not result:
            response['error'] = error

        return response


api.add_resource(ProviderTokenApi, '/workspaces/current/providers/<provider>/token',
                 endpoint='workspaces_current_providers_token')  # PUT for updating provider token
api.add_resource(ProviderTokenValidateApi, '/workspaces/current/providers/<provider>/token-validate',
                 endpoint='workspaces_current_providers_token_validate')  # POST for validating provider token

api.add_resource(ProviderListApi, '/workspaces/current/providers')  # GET for getting providers list
