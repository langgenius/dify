"""Plugin inner API endpoint for tenant-scoped knowledge retrieval.

This controller is a thin HTTP wrapper around
``services.knowledge_retrieval_inner_service.InnerKnowledgeRetrievalService``.
It uses the plugin inner API key because dify-agent calls this endpoint through
the same trusted Dify API bridge as other agent/plugin inner calls; tenant-scoped
app/dataset validation remains in the service layer.
"""

from flask_restx import Resource
from pydantic import ValidationError
from sqlalchemy.orm import Session

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.app.wraps import with_session
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import plugin_inner_api_only
from core.workflow.nodes.knowledge_retrieval import exc as retrieval_exc
from libs.exception import BaseHTTPException
from services.entities.knowledge_retrieval_inner import InnerKnowledgeRetrieveRequest, InnerKnowledgeRetrieveResponse
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError, InnerKnowledgeRetrievalServiceError
from services.knowledge_retrieval_inner_service import InnerKnowledgeRetrievalService


class InnerKnowledgeRetrievalHttpError(BaseHTTPException):
    error_code = "knowledge_retrieve_failed"
    description = "Knowledge retrieval failed."
    code = 500

    def __init__(
        self,
        *,
        error_code: str | None = None,
        description: str | None = None,
        status_code: int | None = None,
    ) -> None:
        if error_code is not None:
            self.error_code = error_code
        if description is not None:
            self.description = description
        if status_code is not None:
            self.code = status_code
        super().__init__(self.description)


register_schema_models(inner_api_ns, InnerKnowledgeRetrieveRequest)
register_response_schema_models(inner_api_ns, InnerKnowledgeRetrieveResponse)


@inner_api_ns.route("/knowledge/retrieve")
class InnerKnowledgeRetrieveApi(Resource):
    """Retrieve knowledge from one or more datasets within the caller tenant."""

    @plugin_inner_api_only
    @inner_api_ns.doc("inner_knowledge_retrieve")
    @inner_api_ns.doc(description="Retrieve knowledge for trusted internal callers")
    @inner_api_ns.expect(inner_api_ns.models[InnerKnowledgeRetrieveRequest.__name__])
    @inner_api_ns.response(
        200,
        "Knowledge retrieved successfully",
        inner_api_ns.models[InnerKnowledgeRetrieveResponse.__name__],
    )
    @inner_api_ns.doc(
        responses={
            400: "Invalid request body",
            403: "Caller tenant does not own the requested resource",
            404: "Invalid plugin inner API key, app not found, or dataset not found",
            422: "Invalid retrieval configuration",
            429: "Knowledge retrieval rate limited",
            502: "External knowledge retrieval failed",
            500: "Unexpected knowledge retrieval failure",
        }
    )
    @with_session
    def post(self, session: Session) -> dict[str, object]:
        """Validate the payload, run retrieval, and return workflow-style sources."""
        try:
            payload = InnerKnowledgeRetrieveRequest.model_validate(inner_api_ns.payload or {})
        except ValidationError as exc:
            raise InnerKnowledgeRetrievalHttpError(
                error_code="invalid_request",
                description=str(exc),
                status_code=400,
            ) from exc

        try:
            response = InnerKnowledgeRetrievalService().retrieve(payload, session=session)
        except InnerKnowledgeRetrievalServiceError as exc:
            raise InnerKnowledgeRetrievalHttpError(
                error_code=exc.error_code,
                description=exc.description,
                status_code=exc.status_code,
            ) from exc
        except retrieval_exc.RateLimitExceededError as exc:
            raise InnerKnowledgeRetrievalHttpError(
                error_code="knowledge_rate_limited",
                description=str(exc),
                status_code=429,
            ) from exc
        except ExternalKnowledgeRetrievalError as exc:
            raise InnerKnowledgeRetrievalHttpError(
                error_code="external_knowledge_failed",
                description=str(exc),
                status_code=502,
            ) from exc
        except ValueError as exc:
            raise InnerKnowledgeRetrievalHttpError(
                error_code="retrieval_config_invalid",
                description=str(exc),
                status_code=422,
            ) from exc

        return response.model_dump(mode="json", by_alias=True)
