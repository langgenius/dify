"""
Comprehensive unit tests for Dataset models.

This test suite validates the core dataset domain models used in Dify's knowledge base system.
It ensures data integrity, relationship handling, and proper model behavior without requiring
a database connection (uses mocking for database operations).

Test Coverage:
--------------
1. Dataset Model Validation (TestDatasetModelValidation)
   - Field validation (required/optional)
   - Indexing techniques (high_quality, economy)
   - Provider types (vendor, external)
   - JSON property parsing (index_struct, retrieval_model)
   - Collection name generation

2. Document Model Relationships (TestDocumentModelRelationships)
   - Document lifecycle and status transitions
   - Data source type validation
   - Display status computation for different states
   - Relationship with Dataset and DocumentSegment

3. DocumentSegment Indexing (TestDocumentSegmentIndexing)
   - Segment creation with indexing metadata
   - QA model support (question-answer pairs)
   - Status tracking and error handling
   - Hit count and usage metrics

4. Embedding Storage (TestEmbeddingStorage)
   - Vector embedding serialization using pickle
   - Large dimension vector handling (1536D)
   - Binary data storage validation

5. Supporting Models
   - DatasetProcessRule: Processing configuration and rules
   - DatasetKeywordTable: Keyword indexing
   - AppDatasetJoin: App-Dataset relationships
   - ChildChunk: Hierarchical chunk structure

6. Integration Tests
   - Dataset → Document → Segment hierarchy
   - Cascade operations and aggregations
   - Navigation between related entities
   - Model serialization (to_dict)

Usage:
------
Run all tests:
    pytest api/tests/unit_tests/models/test_dataset_models.py -v

Run specific test class:
    pytest api/tests/unit_tests/models/test_dataset_models.py::TestDatasetModelValidation -v

Run with coverage:
    pytest api/tests/unit_tests/models/test_dataset_models.py --cov=models.dataset

Notes:
------
- All tests use mocking to avoid database dependencies
- Tests follow Arrange-Act-Assert (AAA) pattern
- UUIDs are generated for test data to ensure uniqueness
- Default values are set by database, not model instantiation
"""

# Standard library imports
import json
import pickle
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch
from uuid import uuid4

# Model imports - Core dataset domain models
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
    """
    Test suite for Dataset model validation and basic operations.

    Dataset is the root entity in the knowledge base hierarchy:
    Dataset → Document → DocumentSegment

    Key attributes:
    - tenant_id: Multi-tenancy identifier
    - name: Human-readable dataset name
    - indexing_technique: 'high_quality' (vector) or 'economy' (keyword)
    - provider: 'vendor' (Dify-managed) or 'external' (third-party)
    - embedding_model: Model used for vector embeddings (e.g., 'text-embedding-ada-002')
    """

    def test_dataset_creation_with_required_fields(self):
        """
        Test creating a dataset with all required fields.

        Validates that a Dataset can be instantiated with minimal required fields.
        Note: Default values (provider='vendor', permission='only_me') are set by
        the database, not during model instantiation.
        """
        # Arrange - Prepare test data
        tenant_id = str(uuid4())  # Simulates a tenant in multi-tenant system
        created_by = str(uuid4())  # User ID who created the dataset

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
        """
        Test dataset indexing technique values.

        Indexing techniques determine how documents are indexed:
        - 'high_quality': Uses vector embeddings for semantic search (more accurate, higher cost)
        - 'economy': Uses keyword-based indexing (faster, lower cost)
        """
        # Arrange & Act - Create datasets with different indexing techniques
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
        """
        Test index_struct_dict property parsing.

        The index_struct field stores JSON metadata about the vector index.
        The property automatically parses the JSON string into a Python dict.
        """
        # Arrange - Create index structure metadata
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
    """
    Test suite for Document model relationships and properties.

    Document represents a single file or content source within a Dataset.
    Each document goes through a processing pipeline:
    1. waiting → 2. parsing → 3. cleaning → 4. splitting → 5. indexing → 6. completed

    Key attributes:
    - dataset_id: Parent dataset reference
    - data_source_type: 'upload_file', 'notion_import', or 'website_crawl'
    - indexing_status: Current processing stage
    - enabled: Whether document is active in search
    - archived: Whether document is archived (soft delete)
    - word_count: Total words in document (aggregated from segments)
    """

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
        """
        Test document display_status property for queuing state.

        The display_status property computes a user-friendly status from
        multiple internal fields (indexing_status, is_paused, enabled, archived).
        'queuing' means the document is waiting to be processed.
        """
        # Arrange - Create document in waiting state
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
        """
        Test document display_status property for indexing state.

        Multiple internal statuses map to 'indexing' display status:
        - parsing: Extracting text from file
        - cleaning: Removing noise and formatting
        - splitting: Breaking into chunks/segments
        - indexing: Creating vector embeddings
        """
        # Arrange - Test all indexing sub-states
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
        """
        Test data_source_info_dict property parsing.

        The data_source_info field stores JSON metadata about the document source.
        For upload_file: Contains upload_file_id and file metadata
        For notion_import: Contains Notion page/database info
        For website_crawl: Contains URL and crawl settings
        """
        # Arrange - Create document with source metadata
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
    """
    Test suite for DocumentSegment model indexing and operations.

    DocumentSegment represents a chunk of text from a Document.
    Documents are split into segments for:
    - More granular search results
    - Token limit management
    - Better context relevance

    Key attributes:
    - document_id: Parent document reference
    - position: Order within the document (1-indexed)
    - content: The actual text content
    - word_count: Number of words in content
    - tokens: Number of tokens for embedding model
    - index_node_id: Vector index identifier
    - keywords: Extracted keywords for hybrid search
    - hit_count: Number of times retrieved in searches
    """

    def test_document_segment_creation_with_required_fields(self):
        """
        Test creating a document segment with all required fields.

        Segments are the atomic units of search. Each segment contains:
        - A portion of the document text
        - Metadata for indexing (position, word count, tokens)
        - Tracking info (created_by, status, timestamps)
        """
        # Arrange - Prepare segment data
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
        """
        Test creating a document segment with answer field for QA model.

        QA (Question-Answer) model segments store both:
        - content: The question
        - answer: The corresponding answer
        This enables Q&A style knowledge bases.
        """
        # Arrange - Create Q&A pair
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
    """
    Test suite for Embedding model storage and retrieval.

    Embedding model stores vector representations of text for semantic search.
    Embeddings are cached to avoid redundant API calls to embedding providers.

    Key attributes:
    - model_name: Embedding model identifier (e.g., 'text-embedding-ada-002')
    - hash: Content hash for deduplication
    - provider_name: Embedding provider (e.g., 'openai', 'cohere')
    - embedding: Pickled binary data of float vector

    Storage strategy:
    - Vectors are serialized using pickle for efficient storage
    - Hash-based lookup prevents duplicate embeddings
    - Supports large dimension vectors (up to 1536D for OpenAI models)
    """

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
        """
        Test setting and getting embedding data.

        The embedding vector is stored as pickled binary data.
        set_embedding() serializes the float list to bytes.
        get_embedding() deserializes bytes back to float list.
        """
        # Arrange - Create sample embedding vector
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
    """
    Test suite for Dataset-Document cascade delete operations.

    Tests the aggregation and relationship queries between Dataset and Document models.
    These tests validate that:
    - Datasets can count their documents and segments
    - Word counts are properly aggregated from documents
    - Hit counts are properly aggregated from segments
    - Filtering works correctly (enabled, completed, archived)

    Note: These tests use mocking to simulate database queries without
    requiring an actual database connection.
    """

    def test_dataset_with_documents_relationship(self):
        """
        Test dataset can track its documents.

        The total_documents property counts all documents in a dataset,
        regardless of their status (enabled, disabled, archived).
        """
        # Arrange - Create dataset and mock database query
        dataset_id = str(uuid4())
        dataset = Dataset(
            tenant_id=str(uuid4()),
            name="Test Dataset",
            data_source_type="upload_file",
            created_by=str(uuid4()),
        )
        dataset.id = dataset_id

        # Mock the database session query
        # This simulates: db.session.query(func.count(Document.id)).where(...).scalar()
        mock_query = MagicMock()
        mock_query.where.return_value.scalar.return_value = 3  # Simulate 3 documents

        with patch("models.dataset.db.session.query", return_value=mock_query):
            # Act - Call the property that triggers the query
            total_docs = dataset.total_documents

            # Assert - Verify the mocked result is returned
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
        # Simulates: db.session.query(DocumentSegment).where(...).count()
        mock_query = MagicMock()
        mock_query.where.return_value.count.return_value = 10  # 10 segments

        with patch("models.dataset.db.session.query", return_value=mock_query):
            # Act - Access the segment_count property
            segment_count = document.segment_count

            # Assert - Verify count is correct
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
    """
    Test suite for DocumentSegment navigation properties.

    DocumentSegments have navigation properties to access related entities:
    - dataset: Parent dataset
    - document: Parent document
    - previous_segment: Previous segment in document (by position)
    - next_segment: Next segment in document (by position)

    These properties enable traversing the knowledge base hierarchy and
    navigating between sequential segments.
    """

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
        # Simulates: db.session.scalar(select(Dataset).where(...))
        with patch("models.dataset.db.session.scalar", return_value=mock_dataset):
            # Act - Access the dataset property (triggers query)
            dataset = segment.dataset

            # Assert - Verify the mocked dataset is returned
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
    """
    Test suite for model integration scenarios.

    Integration tests validate the complete hierarchy and interactions
    between Dataset, Document, and DocumentSegment models.

    These tests ensure:
    - Models can be created with proper relationships
    - Foreign key references are maintained
    - Serialization (to_dict) works correctly
    - Complex queries and aggregations function properly
    """

    def test_complete_dataset_document_segment_hierarchy(self):
        """
        Test complete hierarchy from dataset to segment.

        Validates the three-tier knowledge base structure:
        Dataset (knowledge base) → Document (file) → Segment (chunk)

        This hierarchy enables:
        - Organizing multiple documents in a dataset
        - Breaking documents into searchable chunks
        - Maintaining relationships for filtering and aggregation
        """
        # Arrange - Create complete hierarchy
        tenant_id = str(uuid4())  # Shared tenant
        dataset_id = str(uuid4())  # Parent dataset
        document_id = str(uuid4())  # Parent document
        created_by = str(uuid4())  # Creator

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

            # Assert - Verify all fields are correctly serialized
            assert result["tenant_id"] == tenant_id
            assert result["dataset_id"] == dataset_id
            assert result["name"] == "test.pdf"
            assert result["word_count"] == 100
            assert result["indexing_status"] == "completed"
            assert result["segment_count"] == 5  # Mocked value
            assert result["hit_count"] == 10  # Mocked value
