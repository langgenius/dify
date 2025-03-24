from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel


class SegmentUpdateEntity(BaseModel):
    content: str
    answer: Optional[str] = None
    keywords: Optional[list[str]] = None
    enabled: Optional[bool] = None


class ParentMode(str, Enum):
    FULL_DOC = "full-doc"
    PARAGRAPH = "paragraph"


class NotionIcon(BaseModel):
    type: str
    url: Optional[str] = None
    emoji: Optional[str] = None


class NotionPage(BaseModel):
    page_id: str
    page_name: str
    page_icon: Optional[NotionIcon] = None
    type: str


class NotionInfo(BaseModel):
    workspace_id: str
    pages: list[NotionPage]


class WebsiteInfo(BaseModel):
    provider: str
    job_id: str
    urls: list[str]
    only_main_content: bool = True


class FileInfo(BaseModel):
    file_ids: list[str]


class InfoList(BaseModel):
    data_source_type: Literal["upload_file", "notion_import", "website_crawl"]
    notion_info_list: Optional[list[NotionInfo]] = None
    file_info_list: Optional[FileInfo] = None
    website_info_list: Optional[WebsiteInfo] = None


class DataSource(BaseModel):
    info_list: InfoList


class PreProcessingRule(BaseModel):
    id: str
    enabled: bool


class Segmentation(BaseModel):
    separator: str = "\n"
    max_tokens: int
    chunk_overlap: int = 0


class Rule(BaseModel):
    pre_processing_rules: Optional[list[PreProcessingRule]] = None
    segmentation: Optional[Segmentation] = None
    parent_mode: Optional[Literal["full-doc", "paragraph"]] = None
    subchunk_segmentation: Optional[Segmentation] = None


class ProcessRule(BaseModel):
    mode: Literal["automatic", "custom", "hierarchical"]
    rules: Optional[Rule] = None


class RerankingModel(BaseModel):
    reranking_provider_name: Optional[str] = None
    reranking_model_name: Optional[str] = None


class WeightVectorSetting(BaseModel):
    vector_weight: float
    embedding_provider_name: str
    embedding_model_name: str


class WeightKeywordSetting(BaseModel):
    keyword_weight: float


class WeightModel(BaseModel):
    weight_type: str
    vector_setting: Optional[WeightVectorSetting] = None
    keyword_setting: Optional[WeightKeywordSetting] = None


class RetrievalModel(BaseModel):
    search_method: Literal["hybrid_search", "semantic_search", "full_text_search"]
    reranking_enable: bool
    reranking_model: Optional[RerankingModel] = None
    reranking_mode: Optional[str] = None
    top_k: int
    score_threshold_enabled: bool
    score_threshold: Optional[float] = None
    weights: Optional[WeightModel] = None


class MetaDataConfig(BaseModel):
    doc_type: str
    doc_metadata: dict


class KnowledgeConfig(BaseModel):
    original_document_id: Optional[str] = None
    duplicate: bool = True
    indexing_technique: Literal["high_quality", "economy"]
    data_source: Optional[DataSource] = None
    process_rule: Optional[ProcessRule] = None
    retrieval_model: Optional[RetrievalModel] = None
    doc_form: str = "text_model"
    doc_language: str = "English"
    embedding_model: Optional[str] = None
    embedding_model_provider: Optional[str] = None
    name: Optional[str] = None


class SegmentUpdateArgs(BaseModel):
    content: Optional[str] = None
    answer: Optional[str] = None
    keywords: Optional[list[str]] = None
    regenerate_child_chunks: bool = False
    enabled: Optional[bool] = None


class ChildChunkUpdateArgs(BaseModel):
    id: Optional[str] = None
    content: str


class MetadataArgs(BaseModel):
    type: Literal["string", "number", "time"]
    name: str


class MetadataUpdateArgs(BaseModel):
    name: str
    value: Optional[str | int | float] = None


class MetadataValueUpdateArgs(BaseModel):
    fields: list[MetadataUpdateArgs]


class MetadataDetail(BaseModel):
    id: str
    name: str
    value: Optional[str | int | float] = None


class DocumentMetadataOperation(BaseModel):
    document_id: str
    metadata_list: list[MetadataDetail]


class MetadataOperationData(BaseModel):
    """
    Metadata operation data
    """

    operation_data: list[DocumentMetadataOperation]
