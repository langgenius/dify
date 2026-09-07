"""Compose lazy KnowledgeFS ports so unused graph branches need no integration config."""

from core.app.entities.app_invoke_entities import DifyRunContext
from core.db.session_factory import session_factory
from core.knowledge_fs.resource import KnowledgeResourceRef
from core.knowledge_fs.retrieval_contracts import (
    KnowledgeFSAppBindingPayload,
    KnowledgeFSMetadataFieldListResponse,
    KnowledgeFSRetrievalTestPayload,
    KnowledgeFSRetrievalTestResponse,
)
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs.product_dto import KnowledgeFSAppBindingResponse
from services.knowledge_fs.query_images import issue_workflow_query_image_reference
from services.knowledge_fs.runtime import get_knowledge_fs_runtime
from tasks.knowledge_fs_failed_retrieval_tasks import enqueue_workflow_failed_retrieval_capture


class _LazyWorkflowCapabilities:
    """Resolve the cached runtime only when an executing node calls a capability."""

    def run_retrieval(
        self,
        *,
        run_context: DifyRunContext,
        caller_kind: KnowledgeFSAppSpaceJoinType,
        resource: KnowledgeResourceRef,
        payload: KnowledgeFSRetrievalTestPayload,
    ) -> KnowledgeFSRetrievalTestResponse:
        return get_knowledge_fs_runtime(session_factory.get_session_maker()).app_capabilities.run_retrieval(
            run_context=run_context, caller_kind=caller_kind, resource=resource, payload=payload
        )

    def list_metadata_fields(
        self,
        *,
        run_context: DifyRunContext,
        caller_kind: KnowledgeFSAppSpaceJoinType,
        resource: KnowledgeResourceRef,
        cursor: str | None = None,
        limit: int = 100,
    ) -> KnowledgeFSMetadataFieldListResponse:
        return get_knowledge_fs_runtime(session_factory.get_session_maker()).app_capabilities.list_metadata_fields(
            run_context=run_context, caller_kind=caller_kind, resource=resource, cursor=cursor, limit=limit
        )

    def upsert(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        payload: KnowledgeFSAppBindingPayload,
    ) -> KnowledgeFSAppBindingResponse:
        return get_knowledge_fs_runtime(session_factory.get_session_maker()).app_bindings.upsert(
            tenant_id=tenant_id, actor_account_id=actor_account_id, control_space_id=control_space_id, payload=payload
        )


def build_knowledge_fs_node_dependencies() -> dict[str, object]:
    capabilities = _LazyWorkflowCapabilities()
    return {
        "capability_service": capabilities,
        "binding_service": capabilities,
        "query_image_issuer": issue_workflow_query_image_reference,
        "failed_retrieval_dispatcher": enqueue_workflow_failed_retrieval_capture,
    }
