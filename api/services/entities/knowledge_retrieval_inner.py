"""DTOs for the inner knowledge retrieval API.

These models define the stable HTTP contract for trusted internal callers and
the response shape returned by the workflow knowledge retrieval stack.

Key cross-field invariants live here because callers cannot infer them from
scalar field types alone: ``dataset_ids`` must be non-empty, either ``query``
or ``attachment_ids`` is required, ``single`` retrieval requires both ``query``
and ``retrieval.model``, ``automatic`` metadata filtering requires
``model_config``, and ``manual`` metadata filtering requires conditions. The
response reuses workflow ``Source`` items plus serialized ``llm_usage``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from core.rag.data_post_processor.data_post_processor import WeightsDict
from core.rag.entities.metadata_entities import SupportedComparisonOperator
from core.workflow.nodes.knowledge_retrieval.retrieval import Source
from fields.base import ResponseModel

type JsonScalar = str | int | float | bool | None
type JsonValue = JsonScalar | list[JsonScalar] | dict[str, JsonScalar]
type MetadataValue = str | list[str] | int | float | None


class InnerKnowledgeRetrieveCaller(BaseModel):
    """Execution context provided by the trusted internal caller."""

    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    app_id: str = Field(min_length=1)
    user_from: Literal["account", "end-user"]
    invoke_from: str = Field(min_length=1)


class InnerKnowledgeRetrieveModelConfig(BaseModel):
    """Model configuration used by single-retrieval or metadata filtering."""

    model_config = ConfigDict(extra="forbid")

    provider: str = Field(min_length=1)
    name: str = Field(min_length=1)
    mode: str = Field(min_length=1)
    completion_params: dict[str, JsonValue] = Field(default_factory=dict)


class InnerKnowledgeRetrieveRerankingModelConfig(BaseModel):
    """Reranking model configuration for multiple retrieval mode."""

    model_config = ConfigDict(extra="forbid")

    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)


class InnerKnowledgeRetrieveRetrievalConfig(BaseModel):
    """Retrieval strategy and its mode-specific configuration."""

    model_config = ConfigDict(extra="forbid")

    mode: Literal["multiple", "single"]
    top_k: int | None = Field(default=None, ge=1)
    score_threshold: float = 0.0
    reranking_mode: str = "reranking_model"
    reranking_enable: bool = True
    reranking_model: InnerKnowledgeRetrieveRerankingModelConfig | None = None
    weights: WeightsDict | None = None
    model: InnerKnowledgeRetrieveModelConfig | None = None

    @model_validator(mode="after")
    def validate_mode_specific_fields(self) -> InnerKnowledgeRetrieveRetrievalConfig:
        if self.mode == "single" and self.model is None:
            raise ValueError("retrieval.model is required for single mode")
        if self.mode == "multiple" and self.top_k is None:
            raise ValueError("retrieval.top_k is required for multiple mode")
        return self


class InnerKnowledgeRetrieveMetadataCondition(BaseModel):
    """Single metadata filter condition."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    comparison_operator: SupportedComparisonOperator
    value: MetadataValue = None


class InnerKnowledgeRetrieveMetadataConditions(BaseModel):
    """Boolean composition for metadata filter conditions."""

    model_config = ConfigDict(extra="forbid")

    logical_operator: Literal["and", "or"] | None = "and"
    conditions: list[InnerKnowledgeRetrieveMetadataCondition] | None = None


class InnerKnowledgeRetrieveMetadataFilteringConfig(BaseModel):
    """Metadata filtering configuration forwarded to workflow retrieval.

    ``automatic`` mode requires ``model_config`` so downstream metadata model
    planning has the necessary LLM settings. ``manual`` mode requires
    non-empty conditions because workflow retrieval expects explicit filters
    instead of a bare mode switch.
    """

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    mode: Literal["disabled", "automatic", "manual"] = "disabled"
    metadata_model_config: InnerKnowledgeRetrieveModelConfig | None = Field(default=None, alias="model_config")
    conditions: InnerKnowledgeRetrieveMetadataConditions | None = None

    @model_validator(mode="after")
    def validate_mode_specific_fields(self) -> InnerKnowledgeRetrieveMetadataFilteringConfig:
        if self.mode == "automatic" and self.metadata_model_config is None:
            raise ValueError("metadata_filtering.model_config is required for automatic mode")
        if self.mode == "manual" and (self.conditions is None or not self.conditions.conditions):
            raise ValueError("metadata_filtering.conditions is required for manual mode")
        return self


class InnerKnowledgeRetrieveRequest(BaseModel):
    """Top-level request payload for the inner knowledge retrieval endpoint.

    Request validation enforces the endpoint's behavioral contract: callers
    must provide at least one dataset ID, at least one of ``query`` or
    ``attachment_ids``, and a text query for ``single`` retrieval mode.
    """

    model_config = ConfigDict(extra="forbid")

    caller: InnerKnowledgeRetrieveCaller
    dataset_ids: list[str]
    query: str | None = None
    retrieval: InnerKnowledgeRetrieveRetrievalConfig
    metadata_filtering: InnerKnowledgeRetrieveMetadataFilteringConfig = Field(
        default_factory=InnerKnowledgeRetrieveMetadataFilteringConfig
    )
    attachment_ids: list[str] = Field(default_factory=list)

    @field_validator("dataset_ids", "attachment_ids")
    @classmethod
    def validate_non_empty_items(cls, value: list[str]) -> list[str]:
        if any(not item.strip() for item in value):
            raise ValueError("list items must not be empty")
        return value

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_request(self) -> InnerKnowledgeRetrieveRequest:
        if not self.dataset_ids:
            raise ValueError("dataset_ids must contain at least one item")
        if not self.query and not self.attachment_ids:
            raise ValueError("query or attachment_ids is required")
        if self.retrieval.mode == "single" and not self.query:
            raise ValueError("query is required for single mode")
        return self


class InnerKnowledgeRetrieveUsage(ResponseModel):
    """Serialized LLM usage payload returned by dataset retrieval."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    prompt_unit_price: str
    completion_unit_price: str
    prompt_price_unit: str
    completion_price_unit: str
    prompt_price: str
    completion_price: str
    total_price: str
    currency: str | None = None
    latency: float | int


class InnerKnowledgeRetrieveResponse(ResponseModel):
    """Workflow-style retrieval results plus accumulated usage."""

    model_config = ConfigDict(
        from_attributes=True,
        extra="forbid",
        populate_by_name=True,
        serialize_by_alias=True,
        protected_namespaces=(),
    )

    results: list[Source]
    usage: InnerKnowledgeRetrieveUsage
