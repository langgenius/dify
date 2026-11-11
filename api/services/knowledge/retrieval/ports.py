"""Persistence and external ranking required by knowledge retrieval."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from threading import Thread
from typing import Any, Protocol

from core.app.app_config.entities import ModelConfig
from core.app.entities.app_invoke_entities import EasyUIBasedAppGenerateEntity, InvokeFrom
from core.rag.data_post_processor.data_post_processor import RerankingModelDict, WeightsDict
from core.rag.entities import DocumentContext, MetadataFilteringCondition, RetrievalSourceMetadata
from core.rag.models.document import Document
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest, Source
from graphon.file import File
from graphon.model_runtime.entities.llm_entities import LLMUsage
from models.dataset import Dataset
from models.enums import CreatorUserRole
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalKnowledgeApiSetting


class KnowledgeRetrievalRecords(Protocol):
    def available_datasets(self, tenant_id: str, dataset_ids: list[str]) -> list[Dataset]: ...
    def dataset(self, tenant_id: str, dataset_id: str) -> Dataset | None: ...
    def metadata_fields(self, tenant_id: str, dataset_ids: list[str]) -> list[str]: ...
    def filter_documents(
        self, tenant_id: str, dataset_ids: list[str], condition: MetadataFilteringCondition | None
    ) -> dict[str, list[str]] | None: ...
    def external_request(
        self,
        tenant_id: str,
        dataset_id: str,
        query: str,
        parameters: dict[str, Any],
        condition: MetadataFilteringCondition | None,
    ) -> ExternalKnowledgeApiSetting: ...
    def record_queries(
        self,
        tenant_id: str,
        *,
        query: str | None,
        attachment_ids: list[str] | None,
        dataset_ids: list[str],
        app_id: str,
        role: CreatorUserRole,
        user_id: str,
    ) -> None: ...
    def record_hits(self, tenant_id: str, documents: list[Document]) -> None: ...
    def record_limit(self, tenant_id: str, subscription_plan: str) -> None: ...
    def workflow_sources(
        self, request: KnowledgeRetrievalRequest, dify_documents: list[Document], available_datasets_ids: list[str]
    ) -> list[Source]: ...
    def context_records(
        self,
        tenant_id: str,
        available_datasets_ids: list[str],
        dify_documents: list[Document],
        show_retrieve_source: bool,
        vision_enabled: bool,
        invoke_from: InvokeFrom,
    ) -> tuple[list[DocumentContext], list[File], list[RetrievalSourceMetadata]]: ...


class RetrievalReranker(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        reranking_mode: str,
        reranking_model: RerankingModelDict | None,
        weights: WeightsDict | None,
        documents: list[Document],
        query: str | None,
        attachment_id: str | None,
        score_threshold: float,
        top_k: int,
    ) -> list[Document]: ...


class DatasetRetriever(Protocol):
    """Retrieval operations consumed by workflow execution and hit testing."""

    @property
    def llm_usage(self) -> LLMUsage: ...

    def set_request_metadata(self, request_metadata: Mapping[str, object] | None) -> None: ...

    def knowledge_retrieval(self, request: KnowledgeRetrievalRequest) -> list[Source]: ...

    def get_metadata_filter_condition(
        self,
        dataset_ids: list[str],
        query: str,
        tenant_id: str,
        user_id: str,
        metadata_filtering_mode: str,
        metadata_model_config: ModelConfig | None,
        metadata_filtering_conditions: MetadataFilteringCondition | None,
        inputs: dict[str, Any],
    ) -> tuple[dict[str, list[str]] | None, MetadataFilteringCondition | None]: ...


class DatasetRetrievalFactory(Protocol):
    def __call__(self, application_generate_entity: EasyUIBasedAppGenerateEntity | None = None) -> DatasetRetriever: ...


class RetrievalScopeQueries(Protocol):
    def validate_scope(self, *, tenant_id: str, app_id: str, dataset_ids: list[str]) -> None: ...


class RetrievalThreadFactory(Protocol):
    def __call__(self, *, target: Callable[..., None], kwargs: dict[str, Any]) -> Thread: ...
