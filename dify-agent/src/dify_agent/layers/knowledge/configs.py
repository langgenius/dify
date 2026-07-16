"""Client-safe DTOs for the Dify knowledge-base Agenton layer.

The public layer config carries one or more named knowledge sets. Each set owns
its dataset ids plus query, retrieval, and metadata-filtering policy. Generated-
query sets are exposed through one stable model-visible search tool whose
schema lets the model pick ``set_name`` and ``query``; user-query sets are
retrieved eagerly when the layer enters a run and their formatted observations
plus application-only retriever resources are kept in JSON-safe
``runtime_state`` for session snapshots.
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


class DifyKnowledgeDatasetConfig(BaseModel):
    """One dataset selected by a knowledge set.

    Only ``id`` is used for retrieval. ``name`` and ``description`` are retained
    because callers already have them and they are useful in runtime/debug
    snapshots without changing the inner retrieval request contract.
    """

    id: str
    name: str | None = None
    description: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("dataset id must not be blank")
        return normalized


class DifyKnowledgeQueryConfig(BaseModel):
    """Query policy for one knowledge set."""

    mode: Literal["user_query", "generated_query"]
    value: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_mode_specific_fields(self) -> DifyKnowledgeQueryConfig:
        if self.mode == "user_query" and not (self.value or "").strip():
            raise ValueError("query.value is required for user_query mode")
        return self


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


class DifyKnowledgeSetConfig(BaseModel):
    """One independently searchable or eagerly-preloaded knowledge set."""

    id: str
    name: str
    description: str | None = None
    datasets: list[DifyKnowledgeDatasetConfig]
    query: DifyKnowledgeQueryConfig
    retrieval: DifyKnowledgeRetrievalConfig
    metadata_filtering: DifyKnowledgeMetadataFilteringConfig = Field(
        default_factory=DifyKnowledgeMetadataFilteringConfig
    )

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @field_validator("id", "name")
    @classmethod
    def validate_non_blank_identity(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("knowledge set id and name must not be blank")
        return normalized

    @model_validator(mode="after")
    def validate_dataset_ids(self) -> DifyKnowledgeSetConfig:
        if not self.datasets:
            raise ValueError("knowledge set requires at least one dataset")
        dataset_ids = [dataset.id for dataset in self.datasets]
        if len(dataset_ids) != len(set(dataset_ids)):
            raise ValueError("knowledge set dataset ids must be unique")
        return self

    @property
    def dataset_ids(self) -> list[str]:
        """Return the selected dataset ids for the inner retrieval request."""
        return [dataset.id for dataset in self.datasets]


class DifyKnowledgeEagerResult(BaseModel):
    """JSON-safe eager user-query result stored in layer runtime state.

    ``retriever_resources`` preserves application-only citation metadata for
    API consumers. The model still receives only the formatted ``observation``.
    """

    set_id: str
    set_name: str
    query: str
    observation: str
    status: Literal["success", "empty", "temporarily_unavailable"]
    retriever_resources: list[dict[str, JsonValue]] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyKnowledgeRuntimeState(BaseModel):
    """Serializable eager-retrieval state stored in Agenton session snapshots."""

    eager_config_fingerprint: str | None = None
    eager_results: list[DifyKnowledgeEagerResult] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", validate_assignment=True)


class DifyKnowledgeBaseLayerConfig(LayerConfig):
    """Public config for one knowledge-base layer.

    The model-visible surface stays fixed to ``knowledge_base_search``. Set
    names are the only model-visible selection labels; dataset ids, retrieval
    controls, metadata filtering, and caller identity remain config/runtime
    concerns outside the tool schema.
    """

    sets: list[DifyKnowledgeSetConfig]
    max_result_content_chars: int = Field(default=2000, ge=1)
    max_observation_chars: int = Field(default=12000, ge=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_sets_and_observation_limits(self) -> DifyKnowledgeBaseLayerConfig:
        if not self.sets:
            raise ValueError("sets must contain at least one knowledge set")
        set_ids = [knowledge_set.id for knowledge_set in self.sets]
        if len(set_ids) != len(set(set_ids)):
            raise ValueError("knowledge set ids must be unique")
        normalized_names = [knowledge_set.name.strip().lower() for knowledge_set in self.sets]
        if len(normalized_names) != len(set(normalized_names)):
            raise ValueError("knowledge set names must be unique")
        if self.max_observation_chars < self.max_result_content_chars:
            raise ValueError("max_observation_chars must be greater than or equal to max_result_content_chars")
        return self


__all__ = [
    "DIFY_KNOWLEDGE_BASE_LAYER_TYPE_ID",
    "DifyKnowledgeBaseLayerConfig",
    "DifyKnowledgeDatasetConfig",
    "DifyKnowledgeEagerResult",
    "DifyKnowledgeMetadataCondition",
    "DifyKnowledgeMetadataConditions",
    "DifyKnowledgeMetadataFilteringConfig",
    "DifyKnowledgeModelConfig",
    "DifyKnowledgeQueryConfig",
    "DifyKnowledgeRerankingModelConfig",
    "DifyKnowledgeRetrievalConfig",
    "DifyKnowledgeRuntimeState",
    "DifyKnowledgeSetConfig",
]
