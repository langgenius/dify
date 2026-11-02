"""Detached selector records owned by knowledge persistence consumers."""

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class DatasetModelDependencyRecord:
    tenant_id: str
    dataset_id: str
    indexing_technique: str | None
    embedding_provider: str | None
    embedding_model: str | None
    retrieval: object = field(repr=False)
    external: bool = False
    summary: object = field(default=None, repr=False)
    has_qa_documents: bool = False


@dataclass(frozen=True, slots=True)
class PipelineModelDependencyRecord:
    tenant_id: str
    pipeline_id: str
    workflow_id: str
    graph: str = field(repr=False)
    features: str | None = field(repr=False)
