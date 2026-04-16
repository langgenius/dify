from typing import Union

from pydantic import BaseModel

from core.rag.entities import RerankingModelConfig, WeightedScoreConfig
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import NodeType


class RetrievalSetting(BaseModel):
    """
    Retrieval Setting.
    """

    search_method: RetrievalMethod
    top_k: int
    score_threshold: float | None = 0.5
    score_threshold_enabled: bool = False
    reranking_mode: str = "reranking_model"
    reranking_enable: bool = True
    reranking_model: RerankingModelConfig | None = None
    weights: WeightedScoreConfig | None = None


class FileInfo(BaseModel):
    """
    File Info.
    """

    file_id: str


class OnlineDocumentIcon(BaseModel):
    """
    Document Icon.
    """

    icon_url: str
    icon_type: str
    icon_emoji: str


class OnlineDocumentInfo(BaseModel):
    """
    Online document info.
    """

    provider: str
    workspace_id: str | None = None
    page_id: str
    page_type: str
    icon: OnlineDocumentIcon | None = None


class WebsiteInfo(BaseModel):
    """
    website import info.
    """

    provider: str
    url: str


class GeneralStructureChunk(BaseModel):
    """
    General Structure Chunk.
    """

    general_chunks: list[str]
    data_source_info: Union[FileInfo, OnlineDocumentInfo, WebsiteInfo]


class ParentChildChunk(BaseModel):
    """
    Parent Child Chunk.
    """

    parent_content: str
    child_contents: list[str]


class ParentChildStructureChunk(BaseModel):
    """
    Parent Child Structure Chunk.
    """

    parent_child_chunks: list[ParentChildChunk]
    data_source_info: Union[FileInfo, OnlineDocumentInfo, WebsiteInfo]


class KnowledgeIndexNodeData(BaseNodeData):
    """
    Knowledge index Node Data.
    """

    type: NodeType = KNOWLEDGE_INDEX_NODE_TYPE
    chunk_structure: str
    index_chunk_variable_selector: list[str]
    indexing_technique: str | None = None
    summary_index_setting: SummaryIndexSettingDict | None = None
