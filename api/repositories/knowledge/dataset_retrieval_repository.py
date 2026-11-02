"""Materialized readiness checks for retrieval against the current vector target."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.dataset import Dataset
from services.errors.knowledge_retrieval import KnowledgeRetrievalUnavailableError


@dataclass(frozen=True)
class DatasetRetrievalTarget:
    tenant_id: str
    dataset_id: str
    indexing_technique: str | None
    embedding_provider: str | None
    embedding_model: str | None
    collection_binding_id: str | None


def get_dataset_retrieval_target(dataset: Dataset) -> DatasetRetrievalTarget:
    """Capture the current provider-facing dataset configuration."""
    return DatasetRetrievalTarget(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        indexing_technique=dataset.indexing_technique,
        embedding_provider=dataset.embedding_model_provider,
        embedding_model=dataset.embedding_model,
        collection_binding_id=dataset.collection_binding_id,
    )


def verify_dataset_retrieval_target(session: Session, target: DatasetRetrievalTarget) -> None:
    dataset = session.scalar(
        select(Dataset).where(Dataset.id == target.dataset_id, Dataset.tenant_id == target.tenant_id)
    )
    if dataset is None or get_dataset_retrieval_target(dataset) != target:
        raise KnowledgeRetrievalUnavailableError("indexing")
