from uuid import UUID

from flask_restx import Resource

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import (
    DatasetAccessDeniedRequestError,
    DatasetNotInitializedError,
    raise_hit_testing_error,
)
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import DATASET_TOKEN_AUTH_RESPONSES, dataset_retrieval_admission
from extensions.ext_application_services import application_services
from fields.hit_testing_fields import HitTestingPayload, HitTestingResponse
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from services.knowledge.entities.hit_testing import HitTestingRequest

register_schema_models(service_api_ns, HitTestingPayload)
register_response_schema_models(service_api_ns, HitTestingResponse)


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/hit-testing",
    doc={"post": {"deprecated": True}},
)
@service_api_ns.route("/datasets/<uuid:dataset_id>/retrieve")
class HitTestingApi(Resource):
    @service_api_ns.doc(responses=DATASET_TOKEN_AUTH_RESPONSES)
    @error_responses(
        DatasetAccessDeniedRequestError,
        DatasetNotInitializedError,
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @service_api_ns.doc(
        summary="Retrieve Chunks from a Knowledge Base / Test Retrieval",
        description=(
            "Performs a search query against a knowledge base to retrieve the most relevant chunks. This "
            "endpoint can be used for both production retrieval and test retrieval."
        ),
        tags=["Knowledge Bases"],
        responses={
            200: "Retrieval results.",
            400: (
                "- `dataset_not_initialized` : The dataset is still being initialized or indexing. Please "
                "wait a moment.\n"
                "- `provider_not_initialize` : No valid model provider credentials found. Please go to "
                "Settings -> Model Provider to complete your provider credentials.\n"
                "- `provider_quota_exceeded` : Your quota for Dify Hosted OpenAI has been exhausted. Please "
                "go to Settings -> Model Provider to complete your own provider credentials.\n"
                "- `model_currently_not_support` : Dify Hosted OpenAI trial currently not support the GPT-4 "
                "model.\n"
                "- `completion_request_error` : Completion request failed.\n"
                "- `invalid_param` : Invalid parameter value."
            ),
            403: "`forbidden` : Insufficient permissions.",
            404: "`not_found` : Knowledge base not found.",
            500: "`internal_server_error` : An internal error occurred during retrieval.",
        },
    )
    @service_api_ns.doc("dataset_hit_testing")
    @service_api_ns.doc(description="Perform hit testing on a dataset")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.response(
        200,
        "Hit testing results",
        model=service_api_ns.models[HitTestingResponse.__name__],
    )
    @service_api_ns.response(401, "Unauthorized - invalid API token")
    @service_api_ns.response(404, "Dataset not found")
    @service_api_ns.expect(service_api_ns.models[HitTestingPayload.__name__])
    @dataset_retrieval_admission
    def post(self, request_context: RequestContext, dataset_id: UUID) -> dict[str, object]:
        """Perform hit testing on a dataset.

        Tests retrieval performance for the specified dataset.
        """
        req_data = HitTestingPayload.model_validate(service_api_ns.payload or {})
        try:
            result = application_services().knowledge.hit_testing.hit_testing(
                request_context,
                dataset_id=str(dataset_id),
                request=HitTestingRequest(
                    query=req_data.query,
                    retrieval_model=req_data.retrieval_model.model_dump(exclude_none=True)
                    if req_data.retrieval_model is not None
                    else None,
                    attachment_ids=req_data.attachment_ids,
                ),
            )
        except Exception as error:
            raise_hit_testing_error(error)
        return dump_response(HitTestingResponse, result)
