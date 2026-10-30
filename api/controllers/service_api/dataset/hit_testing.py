from typing import Never
from uuid import UUID

from controllers.common.errors import (
    ForbiddenError,
    InternalServerError,
    InvalidArgumentError,
    NotFoundError,
    ServiceUnavailableError,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.service_api.dataset.error import DatasetNotInitializedError
from controllers.service_api.flask_admission import DatasetApiResource, dataset_admission
from extensions.ext_application_services import application_services
from fields.hit_testing_fields import HitTestingPayload, HitTestingResponse
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from services.errors.index import IndexNotInitializedError
from services.errors.knowledge_retrieval import KnowledgeRetrievalUnavailableError
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.hit_testing.entities import HitTestingRequest
from services.knowledge.hit_testing.errors import (
    HitTestingFailedError,
    HitTestingInvocationError,
    HitTestingProviderError,
    HitTestingUnsupportedInputError,
    HitTestingUpstreamError,
)

_KNOWLEDGE_INDEX_UNAVAILABLE_MESSAGE = "The knowledge index is temporarily unavailable. Please retry later."

register_schema_models(service_api_ns, HitTestingPayload)
register_response_schema_models(service_api_ns, HitTestingResponse)


def _raise_hit_testing_error(error: Exception) -> Never:
    if isinstance(error, KnowledgeRetrievalUnavailableError):
        raise ServiceUnavailableError(description=_KNOWLEDGE_INDEX_UNAVAILABLE_MESSAGE) from error
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
    if isinstance(error, HitTestingUnsupportedInputError):
        raise InvalidArgumentError(description=str(error)) from error
    if isinstance(error, (HitTestingUpstreamError, HitTestingFailedError)):
        raise InternalServerError() from error
    raise error


@service_api_ns.route(
    "/datasets/<uuid:dataset_id>/hit-testing",
    doc={"post": {"deprecated": True}},
)
@service_api_ns.route("/datasets/<uuid:dataset_id>/retrieve")
class HitTestingApi(DatasetApiResource):
    @error_responses(
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
            503: "`service_unavailable` : The knowledge index is temporarily unavailable. Retry later.",
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
                    external_retrieval_model=(
                        payload.external_retrieval_model.to_domain()
                        if payload.external_retrieval_model is not None
                        else None
                    ),
                    attachment_ids=payload.attachment_ids,
                ),
            )
        except Exception as error:
            _raise_hit_testing_error(error)
        return dump_response(HitTestingResponse, result)
