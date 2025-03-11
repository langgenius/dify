from enum import Enum
from typing import Optional

from pydantic import BaseModel

from .common import BlockEnum, CommonNodeType, ModelConfig, ValueSelector


class RetrieveType(str, Enum):
    """Retrieval mode types."""

    single = "single"
    multiple = "multiple"


class RerankingModeEnum(str, Enum):
    """Reranking mode types."""

    simple = "simple"
    advanced = "advanced"


class VectorSetting(BaseModel):
    """Vector weight settings."""

    vector_weight: float
    embedding_provider_name: str
    embedding_model_name: str


class KeywordSetting(BaseModel):
    """Keyword weight settings."""

    keyword_weight: float


class Weights(BaseModel):
    """Weight configuration for retrieval."""

    vector_setting: VectorSetting
    keyword_setting: KeywordSetting


class RerankingModel(BaseModel):
    """Reranking model configuration."""

    provider: str
    model: str


class MultipleRetrievalConfig(BaseModel):
    """Configuration for multiple retrieval mode."""

    top_k: int
    score_threshold: Optional[float] = None
    reranking_model: Optional[RerankingModel] = None
    reranking_mode: Optional[RerankingModeEnum] = None
    weights: Optional[Weights] = None
    reranking_enable: Optional[bool] = None


class SingleRetrievalConfig(BaseModel):
    """Configuration for single retrieval mode."""

    model: ModelConfig


class DataSet(BaseModel):
    """Dataset information."""

    id: str
    name: str
    description: Optional[str] = None


class KnowledgeRetrievalNodeType(CommonNodeType):
    """Knowledge retrieval node type implementation."""

    query_variable_selector: ValueSelector
    dataset_ids: list[str]
    retrieval_mode: RetrieveType
    multiple_retrieval_config: Optional[MultipleRetrievalConfig] = None
    single_retrieval_config: Optional[SingleRetrievalConfig] = None
    _datasets: Optional[list[DataSet]] = None


# Example usage
if __name__ == "__main__":
    example_node = KnowledgeRetrievalNodeType(
        title="Example Knowledge Retrieval Node",
        desc="A knowledge retrieval node example",
        type=BlockEnum.knowledge_retrieval,
        query_variable_selector=ValueSelector(value=["queryNode", "query"]),
        dataset_ids=["dataset1", "dataset2"],
        retrieval_mode=RetrieveType.multiple,
        multiple_retrieval_config=MultipleRetrievalConfig(
            top_k=10,
            score_threshold=0.5,
            reranking_model=RerankingModel(provider="example_provider", model="example_model"),
            reranking_mode=RerankingModeEnum.simple,
            weights=Weights(
                vector_setting=VectorSetting(
                    vector_weight=0.7, embedding_provider_name="provider1", embedding_model_name="model1"
                ),
                keyword_setting=KeywordSetting(keyword_weight=0.3),
            ),
            reranking_enable=True,
        ),
        single_retrieval_config=SingleRetrievalConfig(
            model=ModelConfig(
                provider="example_provider", name="example_model", mode="chat", completion_params={"temperature": 0.7}
            )
        ),
    )
    print(example_node)
