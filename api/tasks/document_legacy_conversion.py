"""Compatibility boundary for deployed unversioned document-indexing messages."""

from collections.abc import Sequence

from core.db.session_factory import session_factory
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit


def convert_legacy_document_indexing_delivery(
    dataset_id: str,
    document_ids: Sequence[str],
    *,
    actor_id: str | None = None,
) -> bool:
    """Reconcile an old delivery with current locked state and durable work."""

    return SQLAlchemyDocumentRepository(
        session_factory=session_factory.get_session_maker(),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    ).convert_legacy_indexing_deliveries(dataset_id, document_ids, actor_id=actor_id)
