from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from core.model_runtime.entities import LLMUsage
from core.workflow.nodes.knowledge_retrieval.entities import MetadataFilteringCondition
from core.workflow.nodes.llm.entities import ModelConfig


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
    child_chunks: list[SourceChildChunk] = Field(default=[], description="List of child chunks")
    segment_hit_count: int | None = Field(default=0, description="Number of times segment was retrieved")
    segment_word_count: int | None = Field(default=0, description="Word count of the segment")
    segment_position: int | None = Field(default=0, description="Position of segment in document")
    segment_index_node_hash: str | None = Field(default=None, description="Hash of index node for the segment")
    doc_metadata: dict[str, Any] | None = Field(default=None, description="Additional document metadata")
    position: int | None = Field(default=0, description="Position of the document in the dataset")

    class Config:
        populate_by_name = True


class Source(BaseModel):
    metadata: SourceMetadata = Field(description="Source metadata information")
    title: str = Field(description="Document title")
    files: list[Any] | None = Field(default=None, description="Associated file references")
    content: str | None = Field(description="Segment content text")
    summary: str | None = Field(default=None, description="Content summary if available")


class KnowledgeRetrievalRequest(BaseModel):
    tenant_id: str = Field(description="Tenant unique identifier")
    user_id: str = Field(description="User unique identifier")
    app_id: str = Field(description="Application unique identifier")
    user_from: str = Field(description="Source of the user request (e.g., 'workflow', 'api')")
    dataset_ids: list[str] = Field(description="List of dataset IDs to retrieve from")
    query: str | None = Field(default=None, description="Query text for knowledge retrieval")
    retrieval_mode: str = Field(description="Retrieval strategy: 'single' or 'multiple'")
    model_provider: str | None = Field(default=None, description="Model provider name (e.g., 'openai', 'anthropic')")
    completion_params: dict[str, Any] | None = Field(
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
    reranking_model: dict | None = Field(default=None, description="Reranking model configuration")
    weights: dict[str, Any] | None = Field(default=None, description="Weights for weighted score reranking")
    reranking_enable: bool = Field(default=True, description="Whether reranking is enabled")
    attachment_ids: list[str] | None = Field(default=None, description="List of attachment file IDs for retrieval")


class RAGRetrievalProtocol(Protocol):
    """Protocol for RAG-based knowledge retrieval implementations.

    Implementations of this protocol handle knowledge retrieval from datasets
    including rate limiting, dataset filtering, and document retrieval.
    """

    @property
    def llm_usage(self) -> LLMUsage:
        """Return accumulated LLM usage for retrieval operations."""
        ...

    def knowledge_retrieval(self, request: KnowledgeRetrievalRequest) -> list[Source]:
        """Retrieve knowledge from datasets based on the provided request.

        Args:
            request: Knowledge retrieval request with search parameters

        Returns:
            List of sources matching the search criteria

        Raises:
            RateLimitExceededError: If rate limit is exceeded
            ModelNotExistError: If specified model doesn't exist
        """
        ...
