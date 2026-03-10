"""Unit tests for DatasetService and related dataset/document/segment service behaviors.

This suite focuses on helper methods, permission gates, and collaborator
orchestration that can be validated without asserting real database state.
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.rag.index_processor.constant.built_in_field import BuiltInField
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from dify_graph.model_runtime.entities.model_entities import ModelFeature, ModelType
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


class TestDatasetServiceQueries:
    """Unit tests for DatasetService query composition and fallback branches."""

    @pytest.fixture
    def mock_dataset_query_dependencies(self):
        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.helper.escape_like_pattern", return_value="escaped-search") as escape_like,
            patch("services.dataset_service.TagService.get_target_ids_by_tag_ids") as get_target_ids,
        ):
            mock_db.paginate.return_value = SimpleNamespace(items=["dataset"], total=1)
            yield {
                "db": mock_db,
                "escape_like_pattern": escape_like,
                "get_target_ids": get_target_ids,
            }

    def test_get_datasets_returns_paginated_results_for_public_view(self, mock_dataset_query_dependencies):
        items, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id="tenant-1")

        assert items == ["dataset"]
        assert total == 1
        mock_dataset_query_dependencies["db"].paginate.assert_called_once()
        mock_dataset_query_dependencies["escape_like_pattern"].assert_not_called()

    def test_get_datasets_short_circuits_for_dataset_operator_without_permissions(
        self, mock_dataset_query_dependencies
    ):
        user = DatasetServiceUnitDataFactory.create_user_mock(role=TenantAccountRole.DATASET_OPERATOR)
        mock_dataset_query_dependencies["db"].session.query.return_value.filter_by.return_value.all.return_value = []

        items, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id="tenant-1", user=user)

        assert items == []
        assert total == 0
        mock_dataset_query_dependencies["db"].paginate.assert_not_called()

    def test_get_datasets_short_circuits_when_tag_lookup_returns_no_target_ids(self, mock_dataset_query_dependencies):
        mock_dataset_query_dependencies["get_target_ids"].return_value = []

        items, total = DatasetService.get_datasets(
            page=1,
            per_page=20,
            tenant_id="tenant-1",
            tag_ids=["tag-1"],
        )

        assert items == []
        assert total == 0
        mock_dataset_query_dependencies["get_target_ids"].assert_called_once_with("knowledge", "tenant-1", ["tag-1"])
        mock_dataset_query_dependencies["db"].paginate.assert_not_called()

    def test_get_datasets_search_and_tag_filters_call_collaborators(self, mock_dataset_query_dependencies):
        mock_dataset_query_dependencies["get_target_ids"].return_value = ["dataset-1"]

        items, total = DatasetService.get_datasets(
            page=2,
            per_page=10,
            tenant_id="tenant-1",
            search="report",
            tag_ids=["tag-1"],
        )

        assert items == ["dataset"]
        assert total == 1
        mock_dataset_query_dependencies["escape_like_pattern"].assert_called_once_with("report")
        mock_dataset_query_dependencies["get_target_ids"].assert_called_once_with("knowledge", "tenant-1", ["tag-1"])
        mock_dataset_query_dependencies["db"].paginate.assert_called_once()

    def test_get_process_rules_returns_latest_rule_when_present(self):
        dataset_process_rule = Mock(spec=DatasetProcessRule)
        dataset_process_rule.mode = "automatic"
        dataset_process_rule.rules_dict = {"delimiter": "\n"}

        with patch("services.dataset_service.db") as mock_db:
            (
                mock_db.session.query.return_value.where.return_value.order_by.return_value.limit.return_value.one_or_none.return_value
            ) = dataset_process_rule

            result = DatasetService.get_process_rules("dataset-1")

        assert result == {"mode": "automatic", "rules": {"delimiter": "\n"}}

    def test_get_process_rules_falls_back_to_default_rules_when_missing(self):
        with patch("services.dataset_service.db") as mock_db:
            (
                mock_db.session.query.return_value.where.return_value.order_by.return_value.limit.return_value.one_or_none.return_value
            ) = None

            result = DatasetService.get_process_rules("dataset-1")

        assert result == {
            "mode": DocumentService.DEFAULT_RULES["mode"],
            "rules": DocumentService.DEFAULT_RULES["rules"],
        }

    def test_get_datasets_by_ids_returns_empty_for_missing_ids(self):
        with patch("services.dataset_service.db") as mock_db:
            items, total = DatasetService.get_datasets_by_ids([], "tenant-1")

        assert items == []
        assert total == 0
        mock_db.paginate.assert_not_called()

    def test_get_datasets_by_ids_uses_paginate_for_non_empty_input(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.paginate.return_value = SimpleNamespace(items=["dataset-1"], total=1)

            items, total = DatasetService.get_datasets_by_ids(["dataset-1"], "tenant-1")

        assert items == ["dataset-1"]
        assert total == 1
        mock_db.paginate.assert_called_once()

    def test_get_dataset_returns_first_match(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = dataset

            result = DatasetService.get_dataset(dataset.id)

        assert result is dataset


class TestDatasetServiceValidation:
    """Unit tests for DatasetService validation helpers."""

    @pytest.mark.parametrize(
        ("dataset_doc_form", "incoming_doc_form"),
        [(None, "text_model"), ("text_model", "text_model")],
    )
    def test_check_doc_form_allows_matching_or_missing_dataset_doc_form(self, dataset_doc_form, incoming_doc_form):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(doc_form=dataset_doc_form)

        DatasetService.check_doc_form(dataset, incoming_doc_form)

    def test_check_doc_form_rejects_mismatched_doc_form(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(doc_form="qa_model")

        with pytest.raises(ValueError, match="doc_form is different"):
            DatasetService.check_doc_form(dataset, "text_model")

    def test_check_dataset_model_setting_skips_non_high_quality_datasets(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(indexing_technique="economy")

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            DatasetService.check_dataset_model_setting(dataset)

        model_manager_cls.assert_not_called()

    def test_check_dataset_model_setting_validates_embedding_model_for_high_quality_dataset(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(indexing_technique="high_quality")

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            DatasetService.check_dataset_model_setting(dataset)

        model_manager_cls.return_value.get_model_instance.assert_called_once_with(
            tenant_id=dataset.tenant_id,
            provider=dataset.embedding_model_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=dataset.embedding_model,
        )

    def test_check_dataset_model_setting_wraps_llm_bad_request_error(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(indexing_technique="high_quality")

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.return_value.get_model_instance.side_effect = LLMBadRequestError()

            with pytest.raises(ValueError, match="No Embedding Model available"):
                DatasetService.check_dataset_model_setting(dataset)

    def test_check_dataset_model_setting_wraps_provider_token_error(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(indexing_technique="high_quality")

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.return_value.get_model_instance.side_effect = ProviderTokenNotInitError("token missing")

            with pytest.raises(ValueError, match="token missing"):
                DatasetService.check_dataset_model_setting(dataset)

    def test_check_embedding_model_setting_wraps_provider_token_error_description(self):
        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.return_value.get_model_instance.side_effect = ProviderTokenNotInitError("provider setup")

            with pytest.raises(ValueError, match="provider setup"):
                DatasetService.check_embedding_model_setting("tenant-1", "provider", "embedding-model")

    def test_check_reranking_model_setting_uses_rerank_model_type(self):
        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            DatasetService.check_reranking_model_setting("tenant-1", "provider", "reranker")

        model_manager_cls.return_value.get_model_instance.assert_called_once_with(
            tenant_id="tenant-1",
            provider="provider",
            model_type=ModelType.RERANK,
            model="reranker",
        )

    def test_check_reranking_model_setting_wraps_bad_request(self):
        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.return_value.get_model_instance.side_effect = LLMBadRequestError()

            with pytest.raises(ValueError, match="No Rerank Model available"):
                DatasetService.check_reranking_model_setting("tenant-1", "provider", "reranker")

    def test_check_is_multimodal_model_returns_true_when_model_supports_vision(self):
        model_schema = SimpleNamespace(features=[ModelFeature.VISION])
        model_type_instance = MagicMock()
        model_type_instance.get_model_schema.return_value = model_schema
        model_instance = SimpleNamespace(
            model_type_instance=model_type_instance,
            model_name="embedding-model",
            credentials={"api_key": "secret"},
        )

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.return_value.get_model_instance.return_value = model_instance

            result = DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")

        assert result is True

    def test_check_is_multimodal_model_returns_false_when_vision_feature_is_absent(self):
        model_schema = SimpleNamespace(features=[])
        model_type_instance = MagicMock()
        model_type_instance.get_model_schema.return_value = model_schema
        model_instance = SimpleNamespace(
            model_type_instance=model_type_instance,
            model_name="embedding-model",
            credentials={"api_key": "secret"},
        )

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.return_value.get_model_instance.return_value = model_instance

            result = DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")

        assert result is False

    def test_check_is_multimodal_model_raises_when_schema_is_missing(self):
        model_type_instance = MagicMock()
        model_type_instance.get_model_schema.return_value = None
        model_instance = SimpleNamespace(
            model_type_instance=model_type_instance,
            model_name="embedding-model",
            credentials={"api_key": "secret"},
        )

        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.return_value.get_model_instance.return_value = model_instance

            with pytest.raises(ValueError, match="Model schema not found"):
                DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")

    def test_check_is_multimodal_model_wraps_bad_request_error(self):
        with patch("services.dataset_service.ModelManager") as model_manager_cls:
            model_manager_cls.return_value.get_model_instance.side_effect = LLMBadRequestError()

            with pytest.raises(ValueError, match="No Model available"):
                DatasetService.check_is_multimodal_model("tenant-1", "provider", "embedding-model")


class TestDatasetServiceCreationAndUpdate:
    """Unit tests for dataset creation and update helpers."""

    def test_create_empty_dataset_raises_when_name_already_exists(self):
        account = SimpleNamespace(id="user-1")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = object()

            with pytest.raises(DatasetNameDuplicateError, match="Dataset with name Dataset already exists"):
                DatasetService.create_empty_dataset("tenant-1", "Dataset", None, "economy", account)

    def test_create_empty_dataset_uses_default_embedding_model_for_high_quality_dataset(self):
        account = SimpleNamespace(id="user-1")
        default_embedding_model = SimpleNamespace(provider="provider", model_name="default-embedding")

        with (
            patch("services.dataset_service.db") as mock_db,
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: SimpleNamespace(id="dataset-1", **kwargs),
            ),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(DatasetService, "check_embedding_model_setting") as check_embedding,
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None
            model_manager_cls.return_value.get_default_model_instance.return_value = default_embedding_model

            dataset = DatasetService.create_empty_dataset(
                tenant_id="tenant-1",
                name="Dataset",
                description="Description",
                indexing_technique="high_quality",
                account=account,
            )

        assert dataset.embedding_model_provider == "provider"
        assert dataset.embedding_model == "default-embedding"
        assert dataset.permission == DatasetPermissionEnum.ONLY_ME
        assert dataset.provider == "vendor"
        model_manager_cls.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id="tenant-1",
            model_type=ModelType.TEXT_EMBEDDING,
        )
        check_embedding.assert_not_called()
        mock_db.session.commit.assert_called_once()

    def test_create_empty_dataset_creates_external_binding_for_high_quality_dataset(self):
        account = SimpleNamespace(id="user-1")
        retrieval_model = _make_retrieval_model()
        embedding_model = SimpleNamespace(provider="provider", model_name="embedding-model")

        with (
            patch("services.dataset_service.db") as mock_db,
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: SimpleNamespace(id="dataset-1", **kwargs),
            ),
            patch(
                "services.dataset_service.ExternalKnowledgeBindings",
                side_effect=lambda **kwargs: SimpleNamespace(**kwargs),
            ) as binding_cls,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.ExternalDatasetService.get_external_knowledge_api", return_value=object()),
            patch.object(DatasetService, "check_embedding_model_setting") as check_embedding,
            patch.object(DatasetService, "check_reranking_model_setting") as check_reranking,
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None
            model_manager_cls.return_value.get_model_instance.return_value = embedding_model

            dataset = DatasetService.create_empty_dataset(
                tenant_id="tenant-1",
                name="External Dataset",
                description="Description",
                indexing_technique="high_quality",
                account=account,
                permission=DatasetPermissionEnum.ALL_TEAM,
                provider="external",
                external_knowledge_api_id="api-1",
                external_knowledge_id="knowledge-1",
                embedding_model_provider="provider",
                embedding_model_name="embedding-model",
                retrieval_model=retrieval_model,
                summary_index_setting={"enable": True},
            )

        assert dataset.embedding_model_provider == "provider"
        assert dataset.embedding_model == "embedding-model"
        assert dataset.retrieval_model == retrieval_model.model_dump()
        assert dataset.summary_index_setting == {"enable": True}
        check_embedding.assert_called_once_with("tenant-1", "provider", "embedding-model")
        check_reranking.assert_called_once_with("tenant-1", "rerank-provider", "rerank-model")
        binding_cls.assert_called_once_with(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            external_knowledge_api_id="api-1",
            external_knowledge_id="knowledge-1",
            created_by="user-1",
        )
        assert mock_db.session.add.call_count == 2
        mock_db.session.commit.assert_called_once()

    def test_create_empty_rag_pipeline_dataset_raises_for_duplicate_name(self):
        entity = RagPipelineDatasetCreateEntity(
            name="Existing Dataset",
            description="Description",
            icon_info=PipelineIconInfo(icon="book", icon_background="#fff"),
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = object()

            with pytest.raises(DatasetNameDuplicateError, match="Existing Dataset already exists"):
                DatasetService.create_empty_rag_pipeline_dataset("tenant-1", entity)

    def test_create_empty_rag_pipeline_dataset_generates_name_and_creates_dataset(self):
        entity = RagPipelineDatasetCreateEntity(
            name="",
            description="Description",
            icon_info=PipelineIconInfo(icon="book", icon_background="#fff"),
            permission=DatasetPermissionEnum.ALL_TEAM,
        )
        pipeline = SimpleNamespace(id="pipeline-1")

        def pipeline_factory(**kwargs):
            pipeline.__dict__.update(kwargs)
            return pipeline

        def dataset_factory(**kwargs):
            return SimpleNamespace(id="dataset-1", **kwargs)

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.current_user", SimpleNamespace(id="user-1")),
            patch("services.dataset_service.generate_incremental_name", return_value="Untitled 2") as generate_name,
            patch("services.dataset_service.Pipeline", side_effect=pipeline_factory),
            patch("services.dataset_service.Dataset", side_effect=dataset_factory),
        ):
            mock_db.session.query.return_value.filter_by.return_value.all.return_value = [
                SimpleNamespace(name="Untitled"),
                SimpleNamespace(name="Untitled 1"),
            ]

            dataset = DatasetService.create_empty_rag_pipeline_dataset("tenant-1", entity)

        assert entity.name == "Untitled 2"
        assert dataset.pipeline_id == "pipeline-1"
        assert dataset.runtime_mode == "rag_pipeline"
        generate_name.assert_called_once_with(["Untitled", "Untitled 1"], "Untitled")
        mock_db.session.commit.assert_called_once()

    def test_create_empty_rag_pipeline_dataset_requires_current_user_id(self):
        entity = RagPipelineDatasetCreateEntity(
            name="Dataset",
            description="Description",
            icon_info=PipelineIconInfo(icon="book", icon_background="#fff"),
            permission=DatasetPermissionEnum.ALL_TEAM,
        )

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.current_user", SimpleNamespace(id=None)),
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

            with pytest.raises(ValueError, match="Current user or current user id not found"):
                DatasetService.create_empty_rag_pipeline_dataset("tenant-1", entity)

    def test_update_dataset_raises_when_dataset_is_missing(self):
        with patch.object(DatasetService, "get_dataset", return_value=None):
            with pytest.raises(ValueError, match="Dataset not found"):
                DatasetService.update_dataset("dataset-1", {}, SimpleNamespace(id="user-1"))

    def test_update_dataset_raises_when_new_name_conflicts(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1", tenant_id="tenant-1")
        dataset.name = "Old Dataset"

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "_has_dataset_same_name", return_value=True),
        ):
            with pytest.raises(ValueError, match="Dataset name already exists"):
                DatasetService.update_dataset("dataset-1", {"name": "New Dataset"}, SimpleNamespace(id="user-1"))

    def test_update_dataset_routes_external_datasets_to_external_helper(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1", tenant_id="tenant-1")
        dataset.provider = "external"
        user = DatasetServiceUnitDataFactory.create_user_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission") as check_permission,
            patch.object(DatasetService, "_update_external_dataset", return_value="updated") as update_external,
        ):
            result = DatasetService.update_dataset("dataset-1", {"name": dataset.name}, user)

        assert result == "updated"
        check_permission.assert_called_once_with(dataset, user)
        update_external.assert_called_once_with(dataset, {"name": dataset.name}, user)

    def test_update_dataset_routes_internal_datasets_to_internal_helper(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1", tenant_id="tenant-1")
        dataset.provider = "vendor"
        user = DatasetServiceUnitDataFactory.create_user_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission") as check_permission,
            patch.object(DatasetService, "_update_internal_dataset", return_value="updated") as update_internal,
        ):
            result = DatasetService.update_dataset("dataset-1", {"name": dataset.name}, user)

        assert result == "updated"
        check_permission.assert_called_once_with(dataset, user)
        update_internal.assert_called_once_with(dataset, {"name": dataset.name}, user)

    def test_has_dataset_same_name_returns_true_when_query_matches(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.first.return_value = object()

            result = DatasetService._has_dataset_same_name("tenant-1", "dataset-1", "Dataset")

        assert result is True

    def test_update_external_dataset_updates_dataset_and_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        user = SimpleNamespace(id="user-1")
        now = object()

        with (
            patch.object(DatasetService, "_update_external_knowledge_binding") as update_binding,
            patch("services.dataset_service.naive_utc_now", return_value=now),
            patch("services.dataset_service.db") as mock_db,
        ):
            result = DatasetService._update_external_dataset(
                dataset,
                {
                    "external_retrieval_model": {"top_k": 3},
                    "summary_index_setting": {"enable": True},
                    "name": "Updated Dataset",
                    "description": "Updated description",
                    "permission": DatasetPermissionEnum.PARTIAL_TEAM,
                    "external_knowledge_id": "knowledge-1",
                    "external_knowledge_api_id": "api-1",
                },
                user,
            )

        assert result is dataset
        assert dataset.retrieval_model == {"top_k": 3}
        assert dataset.summary_index_setting == {"enable": True}
        assert dataset.name == "Updated Dataset"
        assert dataset.description == "Updated description"
        assert dataset.permission == DatasetPermissionEnum.PARTIAL_TEAM
        assert dataset.updated_by == "user-1"
        assert dataset.updated_at is now
        update_binding.assert_called_once_with("dataset-1", "knowledge-1", "api-1")
        mock_db.session.add.assert_called_once_with(dataset)
        mock_db.session.commit.assert_called_once()

    @pytest.mark.parametrize(
        ("payload", "message"),
        [
            ({"external_knowledge_api_id": "api-1"}, "External knowledge id is required"),
            ({"external_knowledge_id": "knowledge-1"}, "External knowledge api id is required"),
        ],
    )
    def test_update_external_dataset_requires_external_binding_fields(self, payload, message):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")

        with pytest.raises(ValueError, match=message):
            DatasetService._update_external_dataset(dataset, payload, SimpleNamespace(id="user-1"))

    def test_update_external_knowledge_binding_updates_changed_binding_values(self):
        binding = SimpleNamespace(external_knowledge_id="old-knowledge", external_knowledge_api_id="old-api")
        session = MagicMock()
        session.query.return_value.filter_by.return_value.first.return_value = binding
        session_context = _make_session_context(session)

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.Session", return_value=session_context),
        ):
            DatasetService._update_external_knowledge_binding("dataset-1", "new-knowledge", "new-api")

        assert binding.external_knowledge_id == "new-knowledge"
        assert binding.external_knowledge_api_id == "new-api"
        mock_db.session.add.assert_called_once_with(binding)

    def test_update_external_knowledge_binding_raises_for_missing_binding(self):
        session = MagicMock()
        session.query.return_value.filter_by.return_value.first.return_value = None
        session_context = _make_session_context(session)

        with (
            patch("services.dataset_service.db"),
            patch("services.dataset_service.Session", return_value=session_context),
        ):
            with pytest.raises(ValueError, match="External knowledge binding not found"):
                DatasetService._update_external_knowledge_binding("dataset-1", "knowledge-1", "api-1")

    def test_update_internal_dataset_updates_fields_and_dispatches_regeneration_tasks(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        user = SimpleNamespace(id="user-1")
        now = object()
        update_payload = {
            "name": "Updated Dataset",
            "description": None,
            "partial_member_list": [{"user_id": "member-1"}],
            "external_knowledge_api_id": "api-1",
            "external_knowledge_id": "knowledge-1",
            "external_retrieval_model": {"top_k": 2},
            "retrieval_model": {"top_k": 4},
            "summary_index_setting": {"enable": True},
            "icon_info": {"icon": "book"},
        }

        with (
            patch.object(DatasetService, "_handle_indexing_technique_change", return_value="update"),
            patch.object(DatasetService, "_update_pipeline_knowledge_base_node_data") as update_pipeline,
            patch("services.dataset_service.naive_utc_now", return_value=now),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.deal_dataset_vector_index_task") as vector_task,
            patch("services.dataset_service.regenerate_summary_index_task") as regenerate_task,
        ):
            result = DatasetService._update_internal_dataset(dataset, update_payload.copy(), user)

        assert result is dataset
        updated_values = mock_db.session.query.return_value.filter_by.return_value.update.call_args.args[0]
        assert updated_values["name"] == "Updated Dataset"
        assert updated_values["description"] is None
        assert updated_values["retrieval_model"] == {"top_k": 4}
        assert updated_values["summary_index_setting"] == {"enable": True}
        assert updated_values["icon_info"] == {"icon": "book"}
        assert updated_values["updated_by"] == "user-1"
        assert updated_values["updated_at"] is now
        assert "partial_member_list" not in updated_values
        assert "external_knowledge_api_id" not in updated_values
        assert "external_knowledge_id" not in updated_values
        assert "external_retrieval_model" not in updated_values
        mock_db.session.commit.assert_called_once()
        mock_db.session.refresh.assert_called_once_with(dataset)
        update_pipeline.assert_called_once_with(dataset, "user-1")
        vector_task.delay.assert_called_once_with("dataset-1", "update")
        regenerate_task.delay.assert_called_once_with(
            "dataset-1",
            regenerate_reason="embedding_model_changed",
            regenerate_vectors_only=True,
        )

    def test_update_pipeline_knowledge_base_node_data_returns_early_for_non_pipeline_dataset(self):
        dataset = SimpleNamespace(runtime_mode="workflow", pipeline_id="pipeline-1")

        with patch("services.dataset_service.db") as mock_db:
            DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-1")

        mock_db.session.query.assert_not_called()

    def test_update_pipeline_knowledge_base_node_data_returns_when_pipeline_is_missing(self):
        dataset = SimpleNamespace(runtime_mode="rag_pipeline", pipeline_id="pipeline-1")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

            DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-1")

        mock_db.session.commit.assert_not_called()

    def test_update_pipeline_knowledge_base_node_data_updates_published_and_draft_workflows(self):
        dataset = SimpleNamespace(
            id="dataset-1",
            runtime_mode="rag_pipeline",
            pipeline_id="pipeline-1",
            embedding_model="embedding-model",
            embedding_model_provider="provider",
            retrieval_model={"top_k": 5},
            chunk_structure="paragraph",
            indexing_technique="high_quality",
            keyword_number=8,
            summary_index_setting={"enable": True},
        )
        pipeline = SimpleNamespace(id="pipeline-1", tenant_id="tenant-1")
        published_workflow = SimpleNamespace(
            graph=json.dumps({"nodes": [{"data": {"type": "knowledge-index"}}, {"data": {"type": "start"}}]}),
            type="chat",
            features={"feature": True},
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        draft_workflow = SimpleNamespace(graph=json.dumps({"nodes": [{"data": {"type": "knowledge-index"}}]}))
        new_workflow = SimpleNamespace(id="workflow-1")
        rag_pipeline_service = MagicMock()
        rag_pipeline_service.get_published_workflow.return_value = published_workflow
        rag_pipeline_service.get_draft_workflow.return_value = draft_workflow

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.RagPipelineService", return_value=rag_pipeline_service),
            patch("services.dataset_service.Workflow.new", return_value=new_workflow) as workflow_new,
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = pipeline

            DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-1")

        published_graph = json.loads(workflow_new.call_args.kwargs["graph"])
        assert published_graph["nodes"][0]["data"]["embedding_model"] == "embedding-model"
        assert published_graph["nodes"][0]["data"]["summary_index_setting"] == {"enable": True}
        assert json.loads(draft_workflow.graph)["nodes"][0]["data"]["embedding_model_provider"] == "provider"
        mock_db.session.add.assert_any_call(new_workflow)
        mock_db.session.add.assert_any_call(draft_workflow)
        mock_db.session.commit.assert_called_once()

    def test_update_pipeline_knowledge_base_node_data_rolls_back_when_update_fails(self):
        dataset = SimpleNamespace(runtime_mode="rag_pipeline", pipeline_id="pipeline-1")
        pipeline = SimpleNamespace(id="pipeline-1", tenant_id="tenant-1")
        rag_pipeline_service = MagicMock()
        rag_pipeline_service.get_published_workflow.side_effect = RuntimeError("boom")

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.RagPipelineService", return_value=rag_pipeline_service),
        ):
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = pipeline

            with pytest.raises(RuntimeError, match="boom"):
                DatasetService._update_pipeline_knowledge_base_node_data(dataset, "user-1")

        mock_db.session.rollback.assert_called_once()

    def test_handle_indexing_technique_change_returns_none_without_indexing_technique(self):
        filtered_data: dict[str, object] = {}
        dataset = SimpleNamespace(indexing_technique="economy")

        result = DatasetService._handle_indexing_technique_change(dataset, {}, filtered_data)

        assert result is None
        assert filtered_data == {}

    def test_handle_indexing_technique_change_switches_to_economy(self):
        filtered_data: dict[str, object] = {}
        dataset = SimpleNamespace(indexing_technique="high_quality")

        result = DatasetService._handle_indexing_technique_change(
            dataset,
            {"indexing_technique": "economy"},
            filtered_data,
        )

        assert result == "remove"
        assert filtered_data == {
            "embedding_model": None,
            "embedding_model_provider": None,
            "collection_binding_id": None,
        }

    def test_handle_indexing_technique_change_switches_to_high_quality(self):
        filtered_data: dict[str, object] = {}
        dataset = SimpleNamespace(indexing_technique="economy")

        with patch.object(DatasetService, "_configure_embedding_model_for_high_quality") as configure_embedding:
            result = DatasetService._handle_indexing_technique_change(
                dataset,
                {"indexing_technique": "high_quality"},
                filtered_data,
            )

        assert result == "add"
        configure_embedding.assert_called_once_with({"indexing_technique": "high_quality"}, filtered_data)

    def test_handle_indexing_technique_change_delegates_when_technique_is_unchanged(self):
        filtered_data: dict[str, object] = {}
        dataset = SimpleNamespace(indexing_technique="high_quality")

        with patch.object(
            DatasetService,
            "_handle_embedding_model_update_when_technique_unchanged",
            return_value="update",
        ) as update_embedding:
            result = DatasetService._handle_indexing_technique_change(
                dataset,
                {"indexing_technique": "high_quality"},
                filtered_data,
            )

        assert result == "update"
        update_embedding.assert_called_once_with(dataset, {"indexing_technique": "high_quality"}, filtered_data)

    def test_configure_embedding_model_for_high_quality_updates_filtered_data(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        embedding_model = SimpleNamespace(provider="provider", model_name="embedding-model")
        filtered_data: dict[str, object] = {}

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ),
        ):
            model_manager_cls.return_value.get_model_instance.return_value = embedding_model

            DatasetService._configure_embedding_model_for_high_quality(
                {"embedding_model_provider": "provider", "embedding_model": "embedding-model"},
                filtered_data,
            )

        assert filtered_data == {
            "embedding_model": "embedding-model",
            "embedding_model_provider": "provider",
            "collection_binding_id": "binding-1",
        }

    @pytest.mark.parametrize(
        ("error", "message"),
        [
            (LLMBadRequestError(), "No Embedding Model available"),
            (ProviderTokenNotInitError("provider setup"), "provider setup"),
        ],
    )
    def test_configure_embedding_model_for_high_quality_wraps_model_errors(self, error, message):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
        ):
            model_manager_cls.return_value.get_model_instance.side_effect = error

            with pytest.raises(ValueError, match=message):
                DatasetService._configure_embedding_model_for_high_quality(
                    {"embedding_model_provider": "provider", "embedding_model": "embedding-model"},
                    {},
                )

    def test_handle_embedding_model_update_when_technique_unchanged_preserves_existing_settings(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )
        filtered_data: dict[str, object] = {}

        with patch.object(DatasetService, "_preserve_existing_embedding_settings") as preserve_settings:
            result = DatasetService._handle_embedding_model_update_when_technique_unchanged(
                dataset,
                {},
                filtered_data,
            )

        assert result is None
        preserve_settings.assert_called_once_with(dataset, filtered_data)

    def test_handle_embedding_model_update_when_technique_unchanged_updates_when_model_is_provided(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )

        with patch.object(DatasetService, "_update_embedding_model_settings", return_value="update") as update_settings:
            result = DatasetService._handle_embedding_model_update_when_technique_unchanged(
                dataset,
                {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                {},
            )

        assert result == "update"
        update_settings.assert_called_once()

    def test_preserve_existing_embedding_settings_keeps_current_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
            collection_binding_id="binding-1",
        )
        filtered_data = {"embedding_model_provider": "", "embedding_model": ""}

        DatasetService._preserve_existing_embedding_settings(dataset, filtered_data)

        assert filtered_data == {
            "embedding_model_provider": "provider",
            "embedding_model": "embedding-model",
            "collection_binding_id": "binding-1",
        }

    def test_preserve_existing_embedding_settings_removes_empty_placeholders_without_existing_values(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider=None,
            embedding_model=None,
            collection_binding_id=None,
        )
        filtered_data = {"embedding_model_provider": "", "embedding_model": ""}

        DatasetService._preserve_existing_embedding_settings(dataset, filtered_data)

        assert filtered_data == {}

    def test_update_embedding_model_settings_returns_update_for_changed_values(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )

        with patch.object(DatasetService, "_apply_new_embedding_settings") as apply_settings:
            result = DatasetService._update_embedding_model_settings(
                dataset,
                {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                {},
            )

        assert result == "update"
        apply_settings.assert_called_once()

    def test_update_embedding_model_settings_returns_none_for_unchanged_values(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )

        result = DatasetService._update_embedding_model_settings(
            dataset,
            {"embedding_model_provider": "provider", "embedding_model": "embedding-model"},
            {},
        )

        assert result is None

    def test_update_embedding_model_settings_wraps_bad_request_errors(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
        )

        with patch.object(DatasetService, "_apply_new_embedding_settings", side_effect=LLMBadRequestError()):
            with pytest.raises(ValueError, match="No Embedding Model available"):
                DatasetService._update_embedding_model_settings(
                    dataset,
                    {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                    {},
                )

    def test_apply_new_embedding_settings_updates_binding_for_new_model(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(collection_binding_id="binding-1")
        filtered_data: dict[str, object] = {}

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-2"),
            ),
        ):
            model_manager_cls.return_value.get_model_instance.return_value = SimpleNamespace(
                provider="provider-two",
                model_name="embedding-model-two",
            )

            DatasetService._apply_new_embedding_settings(
                dataset,
                {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                filtered_data,
            )

        assert filtered_data == {
            "embedding_model": "embedding-model-two",
            "embedding_model_provider": "provider-two",
            "collection_binding_id": "binding-2",
        }

    def test_apply_new_embedding_settings_preserves_existing_values_when_provider_token_is_missing(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            embedding_model_provider="provider",
            embedding_model="embedding-model",
            collection_binding_id="binding-1",
        )
        filtered_data: dict[str, object] = {}

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
        ):
            model_manager_cls.return_value.get_model_instance.side_effect = ProviderTokenNotInitError("token missing")

            DatasetService._apply_new_embedding_settings(
                dataset,
                {"embedding_model_provider": "provider-two", "embedding_model": "embedding-model-two"},
                filtered_data,
            )

        assert filtered_data == {
            "embedding_model_provider": "provider",
            "embedding_model": "embedding-model",
            "collection_binding_id": "binding-1",
        }

    @pytest.mark.parametrize(
        ("summary_index_setting", "expected"),
        [
            (None, False),
            ({"enable": False}, False),
            ({"enable": True, "model_name": "old-model", "model_provider_name": "provider"}, False),
            ({"enable": True, "model_name": "new-model", "model_provider_name": "provider-two"}, True),
        ],
    )
    def test_check_summary_index_setting_model_changed(self, summary_index_setting, expected):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            dataset_id="dataset-1",
            summary_index_setting={"enable": True, "model_name": "old-model", "model_provider_name": "provider"},
        )

        result = DatasetService._check_summary_index_setting_model_changed(
            dataset,
            {"summary_index_setting": summary_index_setting} if summary_index_setting is not None else {},
        )

        assert result is expected


class TestDatasetServiceRagPipelineSettings:
    """Unit tests for rag-pipeline dataset setting updates."""

    def test_update_rag_pipeline_dataset_settings_requires_current_tenant(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        knowledge_configuration = _make_knowledge_configuration()

        with patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id=None)):
            with pytest.raises(ValueError, match="Current user or current tenant not found"):
                DatasetService.update_rag_pipeline_dataset_settings(session, dataset, knowledge_configuration)

    def test_update_rag_pipeline_dataset_settings_without_published_high_quality_updates_embedding_settings(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(summary_index_setting={"enable": True})
        embedding_model = SimpleNamespace(provider="provider", model_name="embedding-model")

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(DatasetService, "check_is_multimodal_model", return_value=True) as check_multimodal,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ),
        ):
            model_manager_cls.return_value.get_model_instance.return_value = embedding_model

            DatasetService.update_rag_pipeline_dataset_settings(session, dataset, knowledge_configuration)

        assert dataset.chunk_structure == "paragraph"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "embedding-model"
        assert dataset.embedding_model_provider == "provider"
        assert dataset.collection_binding_id == "binding-1"
        assert dataset.is_multimodal is True
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        assert dataset.summary_index_setting == {"enable": True}
        check_multimodal.assert_called_once_with("tenant-1", "provider", "embedding-model")
        session.add.assert_called_once_with(dataset)
        session.commit.assert_not_called()

    def test_update_rag_pipeline_dataset_settings_without_published_economy_updates_keyword_number(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            indexing_technique="economy",
            embedding_model_provider="",
            embedding_model="",
            keyword_number=12,
        )

        with patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")):
            DatasetService.update_rag_pipeline_dataset_settings(session, dataset, knowledge_configuration)

        assert dataset.indexing_technique == "economy"
        assert dataset.keyword_number == 12
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        session.add.assert_called_once_with(dataset)

    def test_update_rag_pipeline_dataset_settings_with_published_rejects_chunk_structure_changes(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(chunk_structure="sentence")

        with patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")):
            with pytest.raises(ValueError, match="Chunk structure is not allowed to be updated"):
                DatasetService.update_rag_pipeline_dataset_settings(
                    session,
                    dataset,
                    knowledge_configuration,
                    has_published=True,
                )

    def test_update_rag_pipeline_dataset_settings_with_published_rejects_switch_to_economy(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "high_quality"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            indexing_technique="economy",
            embedding_model_provider="",
            embedding_model="",
        )

        with patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")):
            with pytest.raises(
                ValueError,
                match="Knowledge base indexing technique is not allowed to be updated to economy",
            ):
                DatasetService.update_rag_pipeline_dataset_settings(
                    session,
                    dataset,
                    knowledge_configuration,
                    has_published=True,
                )

    def test_update_rag_pipeline_dataset_settings_with_published_adds_high_quality_index(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "economy"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration()
        embedding_model = SimpleNamespace(provider="provider", model_name="embedding-model")

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(DatasetService, "check_is_multimodal_model", return_value=False),
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ),
            patch("services.dataset_service.deal_dataset_index_update_task") as update_task,
        ):
            model_manager_cls.return_value.get_model_instance.return_value = embedding_model

            DatasetService.update_rag_pipeline_dataset_settings(
                session,
                dataset,
                knowledge_configuration,
                has_published=True,
            )

        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "embedding-model"
        assert dataset.embedding_model_provider == "provider"
        assert dataset.collection_binding_id == "binding-1"
        assert dataset.is_multimodal is False
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        session.add.assert_called_once_with(dataset)
        session.commit.assert_called_once()
        update_task.delay.assert_called_once_with("dataset-1", "add")

    def test_update_rag_pipeline_dataset_settings_with_published_updates_changed_embedding_model(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider"
        dataset.embedding_model = "embedding-model"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            embedding_model_provider="provider-two",
            embedding_model="embedding-model-two",
            summary_index_setting={"enable": True},
        )

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch.object(DatasetService, "check_is_multimodal_model", return_value=True),
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-2"),
            ),
            patch("services.dataset_service.deal_dataset_index_update_task") as update_task,
        ):
            model_manager_cls.return_value.get_model_instance.return_value = SimpleNamespace(
                provider="provider-two",
                model_name="embedding-model-two",
            )

            DatasetService.update_rag_pipeline_dataset_settings(
                session,
                dataset,
                knowledge_configuration,
                has_published=True,
            )

        assert dataset.embedding_model_provider == "provider-two"
        assert dataset.embedding_model == "embedding-model-two"
        assert dataset.collection_binding_id == "binding-2"
        assert dataset.is_multimodal is True
        assert dataset.summary_index_setting == {"enable": True}
        session.add.assert_called_once_with(dataset)
        session.commit.assert_called_once()
        update_task.delay.assert_called_once_with("dataset-1", "update")

    def test_update_rag_pipeline_dataset_settings_with_published_skips_embedding_update_when_token_is_missing(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "provider"
        dataset.embedding_model = "embedding-model"
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            embedding_model_provider="provider-two",
            embedding_model="embedding-model-two",
        )

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.deal_dataset_index_update_task") as update_task,
        ):
            model_manager_cls.return_value.get_model_instance.side_effect = ProviderTokenNotInitError("token missing")

            DatasetService.update_rag_pipeline_dataset_settings(
                session,
                dataset,
                knowledge_configuration,
                has_published=True,
            )

        assert dataset.embedding_model_provider == "provider"
        assert dataset.embedding_model == "embedding-model"
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        session.add.assert_called_once_with(dataset)
        session.commit.assert_called_once()
        update_task.delay.assert_called_once_with("dataset-1", "update")

    def test_update_rag_pipeline_dataset_settings_with_published_updates_economy_keyword_number(self):
        session = MagicMock()
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(dataset_id="dataset-1")
        dataset.chunk_structure = "paragraph"
        dataset.indexing_technique = "economy"
        dataset.keyword_number = 5
        session.merge.return_value = dataset
        knowledge_configuration = _make_knowledge_configuration(
            indexing_technique="economy",
            embedding_model_provider="",
            embedding_model="",
            keyword_number=9,
        )

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(current_tenant_id="tenant-1")),
            patch("services.dataset_service.deal_dataset_index_update_task") as update_task,
        ):
            DatasetService.update_rag_pipeline_dataset_settings(
                session,
                dataset,
                knowledge_configuration,
                has_published=True,
            )

        assert dataset.keyword_number == 9
        assert dataset.retrieval_model == knowledge_configuration.retrieval_model.model_dump()
        session.add.assert_called_once_with(dataset)
        session.commit.assert_called_once()
        update_task.delay.assert_not_called()


class TestDatasetServicePermissionsAndLifecycle:
    """Unit tests for dataset permissions, deletion, and metadata helpers."""

    def test_delete_dataset_returns_false_when_dataset_is_missing(self):
        with patch.object(DatasetService, "get_dataset", return_value=None):
            result = DatasetService.delete_dataset("dataset-1", user=SimpleNamespace(id="user-1"))

        assert result is False

    def test_delete_dataset_checks_permission_and_deletes_dataset(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission") as check_permission,
            patch("services.dataset_service.dataset_was_deleted.send") as send_deleted_signal,
            patch("services.dataset_service.db") as mock_db,
        ):
            result = DatasetService.delete_dataset(dataset.id, user=SimpleNamespace(id="user-1"))

        assert result is True
        check_permission.assert_called_once_with(dataset, SimpleNamespace(id="user-1"))
        send_deleted_signal.assert_called_once_with(dataset)
        mock_db.session.delete.assert_called_once_with(dataset)
        mock_db.session.commit.assert_called_once()

    def test_dataset_use_check_returns_scalar_result(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.execute.return_value.scalar_one.return_value = True

            result = DatasetService.dataset_use_check("dataset-1")

        assert result is True

    def test_check_dataset_permission_rejects_cross_tenant_access(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(tenant_id="tenant-a")
        user = DatasetServiceUnitDataFactory.create_user_mock(tenant_id="tenant-b")

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_rejects_only_me_dataset_for_non_creator(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="owner-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_rejects_partial_team_user_without_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="owner-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

            with pytest.raises(NoPermissionError, match="do not have permission"):
                DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_permission_allows_partial_team_creator_without_lookup(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="creator-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="creator-1",
            role=TenantAccountRole.EDITOR,
        )

        with patch("services.dataset_service.db") as mock_db:
            DatasetService.check_dataset_permission(dataset, user)

        mock_db.session.query.assert_not_called()

    def test_check_dataset_permission_allows_partial_team_member_with_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            created_by="owner-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.first.return_value = object()

            DatasetService.check_dataset_permission(dataset, user)

    def test_check_dataset_operator_permission_validates_required_arguments(self):
        with pytest.raises(ValueError, match="Dataset not found"):
            DatasetService.check_dataset_operator_permission(user=SimpleNamespace(id="user-1"), dataset=None)

        with pytest.raises(ValueError, match="User not found"):
            DatasetService.check_dataset_operator_permission(user=None, dataset=SimpleNamespace(id="dataset-1"))

    def test_check_dataset_operator_permission_rejects_only_me_for_non_creator(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by="owner-1",
        )
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with pytest.raises(NoPermissionError, match="do not have permission"):
            DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    def test_check_dataset_operator_permission_rejects_partial_team_without_binding(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(permission=DatasetPermissionEnum.PARTIAL_TEAM)
        user = DatasetServiceUnitDataFactory.create_user_mock(
            user_id="member-1",
            role=TenantAccountRole.EDITOR,
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.all.return_value = []

            with pytest.raises(NoPermissionError, match="do not have permission"):
                DatasetService.check_dataset_operator_permission(user=user, dataset=dataset)

    def test_get_dataset_queries_delegates_to_paginate(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.desc.side_effect = lambda column: column
            mock_db.paginate.return_value = SimpleNamespace(items=["query"], total=1)

            items, total = DatasetService.get_dataset_queries("dataset-1", page=1, per_page=20)

        assert items == ["query"]
        assert total == 1
        mock_db.paginate.assert_called_once()

    def test_get_related_apps_returns_ordered_query_results(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.desc.side_effect = lambda column: column
            mock_db.session.query.return_value.where.return_value.order_by.return_value.all.return_value = [
                "relation-1"
            ]

            result = DatasetService.get_related_apps("dataset-1")

        assert result == ["relation-1"]

    def test_update_dataset_api_status_raises_not_found_for_missing_dataset(self):
        with patch.object(DatasetService, "get_dataset", return_value=None):
            with pytest.raises(NotFound, match="Dataset not found"):
                DatasetService.update_dataset_api_status("dataset-1", True)

    def test_update_dataset_api_status_requires_current_user_id(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(enable_api=False)

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch("services.dataset_service.current_user", SimpleNamespace(id=None)),
        ):
            with pytest.raises(ValueError, match="Current user or current user id not found"):
                DatasetService.update_dataset_api_status(dataset.id, True)

    def test_update_dataset_api_status_updates_fields_and_commits(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(enable_api=False)
        now = object()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch("services.dataset_service.current_user", SimpleNamespace(id="user-1")),
            patch("services.dataset_service.naive_utc_now", return_value=now),
            patch("services.dataset_service.db") as mock_db,
        ):
            DatasetService.update_dataset_api_status(dataset.id, True)

        assert dataset.enable_api is True
        assert dataset.updated_by == "user-1"
        assert dataset.updated_at is now
        mock_db.session.commit.assert_called_once()

    def test_get_dataset_auto_disable_logs_returns_empty_when_billing_is_disabled(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False, subscription=SimpleNamespace(plan=CloudPlan.PROFESSIONAL))
        )

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.FeatureService.get_features", return_value=features),
            patch("services.dataset_service.db") as mock_db,
        ):
            result = DatasetService.get_dataset_auto_disable_logs("dataset-1")

        assert result == {"document_ids": [], "count": 0}
        mock_db.session.scalars.assert_not_called()

    def test_get_dataset_auto_disable_logs_returns_recent_document_ids(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        logs = [SimpleNamespace(document_id="doc-1"), SimpleNamespace(document_id="doc-2")]
        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=True, subscription=SimpleNamespace(plan=CloudPlan.PROFESSIONAL))
        )

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.FeatureService.get_features", return_value=features),
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_db.session.scalars.return_value.all.return_value = logs

            result = DatasetService.get_dataset_auto_disable_logs("dataset-1")

        assert result == {"document_ids": ["doc-1", "doc-2"], "count": 2}


class TestDocumentServiceDisplayStatus:
    """Unit tests for DocumentService display-status helpers."""

    @pytest.mark.parametrize(
        ("raw_status", "expected"),
        [
            ("enabled", "available"),
            ("AVAILABLE", "available"),
            ("paused", "paused"),
            ("unknown", None),
            (None, None),
        ],
    )
    def test_normalize_display_status(self, raw_status, expected):
        assert DocumentService.normalize_display_status(raw_status) == expected

    def test_build_display_status_filters_returns_empty_tuple_for_unknown_status(self):
        assert DocumentService.build_display_status_filters("missing") == ()

    def test_apply_display_status_filter_returns_original_query_for_unknown_status(self):
        query = MagicMock()

        result = DocumentService.apply_display_status_filter(query, "missing")

        assert result is query
        query.where.assert_not_called()

    def test_apply_display_status_filter_applies_where_for_known_status(self):
        query = MagicMock()
        filtered_query = MagicMock()
        query.where.return_value = filtered_query

        result = DocumentService.apply_display_status_filter(query, "enabled")

        assert result is filtered_query
        query.where.assert_called_once()


class TestDocumentServiceQueryAndDownloadHelpers:
    """Unit tests for DocumentService query helpers and download flows."""

    def test_get_document_returns_none_when_document_id_is_missing(self):
        with patch("services.dataset_service.db") as mock_db:
            result = DocumentService.get_document("dataset-1", None)

        assert result is None
        mock_db.session.query.assert_not_called()

    def test_get_document_queries_by_dataset_and_document_id(self):
        document = DatasetServiceUnitDataFactory.create_document_mock()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.first.return_value = document

            result = DocumentService.get_document("dataset-1", "doc-1")

        assert result is document

    def test_get_documents_by_ids_returns_empty_for_empty_input(self):
        with patch("services.dataset_service.db") as mock_db:
            result = DocumentService.get_documents_by_ids("dataset-1", [])

        assert result == []
        mock_db.session.scalars.assert_not_called()

    def test_get_documents_by_ids_uses_single_batch_query(self):
        document = DatasetServiceUnitDataFactory.create_document_mock()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_documents_by_ids("dataset-1", ["doc-1"])

        assert result == [document]
        mock_db.session.scalars.assert_called_once()

    def test_update_documents_need_summary_returns_zero_for_empty_input(self):
        with patch("services.dataset_service.session_factory") as session_factory_mock:
            result = DocumentService.update_documents_need_summary("dataset-1", [])

        assert result == 0
        session_factory_mock.create_session.assert_not_called()

    def test_update_documents_need_summary_updates_matching_documents_and_commits(self):
        session = MagicMock()
        session.query.return_value.filter.return_value.update.return_value = 2

        with patch("services.dataset_service.session_factory") as session_factory_mock:
            session_factory_mock.create_session.return_value = _make_session_context(session)

            result = DocumentService.update_documents_need_summary(
                "dataset-1",
                ["doc-1", "doc-2"],
                need_summary=False,
            )

        assert result == 2
        session.commit.assert_called_once()

    def test_get_document_download_url_uses_upload_file_lookup_and_signed_url_helper(self):
        upload_file = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-1")
        document = DatasetServiceUnitDataFactory.create_document_mock()

        with (
            patch.object(DocumentService, "_get_upload_file_for_upload_file_document", return_value=upload_file),
            patch("services.dataset_service.file_helpers.get_signed_file_url", return_value="signed-url") as get_url,
        ):
            result = DocumentService.get_document_download_url(document)

        assert result == "signed-url"
        get_url.assert_called_once_with(upload_file_id="file-1", as_attachment=True)

    def test_get_upload_file_id_for_upload_file_document_rejects_invalid_source_type(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(data_source_type="not-upload-file")

        with pytest.raises(NotFound, match="invalid source"):
            DocumentService._get_upload_file_id_for_upload_file_document(
                document,
                invalid_source_message="invalid source",
                missing_file_message="missing file",
            )

    def test_get_upload_file_id_for_upload_file_document_rejects_missing_upload_file_id(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(data_source_info_dict={})

        with pytest.raises(NotFound, match="missing file"):
            DocumentService._get_upload_file_id_for_upload_file_document(
                document,
                invalid_source_message="invalid source",
                missing_file_message="missing file",
            )

    def test_get_upload_file_id_for_upload_file_document_returns_string_id(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(data_source_info_dict={"upload_file_id": 99})

        result = DocumentService._get_upload_file_id_for_upload_file_document(
            document,
            invalid_source_message="invalid source",
            missing_file_message="missing file",
        )

        assert result == "99"

    def test_get_upload_file_for_upload_file_document_raises_when_file_service_returns_nothing(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-1"},
        )

        with patch("services.dataset_service.FileService.get_upload_files_by_ids", return_value={}):
            with pytest.raises(NotFound, match="Uploaded file not found"):
                DocumentService._get_upload_file_for_upload_file_document(document)

    def test_get_upload_file_for_upload_file_document_returns_upload_file(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-1"},
        )
        upload_file = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-1")

        with patch(
            "services.dataset_service.FileService.get_upload_files_by_ids", return_value={"file-1": upload_file}
        ):
            result = DocumentService._get_upload_file_for_upload_file_document(document)

        assert result is upload_file

    def test_enrich_documents_with_summary_index_status_skips_lookup_when_summary_is_disabled(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(summary_index_setting={"enable": False})
        documents = [
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1", need_summary=True),
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-2", need_summary=False),
        ]

        DocumentService.enrich_documents_with_summary_index_status(documents, dataset, tenant_id="tenant-1")

        assert documents[0].summary_index_status is None
        assert documents[1].summary_index_status is None

    def test_enrich_documents_with_summary_index_status_applies_summary_status_map(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            dataset_id="dataset-1",
            summary_index_setting={"enable": True},
        )
        documents = [
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1", need_summary=True),
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-2", need_summary=True),
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-3", need_summary=False),
        ]

        with patch(
            "services.summary_index_service.SummaryIndexService.get_documents_summary_index_status",
            return_value={"doc-1": "completed", "doc-2": None},
        ) as get_status_map:
            DocumentService.enrich_documents_with_summary_index_status(documents, dataset, tenant_id="tenant-1")

        get_status_map.assert_called_once_with(
            document_ids=["doc-1", "doc-2"],
            dataset_id="dataset-1",
            tenant_id="tenant-1",
        )
        assert documents[0].summary_index_status == "completed"
        assert documents[1].summary_index_status is None
        assert documents[2].summary_index_status is None

    def test_generate_document_batch_download_zip_filename_uses_zip_extension(self):
        fake_uuid = SimpleNamespace(hex="archive-id")

        with patch("services.dataset_service.uuid.uuid4", return_value=fake_uuid):
            result = DocumentService._generate_document_batch_download_zip_filename()

        assert result == "archive-id.zip"

    def test_get_upload_files_by_document_id_for_zip_download_raises_for_missing_documents(self):
        with patch.object(DocumentService, "get_documents_by_ids", return_value=[]):
            with pytest.raises(NotFound, match="Document not found"):
                DocumentService._get_upload_files_by_document_id_for_zip_download(
                    dataset_id="dataset-1",
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                )

    def test_get_upload_files_by_document_id_for_zip_download_rejects_cross_tenant_access(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            tenant_id="tenant-other",
            data_source_info_dict={"upload_file_id": "file-1"},
        )

        with patch.object(DocumentService, "get_documents_by_ids", return_value=[document]):
            with pytest.raises(Forbidden, match="No permission"):
                DocumentService._get_upload_files_by_document_id_for_zip_download(
                    dataset_id="dataset-1",
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                )

    def test_get_upload_files_by_document_id_for_zip_download_rejects_missing_upload_files(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-1"},
        )

        with (
            patch.object(DocumentService, "get_documents_by_ids", return_value=[document]),
            patch("services.dataset_service.FileService.get_upload_files_by_ids", return_value={}),
        ):
            with pytest.raises(NotFound, match="Only uploaded-file documents can be downloaded as ZIP"):
                DocumentService._get_upload_files_by_document_id_for_zip_download(
                    dataset_id="dataset-1",
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                )

    def test_get_upload_files_by_document_id_for_zip_download_returns_document_keyed_mapping(self):
        document_a = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-1"},
        )
        document_b = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-2",
            tenant_id="tenant-1",
            data_source_info_dict={"upload_file_id": "file-2"},
        )
        upload_file_a = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-1")
        upload_file_b = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-2")

        with (
            patch.object(DocumentService, "get_documents_by_ids", return_value=[document_a, document_b]),
            patch(
                "services.dataset_service.FileService.get_upload_files_by_ids",
                return_value={"file-1": upload_file_a, "file-2": upload_file_b},
            ),
        ):
            result = DocumentService._get_upload_files_by_document_id_for_zip_download(
                dataset_id="dataset-1",
                document_ids=["doc-1", "doc-2"],
                tenant_id="tenant-1",
            )

        assert result == {"doc-1": upload_file_a, "doc-2": upload_file_b}

    def test_prepare_document_batch_download_zip_raises_not_found_for_missing_dataset(self):
        user = DatasetServiceUnitDataFactory.create_user_mock()

        with patch.object(DatasetService, "get_dataset", return_value=None):
            with pytest.raises(NotFound, match="Dataset not found"):
                DocumentService.prepare_document_batch_download_zip(
                    dataset_id="dataset-1",
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                    current_user=user,
                )

    def test_prepare_document_batch_download_zip_translates_permission_error_to_forbidden(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()
        user = DatasetServiceUnitDataFactory.create_user_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission", side_effect=NoPermissionError("blocked")),
        ):
            with pytest.raises(Forbidden, match="blocked"):
                DocumentService.prepare_document_batch_download_zip(
                    dataset_id=dataset.id,
                    document_ids=["doc-1"],
                    tenant_id="tenant-1",
                    current_user=user,
                )

    def test_prepare_document_batch_download_zip_returns_upload_files_in_requested_order(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()
        user = DatasetServiceUnitDataFactory.create_user_mock()
        upload_file_a = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-a")
        upload_file_b = DatasetServiceUnitDataFactory.create_upload_file_mock(file_id="file-b")

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(
                DocumentService,
                "_get_upload_files_by_document_id_for_zip_download",
                return_value={"doc-1": upload_file_a, "doc-2": upload_file_b},
            ),
            patch.object(DocumentService, "_generate_document_batch_download_zip_filename", return_value="archive.zip"),
        ):
            upload_files, download_name = DocumentService.prepare_document_batch_download_zip(
                dataset_id=dataset.id,
                document_ids=["doc-2", "doc-1"],
                tenant_id="tenant-1",
                current_user=user,
            )

        assert upload_files == [upload_file_b, upload_file_a]
        assert download_name == "archive.zip"

    def test_get_document_by_dataset_id_returns_enabled_documents(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(enabled=True)

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_document_by_dataset_id("dataset-1")

        assert result == [document]

    def test_get_working_documents_by_dataset_id_returns_scalars_result(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="completed", archived=False)

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_working_documents_by_dataset_id("dataset-1")

        assert result == [document]

    def test_get_error_documents_by_dataset_id_returns_scalars_result(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="error")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_error_documents_by_dataset_id("dataset-1")

        assert result == [document]

    def test_get_batch_documents_filters_by_current_user_tenant(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.current_tenant_id = "tenant-1"
        document = DatasetServiceUnitDataFactory.create_document_mock()

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_db.session.scalars.return_value.all.return_value = [document]

            result = DocumentService.get_batch_documents("dataset-1", "batch-1")

        assert result == [document]

    def test_get_document_file_detail_returns_one_or_none(self):
        upload_file = DatasetServiceUnitDataFactory.create_upload_file_mock()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.one_or_none.return_value = upload_file

            result = DocumentService.get_document_file_detail(upload_file.id)

        assert result is upload_file


class TestDocumentServiceMutations:
    """Unit tests for DocumentService mutation and orchestration helpers."""

    @pytest.fixture
    def rename_account_context(self):
        class FakeAccount:
            pass

        current_user = FakeAccount()
        current_user.id = "user-123"
        current_user.current_tenant_id = "tenant-123"

        with (
            patch("services.dataset_service.Account", FakeAccount),
            patch("services.dataset_service.current_user", current_user),
        ):
            yield current_user

    @pytest.mark.parametrize(("archived", "expected"), [(True, True), (False, False)])
    def test_check_archived_returns_boolean_status(self, archived, expected):
        document = DatasetServiceUnitDataFactory.create_document_mock(archived=archived)

        assert DocumentService.check_archived(document) is expected

    def test_delete_document_emits_signal_and_commits(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            data_source_type="upload_file",
            data_source_info='{"upload_file_id": "file-1"}',
            data_source_info_dict={"upload_file_id": "file-1"},
        )

        with (
            patch("services.dataset_service.document_was_deleted.send") as send_deleted_signal,
            patch("services.dataset_service.db") as mock_db,
        ):
            DocumentService.delete_document(document)

        send_deleted_signal.assert_called_once_with(
            document.id,
            dataset_id=document.dataset_id,
            doc_form=document.doc_form,
            file_id="file-1",
        )
        mock_db.session.delete.assert_called_once_with(document)
        mock_db.session.commit.assert_called_once()

    def test_delete_documents_ignores_empty_input(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with patch("services.dataset_service.db") as mock_db:
            DocumentService.delete_documents(dataset, [])

        mock_db.session.scalars.assert_not_called()

    def test_delete_documents_deletes_rows_and_dispatches_cleanup_task(self):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(doc_form="text_model")
        document_a = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            data_source_type="upload_file",
            data_source_info_dict={"upload_file_id": "file-1"},
        )
        document_b = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-2",
            data_source_type="upload_file",
            data_source_info_dict={"upload_file_id": "file-2"},
        )

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.batch_clean_document_task") as clean_task,
        ):
            mock_db.session.scalars.return_value.all.return_value = [document_a, document_b]

            DocumentService.delete_documents(dataset, ["doc-1", "doc-2"])

        assert mock_db.session.delete.call_count == 2
        mock_db.session.commit.assert_called_once()
        clean_task.delay.assert_called_once_with(["doc-1", "doc-2"], dataset.id, dataset.doc_form, ["file-1", "file-2"])

    def test_rename_document_raises_when_dataset_is_missing(self, rename_account_context):
        with patch.object(DatasetService, "get_dataset", return_value=None):
            with pytest.raises(ValueError, match="Dataset not found"):
                DocumentService.rename_document("dataset-1", "doc-1", "New Name")

    def test_rename_document_raises_when_document_is_missing(self, rename_account_context):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DocumentService, "get_document", return_value=None),
        ):
            with pytest.raises(ValueError, match="Document not found"):
                DocumentService.rename_document(dataset.id, "doc-1", "New Name")

    def test_rename_document_rejects_cross_tenant_access(self, rename_account_context):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()
        document = DatasetServiceUnitDataFactory.create_document_mock(tenant_id="tenant-other")

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DocumentService, "get_document", return_value=document),
        ):
            with pytest.raises(ValueError, match="No permission"):
                DocumentService.rename_document(dataset.id, document.id, "New Name")

    def test_rename_document_updates_document_metadata_and_upload_file_name(self, rename_account_context):
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            built_in_field_enabled=True,
            tenant_id="tenant-1",
        )
        document = DatasetServiceUnitDataFactory.create_document_mock(
            tenant_id="tenant-1",
            doc_metadata={"title": "Old"},
            data_source_info_dict={"upload_file_id": "file-1"},
        )
        rename_account_context.current_tenant_id = "tenant-1"

        with (
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.db") as mock_db,
        ):
            result = DocumentService.rename_document(dataset.id, document.id, "New Name")

        assert result is document
        assert document.name == "New Name"
        assert document.doc_metadata[BuiltInField.document_name] == "New Name"
        mock_db.session.add.assert_called_once_with(document)
        mock_db.session.query.return_value.where.return_value.update.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_recover_document_raises_when_document_is_not_paused(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(is_paused=False)

        with pytest.raises(DocumentIndexingError):
            DocumentService.recover_document(document)

    def test_retry_document_raises_when_retry_flag_is_already_set(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1")

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(ValueError, match="being retried"):
                DocumentService.retry_document("dataset-1", [document])

    def test_sync_website_document_raises_when_sync_flag_exists(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1")

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(ValueError, match="being synced"):
                DocumentService.sync_website_document("dataset-1", document)

    def test_sync_website_document_updates_status_sets_cache_and_dispatches_task(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(
            document_id="doc-1",
            data_source_info_dict={"mode": "crawl"},
        )
        document.data_source_info = "{}"

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.sync_website_document_indexing_task") as sync_task,
        ):
            mock_redis.get.return_value = None

            DocumentService.sync_website_document("dataset-1", document)

        assert document.indexing_status == "waiting"
        assert '"mode": "scrape"' in document.data_source_info
        mock_db.session.add.assert_called_once_with(document)
        mock_db.session.commit.assert_called_once()
        mock_redis.setex.assert_called_once_with("document_doc-1_is_sync", 600, 1)
        sync_task.delay.assert_called_once_with("dataset-1", "doc-1")

    def test_get_documents_position_returns_next_position_when_documents_exist(self):
        document = DatasetServiceUnitDataFactory.create_document_mock(position=7)

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.order_by.return_value.first.return_value = (
                document
            )

            result = DocumentService.get_documents_position("dataset-1")

        assert result == 8

    def test_get_documents_position_defaults_to_one_when_dataset_is_empty(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.filter_by.return_value.order_by.return_value.first.return_value = None

            result = DocumentService.get_documents_position("dataset-1")

        assert result == 1


class TestDatasetServiceDocumentIndexing:
    """Unit tests for pause/recover/retry orchestration without SQL assertions."""

    @pytest.fixture
    def mock_document_service_dependencies(self):
        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db.session") as mock_db_session,
            patch("services.dataset_service.current_user") as mock_current_user,
        ):
            mock_current_user.id = "user-123"
            yield {
                "redis_client": mock_redis,
                "db_session": mock_db_session,
                "current_user": mock_current_user,
            }

    def test_pause_document_success(self, mock_document_service_dependencies):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="indexing")

        DocumentService.pause_document(document)

        assert document.is_paused is True
        assert document.paused_by == "user-123"
        mock_document_service_dependencies["db_session"].add.assert_called_once_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called_once()
        mock_document_service_dependencies["redis_client"].setnx.assert_called_once_with(
            f"document_{document.id}_is_paused",
            "True",
        )

    def test_pause_document_invalid_status_error(self, mock_document_service_dependencies):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="completed")

        with pytest.raises(DocumentIndexingError):
            DocumentService.pause_document(document)

    def test_recover_document_success(self, mock_document_service_dependencies):
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="indexing", is_paused=True)

        with patch("services.dataset_service.recover_document_indexing_task") as recover_task:
            DocumentService.recover_document(document)

        assert document.is_paused is False
        assert document.paused_by is None
        assert document.paused_at is None
        mock_document_service_dependencies["db_session"].add.assert_called_once_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called_once()
        mock_document_service_dependencies["redis_client"].delete.assert_called_once_with(
            f"document_{document.id}_is_paused"
        )
        recover_task.delay.assert_called_once_with(document.dataset_id, document.id)

    def test_retry_document_indexing_success(self, mock_document_service_dependencies):
        dataset_id = "dataset-123"
        documents = [
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1", indexing_status="error"),
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-2", indexing_status="error"),
        ]
        mock_document_service_dependencies["redis_client"].get.return_value = None

        with patch("services.dataset_service.retry_document_indexing_task") as retry_task:
            DocumentService.retry_document(dataset_id, documents)

        assert all(document.indexing_status == "waiting" for document in documents)
        assert mock_document_service_dependencies["db_session"].add.call_count == 2
        assert mock_document_service_dependencies["db_session"].commit.call_count == 2
        assert mock_document_service_dependencies["redis_client"].setex.call_count == 2
        retry_task.delay.assert_called_once_with(dataset_id, ["doc-1", "doc-2"], "user-123")


class TestDatasetCollectionBindingService:
    """Unit tests for dataset collection binding lookups and creation."""

    def test_get_dataset_collection_binding_returns_existing_binding(self):
        binding = SimpleNamespace(id="binding-1")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = binding

            result = DatasetCollectionBindingService.get_dataset_collection_binding("provider", "model")

        assert result is binding
        mock_db.session.add.assert_not_called()

    def test_get_dataset_collection_binding_creates_binding_when_missing(self):
        created_binding = SimpleNamespace(id="binding-2")

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.DatasetCollectionBinding", return_value=created_binding) as binding_cls,
            patch.object(Dataset, "gen_collection_name_by_id", return_value="generated-collection"),
        ):
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = None

            result = DatasetCollectionBindingService.get_dataset_collection_binding("provider", "model", "dataset")

        assert result is created_binding
        binding_cls.assert_called_once_with(
            provider_name="provider",
            model_name="model",
            collection_name="generated-collection",
            type="dataset",
        )
        mock_db.session.add.assert_called_once_with(created_binding)
        mock_db.session.commit.assert_called_once()

    def test_get_dataset_collection_binding_by_id_and_type_raises_when_missing(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = None

            with pytest.raises(ValueError, match="Dataset collection binding not found"):
                DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type("binding-1")

    def test_get_dataset_collection_binding_by_id_and_type_returns_binding(self):
        binding = SimpleNamespace(id="binding-1")

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.order_by.return_value.first.return_value = binding

            result = DatasetCollectionBindingService.get_dataset_collection_binding_by_id_and_type("binding-1")

        assert result is binding


class TestDatasetPermissionService:
    """Unit tests for dataset partial-member management helpers."""

    def test_get_dataset_partial_member_list_returns_scalar_results(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = ["user-1", "user-2"]

            result = DatasetPermissionService.get_dataset_partial_member_list("dataset-1")

        assert result == ["user-1", "user-2"]

    def test_update_partial_member_list_replaces_permissions_and_commits(self):
        with patch("services.dataset_service.db") as mock_db:
            DatasetPermissionService.update_partial_member_list(
                "tenant-1",
                "dataset-1",
                [{"user_id": "user-1"}, {"user_id": "user-2"}],
            )

        mock_db.session.query.return_value.where.return_value.delete.assert_called_once()
        mock_db.session.add_all.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_update_partial_member_list_rolls_back_on_exception(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.add_all.side_effect = RuntimeError("boom")

            with pytest.raises(RuntimeError, match="boom"):
                DatasetPermissionService.update_partial_member_list(
                    "tenant-1",
                    "dataset-1",
                    [{"user_id": "user-1"}],
                )

        mock_db.session.rollback.assert_called_once()

    def test_check_permission_requires_dataset_editor(self):
        user = SimpleNamespace(is_dataset_editor=False, is_dataset_operator=False)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock()

        with pytest.raises(NoPermissionError, match="does not have permission"):
            DatasetPermissionService.check_permission(user, dataset, "all_team", [])

    def test_check_permission_prevents_dataset_operator_from_changing_permission_mode(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(permission="all_team")

        with pytest.raises(NoPermissionError, match="cannot change the dataset permissions"):
            DatasetPermissionService.check_permission(user, dataset, "only_me", [])

    def test_check_permission_requires_partial_member_list_for_partial_members_mode(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(permission="partial_members")

        with pytest.raises(ValueError, match="Partial member list is required"):
            DatasetPermissionService.check_permission(user, dataset, "partial_members", [])

    def test_check_permission_rejects_dataset_operator_member_list_changes(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            dataset_id="dataset-1", permission="partial_members"
        )

        with patch.object(DatasetPermissionService, "get_dataset_partial_member_list", return_value=["user-1"]):
            with pytest.raises(ValueError, match="cannot change the dataset permissions"):
                DatasetPermissionService.check_permission(
                    user,
                    dataset,
                    "partial_members",
                    [{"user_id": "user-2"}],
                )

    def test_check_permission_allows_dataset_operator_when_member_list_is_unchanged(self):
        user = SimpleNamespace(is_dataset_editor=True, is_dataset_operator=True)
        dataset = DatasetServiceUnitDataFactory.create_dataset_mock(
            dataset_id="dataset-1", permission="partial_members"
        )

        with patch.object(DatasetPermissionService, "get_dataset_partial_member_list", return_value=["user-1"]):
            DatasetPermissionService.check_permission(
                user,
                dataset,
                "partial_members",
                [{"user_id": "user-1"}],
            )

    def test_clear_partial_member_list_deletes_permissions_and_commits(self):
        with patch("services.dataset_service.db") as mock_db:
            DatasetPermissionService.clear_partial_member_list("dataset-1")

        mock_db.session.query.return_value.where.return_value.delete.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_clear_partial_member_list_rolls_back_on_exception(self):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.delete.side_effect = RuntimeError("boom")

            with pytest.raises(RuntimeError, match="boom"):
                DatasetPermissionService.clear_partial_member_list("dataset-1")

        mock_db.session.rollback.assert_called_once()


class TestDocumentServiceSaveDocumentWithoutDatasetId:
    """Unit tests for dataset creation around save_document_without_dataset_id."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_save_document_without_dataset_id_creates_high_quality_dataset_with_default_retrieval_model(
        self, account_context
    ):
        knowledge_config = KnowledgeConfig(
            indexing_technique="high_quality",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            embedding_model="embedding-model",
            embedding_model_provider="provider",
            summary_index_setting={"enable": True},
            is_multimodal=True,
        )
        created_dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            name="",
            description=None,
        )
        first_document = SimpleNamespace(name="VeryLongDocumentNameForDataset.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ),
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: created_dataset.__dict__.update(kwargs) or created_dataset,
            ) as dataset_cls,
            patch.object(
                DocumentService, "save_document_with_dataset_id", return_value=([first_document], "batch-1")
            ) as save_document,
            patch("services.dataset_service.db") as mock_db,
        ):
            dataset, documents, batch = DocumentService.save_document_without_dataset_id(
                tenant_id="tenant-1",
                knowledge_config=knowledge_config,
                account=account_context,
            )

        assert dataset is created_dataset
        assert documents == [first_document]
        assert batch == "batch-1"
        assert created_dataset.collection_binding_id == "binding-1"
        assert created_dataset.retrieval_model["search_method"] == RetrievalMethod.SEMANTIC_SEARCH
        assert created_dataset.retrieval_model["top_k"] == 4
        assert created_dataset.summary_index_setting == {"enable": True}
        assert created_dataset.is_multimodal is True
        assert created_dataset.name == first_document.name[:18] + "..."
        assert (
            created_dataset.description
            == "useful for when you want to answer queries about the VeryLongDocumentNameForDataset.txt"
        )
        dataset_cls.assert_called_once()
        save_document.assert_called_once_with(created_dataset, knowledge_config, account_context)
        assert mock_db.session.commit.call_count == 1

    def test_save_document_without_dataset_id_uses_provided_retrieval_model(self, account_context):
        retrieval_model = RetrievalModel(
            search_method=RetrievalMethod.SEMANTIC_SEARCH,
            reranking_enable=True,
            reranking_model=RerankingModel(
                reranking_provider_name="rerank-provider",
                reranking_model_name="rerank-model",
            ),
            top_k=9,
            score_threshold_enabled=True,
            score_threshold=0.6,
        )
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            retrieval_model=retrieval_model,
        )
        created_dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1", name="", description=None)

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: created_dataset.__dict__.update(kwargs) or created_dataset,
            ),
            patch.object(
                DocumentService,
                "save_document_with_dataset_id",
                return_value=([SimpleNamespace(name="Doc")], "batch-1"),
            ),
            patch("services.dataset_service.db"),
        ):
            DocumentService.save_document_without_dataset_id("tenant-1", knowledge_config, account_context)

        assert created_dataset.retrieval_model == retrieval_model.model_dump()
        assert created_dataset.collection_binding_id is None

    def test_save_document_without_dataset_id_rejects_sandbox_batch_upload(self, account_context):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1", "file-2"]),
                )
            ),
        )

        with (
            patch(
                "services.dataset_service.FeatureService.get_features",
                return_value=_make_features(enabled=True, plan=CloudPlan.SANDBOX),
            ),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="does not support batch upload"):
                DocumentService.save_document_without_dataset_id("tenant-1", knowledge_config, account_context)

        check_quota.assert_not_called()


class TestDocumentServiceUpdateDocumentWithDatasetId:
    """Unit tests for the document-update orchestration path."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_update_document_with_dataset_id_raises_when_document_is_missing(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=None),
            patch.object(DatasetService, "check_dataset_model_setting") as check_model_setting,
        ):
            with pytest.raises(NotFound, match="Document not found"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        check_model_setting.assert_called_once_with(dataset)

    def test_update_document_with_dataset_id_rejects_non_available_documents(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = SimpleNamespace(display_status="indexing")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
        ):
            with pytest.raises(ValueError, match="Document is not available"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_upload_file_process_rule_and_name_override(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = _make_document()
        document.dataset_process_rule_id = "old-rule"
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="custom",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
            name="Renamed document",
            doc_form=IndexStructureType.QA_INDEX,
        )
        created_process_rule = SimpleNamespace(id="rule-2")

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.DatasetProcessRule", return_value=created_process_rule),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            upload_query = MagicMock()
            upload_query.where.return_value.first.return_value = SimpleNamespace(id="file-1", name="upload.txt")
            segment_query = MagicMock()
            segment_query.filter_by.return_value.update.return_value = 3
            mock_db.session.query.side_effect = [upload_query, segment_query]

            result = DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        assert result is document
        assert document.dataset_process_rule_id == "rule-2"
        assert document.data_source_type == "upload_file"
        assert document.data_source_info == '{"upload_file_id": "file-1"}'
        assert document.name == "Renamed document"
        assert document.indexing_status == "waiting"
        assert document.completed_at is None
        assert document.processing_started_at is None
        assert document.parsing_completed_at is None
        assert document.cleaning_completed_at is None
        assert document.splitting_completed_at is None
        assert document.updated_at == "now"
        assert document.created_from == "web"
        assert document.doc_form == IndexStructureType.QA_INDEX
        assert mock_db.session.commit.call_count == 3
        segment_query.filter_by.return_value.update.assert_called_once()
        update_task.delay.assert_called_once_with(document.dataset_id, document.id)

    def test_update_document_with_dataset_id_notion_import_requires_binding(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = SimpleNamespace(display_status="available", id="doc-1", dataset_id="dataset-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page")],
                        )
                    ],
                )
            ),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
        ):
            binding_query = MagicMock()
            binding_query.where.return_value.first.return_value = None
            mock_db.session.query.return_value = binding_query

            with pytest.raises(ValueError, match="Data source binding not found"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_website_crawl_updates_segments_and_dispatches_task(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = _make_document()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="website_crawl",
                    website_info_list=WebsiteInfo(
                        provider="firecrawl",
                        job_id="job-1",
                        urls=["https://example.com"],
                        only_main_content=False,
                    ),
                )
            ),
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
        )

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            segment_query = MagicMock()
            segment_query.filter_by.return_value.update.return_value = 2
            mock_db.session.query.return_value = segment_query

            result = DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        assert result is document
        assert document.data_source_type == "website_crawl"
        assert document.data_source_info == (
            '{"url": "https://example.com", "provider": "firecrawl", "job_id": "job-1", '
            '"only_main_content": false, "mode": "crawl"}'
        )
        assert document.name == ""
        assert document.doc_form == IndexStructureType.PARENT_CHILD_INDEX
        segment_query.filter_by.return_value.update.assert_called_once()
        update_task.delay.assert_called_once_with("dataset-1", "doc-1")


class TestDocumentServiceCreateValidation:
    """Unit tests for document creation validation helpers."""

    def test_document_create_args_validate_requires_data_source_or_process_rule(self):
        knowledge_config = SimpleNamespace(data_source=None, process_rule=None)

        with pytest.raises(ValueError, match="Data source or Process rule is required"):
            DocumentService.document_create_args_validate(knowledge_config)

    def test_document_create_args_validate_delegates_to_sub_validators(self):
        knowledge_config = SimpleNamespace(data_source=object(), process_rule=object())

        with (
            patch.object(DocumentService, "data_source_args_validate") as validate_data_source,
            patch.object(DocumentService, "process_rule_args_validate") as validate_process_rule,
        ):
            DocumentService.document_create_args_validate(knowledge_config)

        validate_data_source.assert_called_once_with(knowledge_config)
        validate_process_rule.assert_called_once_with(knowledge_config)

    def test_data_source_args_validate_rejects_invalid_type(self):
        knowledge_config = SimpleNamespace(
            data_source=SimpleNamespace(
                info_list=SimpleNamespace(
                    data_source_type="bad-source",
                    file_info_list=None,
                    notion_info_list=None,
                    website_info_list=None,
                )
            )
        )

        with pytest.raises(ValueError, match="Data source type is invalid"):
            DocumentService.data_source_args_validate(knowledge_config)

    @pytest.mark.parametrize(
        ("data_source_type", "field_name", "message"),
        [
            ("upload_file", "file_info_list", "File source info is required"),
            ("notion_import", "notion_info_list", "Notion source info is required"),
            ("website_crawl", "website_info_list", "Website source info is required"),
        ],
    )
    def test_data_source_args_validate_requires_source_specific_info(self, data_source_type, field_name, message):
        info_list = SimpleNamespace(
            data_source_type=data_source_type,
            file_info_list=object(),
            notion_info_list=object(),
            website_info_list=object(),
        )
        setattr(info_list, field_name, None)
        knowledge_config = SimpleNamespace(data_source=SimpleNamespace(info_list=info_list))

        with pytest.raises(ValueError, match=message):
            DocumentService.data_source_args_validate(knowledge_config)

    def test_process_rule_args_validate_clears_rules_for_automatic_mode(self):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="automatic",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
        )

        DocumentService.process_rule_args_validate(knowledge_config)

        assert knowledge_config.process_rule is not None
        assert knowledge_config.process_rule.rules is None

    def test_process_rule_args_validate_deduplicates_rules_and_skips_max_tokens_for_full_doc_hierarchical(self):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="hierarchical",
                rules=Rule(
                    pre_processing_rules=[
                        PreProcessingRule(id="remove_stopwords", enabled=True),
                        PreProcessingRule(id="remove_stopwords", enabled=False),
                    ],
                    segmentation=Segmentation(separator="\n", max_tokens=0),
                    parent_mode="full-doc",
                ),
            ),
        )

        DocumentService.process_rule_args_validate(knowledge_config)

        assert knowledge_config.process_rule is not None
        assert knowledge_config.process_rule.rules is not None
        assert len(knowledge_config.process_rule.rules.pre_processing_rules) == 1
        assert knowledge_config.process_rule.rules.pre_processing_rules[0].enabled is False


class TestSegmentServiceChildChunks:
    """Unit tests for child-chunk CRUD helpers."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_create_child_chunk_assigns_next_position_and_commits(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        document = _make_document()
        segment = _make_segment()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.uuid.uuid4", return_value="node-1"),
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-1"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.lock.return_value = _make_lock_context()
            mock_db.session.query.return_value.where.return_value.scalar.return_value = 2

            child_chunk = SegmentService.create_child_chunk("child content", segment, document, dataset)

        assert isinstance(child_chunk, ChildChunk)
        assert child_chunk.position == 3
        assert child_chunk.index_node_id == "node-1"
        assert child_chunk.index_node_hash == "hash-1"
        assert child_chunk.word_count == len("child content")
        mock_db.session.add.assert_called_once_with(child_chunk)
        vector_service.create_child_chunk_vector.assert_called_once_with(child_chunk, dataset)
        mock_db.session.commit.assert_called_once()

    def test_create_child_chunk_rolls_back_and_raises_on_vector_failure(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        document = _make_document()
        segment = _make_segment()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.uuid.uuid4", return_value="node-1"),
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-1"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.lock.return_value = _make_lock_context()
            mock_db.session.query.return_value.where.return_value.scalar.return_value = None
            vector_service.create_child_chunk_vector.side_effect = RuntimeError("vector failed")

            with pytest.raises(ChildChunkIndexingError, match="vector failed"):
                SegmentService.create_child_chunk("child content", segment, document, dataset)

        mock_db.session.rollback.assert_called_once()
        mock_db.session.commit.assert_not_called()

    def test_update_child_chunks_updates_deletes_and_creates_records(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        document = _make_document()
        segment = _make_segment()
        existing_a = ChildChunk(
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
        existing_b = ChildChunk(
            id="child-b",
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            segment_id="segment-1",
            position=2,
            content="remove me",
            word_count=9,
            created_by="user-1",
        )

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.uuid.uuid4", return_value="node-new"),
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-new"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_db.session.scalars.return_value.all.return_value = [existing_a, existing_b]

            result = SegmentService.update_child_chunks(
                [
                    ChildChunkUpdateArgs(id="child-a", content="updated content"),
                    ChildChunkUpdateArgs(content="brand new"),
                ],
                segment,
                document,
                dataset,
            )

        assert [chunk.position for chunk in result] == [1, 3]
        assert existing_a.content == "updated content"
        assert existing_a.updated_by == account_context.id
        assert existing_a.updated_at == "now"
        mock_db.session.bulk_save_objects.assert_called_once_with([existing_a])
        mock_db.session.delete.assert_called_once_with(existing_b)
        new_chunk = result[1]
        assert isinstance(new_chunk, ChildChunk)
        assert new_chunk.position == 3
        assert new_chunk.index_node_id == "node-new"
        vector_service.update_child_chunk_vector.assert_called_once_with(
            [new_chunk], [existing_a], [existing_b], dataset
        )
        mock_db.session.commit.assert_called_once()

    def test_update_child_chunks_rolls_back_on_vector_failure(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        document = _make_document()
        segment = _make_segment()
        existing_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_db.session.scalars.return_value.all.return_value = [existing_chunk]
            vector_service.update_child_chunk_vector.side_effect = RuntimeError("vector failed")

            with pytest.raises(ChildChunkIndexingError, match="vector failed"):
                SegmentService.update_child_chunks(
                    [ChildChunkUpdateArgs(id="child-a", content="updated content")],
                    segment,
                    document,
                    dataset,
                )

        mock_db.session.rollback.assert_called_once()

    def test_update_child_chunk_updates_vector_and_commits(self, account_context):
        dataset = SimpleNamespace(id="dataset-1")
        child_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(id="user-1")),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            result = SegmentService.update_child_chunk(
                "new content", child_chunk, _make_segment(), _make_document(), dataset
            )

        assert result is child_chunk
        assert child_chunk.content == "new content"
        assert child_chunk.word_count == len("new content")
        assert child_chunk.updated_by == "user-1"
        assert child_chunk.updated_at == "now"
        mock_db.session.add.assert_called_once_with(child_chunk)
        vector_service.update_child_chunk_vector.assert_called_once_with([], [child_chunk], [], dataset)
        mock_db.session.commit.assert_called_once()

    def test_delete_child_chunk_raises_delete_index_error_on_vector_failure(self):
        dataset = SimpleNamespace(id="dataset-1")
        child_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            vector_service.delete_child_chunk_vector.side_effect = RuntimeError("delete failed")

            with pytest.raises(ChildChunkDeleteIndexError, match="delete failed"):
                SegmentService.delete_child_chunk(child_chunk, dataset)

        mock_db.session.delete.assert_called_once_with(child_chunk)
        mock_db.session.rollback.assert_called_once()


class TestSegmentServiceQueries:
    """Unit tests for child-chunk and segment query helpers."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_get_child_chunks_applies_keyword_filter_and_paginate(self, account_context):
        paginated = SimpleNamespace(items=["chunk"], total=1)

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.helper.escape_like_pattern", return_value="escaped") as escape_like,
        ):
            mock_db.paginate.return_value = paginated

            result = SegmentService.get_child_chunks(
                segment_id="segment-1",
                document_id="doc-1",
                dataset_id="dataset-1",
                page=2,
                limit=10,
                keyword="needle",
            )

        assert result is paginated
        escape_like.assert_called_once_with("needle")
        mock_db.paginate.assert_called_once()

    def test_get_child_chunk_by_id_returns_only_child_chunk_instances(self):
        child_chunk = _make_child_chunk()

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.first.return_value = child_chunk
            result = SegmentService.get_child_chunk_by_id("child-a", "tenant-1")

        assert result is child_chunk

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.first.return_value = SimpleNamespace()
            result = SegmentService.get_child_chunk_by_id("child-a", "tenant-1")

        assert result is None

    def test_get_segments_uses_status_and_keyword_filters(self):
        paginated = SimpleNamespace(items=["segment"], total=1)

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.helper.escape_like_pattern", return_value="escaped") as escape_like,
        ):
            mock_db.paginate.return_value = paginated

            items, total = SegmentService.get_segments(
                document_id="doc-1",
                tenant_id="tenant-1",
                status_list=["completed"],
                keyword="needle",
                page=1,
                limit=20,
            )

        assert items == ["segment"]
        assert total == 1
        escape_like.assert_called_once_with("needle")
        mock_db.paginate.assert_called_once()

    def test_get_segment_by_id_returns_only_document_segment_instances(self):
        segment = DocumentSegment(
            id="segment-1",
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            position=1,
            content="segment",
            word_count=7,
            tokens=2,
            created_by="user-1",
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.first.return_value = segment
            result = SegmentService.get_segment_by_id("segment-1", "tenant-1")

        assert result is segment

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.first.return_value = SimpleNamespace()
            result = SegmentService.get_segment_by_id("segment-1", "tenant-1")

        assert result is None

    def test_get_segments_by_document_and_dataset_returns_scalars_result(self):
        segment = DocumentSegment(
            id="segment-1",
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="doc-1",
            position=1,
            content="segment",
            word_count=7,
            tokens=2,
            created_by="user-1",
        )

        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [segment]

            result = SegmentService.get_segments_by_document_and_dataset(
                document_id="doc-1",
                dataset_id="dataset-1",
                status="completed",
                enabled=True,
            )

        assert result == [segment]
        mock_db.session.scalars.assert_called_once()


class TestDocumentServiceSaveDocumentWithDatasetId:
    """Unit tests for non-SQL validation branches in save_document_with_dataset_id."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with (
            patch("services.dataset_service.current_user", account),
            patch.object(DatasetService, "check_doc_form"),
        ):
            yield account

    def test_save_document_with_dataset_id_requires_file_info_for_upload_source(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=None)

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=True)):
            with pytest.raises(ValueError, match="File source info is required"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_blocks_batch_upload_for_sandbox_plan(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

        with (
            patch(
                "services.dataset_service.FeatureService.get_features",
                return_value=_make_features(enabled=True, plan=CloudPlan.SANDBOX),
            ),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="does not support batch upload"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        check_quota.assert_not_called()

    def test_save_document_with_dataset_id_enforces_batch_upload_limit(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=True)),
            patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", 1),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="batch upload limit of 1"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        check_quota.assert_not_called()

    def test_save_document_with_dataset_id_updates_existing_document_and_data_source_type(self, account_context):
        dataset = _make_dataset(data_source_type=None)
        knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
        updated_document = _make_document(document_id="doc-1", batch="batch-existing")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch.object(
                DocumentService, "update_document_with_dataset_id", return_value=updated_document
            ) as update_document,
        ):
            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert dataset.data_source_type == "upload_file"
        assert documents == [updated_document]
        assert batch == "batch-existing"
        update_document.assert_called_once_with(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_requires_data_source_for_new_documents(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(data_source=None)

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            with pytest.raises(ValueError, match="Data source is required when creating new documents"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_requires_existing_process_rule_for_custom_mode(self, account_context):
        dataset = _make_dataset(latest_process_rule=None)
        knowledge_config = _make_upload_knowledge_config(
            file_ids=["file-1"],
            process_rule=ProcessRule(mode="custom"),
        )

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            with pytest.raises(ValueError, match="No process rule found"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_rejects_invalid_indexing_technique(self, account_context):
        dataset = _make_dataset(indexing_technique=None)
        knowledge_config = SimpleNamespace(
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            original_document_id=None,
            data_source=None,
            indexing_technique="broken-technique",
        )

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            with pytest.raises(ValueError, match="Indexing technique is invalid"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_returns_empty_for_invalid_process_rule_mode(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1"])
        knowledge_config.process_rule = SimpleNamespace(mode="unsupported-mode", rules=None)

        with patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)):
            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert documents == []
        assert batch == ""

    def test_save_document_with_dataset_id_upload_file_creates_and_reindexes_documents(self, account_context):
        dataset = _make_dataset()
        dataset_process_rule = SimpleNamespace(id="rule-1")
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])
        duplicate_document = _make_document(document_id="doc-duplicate", name="existing.txt")
        created_document = _make_document(document_id="doc-created", name="new.txt")
        upload_file_a = SimpleNamespace(id="file-1", name="existing.txt")
        upload_file_b = SimpleNamespace(id="file-2", name="new.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch.object(DocumentService, "get_documents_position", return_value=4),
            patch.object(DocumentService, "build_document", return_value=created_document) as build_document,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
            patch("services.dataset_service.DuplicateDocumentIndexingTaskProxy") as duplicate_proxy_cls,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [upload_file_a, upload_file_b]
            existing_documents_query = MagicMock()
            existing_documents_query.where.return_value.all.return_value = [duplicate_document]
            mock_db.session.query.side_effect = [upload_query, existing_documents_query]

            documents, batch = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                dataset_process_rule=dataset_process_rule,
            )

        assert documents == [duplicate_document, created_document]
        assert batch == "20260101010101100023"
        assert duplicate_document.dataset_process_rule_id == "rule-1"
        assert duplicate_document.updated_at == "now"
        assert duplicate_document.batch == batch
        assert duplicate_document.indexing_status == "waiting"
        build_document.assert_called_once_with(
            dataset,
            "rule-1",
            "upload_file",
            IndexStructureType.PARAGRAPH_INDEX,
            "English",
            {"upload_file_id": "file-2"},
            "web",
            4,
            account_context,
            "new.txt",
            batch,
        )
        document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-created"])
        document_proxy_cls.return_value.delay.assert_called_once()
        duplicate_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-duplicate"])
        duplicate_proxy_cls.return_value.delay.assert_called_once()

    def test_save_document_with_dataset_id_notion_import_truncates_names_and_cleans_removed_pages(
        self, account_context
    ):
        dataset = _make_dataset()
        dataset_process_rule = SimpleNamespace(id="rule-1")
        notion_page_name = "a" * 300
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[
                                NotionPage(page_id="page-keep", page_name="Keep page", type="page"),
                                NotionPage(
                                    page_id="page-new",
                                    page_name=notion_page_name,
                                    page_icon=NotionIcon(type="emoji", emoji="page"),
                                    type="page",
                                ),
                            ],
                        )
                    ],
                )
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )
        existing_keep = _make_document(document_id="doc-keep")
        existing_keep.data_source_info = json.dumps({"notion_page_id": "page-keep"})
        existing_remove = _make_document(document_id="doc-remove")
        existing_remove.data_source_info = json.dumps({"notion_page_id": "page-remove"})
        created_document = _make_document(document_id="doc-new")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch.object(DocumentService, "get_documents_position", return_value=1),
            patch.object(DocumentService, "build_document", return_value=created_document) as build_document,
            patch("services.dataset_service.clean_notion_document_task") as clean_task,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
        ):
            mock_redis.lock.return_value = _make_lock_context()
            notion_documents_query = MagicMock()
            notion_documents_query.filter_by.return_value.all.return_value = [existing_keep, existing_remove]
            mock_db.session.query.return_value = notion_documents_query

            documents, _ = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                dataset_process_rule=dataset_process_rule,
            )

        assert created_document in documents
        assert len(build_document.call_args.args[9]) == 255
        clean_task.delay.assert_called_once_with(["doc-remove"], dataset.id)
        document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-new"])
        document_proxy_cls.return_value.delay.assert_called_once()

    def test_save_document_with_dataset_id_website_crawl_truncates_long_urls(self, account_context):
        dataset = _make_dataset()
        dataset_process_rule = SimpleNamespace(id="rule-1")
        long_url = "https://example.com/" + ("a" * 260)
        short_url = "https://example.com/short"
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="website_crawl",
                    website_info_list=WebsiteInfo(
                        provider="firecrawl",
                        job_id="job-1",
                        urls=[long_url, short_url],
                        only_main_content=True,
                    ),
                )
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )
        first_document = _make_document(document_id="doc-1")
        second_document = _make_document(document_id="doc-2")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch.object(DocumentService, "get_documents_position", return_value=2),
            patch.object(
                DocumentService,
                "build_document",
                side_effect=[first_document, second_document],
            ) as build_document,
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
        ):
            mock_redis.lock.return_value = _make_lock_context()

            documents, _ = DocumentService.save_document_with_dataset_id(
                dataset,
                knowledge_config,
                account_context,
                dataset_process_rule=dataset_process_rule,
            )

        assert documents == [first_document, second_document]
        assert build_document.call_args_list[0].args[9] == long_url[:200] + "..."
        assert build_document.call_args_list[1].args[9] == short_url
        document_proxy_cls.assert_called_once_with(dataset.tenant_id, dataset.id, ["doc-1", "doc-2"])
        document_proxy_cls.return_value.delay.assert_called_once()


class TestDocumentServiceBatchUpdateStatus:
    """Unit tests for batch_update_document_status orchestration and helper branches."""

    def test_prepare_disable_update_requires_completed_document(self):
        document = _make_document(indexing_status="waiting")
        document.completed_at = None

        with pytest.raises(DocumentIndexingError, match="is not completed"):
            DocumentService._prepare_disable_update(document, user=SimpleNamespace(id="user-1"), now="now")

    def test_prepare_archive_update_sets_async_task_for_enabled_document(self):
        document = _make_document(enabled=True, archived=False)

        result = DocumentService._prepare_archive_update(document, user=SimpleNamespace(id="user-1"), now="now")

        assert result is not None
        assert result["updates"]["archived"] is True
        assert result["set_cache"] is True
        assert result["async_task"]["args"] == [document.id]

    def test_prepare_unarchive_update_sets_async_task_for_enabled_document(self):
        document = _make_document(enabled=True, archived=True)

        result = DocumentService._prepare_unarchive_update(document, now="now")

        assert result is not None
        assert result["updates"]["archived"] is False
        assert result["set_cache"] is True
        assert result["async_task"]["args"] == [document.id]

    def test_batch_update_document_status_rejects_indexing_documents(self):
        dataset = _make_dataset()
        document = _make_document(name="Busy document")

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_redis.get.return_value = "1"

            with pytest.raises(DocumentIndexingError, match="Busy document is being indexed"):
                DocumentService.batch_update_document_status(
                    dataset, [document.id], "archive", SimpleNamespace(id="user-1")
                )

        mock_db.session.commit.assert_not_called()

    def test_batch_update_document_status_rolls_back_when_commit_fails(self):
        dataset = _make_dataset()
        document = _make_document(enabled=False)

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_redis.get.return_value = None
            mock_db.session.commit.side_effect = RuntimeError("commit failed")

            with pytest.raises(RuntimeError, match="commit failed"):
                DocumentService.batch_update_document_status(
                    dataset, [document.id], "enable", SimpleNamespace(id="user-1")
                )

        mock_db.session.rollback.assert_called_once()

    def test_batch_update_document_status_raises_async_task_error_after_commit(self):
        dataset = _make_dataset()
        document = _make_document(enabled=False)

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.add_document_to_index_task") as add_task,
        ):
            mock_redis.get.return_value = None
            add_task.delay.side_effect = RuntimeError("task failed")

            with pytest.raises(RuntimeError, match="task failed"):
                DocumentService.batch_update_document_status(
                    dataset, [document.id], "enable", SimpleNamespace(id="user-1")
                )

        mock_db.session.commit.assert_called_once()
        mock_redis.setex.assert_called_once_with(f"document_{document.id}_indexing", 600, 1)


class TestSegmentServiceValidation:
    """Unit tests for segment-create argument validation."""

    def test_segment_create_args_validate_requires_answer_for_qa_model(self):
        document = _make_document(doc_form=IndexStructureType.QA_INDEX)

        with pytest.raises(ValueError, match="Answer is required"):
            SegmentService.segment_create_args_validate({"content": "question"}, document)

    def test_segment_create_args_validate_requires_non_empty_content(self):
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)

        with pytest.raises(ValueError, match="Content is empty"):
            SegmentService.segment_create_args_validate({"content": "   "}, document)

    def test_segment_create_args_validate_enforces_attachment_limit(self):
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)
        args = {"content": "hello", "attachment_ids": ["a-1", "a-2"]}

        with patch("services.dataset_service.dify_config.SINGLE_CHUNK_ATTACHMENT_LIMIT", 1):
            with pytest.raises(ValueError, match="Exceeded maximum attachment limit of 1"):
                SegmentService.segment_create_args_validate(args, document)

    def test_segment_create_args_validate_requires_attachment_ids_list(self):
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX)

        with pytest.raises(ValueError, match="Attachment IDs is invalid"):
            SegmentService.segment_create_args_validate({"content": "hello", "attachment_ids": "bad-type"}, document)


class TestSegmentServiceMutations:
    """Unit tests for segment create, update, delete, and bulk status flows."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_create_segment_creates_bindings_and_marks_segment_error_on_vector_failure(self, account_context):
        dataset = _make_dataset(indexing_technique="economy")
        document = _make_document(
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            doc_form=IndexStructureType.QA_INDEX,
            word_count=0,
        )
        refreshed_segment = SimpleNamespace(id="segment-1")
        args = {
            "content": "question",
            "answer": "answer",
            "keywords": ["kw-1"],
            "attachment_ids": ["att-1", "att-2"],
        }

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-1"),
            patch("services.dataset_service.uuid.uuid4", return_value="node-1"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
        ):
            mock_redis.lock.return_value = _make_lock_context()

            max_position_query = MagicMock()
            max_position_query.where.return_value.scalar.return_value = 2
            refresh_query = MagicMock()
            refresh_query.where.return_value.first.return_value = refreshed_segment
            mock_db.session.query.side_effect = [max_position_query, refresh_query]

            def add_side_effect(obj):
                if obj.__class__.__name__ == "DocumentSegment" and getattr(obj, "id", None) is None:
                    obj.id = "segment-1"

            mock_db.session.add.side_effect = add_side_effect
            vector_service.create_segments_vector.side_effect = RuntimeError("vector failed")

            result = SegmentService.create_segment(args=args, document=document, dataset=dataset)

        created_segment = vector_service.create_segments_vector.call_args.args[1][0]
        attachment_bindings = [
            call.args[0]
            for call in mock_db.session.add.call_args_list
            if call.args and call.args[0].__class__.__name__ == "SegmentAttachmentBinding"
        ]

        assert result is refreshed_segment
        assert created_segment.position == 3
        assert created_segment.answer == "answer"
        assert created_segment.word_count == len("question") + len("answer")
        assert created_segment.status == "error"
        assert created_segment.enabled is False
        assert created_segment.error == "vector failed"
        assert document.word_count == len("question") + len("answer")
        assert len(attachment_bindings) == 2
        assert {binding.attachment_id for binding in attachment_bindings} == {"att-1", "att-2"}
        assert mock_db.session.commit.call_count == 3

    def test_multi_create_segment_high_quality_marks_segments_error_when_vector_creation_fails(self, account_context):
        dataset = _make_dataset(indexing_technique="high_quality")
        document = _make_document(
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            doc_form=IndexStructureType.QA_INDEX,
            word_count=5,
        )
        segments = [
            {"content": "question-1", "answer": "answer-1", "keywords": ["k1"]},
            {"content": "question-2", "answer": "answer-2"},
        ]
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.side_effect = [[11], [13]]

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", side_effect=["hash-1", "hash-2"]),
            patch("services.dataset_service.uuid.uuid4", side_effect=["node-1", "node-2"]),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            model_manager_cls.return_value.get_model_instance.return_value = embedding_model
            mock_db.session.query.return_value.where.return_value.scalar.return_value = 1
            vector_service.create_segments_vector.side_effect = RuntimeError("vector failed")

            result = SegmentService.multi_create_segment(segments, document, dataset)

        assert len(result) == 2
        assert [segment.position for segment in result] == [2, 3]
        assert [segment.tokens for segment in result] == [11, 13]
        assert all(segment.status == "error" for segment in result)
        assert all(segment.enabled is False for segment in result)
        assert all(segment.error == "vector failed" for segment in result)
        assert document.word_count == 5 + sum(len(item["content"]) + len(item["answer"]) for item in segments)
        vector_service.create_segments_vector.assert_called_once_with(
            [["k1"], None], result, dataset, document.doc_form
        )
        mock_db.session.commit.assert_called_once()

    def test_update_segment_disables_enabled_segment_and_dispatches_index_cleanup(self, account_context):
        segment = _make_segment(enabled=True)
        document = _make_document()
        dataset = _make_dataset()
        args = SegmentUpdateArgs(enabled=False)

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.disable_segment_from_index_task") as disable_task,
        ):
            mock_redis.get.return_value = None

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is segment
        assert segment.enabled is False
        assert segment.disabled_at == "now"
        assert segment.disabled_by == account_context.id
        mock_db.session.add.assert_called_once_with(segment)
        mock_db.session.commit.assert_called_once()
        mock_redis.setex.assert_called_once_with(f"segment_{segment.id}_indexing", 600, 1)
        disable_task.delay.assert_called_once_with(segment.id)

    def test_update_segment_rejects_updates_for_disabled_segment(self, account_context):
        segment = _make_segment(enabled=False)
        document = _make_document()
        dataset = _make_dataset()

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = None

            with pytest.raises(ValueError, match="Can't update disabled segment"):
                SegmentService.update_segment(SegmentUpdateArgs(content="new content"), segment, document, dataset)

    def test_update_segment_rejects_when_indexing_cache_exists(self, account_context):
        segment = _make_segment(enabled=True)
        document = _make_document()
        dataset = _make_dataset()

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(ValueError, match="Segment is indexing"):
                SegmentService.update_segment(SegmentUpdateArgs(content="new content"), segment, document, dataset)

    def test_update_segment_updates_keywords_for_same_content_segment(self, account_context):
        segment = _make_segment(content="same content", keywords=["old"])
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX, word_count=20)
        dataset = _make_dataset()
        refreshed_segment = SimpleNamespace(id=segment.id)
        args = SegmentUpdateArgs(content="same content", keywords=["new"])

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.get.return_value = None
            mock_db.session.query.return_value.where.return_value.first.return_value = refreshed_segment

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is refreshed_segment
        assert segment.keywords == ["new"]
        vector_service.update_segment_vector.assert_called_once_with(["new"], segment, dataset)
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_regenerates_child_chunks_and_updates_manual_summary(self, account_context):
        segment = _make_segment(content="same content", word_count=len("same content"))
        document = _make_document(
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            word_count=20,
        )
        dataset = _make_dataset(indexing_technique="high_quality")
        refreshed_segment = SimpleNamespace(id=segment.id)
        processing_rule = SimpleNamespace(id=document.dataset_process_rule_id)
        existing_summary = SimpleNamespace(summary_content="old summary")
        embedding_model_instance = object()
        args = SegmentUpdateArgs(
            content="same content",
            regenerate_child_chunks=True,
            summary="new summary",
        )

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.summary_index_service.SummaryIndexService.update_summary_for_segment") as update_summary,
        ):
            mock_redis.get.return_value = None
            model_manager_cls.return_value.get_model_instance.return_value = embedding_model_instance

            processing_rule_query = MagicMock()
            processing_rule_query.where.return_value.first.return_value = processing_rule
            summary_query = MagicMock()
            summary_query.where.return_value.first.return_value = existing_summary
            refreshed_query = MagicMock()
            refreshed_query.where.return_value.first.return_value = refreshed_segment
            mock_db.session.query.side_effect = [processing_rule_query, summary_query, refreshed_query]

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is refreshed_segment
        vector_service.generate_child_chunks.assert_called_once_with(
            segment,
            document,
            dataset,
            embedding_model_instance,
            processing_rule,
            True,
        )
        update_summary.assert_called_once_with(segment, dataset, "new summary")
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_auto_regenerates_summary_after_content_change(self, account_context):
        segment = _make_segment(content="old", word_count=3)
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX, word_count=10)
        dataset = _make_dataset(indexing_technique="high_quality")
        dataset.summary_index_setting = {"enable": True}
        refreshed_segment = SimpleNamespace(id=segment.id)
        existing_summary = SimpleNamespace(summary_content="old summary")
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.return_value = [9]
        args = SegmentUpdateArgs(content="new content", keywords=["kw-1"])

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-1"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch(
                "services.summary_index_service.SummaryIndexService.generate_and_vectorize_summary"
            ) as generate_summary,
        ):
            mock_redis.get.return_value = None
            model_manager_cls.return_value.get_model_instance.return_value = embedding_model

            summary_query = MagicMock()
            summary_query.where.return_value.first.return_value = existing_summary
            refreshed_query = MagicMock()
            refreshed_query.where.return_value.first.return_value = refreshed_segment
            mock_db.session.query.side_effect = [summary_query, refreshed_query]

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is refreshed_segment
        assert segment.content == "new content"
        assert segment.index_node_hash == "hash-1"
        assert segment.tokens == 9
        assert document.word_count == 18
        vector_service.update_segment_vector.assert_called_once_with(["kw-1"], segment, dataset)
        generate_summary.assert_called_once_with(segment, dataset, {"enable": True})
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_regenerates_summary_when_manual_summary_is_unchanged(self, account_context):
        segment = _make_segment(content="old", word_count=3)
        document = _make_document(doc_form=IndexStructureType.PARAGRAPH_INDEX, word_count=10)
        dataset = _make_dataset(indexing_technique="high_quality")
        dataset.summary_index_setting = {"enable": True}
        refreshed_segment = SimpleNamespace(id=segment.id)
        existing_summary = SimpleNamespace(summary_content="same summary")
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.return_value = [7]
        args = SegmentUpdateArgs(content="new text", summary="same summary")

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-2"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch(
                "services.summary_index_service.SummaryIndexService.generate_and_vectorize_summary"
            ) as generate_summary,
            patch("services.summary_index_service.SummaryIndexService.update_summary_for_segment") as update_summary,
        ):
            mock_redis.get.return_value = None
            model_manager_cls.return_value.get_model_instance.return_value = embedding_model

            summary_query = MagicMock()
            summary_query.where.return_value.first.return_value = existing_summary
            refreshed_query = MagicMock()
            refreshed_query.where.return_value.first.return_value = refreshed_segment
            mock_db.session.query.side_effect = [summary_query, refreshed_query]

            result = SegmentService.update_segment(args, segment, document, dataset)

        assert result is refreshed_segment
        generate_summary.assert_called_once_with(segment, dataset, {"enable": True})
        update_summary.assert_not_called()
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_delete_segment_removes_index_and_updates_document_word_count(self):
        segment = _make_segment(word_count=4, index_node_id="parent-node")
        document = _make_document(word_count=10)
        dataset = _make_dataset()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.delete_segment_from_index_task") as delete_task,
        ):
            mock_redis.get.return_value = None
            mock_db.session.query.return_value.where.return_value.all.return_value = [("child-1",), ("child-2",)]

            SegmentService.delete_segment(segment, document, dataset)

        assert document.word_count == 6
        mock_redis.setex.assert_called_once_with(f"segment_{segment.id}_delete_indexing", 600, 1)
        delete_task.delay.assert_called_once_with(
            ["parent-node"],
            dataset.id,
            document.id,
            [segment.id],
            ["child-1", "child-2"],
        )
        mock_db.session.delete.assert_called_once_with(segment)
        mock_db.session.add.assert_called_once_with(document)
        mock_db.session.commit.assert_called_once()

    def test_delete_segment_rejects_when_delete_is_already_in_progress(self):
        segment = _make_segment()
        document = _make_document()
        dataset = _make_dataset()

        with patch("services.dataset_service.redis_client") as mock_redis:
            mock_redis.get.return_value = "1"

            with pytest.raises(ValueError, match="Segment is deleting"):
                SegmentService.delete_segment(segment, document, dataset)

    def test_delete_segments_removes_records_and_clamps_document_word_count(self):
        dataset = _make_dataset()
        document = _make_document(word_count=3)
        current_user = SimpleNamespace(current_tenant_id="tenant-1")

        with (
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.delete_segment_from_index_task") as delete_task,
        ):
            segments_query = MagicMock()
            segments_query.with_entities.return_value.where.return_value.all.return_value = [
                ("node-1", "segment-1", 2),
                ("node-2", "segment-2", 5),
            ]
            child_query = MagicMock()
            child_query.where.return_value.all.return_value = [("child-1",)]
            delete_query = MagicMock()
            delete_query.where.return_value.delete.return_value = 2
            mock_db.session.query.side_effect = [segments_query, child_query, delete_query]

            SegmentService.delete_segments(["segment-1", "segment-2"], document, dataset)

        assert document.word_count == 0
        mock_db.session.add.assert_called_once_with(document)
        delete_task.delay.assert_called_once_with(
            ["node-1", "node-2"],
            dataset.id,
            document.id,
            ["segment-1", "segment-2"],
            ["child-1"],
        )
        delete_query.where.return_value.delete.assert_called_once()
        mock_db.session.commit.assert_called_once()

    def test_update_segments_status_enables_only_segments_without_indexing_cache(self):
        dataset = _make_dataset()
        document = _make_document()
        segment_a = _make_segment(segment_id="segment-a", enabled=False)
        segment_b = _make_segment(segment_id="segment-b", enabled=False)
        current_user = SimpleNamespace(id="user-1", current_tenant_id="tenant-1")

        with (
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.enable_segments_to_index_task") as enable_task,
        ):
            mock_db.session.scalars.return_value.all.return_value = [segment_a, segment_b]
            mock_redis.get.side_effect = [None, "1"]

            SegmentService.update_segments_status(["segment-a", "segment-b"], "enable", dataset, document)

        assert segment_a.enabled is True
        assert segment_a.disabled_at is None
        assert segment_a.disabled_by is None
        assert segment_b.enabled is False
        mock_db.session.add.assert_called_once_with(segment_a)
        mock_db.session.commit.assert_called_once()
        enable_task.delay.assert_called_once_with(["segment-a"], dataset.id, document.id)

    def test_update_segments_status_disables_only_segments_without_indexing_cache(self):
        dataset = _make_dataset()
        document = _make_document()
        segment_a = _make_segment(segment_id="segment-a", enabled=True)
        segment_b = _make_segment(segment_id="segment-b", enabled=True)
        current_user = SimpleNamespace(id="user-1", current_tenant_id="tenant-1")

        with (
            patch("services.dataset_service.current_user", current_user),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.disable_segments_from_index_task") as disable_task,
        ):
            mock_db.session.scalars.return_value.all.return_value = [segment_a, segment_b]
            mock_redis.get.side_effect = [None, "1"]

            SegmentService.update_segments_status(["segment-a", "segment-b"], "disable", dataset, document)

        assert segment_a.enabled is False
        assert segment_a.disabled_at == "now"
        assert segment_a.disabled_by == current_user.id
        assert segment_b.enabled is True
        mock_db.session.add.assert_called_once_with(segment_a)
        mock_db.session.commit.assert_called_once()
        disable_task.delay.assert_called_once_with(["segment-a"], dataset.id, document.id)


class TestDocumentServiceTenantAndUpdateEdges:
    """Unit tests for tenant-count and update edge cases."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_get_tenant_documents_count_returns_query_count(self, account_context):
        with patch("services.dataset_service.db") as mock_db:
            mock_db.session.query.return_value.where.return_value.count.return_value = 12

            result = DocumentService.get_tenant_documents_count()

        assert result == 12
        mock_db.session.query.return_value.where.return_value.count.assert_called_once()

    def test_update_document_with_dataset_id_uses_automatic_process_rule_payload(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = _make_document()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
            process_rule=ProcessRule(
                mode="automatic",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        created_process_rule = SimpleNamespace(id="rule-2")

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch("services.dataset_service.DatasetProcessRule") as process_rule_cls,
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            process_rule_cls.AUTOMATIC_RULES = DatasetProcessRule.AUTOMATIC_RULES
            process_rule_cls.return_value = created_process_rule
            upload_query = MagicMock()
            upload_query.where.return_value.first.return_value = SimpleNamespace(id="file-1", name="upload.txt")
            segment_query = MagicMock()
            segment_query.filter_by.return_value.update.return_value = 1
            mock_db.session.query.side_effect = [upload_query, segment_query]

            result = DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        assert result is document
        assert document.dataset_process_rule_id == "rule-2"
        assert document.name == "upload.txt"
        assert process_rule_cls.call_args.kwargs == {
            "dataset_id": "dataset-1",
            "mode": "automatic",
            "rules": json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
            "created_by": "user-1",
        }
        assert mock_db.session.commit.call_count == 3
        update_task.delay.assert_called_once_with("dataset-1", "doc-1")

    def test_update_document_with_dataset_id_requires_upload_file_info(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="upload_file")),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=_make_document()),
            patch.object(DatasetService, "check_dataset_model_setting"),
        ):
            with pytest.raises(ValueError, match="No file info list found"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_raises_when_upload_file_is_missing(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="upload_file",
                    file_info_list=FileInfo(file_ids=["file-1"]),
                )
            ),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=_make_document()),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
        ):
            mock_db.session.query.return_value.where.return_value.first.return_value = None

            with pytest.raises(FileNotExistsError):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_requires_notion_info_list(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="notion_import")),
        )

        with (
            patch.object(DocumentService, "get_document", return_value=_make_document()),
            patch.object(DatasetService, "check_dataset_model_setting"),
        ):
            with pytest.raises(ValueError, match="No notion info list found"):
                DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

    def test_update_document_with_dataset_id_notion_import_updates_page_info(self, account_context):
        dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
        document = _make_document()
        document_data = KnowledgeConfig(
            original_document_id="doc-1",
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[
                                NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page"),
                                NotionPage(page_id="page-2", page_name="Page 2", page_icon=None, type="database"),
                            ],
                        )
                    ],
                )
            ),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        with (
            patch.object(DocumentService, "get_document", return_value=document),
            patch.object(DatasetService, "check_dataset_model_setting"),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.document_indexing_update_task") as update_task,
        ):
            binding_query = MagicMock()
            binding_query.where.return_value.first.return_value = SimpleNamespace(id="binding-1")
            segment_query = MagicMock()
            segment_query.filter_by.return_value.update.return_value = 1
            mock_db.session.query.side_effect = [binding_query, segment_query]

            result = DocumentService.update_document_with_dataset_id(dataset, document_data, account_context)

        assert result is document
        assert document.data_source_type == "notion_import"
        assert document.name == ""
        assert document.data_source_info == json.dumps(
            {
                "credential_id": "credential-1",
                "notion_workspace_id": "workspace-1",
                "notion_page_id": "page-2",
                "notion_page_icon": None,
                "type": "database",
            }
        )
        update_task.delay.assert_called_once_with("dataset-1", "doc-1")


class TestDocumentServiceSaveWithoutDatasetBilling:
    """Unit tests for batch-count and quota branches in save_document_without_dataset_id."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_save_document_without_dataset_id_counts_notion_pages_for_quota(self, account_context):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="notion_import",
                    notion_info_list=[
                        NotionInfo(
                            credential_id="credential-1",
                            workspace_id="workspace-1",
                            pages=[
                                NotionPage(page_id="page-1", page_name="Page 1", page_icon=None, type="page"),
                                NotionPage(page_id="page-2", page_name="Page 2", page_icon=None, type="page"),
                            ],
                        ),
                        NotionInfo(
                            credential_id="credential-2",
                            workspace_id="workspace-2",
                            pages=[NotionPage(page_id="page-3", page_name="Page 3", page_icon=None, type="page")],
                        ),
                    ],
                )
            ),
        )
        created_dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1", name="", description=None)
        features = _make_features(enabled=True)

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=features),
            patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", "10"),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
            patch(
                "services.dataset_service.Dataset",
                side_effect=lambda **kwargs: created_dataset.__dict__.update(kwargs) or created_dataset,
            ),
            patch.object(
                DocumentService,
                "save_document_with_dataset_id",
                return_value=([SimpleNamespace(name="Doc")], "batch-1"),
            ),
            patch("services.dataset_service.db"),
        ):
            DocumentService.save_document_without_dataset_id("tenant-1", knowledge_config, account_context)

        check_quota.assert_called_once_with(3, features)

    def test_save_document_without_dataset_id_enforces_batch_limit_for_website_urls(self, account_context):
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(
                info_list=InfoList(
                    data_source_type="website_crawl",
                    website_info_list=WebsiteInfo(
                        provider="firecrawl",
                        job_id="job-1",
                        urls=["https://example.com/a", "https://example.com/b"],
                        only_main_content=True,
                    ),
                )
            ),
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=True)),
            patch("services.dataset_service.dify_config.BATCH_UPLOAD_LIMIT", "1"),
            patch.object(DocumentService, "check_documents_upload_quota") as check_quota,
        ):
            with pytest.raises(ValueError, match="batch upload limit of 1"):
                DocumentService.save_document_without_dataset_id("tenant-1", knowledge_config, account_context)

        check_quota.assert_not_called()


class TestDocumentServiceEstimateValidation:
    """Unit tests for estimate_args_validate branches."""

    def test_estimate_args_validate_rejects_missing_info_list(self):
        with pytest.raises(ValueError, match="Data source info is required"):
            DocumentService.estimate_args_validate({})

    def test_estimate_args_validate_sets_empty_rules_for_automatic_mode(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {"mode": "automatic", "rules": {"ignored": True}},
        }

        DocumentService.estimate_args_validate(args)

        assert args["process_rule"]["rules"] == {}

    def test_estimate_args_validate_rejects_unknown_pre_processing_rule_id(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [{"id": "unknown", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
            },
        }

        with pytest.raises(ValueError, match="pre_processing_rules id is invalid"):
            DocumentService.estimate_args_validate(args)

    def test_estimate_args_validate_deduplicates_rules_for_custom_mode(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [
                        {"id": "remove_stopwords", "enabled": True},
                        {"id": "remove_stopwords", "enabled": False},
                    ],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
            },
        }

        DocumentService.estimate_args_validate(args)

        assert args["process_rule"]["rules"]["pre_processing_rules"] == [{"id": "remove_stopwords", "enabled": False}]

    def test_estimate_args_validate_requires_summary_index_provider_name(self):
        args = {
            "info_list": {"data_source_type": "upload_file"},
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [{"id": "remove_stopwords", "enabled": True}],
                    "segmentation": {"separator": "\n", "max_tokens": 128},
                },
                "summary_index_setting": {"enable": True, "model_name": "summary-model"},
            },
        }

        with pytest.raises(ValueError, match="Summary index model provider name is required"):
            DocumentService.estimate_args_validate(args)


class TestSegmentServiceChildChunkTailHelpers:
    """Unit tests for the remaining child-chunk helper branches."""

    def test_update_child_chunk_rolls_back_on_vector_failure(self):
        dataset = SimpleNamespace(id="dataset-1")
        child_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.current_user", SimpleNamespace(id="user-1")),
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            vector_service.update_child_chunk_vector.side_effect = RuntimeError("vector failed")

            with pytest.raises(ChildChunkIndexingError, match="vector failed"):
                SegmentService.update_child_chunk(
                    "new content", child_chunk, SimpleNamespace(), SimpleNamespace(), dataset
                )

        mock_db.session.rollback.assert_called_once()
        mock_db.session.commit.assert_not_called()

    def test_delete_child_chunk_commits_after_successful_vector_delete(self):
        dataset = SimpleNamespace(id="dataset-1")
        child_chunk = _make_child_chunk()

        with (
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            SegmentService.delete_child_chunk(child_chunk, dataset)

        mock_db.session.delete.assert_called_once_with(child_chunk)
        vector_service.delete_child_chunk_vector.assert_called_once_with(child_chunk, dataset)
        mock_db.session.commit.assert_called_once()


class TestDocumentServiceSaveDocumentAdditionalBranches:
    """Additional unit tests for dataset bootstrap and process-rule branches."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with (
            patch("services.dataset_service.current_user", account),
            patch.object(DatasetService, "check_doc_form"),
        ):
            yield account

    def test_save_document_with_dataset_id_initializes_high_quality_dataset_from_default_embedding_model(
        self, account_context
    ):
        dataset = _make_dataset(data_source_type=None, indexing_technique=None)
        knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.embedding_model = None
        knowledge_config.embedding_model_provider = None
        updated_document = _make_document(batch="batch-existing")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-1"),
            ) as get_binding,
            patch.object(DocumentService, "update_document_with_dataset_id", return_value=updated_document),
        ):
            model_manager_cls.return_value.get_default_model_instance.return_value = SimpleNamespace(
                model_name="default-embedding",
                provider="default-provider",
            )

            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert documents == [updated_document]
        assert batch == "batch-existing"
        assert dataset.data_source_type == "upload_file"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "default-embedding"
        assert dataset.embedding_model_provider == "default-provider"
        assert dataset.collection_binding_id == "binding-1"
        assert dataset.retrieval_model == {
            "search_method": "semantic_search",
            "reranking_enable": False,
            "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
            "top_k": 4,
            "score_threshold_enabled": False,
        }
        get_binding.assert_called_once_with("default-provider", "default-embedding")

    def test_save_document_with_dataset_id_uses_explicit_embedding_and_retrieval_model(self, account_context):
        dataset = _make_dataset(indexing_technique=None)
        knowledge_config = _make_upload_knowledge_config(original_document_id="doc-1", file_ids=["file-1"])
        knowledge_config.indexing_technique = "high_quality"
        knowledge_config.embedding_model = "explicit-model"
        knowledge_config.embedding_model_provider = "explicit-provider"
        knowledge_config.retrieval_model = RetrievalModel(
            search_method="semantic_search",
            reranking_enable=True,
            reranking_model=RerankingModel(
                reranking_provider_name="rerank-provider",
                reranking_model_name="rerank-model",
            ),
            top_k=7,
            score_threshold_enabled=True,
            score_threshold=0.3,
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch(
                "services.dataset_service.DatasetCollectionBindingService.get_dataset_collection_binding",
                return_value=SimpleNamespace(id="binding-2"),
            ) as get_binding,
            patch.object(DocumentService, "update_document_with_dataset_id", return_value=_make_document()),
        ):
            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        model_manager_cls.return_value.get_default_model_instance.assert_not_called()
        get_binding.assert_called_once_with("explicit-provider", "explicit-model")
        assert dataset.embedding_model == "explicit-model"
        assert dataset.embedding_model_provider == "explicit-provider"
        assert dataset.retrieval_model == knowledge_config.retrieval_model.model_dump()

    def test_save_document_with_dataset_id_creates_custom_process_rule_for_new_upload_document(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(
            file_ids=["file-1"],
            process_rule=ProcessRule(
                mode="custom",
                rules=Rule(
                    pre_processing_rules=[PreProcessingRule(id="remove_stopwords", enabled=True)],
                    segmentation=Segmentation(separator="\n", max_tokens=128),
                ),
            ),
        )
        created_process_rule = SimpleNamespace(id="rule-custom")
        created_document = _make_document(document_id="doc-created", name="file.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.DatasetProcessRule") as process_rule_cls,
            patch.object(DocumentService, "get_documents_position", return_value=3),
            patch.object(DocumentService, "build_document", return_value=created_document),
            patch("services.dataset_service.DocumentIndexingTaskProxy") as document_proxy_cls,
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            process_rule_cls.return_value = created_process_rule
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [SimpleNamespace(id="file-1", name="file.txt")]
            existing_documents_query = MagicMock()
            existing_documents_query.where.return_value.all.return_value = []
            mock_db.session.query.side_effect = [upload_query, existing_documents_query]

            documents, batch = DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert documents == [created_document]
        assert batch == "20260101010101100023"
        assert process_rule_cls.call_args.kwargs == {
            "dataset_id": "dataset-1",
            "mode": "custom",
            "rules": knowledge_config.process_rule.rules.model_dump_json(),
            "created_by": "user-1",
        }
        document_proxy_cls.assert_called_once_with("tenant-1", "dataset-1", ["doc-created"])
        document_proxy_cls.return_value.delay.assert_called_once()

    def test_save_document_with_dataset_id_creates_automatic_process_rule_for_new_upload_document(
        self, account_context
    ):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(
            file_ids=["file-1"],
            process_rule=ProcessRule(mode="automatic"),
        )
        created_process_rule = SimpleNamespace(id="rule-auto")
        created_document = _make_document(document_id="doc-created", name="file.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.DatasetProcessRule") as process_rule_cls,
            patch.object(DocumentService, "get_documents_position", return_value=1),
            patch.object(DocumentService, "build_document", return_value=created_document),
            patch("services.dataset_service.DocumentIndexingTaskProxy"),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            process_rule_cls.AUTOMATIC_RULES = DatasetProcessRule.AUTOMATIC_RULES
            process_rule_cls.return_value = created_process_rule
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [SimpleNamespace(id="file-1", name="file.txt")]
            existing_documents_query = MagicMock()
            existing_documents_query.where.return_value.all.return_value = []
            mock_db.session.query.side_effect = [upload_query, existing_documents_query]

            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert process_rule_cls.call_args.kwargs == {
            "dataset_id": "dataset-1",
            "mode": "automatic",
            "rules": json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
            "created_by": "user-1",
        }
        assert mock_db.session.flush.call_count >= 2

    def test_save_document_with_dataset_id_creates_fallback_automatic_process_rule_when_latest_is_missing(
        self, account_context
    ):
        dataset = _make_dataset(latest_process_rule=None)
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1"], process_rule=None)
        created_process_rule = SimpleNamespace(id="rule-fallback")
        created_document = _make_document(document_id="doc-created", name="file.txt")

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.DatasetProcessRule") as process_rule_cls,
            patch.object(DocumentService, "get_documents_position", return_value=1),
            patch.object(DocumentService, "build_document", return_value=created_document),
            patch("services.dataset_service.DocumentIndexingTaskProxy"),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            process_rule_cls.AUTOMATIC_RULES = DatasetProcessRule.AUTOMATIC_RULES
            process_rule_cls.return_value = created_process_rule
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [SimpleNamespace(id="file-1", name="file.txt")]
            existing_documents_query = MagicMock()
            existing_documents_query.where.return_value.all.return_value = []
            mock_db.session.query.side_effect = [upload_query, existing_documents_query]

            DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

        assert process_rule_cls.call_args.kwargs == {
            "dataset_id": "dataset-1",
            "mode": "automatic",
            "rules": json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
            "created_by": "user-1",
        }

    def test_save_document_with_dataset_id_raises_when_upload_file_lookup_is_incomplete(self, account_context):
        dataset = _make_dataset()
        knowledge_config = _make_upload_knowledge_config(file_ids=["file-1", "file-2"])

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch.object(DocumentService, "get_documents_position", return_value=1),
            patch("services.dataset_service.time.strftime", return_value="20260101010101"),
            patch("services.dataset_service.secrets.randbelow", return_value=23),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            upload_query = MagicMock()
            upload_query.where.return_value.all.return_value = [SimpleNamespace(id="file-1", name="file.txt")]
            mock_db.session.query.return_value = upload_query

            with pytest.raises(FileNotExistsError, match="One or more files not found"):
                DocumentService.save_document_with_dataset_id(dataset, knowledge_config, account_context)

    def test_save_document_with_dataset_id_requires_notion_info_list_for_notion_import(self, account_context):
        dataset = _make_dataset()
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="notion_import")),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch.object(DocumentService, "get_documents_position", return_value=1),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            with pytest.raises(ValueError, match="No notion info list found"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    dataset_process_rule=SimpleNamespace(id="rule-1"),
                )

    def test_save_document_with_dataset_id_requires_website_info_list_for_website_crawl(self, account_context):
        dataset = _make_dataset()
        knowledge_config = KnowledgeConfig(
            indexing_technique="economy",
            data_source=DataSource(info_list=InfoList(data_source_type="website_crawl")),
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            doc_language="English",
        )

        with (
            patch("services.dataset_service.FeatureService.get_features", return_value=_make_features(enabled=False)),
            patch("services.dataset_service.redis_client") as mock_redis,
            patch.object(DocumentService, "get_documents_position", return_value=1),
        ):
            mock_redis.lock.return_value = _make_lock_context()
            with pytest.raises(ValueError, match="No website info list found"):
                DocumentService.save_document_with_dataset_id(
                    dataset,
                    knowledge_config,
                    account_context,
                    dataset_process_rule=SimpleNamespace(id="rule-1"),
                )


class TestSegmentServiceAdditionalRegenerationBranches:
    """Additional unit tests for segment update and regeneration edge cases."""

    @pytest.fixture
    def account_context(self):
        account = create_autospec(Account, instance=True)
        account.id = "user-1"
        account.current_tenant_id = "tenant-1"

        with patch("services.dataset_service.current_user", account):
            yield account

    def test_update_segment_same_content_updates_answer_and_document_word_count_for_qa_segments(self, account_context):
        segment = _make_segment(content="question", word_count=8)
        document = _make_document(doc_form=IndexStructureType.QA_INDEX, word_count=20)
        dataset = _make_dataset()
        refreshed_segment = SimpleNamespace(id=segment.id)

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.get.return_value = None
            mock_db.session.query.return_value.where.return_value.first.return_value = refreshed_segment

            result = SegmentService.update_segment(
                SegmentUpdateArgs(content="question", answer="new answer"),
                segment,
                document,
                dataset,
            )

        assert result is refreshed_segment
        assert segment.answer == "new answer"
        assert segment.word_count == len("question") + len("new answer")
        assert document.word_count == 20 + (len("question") + len("new answer") - 8)
        vector_service.update_segment_vector.assert_not_called()
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_content_change_uses_answer_when_counting_tokens_for_qa_segments(self, account_context):
        segment = _make_segment(content="old", word_count=3)
        document = _make_document(doc_form=IndexStructureType.QA_INDEX, word_count=10)
        dataset = _make_dataset(indexing_technique="high_quality")
        refreshed_segment = SimpleNamespace(id=segment.id)
        embedding_model = MagicMock()
        embedding_model.get_text_embedding_num_tokens.return_value = [21]

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-qa"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
        ):
            mock_redis.get.return_value = None
            model_manager_cls.return_value.get_model_instance.return_value = embedding_model
            summary_query = MagicMock()
            summary_query.where.return_value.first.return_value = None
            refreshed_query = MagicMock()
            refreshed_query.where.return_value.first.return_value = refreshed_segment
            mock_db.session.query.side_effect = [summary_query, refreshed_query]

            result = SegmentService.update_segment(
                SegmentUpdateArgs(content="new question", answer="new answer", keywords=["kw-1"]),
                segment,
                document,
                dataset,
            )

        assert result is refreshed_segment
        embedding_model.get_text_embedding_num_tokens.assert_called_once_with(texts=["new questionnew answer"])
        assert segment.answer == "new answer"
        assert segment.tokens == 21
        assert segment.word_count == len("new question") + len("new answer")
        vector_service.update_segment_vector.assert_called_once_with(["kw-1"], segment, dataset)
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_content_change_parent_child_uses_default_embedding_and_ignores_summary_failures(
        self, account_context
    ):
        segment = _make_segment(content="old", word_count=3)
        document = _make_document(
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            word_count=10,
        )
        dataset = _make_dataset(indexing_technique="high_quality")
        dataset.embedding_model_provider = None
        refreshed_segment = SimpleNamespace(id=segment.id)
        processing_rule = SimpleNamespace(id=document.dataset_process_rule_id)
        existing_summary = SimpleNamespace(summary_content="old summary")
        embedding_model_instance = object()

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.ModelManager") as model_manager_cls,
            patch("services.dataset_service.VectorService") as vector_service,
            patch("services.dataset_service.helper.generate_text_hash", return_value="hash-parent"),
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.summary_index_service.SummaryIndexService.update_summary_for_segment") as update_summary,
        ):
            mock_redis.get.return_value = None
            model_manager_cls.return_value.get_default_model_instance.return_value = embedding_model_instance
            update_summary.side_effect = RuntimeError("summary failed")

            processing_rule_query = MagicMock()
            processing_rule_query.where.return_value.first.return_value = processing_rule
            summary_query = MagicMock()
            summary_query.where.return_value.first.return_value = existing_summary
            refreshed_query = MagicMock()
            refreshed_query.where.return_value.first.return_value = refreshed_segment
            mock_db.session.query.side_effect = [processing_rule_query, summary_query, refreshed_query]

            result = SegmentService.update_segment(
                SegmentUpdateArgs(content="new parent content", regenerate_child_chunks=True, summary="new summary"),
                segment,
                document,
                dataset,
            )

        assert result is refreshed_segment
        model_manager_cls.return_value.get_default_model_instance.assert_called_once_with(
            tenant_id="tenant-1",
            model_type="text-embedding",
        )
        vector_service.generate_child_chunks.assert_called_once_with(
            segment,
            document,
            dataset,
            embedding_model_instance,
            processing_rule,
            True,
        )
        update_summary.assert_called_once_with(segment, dataset, "new summary")
        vector_service.update_multimodel_vector.assert_called_once_with(segment, [], dataset)

    def test_update_segment_same_content_parent_child_marks_segment_error_for_non_high_quality_dataset(
        self, account_context
    ):
        segment = _make_segment(content="same content", word_count=len("same content"))
        document = _make_document(
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            word_count=20,
        )
        dataset = _make_dataset(indexing_technique="economy")
        refreshed_segment = SimpleNamespace(id=segment.id)

        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db") as mock_db,
            patch("services.dataset_service.naive_utc_now", return_value="now"),
            patch("services.dataset_service.VectorService") as vector_service,
        ):
            mock_redis.get.return_value = None
            mock_db.session.query.return_value.where.return_value.first.return_value = refreshed_segment

            result = SegmentService.update_segment(
                SegmentUpdateArgs(content="same content", regenerate_child_chunks=True),
                segment,
                document,
                dataset,
            )

        assert result is refreshed_segment
        assert segment.enabled is False
        assert segment.disabled_at == "now"
        assert segment.status == "error"
        assert segment.error == "The knowledge base index technique is not high quality!"
        vector_service.update_multimodel_vector.assert_not_called()
