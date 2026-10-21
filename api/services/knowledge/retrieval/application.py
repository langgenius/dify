"""Trusted inner retrieval: validate caller ownership, then invoke the retrieval port.

Dataset API visibility and user permissions are outside this trusted bridge's
policy. Availability and no-usable-document cases belong to the retrieval
runtime and may return an empty result.
"""

from typing import Protocol

from machinery.context import RequestContext
from services.knowledge.entities.inner_retrieval import InnerKnowledgeRetrieveRequest, InnerKnowledgeRetrieveResult


class InnerKnowledgeRetrievalScope(Protocol):
    def validate_inner_retrieval_scope(self, *, tenant_id: str, app_id: str, dataset_ids: list[str]) -> None:
        """Validate ownership and release the read session before returning."""
        ...


class InnerKnowledgeRetrieval(Protocol):
    def retrieve(
        self, context: RequestContext, request: InnerKnowledgeRetrieveRequest
    ) -> InnerKnowledgeRetrieveResult: ...


class InnerKnowledgeRetrievalService:
    def __init__(self, *, scope: InnerKnowledgeRetrievalScope, retrieval: InnerKnowledgeRetrieval) -> None:
        self._scope = scope
        self._retrieval = retrieval

    def retrieve(self, context: RequestContext, request: InnerKnowledgeRetrieveRequest) -> InnerKnowledgeRetrieveResult:
        self._scope.validate_inner_retrieval_scope(
            tenant_id=request.caller.tenant_id, app_id=request.caller.app_id, dataset_ids=request.dataset_ids
        )
        return self._retrieval.retrieve(context, request)
