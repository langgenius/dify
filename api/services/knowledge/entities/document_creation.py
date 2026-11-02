"""Owned values passed between document creation's database and I/O phases."""

from dataclasses import dataclass

from services.knowledge.resource_scope import DatasetRef


@dataclass(frozen=True)
class DocumentCreationDataset:
    tenant_id: str
    indexing_technique: str | None
    embedding_model: str | None
    embedding_model_provider: str | None


@dataclass(frozen=True)
class DocumentIndexingJobs:
    dataset: DatasetRef
    created: tuple[str, ...] = ()
    duplicated: tuple[str, ...] = ()
    removed_notion: tuple[str, ...] = ()
    updated: str | None = None
