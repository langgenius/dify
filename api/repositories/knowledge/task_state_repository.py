"""Current task reads shared by persistence and the retrieval execution boundary.

This reader has no application imports, so retrieval can inspect durable state
without depending on the task dispatcher or its service contracts.
"""

from collections.abc import Mapping

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from models.knowledge_task import KnowledgeTaskOutbox


def get_current_document_index_state_rows(
    session: Session,
    *,
    tenant_id: str,
    dataset_id: str,
    document_generations: Mapping[str, str],
) -> dict[str, KnowledgeTaskOutbox]:
    """Read exact-generation desired-state tasks without application dependencies."""
    if not document_generations:
        return {}
    matches = or_(
        *(
            and_(
                KnowledgeTaskOutbox.resource_id == document_id,
                KnowledgeTaskOutbox.payload["generation"].as_string() == generation,
            )
            for document_id, generation in document_generations.items()
        )
    )
    rows = session.scalars(
        select(KnowledgeTaskOutbox).where(
            KnowledgeTaskOutbox.tenant_id == tenant_id,
            KnowledgeTaskOutbox.dataset_id == dataset_id,
            KnowledgeTaskOutbox.task_kind == "document_index_state",
            KnowledgeTaskOutbox.resource_id.in_(document_generations),
            KnowledgeTaskOutbox.payload["action"].as_string().in_(("add", "remove")),
            KnowledgeTaskOutbox.payload["superseded"].as_boolean().is_not(True),
            KnowledgeTaskOutbox.status.in_(("failed", "pending", "processing", "dispatched", "executing", "completed")),
            matches,
        )
    ).all()
    priority = {"failed": 3, "pending": 2, "processing": 2, "dispatched": 2, "executing": 2, "completed": 1}
    result: dict[str, KnowledgeTaskOutbox] = {}
    for row in rows:
        document_id = row.resource_id
        if document_id is None:
            continue
        previous = result.get(document_id)
        if previous is None or (-priority[row.status], row.last_error or "", row.id) < (
            -priority[previous.status],
            previous.last_error or "",
            previous.id,
        ):
            result[document_id] = row
    return result


def get_current_dataset_vector_rows(
    session: Session,
    *,
    tenant_id: str,
    expected_payload_by_resource: Mapping[str, Mapping[str, object]],
    for_update: bool = False,
) -> dict[str, KnowledgeTaskOutbox]:
    """Load explicitly current rows in the caller's bounded persistence session."""
    dataset_ids = tuple(dict.fromkeys(expected_payload_by_resource))
    if not dataset_ids:
        return {}
    statement = select(KnowledgeTaskOutbox).where(
        KnowledgeTaskOutbox.tenant_id == tenant_id,
        KnowledgeTaskOutbox.dataset_id.in_(dataset_ids),
        KnowledgeTaskOutbox.resource_id == KnowledgeTaskOutbox.dataset_id,
        KnowledgeTaskOutbox.task_kind == "dataset_vector_index_update",
        KnowledgeTaskOutbox.payload["superseded"].as_boolean().is_(False),
    )
    if for_update:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    rows = session.scalars(statement).all()
    current: dict[str, KnowledgeTaskOutbox] = {}
    for row in rows:
        if row.resource_id is not None:
            if row.resource_id in current:
                raise RuntimeError(f"Multiple current dataset vector intents found for {row.resource_id}")
            current[row.resource_id] = row
    return {
        resource_id: row
        for resource_id, row in current.items()
        if all(row.payload.get(key) == value for key, value in expected_payload_by_resource[resource_id].items())
    }
