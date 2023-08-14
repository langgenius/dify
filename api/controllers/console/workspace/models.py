from flask_login import login_required, current_user
from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_providers.model_provider_factory import ModelProviderFactory
from core.model_providers.models.entity.model_params import ModelType
from models.provider import ProviderType
from services.provider_service import ProviderService


class DefaultModelApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=['text-generation', 'embeddings', 'speech2text'], location='args')
        args = parser.parse_args()

        tenant_id = current_user.current_tenant_id

        provider_service = ProviderService()
        default_model = provider_service.get_default_model_of_model_type(
            tenant_id=tenant_id,
            model_type=args['model_type']
        )

        if not default_model:
            return None

        model_provider = ModelProviderFactory.get_preferred_model_provider(
            tenant_id,
            default_model.provider_name
        )

        if not model_provider:
            return {
                'model_name': default_model.model_name,
                'model_type': default_model.model_type,
                'model_provider': {
                    'provider_name': default_model.provider_name
                }
            }

        provider = model_provider.provider
        rst = {
            'model_name': default_model.model_name,
            'model_type': default_model.model_type,
            'model_provider': {
                'provider_name': provider.provider_name,
                'provider_type': provider.provider_type
            }
        }

        model_provider_rules = ModelProviderFactory.get_provider_rule(default_model.provider_name)
        if provider.provider_type == ProviderType.SYSTEM.value:
            rst['model_provider']['quota_type'] = provider.quota_type
            rst['model_provider']['quota_unit'] = model_provider_rules['system_config']['quota_unit']
            rst['model_provider']['quota_limit'] = provider.quota_limit
            rst['model_provider']['quota_used'] = provider.quota_used

        return rst

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('model_name', type=str, required=True, nullable=False, location='json')
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=['text-generation', 'embeddings', 'speech2text'], location='json')
        parser.add_argument('provider_name', type=str, required=True, nullable=False, location='json')
        args = parser.parse_args()

        provider_service = ProviderService()
        provider_service.update_default_model_of_model_type(
            tenant_id=current_user.current_tenant_id,
            model_type=args['model_type'],
            provider_name=args['provider_name'],
            model_name=args['model_name']
        )

        return {'result': 'success'}


class ValidModelApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, model_type):
        ModelType.value_of(model_type)

        provider_service = ProviderService()
        valid_models = provider_service.get_valid_model_list(
            tenant_id=current_user.current_tenant_id,
            model_type=model_type
        )

        return valid_models


api.add_resource(DefaultModelApi, '/workspaces/current/default-model')
api.add_resource(ValidModelApi, '/workspaces/current/models/model-type/<string:model_type>')
