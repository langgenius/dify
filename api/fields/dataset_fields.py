from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import sqlalchemy as sa
from pydantic import Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from fields.base import ResponseModel
from libs.helper import to_timestamp
from models.account import Account
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetMetadata,
    Document,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
    Pipeline,
)
from models.model import App, Tag, TagBinding


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
    result: str = Field(description="Operation result.")


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
    keyword_setting: DatasetKeywordSettingResponse = Field(
        default_factory=DatasetKeywordSettingResponse,
        description="Keyword search weight settings.",
    )
    vector_setting: DatasetVectorSettingResponse = Field(
        default_factory=DatasetVectorSettingResponse,
        description="Semantic search weight settings.",
    )

    @field_validator("keyword_setting", "vector_setting", mode="before")
    @classmethod
    def _expand_null_nested(cls, value: object) -> object:
        return {} if value is None else value


class DatasetRetrievalModelResponse(ResponseModel):
    search_method: str
    reranking_enable: bool
    reranking_mode: str | None = None
    reranking_model: DatasetRerankingModelResponse = Field(
        default_factory=DatasetRerankingModelResponse,
        description="Reranking model configuration.",
    )
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
    retrieval_model_dict: DatasetRetrievalModelResponse = Field(
        description="Retrieval configuration for the knowledge base."
    )
    summary_index_setting: DatasetSummaryIndexSettingResponse = Field(
        default_factory=DatasetSummaryIndexSettingResponse,
        description="Summary index configuration.",
    )
    tags: list[DatasetTagResponse]
    doc_form: str | None
    external_knowledge_info: DatasetExternalKnowledgeInfoResponse = Field(
        default_factory=DatasetExternalKnowledgeInfoResponse,
        description=(
            "Connection details for external knowledge bases. Populated when `provider` is `external`; otherwise "
            "its properties are `null`."
        ),
    )
    external_retrieval_model: DatasetExternalRetrievalModelResponse | None
    doc_metadata: list[DatasetDocMetadataResponse]
    built_in_field_enabled: bool
    pipeline_id: str | None
    runtime_mode: str | None
    chunk_structure: str | None
    icon_info: DatasetIconInfoResponse = Field(
        default_factory=DatasetIconInfoResponse,
        description="Icon display configuration for the knowledge base.",
    )
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
class DatasetDetailPrefetch:
    """Batch-loaded values backing the session-scoped fields of a page of datasets.

    Building a detail response for a single dataset issues about ten queries for
    that row alone, so a list endpoint costs one query per dataset per field.
    Loading the same values for every dataset on the page up front keeps the
    query count bounded regardless of the page size.
    """

    app_counts: dict[str, int] = field(default_factory=dict)
    document_counts: dict[str, int] = field(default_factory=dict)
    word_counts: dict[str, int] = field(default_factory=dict)
    available_document_counts: dict[str, int] = field(default_factory=dict)
    author_names: dict[str, str] = field(default_factory=dict)
    tags: dict[tuple[str, str], list[Tag]] = field(default_factory=dict)
    doc_forms: dict[tuple[str, str], str | None] = field(default_factory=dict)
    external_knowledge_infos: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    doc_metadata: dict[str, list[DatasetMetadata]] = field(default_factory=dict)
    pipeline_published: dict[str, bool] = field(default_factory=dict)


def build_dataset_detail_prefetch(datasets: Sequence[Dataset], *, session: Session) -> DatasetDetailPrefetch:
    """Load every session-scoped detail field for the given datasets in a fixed number of queries."""
    dataset_ids = [dataset.id for dataset in datasets]
    if not dataset_ids:
        return DatasetDetailPrefetch()

    tenant_ids = {dataset.tenant_id for dataset in datasets}

    app_counts = dict(
        session.execute(
            select(AppDatasetJoin.dataset_id, func.count(AppDatasetJoin.id))
            .where(AppDatasetJoin.dataset_id.in_(dataset_ids), App.id == AppDatasetJoin.app_id)
            .group_by(AppDatasetJoin.dataset_id)
        )
        .tuples()
        .all()
    )

    document_counts: dict[str, int] = {}
    word_counts: dict[str, int] = {}
    available_document_counts: dict[str, int] = {}
    available_document_case = sa.case(
        (
            sa.and_(
                Document.indexing_status == "completed",
                Document.enabled == True,
                Document.archived == False,
            ),
            1,
        ),
        else_=0,
    )
    document_rows = session.execute(
        select(
            Document.dataset_id,
            func.count(Document.id),
            func.coalesce(func.sum(Document.word_count), 0),
            func.coalesce(func.sum(available_document_case), 0),
        )
        .where(Document.dataset_id.in_(dataset_ids))
        .group_by(Document.dataset_id)
    ).all()
    for dataset_id, document_count, word_count, available_count in document_rows:
        document_counts[dataset_id] = document_count
        word_counts[dataset_id] = word_count
        available_document_counts[dataset_id] = available_count

    # doc_form only falls back to the documents table for datasets without a
    # chunk structure of their own.
    doc_forms: dict[tuple[str, str], str | None] = {}
    doc_form_dataset_ids = [dataset.id for dataset in datasets if not dataset.chunk_structure]
    if doc_form_dataset_ids:
        doc_forms = {
            (dataset_id, tenant_id): doc_form
            for dataset_id, tenant_id, doc_form in session.execute(
                select(Document.dataset_id, Document.tenant_id, func.min(Document.doc_form))
                .where(Document.dataset_id.in_(doc_form_dataset_ids), Document.tenant_id.in_(tenant_ids))
                .group_by(Document.dataset_id, Document.tenant_id)
            ).all()
        }

    author_ids = {dataset.created_by for dataset in datasets if dataset.created_by}
    author_names = dict(
        session.execute(select(Account.id, Account.name).where(Account.id.in_(author_ids))).tuples().all()
    )

    tags: dict[tuple[str, str], list[Tag]] = {}
    tag_rows = session.execute(
        select(TagBinding.target_id, TagBinding.tenant_id, Tag)
        .join(TagBinding, Tag.id == TagBinding.tag_id)
        .where(
            TagBinding.target_id.in_(dataset_ids),
            TagBinding.tenant_id.in_(tenant_ids),
            Tag.tenant_id == TagBinding.tenant_id,
            Tag.type == "knowledge",
        )
    ).all()
    for target_id, tenant_id, tag in tag_rows:
        tags.setdefault((target_id, tenant_id), []).append(tag)

    doc_metadata: dict[str, list[DatasetMetadata]] = {}
    for dataset_metadata in session.scalars(
        select(DatasetMetadata).where(DatasetMetadata.dataset_id.in_(dataset_ids))
    ).all():
        doc_metadata.setdefault(dataset_metadata.dataset_id, []).append(dataset_metadata)

    pipeline_ids = {dataset.pipeline_id for dataset in datasets if dataset.pipeline_id}
    pipeline_published: dict[str, bool] = {}
    if pipeline_ids:
        pipeline_published = dict(
            session.execute(select(Pipeline.id, Pipeline.is_published).where(Pipeline.id.in_(pipeline_ids)))
            .tuples()
            .all()
        )

    return DatasetDetailPrefetch(
        app_counts=app_counts,
        document_counts=document_counts,
        word_counts=word_counts,
        available_document_counts=available_document_counts,
        author_names=author_names,
        tags=tags,
        doc_forms=doc_forms,
        external_knowledge_infos=_load_external_knowledge_infos(datasets, session=session),
        doc_metadata=doc_metadata,
        pipeline_published=pipeline_published,
    )


def _load_external_knowledge_infos(
    datasets: Sequence[Dataset], *, session: Session
) -> dict[tuple[str, str], dict[str, Any]]:
    external_datasets = [dataset for dataset in datasets if dataset.provider == "external"]
    if not external_datasets:
        return {}

    external_dataset_ids = [dataset.id for dataset in external_datasets]
    external_tenant_ids = {dataset.tenant_id for dataset in external_datasets}
    bindings = session.scalars(
        select(ExternalKnowledgeBindings).where(
            ExternalKnowledgeBindings.dataset_id.in_(external_dataset_ids),
            ExternalKnowledgeBindings.tenant_id.in_(external_tenant_ids),
        )
    ).all()
    if not bindings:
        return {}

    apis = {
        (api.id, api.tenant_id): api
        for api in session.scalars(
            select(ExternalKnowledgeApis).where(
                ExternalKnowledgeApis.id.in_({binding.external_knowledge_api_id for binding in bindings}),
                ExternalKnowledgeApis.tenant_id.in_(external_tenant_ids),
            )
        ).all()
    }

    infos: dict[tuple[str, str], dict[str, Any]] = {}
    for binding in bindings:
        info = Dataset.build_external_knowledge_info(
            binding, apis.get((binding.external_knowledge_api_id, binding.tenant_id))
        )
        if info is not None:
            infos[(binding.dataset_id, binding.tenant_id)] = info
    return infos


@dataclass(frozen=True)
class DatasetDetailResponseSource:
    """Expose session-backed dataset fields during response validation.

    With a prefetch the values come from the batch load for the whole page;
    without one each field is resolved against the session on access.
    """

    dataset: Any
    session: Session
    prefetch: DatasetDetailPrefetch | None = None

    @property
    def _prefetch_key(self) -> tuple[str, str]:
        return (self.dataset.id, self.dataset.tenant_id)

    @property
    def app_count(self) -> int:
        if self.prefetch is not None:
            return self.prefetch.app_counts.get(self.dataset.id, 0)
        return self.dataset.get_app_count(session=self.session)

    @property
    def document_count(self) -> int:
        if self.prefetch is not None:
            return self.prefetch.document_counts.get(self.dataset.id, 0)
        return self.dataset.get_document_count(session=self.session)

    @property
    def word_count(self) -> int:
        if self.prefetch is not None:
            return self.prefetch.word_counts.get(self.dataset.id, 0)
        return self.dataset.get_word_count(session=self.session)

    @property
    def author_name(self) -> str | None:
        if self.prefetch is not None:
            return self.prefetch.author_names.get(self.dataset.created_by)
        return self.dataset.get_author_name(session=self.session)

    @property
    def tags(self) -> Any:
        if self.prefetch is not None:
            return self.prefetch.tags.get(self._prefetch_key, [])
        return self.dataset.get_tags(session=self.session)

    @property
    def doc_form(self) -> str | None:
        if self.prefetch is not None:
            if self.dataset.chunk_structure:
                return self.dataset.chunk_structure
            return self.prefetch.doc_forms.get(self._prefetch_key)
        return self.dataset.get_doc_form(session=self.session)

    @property
    def external_knowledge_info(self) -> Any:
        if self.prefetch is not None:
            if self.dataset.provider != "external":
                return None
            return self.prefetch.external_knowledge_infos.get(self._prefetch_key)
        return self.dataset.get_external_knowledge_info(session=self.session)

    @property
    def doc_metadata(self) -> Any:
        if self.prefetch is not None:
            return self.dataset.build_doc_metadata(self.prefetch.doc_metadata.get(self.dataset.id, []))
        return self.dataset.get_doc_metadata(session=self.session)

    @property
    def is_published(self) -> bool:
        if self.prefetch is not None:
            if not self.dataset.pipeline_id:
                return False
            return self.prefetch.pipeline_published.get(self.dataset.pipeline_id, False)
        return self.dataset.get_is_published(session=self.session)

    @property
    def total_documents(self) -> int:
        if self.prefetch is not None:
            return self.prefetch.document_counts.get(self.dataset.id, 0)
        return self.dataset.get_total_documents(session=self.session)

    @property
    def total_available_documents(self) -> int:
        if self.prefetch is not None:
            return self.prefetch.available_document_counts.get(self.dataset.id, 0)
        return self.dataset.get_total_available_documents(session=self.session)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.dataset, name)  # guard-ignore: no-new-getattr -- delegates model fields


def dataset_detail_response_source(
    dataset: Any, *, session: Session, prefetch: DatasetDetailPrefetch | None = None
) -> DatasetDetailResponseSource:
    return DatasetDetailResponseSource(dataset=dataset, session=session, prefetch=prefetch)
