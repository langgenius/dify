from flask_login import current_user
from flask_restx import Resource

from controllers.service_api import service_api_ns
from controllers.service_api.wraps import validate_dataset_token
from core.model_runtime.utils.encoders import jsonable_encoder
from services.model_provider_service import ModelProviderService


@service_api_ns.route("/workspaces/current/models/model-types/<string:model_type>")
class ModelProviderAvailableModelApi(Resource):
    @service_api_ns.doc("get_available_models")
    @service_api_ns.doc(description="Get available models by model type")
    @service_api_ns.doc(params={"model_type": "Type of model to retrieve"})
    @service_api_ns.doc(
        responses={
            200: "Models retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @validate_dataset_token
    def get(self, _, model_type: str):
        """Get available models by model type.

        Returns a list of available models for the specified model type.
        """
        tenant_id = current_user.current_tenant_id

        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_model_type(tenant_id=tenant_id, model_type=model_type)

        return jsonable_encoder({"data": models})
