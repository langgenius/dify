from __future__ import annotations

from typing import Never
from uuid import UUID

from flask_restx import Resource
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

from controllers.common.knowledge_errors import KnowledgeIndexUnavailableError
from controllers.common.rbac import DatasetId, RBACCheck
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import DatasetNotInitializedError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, model_validate
from core.errors.error import KnowledgeIndexUnavailableError as IndexUnavailableError
from extensions.ext_application_services import application_services
from fields.hit_testing_fields import HitTestingPayload, HitTestingResponse
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


def _raise_hit_testing_error(error: Exception) -> Never:
    if isinstance(error, IndexUnavailableError):
        raise KnowledgeIndexUnavailableError(error.reason) from error
    if isinstance(error, DatasetNotFoundError):
        raise NotFound(str(error)) from error
    if isinstance(error, DatasetAccessDeniedError):
        raise Forbidden(str(error)) from error
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
        raise InternalServerError(str(error)) from error
    if isinstance(error, HitTestingFailedError):
        raise InternalServerError() from error
    raise error


register_schema_models(console_ns, HitTestingPayload)
register_response_schema_models(console_ns, HitTestingResponse)


@console_ns.route("/datasets/<uuid:dataset_id>/hit-testing")
class HitTestingApi(Resource):
    @error_responses(
        KnowledgeIndexUnavailableError,
        CompletionRequestError,
        ProviderModelCurrentlyNotSupportError,
        ProviderNotInitializeError,
        ProviderQuotaExceededError,
    )
    @console_ns.doc("test_dataset_retrieval")
    @console_ns.doc(description="Test dataset knowledge retrieval")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[HitTestingPayload.__name__])
    @console_ns.response(
        200,
        "Hit testing completed successfully",
        model=console_ns.models[HitTestingResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(400, "Invalid parameters")
    @console_account_admission(
        billing_rate_limit="knowledge",
        rbac_checks=(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()),),
    )
    @model_validate(HitTestingPayload)
    def post(
        self,
        payload: HitTestingPayload,
        request_context: RequestContext,
        dataset_id: UUID,
    ) -> dict[str, object]:
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
