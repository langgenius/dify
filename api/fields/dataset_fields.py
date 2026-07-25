from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import Field, field_validator
from sqlalchemy.orm import Session

from fields.base import ResponseModel
from libs.helper import to_timestamp


class DatasetMetadataResponse(ResponseModel):
    id: str
    type: str
    name: str


class DatasetMetadataListItemResponse(ResponseModel):
    id: str
    name: str
    type: str
    count: int = 0


class DatasetMetadataListResponse(ResponseModel):
    doc_metadata: list[DatasetMetadataListItemResponse]
    built_in_field_enabled: bool


class DatasetMetadataBuiltInFieldResponse(ResponseModel):
    name: str
    type: str


class DatasetMetadataBuiltInFieldsResponse(ResponseModel):
    fields: list[DatasetMetadataBuiltInFieldResponse]


class DatasetMetadataActionResponse(ResponseModel):
    result: str


class DatasetRerankingModelResponse(ResponseModel):
    reranking_provider_name: str | None = None
    reranking_model_name: str | None = None


class DatasetKeywordSettingResponse(ResponseModel):
    keyword_weight: float | None = None


class DatasetVectorSettingResponse(ResponseModel):
    vector_weight: float | None = None
    embedding_model_name: str | None = None
    embedding_provider_name: str | None = None


class DatasetWeightedScoreResponse(ResponseModel):
    weight_type: str | None = None
    keyword_setting: DatasetKeywordSettingResponse = Field(default_factory=DatasetKeywordSettingResponse)
    vector_setting: DatasetVectorSettingResponse = Field(default_factory=DatasetVectorSettingResponse)

    @field_validator("keyword_setting", "vector_setting", mode="before")
    @classmethod
    def _expand_null_nested(cls, value: object) -> object:
        return {} if value is None else value


class DatasetRetrievalModelResponse(ResponseModel):
    search_method: str
    reranking_enable: bool
    reranking_mode: str | None = None
    reranking_model: DatasetRerankingModelResponse = Field(default_factory=DatasetRerankingModelResponse)
    weights: DatasetWeightedScoreResponse | None = None
    top_k: int
    score_threshold_enabled: bool
    score_threshold: float | None = None

    @field_validator("reranking_model", mode="before")
    @classmethod
    def _expand_null_nested(cls, value: object) -> object:
        return {} if value is None else value


class DatasetSummaryIndexSettingResponse(ResponseModel):
    enable: bool | None = None
    model_name: str | None = None
    model_provider_name: str | None = None
    summary_prompt: str | None = None


class DatasetTagResponse(ResponseModel):
    id: str
    name: str
    type: str


class DatasetExternalKnowledgeInfoResponse(ResponseModel):
    external_knowledge_id: str | None = None
    external_knowledge_api_id: str | None = None
    external_knowledge_api_name: str | None = None
    external_knowledge_api_endpoint: str | None = None


class DatasetExternalRetrievalModelResponse(ResponseModel):
    top_k: int
    score_threshold: float | None = None
    score_threshold_enabled: bool | None = None


class DatasetDocMetadataResponse(ResponseModel):
    id: str
    name: str
    type: str


class DatasetIconInfoResponse(ResponseModel):
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    icon_url: str | None = None


class DatasetDetailResponse(ResponseModel):
    id: str
    name: str
    description: str | None
    provider: str
    permission: str
    data_source_type: str | None
    indexing_technique: str | None
    app_count: int
    document_count: int
    word_count: int
    created_by: str
    author_name: str | None
    created_at: int
    updated_by: str | None
    updated_at: int
    embedding_model: str | None
    embedding_model_provider: str | None
    embedding_available: bool | None = None
    retrieval_model_dict: DatasetRetrievalModelResponse
    summary_index_setting: DatasetSummaryIndexSettingResponse = Field(
        default_factory=DatasetSummaryIndexSettingResponse
    )
    tags: list[DatasetTagResponse]
    doc_form: str | None
    external_knowledge_info: DatasetExternalKnowledgeInfoResponse = Field(
        default_factory=DatasetExternalKnowledgeInfoResponse
    )
    external_retrieval_model: DatasetExternalRetrievalModelResponse | None
    doc_metadata: list[DatasetDocMetadataResponse]
    built_in_field_enabled: bool
    pipeline_id: str | None
    runtime_mode: str | None
    chunk_structure: str | None
    icon_info: DatasetIconInfoResponse = Field(default_factory=DatasetIconInfoResponse)
    is_published: bool
    total_documents: int
    total_available_documents: int
    enable_api: bool
    is_multimodal: bool
    permission_keys: list[str] = Field(default_factory=list)
    maintainer: str | None = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)

    @field_validator("summary_index_setting", "external_knowledge_info", "icon_info", mode="before")
    @classmethod
    def _expand_null_nested(cls, value: object) -> object:
        return {} if value is None else value


@dataclass(frozen=True)
class DatasetDetailResponseSource:
    """Expose session-backed dataset fields during response validation."""

    dataset: Any
    session: Session

    @property
    def app_count(self) -> int:
        return self.dataset.get_app_count(session=self.session)

    @property
    def document_count(self) -> int:
        return self.dataset.get_document_count(session=self.session)

    @property
    def word_count(self) -> int:
        return self.dataset.get_word_count(session=self.session)

    @property
    def author_name(self) -> str | None:
        return self.dataset.get_author_name(session=self.session)

    @property
    def tags(self) -> Any:
        return self.dataset.get_tags(session=self.session)

    @property
    def doc_form(self) -> str | None:
        return self.dataset.get_doc_form(session=self.session)

    @property
    def external_knowledge_info(self) -> Any:
        return self.dataset.get_external_knowledge_info(session=self.session)

    @property
    def doc_metadata(self) -> Any:
        return self.dataset.get_doc_metadata(session=self.session)

    @property
    def is_published(self) -> bool:
        return self.dataset.get_is_published(session=self.session)

    @property
    def total_documents(self) -> int:
        return self.dataset.get_total_documents(session=self.session)

    @property
    def total_available_documents(self) -> int:
        return self.dataset.get_total_available_documents(session=self.session)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.dataset, name)  # noqa: no-new-getattr response adapter delegates model fields


def dataset_detail_response_source(dataset: Any, *, session: Session) -> DatasetDetailResponseSource:
    return DatasetDetailResponseSource(dataset=dataset, session=session)
