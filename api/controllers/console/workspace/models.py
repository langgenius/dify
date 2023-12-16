import logging

from flask_login import current_user
from flask_restful import reqparse, Resource

from controllers.console import api
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from core.model_runtime.entities.model_entities import ModelType
from libs.login import login_required
from services.model_provider_service import ModelProviderService


class DefaultModelApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument('model_type', type=str, required=True, nullable=False,
                            choices=[mt.value for mt in ModelType], location='args')
        args = parser.parse_args()

        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        default_model_entity = model_provider_service.get_default_model_of_model_type(
            tenant_id=tenant_id,
            model_type=args['model_type']
        )

        return {
            "data": default_model_entity
        }

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('model_settings', type=list, required=True, nullable=False, location='json')
        args = parser.parse_args()

        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        model_settings = args['model_settings']
        for model_setting in model_settings:
            try:
                model_provider_service.update_default_model_of_model_type(
                    tenant_id=tenant_id,
                    model_type=model_setting['model_type'],
                    provider=model_setting['provider'],
                    model=model_setting['model']
                )
            except Exception:
                logging.warning(f"{model_setting['model_type']} save error")

        return {'result': 'success'}


class ModelProviderModelApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, provider):
        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_provider(
            tenant_id=tenant_id,
            provider=provider
        )

        return {
            "data": models
        }


class ModelProviderAvailableModelApi(Resource):

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, model_type):
        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_model_type(
            tenant_id=tenant_id,
            model_type=model_type
        )

        return {
            "data": models
        }


api.add_resource(ModelProviderModelApi, '/workspaces/current/model-providers/<string:provider>/models')
api.add_resource(ModelProviderAvailableModelApi, '/workspaces/current/models/model-types/<string:model_type>')
api.add_resource(DefaultModelApi, '/workspaces/current/default-model')
