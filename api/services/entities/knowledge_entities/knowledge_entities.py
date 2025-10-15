from enum import StrEnum
from typing import Literal

from pydantic import BaseModel

from core.rag.retrieval.retrieval_methods import RetrievalMethod


class ParentMode(StrEnum):
    FULL_DOC = "full-doc"
    PARAGRAPH = "paragraph"


class NotionIcon(BaseModel):
    type: str
    url: str | None = None
    emoji: str | None = None


class NotionPage(BaseModel):
    page_id: str
    page_name: str
    page_icon: NotionIcon | None = None
    type: str


class NotionInfo(BaseModel):
    credential_id: str
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
    notion_info_list: list[NotionInfo] | None = None
    file_info_list: FileInfo | None = None
    website_info_list: WebsiteInfo | None = None


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
    pre_processing_rules: list[PreProcessingRule] | None = None
    segmentation: Segmentation | None = None
    parent_mode: Literal["full-doc", "paragraph"] | None = None
    subchunk_segmentation: Segmentation | None = None


class ProcessRule(BaseModel):
    mode: Literal["automatic", "custom", "hierarchical"]
    rules: Rule | None = None


class RerankingModel(BaseModel):
    reranking_provider_name: str | None = None
    reranking_model_name: str | None = None


class WeightVectorSetting(BaseModel):
    vector_weight: float
    embedding_provider_name: str
    embedding_model_name: str


class WeightKeywordSetting(BaseModel):
    keyword_weight: float


class WeightModel(BaseModel):
    weight_type: Literal["semantic_first", "keyword_first", "customized"] | None = None
    vector_setting: WeightVectorSetting | None = None
    keyword_setting: WeightKeywordSetting | None = None


class RetrievalModel(BaseModel):
    search_method: RetrievalMethod
    reranking_enable: bool
    reranking_model: RerankingModel | None = None
    reranking_mode: str | None = None
    top_k: int
    score_threshold_enabled: bool
    score_threshold: float | None = None
    weights: WeightModel | None = None


class MetaDataConfig(BaseModel):
    doc_type: str
    doc_metadata: dict


class KnowledgeConfig(BaseModel):
    original_document_id: str | None = None
    duplicate: bool = True
    indexing_technique: Literal["high_quality", "economy"]
    data_source: DataSource | None = None
    process_rule: ProcessRule | None = None
    retrieval_model: RetrievalModel | None = None
    doc_form: str = "text_model"
    doc_language: str = "English"
    embedding_model: str | None = None
    embedding_model_provider: str | None = None
    name: str | None = None


class SegmentUpdateArgs(BaseModel):
    content: str | None = None
    answer: str | None = None
    keywords: list[str] | None = None
    regenerate_child_chunks: bool = False
    enabled: bool | None = None


class ChildChunkUpdateArgs(BaseModel):
    id: str | None = None
    content: str


class MetadataArgs(BaseModel):
    type: Literal["string", "number", "time"]
    name: str


class MetadataUpdateArgs(BaseModel):
    name: str
    value: str | int | float | None = None


class MetadataDetail(BaseModel):
    id: str
    name: str
    value: str | int | float | None = None


class DocumentMetadataOperation(BaseModel):
    document_id: str
    metadata_list: list[MetadataDetail]


class MetadataOperationData(BaseModel):
    """
    Metadata operation data
    """

    operation_data: list[DocumentMetadataOperation]
