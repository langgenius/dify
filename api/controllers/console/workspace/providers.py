# -*- coding:utf-8 -*-
import base64
import json
import logging

from flask_login import login_required, current_user
from flask_restful import Resource, reqparse, abort
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.llm.provider.errors import ValidateFailedError
from extensions.ext_database import db
from libs import rsa
from models.provider import Provider, ProviderType, ProviderName
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

        ProviderService.init_supported_provider(current_user.current_tenant, "cloud")
        providers = Provider.query.filter_by(tenant_id=tenant_id).all()

        provider_list = [
            {
                'provider_name': p.provider_name,
                'provider_type': p.provider_type,
                'is_valid': p.is_valid,
                'last_used': p.last_used,
                'is_enabled': p.is_enabled,
                **({
                       'quota_type': p.quota_type,
                       'quota_limit': p.quota_limit,
                       'quota_used': p.quota_used
                   } if p.provider_type == ProviderType.SYSTEM.value else {}),
                'token': ProviderService.get_obfuscated_api_key(current_user.current_tenant,
                                                                ProviderName(p.provider_name))
            }
            for p in providers
        ]

        return provider_list


class ProviderTokenApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        if provider not in [p.value for p in ProviderName]:
            abort(404)

        # The role of the current user in the ta table must be admin or owner
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            logging.log(logging.ERROR,
                        f'User {current_user.id} is not authorized to update provider token, current_role is {current_user.current_tenant.current_role}')
            raise Forbidden()

        parser = reqparse.RequestParser()

        parser.add_argument('token', type=ProviderService.get_token_type(
            tenant=current_user.current_tenant,
            provider_name=ProviderName(provider)
        ), required=True, nullable=False, location='json')

        args = parser.parse_args()

        if args['token']:
            try:
                ProviderService.validate_provider_configs(
                    tenant=current_user.current_tenant,
                    provider_name=ProviderName(provider),
                    configs=args['token']
                )
                token_is_valid = True
            except ValidateFailedError as ex:
                raise ValueError(str(ex))

            base64_encrypted_token = ProviderService.get_encrypted_token(
                tenant=current_user.current_tenant,
                provider_name=ProviderName(provider),
                configs=args['token']
            )
        else:
            base64_encrypted_token = None
            token_is_valid = False

        tenant = current_user.current_tenant

        provider_model = db.session.query(Provider).filter(
                Provider.tenant_id == tenant.id,
                Provider.provider_name == provider,
                Provider.provider_type == ProviderType.CUSTOM.value
            ).first()

        # Only allow updating token for CUSTOM provider type
        if provider_model:
            provider_model.encrypted_config = base64_encrypted_token
            provider_model.is_valid = token_is_valid
        else:
            provider_model = Provider(tenant_id=tenant.id, provider_name=provider,
                                      provider_type=ProviderType.CUSTOM.value,
                                      encrypted_config=base64_encrypted_token,
                                      is_valid=token_is_valid)
            db.session.add(provider_model)

        if provider_model.is_valid:
            other_providers = db.session.query(Provider).filter(
                Provider.tenant_id == tenant.id,
                Provider.provider_name != provider,
                Provider.provider_type == ProviderType.CUSTOM.value
            ).all()

            for other_provider in other_providers:
                other_provider.is_valid = False

        db.session.commit()

        if provider in [ProviderName.ANTHROPIC.value, ProviderName.AZURE_OPENAI.value, ProviderName.COHERE.value,
                        ProviderName.HUGGINGFACEHUB.value]:
            return {'result': 'success', 'warning': 'MOCK: This provider is not supported yet.'}, 201

        return {'result': 'success'}, 201


class ProviderTokenValidateApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def post(self, provider):
        if provider not in [p.value for p in ProviderName]:
            abort(404)

        parser = reqparse.RequestParser()
        parser.add_argument('token', type=ProviderService.get_token_type(
            tenant=current_user.current_tenant,
            provider_name=ProviderName(provider)
        ), required=True, nullable=False, location='json')
        args = parser.parse_args()

        # todo: remove this when the provider is supported
        if provider in [ProviderName.ANTHROPIC.value, ProviderName.COHERE.value,
                        ProviderName.HUGGINGFACEHUB.value]:
            return {'result': 'success', 'warning': 'MOCK: This provider is not supported yet.'}

        result = True
        error = None

        try:
            ProviderService.validate_provider_configs(
                tenant=current_user.current_tenant,
                provider_name=ProviderName(provider),
                configs=args['token']
            )
        except ValidateFailedError as e:
            result = False
            error = str(e)

        response = {'result': 'success' if result else 'error'}

        if not result:
            response['error'] = error

        return response


class ProviderSystemApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def put(self, provider):
        if provider not in [p.value for p in ProviderName]:
            abort(404)

        parser = reqparse.RequestParser()
        parser.add_argument('is_enabled', type=bool, required=True, location='json')
        args = parser.parse_args()

        tenant = current_user.current_tenant_id

        provider_model = Provider.query.filter_by(tenant_id=tenant.id, provider_name=provider).first()

        if provider_model and provider_model.provider_type == ProviderType.SYSTEM.value:
            provider_model.is_valid = args['is_enabled']
            db.session.commit()
        elif not provider_model:
            ProviderService.create_system_provider(tenant, provider, args['is_enabled'])
        else:
            abort(403)

        return {'result': 'success'}

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        if provider not in [p.value for p in ProviderName]:
            abort(404)

        # The role of the current user in the ta table must be admin or owner
        if current_user.current_tenant.current_role not in ['admin', 'owner']:
            raise Forbidden()

        provider_model = db.session.query(Provider).filter(Provider.tenant_id == current_user.current_tenant_id,
                                                           Provider.provider_name == provider,
                                                           Provider.provider_type == ProviderType.SYSTEM.value).first()

        system_model = None
        if provider_model:
            system_model = {
                'result': 'success',
                'provider': {
                    'provider_name': provider_model.provider_name,
                    'provider_type': provider_model.provider_type,
                    'is_valid': provider_model.is_valid,
                    'last_used': provider_model.last_used,
                    'is_enabled': provider_model.is_enabled,
                    'quota_type': provider_model.quota_type,
                    'quota_limit': provider_model.quota_limit,
                    'quota_used': provider_model.quota_used
                }
            }
        else:
            abort(404)

        return system_model


api.add_resource(ProviderTokenApi, '/providers/<provider>/token',
                 endpoint='current_providers_token')  # Deprecated
api.add_resource(ProviderTokenValidateApi, '/providers/<provider>/token-validate',
                 endpoint='current_providers_token_validate')  # Deprecated

api.add_resource(ProviderTokenApi, '/workspaces/current/providers/<provider>/token',
                 endpoint='workspaces_current_providers_token')  # PUT for updating provider token
api.add_resource(ProviderTokenValidateApi, '/workspaces/current/providers/<provider>/token-validate',
                 endpoint='workspaces_current_providers_token_validate')  # POST for validating provider token

api.add_resource(ProviderListApi, '/workspaces/current/providers')  # GET for getting providers list
api.add_resource(ProviderSystemApi, '/workspaces/current/providers/<provider>/system',
                 endpoint='workspaces_current_providers_system')  # GET for getting provider quota, PUT for updating provider status
