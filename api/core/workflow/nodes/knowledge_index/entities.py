from typing import Literal, Union

from pydantic import BaseModel

from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.workflow.nodes.base import BaseNodeData


class RerankingModelConfig(BaseModel):
    """
    Reranking Model Config.
    """

    reranking_provider_name: str
    reranking_model_name: str


class VectorSetting(BaseModel):
    """
    Vector Setting.
    """

    vector_weight: float
    embedding_provider_name: str
    embedding_model_name: str


class KeywordSetting(BaseModel):
    """
    Keyword Setting.
    """

    keyword_weight: float


class WeightedScoreConfig(BaseModel):
    """
    Weighted score Config.
    """

    vector_setting: VectorSetting
    keyword_setting: KeywordSetting


class EmbeddingSetting(BaseModel):
    """
    Embedding Setting.
    """

    embedding_provider_name: str
    embedding_model_name: str


class EconomySetting(BaseModel):
    """
    Economy Setting.
    """

    keyword_number: int


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


class IndexMethod(BaseModel):
    """
    Knowledge Index Setting.
    """

    indexing_technique: Literal["high_quality", "economy"]
    embedding_setting: EmbeddingSetting
    economy_setting: EconomySetting


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

    type: str = "knowledge-index"
    chunk_structure: str
    index_chunk_variable_selector: list[str]
