from typing import Literal

from pydantic import BaseModel, Field

from core.rag.entities import Condition, MetadataFilteringCondition, RerankingModelConfig, WeightedScoreConfig
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.nodes.llm.entities import ModelConfig, VisionConfig

__all__ = ["Condition"]


class MultipleRetrievalConfig(BaseModel):
    """
    Multiple Retrieval Config.
    """

    top_k: int
    score_threshold: float | None = None
    reranking_mode: str = "reranking_model"
    reranking_enable: bool = True
    reranking_model: RerankingModelConfig | None = None
    weights: WeightedScoreConfig | None = None


class SingleRetrievalConfig(BaseModel):
    """
    Single Retrieval Config.
    """

    model: ModelConfig


class KnowledgeRetrievalNodeData(BaseNodeData):
    """
    Knowledge retrieval Node Data.
    """

    type: NodeType = BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL
    query_variable_selector: list[str] | None | str = None
    query_attachment_selector: list[str] | None | str = None
    dataset_ids: list[str]
    retrieval_mode: Literal["single", "multiple"]
    multiple_retrieval_config: MultipleRetrievalConfig | None = None
    single_retrieval_config: SingleRetrievalConfig | None = None
    metadata_filtering_mode: Literal["disabled", "automatic", "manual"] | None = "disabled"
    metadata_model_config: ModelConfig | None = None
    metadata_filtering_conditions: MetadataFilteringCondition | None = None
    vision: VisionConfig = Field(default_factory=VisionConfig)

    @property
    def structured_output_enabled(self) -> bool:
        # NOTE(QuantumGhost): Temporary workaround for issue #20725
        # (https://github.com/langgenius/dify/issues/20725).
        #
        # The proper fix would be to make `KnowledgeRetrievalNode` inherit
        # from `BaseNode` instead of `LLMNode`.
        return False
