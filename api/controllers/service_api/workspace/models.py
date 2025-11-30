from controllers.service_api import service_api_ns
from controllers.service_api.wraps import DatasetApiResource
from core.model_runtime.utils.encoders import jsonable_encoder
from services.model_provider_service import ModelProviderService


@service_api_ns.route("/workspaces/current/models/model-types/<string:model_type>")
class ModelProviderAvailableModelApi(DatasetApiResource):
    @service_api_ns.doc("get_available_models")
    @service_api_ns.doc(description="Get available models by model type")
    @service_api_ns.doc(params={"model_type": "Type of model to retrieve"})
    @service_api_ns.doc(
        responses={
            200: "Models retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    def get(self, tenant_id: str, model_type: str):
        """Get available models by model type.

        Returns a list of available models for the specified model type.
        """
        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_model_type(tenant_id=tenant_id, model_type=model_type)

        return jsonable_encoder({"data": models})
