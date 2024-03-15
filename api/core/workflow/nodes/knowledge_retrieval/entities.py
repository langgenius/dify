from typing import Any, Literal, Optional, Union

from pydantic import BaseModel

from core.prompt.entities.advanced_prompt_entities import ChatModelMessage, CompletionModelPromptTemplate, MemoryConfig
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector


class RerankingModelConfig(BaseModel):
    """
    Reranking Model Config.
    """
    provider: str
    mode: str


class MultipleRetrievalConfig(BaseModel):
    """
    Multiple Retrieval Config.
    """
    top_k: int
    score_threshold: Optional[float]
    reranking_model: RerankingModelConfig


class ModelConfig(BaseModel):
    """
     Model Config.
    """
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any] = {}


class SingleRetrievalConfig(BaseModel):
    """
    Single Retrieval Config.
    """
    model: ModelConfig


class KnowledgeRetrievalNodeData(BaseNodeData):
    """
    Knowledge retrieval Node Data.
    """
    query_variable_selector: list[str]
    dataset_ids: list[str]
    retrieval_mode: Literal['single', 'multiple']
    multiple_retrieval_config: MultipleRetrievalConfig
    singleRetrievalConfig: SingleRetrievalConfig
