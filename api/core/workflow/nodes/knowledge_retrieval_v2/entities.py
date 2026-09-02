from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

from core.rag.entities import RerankingModelConfig, SupportedComparisonOperator
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import NodeType
from graphon.nodes.llm.entities import ModelConfig
from services.knowledge_fs.product_dto import KnowledgeFSRetrievalMetadataFilters

KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE = "knowledge-retrieval-v2"

ControlSpaceId = Annotated[str, Field(min_length=1, max_length=1_000)]
VariableSelectorPart = Annotated[str, Field(min_length=1, max_length=255)]


class KnowledgeRetrievalV2MetadataCondition(BaseModel):
    id: str = Field(min_length=1, max_length=255)
    metadata_id: str | None = Field(default=None, min_length=1, max_length=512)
    metadata_type: Literal["string", "number", "time"]
    name: str = Field(min_length=1, max_length=255, pattern=r"^[a-z][a-z0-9_]*$")
    comparison_operator: SupportedComparisonOperator
    value: str | int | float | None = None


class KnowledgeRetrievalV2MetadataFilteringConditions(BaseModel):
    logical_operator: Literal["and", "or"] = "and"
    conditions: list[KnowledgeRetrievalV2MetadataCondition] = Field(default_factory=list, max_length=50)


class KnowledgeRetrievalV2NodeData(BaseNodeData):
    """Bounded, KnowledgeFS-native workflow node configuration."""

    type: NodeType = KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE
    control_space_ids: list[ControlSpaceId] = Field(min_length=1, max_length=10)
    query_variable_selector: list[VariableSelectorPart] = Field(min_length=2, max_length=10)
    query_attachment_selector: list[VariableSelectorPart] | None = Field(default=None, max_length=10)
    mode: Literal["deep", "fast", "research"] | None = None
    reranking_model: RerankingModelConfig | None = None
    score_threshold: float | None = Field(default=None, ge=0, le=1)
    top_n: int = Field(default=10, ge=1, le=100)
    metadata_filtering_mode: Literal["disabled", "automatic", "manual"] = "disabled"
    metadata_model_config: ModelConfig | None = None
    metadata_filtering_conditions: KnowledgeRetrievalV2MetadataFilteringConditions | None = None
    metadata_filters: KnowledgeFSRetrievalMetadataFilters | None = None

    @field_validator("control_space_ids")
    @classmethod
    def normalize_control_space_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("KnowledgeFS control-space ids must be non-empty")
        return list(dict.fromkeys(normalized))

    @field_validator("query_variable_selector")
    @classmethod
    def normalize_query_variable_selector(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("KnowledgeFS query variable selector must be non-empty")
        return normalized

    @field_validator("query_attachment_selector")
    @classmethod
    def normalize_query_attachment_selector(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        normalized = [value.strip() for value in values]
        if not normalized:
            return None
        if len(normalized) < 2:
            raise ValueError("KnowledgeFS query attachment selector must contain at least two parts")
        if any(not value for value in normalized):
            raise ValueError("KnowledgeFS query attachment selector must be non-empty")
        return normalized


__all__ = [
    "KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE",
    "KnowledgeRetrievalV2MetadataCondition",
    "KnowledgeRetrievalV2MetadataFilteringConditions",
    "KnowledgeRetrievalV2NodeData",
]
