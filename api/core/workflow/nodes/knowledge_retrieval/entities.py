from typing import Any, Literal, Optional, Union

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData


class RerankingModelConfig(BaseModel):
    """
    Reranking Model Config.
    """
    provider: str
    model: str


class MultipleRetrievalConfig(BaseModel):
    """
    Multiple Retrieval Config.
    """
    top_k: int
    score_threshold: Optional[float] = None
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


class MetadataFilterItem(BaseModel):
    """
    Metadata Filter.
    """
    key: str
    '''
     field condition 
     e.g. 
        FieldCondition
            Match 
                MatchValue - str, int, bool
                MatchText - str
                MatchAny - list[str], list[int]
                MatchExcept - list[str], list[int]
            Range 
                le - float
                lt - float
                ge - float
                gt - float 
    '''
    field_condition: str
    value_selector: Optional[list[str]] = None
    arg: Optional[Union[str, int, bool, float, list[str], list[int]]] = None


class MetadataFilterConfig(BaseModel):
    """
    Metadata Filter Config.
    """
    filter_items: list[MetadataFilterItem]


class KnowledgeRetrievalNodeData(BaseNodeData):
    """
    Knowledge retrieval Node Data.
    """
    type: str = 'knowledge-retrieval'
    query_variable_selector: list[str]
    authorized_dataset_ids_variable_selector: Optional[Union[list[str], str]] = None
    # Filter Mode Selection e.g. 'must' or 'should' or 'must_not'
    filter_mode_to_metadata_filter_config_dict: Optional[dict[str, MetadataFilterConfig]] = None
    dataset_ids: list[str]
    retrieval_mode: Literal['single', 'multiple']
    multiple_retrieval_config: Optional[MultipleRetrievalConfig] = None
    single_retrieval_config: Optional[SingleRetrievalConfig] = None
