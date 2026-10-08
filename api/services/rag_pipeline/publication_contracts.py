"""Stored inputs and prepared changes for an atomic Pipeline publication."""

from dataclasses import dataclass
from typing import Any, Literal

from services.workflow.contracts import WorkflowSnapshot


@dataclass(frozen=True)
class EmbeddingModel:
    provider: str
    name: str
    is_multimodal: bool


@dataclass(frozen=True)
class PipelineDatasetState:
    id: str
    chunk_structure: str | None
    indexing_technique: str | None
    embedding_model_provider: str | None
    embedding_model: str | None
    is_multimodal: bool
    keyword_number: int | None
    retrieval_model: dict[str, Any] | None
    summary_index_setting: dict[str, Any] | None
    collection_binding_id: str | None


@dataclass(frozen=True)
class PipelinePublicationState:
    draft: WorkflowSnapshot
    is_published: bool
    workflow_id: str | None
    dataset: PipelineDatasetState | None


@dataclass(frozen=True)
class PreparedPipelineDataset:
    state: PipelineDatasetState
    embedding: EmbeddingModel | None
    index_actions: tuple[Literal["add", "update"], ...]
