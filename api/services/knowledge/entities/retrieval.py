"""Knowledge query inputs and sources shared by retrieval callers."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, TypedDict

from pydantic import BaseModel, Field, JsonValue

from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.nodes.llm.entities import ModelConfig
from services.knowledge.entities.metadata import MetadataFilteringCondition
from services.knowledge.entities.retrieval_settings import RerankingModelDict, WeightsDict


class AttachmentInfoDict(TypedDict):
    """Published attachment metadata; MIME type may be null for legacy uploads."""

    id: str
    name: str
    extension: str
    mime_type: str | None
    source_url: str
    size: int


@dataclass(frozen=True, slots=True)
class RetrievableDataset:
    """An available dataset's public description, independent of its retrieval configuration."""

    dataset_id: str
    name: str
    description: str | None


class SourceChildChunk(BaseModel):
    id: str = Field(default="", description="Child chunk ID")
    content: str = Field(default="", description="Child chunk content")
    position: int = Field(default=0, description="Child chunk position")
    score: float = Field(default=0.0, description="Child chunk relevance score")


class SourceMetadata(BaseModel):
    source: str = Field(
        default="knowledge",
        serialization_alias="_source",
        description="Data source identifier",
    )
    dataset_id: str = Field(description="Dataset unique identifier")
    dataset_name: str = Field(description="Dataset display name")
    document_id: str = Field(description="Document unique identifier")
    document_name: str = Field(description="Document display name")
    data_source_type: str = Field(description="Type of data source")
    segment_id: str | None = Field(default=None, description="Segment unique identifier")
    retriever_from: str = Field(default="workflow", description="Retriever source context")
    score: float = Field(default=0.0, description="Retrieval relevance score")
    child_chunks: list[SourceChildChunk] = Field(default_factory=list, description="List of child chunks")
    segment_hit_count: int | None = Field(default=0, description="Number of times segment was retrieved")
    segment_word_count: int | None = Field(default=0, description="Word count of the segment")
    segment_position: int | None = Field(default=0, description="Position of segment in document")
    segment_index_node_hash: str | None = Field(default=None, description="Hash of index node for the segment")
    doc_metadata: dict[str, JsonValue] | None = Field(default=None, description="Additional document metadata")
    position: int | None = Field(default=0, description="Position of the document in the dataset")

    class Config:
        populate_by_name = True


class Source(BaseModel):
    metadata: SourceMetadata = Field(description="Source metadata information")
    title: str = Field(description="Document title")
    files: list[AttachmentInfoDict] | None = Field(default=None, description="Associated file references")
    content: str | None = Field(description="Segment content text")
    summary: str | None = Field(default=None, description="Content summary if available")


@dataclass(frozen=True, slots=True)
class RetrievedAttachment:
    """An authorized attachment snapshot for internal model input construction.

    The extension has no leading dot. ``mime_type`` is ``None`` when the stored
    upload has no recorded media type. ``source_url`` is the original remote
    URL; ``preview_url`` is the signed URL prepared for the selected result.
    """

    id: str
    name: str
    extension: str
    mime_type: str | None
    source_url: str
    size: int
    storage_key: str
    preview_url: str


@dataclass(frozen=True, slots=True)
class RetrievedTraceDocument:
    """Final query evidence independent of the application's trace backend."""

    page_content: str
    provider: str | None
    metadata: Mapping[str, JsonValue]


@dataclass(frozen=True, slots=True)
class KnowledgeRetrievalTrace:
    documents: tuple[RetrievedTraceDocument, ...]
    timer: Mapping[str, datetime | None]


@dataclass(frozen=True, slots=True)
class KnowledgeRetrievalResult:
    """Final sources, prompt context, and evidence produced by one query.

    Empty results have no attachments or trace. Attachments carry internal
    storage identities and are exposed to models only by the application
    adapter; public responses serialize ``sources`` instead of this result.
    """

    sources: list[Source]
    usage: LLMUsage
    context: str = ""
    attachments: tuple[RetrievedAttachment, ...] = ()
    trace: KnowledgeRetrievalTrace | None = None


class KnowledgeRetrievalRequest(BaseModel):
    tenant_id: str = Field(description="Tenant unique identifier")
    user_id: str = Field(description="User unique identifier")
    app_id: str = Field(description="Application unique identifier")
    user_from: str = Field(description="User identity source for audit logging (e.g., 'account', 'end-user')")
    dataset_ids: list[str] = Field(description="List of dataset IDs to retrieve from")
    query: str | None = Field(default=None, description="Query text for knowledge retrieval")
    retrieval_mode: Literal["single", "multiple", "direct"] = Field(
        description="Single routes with a model; multiple queries datasets together; direct queries one dataset."
    )
    routing_strategy: Literal["react", "auto"] = Field(
        default="react", description="Single-mode routing policy; auto chooses from the model's supported capabilities."
    )
    model_provider: str | None = Field(default=None, description="Model provider name (e.g., 'openai', 'anthropic')")
    completion_params: dict[str, JsonValue] | None = Field(
        default=None, description="Model completion parameters (e.g., temperature, max_tokens)"
    )
    model_mode: str | None = Field(default=None, description="Model mode (e.g., 'chat', 'completion')")
    model_name: str | None = Field(default=None, description="Model name (e.g., 'gpt-4', 'claude-3-opus')")
    metadata_model_config: ModelConfig | None = Field(
        default=None, description="Model config for metadata-based filtering"
    )
    metadata_filtering_conditions: MetadataFilteringCondition | None = Field(
        default=None, description="Conditions for filtering by metadata"
    )
    metadata_filtering_mode: Literal["disabled", "automatic", "manual"] = Field(
        default="disabled", description="Metadata filtering mode: 'disabled', 'automatic', or 'manual'"
    )
    top_k: int = Field(default=0, description="Number of top results to return")
    score_threshold: float = Field(default=0.0, description="Minimum relevance score threshold")
    reranking_mode: str = Field(default="reranking_model", description="Reranking strategy")
    reranking_model: RerankingModelDict | None = Field(default=None, description="Reranking model configuration")
    weights: WeightsDict | None = Field(default=None, description="Weights for weighted score reranking")
    reranking_enable: bool = Field(default=True, description="Whether reranking is enabled")
    attachment_ids: list[str] | None = Field(default=None, description="List of attachment file IDs for retrieval")
    metadata_inputs: dict[str, str] = Field(
        default_factory=dict, description="Values used in metadata filter templates"
    )
    retriever_from: str = Field(default="workflow", description="Caller context recorded in source citations")
