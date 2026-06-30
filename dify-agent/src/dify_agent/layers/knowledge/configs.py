"""Client-safe DTOs for the Dify knowledge-base Agenton layer.

The public layer config exposes only static retrieval controls: dataset ids,
retrieval strategy, metadata filtering, and observation-size limits. The agent
model itself should only ever see a single ``query`` tool argument; tenant/
app/user context comes from the execution-context layer and the actual
retrieval is delegated to the Dify API inner endpoint. Tool naming is not
caller-configurable: the runtime always exposes the same stable knowledge-base
search tool.
"""

from __future__ import annotations

from typing import ClassVar, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

from agenton.layers import LayerConfig

type DifyKnowledgeMetadataComparisonOperator = Literal[
    "contains",
    "not contains",
    "start with",
    "end with",
    "is",
    "is not",
    "empty",
    "not empty",
    "in",
    "not in",
    "=",
    "≠",
    ">",
    "<",
    "≥",
    "≤",
    "before",
    "after",
]

DIFY_KNOWLEDGE_BASE_LAYER_TYPE_ID: Final[str] = "dify.knowledge_base"


class DifyKnowledgeModelConfig(BaseModel):
    """Static model configuration forwarded to the inner retrieval API."""

    provider: str
    name: str
    mode: str
    completion_params: dict[str, JsonValue] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyKnowledgeRerankingModelConfig(BaseModel):
    """Reranking model settings for multiple-mode retrieval."""

    provider: str
    model: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyKnowledgeRetrievalConfig(BaseModel):
    """Static retrieval controls mirrored into the inner API request."""

    mode: Literal["multiple", "single"]
    top_k: int | None = Field(default=None, ge=1)
    score_threshold: float = 0.0
    reranking_mode: str = "reranking_model"
    reranking_enable: bool = True
    reranking_model: DifyKnowledgeRerankingModelConfig | None = None
    weights: dict[str, JsonValue] | None = None
    model: DifyKnowledgeModelConfig | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_mode_specific_fields(self) -> DifyKnowledgeRetrievalConfig:
        if self.mode == "multiple" and self.top_k is None:
            raise ValueError("retrieval.top_k is required for multiple mode")
        if self.mode == "single" and self.model is None:
            raise ValueError("retrieval.model is required for single mode")
        return self

    def to_request_payload(self) -> dict[str, JsonValue]:
        """Serialize the retrieval config into the inner API request shape."""
        payload: dict[str, JsonValue] = {
            "mode": self.mode,
            "score_threshold": self.score_threshold,
            "reranking_mode": self.reranking_mode,
            "reranking_enable": self.reranking_enable,
        }
        if self.mode == "multiple":
            payload["top_k"] = self.top_k
            payload["reranking_model"] = (
                self.reranking_model.model_dump(mode="json") if self.reranking_model is not None else None
            )
            payload["weights"] = self.weights
        else:
            payload["model"] = self.model.model_dump(mode="json") if self.model is not None else None
        return payload


class DifyKnowledgeMetadataCondition(BaseModel):
    """One manual metadata filter clause."""

    name: str
    comparison_operator: DifyKnowledgeMetadataComparisonOperator
    value: str | list[str] | int | float | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyKnowledgeMetadataConditions(BaseModel):
    """Boolean composition for manual metadata filtering."""

    logical_operator: Literal["and", "or"] = "and"
    conditions: list[DifyKnowledgeMetadataCondition]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyKnowledgeMetadataFilteringConfig(BaseModel):
    """Static metadata filtering controls for the inner API request."""

    mode: Literal["disabled", "automatic", "manual"] = "disabled"
    metadata_model_config: DifyKnowledgeModelConfig | None = Field(default=None, alias="model_config")
    conditions: DifyKnowledgeMetadataConditions | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def validate_mode_specific_fields(self) -> DifyKnowledgeMetadataFilteringConfig:
        if self.mode == "automatic" and self.metadata_model_config is None:
            raise ValueError("metadata_filtering.model_config is required for automatic mode")
        if self.mode == "manual" and (self.conditions is None or not self.conditions.conditions):
            raise ValueError("metadata_filtering.conditions is required for manual mode")
        return self

    def to_request_payload(self) -> dict[str, JsonValue]:
        """Serialize metadata filtering using the inner API request field names."""
        if self.mode == "disabled":
            return {"mode": self.mode}

        payload: dict[str, JsonValue] = {"mode": self.mode}
        if self.metadata_model_config is not None:
            payload["model_config"] = self.metadata_model_config.model_dump(mode="json")
        if self.conditions is not None:
            payload["conditions"] = self.conditions.model_dump(mode="json")
        return payload


class DifyKnowledgeBaseLayerConfig(LayerConfig):
    """Public config for one model-visible knowledge search tool.

    The model only gets to choose whether to call the tool and what ``query``
    to send. Dataset ids, retrieval settings, metadata filtering, and caller
    context remain config/runtime concerns outside the model-visible tool
    schema. The tool name and description are fixed by the layer runtime and do
    not appear in the public config DTO.
    """

    dataset_ids: list[str]
    retrieval: DifyKnowledgeRetrievalConfig
    metadata_filtering: DifyKnowledgeMetadataFilteringConfig = Field(
        default_factory=DifyKnowledgeMetadataFilteringConfig
    )
    max_result_content_chars: int = Field(default=2000, ge=1)
    max_observation_chars: int = Field(default=12000, ge=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @field_validator("dataset_ids")
    @classmethod
    def validate_dataset_ids(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("dataset_ids must contain at least one item")
        normalized_ids = [item.strip() for item in value]
        if any(not item for item in normalized_ids):
            raise ValueError("dataset_ids must not contain blank items")
        return normalized_ids

    @model_validator(mode="after")
    def validate_observation_limits(self) -> DifyKnowledgeBaseLayerConfig:
        if self.max_observation_chars < self.max_result_content_chars:
            raise ValueError("max_observation_chars must be greater than or equal to max_result_content_chars")
        return self


__all__ = [
    "DIFY_KNOWLEDGE_BASE_LAYER_TYPE_ID",
    "DifyKnowledgeBaseLayerConfig",
    "DifyKnowledgeMetadataCondition",
    "DifyKnowledgeMetadataConditions",
    "DifyKnowledgeMetadataFilteringConfig",
    "DifyKnowledgeModelConfig",
    "DifyKnowledgeRerankingModelConfig",
    "DifyKnowledgeRetrievalConfig",
]
