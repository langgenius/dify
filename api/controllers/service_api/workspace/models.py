from controllers.common.schema import register_response_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.flask_admission import DatasetApiResource
from fields.base import ResponseModel
from graphon.model_runtime.utils.encoders import jsonable_encoder
from machinery.context import RequestContext
from services.entities.model_provider_entities import ProviderWithModelsResponse
from services.model_provider.service import ModelProviderService

MODEL_TYPE_PARAM = {
    "description": "Type of model to retrieve.",
    "enum": ["text-embedding", "rerank", "llm", "tts", "speech2text", "moderation"],
    "type": "string",
}


class ProviderWithModelsListResponse(ResponseModel):
    data: list[ProviderWithModelsResponse]


register_response_schema_models(service_api_ns, ProviderWithModelsListResponse)


@service_api_ns.route("/workspaces/current/models/model-types/<string:model_type>")
class ModelProviderAvailableModelApi(DatasetApiResource):
    __apidoc__ = {"responses": {401: "Unauthorized - invalid API token"}}

    @service_api_ns.doc(
        summary="Get Available Models",
        description=(
            "Retrieve the list of available models by type. Primarily used to query `text-embedding` and "
            "`rerank` models for knowledge base configuration."
        ),
        tags=["Models"],
        responses={
            200: "Available models for the specified type.",
        },
    )
    @service_api_ns.doc("get_available_models")
    @service_api_ns.doc(description="Get available models by model type")
    @service_api_ns.doc(params={"model_type": MODEL_TYPE_PARAM})
    @service_api_ns.doc(
        responses={
            200: "Models retrieved successfully",
            401: "Unauthorized - invalid API token",
        }
    )
    @service_api_ns.response(
        200,
        "Models retrieved successfully",
        service_api_ns.models[ProviderWithModelsListResponse.__name__],
    )
    def get(self, request_context: RequestContext, model_type: str):
        """Get available models by model type.

        Returns a list of available models for the specified model type.
        """
        tenant_id = request_context.active_workspace_id

        model_provider_service = ModelProviderService()
        models = model_provider_service.get_models_by_model_type(tenant_id=tenant_id, model_type=model_type)

        return jsonable_encoder({"data": models})
