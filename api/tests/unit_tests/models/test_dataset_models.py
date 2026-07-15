"""
Comprehensive unit tests for Dataset models.

This test suite covers:
- Dataset model validation
- Document model relationships
- Segment model indexing
- Dataset-Document cascade deletes
- Embedding storage validation
"""

import json
import pickle
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock, call, patch
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest

from core.rag.entities import ParentMode
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.account import Account
from models.dataset import (
    AppDatasetJoin,
    ChildChunk,
    Dataset,
    DatasetKeywordTable,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentSegment,
    Embedding,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
)
from models.enums import (
    CreatorUserRole,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    ProcessRuleMode,
    SegmentStatus,
)
from models.model import UploadFile


class TestDatasetModelValidation:
    """Test suite for Dataset model validation and basic operations."""

    def test_dataset_creation_with_required_fields(self):
        """Test creating a dataset with all required fields."""
        # Arrange
        tenant_id = str(uuid4())
        created_by = str(uuid4())

        # Act
        dataset = Dataset(
            tenant_id=tenant_id,
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=created_by,
        )

        # Assert
        assert dataset.name == "Test Dataset"
        assert dataset.tenant_id == tenant_id
        assert dataset.data_source_type == DataSourceType.UPLOAD_FILE
        assert dataset.created_by == created_by
        # Note: Default values are set by database, not by model instantiation

    def test_dataset_creation_with_optional_fields(self):
        """Test creating a dataset with optional fields."""
        # Arrange & Act
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
            description="Test description",
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
        )

        # Assert
        assert dataset.description == "Test description"
        assert dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        assert dataset.embedding_model == "text-embedding-ada-002"
        assert dataset.embedding_model_provider == "openai"

    def test_session_aware_dataset_getters_use_caller_session(self):
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
        )
        dataset.id = str(uuid4())
        account = Mock()
        process_rule = Mock()
        session = Mock()
        session.get.return_value = account
        session.scalar.side_effect = [process_rule, IndexStructureType.PARAGRAPH_INDEX]

        assert dataset.get_created_by_account(session=session) is account
        assert dataset.get_latest_process_rule(session=session) is process_rule
        assert dataset.get_doc_form(session=session) == IndexStructureType.PARAGRAPH_INDEX

        session.get.assert_called_once_with(Account, dataset.created_by)
        assert session.scalar.call_count == 2

    def test_get_dataset_keyword_table_uses_caller_session(self):
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
        )
        dataset.id = str(uuid4())
        keyword_table = Mock()
        session = Mock()
        session.scalar.return_value = keyword_table

        result = dataset.get_dataset_keyword_table(session=session)

        assert result is keyword_table
        session.scalar.assert_called_once()

    def test_dataset_detail_getters_use_caller_session(self):
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
            provider="vendor",
            built_in_field_enabled=False,
        )
        dataset.id = str(uuid4())
        account = Mock(name="account", name_value="Ada")
        account.name = "Ada"
        session = Mock()
        session.get.return_value = account
        session.scalar.side_effect = [2, 1, 3, 2, 500, IndexStructureType.PARAGRAPH_INDEX]
        session.scalars.return_value.all.return_value = []

        with patch("models.dataset.db") as mock_db:
            assert dataset.get_total_documents(session=session) == 2
            assert dataset.get_total_available_documents(session=session) == 1
            assert dataset.get_app_count(session=session) == 3
            assert dataset.get_document_count(session=session) == 2
            assert dataset.get_word_count(session=session) == 500
            assert dataset.get_author_name(session=session) == "Ada"
            assert dataset.get_tags(session=session) == []
            assert dataset.get_doc_form(session=session) == IndexStructureType.PARAGRAPH_INDEX
            assert dataset.get_external_knowledge_info(session=session) is None
            assert dataset.get_doc_metadata(session=session) == []
            assert dataset.get_is_published(session=session) is False

        assert session.scalar.call_count == 6
        assert session.scalars.call_count == 2
        mock_db.session.scalar.assert_not_called()
        mock_db.session.scalars.assert_not_called()

    def test_dataset_indexing_technique_validation(self):
        """Test dataset indexing technique values."""
        # Arrange & Act
        dataset_high_quality = Dataset(
            tenant_id=str(uuid4()),
            name="High Quality Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        )
        dataset_economy = Dataset(
            tenant_id=str(uuid4()),
            name="Economy Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
            indexing_technique=IndexTechniqueType.ECONOMY,
        )

        # Assert
        assert dataset_high_quality.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        assert dataset_economy.indexing_technique == IndexTechniqueType.ECONOMY
        assert IndexTechniqueType.HIGH_QUALITY in Dataset.INDEXING_TECHNIQUE_LIST
        assert IndexTechniqueType.ECONOMY in Dataset.INDEXING_TECHNIQUE_LIST

    def test_dataset_provider_validation(self):
        """Test dataset provider values."""
        # Arrange & Act
        dataset_vendor = Dataset(
            tenant_id=str(uuid4()),
            name="Vendor Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
            provider="vendor",
        )
        dataset_external = Dataset(
            tenant_id=str(uuid4()),
            name="External Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
            provider="external",
        )

        # Assert
        assert dataset_vendor.provider == "vendor"
        assert dataset_external.provider == "external"
        assert "vendor" in Dataset.PROVIDER_LIST
        assert "external" in Dataset.PROVIDER_LIST

    def test_dataset_index_struct_dict_property(self):
        """Test index_struct_dict property parsing."""
        # Arrange
        index_struct_data = {"type": "vector", "dimension": 1536}
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
            index_struct=json.dumps(index_struct_data),
        )

        # Act
        result = dataset.index_struct_dict

        # Assert
        assert result == index_struct_data
        assert result["type"] == "vector"
        assert result["dimension"] == 1536

    def test_dataset_index_struct_dict_property_none(self):
        """Test index_struct_dict property when index_struct is None."""
        # Arrange
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
        )

        # Act
        result = dataset.index_struct_dict

        # Assert
        assert result is None

    def test_dataset_external_retrieval_model_property(self):
        """Test external_retrieval_model property with default values."""
        # Arrange
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
        )

        # Act
        result = dataset.external_retrieval_model

        # Assert
        assert result["top_k"] == 2
        assert result["score_threshold"] == 0.0

    def test_dataset_external_knowledge_info_returns_none_for_cross_tenant_template(self):
        """Test external datasets fail closed when the bound template is outside the tenant."""
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="External Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
            provider="external",
        )
        binding = Mock(spec=ExternalKnowledgeBindings)
        binding.external_knowledge_id = "knowledge-1"
        binding.external_knowledge_api_id = str(uuid4())

        session = Mock()
        session.scalar.side_effect = [binding, None]
        with patch("models.dataset.db") as mock_db:
            assert dataset.get_external_knowledge_info(session=session) is None

        assert session.scalar.call_count == 2
        mock_db.session.scalar.assert_not_called()

    def test_external_knowledge_api_dataset_bindings_use_caller_session(self):
        external_api = ExternalKnowledgeApis(
            tenant_id=str(uuid4()),
            created_by=str(uuid4()),
            updated_by=None,
            name="External API",
            description="",
            settings=None,
        )
        binding = Mock(dataset_id="dataset-1")
        dataset = SimpleNamespace(id="dataset-1", name="Dataset")
        session = Mock()
        session.scalars.side_effect = [
            Mock(all=Mock(return_value=[binding])),
            Mock(all=Mock(return_value=[dataset])),
        ]

        with patch("models.dataset.db") as mock_db:
            result = external_api.get_dataset_bindings(session=session)

        assert result == [{"id": "dataset-1", "name": "Dataset"}]
        assert session.scalars.call_count == 2
        mock_db.session.scalars.assert_not_called()

    def test_dataset_query_get_queries_uses_caller_session(self):
        dataset_query = DatasetQuery(
            dataset_id=str(uuid4()),
            content=json.dumps([{"content_type": "image_query", "content": "file-1"}]),
            source="hit_testing",
            source_app_id=None,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
        )
        upload_file = SimpleNamespace(
            id="file-1",
            name="image.png",
            size=10,
            extension="png",
            mime_type="image/png",
        )
        session = Mock()
        session.scalar.return_value = upload_file

        with (
            patch("models.dataset.db") as mock_db,
            patch("models.dataset.sign_upload_file_preview_url", return_value="signed-url"),
        ):
            queries = dataset_query.get_queries(session=session)

        assert queries == [
            {
                "content_type": "image_query",
                "content": "file-1",
                "file_info": {
                    "id": "file-1",
                    "name": "image.png",
                    "size": 10,
                    "extension": "png",
                    "mime_type": "image/png",
                    "source_url": "signed-url",
                },
            }
        ]
        session.scalar.assert_called_once()
        mock_db.session.scalar.assert_not_called()

    def test_dataset_retrieval_model_dict_property(self):
        """Test retrieval_model_dict property with default values."""
        # Arrange
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
        )

        # Act
        result = dataset.retrieval_model_dict

        # Assert
        assert result["top_k"] == 2
        assert result["reranking_enable"] is False
        assert result["score_threshold_enabled"] is False

    def test_dataset_retrieval_model_dict_property_merges_partial_values(self):
        """Test retrieval_model_dict property fills in missing legacy keys."""
        # Arrange
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=str(uuid4()),
            retrieval_model={
                "top_k": 4,
                "score_threshold_enabled": True,
                "score_threshold": 0.42,
            },
        )

        # Act
        result = dataset.retrieval_model_dict

        # Assert
        assert result["search_method"] == "semantic_search"
        assert result["reranking_enable"] is False
        assert result["top_k"] == 4
        assert result["score_threshold_enabled"] is True
        assert result["score_threshold"] == 0.42

    def test_dataset_gen_collection_name_by_id(self):
        """Test static method for generating collection name."""
        # Arrange
        dataset_id = "12345678-1234-1234-1234-123456789abc"

        # Act
        collection_name = Dataset.gen_collection_name_by_id(dataset_id)

        # Assert
        assert "12345678_1234_1234_1234_123456789abc" in collection_name
        assert "-" not in collection_name.split("_")[-1]


class TestDocumentModelRelationships:
    """Test suite for Document model relationships and properties."""

    def test_document_creation_with_required_fields(self):
        """Test creating a document with all required fields."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_id = str(uuid4())
        created_by = str(uuid4())

        # Act
        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test_document.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=created_by,
        )

        # Assert
        assert document.tenant_id == tenant_id
        assert document.dataset_id == dataset_id
        assert document.position == 1
        assert document.data_source_type == DataSourceType.UPLOAD_FILE
        assert document.batch == "batch_001"
        assert document.name == "test_document.pdf"
        assert document.created_from == DocumentCreatedFrom.WEB
        assert document.created_by == created_by
        # Note: Default values are set by database, not by model instantiation

    def test_document_data_source_types(self):
        """Test document data source type validation."""
        # Assert
        assert "upload_file" in Document.DATA_SOURCES
        assert "notion_import" in Document.DATA_SOURCES
        assert "website_crawl" in Document.DATA_SOURCES

    def test_session_aware_document_getters_use_caller_session(self):
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            dataset_process_rule_id=str(uuid4()),
        )
        process_rule = Mock()
        session = Mock()
        session.get.return_value = process_rule
        session.scalar.side_effect = [3, 7]

        assert document.get_dataset_process_rule(session=session) is process_rule
        assert document.get_segment_count(session=session) == 3
        assert document.get_hit_count(session=session) == 7

        session.get.assert_called_once_with(DatasetProcessRule, document.dataset_process_rule_id)
        assert session.scalar.call_count == 2

    def test_document_display_status_queuing(self):
        """Test document display_status property for queuing state."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            indexing_status=IndexingStatus.WAITING,
        )

        # Act
        status = document.display_status

        # Assert
        assert status == "queuing"

    def test_document_display_status_paused(self):
        """Test document display_status property for paused state."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            indexing_status=IndexingStatus.PARSING,
            is_paused=True,
        )

        # Act
        status = document.display_status

        # Assert
        assert status == "paused"

    def test_document_display_status_indexing(self):
        """Test document display_status property for indexing state."""
        # Arrange
        for indexing_status in [
            IndexingStatus.PARSING,
            IndexingStatus.CLEANING,
            IndexingStatus.SPLITTING,
            IndexingStatus.INDEXING,
        ]:
            document = Document(
                tenant_id=str(uuid4()),
                dataset_id=str(uuid4()),
                position=1,
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch="batch_001",
                name="test.pdf",
                created_from=DocumentCreatedFrom.WEB,
                created_by=str(uuid4()),
                indexing_status=indexing_status,
            )

            # Act
            status = document.display_status

            # Assert
            assert status == "indexing"

    def test_document_display_status_error(self):
        """Test document display_status property for error state."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            indexing_status=IndexingStatus.ERROR,
        )

        # Act
        status = document.display_status

        # Assert
        assert status == "error"

    def test_document_display_status_available(self):
        """Test document display_status property for available state."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            indexing_status=IndexingStatus.COMPLETED,
            enabled=True,
            archived=False,
        )

        # Act
        status = document.display_status

        # Assert
        assert status == "available"

    def test_document_display_status_disabled(self):
        """Test document display_status property for disabled state."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            indexing_status=IndexingStatus.COMPLETED,
            enabled=False,
            archived=False,
        )

        # Act
        status = document.display_status

        # Assert
        assert status == "disabled"

    def test_document_display_status_archived(self):
        """Test document display_status property for archived state."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            indexing_status=IndexingStatus.COMPLETED,
            archived=True,
        )

        # Act
        status = document.display_status

        # Assert
        assert status == "archived"

    def test_document_data_source_info_dict_property(self):
        """Test data_source_info_dict property parsing."""
        # Arrange
        data_source_info = {"upload_file_id": str(uuid4()), "file_name": "test.pdf"}
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            data_source_info=json.dumps(data_source_info),
        )

        # Act
        result = document.data_source_info_dict

        # Assert
        assert result == data_source_info
        assert "upload_file_id" in result
        assert "file_name" in result

    def test_document_data_source_info_dict_property_empty(self):
        """Test data_source_info_dict property when data_source_info is None."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
        )

        # Act
        result = document.data_source_info_dict

        # Assert
        assert result == {}

    def test_document_get_dataset_uses_caller_session(self):
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
        )
        dataset = Mock(spec=Dataset)
        session = Mock()
        session.get.return_value = dataset

        assert document.get_dataset(session=session) is dataset
        session.get.assert_called_once_with(Dataset, document.dataset_id)

    def test_document_average_segment_length(self):
        """Test average_segment_length property calculation."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            word_count=1000,
        )

        # Mock segment_count property
        with patch.object(Document, "segment_count", new_callable=lambda: property(lambda self: 10)):
            # Act
            result = document.average_segment_length

            # Assert
            assert result == 100

    def test_document_average_segment_length_zero(self):
        """Test average_segment_length property when word_count is zero."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=str(uuid4()),
            word_count=0,
        )

        # Act
        result = document.average_segment_length

        # Assert
        assert result == 0


class TestDocumentSegmentIndexing:
    """Test suite for DocumentSegment model indexing and operations."""

    def test_get_child_chunks_uses_caller_session(self):
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content="Test content",
            word_count=2,
            tokens=5,
            created_by=str(uuid4()),
        )
        document = Mock(spec=Document)
        process_rule = Mock(mode="hierarchical", rules_dict={"parent_mode": "paragraph"})
        document.get_dataset_process_rule.return_value = process_rule
        child_chunk = Mock(spec=ChildChunk)
        session = Mock()
        session.get.return_value = document
        session.scalars.return_value.all.return_value = [child_chunk]

        with patch("models.dataset.Rule.model_validate", return_value=Mock(parent_mode="paragraph")):
            result = segment.get_child_chunks(session=session)

        assert result == [child_chunk]
        session.get.assert_called_once_with(Document, segment.document_id)
        document.get_dataset_process_rule.assert_called_once_with(session=session)
        session.scalars.assert_called_once()

    def test_get_child_chunks_includes_full_doc_unless_explicitly_hidden(self):
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content="Test content",
            word_count=2,
            tokens=5,
            created_by=str(uuid4()),
        )
        document = Mock(spec=Document)
        document.get_dataset_process_rule.return_value = Mock(
            mode="hierarchical",
            rules_dict={"parent_mode": ParentMode.FULL_DOC},
        )
        session = Mock()
        session.get.return_value = document
        child_chunk = Mock(spec=ChildChunk)
        session.scalars.return_value.all.return_value = [child_chunk]

        with patch("models.dataset.Rule.model_validate", return_value=Mock(parent_mode=ParentMode.FULL_DOC)):
            result = segment.get_child_chunks(session=session)
            response_result = segment.get_child_chunks(session=session, include_full_doc=False)

        assert result == [child_chunk]
        assert response_result == []
        session.scalars.assert_called_once()

    def test_relationship_getters_use_caller_session(self):
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content="Test content",
            word_count=2,
            tokens=5,
            created_by=str(uuid4()),
        )
        dataset = Mock(spec=Dataset)
        document = Mock(spec=Document)
        session = Mock()
        session.get.side_effect = [dataset, document]

        assert segment.get_dataset(session=session) is dataset
        assert segment.get_document(session=session) is document
        assert session.get.call_args_list == [
            call(Dataset, segment.dataset_id),
            call(Document, segment.document_id),
        ]

    def test_document_segment_creation_with_required_fields(self):
        """Test creating a document segment with all required fields."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_id = str(uuid4())
        document_id = str(uuid4())
        created_by = str(uuid4())

        # Act
        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            position=1,
            content="This is a test segment content.",
            word_count=6,
            tokens=10,
            created_by=created_by,
        )

        # Assert
        assert segment.tenant_id == tenant_id
        assert segment.dataset_id == dataset_id
        assert segment.document_id == document_id
        assert segment.position == 1
        assert segment.content == "This is a test segment content."
        assert segment.word_count == 6
        assert segment.tokens == 10
        assert segment.created_by == created_by
        # Note: Default values are set by database, not by model instantiation

    def test_document_segment_with_indexing_fields(self):
        """Test creating a document segment with indexing fields."""
        # Arrange
        index_node_id = str(uuid4())
        index_node_hash = "abc123hash"
        keywords = ["test", "segment", "indexing"]

        # Act
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content="Test content",
            word_count=2,
            tokens=5,
            created_by=str(uuid4()),
            index_node_id=index_node_id,
            index_node_hash=index_node_hash,
            keywords=keywords,
        )

        # Assert
        assert segment.index_node_id == index_node_id
        assert segment.index_node_hash == index_node_hash
        assert segment.keywords == keywords

    def test_document_segment_with_answer_field(self):
        """Test creating a document segment with answer field for QA model."""
        # Arrange
        content = "What is AI?"
        answer = "AI stands for Artificial Intelligence."

        # Act
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content=content,
            answer=answer,
            word_count=3,
            tokens=8,
            created_by=str(uuid4()),
        )

        # Assert
        assert segment.content == content
        assert segment.answer == answer

    def test_document_segment_status_transitions(self):
        """Test document segment status field values."""
        # Arrange & Act
        segment_waiting = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
            status=SegmentStatus.WAITING,
        )
        segment_completed = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
            status=SegmentStatus.COMPLETED,
        )

        # Assert
        assert segment_waiting.status == SegmentStatus.WAITING
        assert segment_completed.status == SegmentStatus.COMPLETED

    def test_document_segment_enabled_disabled_tracking(self):
        """Test document segment enabled/disabled state tracking."""
        # Arrange
        disabled_by = str(uuid4())
        disabled_at = datetime.now(UTC)

        # Act
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
            enabled=False,
            disabled_by=disabled_by,
            disabled_at=disabled_at,
        )

        # Assert
        assert segment.enabled is False
        assert segment.disabled_by == disabled_by
        assert segment.disabled_at == disabled_at

    def test_document_segment_hit_count_tracking(self):
        """Test document segment hit count tracking."""
        # Arrange & Act
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
            hit_count=5,
        )

        # Assert
        assert segment.hit_count == 5

    def test_document_segment_attachments_prefers_files_url_for_source_url(self, monkeypatch: pytest.MonkeyPatch):
        """Test attachment source URLs use FILES_URL before falling back to CONSOLE_API_URL."""
        # Arrange
        segment = DocumentSegment(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="document-1",
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by="user-1",
        )
        segment.id = "segment-1"
        attachment = UploadFile(
            tenant_id="tenant-1",
            storage_type=StorageType.LOCAL,
            key="upload-1-key",
            name="image.png",
            size=128,
            extension="png",
            mime_type="image/png",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-1",
            created_at=datetime(2023, 11, 14, tzinfo=UTC),
            used=False,
        )
        attachment.id = "upload-1"

        monkeypatch.setattr("models.dataset.time.time", lambda: 1700000000)
        monkeypatch.setattr("models.dataset.os.urandom", lambda _: b"\x01" * 16)
        monkeypatch.setattr("models.dataset.dify_config.SECRET_KEY", "unit-secret")
        monkeypatch.setattr("models.dataset.dify_config.FILES_URL", "https://files.example.com")
        monkeypatch.setattr("models.dataset.dify_config.CONSOLE_API_URL", "https://console.example.com")

        session = Mock()
        session.execute.return_value.all.return_value = [(Mock(), attachment)]

        # Act
        attachments = segment.get_attachments(session=session)

        # Assert
        assert len(attachments) == 1
        source_url = attachments[0]["source_url"]
        parsed = urlparse(source_url)
        query = parse_qs(parsed.query)
        assert parsed.netloc == "files.example.com"
        assert parsed.path == "/files/upload-1/image-preview"
        assert query["timestamp"] == ["1700000000"]
        assert query["nonce"] == ["01010101010101010101010101010101"]
        assert query["sign"][0]
        session.execute.assert_called_once()

    def test_document_segment_error_tracking(self):
        """Test document segment error tracking."""
        # Arrange
        error_message = "Indexing failed due to timeout"
        stopped_at = datetime.now(UTC)

        # Act
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
            error=error_message,
            stopped_at=stopped_at,
        )

        # Assert
        assert segment.error == error_message
        assert segment.stopped_at == stopped_at


class TestEmbeddingStorage:
    """Test suite for Embedding model storage and retrieval."""

    def test_embedding_creation_with_required_fields(self):
        """Test creating an embedding with required fields."""
        # Arrange
        model_name = "text-embedding-ada-002"
        hash_value = "abc123hash"
        provider_name = "openai"

        # Act
        embedding = Embedding(
            model_name=model_name,
            hash=hash_value,
            provider_name=provider_name,
            embedding=b"binary_data",
        )

        # Assert
        assert embedding.model_name == model_name
        assert embedding.hash == hash_value
        assert embedding.provider_name == provider_name
        assert embedding.embedding == b"binary_data"

    def test_embedding_set_and_get_embedding(self):
        """Test setting and getting embedding data."""
        # Arrange
        embedding_data = [0.1, 0.2, 0.3, 0.4, 0.5]
        embedding = Embedding(
            model_name="text-embedding-ada-002",
            hash="test_hash",
            provider_name="openai",
            embedding=b"",
        )

        # Act
        embedding.set_embedding(embedding_data)
        retrieved_data = embedding.get_embedding()

        # Assert
        assert retrieved_data == embedding_data
        assert len(retrieved_data) == 5
        assert retrieved_data[0] == 0.1
        assert retrieved_data[4] == 0.5

    def test_embedding_pickle_serialization(self):
        """Test embedding data is properly pickled."""
        # Arrange
        embedding_data = [0.1, 0.2, 0.3]
        embedding = Embedding(
            model_name="text-embedding-ada-002",
            hash="test_hash",
            provider_name="openai",
            embedding=b"",
        )

        # Act
        embedding.set_embedding(embedding_data)

        # Assert
        # Verify the embedding is stored as pickled binary data
        assert isinstance(embedding.embedding, bytes)
        # Verify we can unpickle it
        unpickled_data = pickle.loads(embedding.embedding)  # noqa: S301
        assert unpickled_data == embedding_data

    def test_embedding_with_large_vector(self):
        """Test embedding with large dimension vector."""
        # Arrange
        # Simulate a 1536-dimension vector (OpenAI ada-002 size)
        large_embedding_data = [0.001 * i for i in range(1536)]
        embedding = Embedding(
            model_name="text-embedding-ada-002",
            hash="large_vector_hash",
            provider_name="openai",
            embedding=b"",
        )

        # Act
        embedding.set_embedding(large_embedding_data)
        retrieved_data = embedding.get_embedding()

        # Assert
        assert len(retrieved_data) == 1536
        assert retrieved_data[0] == 0.0
        assert abs(retrieved_data[1535] - 1.535) < 0.0001  # Float comparison with tolerance


class TestDatasetProcessRule:
    """Test suite for DatasetProcessRule model."""

    def test_dataset_process_rule_creation(self):
        """Test creating a dataset process rule."""
        # Arrange
        dataset_id = str(uuid4())
        created_by = str(uuid4())

        # Act
        process_rule = DatasetProcessRule(
            dataset_id=dataset_id, mode=ProcessRuleMode.AUTOMATIC, created_by=created_by, rules=None
        )

        # Assert
        assert process_rule.dataset_id == dataset_id
        assert process_rule.mode == ProcessRuleMode.AUTOMATIC
        assert process_rule.created_by == created_by

    def test_dataset_process_rule_modes(self):
        """Test dataset process rule mode validation."""
        # Assert
        assert "automatic" in DatasetProcessRule.MODES
        assert "custom" in DatasetProcessRule.MODES
        assert "hierarchical" in DatasetProcessRule.MODES

    def test_dataset_process_rule_with_rules_dict(self):
        """Test dataset process rule with rules dictionary."""
        # Arrange
        rules_data = {
            "pre_processing_rules": [
                {"id": "remove_extra_spaces", "enabled": True},
                {"id": "remove_urls_emails", "enabled": False},
            ],
            "segmentation": {"delimiter": "\n", "max_tokens": 500, "chunk_overlap": 50},
        }
        process_rule = DatasetProcessRule(
            dataset_id=str(uuid4()),
            mode=ProcessRuleMode.CUSTOM,
            created_by=str(uuid4()),
            rules=json.dumps(rules_data),
        )

        # Act
        result = process_rule.rules_dict

        # Assert
        assert result == rules_data
        assert "pre_processing_rules" in result
        assert "segmentation" in result

    def test_dataset_process_rule_to_dict(self):
        """Test dataset process rule to_dict method."""
        # Arrange
        dataset_id = str(uuid4())
        rules_data = {"test": "data"}
        process_rule = DatasetProcessRule(
            dataset_id=dataset_id,
            mode=ProcessRuleMode.AUTOMATIC,
            created_by=str(uuid4()),
            rules=json.dumps(rules_data),
        )

        # Act
        result = process_rule.to_dict()

        # Assert
        assert result["dataset_id"] == dataset_id
        assert result["mode"] == ProcessRuleMode.AUTOMATIC
        assert result["rules"] == rules_data

    def test_dataset_process_rule_automatic_rules(self):
        """Test dataset process rule automatic rules constant."""
        # Act
        automatic_rules = DatasetProcessRule.AUTOMATIC_RULES

        # Assert
        assert "pre_processing_rules" in automatic_rules
        assert "segmentation" in automatic_rules
        assert automatic_rules["segmentation"]["max_tokens"] == 500


class TestDatasetKeywordTable:
    """Test suite for DatasetKeywordTable model."""

    def test_dataset_keyword_table_creation(self):
        """Test creating a dataset keyword table."""
        # Arrange
        dataset_id = str(uuid4())
        keyword_data = {"test": ["node1", "node2"], "keyword": ["node3"]}

        # Act
        keyword_table = DatasetKeywordTable(
            dataset_id=dataset_id,
            keyword_table=json.dumps(keyword_data),
        )

        # Assert
        assert keyword_table.dataset_id == dataset_id
        assert keyword_table.data_source_type == "database"  # Default value

    def test_dataset_keyword_table_data_source_type(self):
        """Test dataset keyword table data source type."""
        # Arrange & Act
        keyword_table = DatasetKeywordTable(
            dataset_id=str(uuid4()),
            keyword_table="{}",
            data_source_type="file",
        )

        # Assert
        assert keyword_table.data_source_type == "file"

    def test_get_keyword_table_dict_from_database_uses_caller_session(self):
        dataset = Mock(tenant_id="tenant-1")
        session = Mock()
        session.scalar.return_value = dataset
        keyword_table = DatasetKeywordTable(
            dataset_id="dataset-1",
            keyword_table=json.dumps({"__data__": {"table": {"keyword": ["node-1"]}}}),
            data_source_type="database",
        )

        result = keyword_table.get_keyword_table_dict(session=session)

        assert result == {"__data__": {"table": {"keyword": {"node-1"}}}}
        session.scalar.assert_called_once()


class TestAppDatasetJoin:
    """Test suite for AppDatasetJoin model."""

    def test_app_dataset_join_creation(self):
        """Test creating an app-dataset join relationship."""
        # Arrange
        app_id = str(uuid4())
        dataset_id = str(uuid4())

        # Act
        join = AppDatasetJoin(
            app_id=app_id,
            dataset_id=dataset_id,
        )

        # Assert
        assert join.app_id == app_id
        assert join.dataset_id == dataset_id
        # Note: ID is auto-generated when saved to database


class TestChildChunk:
    """Test suite for ChildChunk model."""

    def test_child_chunk_creation(self):
        """Test creating a child chunk."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_id = str(uuid4())
        document_id = str(uuid4())
        segment_id = str(uuid4())
        created_by = str(uuid4())

        # Act
        child_chunk = ChildChunk(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            segment_id=segment_id,
            position=1,
            content="Child chunk content",
            word_count=3,
            created_by=created_by,
        )

        # Assert
        assert child_chunk.tenant_id == tenant_id
        assert child_chunk.dataset_id == dataset_id
        assert child_chunk.document_id == document_id
        assert child_chunk.segment_id == segment_id
        assert child_chunk.position == 1
        assert child_chunk.content == "Child chunk content"
        assert child_chunk.word_count == 3
        assert child_chunk.created_by == created_by
        # Note: Default values are set by database, not by model instantiation

    def test_child_chunk_with_indexing_fields(self):
        """Test creating a child chunk with indexing fields."""
        # Arrange
        index_node_id = str(uuid4())
        index_node_hash = "child_hash_123"

        # Act
        child_chunk = ChildChunk(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=str(uuid4()),
            segment_id=str(uuid4()),
            position=1,
            content="Test content",
            word_count=2,
            created_by=str(uuid4()),
            index_node_id=index_node_id,
            index_node_hash=index_node_hash,
        )

        # Assert
        assert child_chunk.index_node_id == index_node_id
        assert child_chunk.index_node_hash == index_node_hash


class TestModelIntegration:
    """Test suite for model integration scenarios."""

    def test_complete_dataset_document_segment_hierarchy(self):
        """Test complete hierarchy from dataset to segment."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_id = str(uuid4())
        document_id = str(uuid4())
        created_by = str(uuid4())

        # Create dataset
        dataset = Dataset(
            tenant_id=tenant_id,
            name="Test Dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=created_by,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        )
        dataset.id = dataset_id

        # Create document
        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=created_by,
            word_count=100,
        )
        document.id = document_id

        # Create segment
        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            position=1,
            content="Test segment content",
            word_count=3,
            tokens=5,
            created_by=created_by,
            status=SegmentStatus.COMPLETED,
        )

        # Assert
        assert dataset.id == dataset_id
        assert document.dataset_id == dataset_id
        assert segment.dataset_id == dataset_id
        assert segment.document_id == document_id
        assert dataset.indexing_technique == IndexTechniqueType.HIGH_QUALITY
        assert document.word_count == 100
        assert segment.status == SegmentStatus.COMPLETED

    def test_document_to_dict_serialization(self):
        """Test document to_dict method for serialization."""
        # Arrange
        tenant_id = str(uuid4())
        dataset_id = str(uuid4())
        created_by = str(uuid4())

        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch_001",
            name="test.pdf",
            created_from=DocumentCreatedFrom.WEB,
            created_by=created_by,
            word_count=100,
            indexing_status=IndexingStatus.COMPLETED,
        )

        # Mock segment_count and hit_count
        with (
            patch.object(Document, "segment_count", new_callable=lambda: property(lambda self: 5)),
            patch.object(Document, "hit_count", new_callable=lambda: property(lambda self: 10)),
        ):
            # Act
            result = document.to_dict()

            # Assert
            assert result["tenant_id"] == tenant_id
            assert result["dataset_id"] == dataset_id
            assert result["name"] == "test.pdf"
            assert result["word_count"] == 100
            assert result["indexing_status"] == IndexingStatus.COMPLETED
            assert result["segment_count"] == 5
            assert result["hit_count"] == 10
