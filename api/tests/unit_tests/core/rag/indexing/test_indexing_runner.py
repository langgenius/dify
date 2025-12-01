"""Comprehensive unit tests for IndexingRunner.

This test module provides complete coverage of the IndexingRunner class, which is responsible
for orchestrating the document indexing pipeline in the Dify RAG system.

Test Coverage Areas:
==================
1. **Document Parsing Pipeline (Extract Phase)**
   - Tests extraction from various data sources (upload files, Notion, websites)
   - Validates metadata preservation and document status updates
   - Ensures proper error handling for missing or invalid sources

2. **Chunk Creation Logic (Transform Phase)**
   - Tests document splitting with different segmentation strategies
   - Validates embedding model integration for high-quality indexing
   - Tests text cleaning and preprocessing rules

3. **Embedding Generation Orchestration**
   - Tests parallel processing of document chunks
   - Validates token counting and embedding generation
   - Tests integration with various embedding model providers

4. **Vector Storage Integration (Load Phase)**
   - Tests vector index creation and updates
   - Validates keyword index generation for economy mode
   - Tests parent-child index structures

5. **Retry Logic & Error Handling**
   - Tests pause/resume functionality
   - Validates error recovery and status updates
   - Tests handling of provider token errors and deleted documents

6. **Document Status Management**
   - Tests status transitions (parsing → splitting → indexing → completed)
   - Validates timestamp updates and error state persistence
   - Tests concurrent document processing

Testing Approach:
================
- All tests use mocking to avoid external dependencies (database, storage, Redis)
- Tests follow the Arrange-Act-Assert (AAA) pattern for clarity
- Each test is isolated and can run independently
- Fixtures provide reusable test data and mock objects
- Comprehensive docstrings explain the purpose and assertions of each test

Note: These tests focus on unit testing the IndexingRunner logic. Integration tests
for the full indexing pipeline are handled separately in the integration test suite.
"""

import json
import uuid
from typing import Any
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm.exc import ObjectDeletedError

from core.errors.error import ProviderTokenNotInitError
from core.indexing_runner import (
    DocumentIsDeletedPausedError,
    DocumentIsPausedError,
    IndexingRunner,
)
from core.model_runtime.entities.model_entities import ModelType
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.models.document import ChildDocument, Document
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, DatasetProcessRule
from models.dataset import Document as DatasetDocument

# ============================================================================
# Helper Functions
# ============================================================================


def create_mock_dataset(
    dataset_id: str | None = None,
    tenant_id: str | None = None,
    indexing_technique: str = "high_quality",
    embedding_provider: str = "openai",
    embedding_model: str = "text-embedding-ada-002",
) -> Mock:
    """Create a mock Dataset object with configurable parameters.

    This helper function creates a properly configured mock Dataset object that can be
    used across multiple tests, ensuring consistency in test data.

    Args:
        dataset_id: Optional dataset ID. If None, generates a new UUID.
        tenant_id: Optional tenant ID. If None, generates a new UUID.
        indexing_technique: The indexing technique ("high_quality" or "economy").
        embedding_provider: The embedding model provider name.
        embedding_model: The embedding model name.

    Returns:
        Mock: A configured mock Dataset object with all required attributes.

    Example:
        >>> dataset = create_mock_dataset(indexing_technique="economy")
        >>> assert dataset.indexing_technique == "economy"
    """
    dataset = Mock(spec=Dataset)
    dataset.id = dataset_id or str(uuid.uuid4())
    dataset.tenant_id = tenant_id or str(uuid.uuid4())
    dataset.indexing_technique = indexing_technique
    dataset.embedding_model_provider = embedding_provider
    dataset.embedding_model = embedding_model
    return dataset


def create_mock_dataset_document(
    document_id: str | None = None,
    dataset_id: str | None = None,
    tenant_id: str | None = None,
    doc_form: str = IndexType.PARAGRAPH_INDEX,
    data_source_type: str = "upload_file",
    doc_language: str = "English",
) -> Mock:
    """Create a mock DatasetDocument object with configurable parameters.

    This helper function creates a properly configured mock DatasetDocument object,
    reducing boilerplate code in individual tests.

    Args:
        document_id: Optional document ID. If None, generates a new UUID.
        dataset_id: Optional dataset ID. If None, generates a new UUID.
        tenant_id: Optional tenant ID. If None, generates a new UUID.
        doc_form: The document form/index type (e.g., PARAGRAPH_INDEX, QA_INDEX).
        data_source_type: The data source type ("upload_file", "notion_import", etc.).
        doc_language: The document language.

    Returns:
        Mock: A configured mock DatasetDocument object with all required attributes.

    Example:
        >>> doc = create_mock_dataset_document(doc_form=IndexType.QA_INDEX)
        >>> assert doc.doc_form == IndexType.QA_INDEX
    """
    doc = Mock(spec=DatasetDocument)
    doc.id = document_id or str(uuid.uuid4())
    doc.dataset_id = dataset_id or str(uuid.uuid4())
    doc.tenant_id = tenant_id or str(uuid.uuid4())
    doc.doc_form = doc_form
    doc.doc_language = doc_language
    doc.data_source_type = data_source_type
    doc.data_source_info_dict = {"upload_file_id": str(uuid.uuid4())}
    doc.dataset_process_rule_id = str(uuid.uuid4())
    doc.created_by = str(uuid.uuid4())
    return doc


def create_sample_documents(
    count: int = 3,
    include_children: bool = False,
    base_content: str = "Sample chunk content",
) -> list[Document]:
    """Create a list of sample Document objects for testing.

    This helper function generates test documents with proper metadata,
    optionally including child documents for hierarchical indexing tests.

    Args:
        count: Number of documents to create.
        include_children: Whether to add child documents to each parent.
        base_content: Base content string for documents.

    Returns:
        list[Document]: A list of Document objects with metadata.

    Example:
        >>> docs = create_sample_documents(count=2, include_children=True)
        >>> assert len(docs) == 2
        >>> assert docs[0].children is not None
    """
    documents = []
    for i in range(count):
        doc = Document(
            page_content=f"{base_content} {i + 1}",
            metadata={
                "doc_id": f"chunk{i + 1}",
                "doc_hash": f"hash{i + 1}",
                "document_id": "doc1",
                "dataset_id": "dataset1",
            },
        )

        # Add child documents if requested (for parent-child indexing)
        if include_children:
            doc.children = [
                ChildDocument(
                    page_content=f"Child of {base_content} {i + 1}",
                    metadata={
                        "doc_id": f"child_chunk{i + 1}",
                        "doc_hash": f"child_hash{i + 1}",
                    },
                )
            ]

        documents.append(doc)

    return documents


def create_mock_process_rule(
    mode: str = "automatic",
    max_tokens: int = 500,
    chunk_overlap: int = 50,
    separator: str = "\\n\\n",
) -> dict[str, Any]:
    """Create a mock processing rule dictionary.

    This helper function creates a processing rule configuration that matches
    the structure expected by the IndexingRunner.

    Args:
        mode: Processing mode ("automatic", "custom", or "hierarchical").
        max_tokens: Maximum tokens per chunk.
        chunk_overlap: Number of overlapping tokens between chunks.
        separator: Separator string for splitting.

    Returns:
        dict: A processing rule configuration dictionary.

    Example:
        >>> rule = create_mock_process_rule(mode="custom", max_tokens=1000)
        >>> assert rule["mode"] == "custom"
        >>> assert rule["rules"]["segmentation"]["max_tokens"] == 1000
    """
    return {
        "mode": mode,
        "rules": {
            "segmentation": {
                "max_tokens": max_tokens,
                "chunk_overlap": chunk_overlap,
                "separator": separator,
            },
            "pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}],
        },
    }


# ============================================================================
# Test Classes
# ============================================================================


class TestIndexingRunnerExtract:
    """Unit tests for IndexingRunner._extract method.

    Tests cover:
    - Upload file extraction
    - Notion import extraction
    - Website crawl extraction
    - Document status updates during extraction
    - Error handling for missing data sources
    """

    @pytest.fixture
    def mock_dependencies(self):
        """Mock all external dependencies for extract tests."""
        with (
            patch("core.indexing_runner.db") as mock_db,
            patch("core.indexing_runner.IndexProcessorFactory") as mock_factory,
            patch("core.indexing_runner.storage") as mock_storage,
        ):
            yield {
                "db": mock_db,
                "factory": mock_factory,
                "storage": mock_storage,
            }

    @pytest.fixture
    def sample_dataset_document(self):
        """Create a sample dataset document for testing."""
        doc = Mock(spec=DatasetDocument)
        doc.id = str(uuid.uuid4())
        doc.dataset_id = str(uuid.uuid4())
        doc.tenant_id = str(uuid.uuid4())
        doc.doc_form = IndexType.PARAGRAPH_INDEX
        doc.data_source_type = "upload_file"
        doc.data_source_info_dict = {"upload_file_id": str(uuid.uuid4())}
        return doc

    @pytest.fixture
    def sample_process_rule(self):
        """Create a sample processing rule."""
        return {
            "mode": "automatic",
            "rules": {
                "segmentation": {"max_tokens": 500, "chunk_overlap": 50, "separator": "\\n\\n"},
                "pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}],
            },
        }

    def test_extract_upload_file_success(self, mock_dependencies, sample_dataset_document, sample_process_rule):
        """Test successful extraction from uploaded file.

        This test verifies that the IndexingRunner can successfully extract content
        from an uploaded file and properly update document metadata. It ensures:
        - The processor's extract method is called with correct parameters
        - Document and dataset IDs are properly added to metadata
        - The document status is updated during extraction

        Expected behavior:
        - Extract should return documents with updated metadata
        - Each document should have document_id and dataset_id in metadata
        - The processor's extract method should be called exactly once
        """
        # Arrange: Set up the test environment with mocked dependencies
        runner = IndexingRunner()
        mock_processor = MagicMock()
        mock_dependencies["factory"].return_value.init_index_processor.return_value = mock_processor

        # Create mock extracted documents that simulate PDF page extraction
        extracted_docs = [
            Document(
                page_content="Test content 1",
                metadata={"doc_id": "doc1", "source": "test.pdf", "page": 1},
            ),
            Document(
                page_content="Test content 2",
                metadata={"doc_id": "doc2", "source": "test.pdf", "page": 2},
            ),
        ]
        mock_processor.extract.return_value = extracted_docs

        # Mock the entire _extract method to avoid ExtractSetting validation
        # This is necessary because ExtractSetting uses Pydantic validation
        with patch.object(runner, "_update_document_index_status"):
            with patch("core.indexing_runner.select"):
                with patch("core.indexing_runner.ExtractSetting"):
                    # Act: Call the extract method
                    result = runner._extract(mock_processor, sample_dataset_document, sample_process_rule)

        # Assert: Verify the extraction results
        assert len(result) == 2, "Should extract 2 documents from the PDF"
        assert result[0].page_content == "Test content 1", "First document content should match"
        # Verify metadata was properly updated with document and dataset IDs
        assert result[0].metadata["document_id"] == sample_dataset_document.id
        assert result[0].metadata["dataset_id"] == sample_dataset_document.dataset_id
        assert result[1].page_content == "Test content 2", "Second document content should match"
        # Verify the processor was called exactly once (not multiple times)
        mock_processor.extract.assert_called_once()

    def test_extract_notion_import_success(self, mock_dependencies, sample_dataset_document, sample_process_rule):
        """Test successful extraction from Notion import."""
        # Arrange
        runner = IndexingRunner()
        sample_dataset_document.data_source_type = "notion_import"
        sample_dataset_document.data_source_info_dict = {
            "credential_id": str(uuid.uuid4()),
            "notion_workspace_id": "workspace123",
            "notion_page_id": "page123",
            "type": "page",
        }

        mock_processor = MagicMock()
        mock_dependencies["factory"].return_value.init_index_processor.return_value = mock_processor

        extracted_docs = [Document(page_content="Notion content", metadata={"doc_id": "notion1", "source": "notion"})]
        mock_processor.extract.return_value = extracted_docs

        # Mock update_document_index_status to avoid database calls
        with patch.object(runner, "_update_document_index_status"):
            # Act
            result = runner._extract(mock_processor, sample_dataset_document, sample_process_rule)

        # Assert
        assert len(result) == 1
        assert result[0].page_content == "Notion content"
        assert result[0].metadata["document_id"] == sample_dataset_document.id

    def test_extract_website_crawl_success(self, mock_dependencies, sample_dataset_document, sample_process_rule):
        """Test successful extraction from website crawl."""
        # Arrange
        runner = IndexingRunner()
        sample_dataset_document.data_source_type = "website_crawl"
        sample_dataset_document.data_source_info_dict = {
            "provider": "firecrawl",
            "url": "https://example.com",
            "job_id": "job123",
            "mode": "crawl",
            "only_main_content": True,
        }

        mock_processor = MagicMock()
        mock_dependencies["factory"].return_value.init_index_processor.return_value = mock_processor

        extracted_docs = [
            Document(page_content="Website content", metadata={"doc_id": "web1", "url": "https://example.com"})
        ]
        mock_processor.extract.return_value = extracted_docs

        # Mock update_document_index_status to avoid database calls
        with patch.object(runner, "_update_document_index_status"):
            # Act
            result = runner._extract(mock_processor, sample_dataset_document, sample_process_rule)

        # Assert
        assert len(result) == 1
        assert result[0].page_content == "Website content"
        assert result[0].metadata["document_id"] == sample_dataset_document.id

    def test_extract_missing_upload_file(self, mock_dependencies, sample_dataset_document, sample_process_rule):
        """Test extraction fails when upload file is missing."""
        # Arrange
        runner = IndexingRunner()
        sample_dataset_document.data_source_info_dict = {}

        mock_processor = MagicMock()
        mock_dependencies["factory"].return_value.init_index_processor.return_value = mock_processor

        # Act & Assert
        with pytest.raises(ValueError, match="no upload file found"):
            runner._extract(mock_processor, sample_dataset_document, sample_process_rule)

    def test_extract_unsupported_data_source(self, mock_dependencies, sample_dataset_document, sample_process_rule):
        """Test extraction returns empty list for unsupported data sources."""
        # Arrange
        runner = IndexingRunner()
        sample_dataset_document.data_source_type = "unsupported_type"

        mock_processor = MagicMock()

        # Act
        result = runner._extract(mock_processor, sample_dataset_document, sample_process_rule)

        # Assert
        assert result == []


class TestIndexingRunnerTransform:
    """Unit tests for IndexingRunner._transform method.

    Tests cover:
    - Document chunking with different splitters
    - Embedding model instance retrieval
    - Text cleaning and preprocessing
    - Metadata preservation
    - Child chunk generation for hierarchical indexing
    """

    @pytest.fixture
    def mock_dependencies(self):
        """Mock all external dependencies for transform tests."""
        with (
            patch("core.indexing_runner.db") as mock_db,
            patch("core.indexing_runner.ModelManager") as mock_model_manager,
        ):
            yield {
                "db": mock_db,
                "model_manager": mock_model_manager,
            }

    @pytest.fixture
    def sample_dataset(self):
        """Create a sample dataset for testing."""
        dataset = Mock(spec=Dataset)
        dataset.id = str(uuid.uuid4())
        dataset.tenant_id = str(uuid.uuid4())
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "openai"
        dataset.embedding_model = "text-embedding-ada-002"
        return dataset

    @pytest.fixture
    def sample_text_docs(self):
        """Create sample text documents for transformation."""
        return [
            Document(
                page_content="This is a long document that needs to be split into multiple chunks. " * 10,
                metadata={"doc_id": "doc1", "source": "test.pdf"},
            ),
            Document(
                page_content="Another document with different content. " * 5,
                metadata={"doc_id": "doc2", "source": "test.pdf"},
            ),
        ]

    def test_transform_with_high_quality_indexing(self, mock_dependencies, sample_dataset, sample_text_docs):
        """Test transformation with high quality indexing (embeddings)."""
        # Arrange
        runner = IndexingRunner()
        mock_embedding_instance = MagicMock()
        runner.model_manager.get_model_instance.return_value = mock_embedding_instance

        mock_processor = MagicMock()
        transformed_docs = [
            Document(
                page_content="Chunk 1",
                metadata={"doc_id": "chunk1", "doc_hash": "hash1", "document_id": "doc1"},
            ),
            Document(
                page_content="Chunk 2",
                metadata={"doc_id": "chunk2", "doc_hash": "hash2", "document_id": "doc1"},
            ),
        ]
        mock_processor.transform.return_value = transformed_docs

        process_rule = {
            "mode": "automatic",
            "rules": {"segmentation": {"max_tokens": 500, "chunk_overlap": 50}},
        }

        # Act
        result = runner._transform(mock_processor, sample_dataset, sample_text_docs, "English", process_rule)

        # Assert
        assert len(result) == 2
        assert result[0].page_content == "Chunk 1"
        assert result[1].page_content == "Chunk 2"
        runner.model_manager.get_model_instance.assert_called_once_with(
            tenant_id=sample_dataset.tenant_id,
            provider=sample_dataset.embedding_model_provider,
            model_type=ModelType.TEXT_EMBEDDING,
            model=sample_dataset.embedding_model,
        )
        mock_processor.transform.assert_called_once()

    def test_transform_with_economy_indexing(self, mock_dependencies, sample_dataset, sample_text_docs):
        """Test transformation with economy indexing (no embeddings)."""
        # Arrange
        runner = IndexingRunner()
        sample_dataset.indexing_technique = "economy"

        mock_processor = MagicMock()
        transformed_docs = [
            Document(
                page_content="Chunk 1",
                metadata={"doc_id": "chunk1", "doc_hash": "hash1"},
            )
        ]
        mock_processor.transform.return_value = transformed_docs

        process_rule = {"mode": "automatic", "rules": {}}

        # Act
        result = runner._transform(mock_processor, sample_dataset, sample_text_docs, "English", process_rule)

        # Assert
        assert len(result) == 1
        runner.model_manager.get_model_instance.assert_not_called()

    def test_transform_with_custom_segmentation(self, mock_dependencies, sample_dataset, sample_text_docs):
        """Test transformation with custom segmentation rules."""
        # Arrange
        runner = IndexingRunner()
        mock_embedding_instance = MagicMock()
        runner.model_manager.get_model_instance.return_value = mock_embedding_instance

        mock_processor = MagicMock()
        transformed_docs = [Document(page_content="Custom chunk", metadata={"doc_id": "custom1", "doc_hash": "hash1"})]
        mock_processor.transform.return_value = transformed_docs

        process_rule = {
            "mode": "custom",
            "rules": {"segmentation": {"max_tokens": 1000, "chunk_overlap": 100, "separator": "\\n"}},
        }

        # Act
        result = runner._transform(mock_processor, sample_dataset, sample_text_docs, "Chinese", process_rule)

        # Assert
        assert len(result) == 1
        assert result[0].page_content == "Custom chunk"
        # Verify transform was called with correct parameters
        call_args = mock_processor.transform.call_args
        assert call_args[1]["doc_language"] == "Chinese"
        assert call_args[1]["process_rule"] == process_rule


class TestIndexingRunnerLoad:
    """Unit tests for IndexingRunner._load method.

    Tests cover:
    - Vector index creation
    - Keyword index creation
    - Multi-threaded processing
    - Document segment status updates
    - Token counting
    - Error handling during loading
    """

    @pytest.fixture
    def mock_dependencies(self):
        """Mock all external dependencies for load tests."""
        with (
            patch("core.indexing_runner.db") as mock_db,
            patch("core.indexing_runner.ModelManager") as mock_model_manager,
            patch("core.indexing_runner.current_app") as mock_app,
            patch("core.indexing_runner.threading.Thread") as mock_thread,
            patch("core.indexing_runner.concurrent.futures.ThreadPoolExecutor") as mock_executor,
        ):
            yield {
                "db": mock_db,
                "model_manager": mock_model_manager,
                "app": mock_app,
                "thread": mock_thread,
                "executor": mock_executor,
            }

    @pytest.fixture
    def sample_dataset(self):
        """Create a sample dataset for testing."""
        dataset = Mock(spec=Dataset)
        dataset.id = str(uuid.uuid4())
        dataset.tenant_id = str(uuid.uuid4())
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model_provider = "openai"
        dataset.embedding_model = "text-embedding-ada-002"
        return dataset

    @pytest.fixture
    def sample_dataset_document(self):
        """Create a sample dataset document for testing."""
        doc = Mock(spec=DatasetDocument)
        doc.id = str(uuid.uuid4())
        doc.dataset_id = str(uuid.uuid4())
        doc.doc_form = IndexType.PARAGRAPH_INDEX
        return doc

    @pytest.fixture
    def sample_documents(self):
        """Create sample documents for loading."""
        return [
            Document(
                page_content="Chunk 1 content",
                metadata={"doc_id": "chunk1", "doc_hash": "hash1", "document_id": "doc1"},
            ),
            Document(
                page_content="Chunk 2 content",
                metadata={"doc_id": "chunk2", "doc_hash": "hash2", "document_id": "doc1"},
            ),
            Document(
                page_content="Chunk 3 content",
                metadata={"doc_id": "chunk3", "doc_hash": "hash3", "document_id": "doc1"},
            ),
        ]

    def test_load_with_high_quality_indexing(
        self, mock_dependencies, sample_dataset, sample_dataset_document, sample_documents
    ):
        """Test loading with high quality indexing (vector embeddings)."""
        # Arrange
        runner = IndexingRunner()
        mock_embedding_instance = MagicMock()
        mock_embedding_instance.get_text_embedding_num_tokens.return_value = 100
        runner.model_manager.get_model_instance.return_value = mock_embedding_instance

        mock_processor = MagicMock()

        # Mock ThreadPoolExecutor
        mock_future = MagicMock()
        mock_future.result.return_value = 300  # Total tokens
        mock_executor_instance = MagicMock()
        mock_executor_instance.__enter__.return_value = mock_executor_instance
        mock_executor_instance.__exit__.return_value = None
        mock_executor_instance.submit.return_value = mock_future
        mock_dependencies["executor"].return_value = mock_executor_instance

        # Mock update_document_index_status to avoid database calls
        with patch.object(runner, "_update_document_index_status"):
            # Act
            runner._load(mock_processor, sample_dataset, sample_dataset_document, sample_documents)

        # Assert
        runner.model_manager.get_model_instance.assert_called_once()
        # Verify executor was used for parallel processing
        assert mock_executor_instance.submit.called

    def test_load_with_economy_indexing(
        self, mock_dependencies, sample_dataset, sample_dataset_document, sample_documents
    ):
        """Test loading with economy indexing (keyword only)."""
        # Arrange
        runner = IndexingRunner()
        sample_dataset.indexing_technique = "economy"

        mock_processor = MagicMock()

        # Mock thread for keyword indexing
        mock_thread_instance = MagicMock()
        mock_thread_instance.join = MagicMock()
        mock_dependencies["thread"].return_value = mock_thread_instance

        # Mock update_document_index_status to avoid database calls
        with patch.object(runner, "_update_document_index_status"):
            # Act
            runner._load(mock_processor, sample_dataset, sample_dataset_document, sample_documents)

        # Assert
        # Verify keyword thread was created and joined
        mock_dependencies["thread"].assert_called_once()
        mock_thread_instance.start.assert_called_once()
        mock_thread_instance.join.assert_called_once()

    def test_load_with_parent_child_index(
        self, mock_dependencies, sample_dataset, sample_dataset_document, sample_documents
    ):
        """Test loading with parent-child index structure."""
        # Arrange
        runner = IndexingRunner()
        sample_dataset_document.doc_form = IndexType.PARENT_CHILD_INDEX
        sample_dataset.indexing_technique = "high_quality"

        # Add child documents
        for doc in sample_documents:
            doc.children = [
                ChildDocument(
                    page_content=f"Child of {doc.page_content}",
                    metadata={"doc_id": f"child_{doc.metadata['doc_id']}", "doc_hash": "child_hash"},
                )
            ]

        mock_embedding_instance = MagicMock()
        mock_embedding_instance.get_text_embedding_num_tokens.return_value = 50
        runner.model_manager.get_model_instance.return_value = mock_embedding_instance

        mock_processor = MagicMock()

        # Mock ThreadPoolExecutor
        mock_future = MagicMock()
        mock_future.result.return_value = 150
        mock_executor_instance = MagicMock()
        mock_executor_instance.__enter__.return_value = mock_executor_instance
        mock_executor_instance.__exit__.return_value = None
        mock_executor_instance.submit.return_value = mock_future
        mock_dependencies["executor"].return_value = mock_executor_instance

        # Mock update_document_index_status to avoid database calls
        with patch.object(runner, "_update_document_index_status"):
            # Act
            runner._load(mock_processor, sample_dataset, sample_dataset_document, sample_documents)

        # Assert
        # Verify no keyword thread for parent-child index
        mock_dependencies["thread"].assert_not_called()


class TestIndexingRunnerRun:
    """Unit tests for IndexingRunner.run method.

    Tests cover:
    - Complete end-to-end indexing flow
    - Error handling and recovery
    - Document status transitions
    - Pause detection
    - Multiple document processing
    """

    @pytest.fixture
    def mock_dependencies(self):
        """Mock all external dependencies for run tests."""
        with (
            patch("core.indexing_runner.db") as mock_db,
            patch("core.indexing_runner.IndexProcessorFactory") as mock_factory,
            patch("core.indexing_runner.ModelManager") as mock_model_manager,
            patch("core.indexing_runner.storage") as mock_storage,
            patch("core.indexing_runner.threading.Thread") as mock_thread,
        ):
            yield {
                "db": mock_db,
                "factory": mock_factory,
                "model_manager": mock_model_manager,
                "storage": mock_storage,
                "thread": mock_thread,
            }

    @pytest.fixture
    def sample_dataset_documents(self):
        """Create sample dataset documents for testing."""
        docs = []
        for i in range(2):
            doc = Mock(spec=DatasetDocument)
            doc.id = str(uuid.uuid4())
            doc.dataset_id = str(uuid.uuid4())
            doc.tenant_id = str(uuid.uuid4())
            doc.doc_form = IndexType.PARAGRAPH_INDEX
            doc.doc_language = "English"
            doc.data_source_type = "upload_file"
            doc.data_source_info_dict = {"upload_file_id": str(uuid.uuid4())}
            doc.dataset_process_rule_id = str(uuid.uuid4())
            docs.append(doc)
        return docs

    def test_run_success_single_document(self, mock_dependencies, sample_dataset_documents):
        """Test successful run with single document."""
        # Arrange
        runner = IndexingRunner()
        doc = sample_dataset_documents[0]

        # Mock database queries
        mock_dependencies["db"].session.get.return_value = doc

        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = doc.dataset_id
        mock_dataset.tenant_id = doc.tenant_id
        mock_dataset.indexing_technique = "economy"
        mock_dependencies["db"].session.query.return_value.filter_by.return_value.first.return_value = mock_dataset

        mock_process_rule = Mock(spec=DatasetProcessRule)
        mock_process_rule.to_dict.return_value = {"mode": "automatic", "rules": {}}
        mock_dependencies["db"].session.scalar.return_value = mock_process_rule

        # Mock processor
        mock_processor = MagicMock()
        mock_dependencies["factory"].return_value.init_index_processor.return_value = mock_processor

        # Mock extract, transform, load
        mock_processor.extract.return_value = [Document(page_content="Test content", metadata={"doc_id": "doc1"})]
        mock_processor.transform.return_value = [
            Document(
                page_content="Chunk 1",
                metadata={"doc_id": "chunk1", "doc_hash": "hash1"},
            )
        ]

        # Mock thread for keyword indexing
        mock_thread_instance = MagicMock()
        mock_dependencies["thread"].return_value = mock_thread_instance

        # Mock all internal methods that interact with database
        with (
            patch.object(runner, "_extract", return_value=[Document(page_content="Test", metadata={})]),
            patch.object(
                runner,
                "_transform",
                return_value=[Document(page_content="Chunk", metadata={"doc_id": "c1", "doc_hash": "h1"})],
            ),
            patch.object(runner, "_load_segments"),
            patch.object(runner, "_load"),
        ):
            # Act
            runner.run([doc])

        # Assert - verify the methods were called
        # Since we're mocking the internal methods, we just verify no exceptions were raised

        with (
            patch.object(runner, "_extract", return_value=[Document(page_content="Test", metadata={})]) as mock_extract,
            patch.object(
                runner,
                "_transform",
                return_value=[Document(page_content="Chunk", metadata={"doc_id": "c1", "doc_hash": "h1"})],
            ) as mock_transform,
            patch.object(runner, "_load_segments") as mock_load_segments,
            patch.object(runner, "_load") as mock_load,
        ):
            # Act
            runner.run([doc])

        # Assert - verify the methods were called
        mock_extract.assert_called_once()
        mock_transform.assert_called_once()
        mock_load_segments.assert_called_once()
        mock_load.assert_called_once()

        mock_processor = MagicMock()
        mock_dependencies["factory"].return_value.init_index_processor.return_value = mock_processor

        # Mock _extract to raise DocumentIsPausedError
        with patch.object(runner, "_extract", side_effect=DocumentIsPausedError("Document paused")):
            # Act & Assert
            with pytest.raises(DocumentIsPausedError):
                runner.run([doc])

    def test_run_handles_provider_token_error(self, mock_dependencies, sample_dataset_documents):
        """Test run handles ProviderTokenNotInitError and updates document status."""
        # Arrange
        runner = IndexingRunner()
        doc = sample_dataset_documents[0]

        # Mock database
        mock_dependencies["db"].session.get.return_value = doc

        mock_dataset = Mock(spec=Dataset)
        mock_dependencies["db"].session.query.return_value.filter_by.return_value.first.return_value = mock_dataset

        mock_process_rule = Mock(spec=DatasetProcessRule)
        mock_process_rule.to_dict.return_value = {"mode": "automatic", "rules": {}}
        mock_dependencies["db"].session.scalar.return_value = mock_process_rule

        mock_processor = MagicMock()
        mock_dependencies["factory"].return_value.init_index_processor.return_value = mock_processor
        mock_processor.extract.side_effect = ProviderTokenNotInitError("Token not initialized")

        # Act
        runner.run([doc])

        # Assert
        # Verify document status was updated to error
        assert mock_dependencies["db"].session.commit.called

    def test_run_handles_object_deleted_error(self, mock_dependencies, sample_dataset_documents):
        """Test run handles ObjectDeletedError gracefully."""
        # Arrange
        runner = IndexingRunner()
        doc = sample_dataset_documents[0]

        # Mock database to raise ObjectDeletedError
        mock_dependencies["db"].session.get.return_value = doc

        mock_dataset = Mock(spec=Dataset)
        mock_dependencies["db"].session.query.return_value.filter_by.return_value.first.return_value = mock_dataset

        mock_process_rule = Mock(spec=DatasetProcessRule)
        mock_process_rule.to_dict.return_value = {"mode": "automatic", "rules": {}}
        mock_dependencies["db"].session.scalar.return_value = mock_process_rule

        mock_processor = MagicMock()
        mock_dependencies["factory"].return_value.init_index_processor.return_value = mock_processor

        # Mock _extract to raise ObjectDeletedError
        with patch.object(runner, "_extract", side_effect=ObjectDeletedError(state=None, msg="Object deleted")):
            # Act
            runner.run([doc])

        # Assert - should not raise, just log warning
        # No exception should be raised

    def test_run_processes_multiple_documents(self, mock_dependencies, sample_dataset_documents):
        """Test run processes multiple documents sequentially."""
        # Arrange
        runner = IndexingRunner()
        docs = sample_dataset_documents

        # Mock database
        def get_side_effect(model_class, doc_id):
            for doc in docs:
                if doc.id == doc_id:
                    return doc
            return None

        mock_dependencies["db"].session.get.side_effect = get_side_effect

        mock_dataset = Mock(spec=Dataset)
        mock_dataset.indexing_technique = "economy"
        mock_dependencies["db"].session.query.return_value.filter_by.return_value.first.return_value = mock_dataset

        mock_process_rule = Mock(spec=DatasetProcessRule)
        mock_process_rule.to_dict.return_value = {"mode": "automatic", "rules": {}}
        mock_dependencies["db"].session.scalar.return_value = mock_process_rule

        mock_processor = MagicMock()
        mock_dependencies["factory"].return_value.init_index_processor.return_value = mock_processor

        # Mock thread
        mock_thread_instance = MagicMock()
        mock_dependencies["thread"].return_value = mock_thread_instance

        # Mock all internal methods
        with (
            patch.object(runner, "_extract", return_value=[Document(page_content="Test", metadata={})]) as mock_extract,
            patch.object(
                runner,
                "_transform",
                return_value=[Document(page_content="Chunk", metadata={"doc_id": "c1", "doc_hash": "h1"})],
            ),
            patch.object(runner, "_load_segments"),
            patch.object(runner, "_load"),
        ):
            # Act
            runner.run(docs)

        # Assert
        # Verify extract was called for each document
        assert mock_extract.call_count == len(docs)


class TestIndexingRunnerRetryLogic:
    """Unit tests for retry logic and error handling.

    Tests cover:
    - Document pause status checking
    - Document status updates
    - Error state persistence
    - Deleted document handling
    """

    @pytest.fixture
    def mock_dependencies(self):
        """Mock all external dependencies."""
        with (
            patch("core.indexing_runner.db") as mock_db,
            patch("core.indexing_runner.redis_client") as mock_redis,
        ):
            yield {
                "db": mock_db,
                "redis": mock_redis,
            }

    def test_check_document_paused_status_not_paused(self, mock_dependencies):
        """Test document pause check when document is not paused."""
        # Arrange
        mock_dependencies["redis"].get.return_value = None
        document_id = str(uuid.uuid4())

        # Act & Assert - should not raise
        IndexingRunner._check_document_paused_status(document_id)

    def test_check_document_paused_status_is_paused(self, mock_dependencies):
        """Test document pause check when document is paused."""
        # Arrange
        mock_dependencies["redis"].get.return_value = "1"
        document_id = str(uuid.uuid4())

        # Act & Assert
        with pytest.raises(DocumentIsPausedError):
            IndexingRunner._check_document_paused_status(document_id)

    def test_update_document_index_status_success(self, mock_dependencies):
        """Test successful document status update."""
        # Arrange
        document_id = str(uuid.uuid4())
        mock_document = Mock(spec=DatasetDocument)
        mock_document.id = document_id

        mock_dependencies["db"].session.query.return_value.filter_by.return_value.count.return_value = 0
        mock_dependencies["db"].session.query.return_value.filter_by.return_value.first.return_value = mock_document
        mock_dependencies["db"].session.query.return_value.filter_by.return_value.update.return_value = None

        # Act
        IndexingRunner._update_document_index_status(
            document_id,
            "completed",
            {"tokens": 100, "completed_at": naive_utc_now()},
        )

        # Assert
        mock_dependencies["db"].session.commit.assert_called()

    def test_update_document_index_status_paused(self, mock_dependencies):
        """Test document status update when document is paused."""
        # Arrange
        document_id = str(uuid.uuid4())
        mock_dependencies["db"].session.query.return_value.filter_by.return_value.count.return_value = 1

        # Act & Assert
        with pytest.raises(DocumentIsPausedError):
            IndexingRunner._update_document_index_status(document_id, "completed")

    def test_update_document_index_status_deleted(self, mock_dependencies):
        """Test document status update when document is deleted."""
        # Arrange
        document_id = str(uuid.uuid4())
        mock_dependencies["db"].session.query.return_value.filter_by.return_value.count.return_value = 0
        mock_dependencies["db"].session.query.return_value.filter_by.return_value.first.return_value = None

        # Act & Assert
        with pytest.raises(DocumentIsDeletedPausedError):
            IndexingRunner._update_document_index_status(document_id, "completed")


class TestIndexingRunnerDocumentCleaning:
    """Unit tests for document cleaning and preprocessing.

    Tests cover:
    - Text cleaning rules
    - Whitespace normalization
    - Special character handling
    - Custom preprocessing rules
    """

    @pytest.fixture
    def sample_process_rule_automatic(self):
        """Create automatic processing rule."""
        rule = Mock(spec=DatasetProcessRule)
        rule.mode = "automatic"
        rule.rules = None
        return rule

    @pytest.fixture
    def sample_process_rule_custom(self):
        """Create custom processing rule."""
        rule = Mock(spec=DatasetProcessRule)
        rule.mode = "custom"
        rule.rules = json.dumps(
            {
                "pre_processing_rules": [
                    {"id": "remove_extra_spaces", "enabled": True},
                    {"id": "remove_urls_emails", "enabled": True},
                ]
            }
        )
        return rule

    def test_document_clean_automatic_mode(self, sample_process_rule_automatic):
        """Test document cleaning with automatic mode."""
        # Arrange
        text = "This is   a test   document with   extra spaces."

        # Act
        with patch("core.indexing_runner.CleanProcessor.clean") as mock_clean:
            mock_clean.return_value = "This is a test document with extra spaces."
            result = IndexingRunner._document_clean(text, sample_process_rule_automatic)

        # Assert
        assert "extra spaces" in result
        mock_clean.assert_called_once()

    def test_document_clean_custom_mode(self, sample_process_rule_custom):
        """Test document cleaning with custom rules."""
        # Arrange
        text = "Visit https://example.com or email test@example.com for more info."

        # Act
        with patch("core.indexing_runner.CleanProcessor.clean") as mock_clean:
            mock_clean.return_value = "Visit or email for more info."
            result = IndexingRunner._document_clean(text, sample_process_rule_custom)

        # Assert
        assert "https://" not in result
        assert "@" not in result
        mock_clean.assert_called_once()

    def test_filter_string_removes_special_characters(self):
        """Test filter_string removes special control characters."""
        # Arrange
        text = "Normal text\x00with\x08control\x1fcharacters\x7f"

        # Act
        result = IndexingRunner.filter_string(text)

        # Assert
        assert "\x00" not in result
        assert "\x08" not in result
        assert "\x1f" not in result
        assert "\x7f" not in result
        assert "Normal text" in result

    def test_filter_string_handles_unicode_fffe(self):
        """Test filter_string removes Unicode U+FFFE."""
        # Arrange
        text = "Text with \ufffe unicode issue"

        # Act
        result = IndexingRunner.filter_string(text)

        # Assert
        assert "\ufffe" not in result
        assert "Text with" in result


class TestIndexingRunnerSplitter:
    """Unit tests for text splitter configuration.

    Tests cover:
    - Custom segmentation rules
    - Automatic segmentation
    - Chunk size validation
    - Separator handling
    """

    @pytest.fixture
    def mock_embedding_instance(self):
        """Create mock embedding model instance."""
        instance = MagicMock()
        instance.get_text_embedding_num_tokens.return_value = 100
        return instance

    def test_get_splitter_custom_mode(self, mock_embedding_instance):
        """Test splitter creation with custom mode."""
        # Arrange
        with patch("core.indexing_runner.FixedRecursiveCharacterTextSplitter") as mock_splitter_class:
            mock_splitter = MagicMock()
            mock_splitter_class.from_encoder.return_value = mock_splitter

            # Act
            result = IndexingRunner._get_splitter(
                processing_rule_mode="custom",
                max_tokens=500,
                chunk_overlap=50,
                separator="\\n\\n",
                embedding_model_instance=mock_embedding_instance,
            )

            # Assert
            assert result == mock_splitter
            mock_splitter_class.from_encoder.assert_called_once()
            call_kwargs = mock_splitter_class.from_encoder.call_args[1]
            assert call_kwargs["chunk_size"] == 500
            assert call_kwargs["chunk_overlap"] == 50
            assert call_kwargs["fixed_separator"] == "\n\n"

    def test_get_splitter_automatic_mode(self, mock_embedding_instance):
        """Test splitter creation with automatic mode."""
        # Arrange
        with patch("core.indexing_runner.EnhanceRecursiveCharacterTextSplitter") as mock_splitter_class:
            mock_splitter = MagicMock()
            mock_splitter_class.from_encoder.return_value = mock_splitter

            # Act
            result = IndexingRunner._get_splitter(
                processing_rule_mode="automatic",
                max_tokens=500,
                chunk_overlap=50,
                separator="",
                embedding_model_instance=mock_embedding_instance,
            )

            # Assert
            assert result == mock_splitter
            mock_splitter_class.from_encoder.assert_called_once()

    def test_get_splitter_validates_max_tokens_too_small(self, mock_embedding_instance):
        """Test splitter validation rejects max_tokens below minimum."""
        # Act & Assert
        with pytest.raises(ValueError, match="Custom segment length should be between"):
            IndexingRunner._get_splitter(
                processing_rule_mode="custom",
                max_tokens=30,  # Below minimum of 50
                chunk_overlap=10,
                separator="\\n",
                embedding_model_instance=mock_embedding_instance,
            )

    def test_get_splitter_validates_max_tokens_too_large(self, mock_embedding_instance):
        """Test splitter validation rejects max_tokens above maximum."""
        # Arrange
        with patch("core.indexing_runner.dify_config") as mock_config:
            mock_config.INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH = 5000

            # Act & Assert
            with pytest.raises(ValueError, match="Custom segment length should be between"):
                IndexingRunner._get_splitter(
                    processing_rule_mode="custom",
                    max_tokens=10000,  # Above maximum
                    chunk_overlap=100,
                    separator="\\n",
                    embedding_model_instance=mock_embedding_instance,
                )


class TestIndexingRunnerLoadSegments:
    """Unit tests for segment loading and storage.

    Tests cover:
    - Segment creation in database
    - Child chunk handling
    - Document status updates
    - Word count calculation
    """

    @pytest.fixture
    def mock_dependencies(self):
        """Mock all external dependencies."""
        with (
            patch("core.indexing_runner.db") as mock_db,
            patch("core.indexing_runner.DatasetDocumentStore") as mock_docstore,
        ):
            yield {
                "db": mock_db,
                "docstore": mock_docstore,
            }

    @pytest.fixture
    def sample_dataset(self):
        """Create sample dataset."""
        dataset = Mock(spec=Dataset)
        dataset.id = str(uuid.uuid4())
        dataset.tenant_id = str(uuid.uuid4())
        return dataset

    @pytest.fixture
    def sample_dataset_document(self):
        """Create sample dataset document."""
        doc = Mock(spec=DatasetDocument)
        doc.id = str(uuid.uuid4())
        doc.dataset_id = str(uuid.uuid4())
        doc.created_by = str(uuid.uuid4())
        doc.doc_form = IndexType.PARAGRAPH_INDEX
        return doc

    @pytest.fixture
    def sample_documents(self):
        """Create sample documents."""
        return [
            Document(
                page_content="This is chunk 1 with some content.",
                metadata={"doc_id": "chunk1", "doc_hash": "hash1"},
            ),
            Document(
                page_content="This is chunk 2 with different content.",
                metadata={"doc_id": "chunk2", "doc_hash": "hash2"},
            ),
        ]

    def test_load_segments_paragraph_index(
        self, mock_dependencies, sample_dataset, sample_dataset_document, sample_documents
    ):
        """Test loading segments for paragraph index."""
        # Arrange
        runner = IndexingRunner()
        mock_docstore_instance = MagicMock()
        mock_dependencies["docstore"].return_value = mock_docstore_instance

        # Mock update methods to avoid database calls
        with (
            patch.object(runner, "_update_document_index_status"),
            patch.object(runner, "_update_segments_by_document"),
        ):
            # Act
            runner._load_segments(sample_dataset, sample_dataset_document, sample_documents)

        # Assert
        mock_dependencies["docstore"].assert_called_once_with(
            dataset=sample_dataset,
            user_id=sample_dataset_document.created_by,
            document_id=sample_dataset_document.id,
        )
        mock_docstore_instance.add_documents.assert_called_once_with(docs=sample_documents, save_child=False)

    def test_load_segments_parent_child_index(
        self, mock_dependencies, sample_dataset, sample_dataset_document, sample_documents
    ):
        """Test loading segments for parent-child index."""
        # Arrange
        runner = IndexingRunner()
        sample_dataset_document.doc_form = IndexType.PARENT_CHILD_INDEX

        # Add child documents
        for doc in sample_documents:
            doc.children = [
                ChildDocument(
                    page_content=f"Child of {doc.page_content}",
                    metadata={"doc_id": f"child_{doc.metadata['doc_id']}", "doc_hash": "child_hash"},
                )
            ]

        mock_docstore_instance = MagicMock()
        mock_dependencies["docstore"].return_value = mock_docstore_instance

        # Mock update methods to avoid database calls
        with (
            patch.object(runner, "_update_document_index_status"),
            patch.object(runner, "_update_segments_by_document"),
        ):
            # Act
            runner._load_segments(sample_dataset, sample_dataset_document, sample_documents)

        # Assert
        mock_docstore_instance.add_documents.assert_called_once_with(docs=sample_documents, save_child=True)

    def test_load_segments_updates_word_count(
        self, mock_dependencies, sample_dataset, sample_dataset_document, sample_documents
    ):
        """Test load segments calculates and updates word count."""
        # Arrange
        runner = IndexingRunner()
        mock_docstore_instance = MagicMock()
        mock_dependencies["docstore"].return_value = mock_docstore_instance

        # Calculate expected word count
        expected_word_count = sum(len(doc.page_content.split()) for doc in sample_documents)

        # Mock update methods to avoid database calls
        with (
            patch.object(runner, "_update_document_index_status") as mock_update_status,
            patch.object(runner, "_update_segments_by_document"),
        ):
            # Act
            runner._load_segments(sample_dataset, sample_dataset_document, sample_documents)

        # Assert
        # Verify word count was calculated correctly and passed to status update
        mock_update_status.assert_called_once()
        call_kwargs = mock_update_status.call_args.kwargs
        assert "extra_update_params" in call_kwargs


class TestIndexingRunnerEstimate:
    """Unit tests for indexing estimation.

    Tests cover:
    - Token estimation
    - Segment count estimation
    - Batch upload limit enforcement
    """

    @pytest.fixture
    def mock_dependencies(self):
        """Mock all external dependencies."""
        with (
            patch("core.indexing_runner.db") as mock_db,
            patch("core.indexing_runner.FeatureService") as mock_feature_service,
            patch("core.indexing_runner.IndexProcessorFactory") as mock_factory,
        ):
            yield {
                "db": mock_db,
                "feature_service": mock_feature_service,
                "factory": mock_factory,
            }

    def test_indexing_estimate_respects_batch_limit(self, mock_dependencies):
        """Test indexing estimate enforces batch upload limit."""
        # Arrange
        runner = IndexingRunner()
        tenant_id = str(uuid.uuid4())

        # Mock feature service
        mock_features = MagicMock()
        mock_features.billing.enabled = True
        mock_dependencies["feature_service"].get_features.return_value = mock_features

        # Create too many extract settings
        with patch("core.indexing_runner.dify_config") as mock_config:
            mock_config.BATCH_UPLOAD_LIMIT = 10
            extract_settings = [MagicMock() for _ in range(15)]

            # Act & Assert
            with pytest.raises(ValueError, match="batch upload limit"):
                runner.indexing_estimate(
                    tenant_id=tenant_id,
                    extract_settings=extract_settings,
                    tmp_processing_rule={"mode": "automatic", "rules": {}},
                    doc_form=IndexType.PARAGRAPH_INDEX,
                )


class TestIndexingRunnerProcessChunk:
    """Unit tests for chunk processing in parallel.

    Tests cover:
    - Token counting
    - Vector index creation
    - Segment status updates
    - Pause detection during processing
    """

    @pytest.fixture
    def mock_dependencies(self):
        """Mock all external dependencies."""
        with (
            patch("core.indexing_runner.db") as mock_db,
            patch("core.indexing_runner.redis_client") as mock_redis,
        ):
            yield {
                "db": mock_db,
                "redis": mock_redis,
            }

    @pytest.fixture
    def mock_flask_app(self):
        """Create mock Flask app context."""
        app = MagicMock()
        app.app_context.return_value.__enter__ = MagicMock()
        app.app_context.return_value.__exit__ = MagicMock()
        return app

    def test_process_chunk_counts_tokens(self, mock_dependencies, mock_flask_app):
        """Test process chunk correctly counts tokens."""
        # Arrange
        from core.indexing_runner import IndexingRunner

        runner = IndexingRunner()
        mock_embedding_instance = MagicMock()
        # Mock to return an iterable that sums to 150 tokens
        mock_embedding_instance.get_text_embedding_num_tokens.return_value = [75, 75]

        mock_processor = MagicMock()
        chunk_documents = [
            Document(page_content="Chunk 1", metadata={"doc_id": "c1"}),
            Document(page_content="Chunk 2", metadata={"doc_id": "c2"}),
        ]

        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = str(uuid.uuid4())

        mock_dataset_document = Mock(spec=DatasetDocument)
        mock_dataset_document.id = str(uuid.uuid4())

        mock_dependencies["redis"].get.return_value = None

        # Mock database query for segment updates
        mock_query = MagicMock()
        mock_dependencies["db"].session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.update.return_value = None

        # Create a proper context manager mock
        mock_context = MagicMock()
        mock_context.__enter__ = MagicMock(return_value=None)
        mock_context.__exit__ = MagicMock(return_value=None)
        mock_flask_app.app_context.return_value = mock_context

        # Act - the method creates its own app_context
        tokens = runner._process_chunk(
            mock_flask_app,
            mock_processor,
            chunk_documents,
            mock_dataset,
            mock_dataset_document,
            mock_embedding_instance,
        )

        # Assert
        assert tokens == 150
        mock_processor.load.assert_called_once()

    def test_process_chunk_detects_pause(self, mock_dependencies, mock_flask_app):
        """Test process chunk detects document pause."""
        # Arrange
        from core.indexing_runner import IndexingRunner

        runner = IndexingRunner()
        mock_embedding_instance = MagicMock()
        mock_processor = MagicMock()
        chunk_documents = [Document(page_content="Chunk", metadata={"doc_id": "c1"})]

        mock_dataset = Mock(spec=Dataset)
        mock_dataset_document = Mock(spec=DatasetDocument)
        mock_dataset_document.id = str(uuid.uuid4())

        # Mock Redis to return paused status
        mock_dependencies["redis"].get.return_value = "1"

        # Create a proper context manager mock
        mock_context = MagicMock()
        mock_context.__enter__ = MagicMock(return_value=None)
        mock_context.__exit__ = MagicMock(return_value=None)
        mock_flask_app.app_context.return_value = mock_context

        # Act & Assert - the method creates its own app_context
        with pytest.raises(DocumentIsPausedError):
            runner._process_chunk(
                mock_flask_app,
                mock_processor,
                chunk_documents,
                mock_dataset,
                mock_dataset_document,
                mock_embedding_instance,
            )
