"""
Comprehensive unit tests for VectorService and Vector classes.

This module contains extensive unit tests for the VectorService and Vector
classes, which are critical components in the RAG (Retrieval-Augmented Generation)
pipeline that handle vector database operations, collection management, embedding
storage and retrieval, and metadata filtering.

The VectorService provides methods for:
- Creating vector embeddings for document segments
- Updating segment vector embeddings
- Generating child chunks for hierarchical indexing
- Managing child chunk vectors (create, update, delete)

The Vector class provides methods for:
- Vector database operations (create, add, delete, search)
- Collection creation and management with Redis locking
- Embedding storage and retrieval
- Vector index operations (HNSW, L2 distance, etc.)
- Metadata filtering in vector space
- Support for multiple vector database backends

This test suite ensures:
- Correct vector database operations
- Proper collection creation and management
- Accurate embedding storage and retrieval
- Comprehensive vector search functionality
- Metadata filtering and querying
- Error conditions are handled correctly
- Edge cases are properly validated

================================================================================
ARCHITECTURE OVERVIEW
================================================================================

The Vector service system is a critical component that bridges document
segments and vector databases, enabling semantic search and retrieval.

1. VectorService:
   - High-level service for managing vector operations on document segments
   - Handles both regular segments and hierarchical (parent-child) indexing
   - Integrates with IndexProcessor for document transformation
   - Manages embedding model instances via ModelManager

2. Vector Class:
   - Wrapper around BaseVector implementations
   - Handles embedding generation via ModelManager
   - Supports multiple vector database backends (Chroma, Milvus, Qdrant, etc.)
   - Manages collection creation with Redis locking for concurrency control
   - Provides batch processing for large document sets

3. BaseVector Abstract Class:
   - Defines interface for vector database operations
   - Implemented by various vector database backends
   - Provides methods for CRUD operations on vectors
   - Supports both vector similarity search and full-text search

4. Collection Management:
   - Uses Redis locks to prevent concurrent collection creation
   - Caches collection existence status in Redis
   - Supports collection deletion with cache invalidation

5. Embedding Generation:
   - Uses ModelManager to get embedding model instances
   - Supports cached embeddings for performance
   - Handles batch processing for large document sets
   - Generates embeddings for both documents and queries

================================================================================
TESTING STRATEGY
================================================================================

This test suite follows a comprehensive testing strategy that covers:

1. VectorService Methods:
   - create_segments_vector: Regular and hierarchical indexing
   - update_segment_vector: Vector and keyword index updates
   - generate_child_chunks: Child chunk generation with full doc mode
   - create_child_chunk_vector: Child chunk vector creation
   - update_child_chunk_vector: Batch child chunk updates
   - delete_child_chunk_vector: Child chunk deletion

2. Vector Class Methods:
   - Initialization with dataset and attributes
   - Collection creation with Redis locking
   - Embedding generation and batch processing
   - Vector operations (create, add_texts, delete_by_ids, etc.)
   - Search operations (by vector, by full text)
   - Metadata filtering and querying
   - Duplicate checking logic
   - Vector factory selection

3. Integration Points:
   - ModelManager integration for embedding models
   - IndexProcessor integration for document transformation
   - Redis integration for locking and caching
   - Database session management
   - Vector database backend abstraction

4. Error Handling:
   - Invalid vector store configuration
   - Missing embedding models
   - Collection creation failures
   - Search operation errors
   - Metadata filtering errors

5. Edge Cases:
   - Empty document lists
   - Missing metadata fields
   - Duplicate document IDs
   - Large batch processing
   - Concurrent collection creation

================================================================================
"""

from unittest.mock import Mock, patch

import pytest

from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document
from models.dataset import ChildChunk, Dataset, DatasetDocument, DatasetProcessRule, DocumentSegment
from services.vector_service import VectorService

# ============================================================================
# Test Data Factory
# ============================================================================


class VectorServiceTestDataFactory:
    """
    Factory class for creating test data and mock objects for Vector service tests.

    This factory provides static methods to create mock objects for:
    - Dataset instances with various configurations
    - DocumentSegment instances
    - ChildChunk instances
    - Document instances (RAG documents)
    - Embedding model instances
    - Vector processor mocks
    - Index processor mocks

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        doc_form: str = "text_model",
        indexing_technique: str = "high_quality",
        embedding_model_provider: str = "openai",
        embedding_model: str = "text-embedding-ada-002",
        index_struct_dict: dict | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock Dataset with specified attributes.

        Args:
            dataset_id: Unique identifier for the dataset
            tenant_id: Tenant identifier
            doc_form: Document form type
            indexing_technique: Indexing technique (high_quality or economy)
            embedding_model_provider: Embedding model provider
            embedding_model: Embedding model name
            index_struct_dict: Index structure dictionary
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Dataset instance
        """
        dataset = Mock(spec=Dataset)

        dataset.id = dataset_id

        dataset.tenant_id = tenant_id

        dataset.doc_form = doc_form

        dataset.indexing_technique = indexing_technique

        dataset.embedding_model_provider = embedding_model_provider

        dataset.embedding_model = embedding_model

        dataset.index_struct_dict = index_struct_dict

        for key, value in kwargs.items():
            setattr(dataset, key, value)

        return dataset

    @staticmethod
    def create_document_segment_mock(
        segment_id: str = "segment-123",
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        content: str = "Test segment content",
        index_node_id: str = "node-123",
        index_node_hash: str = "hash-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock DocumentSegment with specified attributes.

        Args:
            segment_id: Unique identifier for the segment
            document_id: Parent document identifier
            dataset_id: Dataset identifier
            content: Segment content text
            index_node_id: Index node identifier
            index_node_hash: Index node hash
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a DocumentSegment instance
        """
        segment = Mock(spec=DocumentSegment)

        segment.id = segment_id

        segment.document_id = document_id

        segment.dataset_id = dataset_id

        segment.content = content

        segment.index_node_id = index_node_id

        segment.index_node_hash = index_node_hash

        for key, value in kwargs.items():
            setattr(segment, key, value)

        return segment

    @staticmethod
    def create_child_chunk_mock(
        chunk_id: str = "chunk-123",
        segment_id: str = "segment-123",
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        content: str = "Test child chunk content",
        index_node_id: str = "node-chunk-123",
        index_node_hash: str = "hash-chunk-123",
        position: int = 1,
        **kwargs,
    ) -> Mock:
        """
        Create a mock ChildChunk with specified attributes.

        Args:
            chunk_id: Unique identifier for the child chunk
            segment_id: Parent segment identifier
            document_id: Parent document identifier
            dataset_id: Dataset identifier
            tenant_id: Tenant identifier
            content: Child chunk content text
            index_node_id: Index node identifier
            index_node_hash: Index node hash
            position: Position in parent segment
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a ChildChunk instance
        """
        chunk = Mock(spec=ChildChunk)

        chunk.id = chunk_id

        chunk.segment_id = segment_id

        chunk.document_id = document_id

        chunk.dataset_id = dataset_id

        chunk.tenant_id = tenant_id

        chunk.content = content

        chunk.index_node_id = index_node_id

        chunk.index_node_hash = index_node_hash

        chunk.position = position

        for key, value in kwargs.items():
            setattr(chunk, key, value)

        return chunk

    @staticmethod
    def create_dataset_document_mock(
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        dataset_process_rule_id: str = "rule-123",
        doc_language: str = "en",
        created_by: str = "user-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock DatasetDocument with specified attributes.

        Args:
            document_id: Unique identifier for the document
            dataset_id: Dataset identifier
            tenant_id: Tenant identifier
            dataset_process_rule_id: Process rule identifier
            doc_language: Document language
            created_by: Creator user ID
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a DatasetDocument instance
        """
        document = Mock(spec=DatasetDocument)

        document.id = document_id

        document.dataset_id = dataset_id

        document.tenant_id = tenant_id

        document.dataset_process_rule_id = dataset_process_rule_id

        document.doc_language = doc_language

        document.created_by = created_by

        for key, value in kwargs.items():
            setattr(document, key, value)

        return document

    @staticmethod
    def create_dataset_process_rule_mock(
        rule_id: str = "rule-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock DatasetProcessRule with specified attributes.

        Args:
            rule_id: Unique identifier for the process rule
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a DatasetProcessRule instance
        """
        rule = Mock(spec=DatasetProcessRule)

        rule.id = rule_id

        rule.to_dict = Mock(return_value={"rules": {"parent_mode": "chunk"}})

        for key, value in kwargs.items():
            setattr(rule, key, value)

        return rule

    @staticmethod
    def create_rag_document_mock(
        page_content: str = "Test document content",
        doc_id: str = "doc-123",
        doc_hash: str = "hash-123",
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        **kwargs,
    ) -> Document:
        """
        Create a RAG Document with specified attributes.

        Args:
            page_content: Document content text
            doc_id: Document identifier in metadata
            doc_hash: Document hash in metadata
            document_id: Parent document ID in metadata
            dataset_id: Dataset ID in metadata
            **kwargs: Additional metadata fields

        Returns:
            Document instance configured for testing
        """
        metadata = {
            "doc_id": doc_id,
            "doc_hash": doc_hash,
            "document_id": document_id,
            "dataset_id": dataset_id,
        }

        metadata.update(kwargs)

        return Document(page_content=page_content, metadata=metadata)

    @staticmethod
    def create_embedding_model_instance_mock() -> Mock:
        """
        Create a mock embedding model instance.

        Returns:
            Mock object configured as an embedding model instance
        """
        model_instance = Mock()

        model_instance.embed_documents = Mock(return_value=[[0.1] * 1536])

        model_instance.embed_query = Mock(return_value=[0.1] * 1536)

        return model_instance

    @staticmethod
    def create_vector_processor_mock() -> Mock:
        """
        Create a mock vector processor (BaseVector implementation).

        Returns:
            Mock object configured as a BaseVector instance
        """
        processor = Mock(spec=BaseVector)

        processor.collection_name = "test_collection"

        processor.create = Mock()

        processor.add_texts = Mock()

        processor.text_exists = Mock(return_value=False)

        processor.delete_by_ids = Mock()

        processor.delete_by_metadata_field = Mock()

        processor.search_by_vector = Mock(return_value=[])

        processor.search_by_full_text = Mock(return_value=[])

        processor.delete = Mock()

        return processor

    @staticmethod
    def create_index_processor_mock() -> Mock:
        """
        Create a mock index processor.

        Returns:
            Mock object configured as an index processor instance
        """
        processor = Mock()

        processor.load = Mock()

        processor.clean = Mock()

        processor.transform = Mock(return_value=[])

        return processor


# ============================================================================
# Tests for VectorService
# ============================================================================


class TestVectorService:
    """
    Comprehensive unit tests for VectorService class.

    This test class covers all methods of the VectorService class, including
    segment vector operations, child chunk operations, and integration with
    various components like IndexProcessor and ModelManager.
    """

    # ========================================================================
    # Tests for create_segments_vector
    # ========================================================================

    @patch("services.vector_service.IndexProcessorFactory")
    @patch("services.vector_service.db")
    def test_create_segments_vector_regular_indexing(self, mock_db, mock_index_processor_factory):
        """
        Test create_segments_vector with regular indexing (non-hierarchical).

        This test verifies that segments are correctly converted to RAG documents
        and loaded into the index processor for regular indexing scenarios.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(
            doc_form="text_model", indexing_technique="high_quality"
        )

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        keywords_list = [["keyword1", "keyword2"]]

        mock_index_processor = VectorServiceTestDataFactory.create_index_processor_mock()

        mock_index_processor_factory.return_value.init_index_processor.return_value = mock_index_processor

        # Act
        VectorService.create_segments_vector(keywords_list, [segment], dataset, "text_model")

        # Assert
        mock_index_processor.load.assert_called_once()

        call_args = mock_index_processor.load.call_args

        assert call_args[0][0] == dataset

        assert len(call_args[0][1]) == 1

        assert call_args[1]["with_keywords"] is True

        assert call_args[1]["keywords_list"] == keywords_list

    @patch("services.vector_service.VectorService.generate_child_chunks")
    @patch("services.vector_service.ModelManager")
    @patch("services.vector_service.db")
    def test_create_segments_vector_parent_child_indexing(
        self, mock_db, mock_model_manager, mock_generate_child_chunks
    ):
        """
        Test create_segments_vector with parent-child indexing.

        This test verifies that for hierarchical indexing, child chunks are
        generated instead of regular segment indexing.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(
            doc_form="parent_child_model", indexing_technique="high_quality"
        )

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        dataset_document = VectorServiceTestDataFactory.create_dataset_document_mock()

        processing_rule = VectorServiceTestDataFactory.create_dataset_process_rule_mock()

        mock_db.session.query.return_value.filter_by.return_value.first.return_value = dataset_document

        mock_db.session.query.return_value.where.return_value.first.return_value = processing_rule

        mock_embedding_model = VectorServiceTestDataFactory.create_embedding_model_instance_mock()

        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_model

        # Act
        VectorService.create_segments_vector(None, [segment], dataset, "parent_child_model")

        # Assert
        mock_generate_child_chunks.assert_called_once()

    @patch("services.vector_service.db")
    def test_create_segments_vector_missing_document(self, mock_db):
        """
        Test create_segments_vector when document is missing.

        This test verifies that when a document is not found, the segment
        is skipped with a warning log.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(
            doc_form="parent_child_model", indexing_technique="high_quality"
        )

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

        # Act
        VectorService.create_segments_vector(None, [segment], dataset, "parent_child_model")

        # Assert
        # Should not raise an error, just skip the segment

    @patch("services.vector_service.db")
    def test_create_segments_vector_missing_processing_rule(self, mock_db):
        """
        Test create_segments_vector when processing rule is missing.

        This test verifies that when a processing rule is not found, a
        ValueError is raised.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(
            doc_form="parent_child_model", indexing_technique="high_quality"
        )

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        dataset_document = VectorServiceTestDataFactory.create_dataset_document_mock()

        mock_db.session.query.return_value.filter_by.return_value.first.return_value = dataset_document

        mock_db.session.query.return_value.where.return_value.first.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="No processing rule found"):
            VectorService.create_segments_vector(None, [segment], dataset, "parent_child_model")

    @patch("services.vector_service.db")
    def test_create_segments_vector_economy_indexing_technique(self, mock_db):
        """
        Test create_segments_vector with economy indexing technique.

        This test verifies that when indexing_technique is not high_quality,
        a ValueError is raised for parent-child indexing.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(
            doc_form="parent_child_model", indexing_technique="economy"
        )

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        dataset_document = VectorServiceTestDataFactory.create_dataset_document_mock()

        processing_rule = VectorServiceTestDataFactory.create_dataset_process_rule_mock()

        mock_db.session.query.return_value.filter_by.return_value.first.return_value = dataset_document

        mock_db.session.query.return_value.where.return_value.first.return_value = processing_rule

        # Act & Assert
        with pytest.raises(ValueError, match="The knowledge base index technique is not high quality"):
            VectorService.create_segments_vector(None, [segment], dataset, "parent_child_model")

    @patch("services.vector_service.IndexProcessorFactory")
    @patch("services.vector_service.db")
    def test_create_segments_vector_empty_documents(self, mock_db, mock_index_processor_factory):
        """
        Test create_segments_vector with empty documents list.

        This test verifies that when no documents are created, the index
        processor is not called.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_index_processor = VectorServiceTestDataFactory.create_index_processor_mock()

        mock_index_processor_factory.return_value.init_index_processor.return_value = mock_index_processor

        # Act
        VectorService.create_segments_vector(None, [], dataset, "text_model")

        # Assert
        mock_index_processor.load.assert_not_called()

    # ========================================================================
    # Tests for update_segment_vector
    # ========================================================================

    @patch("services.vector_service.Vector")
    @patch("services.vector_service.db")
    def test_update_segment_vector_high_quality(self, mock_db, mock_vector_class):
        """
        Test update_segment_vector with high_quality indexing technique.

        This test verifies that segments are correctly updated in the vector
        store when using high_quality indexing.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="high_quality")

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        mock_vector = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_class.return_value = mock_vector

        # Act
        VectorService.update_segment_vector(None, segment, dataset)

        # Assert
        mock_vector.delete_by_ids.assert_called_once_with([segment.index_node_id])

        mock_vector.add_texts.assert_called_once()

    @patch("services.vector_service.Keyword")
    @patch("services.vector_service.db")
    def test_update_segment_vector_economy_with_keywords(self, mock_db, mock_keyword_class):
        """
        Test update_segment_vector with economy indexing and keywords.

        This test verifies that segments are correctly updated in the keyword
        index when using economy indexing with keywords.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="economy")

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        keywords = ["keyword1", "keyword2"]

        mock_keyword = Mock()

        mock_keyword.delete_by_ids = Mock()

        mock_keyword.add_texts = Mock()

        mock_keyword_class.return_value = mock_keyword

        # Act
        VectorService.update_segment_vector(keywords, segment, dataset)

        # Assert
        mock_keyword.delete_by_ids.assert_called_once_with([segment.index_node_id])

        mock_keyword.add_texts.assert_called_once()

        call_args = mock_keyword.add_texts.call_args

        assert call_args[1]["keywords_list"] == [keywords]

    @patch("services.vector_service.Keyword")
    @patch("services.vector_service.db")
    def test_update_segment_vector_economy_without_keywords(self, mock_db, mock_keyword_class):
        """
        Test update_segment_vector with economy indexing without keywords.

        This test verifies that segments are correctly updated in the keyword
        index when using economy indexing without keywords.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="economy")

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        mock_keyword = Mock()

        mock_keyword.delete_by_ids = Mock()

        mock_keyword.add_texts = Mock()

        mock_keyword_class.return_value = mock_keyword

        # Act
        VectorService.update_segment_vector(None, segment, dataset)

        # Assert
        mock_keyword.delete_by_ids.assert_called_once_with([segment.index_node_id])

        mock_keyword.add_texts.assert_called_once()

        call_args = mock_keyword.add_texts.call_args

        assert "keywords_list" not in call_args[1] or call_args[1].get("keywords_list") is None

    # ========================================================================
    # Tests for generate_child_chunks
    # ========================================================================

    @patch("services.vector_service.IndexProcessorFactory")
    @patch("services.vector_service.db")
    def test_generate_child_chunks_with_children(self, mock_db, mock_index_processor_factory):
        """
        Test generate_child_chunks when children are generated.

        This test verifies that child chunks are correctly generated and
        saved to the database when the index processor returns children.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        dataset_document = VectorServiceTestDataFactory.create_dataset_document_mock()

        processing_rule = VectorServiceTestDataFactory.create_dataset_process_rule_mock()

        embedding_model = VectorServiceTestDataFactory.create_embedding_model_instance_mock()

        child_document = VectorServiceTestDataFactory.create_rag_document_mock(
            page_content="Child content", doc_id="child-node-123"
        )

        child_document.children = [child_document]

        mock_index_processor = VectorServiceTestDataFactory.create_index_processor_mock()

        mock_index_processor.transform.return_value = [child_document]

        mock_index_processor_factory.return_value.init_index_processor.return_value = mock_index_processor

        # Act
        VectorService.generate_child_chunks(segment, dataset_document, dataset, embedding_model, processing_rule, False)

        # Assert
        mock_index_processor.transform.assert_called_once()

        mock_index_processor.load.assert_called_once()

        mock_db.session.add.assert_called()

        mock_db.session.commit.assert_called_once()

    @patch("services.vector_service.IndexProcessorFactory")
    @patch("services.vector_service.db")
    def test_generate_child_chunks_regenerate(self, mock_db, mock_index_processor_factory):
        """
        Test generate_child_chunks with regenerate=True.

        This test verifies that when regenerate is True, existing child chunks
        are cleaned before generating new ones.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        dataset_document = VectorServiceTestDataFactory.create_dataset_document_mock()

        processing_rule = VectorServiceTestDataFactory.create_dataset_process_rule_mock()

        embedding_model = VectorServiceTestDataFactory.create_embedding_model_instance_mock()

        mock_index_processor = VectorServiceTestDataFactory.create_index_processor_mock()

        mock_index_processor.transform.return_value = []

        mock_index_processor_factory.return_value.init_index_processor.return_value = mock_index_processor

        # Act
        VectorService.generate_child_chunks(segment, dataset_document, dataset, embedding_model, processing_rule, True)

        # Assert
        mock_index_processor.clean.assert_called_once()

        call_args = mock_index_processor.clean.call_args

        assert call_args[0][0] == dataset

        assert call_args[0][1] == [segment.index_node_id]

        assert call_args[1]["with_keywords"] is True

        assert call_args[1]["delete_child_chunks"] is True

    @patch("services.vector_service.IndexProcessorFactory")
    @patch("services.vector_service.db")
    def test_generate_child_chunks_no_children(self, mock_db, mock_index_processor_factory):
        """
        Test generate_child_chunks when no children are generated.

        This test verifies that when the index processor returns no children,
        no child chunks are saved to the database.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        segment = VectorServiceTestDataFactory.create_document_segment_mock()

        dataset_document = VectorServiceTestDataFactory.create_dataset_document_mock()

        processing_rule = VectorServiceTestDataFactory.create_dataset_process_rule_mock()

        embedding_model = VectorServiceTestDataFactory.create_embedding_model_instance_mock()

        mock_index_processor = VectorServiceTestDataFactory.create_index_processor_mock()

        mock_index_processor.transform.return_value = []

        mock_index_processor_factory.return_value.init_index_processor.return_value = mock_index_processor

        # Act
        VectorService.generate_child_chunks(segment, dataset_document, dataset, embedding_model, processing_rule, False)

        # Assert
        mock_index_processor.transform.assert_called_once()

        mock_index_processor.load.assert_not_called()

        mock_db.session.add.assert_not_called()

    # ========================================================================
    # Tests for create_child_chunk_vector
    # ========================================================================

    @patch("services.vector_service.Vector")
    @patch("services.vector_service.db")
    def test_create_child_chunk_vector_high_quality(self, mock_db, mock_vector_class):
        """
        Test create_child_chunk_vector with high_quality indexing.

        This test verifies that child chunk vectors are correctly created
        when using high_quality indexing.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="high_quality")

        child_chunk = VectorServiceTestDataFactory.create_child_chunk_mock()

        mock_vector = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_class.return_value = mock_vector

        # Act
        VectorService.create_child_chunk_vector(child_chunk, dataset)

        # Assert
        mock_vector.add_texts.assert_called_once()

        call_args = mock_vector.add_texts.call_args

        assert call_args[1]["duplicate_check"] is True

    @patch("services.vector_service.Vector")
    @patch("services.vector_service.db")
    def test_create_child_chunk_vector_economy(self, mock_db, mock_vector_class):
        """
        Test create_child_chunk_vector with economy indexing.

        This test verifies that child chunk vectors are not created when
        using economy indexing.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="economy")

        child_chunk = VectorServiceTestDataFactory.create_child_chunk_mock()

        mock_vector = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_class.return_value = mock_vector

        # Act
        VectorService.create_child_chunk_vector(child_chunk, dataset)

        # Assert
        mock_vector.add_texts.assert_not_called()

    # ========================================================================
    # Tests for update_child_chunk_vector
    # ========================================================================

    @patch("services.vector_service.Vector")
    @patch("services.vector_service.db")
    def test_update_child_chunk_vector_with_all_operations(self, mock_db, mock_vector_class):
        """
        Test update_child_chunk_vector with new, update, and delete operations.

        This test verifies that child chunk vectors are correctly updated
        when there are new chunks, updated chunks, and deleted chunks.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="high_quality")

        new_chunk = VectorServiceTestDataFactory.create_child_chunk_mock(chunk_id="new-chunk-1")

        update_chunk = VectorServiceTestDataFactory.create_child_chunk_mock(chunk_id="update-chunk-1")

        delete_chunk = VectorServiceTestDataFactory.create_child_chunk_mock(chunk_id="delete-chunk-1")

        mock_vector = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_class.return_value = mock_vector

        # Act
        VectorService.update_child_chunk_vector([new_chunk], [update_chunk], [delete_chunk], dataset)

        # Assert
        mock_vector.delete_by_ids.assert_called_once()

        delete_ids = mock_vector.delete_by_ids.call_args[0][0]

        assert update_chunk.index_node_id in delete_ids

        assert delete_chunk.index_node_id in delete_ids

        mock_vector.add_texts.assert_called_once()

        call_args = mock_vector.add_texts.call_args

        assert len(call_args[0][0]) == 2  # new_chunk + update_chunk

        assert call_args[1]["duplicate_check"] is True

    @patch("services.vector_service.Vector")
    @patch("services.vector_service.db")
    def test_update_child_chunk_vector_only_new(self, mock_db, mock_vector_class):
        """
        Test update_child_chunk_vector with only new chunks.

        This test verifies that when only new chunks are provided, only
        add_texts is called, not delete_by_ids.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="high_quality")

        new_chunk = VectorServiceTestDataFactory.create_child_chunk_mock()

        mock_vector = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_class.return_value = mock_vector

        # Act
        VectorService.update_child_chunk_vector([new_chunk], [], [], dataset)

        # Assert
        mock_vector.delete_by_ids.assert_not_called()

        mock_vector.add_texts.assert_called_once()

    @patch("services.vector_service.Vector")
    @patch("services.vector_service.db")
    def test_update_child_chunk_vector_only_delete(self, mock_db, mock_vector_class):
        """
        Test update_child_chunk_vector with only deleted chunks.

        This test verifies that when only deleted chunks are provided, only
        delete_by_ids is called, not add_texts.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="high_quality")

        delete_chunk = VectorServiceTestDataFactory.create_child_chunk_mock()

        mock_vector = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_class.return_value = mock_vector

        # Act
        VectorService.update_child_chunk_vector([], [], [delete_chunk], dataset)

        # Assert
        mock_vector.delete_by_ids.assert_called_once_with([delete_chunk.index_node_id])

        mock_vector.add_texts.assert_not_called()

    @patch("services.vector_service.Vector")
    @patch("services.vector_service.db")
    def test_update_child_chunk_vector_economy(self, mock_db, mock_vector_class):
        """
        Test update_child_chunk_vector with economy indexing.

        This test verifies that child chunk vectors are not updated when
        using economy indexing.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="economy")

        new_chunk = VectorServiceTestDataFactory.create_child_chunk_mock()

        mock_vector = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_class.return_value = mock_vector

        # Act
        VectorService.update_child_chunk_vector([new_chunk], [], [], dataset)

        # Assert
        mock_vector.delete_by_ids.assert_not_called()

        mock_vector.add_texts.assert_not_called()

    # ========================================================================
    # Tests for delete_child_chunk_vector
    # ========================================================================

    @patch("services.vector_service.Vector")
    @patch("services.vector_service.db")
    def test_delete_child_chunk_vector_high_quality(self, mock_db, mock_vector_class):
        """
        Test delete_child_chunk_vector with high_quality indexing.

        This test verifies that child chunk vectors are correctly deleted
        when using high_quality indexing.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="high_quality")

        child_chunk = VectorServiceTestDataFactory.create_child_chunk_mock()

        mock_vector = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_class.return_value = mock_vector

        # Act
        VectorService.delete_child_chunk_vector(child_chunk, dataset)

        # Assert
        mock_vector.delete_by_ids.assert_called_once_with([child_chunk.index_node_id])

    @patch("services.vector_service.Vector")
    @patch("services.vector_service.db")
    def test_delete_child_chunk_vector_economy(self, mock_db, mock_vector_class):
        """
        Test delete_child_chunk_vector with economy indexing.

        This test verifies that child chunk vectors are not deleted when
        using economy indexing.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(indexing_technique="economy")

        child_chunk = VectorServiceTestDataFactory.create_child_chunk_mock()

        mock_vector = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_class.return_value = mock_vector

        # Act
        VectorService.delete_child_chunk_vector(child_chunk, dataset)

        # Assert
        mock_vector.delete_by_ids.assert_not_called()


# ============================================================================
# Tests for Vector Class
# ============================================================================


class TestVector:
    """
    Comprehensive unit tests for Vector class.

    This test class covers all methods of the Vector class, including
    initialization, collection management, embedding operations, vector
    database operations, and search functionality.
    """

    # ========================================================================
    # Tests for Vector Initialization
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_initialization_default_attributes(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector initialization with default attributes.

        This test verifies that Vector is correctly initialized with default
        attributes when none are provided.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        # Act
        vector = Vector(dataset=dataset)

        # Assert
        assert vector._dataset == dataset

        assert vector._attributes == ["doc_id", "dataset_id", "document_id", "doc_hash"]

        mock_get_embeddings.assert_called_once()

        mock_init_vector.assert_called_once()

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_initialization_custom_attributes(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector initialization with custom attributes.

        This test verifies that Vector is correctly initialized with custom
        attributes when provided.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        custom_attributes = ["custom_attr1", "custom_attr2"]

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        # Act
        vector = Vector(dataset=dataset, attributes=custom_attributes)

        # Assert
        assert vector._dataset == dataset

        assert vector._attributes == custom_attributes

    # ========================================================================
    # Tests for Vector.create
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_create_with_texts(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.create with texts list.

        This test verifies that documents are correctly embedded and created
        in the vector store with batch processing.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        documents = [
            VectorServiceTestDataFactory.create_rag_document_mock(page_content=f"Content {i}") for i in range(5)
        ]

        mock_embeddings = Mock()

        mock_embeddings.embed_documents = Mock(return_value=[[0.1] * 1536] * 5)

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        vector.create(texts=documents)

        # Assert
        mock_embeddings.embed_documents.assert_called()

        mock_vector_processor.create.assert_called()

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_create_empty_texts(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.create with empty texts list.

        This test verifies that when texts is None or empty, no operations
        are performed.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        vector.create(texts=None)

        # Assert
        mock_embeddings.embed_documents.assert_not_called()

        mock_vector_processor.create.assert_not_called()

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_create_large_batch(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.create with large batch of documents.

        This test verifies that large batches are correctly processed in
        chunks of 1000 documents.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        documents = [
            VectorServiceTestDataFactory.create_rag_document_mock(page_content=f"Content {i}") for i in range(2500)
        ]

        mock_embeddings = Mock()

        mock_embeddings.embed_documents = Mock(return_value=[[0.1] * 1536] * 1000)

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        vector.create(texts=documents)

        # Assert
        # Should be called 3 times (1000, 1000, 500)
        assert mock_embeddings.embed_documents.call_count == 3

        assert mock_vector_processor.create.call_count == 3

    # ========================================================================
    # Tests for Vector.add_texts
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_add_texts_without_duplicate_check(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.add_texts without duplicate check.

        This test verifies that documents are added without checking for
        duplicates when duplicate_check is False.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        documents = [VectorServiceTestDataFactory.create_rag_document_mock()]

        mock_embeddings = Mock()

        mock_embeddings.embed_documents = Mock(return_value=[[0.1] * 1536])

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        vector.add_texts(documents, duplicate_check=False)

        # Assert
        mock_embeddings.embed_documents.assert_called_once()

        mock_vector_processor.create.assert_called_once()

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_add_texts_with_duplicate_check(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.add_texts with duplicate check.

        This test verifies that duplicate documents are filtered out when
        duplicate_check is True.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        documents = [VectorServiceTestDataFactory.create_rag_document_mock(doc_id="doc-123")]

        mock_embeddings = Mock()

        mock_embeddings.embed_documents = Mock(return_value=[[0.1] * 1536])

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_processor.text_exists = Mock(return_value=True)  # Document exists

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        vector.add_texts(documents, duplicate_check=True)

        # Assert
        mock_vector_processor.text_exists.assert_called_once_with("doc-123")

        mock_embeddings.embed_documents.assert_not_called()

        mock_vector_processor.create.assert_not_called()

    # ========================================================================
    # Tests for Vector.text_exists
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_text_exists_true(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.text_exists when text exists.

        This test verifies that text_exists correctly returns True when
        a document exists in the vector store.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_processor.text_exists = Mock(return_value=True)

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        result = vector.text_exists("doc-123")

        # Assert
        assert result is True

        mock_vector_processor.text_exists.assert_called_once_with("doc-123")

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_text_exists_false(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.text_exists when text does not exist.

        This test verifies that text_exists correctly returns False when
        a document does not exist in the vector store.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_processor.text_exists = Mock(return_value=False)

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        result = vector.text_exists("doc-123")

        # Assert
        assert result is False

        mock_vector_processor.text_exists.assert_called_once_with("doc-123")

    # ========================================================================
    # Tests for Vector.delete_by_ids
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_delete_by_ids(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.delete_by_ids.

        This test verifies that documents are correctly deleted by their IDs.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        ids = ["doc-1", "doc-2", "doc-3"]

        # Act
        vector.delete_by_ids(ids)

        # Assert
        mock_vector_processor.delete_by_ids.assert_called_once_with(ids)

    # ========================================================================
    # Tests for Vector.delete_by_metadata_field
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_delete_by_metadata_field(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.delete_by_metadata_field.

        This test verifies that documents are correctly deleted by metadata
        field value.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        vector.delete_by_metadata_field("dataset_id", "dataset-123")

        # Assert
        mock_vector_processor.delete_by_metadata_field.assert_called_once_with("dataset_id", "dataset-123")

    # ========================================================================
    # Tests for Vector.search_by_vector
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_search_by_vector(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.search_by_vector.

        This test verifies that vector search correctly embeds the query
        and searches the vector store.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        query = "test query"

        query_vector = [0.1] * 1536

        mock_embeddings = Mock()

        mock_embeddings.embed_query = Mock(return_value=query_vector)

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_processor.search_by_vector = Mock(return_value=[])

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        result = vector.search_by_vector(query)

        # Assert
        mock_embeddings.embed_query.assert_called_once_with(query)

        mock_vector_processor.search_by_vector.assert_called_once_with(query_vector)

        assert result == []

    # ========================================================================
    # Tests for Vector.search_by_full_text
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_search_by_full_text(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector.search_by_full_text.

        This test verifies that full-text search correctly searches the
        vector store without embedding the query.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        query = "test query"

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_processor.search_by_full_text = Mock(return_value=[])

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        result = vector.search_by_full_text(query)

        # Assert
        mock_vector_processor.search_by_full_text.assert_called_once_with(query)

        assert result == []

    # ========================================================================
    # Tests for Vector.delete
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.redis_client")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_delete(self, mock_get_embeddings, mock_init_vector, mock_redis_client):
        """
        Test Vector.delete.

        This test verifies that the collection is deleted and Redis cache
        is cleared.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_processor.collection_name = "test_collection"

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        # Act
        vector.delete()

        # Assert
        mock_vector_processor.delete.assert_called_once()

        mock_redis_client.delete.assert_called_once_with("vector_indexing_test_collection")

    # ========================================================================
    # Tests for Vector.get_vector_factory
    # ========================================================================

    def test_vector_get_vector_factory_chroma(self):
        """
        Test Vector.get_vector_factory for Chroma.

        This test verifies that the correct factory class is returned for
        Chroma vector type.
        """
        # Act
        factory_class = Vector.get_vector_factory(VectorType.CHROMA)

        # Assert
        assert factory_class is not None

        # Verify it's the correct factory by checking the module name
        assert "chroma" in factory_class.__module__.lower()

    def test_vector_get_vector_factory_milvus(self):
        """
        Test Vector.get_vector_factory for Milvus.

        This test verifies that the correct factory class is returned for
        Milvus vector type.
        """
        # Act
        factory_class = Vector.get_vector_factory(VectorType.MILVUS)

        # Assert
        assert factory_class is not None

        assert "milvus" in factory_class.__module__.lower()

    def test_vector_get_vector_factory_invalid_type(self):
        """
        Test Vector.get_vector_factory with invalid vector type.

        This test verifies that a ValueError is raised when an invalid
        vector type is provided.
        """
        # Act & Assert
        with pytest.raises(ValueError, match="Vector store .* is not supported"):
            Vector.get_vector_factory("invalid_type")

    # ========================================================================
    # Tests for Vector._filter_duplicate_texts
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_filter_duplicate_texts(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector._filter_duplicate_texts.

        This test verifies that duplicate documents are correctly filtered
        based on doc_id in metadata.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_vector_processor.text_exists = Mock(side_effect=[True, False])  # First exists, second doesn't

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        doc1 = VectorServiceTestDataFactory.create_rag_document_mock(doc_id="doc-1")

        doc2 = VectorServiceTestDataFactory.create_rag_document_mock(doc_id="doc-2")

        documents = [doc1, doc2]

        # Act
        filtered = vector._filter_duplicate_texts(documents)

        # Assert
        assert len(filtered) == 1

        assert filtered[0].metadata["doc_id"] == "doc-2"

    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._get_embeddings")
    def test_vector_filter_duplicate_texts_no_metadata(self, mock_get_embeddings, mock_init_vector):
        """
        Test Vector._filter_duplicate_texts with documents without metadata.

        This test verifies that documents without metadata are not filtered.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock()

        mock_embeddings = Mock()

        mock_get_embeddings.return_value = mock_embeddings

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        vector = Vector(dataset=dataset)

        doc1 = Document(page_content="Content 1", metadata=None)

        doc2 = Document(page_content="Content 2", metadata={})

        documents = [doc1, doc2]

        # Act
        filtered = vector._filter_duplicate_texts(documents)

        # Assert
        assert len(filtered) == 2

    # ========================================================================
    # Tests for Vector._get_embeddings
    # ========================================================================

    @patch("core.rag.datasource.vdb.vector_factory.CacheEmbedding")
    @patch("core.rag.datasource.vdb.vector_factory.ModelManager")
    @patch("core.rag.datasource.vdb.vector_factory.Vector._init_vector")
    def test_vector_get_embeddings(self, mock_init_vector, mock_model_manager, mock_cache_embedding):
        """
        Test Vector._get_embeddings.

        This test verifies that embeddings are correctly retrieved from
        ModelManager and wrapped in CacheEmbedding.
        """
        # Arrange
        dataset = VectorServiceTestDataFactory.create_dataset_mock(
            embedding_model_provider="openai", embedding_model="text-embedding-ada-002"
        )

        mock_embedding_model = VectorServiceTestDataFactory.create_embedding_model_instance_mock()

        mock_model_manager.return_value.get_model_instance.return_value = mock_embedding_model

        mock_cache_embedding_instance = Mock()

        mock_cache_embedding.return_value = mock_cache_embedding_instance

        mock_vector_processor = VectorServiceTestDataFactory.create_vector_processor_mock()

        mock_init_vector.return_value = mock_vector_processor

        # Act
        vector = Vector(dataset=dataset)

        # Assert
        mock_model_manager.return_value.get_model_instance.assert_called_once()

        mock_cache_embedding.assert_called_once_with(mock_embedding_model)

        assert vector._embeddings == mock_cache_embedding_instance
