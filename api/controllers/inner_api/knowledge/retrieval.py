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

from controllers.common.knowledge_retrieval_errors import KnowledgeRetrievalHttpError, knowledge_retrieval_errors
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.app.wraps import with_session
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import plugin_inner_api_only
from services.entities.knowledge_retrieval_inner import InnerKnowledgeRetrieveRequest, InnerKnowledgeRetrieveResponse
from services.knowledge_retrieval_inner_service import InnerKnowledgeRetrievalService

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
            raise KnowledgeRetrievalHttpError(
                error_code="invalid_request",
                description=str(exc),
                status_code=400,
            ) from exc

        with knowledge_retrieval_errors():
            response = InnerKnowledgeRetrievalService().retrieve(payload, session=session)

        return response.model_dump(mode="json", by_alias=True)
