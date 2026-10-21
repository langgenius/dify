"""Materialized readiness checks for retrieval against the current vector target."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.errors.error import KnowledgeIndexUnavailableError
from models.dataset import Dataset
from repositories.knowledge.task_state_repository import get_current_dataset_vector_rows


@dataclass(frozen=True)
class DatasetRetrievalTarget:
    tenant_id: str
    dataset_id: str
    indexing_technique: str | None
    embedding_provider: str | None
    embedding_model: str | None
    collection_binding_id: str | None
    intent_id: str | None


def get_dataset_retrieval_target(session: Session, dataset: Dataset) -> DatasetRetrievalTarget:
    """Reject unfinished add/update intents, leaving legacy and economy reads usable.

    The opaque identity is compared after provider I/O using a fresh transaction.
    A target rebuilt and completed during a read still invalidates that read.
    Historical remove/cleanup intents cannot block the current target.
    """
    intent_id = None
    if dataset.provider != "external" and dataset.indexing_technique == "high_quality":
        states = get_current_dataset_vector_rows(
            session,
            tenant_id=dataset.tenant_id,
            expected_payload_by_resource={
                dataset.id: {
                    "expected_indexing_technique": str(dataset.indexing_technique),
                    "expected_embedding_model_provider": dataset.embedding_model_provider,
                    "expected_embedding_model": dataset.embedding_model,
                }
            },
        )
        state = states.get(dataset.id)
        if state is not None and state.payload.get("action") != "remove":
            intent_id = state.id
            if state.status == "failed":
                raise KnowledgeIndexUnavailableError("failed")
            if state.status != "completed":
                raise KnowledgeIndexUnavailableError("indexing")
    return DatasetRetrievalTarget(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        indexing_technique=dataset.indexing_technique,
        embedding_provider=dataset.embedding_model_provider,
        embedding_model=dataset.embedding_model,
        collection_binding_id=dataset.collection_binding_id,
        intent_id=intent_id,
    )


def verify_dataset_retrieval_target(session: Session, target: DatasetRetrievalTarget) -> None:
    dataset = session.scalar(
        select(Dataset).where(Dataset.id == target.dataset_id, Dataset.tenant_id == target.tenant_id)
    )
    if dataset is None or get_dataset_retrieval_target(session, dataset) != target:
        raise KnowledgeIndexUnavailableError("indexing")
