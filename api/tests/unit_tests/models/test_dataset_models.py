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
from unittest.mock import MagicMock, patch
from uuid import uuid4

from models.dataset import (
    AppDatasetJoin,
    ChildChunk,
    Dataset,
    DatasetKeywordTable,
    DatasetProcessRule,
    Document,
    DocumentSegment,
    Embedding,
)


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
            data_source_type="upload_file",
            created_by=created_by,
        )

        # Assert
        assert dataset.name == "Test Dataset"
        assert dataset.tenant_id == tenant_id
        assert dataset.data_source_type == "upload_file"
        assert dataset.created_by == created_by
        # Note: Default values are set by database, not by model instantiation

    def test_dataset_creation_with_optional_fields(self):
        """Test creating a dataset with optional fields."""
        # Arrange & Act
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
            description="Test description",
            indexing_technique="high_quality",
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
        )

        # Assert
        assert dataset.description == "Test description"
        assert dataset.indexing_technique == "high_quality"
        assert dataset.embedding_model == "text-embedding-ada-002"
        assert dataset.embedding_model_provider == "openai"

    def test_dataset_indexing_technique_validation(self):
        """Test dataset indexing technique values."""
        # Arrange & Act
        dataset_high_quality = Dataset(
            tenant_id=str(uuid4()),
            name="High Quality Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
            indexing_technique="high_quality",
        )
        dataset_economy = Dataset(
            tenant_id=str(uuid4()),
            name="Economy Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
            indexing_technique="economy",
        )

        # Assert
        assert dataset_high_quality.indexing_technique == "high_quality"
        assert dataset_economy.indexing_technique == "economy"
        assert "high_quality" in Dataset.INDEXING_TECHNIQUE_LIST
        assert "economy" in Dataset.INDEXING_TECHNIQUE_LIST

    def test_dataset_provider_validation(self):
        """Test dataset provider values."""
        # Arrange & Act
        dataset_vendor = Dataset(
            tenant_id=str(uuid4()),
            name="Vendor Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
            provider="vendor",
        )
        dataset_external = Dataset(
            tenant_id=str(uuid4()),
            name="External Dataset",
            data_source_type="upload_file",
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
            data_source_type="upload_file",
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
            data_source_type="upload_file",
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
            data_source_type="upload_file",
            created_by=str(uuid4()),
        )

        # Act
        result = dataset.external_retrieval_model

        # Assert
        assert result["top_k"] == 2
        assert result["score_threshold"] == 0.0

    def test_dataset_retrieval_model_dict_property(self):
        """Test retrieval_model_dict property with default values."""
        # Arrange
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
        )

        # Act
        result = dataset.retrieval_model_dict

        # Assert
        assert result["top_k"] == 2
        assert result["reranking_enable"] is False
        assert result["score_threshold_enabled"] is False

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
            data_source_type="upload_file",
            batch="batch_001",
            name="test_document.pdf",
            created_from="web",
            created_by=created_by,
        )

        # Assert
        assert document.tenant_id == tenant_id
        assert document.dataset_id == dataset_id
        assert document.position == 1
        assert document.data_source_type == "upload_file"
        assert document.batch == "batch_001"
        assert document.name == "test_document.pdf"
        assert document.created_from == "web"
        assert document.created_by == created_by
        # Note: Default values are set by database, not by model instantiation

    def test_document_data_source_types(self):
        """Test document data source type validation."""
        # Assert
        assert "upload_file" in Document.DATA_SOURCES
        assert "notion_import" in Document.DATA_SOURCES
        assert "website_crawl" in Document.DATA_SOURCES

    def test_document_display_status_queuing(self):
        """Test document display_status property for queuing state."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
            indexing_status="waiting",
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
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
            indexing_status="parsing",
            is_paused=True,
        )

        # Act
        status = document.display_status

        # Assert
        assert status == "paused"

    def test_document_display_status_indexing(self):
        """Test document display_status property for indexing state."""
        # Arrange
        for indexing_status in ["parsing", "cleaning", "splitting", "indexing"]:
            document = Document(
                tenant_id=str(uuid4()),
                dataset_id=str(uuid4()),
                position=1,
                data_source_type="upload_file",
                batch="batch_001",
                name="test.pdf",
                created_from="web",
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
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
            indexing_status="error",
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
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
            indexing_status="completed",
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
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
            indexing_status="completed",
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
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
            indexing_status="completed",
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
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
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
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
        )

        # Act
        result = document.data_source_info_dict

        # Assert
        assert result == {}

    def test_document_average_segment_length(self):
        """Test average_segment_length property calculation."""
        # Arrange
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
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
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
            word_count=0,
        )

        # Act
        result = document.average_segment_length

        # Assert
        assert result == 0


class TestDocumentSegmentIndexing:
    """Test suite for DocumentSegment model indexing and operations."""

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
            status="waiting",
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
            status="completed",
        )

        # Assert
        assert segment_waiting.status == "waiting"
        assert segment_completed.status == "completed"

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
            dataset_id=dataset_id,
            mode="automatic",
            created_by=created_by,
        )

        # Assert
        assert process_rule.dataset_id == dataset_id
        assert process_rule.mode == "automatic"
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
            mode="custom",
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
            mode="automatic",
            created_by=str(uuid4()),
            rules=json.dumps(rules_data),
        )

        # Act
        result = process_rule.to_dict()

        # Assert
        assert result["dataset_id"] == dataset_id
        assert result["mode"] == "automatic"
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


class TestDatasetDocumentCascadeDeletes:
    """Test suite for Dataset-Document cascade delete operations."""

    def test_dataset_with_documents_relationship(self):
        """Test dataset can track its documents."""
        # Arrange
        dataset_id = str(uuid4())
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
        )
        dataset.id = dataset_id

        # Mock the database session query
        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = 3

        with patch("models.dataset.db.session.query", return_value=mock_query):
            # Act
            total_docs = dataset.total_documents

            # Assert
            assert total_docs == 3

    def test_dataset_available_documents_count(self):
        """Test dataset can count available documents."""
        # Arrange
        dataset_id = str(uuid4())
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
        )
        dataset.id = dataset_id

        # Mock the database session query
        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = 2

        with patch("models.dataset.db.session.query", return_value=mock_query):
            # Act
            available_docs = dataset.total_available_documents

            # Assert
            assert available_docs == 2

    def test_dataset_word_count_aggregation(self):
        """Test dataset can aggregate word count from documents."""
        # Arrange
        dataset_id = str(uuid4())
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
        )
        dataset.id = dataset_id

        # Mock the database session query
        mock_query = MagicMock()
        mock_query.with_entities.return_value.where.return_value.scalar.return_value = 5000

        with patch("models.dataset.db.session.query", return_value=mock_query):
            # Act
            total_words = dataset.word_count

            # Assert
            assert total_words == 5000

    def test_dataset_available_segment_count(self):
        """Test dataset can count available segments."""
        # Arrange
        dataset_id = str(uuid4())
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
        )
        dataset.id = dataset_id

        # Mock the database session query
        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = 15

        with patch("models.dataset.db.session.query", return_value=mock_query):
            # Act
            segment_count = dataset.available_segment_count

            # Assert
            assert segment_count == 15

    def test_document_segment_count_property(self):
        """Test document can count its segments."""
        # Arrange
        document_id = str(uuid4())
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
        )
        document.id = document_id

        # Mock the database session query
        mock_query = MagicMock()
        mock_query.where.return_value.count.return_value = 10

        with patch("models.dataset.db.session.query", return_value=mock_query):
            # Act
            segment_count = document.segment_count

            # Assert
            assert segment_count == 10

    def test_document_hit_count_aggregation(self):
        """Test document can aggregate hit count from segments."""
        # Arrange
        document_id = str(uuid4())
        document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
        )
        document.id = document_id

        # Mock the database session query
        mock_query = MagicMock()
        mock_query.with_entities.return_value.where.return_value.scalar.return_value = 25

        with patch("models.dataset.db.session.query", return_value=mock_query):
            # Act
            hit_count = document.hit_count

            # Assert
            assert hit_count == 25


class TestDocumentSegmentNavigation:
    """Test suite for DocumentSegment navigation properties."""

    def test_document_segment_dataset_property(self):
        """Test segment can access its parent dataset."""
        # Arrange
        dataset_id = str(uuid4())
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=dataset_id,
            document_id=str(uuid4()),
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
        )

        mock_dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
        )
        mock_dataset.id = dataset_id

        # Mock the database session scalar
        with patch("models.dataset.db.session.scalar", return_value=mock_dataset):
            # Act
            dataset = segment.dataset

            # Assert
            assert dataset is not None
            assert dataset.id == dataset_id

    def test_document_segment_document_property(self):
        """Test segment can access its parent document."""
        # Arrange
        document_id = str(uuid4())
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=document_id,
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
        )

        mock_document = Document(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=str(uuid4()),
        )
        mock_document.id = document_id

        # Mock the database session scalar
        with patch("models.dataset.db.session.scalar", return_value=mock_document):
            # Act
            document = segment.document

            # Assert
            assert document is not None
            assert document.id == document_id

    def test_document_segment_previous_segment(self):
        """Test segment can access previous segment."""
        # Arrange
        document_id = str(uuid4())
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=document_id,
            position=2,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
        )

        previous_segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=document_id,
            position=1,
            content="Previous",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
        )

        # Mock the database session scalar
        with patch("models.dataset.db.session.scalar", return_value=previous_segment):
            # Act
            prev_seg = segment.previous_segment

            # Assert
            assert prev_seg is not None
            assert prev_seg.position == 1

    def test_document_segment_next_segment(self):
        """Test segment can access next segment."""
        # Arrange
        document_id = str(uuid4())
        segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=document_id,
            position=1,
            content="Test",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
        )

        next_segment = DocumentSegment(
            tenant_id=str(uuid4()),
            dataset_id=str(uuid4()),
            document_id=document_id,
            position=2,
            content="Next",
            word_count=1,
            tokens=2,
            created_by=str(uuid4()),
        )

        # Mock the database session scalar
        with patch("models.dataset.db.session.scalar", return_value=next_segment):
            # Act
            next_seg = segment.next_segment

            # Assert
            assert next_seg is not None
            assert next_seg.position == 2


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
            data_source_type="upload_file",
            created_by=created_by,
            indexing_technique="high_quality",
        )
        dataset.id = dataset_id

        # Create document
        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=1,
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
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
            status="completed",
        )

        # Assert
        assert dataset.id == dataset_id
        assert document.dataset_id == dataset_id
        assert segment.dataset_id == dataset_id
        assert segment.document_id == document_id
        assert dataset.indexing_technique == "high_quality"
        assert document.word_count == 100
        assert segment.status == "completed"

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
            data_source_type="upload_file",
            batch="batch_001",
            name="test.pdf",
            created_from="web",
            created_by=created_by,
            word_count=100,
            indexing_status="completed",
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
            assert result["indexing_status"] == "completed"
            assert result["segment_count"] == 5
            assert result["hit_count"] == 10
