from typing import Never
from uuid import UUID

from controllers.common.errors import ForbiddenError, InternalServerError, NotFoundError
from controllers.common.knowledge_errors import KnowledgeIndexUnavailableError
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.dataset.error import DatasetNotInitializedError, ExternalKnowledgeRetrievalFailedError
from controllers.service_api.flask_admission import DatasetApiResource, dataset_admission
from core.errors.error import KnowledgeIndexUnavailableError as IndexUnavailableError
from extensions.ext_application_services import application_services
from fields.hit_testing_fields import HitTestingPayload
from fields.service_api.hit_testing import HitTestingResponse
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from services.errors.index import IndexNotInitializedError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.hit_testing.entities import HitTestingRequest
from services.knowledge.hit_testing.errors import (
    HitTestingFailedError,
    HitTestingInvocationError,
    HitTestingProviderError,
    HitTestingUpstreamError,
)

register_schema_models(service_api_ns, HitTestingPayload)
register_response_schema_models(service_api_ns, HitTestingResponse)


def _raise_hit_testing_error(error: Exception) -> Never:
    if isinstance(error, IndexUnavailableError):
        raise KnowledgeIndexUnavailableError(error.reason) from error
    if isinstance(error, DatasetNotFoundError):
        raise NotFoundError(description=str(error)) from error
    if isinstance(error, DatasetAccessDeniedError):
        raise ForbiddenError(description=str(error)) from error
    if isinstance(error, IndexNotInitializedError):
        raise DatasetNotInitializedError() from error
    if isinstance(error, HitTestingProviderError):
        if error.kind == "quota":
            raise ProviderQuotaExceededError() from error
        if error.kind == "unsupported":
            raise ProviderModelCurrentlyNotSupportError() from error
        raise ProviderNotInitializeError(error.description) from error
    if isinstance(error, HitTestingInvocationError):
        raise CompletionRequestError(str(error)) from error
    if isinstance(error, HitTestingUpstreamError):
        raise ExternalKnowledgeRetrievalFailedError(description=str(error)) from error
    if isinstance(error, HitTestingFailedError):
        raise InternalServerError(description=str(error)) from error
    raise error


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/hit-testing",
    doc={"post": {"deprecated": True}},
)
@service_api_ns.route("/datasets/<uuid:dataset_id>/retrieve")
class HitTestingApi(DatasetApiResource):
    @error_responses(
        KnowledgeIndexUnavailableError,
        DatasetNotInitializedError,
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
        ExternalKnowledgeRetrievalFailedError,
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
            502: "`external_knowledge_failed` : External knowledge retrieval failed.",
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
    @dataset_admission(rate_limit=True)
    @model_validate(HitTestingPayload)
    def post(
        self,
        payload: HitTestingPayload,
        request_context: RequestContext,
        dataset_id: UUID,
    ) -> dict[str, object]:
        """Perform hit testing on a dataset.

        Tests retrieval performance for the specified dataset.
        """
        try:
            result = application_services().knowledge.hit_testing.retrieve(
                request_context,
                dataset_id=str(dataset_id),
                request=HitTestingRequest(
                    query=payload.query,
                    retrieval_model=(
                        payload.retrieval_model.model_dump(exclude_none=True)
                        if payload.retrieval_model is not None
                        else None
                    ),
                    external_retrieval_model=payload.external_retrieval_model,
                    attachment_ids=payload.attachment_ids,
                ),
            )
        except Exception as error:
            _raise_hit_testing_error(error)
        return dump_response(HitTestingResponse, result)
