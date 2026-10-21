"""Conservative document repair when a durable execution lease expires."""

from collections.abc import Sequence

from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease


def repair_recovered_document_execution(
    execution: KnowledgeTaskExecutionLease,
    *,
    documents: SQLAlchemyDocumentRepository,
    ref: DatasetRef,
    document_ids: Sequence[str],
    actor_id: str | None = None,
) -> bool:
    """Fence uncertain external work by persisting repair for current desired state."""

    if not execution.recovered_execution:
        return False
    documents.enqueue_current_indexing_repairs(ref, document_ids, actor_id=actor_id)
    return True
