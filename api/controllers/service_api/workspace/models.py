from flask_login import current_user
from flask_restful import Resource

from controllers.service_api import api
from controllers.service_api.wraps import validate_dataset_token
from core.model_runtime.utils.encoders import jsonable_encoder
from services.model_provider_service import ModelProviderService


class ModelProviderAvailableModelApi(Resource):
    @validate_dataset_token
    def get(self, _, model_type):
        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_model_type(tenant_id=tenant_id, model_type=model_type)

        return jsonable_encoder({"data": models})


api.add_resource(ModelProviderAvailableModelApi, "/workspaces/current/models/model-types/<string:model_type>")
