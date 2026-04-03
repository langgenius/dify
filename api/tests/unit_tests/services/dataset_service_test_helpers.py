"""Shared helpers for dataset_service unit tests.

These factories and lightweight builders are reused across the dataset,
document, and segment service test modules that exercise
``api/services/dataset_service.py``.
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelType
from werkzeug.exceptions import Forbidden, NotFound

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from enums.cloud_plan import CloudPlan
from models import Account, TenantAccountRole
from models.dataset import (
    ChildChunk,
    Dataset,
    DatasetPermissionEnum,
    DatasetProcessRule,
    Document,
    DocumentSegment,
)
from models.model import UploadFile
from services.dataset_service import (
    DatasetCollectionBindingService,
    DatasetPermissionService,
    DatasetService,
    DocumentService,
    SegmentService,
)
from services.entities.knowledge_entities.knowledge_entities import (
    ChildChunkUpdateArgs,
    DataSource,
    FileInfo,
    InfoList,
    KnowledgeConfig,
    NotionIcon,
    NotionInfo,
    NotionPage,
    PreProcessingRule,
    ProcessRule,
    RerankingModel,
    RetrievalModel,
    Rule,
    Segmentation,
    SegmentUpdateArgs,
    WebsiteInfo,
)
from services.entities.knowledge_entities.rag_pipeline_entities import (
    IconInfo as PipelineIconInfo,
)
from services.entities.knowledge_entities.rag_pipeline_entities import (
    KnowledgeConfiguration,
    RagPipelineDatasetCreateEntity,
)
from services.entities.knowledge_entities.rag_pipeline_entities import (
    RerankingModelConfig as RagPipelineRerankingModelConfig,
)
from services.entities.knowledge_entities.rag_pipeline_entities import (
    RetrievalSetting as RagPipelineRetrievalSetting,
)
from services.errors.account import NoPermissionError
from services.errors.chunk import ChildChunkDeleteIndexError, ChildChunkIndexingError
from services.errors.dataset import DatasetNameDuplicateError
from services.errors.document import DocumentIndexingError
from services.errors.file import FileNotExistsError

__all__ = [
    "Account",
    "BuiltInField",
    "ChildChunk",
    "ChildChunkDeleteIndexError",
    "ChildChunkIndexingError",
    "ChildChunkUpdateArgs",
    "CloudPlan",
    "DataSource",
    "Dataset",
    "DatasetCollectionBindingService",
    "DatasetNameDuplicateError",
    "DatasetPermissionEnum",
    "DatasetPermissionService",
    "DatasetProcessRule",
    "DatasetService",
    "DatasetServiceUnitDataFactory",
    "Document",
    "DocumentIndexingError",
    "DocumentSegment",
    "DocumentService",
    "FileInfo",
    "FileNotExistsError",
    "Forbidden",
    "IndexStructureType",
    "InfoList",
    "KnowledgeConfig",
    "KnowledgeConfiguration",
    "LLMBadRequestError",
    "MagicMock",
    "Mock",
    "ModelFeature",
    "ModelType",
    "NoPermissionError",
    "NotFound",
    "NotionIcon",
    "NotionInfo",
    "NotionPage",
    "PipelineIconInfo",
    "PreProcessingRule",
    "ProcessRule",
    "ProviderTokenNotInitError",
    "RagPipelineDatasetCreateEntity",
    "RagPipelineRerankingModelConfig",
    "RagPipelineRetrievalSetting",
    "RerankingModel",
    "RetrievalMethod",
    "RetrievalModel",
    "Rule",
    "SegmentService",
    "SegmentUpdateArgs",
    "Segmentation",
    "SimpleNamespace",
    "TenantAccountRole",
    "WebsiteInfo",
    "_make_child_chunk",
    "_make_dataset",
    "_make_document",
    "_make_features",
    "_make_knowledge_configuration",
    "_make_lock_context",
    "_make_retrieval_model",
    "_make_segment",
    "_make_session_context",
    "_make_upload_knowledge_config",
    "create_autospec",
    "json",
    "patch",
    "pytest",
]


def _make_session_context(session: MagicMock) -> MagicMock:
    """Wrap a mocked session in a context manager."""
    context_manager = MagicMock()
    context_manager.__enter__.return_value = session
    context_manager.__exit__.return_value = False
    return context_manager


class DatasetServiceUnitDataFactory:
    """Factory for lightweight doubles used across dataset service tests."""

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        *,
        permission: str = DatasetPermissionEnum.ALL_TEAM,
        created_by: str = "user-123",
        indexing_technique: str = "economy",
        embedding_model_provider: str = "provider",
        embedding_model: str = "model",
        built_in_field_enabled: bool = False,
        doc_form: str | None = "text_model",
        enable_api: bool = False,
        summary_index_setting: dict | None = None,
        **kwargs,
    ) -> Mock:
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.permission = permission
        dataset.created_by = created_by
        dataset.indexing_technique = indexing_technique
        dataset.embedding_model_provider = embedding_model_provider
        dataset.embedding_model = embedding_model
        dataset.built_in_field_enabled = built_in_field_enabled
        dataset.doc_form = doc_form
        dataset.enable_api = enable_api
        dataset.updated_by = None
        dataset.updated_at = None
        dataset.summary_index_setting = summary_index_setting
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str = "user-123",
        tenant_id: str = "tenant-123",
        role: str = TenantAccountRole.OWNER,
        **kwargs,
    ) -> SimpleNamespace:
        user = SimpleNamespace(
            id=user_id,
            current_tenant_id=tenant_id,
            current_role=role,
        )
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user

    @staticmethod
    def create_document_mock(
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        *,
        indexing_status: str = "completed",
        is_paused: bool = False,
        archived: bool = False,
        enabled: bool = True,
        data_source_type: str = "upload_file",
        data_source_info_dict: dict | None = None,
        data_source_info: str | None = None,
        doc_form: str = "text_model",
        need_summary: bool = True,
        position: int = 0,
        doc_metadata: dict | None = None,
        name: str = "Document",
        **kwargs,
    ) -> Mock:
        document = Mock(spec=Document)
        document.id = document_id
        document.dataset_id = dataset_id
        document.tenant_id = tenant_id
        document.indexing_status = indexing_status
        document.is_paused = is_paused
        document.paused_by = None
        document.paused_at = None
        document.archived = archived
        document.enabled = enabled
        document.data_source_type = data_source_type
        document.data_source_info_dict = data_source_info_dict or {}
        document.data_source_info = data_source_info
        document.doc_form = doc_form
        document.need_summary = need_summary
        document.position = position
        document.doc_metadata = doc_metadata
        document.name = name
        for key, value in kwargs.items():
            setattr(document, key, value)
        return document

    @staticmethod
    def create_upload_file_mock(file_id: str = "file-123", name: str = "upload.txt") -> Mock:
        upload_file = Mock(spec=UploadFile)
        upload_file.id = file_id
        upload_file.name = name
        return upload_file


_UNSET = object()


def _make_lock_context() -> MagicMock:
    context_manager = MagicMock()
    context_manager.__enter__.return_value = None
    context_manager.__exit__.return_value = False
    return context_manager


def _make_features(*, enabled: bool, plan: str = CloudPlan.PROFESSIONAL) -> SimpleNamespace:
    return SimpleNamespace(
        billing=SimpleNamespace(
            enabled=enabled,
            subscription=SimpleNamespace(plan=plan),
        ),
        documents_upload_quota=SimpleNamespace(limit=1000, size=0),
    )


def _make_dataset(
    *,
    dataset_id: str = "dataset-1",
    tenant_id: str = "tenant-1",
    data_source_type: str | None = None,
    indexing_technique: str | None = "economy",
    latest_process_rule=None,
) -> Mock:
    dataset = Mock(spec=Dataset)
    dataset.id = dataset_id
    dataset.tenant_id = tenant_id
    dataset.data_source_type = data_source_type
    dataset.indexing_technique = indexing_technique
    dataset.latest_process_rule = latest_process_rule
    dataset.embedding_model_provider = "provider"
    dataset.embedding_model = "embedding-model"
    dataset.summary_index_setting = None
    dataset.retrieval_model = None
    dataset.collection_binding_id = None
    return dataset


def _make_document(
    *,
    document_id: str = "doc-1",
    dataset_id: str = "dataset-1",
    tenant_id: str = "tenant-1",
    batch: str = "batch-1",
    doc_form: str = IndexStructureType.PARAGRAPH_INDEX,
    word_count: int = 0,
    name: str = "Document 1",
    enabled: bool = True,
    archived: bool = False,
    indexing_status: str = "completed",
    display_status: str = "available",
) -> Mock:
    document = Mock(spec=Document)
    document.id = document_id
    document.dataset_id = dataset_id
    document.tenant_id = tenant_id
    document.batch = batch
    document.doc_form = doc_form
    document.word_count = word_count
    document.name = name
    document.enabled = enabled
    document.archived = archived
    document.indexing_status = indexing_status
    document.display_status = display_status
    document.data_source_type = "upload_file"
    document.data_source_info = "{}"
    document.completed_at = SimpleNamespace()
    document.processing_started_at = "started"
    document.parsing_completed_at = "parsed"
    document.cleaning_completed_at = "cleaned"
    document.splitting_completed_at = "split"
    document.updated_at = None
    document.created_from = None
    document.dataset_process_rule_id = "process-rule-1"
    return document


def _make_segment(
    *,
    segment_id: str = "segment-1",
    content: str = "segment content",
    word_count: int = 15,
    enabled: bool = True,
    keywords: list[str] | None = None,
    index_node_id: str = "node-1",
    dataset_id: str = "dataset-1",
    document_id: str = "doc-1",
) -> Mock:
    segment = Mock(spec=DocumentSegment)
    segment.id = segment_id
    segment.dataset_id = dataset_id
    segment.document_id = document_id
    segment.content = content
    segment.word_count = word_count
    segment.enabled = enabled
    segment.keywords = keywords or []
    segment.answer = None
    segment.index_node_id = index_node_id
    segment.disabled_at = None
    segment.disabled_by = None
    segment.status = "completed"
    segment.error = None
    return segment


def _make_child_chunk() -> ChildChunk:
    return ChildChunk(
        id="child-a",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="doc-1",
        segment_id="segment-1",
        position=1,
        content="old content",
        word_count=11,
        created_by="user-1",
    )


def _make_upload_knowledge_config(
    *,
    original_document_id: str | None = None,
    file_ids: list[str] | None = None,
    process_rule: ProcessRule | None = None,
    data_source: DataSource | object | None = _UNSET,
) -> KnowledgeConfig:
    if data_source is _UNSET:
        info_list = InfoList(
            data_source_type="upload_file",
            file_info_list=FileInfo(file_ids=file_ids) if file_ids is not None else None,
        )
        data_source = DataSource(info_list=info_list)

    return KnowledgeConfig(
        original_document_id=original_document_id,
        indexing_technique="economy",
        data_source=data_source,
        process_rule=process_rule,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        doc_language="English",
    )


def _make_retrieval_model(
    *,
    reranking_provider_name: str = "rerank-provider",
    reranking_model_name: str = "rerank-model",
) -> RetrievalModel:
    return RetrievalModel(
        search_method=RetrievalMethod.SEMANTIC_SEARCH,
        reranking_enable=True,
        reranking_model=RerankingModel(
            reranking_provider_name=reranking_provider_name,
            reranking_model_name=reranking_model_name,
        ),
        reranking_mode="reranking_model",
        top_k=4,
        score_threshold_enabled=False,
    )


def _make_rag_pipeline_retrieval_setting() -> RagPipelineRetrievalSetting:
    return RagPipelineRetrievalSetting(
        search_method=RetrievalMethod.SEMANTIC_SEARCH,
        top_k=4,
        score_threshold=0.5,
        score_threshold_enabled=True,
        reranking_mode="reranking_model",
        reranking_enable=True,
        reranking_model=RagPipelineRerankingModelConfig(
            reranking_provider_name="rerank-provider",
            reranking_model_name="rerank-model",
        ),
    )


def _make_knowledge_configuration(
    *,
    chunk_structure: str = "paragraph",
    indexing_technique: str = "high_quality",
    embedding_model_provider: str = "provider",
    embedding_model: str = "embedding-model",
    keyword_number: int = 8,
    summary_index_setting: dict | None = None,
) -> KnowledgeConfiguration:
    return KnowledgeConfiguration(
        chunk_structure=chunk_structure,
        indexing_technique=indexing_technique,
        embedding_model_provider=embedding_model_provider,
        embedding_model=embedding_model,
        keyword_number=keyword_number,
        retrieval_model=_make_rag_pipeline_retrieval_setting(),
        summary_index_setting=summary_index_setting,
    )
