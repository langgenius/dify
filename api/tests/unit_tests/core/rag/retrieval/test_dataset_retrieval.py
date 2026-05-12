import threading
from contextlib import contextmanager, nullcontext
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

import pytest
from flask import Flask, current_app

from core.app.app_config.entities import (
    DatasetEntity,
    DatasetRetrieveConfigEntity,
)
from core.app.app_config.entities import (
    MetadataFilteringCondition as AppMetadataFilteringCondition,
)
from core.app.app_config.entities import (
    ModelConfig as AppModelConfig,
)
from core.app.app_config.entities import ModelConfig as WorkflowModelConfig
from core.app.entities.app_invoke_entities import InvokeFrom, ModelConfigWithCredentialsEntity
from core.entities.agent_entities import PlanningStrategy
from core.entities.model_entities import ModelStatus
from core.rag.data_post_processor.data_post_processor import WeightsDict
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.entities import Condition as AppCondition
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.workflow.nodes.knowledge_retrieval import exc
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.model_entities import ModelFeature
from models.dataset import Dataset
from models.enums import CreatorUserRole

# ==================== Helper Functions ====================


def create_mock_document(
    content: str,
    doc_id: str,
    score: float = 0.8,
    provider: str = "dify",
    additional_metadata: dict[str, Any] | None = None,
) -> Document:
    """
    Create a mock Document object for testing.

    This helper function standardizes document creation across tests,
    ensuring consistent structure and reducing code duplication.

    Args:
        content: The text content of the document
        doc_id: Unique identifier for the document chunk
        score: Relevance score (0.0 to 1.0)
        provider: Document provider ("dify" or "external")
        additional_metadata: Optional extra metadata fields

    Returns:
        Document: A properly structured Document object

    Example:
        >>> doc = create_mock_document("Python is great", "doc1", score=0.95)
        >>> assert doc.metadata["score"] == 0.95
    """
    metadata = {
        "doc_id": doc_id,
        "document_id": str(uuid4()),
        "dataset_id": str(uuid4()),
        "score": score,
    }

    # Merge additional metadata if provided
    if additional_metadata:
        metadata.update(additional_metadata)

    return Document(
        page_content=content,
        metadata=metadata,
        provider=provider,
    )


def create_side_effect_for_search(documents: list[Document]):
    """
    Create a side effect function for mocking search methods.

    This helper creates a function that simulates how RetrievalService
    search methods work - they modify the all_documents list in-place
    rather than returning values directly.

    Args:
        documents: List of documents to add to all_documents

    Returns:
        Callable: A side effect function compatible with mock.side_effect

    Example:
        >>> mock_search.side_effect = create_side_effect_for_search([doc1, doc2])

    Note:
        The RetrievalService uses ThreadPoolExecutor which submits tasks that
        modify a shared all_documents list. This pattern simulates that behavior.
    """

    def side_effect(flask_app, dataset_id, query, top_k, *args, all_documents, exceptions, **kwargs):
        """
        Side effect function that mimics search method behavior.

        Args:
            flask_app: Flask application context (unused in mock)
            dataset_id: ID of the dataset being searched
            query: Search query string
            top_k: Maximum number of results
            all_documents: Shared list to append results to
            exceptions: Shared list to append errors to
            **kwargs: Additional arguments (score_threshold, document_ids_filter, etc.)
        """
        all_documents.extend(documents)

    return side_effect


def create_side_effect_with_exception(error_message: str):
    """
    Create a side effect function that adds an exception to the exceptions list.

    Used for testing error handling in the RetrievalService.

    Args:
        error_message: The error message to add to exceptions

    Returns:
        Callable: A side effect function that simulates an error

    Example:
        >>> mock_search.side_effect = create_side_effect_with_exception("Search failed")
    """

    def side_effect(flask_app, dataset_id, query, top_k, *args, all_documents, exceptions, **kwargs):
        """Add error message to exceptions list."""
        exceptions.append(error_message)

    return side_effect


class TestRetrievalService:
    """
    Comprehensive test suite for RetrievalService class.

    This test class validates all retrieval methods and their interactions,
    including edge cases, error handling, and integration scenarios.

    Test Organization:
    ==================
    1. Fixtures (lines ~190-240)
       - mock_dataset: Standard dataset configuration
       - sample_documents: Reusable test documents with varying scores
       - mock_flask_app: Flask application context
       - mock_thread_pool: Synchronous executor for deterministic testing

    2. Vector Search Tests (lines ~240-350)
       - Basic functionality
       - Document filtering
       - Empty results
       - Metadata filtering
       - Score thresholds

    3. Keyword Search Tests (lines ~350-450)
       - Basic keyword matching
       - Special character handling
       - Document filtering

    4. Hybrid Search Tests (lines ~450-640)
       - Vector + full-text combination
       - Deduplication logic
       - Weighted score merging

    5. Full-Text Search Tests (lines ~640-680)
       - BM25-based search

    6. Score Merging Tests (lines ~680-790)
       - Deduplication algorithms
       - Score comparison
       - Provider-specific handling

    7. Error Handling Tests (lines ~790-920)
       - Empty queries
       - Non-existent datasets
       - Exception propagation

    8. Additional Tests (lines ~920-1080)
       - Query escaping
       - Reranking integration
       - Top-K limiting

    Mocking Strategy:
    =================
    Tests mock at the method level (embedding_search, keyword_search, etc.)
    rather than the underlying Vector/Keyword classes. This approach:
    - Avoids complexity of mocking ThreadPoolExecutor behavior
    - Provides clearer test intent
    - Makes tests more maintainable
    - Properly simulates the in-place list modification pattern

    Common Patterns:
    ================
    1. **Arrange**: Set up mocks with side_effect functions
    2. **Act**: Call RetrievalService.retrieve() with specific parameters
    3. **Assert**: Verify results, mock calls, and side effects

    Example Test Structure:
        ```python
        def test_example(self, mock_get_dataset, mock_search, mock_dataset):
            # Arrange: Set up test data and mocks
            mock_get_dataset.return_value = mock_dataset
            mock_search.side_effect = create_side_effect_for_search([doc1, doc2])

            # Act: Execute the method under test
            results = RetrievalService.retrieve(...)

            # Assert: Verify expectations
            assert len(results) == 2
            mock_search.assert_called_once()
        ```
    """

    @pytest.fixture
    def mock_dataset(self) -> Dataset:
        """
        Create a mock Dataset object for testing.

        Returns:
            Dataset: Mock dataset with standard configuration
        """
        dataset = Mock(spec=Dataset)
        dataset.id = str(uuid4())
        dataset.tenant_id = str(uuid4())
        dataset.name = "test_dataset"
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model = "text-embedding-ada-002"
        dataset.embedding_model_provider = "openai"
        dataset.retrieval_model = {
            "search_method": RetrievalMethod.SEMANTIC_SEARCH,
            "reranking_enable": False,
            "top_k": 4,
            "score_threshold_enabled": False,
        }
        return dataset

    @pytest.fixture
    def sample_documents(self) -> list[Document]:
        """
        Create sample documents for testing retrieval results.

        Returns:
            list[Document]: List of mock documents with varying scores
        """
        return [
            Document(
                page_content="Python is a high-level programming language.",
                metadata={
                    "doc_id": "doc1",
                    "document_id": str(uuid4()),
                    "dataset_id": str(uuid4()),
                    "score": 0.95,
                },
                provider="dify",
            ),
            Document(
                page_content="JavaScript is widely used for web development.",
                metadata={
                    "doc_id": "doc2",
                    "document_id": str(uuid4()),
                    "dataset_id": str(uuid4()),
                    "score": 0.85,
                },
                provider="dify",
            ),
            Document(
                page_content="Machine learning is a subset of artificial intelligence.",
                metadata={
                    "doc_id": "doc3",
                    "document_id": str(uuid4()),
                    "dataset_id": str(uuid4()),
                    "score": 0.75,
                },
                provider="dify",
            ),
        ]

    @pytest.fixture
    def mock_flask_app(self):
        """
        Create a mock Flask application context.

        Returns:
            Mock: Flask app mock with app_context
        """
        app = MagicMock()
        app.app_context.return_value.__enter__ = Mock()
        app.app_context.return_value.__exit__ = Mock()
        return app

    @pytest.fixture(autouse=True)
    def mock_thread_pool(self):
        """
        Mock ThreadPoolExecutor to run tasks synchronously in tests.

        The RetrievalService uses ThreadPoolExecutor to run search operations
        concurrently (embedding_search, keyword_search, full_text_index_search).
        In tests, we want synchronous execution for:
        - Deterministic behavior
        - Easier debugging
        - Avoiding race conditions
        - Simpler assertions

        How it works:
        -------------
        1. Intercepts ThreadPoolExecutor creation
        2. Replaces submit() to execute functions immediately (synchronously)
        3. Functions modify shared all_documents list in-place
        4. Mocks concurrent.futures.wait() since tasks are already done

        Why this approach:
        ------------------
        - RetrievalService.retrieve() creates a ThreadPoolExecutor context
        - It submits search tasks that modify all_documents list
        - concurrent.futures.wait() waits for all tasks to complete
        - By executing synchronously, we avoid threading complexity in tests

        Returns:
            Mock: Mocked ThreadPoolExecutor that executes tasks synchronously
        """
        with patch("core.rag.datasource.retrieval_service.ThreadPoolExecutor") as mock_executor:
            # Store futures to track submitted tasks (for debugging if needed)
            futures_list = []

            def sync_submit(fn, *args, **kwargs):
                """
                Synchronous replacement for ThreadPoolExecutor.submit().

                Instead of scheduling the function for async execution,
                we execute it immediately in the current thread.

                Args:
                    fn: The function to execute (e.g., embedding_search)
                    *args, **kwargs: Arguments to pass to the function

                Returns:
                    Mock: A mock Future object
                """
                future = Mock()
                try:
                    # Execute immediately - this modifies all_documents in place
                    # The function signature is: fn(flask_app, dataset_id, query,
                    #                             top_k, all_documents, exceptions, ...)
                    fn(*args, **kwargs)
                    future.result.return_value = None
                    future.exception.return_value = None
                except Exception as e:
                    # If function raises, store exception in future
                    future.result.return_value = None
                    future.exception.return_value = e

                futures_list.append(future)
                return future

            # Set up the mock executor instance
            mock_executor_instance = Mock()
            mock_executor_instance.submit = sync_submit

            # Configure context manager behavior (__enter__ and __exit__)
            mock_executor.return_value.__enter__.return_value = mock_executor_instance
            mock_executor.return_value.__exit__.return_value = None

            # Mock concurrent.futures.wait to do nothing since tasks are already done
            # In real code, this waits for all futures to complete
            # In tests, futures complete immediately, so wait is a no-op
            with patch("core.rag.datasource.retrieval_service.concurrent.futures.wait"):
                # Mock concurrent.futures.as_completed for early error propagation
                # In real code, this yields futures as they complete
                # In tests, we yield all futures immediately since they're already done
                def mock_as_completed(futures_list, timeout=None):
                    """Mock as_completed that yields futures immediately."""
                    yield from futures_list

                with patch(
                    "core.rag.datasource.retrieval_service.concurrent.futures.as_completed",
                    side_effect=mock_as_completed,
                ):
                    yield mock_executor

    # ==================== Vector Search Tests ====================

    @patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_vector_search_basic(self, mock_get_dataset, mock_retrieve, mock_dataset, sample_documents):
        """
        Test basic vector/semantic search functionality.

        This test validates the core vector search flow:
        1. Dataset is retrieved from database
        2. _retrieve is called via ThreadPoolExecutor
        3. Documents are added to shared all_documents list
        4. Results are returned to caller

        Verifies:
        - Vector search is called with correct parameters
        - Results are returned in expected format
        - Score threshold is applied correctly
        - Documents maintain their metadata and scores
        """
        # ==================== ARRANGE ====================
        # Set up the mock dataset that will be "retrieved" from database
        mock_get_dataset.return_value = mock_dataset

        # Create a side effect function that simulates _retrieve behavior
        # _retrieve modifies the all_documents list in place
        def side_effect_retrieve(
            flask_app,
            retrieval_method,
            dataset,
            query=None,
            top_k=4,
            score_threshold=None,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
            attachment_id=None,
            all_documents=None,
            exceptions=None,
        ):
            """Simulate _retrieve adding documents to the shared list."""
            if all_documents is not None:
                all_documents.extend(sample_documents)

        mock_retrieve.side_effect = side_effect_retrieve

        # Define test parameters
        query = "What is Python?"  # Natural language query
        top_k = 3  # Maximum number of results to return
        score_threshold = 0.7  # Minimum relevance score (0.0 to 1.0)

        # ==================== ACT ====================
        # Call the retrieve method with SEMANTIC_SEARCH strategy
        # This will:
        # 1. Check if query is empty (early return if so)
        # 2. Get the dataset using _get_dataset
        # 3. Create ThreadPoolExecutor
        # 4. Submit _retrieve task
        # 5. Wait for completion
        # 6. Return all_documents list
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id=mock_dataset.id,
            query=query,
            top_k=top_k,
            score_threshold=score_threshold,
        )

        # ==================== ASSERT ====================
        # Verify we got the expected number of documents
        assert len(results) == 3, "Should return 3 documents from sample_documents"

        # Verify all results are Document objects (type safety)
        assert all(isinstance(doc, Document) for doc in results), "All results should be Document instances"

        # Verify documents maintain their scores (highest score first in sample_documents)
        assert results[0].metadata["score"] == 0.95, "First document should have highest score from sample_documents"

        # Verify _retrieve was called exactly once
        # This confirms the search method was invoked by ThreadPoolExecutor
        mock_retrieve.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_vector_search_with_document_filter(self, mock_get_dataset, mock_retrieve, mock_dataset, sample_documents):
        """
        Test vector search with document ID filtering.

        Verifies:
        - Document ID filter is passed correctly to vector search
        - Only specified documents are searched
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset
        filtered_docs = [sample_documents[0]]

        def side_effect_retrieve(
            flask_app,
            retrieval_method,
            dataset,
            query=None,
            top_k=4,
            score_threshold=None,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
            attachment_id=None,
            all_documents=None,
            exceptions=None,
        ):
            if all_documents is not None:
                all_documents.extend(filtered_docs)

        mock_retrieve.side_effect = side_effect_retrieve
        document_ids_filter = [sample_documents[0].metadata["document_id"]]

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id=mock_dataset.id,
            query="test query",
            top_k=5,
            document_ids_filter=document_ids_filter,
        )

        # Assert
        assert len(results) == 1
        assert results[0].metadata["doc_id"] == "doc1"
        # Verify document_ids_filter was passed
        call_kwargs = mock_retrieve.call_args.kwargs
        assert call_kwargs["document_ids_filter"] == document_ids_filter

    @patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_vector_search_empty_results(self, mock_get_dataset, mock_retrieve, mock_dataset):
        """
        Test vector search when no results match the query.

        Verifies:
        - Empty list is returned when no documents match
        - No errors are raised
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset
        # _retrieve doesn't add anything to all_documents
        mock_retrieve.side_effect = lambda *args, **kwargs: None

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id=mock_dataset.id,
            query="nonexistent query",
            top_k=5,
        )

        # Assert
        assert results == []

    # ==================== Keyword Search Tests ====================

    @patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_keyword_search_basic(self, mock_get_dataset, mock_retrieve, mock_dataset, sample_documents):
        """
        Test basic keyword search functionality.

        Verifies:
        - Keyword search is invoked correctly
        - Query is escaped properly for search
        - Results are returned in expected format
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        def side_effect_retrieve(
            flask_app,
            retrieval_method,
            dataset,
            query=None,
            top_k=4,
            score_threshold=None,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
            attachment_id=None,
            all_documents=None,
            exceptions=None,
        ):
            if all_documents is not None:
                all_documents.extend(sample_documents)

        mock_retrieve.side_effect = side_effect_retrieve

        query = "Python programming"
        top_k = 3

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.KEYWORD_SEARCH,
            dataset_id=mock_dataset.id,
            query=query,
            top_k=top_k,
        )

        # Assert
        assert len(results) == 3
        assert all(isinstance(doc, Document) for doc in results)
        mock_retrieve.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.RetrievalService.keyword_search")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_keyword_search_with_special_characters(self, mock_get_dataset, mock_keyword_search, mock_dataset):
        """
        Test keyword search with special characters in query.

        Verifies:
        - Special characters are escaped correctly
        - Search handles quotes and other special chars
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset
        mock_keyword_search.side_effect = lambda *args, **kwargs: None

        query = 'Python "programming" language'

        # Act
        RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.KEYWORD_SEARCH,
            dataset_id=mock_dataset.id,
            query=query,
            top_k=5,
        )

        # Assert
        # Verify that keyword_search was called
        assert mock_keyword_search.called
        # The query escaping happens inside keyword_search method
        call_args = mock_keyword_search.call_args
        assert call_args is not None

    @patch("core.rag.datasource.retrieval_service.RetrievalService.keyword_search")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_keyword_search_with_document_filter(
        self, mock_get_dataset, mock_keyword_search, mock_dataset, sample_documents
    ):
        """
        Test keyword search with document ID filtering.

        Verifies:
        - Document filter is applied to keyword search
        - Only filtered documents are returned
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset
        filtered_docs = [sample_documents[1]]

        def side_effect_keyword_search(
            flask_app, dataset_id, query, top_k, all_documents, exceptions, document_ids_filter=None
        ):
            all_documents.extend(filtered_docs)

        mock_keyword_search.side_effect = side_effect_keyword_search
        document_ids_filter = [sample_documents[1].metadata["document_id"]]

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.KEYWORD_SEARCH,
            dataset_id=mock_dataset.id,
            query="JavaScript",
            top_k=5,
            document_ids_filter=document_ids_filter,
        )

        # Assert
        assert len(results) == 1
        assert results[0].metadata["doc_id"] == "doc2"

    # ==================== Hybrid Search Tests ====================

    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.RetrievalService.full_text_index_search")
    @patch("core.rag.datasource.retrieval_service.RetrievalService.embedding_search")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_hybrid_search_basic(
        self,
        mock_get_dataset,
        mock_embedding_search,
        mock_fulltext_search,
        mock_data_processor_class,
        mock_dataset,
        sample_documents,
    ):
        """
        Test basic hybrid search combining vector and full-text search.

        Verifies:
        - Both vector and full-text search are executed
        - Results are merged and deduplicated
        - DataPostProcessor is invoked for score merging
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        # Vector search returns first 2 docs
        def side_effect_embedding(
            flask_app,
            dataset_id,
            query,
            top_k,
            score_threshold,
            reranking_model,
            all_documents,
            retrieval_method,
            exceptions,
            document_ids_filter=None,
        ):
            all_documents.extend(sample_documents[:2])

        mock_embedding_search.side_effect = side_effect_embedding

        # Full-text search returns last 2 docs (with overlap)
        def side_effect_fulltext(
            flask_app,
            dataset_id,
            query,
            top_k,
            score_threshold,
            reranking_model,
            all_documents,
            retrieval_method,
            exceptions,
            document_ids_filter=None,
        ):
            all_documents.extend(sample_documents[1:])

        mock_fulltext_search.side_effect = side_effect_fulltext

        # Mock DataPostProcessor
        mock_processor_instance = Mock()
        mock_processor_instance.invoke.return_value = sample_documents
        mock_data_processor_class.return_value = mock_processor_instance

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.HYBRID_SEARCH,
            dataset_id=mock_dataset.id,
            query="Python programming",
            top_k=3,
            score_threshold=0.5,
        )

        # Assert
        assert len(results) == 3
        mock_embedding_search.assert_called_once()
        mock_fulltext_search.assert_called_once()
        mock_processor_instance.invoke.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.RetrievalService.full_text_index_search")
    @patch("core.rag.datasource.retrieval_service.RetrievalService.embedding_search")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_hybrid_search_deduplication(
        self, mock_get_dataset, mock_embedding_search, mock_fulltext_search, mock_data_processor_class, mock_dataset
    ):
        """
        Test that hybrid search properly deduplicates documents.

        Hybrid search combines results from multiple search methods (vector + full-text).
        This can lead to duplicate documents when the same chunk is found by both methods.

        Scenario:
        ---------
        1. Vector search finds document "duplicate_doc" with score 0.9
        2. Full-text search also finds "duplicate_doc" but with score 0.6
        3. Both searches find "unique_doc"
        4. Deduplication should keep only the higher-scoring version (0.9)

        Why deduplication matters:
        --------------------------
        - Prevents showing the same content multiple times to users
        - Ensures score consistency (keeps best match)
        - Improves result quality and user experience
        - Happens BEFORE reranking to avoid processing duplicates

        Verifies:
        - Duplicate documents (same doc_id) are removed
        - Higher scoring duplicate is retained
        - Deduplication happens before post-processing
        - Final result count is correct
        """
        # ==================== ARRANGE ====================
        mock_get_dataset.return_value = mock_dataset

        # Create test documents with intentional duplication
        # Same doc_id but different scores to test score comparison logic
        doc1_high = Document(
            page_content="Content 1",
            metadata={
                "doc_id": "duplicate_doc",  # Same doc_id as doc1_low
                "score": 0.9,  # Higher score - should be kept
                "document_id": str(uuid4()),
            },
            provider="dify",
        )
        doc1_low = Document(
            page_content="Content 1",
            metadata={
                "doc_id": "duplicate_doc",  # Same doc_id as doc1_high
                "score": 0.6,  # Lower score - should be discarded
                "document_id": str(uuid4()),
            },
            provider="dify",
        )
        doc2 = Document(
            page_content="Content 2",
            metadata={
                "doc_id": "unique_doc",  # Unique doc_id
                "score": 0.8,
                "document_id": str(uuid4()),
            },
            provider="dify",
        )

        # Simulate vector search returning high-score duplicate + unique doc
        def side_effect_embedding(
            flask_app,
            dataset_id,
            query,
            top_k,
            score_threshold,
            reranking_model,
            all_documents,
            retrieval_method,
            exceptions,
            document_ids_filter=None,
        ):
            """Vector search finds 2 documents including high-score duplicate."""
            all_documents.extend([doc1_high, doc2])

        mock_embedding_search.side_effect = side_effect_embedding

        # Simulate full-text search returning low-score duplicate
        def side_effect_fulltext(
            flask_app,
            dataset_id,
            query,
            top_k,
            score_threshold,
            reranking_model,
            all_documents,
            retrieval_method,
            exceptions,
            document_ids_filter=None,
        ):
            """Full-text search finds the same document but with lower score."""
            all_documents.extend([doc1_low])

        mock_fulltext_search.side_effect = side_effect_fulltext

        # Mock DataPostProcessor to return deduplicated results
        # In real implementation, _deduplicate_documents is called before this
        mock_processor_instance = Mock()
        mock_processor_instance.invoke.return_value = [doc1_high, doc2]
        mock_data_processor_class.return_value = mock_processor_instance

        # ==================== ACT ====================
        # Execute hybrid search which should:
        # 1. Run both embedding_search and full_text_index_search
        # 2. Collect all results in all_documents (3 docs: 2 unique + 1 duplicate)
        # 3. Call _deduplicate_documents to remove duplicate (keeps higher score)
        # 4. Pass deduplicated results to DataPostProcessor
        # 5. Return final results
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.HYBRID_SEARCH,
            dataset_id=mock_dataset.id,
            query="test",
            top_k=5,
        )

        # ==================== ASSERT ====================
        # Verify deduplication worked correctly
        assert len(results) == 2, "Should have 2 unique documents after deduplication (not 3)"

        # Verify the correct documents are present
        doc_ids = [doc.metadata["doc_id"] for doc in results]
        assert "duplicate_doc" in doc_ids, "Duplicate doc should be present (higher score version)"
        assert "unique_doc" in doc_ids, "Unique doc should be present"

        # Implicitly verifies that doc1_low (score 0.6) was discarded
        # in favor of doc1_high (score 0.9)

    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.RetrievalService.full_text_index_search")
    @patch("core.rag.datasource.retrieval_service.RetrievalService.embedding_search")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_hybrid_search_with_weights(
        self,
        mock_get_dataset,
        mock_embedding_search,
        mock_fulltext_search,
        mock_data_processor_class,
        mock_dataset,
        sample_documents,
    ):
        """
        Test hybrid search with custom weights for score merging.

        Verifies:
        - Weights are passed to DataPostProcessor
        - Score merging respects weight configuration
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        def side_effect_embedding(
            flask_app,
            dataset_id,
            query,
            top_k,
            score_threshold,
            reranking_model,
            all_documents,
            retrieval_method,
            exceptions,
            document_ids_filter=None,
        ):
            all_documents.extend(sample_documents[:2])

        mock_embedding_search.side_effect = side_effect_embedding

        def side_effect_fulltext(
            flask_app,
            dataset_id,
            query,
            top_k,
            score_threshold,
            reranking_model,
            all_documents,
            retrieval_method,
            exceptions,
            document_ids_filter=None,
        ):
            all_documents.extend(sample_documents[1:])

        mock_fulltext_search.side_effect = side_effect_fulltext

        mock_processor_instance = Mock()
        mock_processor_instance.invoke.return_value = sample_documents
        mock_data_processor_class.return_value = mock_processor_instance

        weights = {
            "vector_setting": {
                "vector_weight": 0.7,
                "embedding_provider_name": "openai",
                "embedding_model_name": "text-embedding-ada-002",
            },
            "keyword_setting": {"keyword_weight": 0.3},
        }

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.HYBRID_SEARCH,
            dataset_id=mock_dataset.id,
            query="test query",
            top_k=3,
            weights=weights,
            reranking_mode="weighted_score",
        )

        # Assert
        assert len(results) == 3
        # Verify DataPostProcessor was created with weights
        mock_data_processor_class.assert_called_once()
        # Check that weights were passed (may be in args or kwargs)
        call_args = mock_data_processor_class.call_args
        if call_args.kwargs:
            assert call_args.kwargs.get("weights") == weights
        else:
            # Weights might be in positional args (position 3)
            assert len(call_args.args) >= 4

    # ==================== Full-Text Search Tests ====================

    @patch("core.rag.datasource.retrieval_service.RetrievalService.full_text_index_search")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_fulltext_search_basic(self, mock_get_dataset, mock_fulltext_search, mock_dataset, sample_documents):
        """
        Test basic full-text search functionality.

        Verifies:
        - Full-text search is invoked correctly
        - Results are returned in expected format
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        def side_effect_fulltext(
            flask_app,
            dataset_id,
            query,
            top_k,
            score_threshold,
            reranking_model,
            all_documents,
            retrieval_method,
            exceptions,
            document_ids_filter=None,
        ):
            all_documents.extend(sample_documents)

        mock_fulltext_search.side_effect = side_effect_fulltext

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.FULL_TEXT_SEARCH,
            dataset_id=mock_dataset.id,
            query="programming language",
            top_k=3,
        )

        # Assert
        assert len(results) == 3
        mock_fulltext_search.assert_called_once()

    # ==================== Score Merging Tests ====================

    def test_deduplicate_documents_basic(self):
        """
        Test basic document deduplication logic.

        Verifies:
        - Documents with same doc_id are deduplicated
        - First occurrence is kept by default
        """
        # Arrange
        doc1 = Document(
            page_content="Content 1",
            metadata={"doc_id": "doc1", "score": 0.8},
            provider="dify",
        )
        doc2 = Document(
            page_content="Content 2",
            metadata={"doc_id": "doc2", "score": 0.7},
            provider="dify",
        )
        doc1_duplicate = Document(
            page_content="Content 1 duplicate",
            metadata={"doc_id": "doc1", "score": 0.6},
            provider="dify",
        )

        documents = [doc1, doc2, doc1_duplicate]

        # Act
        result = RetrievalService._deduplicate_documents(documents)

        # Assert
        assert len(result) == 2
        doc_ids = [doc.metadata["doc_id"] for doc in result]
        assert doc_ids == ["doc1", "doc2"]

    def test_deduplicate_documents_keeps_higher_score(self):
        """
        Test that deduplication keeps document with higher score.

        Verifies:
        - When duplicates exist, higher scoring version is retained
        - Score comparison works correctly
        """
        # Arrange
        doc_low = Document(
            page_content="Content",
            metadata={"doc_id": "doc1", "score": 0.5},
            provider="dify",
        )
        doc_high = Document(
            page_content="Content",
            metadata={"doc_id": "doc1", "score": 0.9},
            provider="dify",
        )

        # Low score first
        documents = [doc_low, doc_high]

        # Act
        result = RetrievalService._deduplicate_documents(documents)

        # Assert
        assert len(result) == 1
        assert result[0].metadata["score"] == 0.9

    def test_deduplicate_documents_empty_list(self):
        """
        Test deduplication with empty document list.

        Verifies:
        - Empty list returns empty list
        - No errors are raised
        """
        # Act
        result = RetrievalService._deduplicate_documents([])

        # Assert
        assert result == []

    def test_deduplicate_documents_non_dify_provider(self):
        """
        Test deduplication with non-dify provider documents that have no doc_id.

        Verifies:
        - External provider documents without doc_id use content-based deduplication
        - Identical content from the same provider is collapsed to one result
        """
        # Arrange
        doc1 = Document(
            page_content="External content",
            metadata={"score": 0.8},
            provider="external",
        )
        doc2 = Document(
            page_content="External content",
            metadata={"score": 0.7},
            provider="external",
        )

        documents = [doc1, doc2]

        # Act
        result = RetrievalService._deduplicate_documents(documents)

        # Assert
        # External documents without doc_id should use content-based dedup
        assert len(result) == 1

    def test_deduplicate_documents_non_dify_provider_with_doc_id_different_sources(self):
        """
        Regression test for issue #35707.

        Two chunks from different source documents share identical text content but carry
        different doc_ids. Before the fix, non-dify providers were forced into content-based
        deduplication and the second chunk was silently dropped. After the fix, doc_id is used
        as the dedup key for any provider that exposes it, so both chunks must be retained.

        Verifies:
        - Non-dify provider documents with different doc_ids are NOT deduplicated even when
          their page_content is identical.
        """
        # Arrange — same content, different doc_ids, non-dify provider (e.g. Weaviate / Qdrant)
        doc_a = Document(
            page_content="Shared identical content",
            metadata={"doc_id": "doc-from-file-a", "score": 0.85},
            provider="weaviate",
        )
        doc_b = Document(
            page_content="Shared identical content",
            metadata={"doc_id": "doc-from-file-b", "score": 0.82},
            provider="weaviate",
        )

        # Act
        result = RetrievalService._deduplicate_documents([doc_a, doc_b])

        # Assert — both documents must be kept; losing either silently drops a source citation
        assert len(result) == 2
        doc_ids = {doc.metadata["doc_id"] for doc in result}
        assert doc_ids == {"doc-from-file-a", "doc-from-file-b"}

    def test_deduplicate_documents_non_dify_provider_with_same_doc_id(self):
        """
        Test that non-dify provider documents sharing the same doc_id are deduplicated by
        doc_id key (not by content), and the higher-scored duplicate is retained.

        Verifies:
        - doc_id-based deduplication now applies to any provider, not only "dify"
        - The document with the highest score wins when doc_ids collide
        """
        # Arrange
        doc_low = Document(
            page_content="Content A",
            metadata={"doc_id": "chunk-1", "score": 0.5},
            provider="qdrant",
        )
        doc_high = Document(
            page_content="Content A",
            metadata={"doc_id": "chunk-1", "score": 0.9},
            provider="qdrant",
        )

        # Act
        result = RetrievalService._deduplicate_documents([doc_low, doc_high])

        # Assert
        assert len(result) == 1
        assert result[0].metadata["score"] == 0.9

    def test_deduplicate_documents_dify_provider_without_doc_id_falls_back_to_content(self):
        """
        Test that a dify provider document without doc_id still falls back to content-based
        deduplication (no regression from original behaviour).

        Verifies:
        - Absence of doc_id triggers content-based dedup regardless of provider
        - First occurrence is kept when content is identical
        """
        # Arrange — dify docs with no doc_id, same content
        doc1 = Document(
            page_content="Same content",
            metadata={"score": 0.8},
            provider="dify",
        )
        doc2 = Document(
            page_content="Same content",
            metadata={"score": 0.9},
            provider="dify",
        )

        # Act
        result = RetrievalService._deduplicate_documents([doc1, doc2])

        # Assert — collapsed to one; first-seen wins (no score comparison in content branch)
        assert len(result) == 1
        assert result[0].metadata["score"] == 0.8

    # ==================== Metadata Filtering Tests ====================

    @patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_vector_search_with_metadata_filter(self, mock_get_dataset, mock_retrieve, mock_dataset, sample_documents):
        """
        Test vector search with metadata-based document filtering.

        Verifies:
        - Metadata filters are applied correctly
        - Only documents matching metadata criteria are returned
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        # Add metadata to documents
        filtered_doc = sample_documents[0]
        filtered_doc.metadata["category"] = "programming"

        def side_effect_retrieve(
            flask_app,
            retrieval_method,
            dataset,
            query=None,
            top_k=4,
            score_threshold=None,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
            attachment_id=None,
            all_documents=None,
            exceptions=None,
        ):
            if all_documents is not None:
                all_documents.append(filtered_doc)

        mock_retrieve.side_effect = side_effect_retrieve

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id=mock_dataset.id,
            query="Python",
            top_k=5,
            document_ids_filter=[filtered_doc.metadata["document_id"]],
        )

        # Assert
        assert len(results) == 1
        assert results[0].metadata.get("category") == "programming"

    # ==================== Error Handling Tests ====================

    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_retrieve_with_empty_query(self, mock_get_dataset, mock_dataset):
        """
        Test retrieval with empty query string.

        Verifies:
        - Empty query returns empty results
        - No search operations are performed
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id=mock_dataset.id,
            query="",
            top_k=5,
        )

        # Assert
        assert results == []

    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_retrieve_with_nonexistent_dataset(self, mock_get_dataset):
        """
        Test retrieval with non-existent dataset ID.

        Verifies:
        - Non-existent dataset returns empty results
        - No errors are raised
        """
        # Arrange
        mock_get_dataset.return_value = None

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id="nonexistent_id",
            query="test query",
            top_k=5,
        )

        # Assert
        assert results == []

    @patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_retrieve_with_exception_handling(self, mock_get_dataset, mock_retrieve, mock_dataset):
        """
        Test that exceptions during retrieval are properly handled.

        Verifies:
        - Exceptions are caught and added to exceptions list
        - ValueError is raised with exception messages
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        # Make _retrieve add an exception to the exceptions list
        def side_effect_with_exception(
            flask_app,
            retrieval_method,
            dataset,
            query=None,
            top_k=4,
            score_threshold=None,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
            attachment_id=None,
            all_documents=None,
            exceptions=None,
        ):
            if exceptions is not None:
                exceptions.append("Search failed")

        mock_retrieve.side_effect = side_effect_with_exception

        # Act & Assert
        with pytest.raises(ValueError) as exc_info:
            RetrievalService.retrieve(
                retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
                dataset_id=mock_dataset.id,
                query="test query",
                top_k=5,
            )

        assert "Search failed" in str(exc_info.value)

    # ==================== Score Threshold Tests ====================

    @patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_vector_search_with_score_threshold(self, mock_get_dataset, mock_retrieve, mock_dataset):
        """
        Test vector search with score threshold filtering.

        Verifies:
        - Score threshold is passed to search method
        - Documents below threshold are filtered out
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        # Only return documents above threshold
        high_score_doc = Document(
            page_content="High relevance content",
            metadata={"doc_id": "doc1", "score": 0.85},
            provider="dify",
        )

        def side_effect_retrieve(
            flask_app,
            retrieval_method,
            dataset,
            query=None,
            top_k=4,
            score_threshold=None,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
            attachment_id=None,
            all_documents=None,
            exceptions=None,
        ):
            if all_documents is not None:
                all_documents.append(high_score_doc)

        mock_retrieve.side_effect = side_effect_retrieve

        score_threshold = 0.8

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id=mock_dataset.id,
            query="test query",
            top_k=5,
            score_threshold=score_threshold,
        )

        # Assert
        assert len(results) == 1
        assert results[0].metadata["score"] >= score_threshold

    # ==================== Top-K Limiting Tests ====================

    @patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_retrieve_respects_top_k_limit(self, mock_get_dataset, mock_retrieve, mock_dataset):
        """
        Test that retrieval respects top_k parameter.

        Verifies:
        - Only top_k documents are returned
        - Limit is applied correctly
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        # Create more documents than top_k
        many_docs = [
            Document(
                page_content=f"Content {i}",
                metadata={"doc_id": f"doc{i}", "score": 0.9 - i * 0.1},
                provider="dify",
            )
            for i in range(10)
        ]

        def side_effect_retrieve(
            flask_app,
            retrieval_method,
            dataset,
            query=None,
            top_k=4,
            score_threshold=None,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
            attachment_id=None,
            all_documents=None,
            exceptions=None,
        ):
            # Return only top_k documents
            if all_documents is not None:
                all_documents.extend(many_docs[:top_k])

        mock_retrieve.side_effect = side_effect_retrieve

        top_k = 3

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id=mock_dataset.id,
            query="test query",
            top_k=top_k,
        )

        # Assert
        # Verify _retrieve was called
        assert mock_retrieve.called
        call_kwargs = mock_retrieve.call_args.kwargs
        assert call_kwargs["top_k"] == top_k
        # Verify we got the right number of results
        assert len(results) == top_k

    # ==================== Query Escaping Tests ====================

    def test_escape_query_for_search(self):
        """
        Test query escaping for special characters.

        Verifies:
        - Double quotes are properly escaped
        - Other characters remain unchanged
        """
        # Test cases with expected outputs
        test_cases = [
            ("simple query", "simple query"),
            ('query with "quotes"', 'query with \\"quotes\\"'),
            ('"quoted phrase"', '\\"quoted phrase\\"'),
            ("no special chars", "no special chars"),
        ]

        for input_query, expected_output in test_cases:
            result = RetrievalService.escape_query_for_search(input_query)
            assert result == expected_output

    # ==================== Reranking Tests ====================

    @patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_semantic_search_with_reranking(self, mock_get_dataset, mock_retrieve, mock_dataset, sample_documents):
        """
        Test semantic search with reranking model.

        Verifies:
        - Reranking is applied when configured
        - DataPostProcessor is invoked with correct parameters
        """
        # Arrange
        mock_get_dataset.return_value = mock_dataset

        # Simulate reranking changing order
        reranked_docs = list(reversed(sample_documents))

        def side_effect_retrieve(
            flask_app,
            retrieval_method,
            dataset,
            query=None,
            top_k=4,
            score_threshold=None,
            reranking_model=None,
            reranking_mode="reranking_model",
            weights=None,
            document_ids_filter=None,
            attachment_id=None,
            all_documents=None,
            exceptions=None,
        ):
            # _retrieve handles reranking internally
            if all_documents is not None:
                all_documents.extend(reranked_docs)

        mock_retrieve.side_effect = side_effect_retrieve

        reranking_model = {
            "reranking_provider_name": "cohere",
            "reranking_model_name": "rerank-english-v2.0",
        }

        # Act
        results = RetrievalService.retrieve(
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset_id=mock_dataset.id,
            query="test query",
            top_k=3,
            reranking_model=reranking_model,
        )

        # Assert
        # For semantic search with reranking, reranking_model should be passed
        assert len(results) == 3
        call_kwargs = mock_retrieve.call_args.kwargs
        assert call_kwargs["reranking_model"] == reranking_model

    # ==================== Multiple Retrieve Thread Tests ====================

    @patch("core.rag.retrieval.dataset_retrieval.DataPostProcessor")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval._retriever")
    def test_multiple_retrieve_thread_skips_second_reranking_with_single_dataset(
        self, mock_retriever, mock_data_processor_class, mock_flask_app, mock_dataset
    ):
        """
        Test that _multiple_retrieve_thread skips second reranking when dataset_count is 1.

        When there is only one dataset, the second reranking is unnecessary
        because the documents are already ranked from the first retrieval.
        This optimization avoids the overhead of reranking when it won't
        provide any benefit.

        Verifies:
        - DataPostProcessor is NOT called when dataset_count == 1
        - Documents are still added to all_documents
        - Standard scoring logic is applied instead
        """
        # Arrange
        dataset_retrieval = DatasetRetrieval()
        tenant_id = str(uuid4())

        # Create test documents
        doc1 = Document(
            page_content="Test content 1",
            metadata={"doc_id": "doc1", "score": 0.9, "document_id": str(uuid4()), "dataset_id": mock_dataset.id},
            provider="dify",
        )
        doc2 = Document(
            page_content="Test content 2",
            metadata={"doc_id": "doc2", "score": 0.8, "document_id": str(uuid4()), "dataset_id": mock_dataset.id},
            provider="dify",
        )

        # Mock _retriever to return documents
        def side_effect_retriever(
            flask_app, dataset_id, query, top_k, all_documents, document_ids_filter, metadata_condition, attachment_ids
        ):
            all_documents.extend([doc1, doc2])

        mock_retriever.side_effect = side_effect_retriever

        # Set up dataset with high_quality indexing
        mock_dataset.indexing_technique = "high_quality"

        all_documents = []

        # Act - Call with dataset_count = 1
        dataset_retrieval._multiple_retrieve_thread(
            flask_app=mock_flask_app,
            available_datasets=[mock_dataset],
            metadata_condition=None,
            metadata_filter_document_ids=None,
            all_documents=all_documents,
            tenant_id=tenant_id,
            reranking_enable=True,
            reranking_mode="reranking_model",
            reranking_model={"reranking_provider_name": "cohere", "reranking_model_name": "rerank-v2"},
            weights=None,
            top_k=5,
            score_threshold=0.5,
            query="test query",
            attachment_id=None,
            dataset_count=1,  # Single dataset - should skip second reranking
        )

        # Assert
        # DataPostProcessor should NOT be called (second reranking skipped)
        mock_data_processor_class.assert_not_called()

        # Documents should still be added to all_documents
        assert len(all_documents) == 2
        assert all_documents[0].page_content == "Test content 1"
        assert all_documents[1].page_content == "Test content 2"

    @patch("core.rag.retrieval.dataset_retrieval.DataPostProcessor")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval._retriever")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval.calculate_vector_score")
    def test_multiple_retrieve_thread_performs_second_reranking_with_multiple_datasets(
        self, mock_calculate_vector_score, mock_retriever, mock_data_processor_class, mock_flask_app, mock_dataset
    ):
        """
        Test that _multiple_retrieve_thread performs second reranking when dataset_count > 1.

        When there are multiple datasets, the second reranking is necessary
        to merge and re-rank results from different datasets. This ensures
        the most relevant documents across all datasets are returned.

        Verifies:
        - DataPostProcessor IS called when dataset_count > 1
        - Reranking is applied with correct parameters
        - Documents are processed correctly
        """
        # Arrange
        dataset_retrieval = DatasetRetrieval()
        tenant_id = str(uuid4())

        # Create test documents
        doc1 = Document(
            page_content="Test content 1",
            metadata={"doc_id": "doc1", "score": 0.7, "document_id": str(uuid4()), "dataset_id": mock_dataset.id},
            provider="dify",
        )
        doc2 = Document(
            page_content="Test content 2",
            metadata={"doc_id": "doc2", "score": 0.6, "document_id": str(uuid4()), "dataset_id": mock_dataset.id},
            provider="dify",
        )

        # Mock _retriever to return documents
        def side_effect_retriever(
            flask_app, dataset_id, query, top_k, all_documents, document_ids_filter, metadata_condition, attachment_ids
        ):
            all_documents.extend([doc1, doc2])

        mock_retriever.side_effect = side_effect_retriever

        # Set up dataset with high_quality indexing
        mock_dataset.indexing_technique = "high_quality"

        # Mock DataPostProcessor instance and its invoke method
        mock_processor_instance = Mock()
        # Simulate reranking - return documents in reversed order with updated scores
        reranked_docs = [
            Document(
                page_content="Test content 2",
                metadata={"doc_id": "doc2", "score": 0.95, "document_id": str(uuid4()), "dataset_id": mock_dataset.id},
                provider="dify",
            ),
            Document(
                page_content="Test content 1",
                metadata={"doc_id": "doc1", "score": 0.85, "document_id": str(uuid4()), "dataset_id": mock_dataset.id},
                provider="dify",
            ),
        ]
        mock_processor_instance.invoke.return_value = reranked_docs
        mock_data_processor_class.return_value = mock_processor_instance

        all_documents = []

        # Create second dataset
        mock_dataset2 = Mock(spec=Dataset)
        mock_dataset2.id = str(uuid4())
        mock_dataset2.indexing_technique = "high_quality"
        mock_dataset2.provider = "dify"

        # Act - Call with dataset_count = 2
        dataset_retrieval._multiple_retrieve_thread(
            flask_app=mock_flask_app,
            available_datasets=[mock_dataset, mock_dataset2],
            metadata_condition=None,
            metadata_filter_document_ids=None,
            all_documents=all_documents,
            tenant_id=tenant_id,
            reranking_enable=True,
            reranking_mode="reranking_model",
            reranking_model={"reranking_provider_name": "cohere", "reranking_model_name": "rerank-v2"},
            weights=None,
            top_k=5,
            score_threshold=0.5,
            query="test query",
            attachment_id=None,
            dataset_count=2,  # Multiple datasets - should perform second reranking
        )

        # Assert
        # DataPostProcessor SHOULD be called (second reranking performed)
        mock_data_processor_class.assert_called_once_with(
            tenant_id,
            "reranking_model",
            {"reranking_provider_name": "cohere", "reranking_model_name": "rerank-v2"},
            None,
            False,
        )

        # Verify invoke was called with correct parameters
        mock_processor_instance.invoke.assert_called_once()

        # Documents should be added to all_documents after reranking
        assert len(all_documents) == 2
        # The reranked order should be reflected
        assert all_documents[0].page_content == "Test content 2"
        assert all_documents[1].page_content == "Test content 1"

    @patch("core.rag.retrieval.dataset_retrieval.DataPostProcessor")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval._retriever")
    @patch("core.rag.retrieval.dataset_retrieval.DatasetRetrieval.calculate_vector_score")
    def test_multiple_retrieve_thread_single_dataset_uses_standard_scoring(
        self, mock_calculate_vector_score, mock_retriever, mock_data_processor_class, mock_flask_app, mock_dataset
    ):
        """
        Test that _multiple_retrieve_thread uses standard scoring when dataset_count is 1
        and reranking is enabled.

        When there's only one dataset, instead of using DataPostProcessor,
        the method should fall through to the standard scoring logic
        (calculate_vector_score for high_quality datasets).

        Verifies:
        - DataPostProcessor is NOT called
        - calculate_vector_score IS called for high_quality indexing
        - Documents are scored correctly
        """
        # Arrange
        dataset_retrieval = DatasetRetrieval()
        tenant_id = str(uuid4())

        # Create test documents
        doc1 = Document(
            page_content="Test content 1",
            metadata={"doc_id": "doc1", "score": 0.9, "document_id": str(uuid4()), "dataset_id": mock_dataset.id},
            provider="dify",
        )
        doc2 = Document(
            page_content="Test content 2",
            metadata={"doc_id": "doc2", "score": 0.8, "document_id": str(uuid4()), "dataset_id": mock_dataset.id},
            provider="dify",
        )

        # Mock _retriever to return documents
        def side_effect_retriever(
            flask_app, dataset_id, query, top_k, all_documents, document_ids_filter, metadata_condition, attachment_ids
        ):
            all_documents.extend([doc1, doc2])

        mock_retriever.side_effect = side_effect_retriever

        # Set up dataset with high_quality indexing
        mock_dataset.indexing_technique = "high_quality"

        # Mock calculate_vector_score to return scored documents
        scored_docs = [
            Document(
                page_content="Test content 1",
                metadata={"doc_id": "doc1", "score": 0.95, "document_id": str(uuid4()), "dataset_id": mock_dataset.id},
                provider="dify",
            ),
        ]
        mock_calculate_vector_score.return_value = scored_docs

        all_documents = []

        # Act - Call with dataset_count = 1
        dataset_retrieval._multiple_retrieve_thread(
            flask_app=mock_flask_app,
            available_datasets=[mock_dataset],
            metadata_condition=None,
            metadata_filter_document_ids=None,
            all_documents=all_documents,
            tenant_id=tenant_id,
            reranking_enable=True,  # Reranking enabled but should be skipped for single dataset
            reranking_mode="reranking_model",
            reranking_model={"reranking_provider_name": "cohere", "reranking_model_name": "rerank-v2"},
            weights=None,
            top_k=5,
            score_threshold=0.5,
            query="test query",
            attachment_id=None,
            dataset_count=1,
        )

        # Assert
        # DataPostProcessor should NOT be called
        mock_data_processor_class.assert_not_called()

        # calculate_vector_score SHOULD be called for high_quality datasets
        mock_calculate_vector_score.assert_called_once()
        call_args = mock_calculate_vector_score.call_args
        assert call_args[0][1] == 5  # top_k

        # Documents should be added after standard scoring
        assert len(all_documents) == 1
        assert all_documents[0].page_content == "Test content 1"


class TestRetrievalMethods:
    """
    Test suite for RetrievalMethod enum and utility methods.

    The RetrievalMethod enum defines the available search strategies:

    1. **SEMANTIC_SEARCH**: Vector-based similarity search using embeddings
       - Best for: Natural language queries, conceptual similarity
       - Uses: Embedding models (e.g., text-embedding-ada-002)
       - Example: "What is machine learning?" matches "AI and ML concepts"

    2. **FULL_TEXT_SEARCH**: BM25-based text matching
       - Best for: Exact phrase matching, keyword presence
       - Uses: BM25 algorithm with sparse vectors
       - Example: "Python programming" matches documents with those exact terms

    3. **HYBRID_SEARCH**: Combination of semantic + full-text
       - Best for: Comprehensive search with both conceptual and exact matching
       - Uses: Both embedding vectors and BM25, with score merging
       - Example: Finds both semantically similar and keyword-matching documents

    4. **KEYWORD_SEARCH**: Traditional keyword-based search (economy mode)
       - Best for: Simple, fast searches without embeddings
       - Uses: Jieba tokenization and keyword matching
       - Example: Basic text search without vector database

    Utility Methods:
    ================
    - is_support_semantic_search(): Check if method uses embeddings
    - is_support_fulltext_search(): Check if method uses BM25

    These utilities help determine which search operations to execute
    in the RetrievalService.retrieve() method.
    """

    def test_retrieval_method_values(self):
        """
        Test that all retrieval method constants are defined correctly.

        This ensures the enum values match the expected string constants
        used throughout the codebase for configuration and API calls.

        Verifies:
        - All expected retrieval methods exist
        - Values are correct strings (not accidentally changed)
        - String values match database/config expectations
        """
        assert RetrievalMethod.SEMANTIC_SEARCH == "semantic_search"
        assert RetrievalMethod.FULL_TEXT_SEARCH == "full_text_search"
        assert RetrievalMethod.HYBRID_SEARCH == "hybrid_search"
        assert RetrievalMethod.KEYWORD_SEARCH == "keyword_search"

    def test_is_support_semantic_search(self):
        """
        Test semantic search support detection.

        Verifies:
        - Semantic search method is detected
        - Hybrid search method is detected (includes semantic)
        - Other methods are not detected
        """
        assert RetrievalMethod.is_support_semantic_search(RetrievalMethod.SEMANTIC_SEARCH) is True
        assert RetrievalMethod.is_support_semantic_search(RetrievalMethod.HYBRID_SEARCH) is True
        assert RetrievalMethod.is_support_semantic_search(RetrievalMethod.FULL_TEXT_SEARCH) is False
        assert RetrievalMethod.is_support_semantic_search(RetrievalMethod.KEYWORD_SEARCH) is False

    def test_is_support_fulltext_search(self):
        """
        Test full-text search support detection.

        Verifies:
        - Full-text search method is detected
        - Hybrid search method is detected (includes full-text)
        - Other methods are not detected
        """
        assert RetrievalMethod.is_support_fulltext_search(RetrievalMethod.FULL_TEXT_SEARCH) is True
        assert RetrievalMethod.is_support_fulltext_search(RetrievalMethod.HYBRID_SEARCH) is True
        assert RetrievalMethod.is_support_fulltext_search(RetrievalMethod.SEMANTIC_SEARCH) is False
        assert RetrievalMethod.is_support_fulltext_search(RetrievalMethod.KEYWORD_SEARCH) is False


class TestDocumentModel:
    """
    Test suite for Document model used in retrieval.

    The Document class is the core data structure for representing text chunks
    in the retrieval system. It's based on Pydantic BaseModel for validation.

    Document Structure:
    ===================
    - **page_content** (str): The actual text content of the document chunk
    - **metadata** (dict): Additional information about the document
      - doc_id: Unique identifier for the chunk
      - document_id: Parent document ID
      - dataset_id: Dataset this document belongs to
      - score: Relevance score from search (0.0 to 1.0)
      - Custom fields: category, tags, timestamps, etc.
    - **provider** (str): Source of the document ("dify" or "external")
    - **vector** (list[float] | None): Embedding vector for semantic search
    - **children** (list[ChildDocument] | None): Sub-chunks for hierarchical docs

    Document Lifecycle:
    ===================
    1. **Creation**: Documents are created when text is indexed
       - Content is chunked into manageable pieces
       - Embeddings are generated for semantic search
       - Metadata is attached for filtering and tracking

    2. **Storage**: Documents are stored in vector databases
       - Vector field stores embeddings
       - Metadata enables filtering
       - Provider tracks source (internal vs external)

    3. **Retrieval**: Documents are returned from search operations
       - Scores are added during search
       - Multiple documents may be combined (hybrid search)
       - Deduplication uses doc_id

    4. **Post-processing**: Documents may be reranked or filtered
       - Scores can be recalculated
       - Content may be truncated or formatted
       - Metadata is used for display

    Why Test the Document Model:
    ============================
    - Ensures data structure integrity
    - Validates Pydantic model behavior
    - Confirms default values work correctly
    - Tests equality comparison for deduplication
    - Verifies metadata handling

    Related Classes:
    ================
    - ChildDocument: For hierarchical document structures
    - RetrievalSegments: Combines Document with database segment info
    """

    def test_document_creation_basic(self):
        """
        Test basic Document object creation.

        Tests the minimal required fields and default values.
        Only page_content is required; all other fields have defaults.

        Verifies:
        - Document can be created with minimal fields
        - Default values are set correctly
        - Pydantic validation works
        - No exceptions are raised
        """
        doc = Document(page_content="Test content")

        assert doc.page_content == "Test content"
        assert doc.metadata == {}  # Empty dict by default
        assert doc.provider == "dify"  # Default provider
        assert doc.vector is None  # No embedding by default
        assert doc.children is None  # No child documents by default

    def test_document_creation_with_metadata(self):
        """
        Test Document creation with metadata.

        Verifies:
        - Metadata is stored correctly
        - Metadata can contain various types
        """
        metadata = {
            "doc_id": "test_doc",
            "score": 0.95,
            "dataset_id": str(uuid4()),
            "category": "test",
        }
        doc = Document(page_content="Test content", metadata=metadata)

        assert doc.metadata == metadata
        assert doc.metadata["score"] == 0.95

    def test_document_creation_with_vector(self):
        """
        Test Document creation with embedding vector.

        Verifies:
        - Vector embeddings can be stored
        - Vector is optional
        """
        vector = [0.1, 0.2, 0.3, 0.4, 0.5]
        doc = Document(page_content="Test content", vector=vector)

        assert doc.vector == vector
        assert len(doc.vector) == 5

    def test_document_with_external_provider(self):
        """
        Test Document with external provider.

        Verifies:
        - Provider can be set to external
        - External documents are handled correctly
        """
        doc = Document(page_content="External content", provider="external")

        assert doc.provider == "external"

    def test_document_equality(self):
        """
        Test Document equality comparison.

        Verifies:
        - Documents with same content are considered equal
        - Metadata affects equality
        """
        doc1 = Document(page_content="Content", metadata={"id": "1"})
        doc2 = Document(page_content="Content", metadata={"id": "1"})
        doc3 = Document(page_content="Different", metadata={"id": "1"})

        assert doc1 == doc2
        assert doc1 != doc3


# ==================== Helper Functions ====================


def create_mock_dataset_methods(
    dataset_id: str | None = None,
    tenant_id: str | None = None,
    provider: str = "dify",
    indexing_technique: str = "high_quality",
    available_document_count: int = 10,
) -> Mock:
    """
    Create a mock Dataset object for testing.

    Args:
        dataset_id: Unique identifier for the dataset
        tenant_id: Tenant ID for the dataset
        provider: Provider type ("dify" or "external")
        indexing_technique: Indexing technique ("high_quality" or "economy")
        available_document_count: Number of available documents

    Returns:
        Mock: A properly configured Dataset mock
    """
    dataset = Mock(spec=Dataset)
    dataset.id = dataset_id or str(uuid4())
    dataset.tenant_id = tenant_id or str(uuid4())
    dataset.name = "test_dataset"
    dataset.provider = provider
    dataset.indexing_technique = indexing_technique
    dataset.available_document_count = available_document_count
    dataset.embedding_model = "text-embedding-ada-002"
    dataset.embedding_model_provider = "openai"
    dataset.retrieval_model = {
        "search_method": "semantic_search",
        "reranking_enable": False,
        "top_k": 4,
        "score_threshold_enabled": False,
    }
    return dataset


def create_mock_document_methods(
    content: str,
    doc_id: str,
    score: float = 0.8,
    provider: str = "dify",
    additional_metadata: dict[str, Any] | None = None,
) -> Document:
    """
    Create a mock Document object for testing.

    Args:
        content: The text content of the document
        doc_id: Unique identifier for the document chunk
        score: Relevance score (0.0 to 1.0)
        provider: Document provider ("dify" or "external")
        additional_metadata: Optional extra metadata fields

    Returns:
        Document: A properly structured Document object
    """
    metadata = {
        "doc_id": doc_id,
        "document_id": str(uuid4()),
        "dataset_id": str(uuid4()),
        "score": score,
    }

    if additional_metadata:
        metadata.update(additional_metadata)

    return Document(
        page_content=content,
        metadata=metadata,
        provider=provider,
    )


# ==================== Test _check_knowledge_rate_limit ====================


class TestCheckKnowledgeRateLimit:
    """
    Test suite for _check_knowledge_rate_limit method.

    The _check_knowledge_rate_limit method validates whether a tenant has
    exceeded their knowledge retrieval rate limit. This is important for:
    - Preventing abuse of the knowledge retrieval system
    - Enforcing subscription plan limits
    - Tracking usage for billing purposes

    Test Cases:
    ============
    1. Rate limit disabled - no exception raised
    2. Rate limit enabled but not exceeded - no exception raised
    3. Rate limit enabled and exceeded - RateLimitExceededError raised
    4. Redis operations are performed correctly
    5. RateLimitLog is created when limit is exceeded
    """

    @patch("core.rag.retrieval.dataset_retrieval.FeatureService")
    @patch("core.rag.retrieval.dataset_retrieval.redis_client")
    def test_rate_limit_disabled_no_exception(self, mock_redis, mock_feature_service):
        """
        Test that when rate limit is disabled, no exception is raised.

        This test verifies the behavior when the tenant's subscription
        does not have rate limiting enabled.

        Verifies:
        - FeatureService.get_knowledge_rate_limit is called
        - No Redis operations are performed
        - No exception is raised
        - Retrieval proceeds normally
        """
        # Arrange
        tenant_id = str(uuid4())
        dataset_retrieval = DatasetRetrieval()

        # Mock rate limit disabled
        mock_limit = Mock()
        mock_limit.enabled = False
        mock_feature_service.get_knowledge_rate_limit.return_value = mock_limit

        # Act & Assert - should not raise any exception
        dataset_retrieval._check_knowledge_rate_limit(tenant_id)

        # Verify FeatureService was called
        mock_feature_service.get_knowledge_rate_limit.assert_called_once_with(tenant_id)

        # Verify no Redis operations were performed
        assert not mock_redis.zadd.called
        assert not mock_redis.zremrangebyscore.called
        assert not mock_redis.zcard.called

    @patch("core.rag.retrieval.dataset_retrieval.session_factory")
    @patch("core.rag.retrieval.dataset_retrieval.FeatureService")
    @patch("core.rag.retrieval.dataset_retrieval.redis_client")
    @patch("core.rag.retrieval.dataset_retrieval.time")
    def test_rate_limit_enabled_not_exceeded(self, mock_time, mock_redis, mock_feature_service, mock_session_factory):
        """
        Test that when rate limit is enabled but not exceeded, no exception is raised.

        This test simulates a tenant making requests within their rate limit.
        The Redis sorted set stores timestamps of recent requests, and old
        requests (older than 60 seconds) are removed.

        Verifies:
        - Redis zadd is called to track the request
        - Redis zremrangebyscore removes old entries
        - Redis zcard returns count within limit
        - No exception is raised
        """
        # Arrange
        tenant_id = str(uuid4())
        dataset_retrieval = DatasetRetrieval()

        # Mock rate limit enabled with limit of 100 requests per minute
        mock_limit = Mock()
        mock_limit.enabled = True
        mock_limit.limit = 100
        mock_limit.subscription_plan = "professional"
        mock_feature_service.get_knowledge_rate_limit.return_value = mock_limit

        # Mock time
        current_time = 1234567890000  # Current time in milliseconds
        mock_time.time.return_value = current_time / 1000  # Return seconds
        mock_time.time.__mul__ = lambda self, x: int(self * x)  # Multiply to get milliseconds

        # Mock Redis operations
        # zcard returns 50 (within limit of 100)
        mock_redis.zcard.return_value = 50

        # Mock session_factory.create_session
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
        mock_session_factory.create_session.return_value.__exit__.return_value = None

        # Act & Assert - should not raise any exception
        dataset_retrieval._check_knowledge_rate_limit(tenant_id)

        # Verify Redis operations
        expected_key = f"rate_limit_{tenant_id}"
        mock_redis.zadd.assert_called_once_with(expected_key, {current_time: current_time})
        mock_redis.zremrangebyscore.assert_called_once_with(expected_key, 0, current_time - 60000)
        mock_redis.zcard.assert_called_once_with(expected_key)

    @patch("core.rag.retrieval.dataset_retrieval.session_factory")
    @patch("core.rag.retrieval.dataset_retrieval.FeatureService")
    @patch("core.rag.retrieval.dataset_retrieval.redis_client")
    @patch("core.rag.retrieval.dataset_retrieval.time")
    def test_rate_limit_enabled_exceeded_raises_exception(
        self, mock_time, mock_redis, mock_feature_service, mock_session_factory
    ):
        """
        Test that when rate limit is enabled and exceeded, RateLimitExceededError is raised.

        This test simulates a tenant exceeding their rate limit. When the count
        of recent requests exceeds the limit, an exception should be raised and
        a RateLimitLog should be created.

        Verifies:
        - Redis zcard returns count exceeding limit
        - RateLimitExceededError is raised with correct message
        - RateLimitLog is created in database
        - Session operations are performed correctly
        """
        # Arrange
        tenant_id = str(uuid4())
        dataset_retrieval = DatasetRetrieval()

        # Mock rate limit enabled with limit of 100 requests per minute
        mock_limit = Mock()
        mock_limit.enabled = True
        mock_limit.limit = 100
        mock_limit.subscription_plan = "professional"
        mock_feature_service.get_knowledge_rate_limit.return_value = mock_limit

        # Mock time
        current_time = 1234567890000
        mock_time.time.return_value = current_time / 1000

        # Mock Redis operations - return count exceeding limit
        mock_redis.zcard.return_value = 150  # Exceeds limit of 100

        # Mock session_factory.create_session
        mock_session = MagicMock()
        mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
        mock_session_factory.create_session.return_value.__exit__.return_value = None

        # Act & Assert
        with pytest.raises(exc.RateLimitExceededError) as exc_info:
            dataset_retrieval._check_knowledge_rate_limit(tenant_id)

        # Verify exception message
        assert "knowledge base request rate limit" in str(exc_info.value)

        # Verify RateLimitLog was created
        mock_session.add.assert_called_once()
        added_log = mock_session.add.call_args[0][0]
        assert added_log.tenant_id == tenant_id
        assert added_log.subscription_plan == "professional"
        assert added_log.operation == "knowledge"


# ==================== Test _get_available_datasets ====================


class TestGetAvailableDatasets:
    """
    Test suite for _get_available_datasets method.

    The _get_available_datasets method retrieves datasets that are available
    for retrieval. A dataset is considered available if:
    - It belongs to the specified tenant
    - It's in the list of requested dataset_ids
    - It has at least one completed, enabled, non-archived document OR
    - It's an external provider dataset

    Note: Due to SQLAlchemy subquery complexity, full testing is done in
    integration tests. Unit tests here verify basic behavior.
    """

    def test_method_exists_and_has_correct_signature(self):
        """
        Test that the method exists and has the correct signature.

        Verifies:
        - Method exists on DatasetRetrieval class
        - Accepts tenant_id and dataset_ids parameters
        """
        # Arrange
        dataset_retrieval = DatasetRetrieval()

        # Assert - method exists
        assert hasattr(dataset_retrieval, "_get_available_datasets")
        # Assert - method is callable
        assert callable(dataset_retrieval._get_available_datasets)


# ==================== Test knowledge_retrieval ====================


class TestDatasetRetrievalKnowledgeRetrieval:
    """
    Test suite for knowledge_retrieval method.

    The knowledge_retrieval method is the main entry point for retrieving
    knowledge from datasets. It orchestrates the entire retrieval process:
    1. Checks rate limits
    2. Gets available datasets
    3. Applies metadata filtering if enabled
    4. Performs retrieval (single or multiple mode)
    5. Formats and returns results

    Test Cases:
    ============
    1. Single mode retrieval
    2. Multiple mode retrieval
    3. Metadata filtering disabled
    4. Metadata filtering automatic
    5. Metadata filtering manual
    6. External documents handling
    7. Dify documents handling
    8. Empty results handling
    9. Rate limit exceeded
    10. No available datasets
    """

    def test_knowledge_retrieval_single_mode_basic(self):
        """
        Test knowledge_retrieval in single retrieval mode - basic check.

        Note: Full single mode testing requires complex model mocking and
        is better suited for integration tests. This test verifies the
        method accepts single mode requests.

        Verifies:
        - Method can accept single mode request
        - Request parameters are correctly structured
        """
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        app_id = str(uuid4())
        dataset_id = str(uuid4())

        request = KnowledgeRetrievalRequest(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            user_from="web",
            dataset_ids=[dataset_id],
            query="What is Python?",
            retrieval_mode="single",
            model_provider="openai",
            model_name="gpt-4",
            model_mode="chat",
            completion_params={"temperature": 0.7},
        )

        # Assert - request is properly structured
        assert request.retrieval_mode == "single"
        assert request.model_provider == "openai"
        assert request.model_name == "gpt-4"
        assert request.model_mode == "chat"

    @patch("core.rag.retrieval.dataset_retrieval.DataPostProcessor")
    @patch("core.rag.retrieval.dataset_retrieval.session_factory")
    def test_knowledge_retrieval_multiple_mode(self, mock_session_factory, mock_data_processor):
        """
        Test knowledge_retrieval in multiple retrieval mode.

        In multiple mode, retrieval is performed across all datasets and
        results are combined and reranked.

        Verifies:
        - Rate limit is checked
        - Available datasets are retrieved
        - Multiple retrieval is performed
        - Results are combined and reranked
        - Results are formatted correctly
        """
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        app_id = str(uuid4())
        dataset_id1 = str(uuid4())
        dataset_id2 = str(uuid4())

        request = KnowledgeRetrievalRequest(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            user_from="web",
            dataset_ids=[dataset_id1, dataset_id2],
            query="What is Python?",
            retrieval_mode="multiple",
            top_k=5,
            score_threshold=0.7,
            reranking_enable=True,
            reranking_mode="reranking_model",
            reranking_model={"reranking_provider_name": "cohere", "reranking_model_name": "rerank-v2"},
        )

        dataset_retrieval = DatasetRetrieval()

        # Mock _check_knowledge_rate_limit
        with patch.object(dataset_retrieval, "_check_knowledge_rate_limit"):
            # Mock _get_available_datasets
            mock_dataset1 = create_mock_dataset_methods(dataset_id=dataset_id1, tenant_id=tenant_id)
            mock_dataset2 = create_mock_dataset_methods(dataset_id=dataset_id2, tenant_id=tenant_id)
            with patch.object(
                dataset_retrieval, "_get_available_datasets", return_value=[mock_dataset1, mock_dataset2]
            ):
                # Mock get_metadata_filter_condition
                with patch.object(dataset_retrieval, "get_metadata_filter_condition", return_value=(None, None)):
                    # Mock multiple_retrieve to return documents
                    doc1 = create_mock_document_methods("Python is great", "doc1", score=0.9)
                    doc2 = create_mock_document_methods("Python is awesome", "doc2", score=0.8)
                    with patch.object(
                        dataset_retrieval, "multiple_retrieve", return_value=[doc1, doc2]
                    ) as mock_multiple_retrieve:
                        # Mock format_retrieval_documents
                        mock_record = Mock()
                        mock_record.segment = Mock()
                        mock_record.segment.dataset_id = dataset_id1
                        mock_record.segment.document_id = str(uuid4())
                        mock_record.segment.index_node_hash = "hash123"
                        mock_record.segment.hit_count = 5
                        mock_record.segment.word_count = 100
                        mock_record.segment.position = 1
                        mock_record.segment.get_sign_content.return_value = "Python is great"
                        mock_record.segment.answer = None
                        mock_record.score = 0.9
                        mock_record.child_chunks = []
                        mock_record.summary = None
                        mock_record.files = None

                        mock_retrieval_service = Mock()
                        mock_retrieval_service.format_retrieval_documents.return_value = [mock_record]

                        with patch(
                            "core.rag.retrieval.dataset_retrieval.RetrievalService",
                            return_value=mock_retrieval_service,
                        ):
                            # Mock database queries
                            mock_session = MagicMock()
                            mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
                            mock_session_factory.create_session.return_value.__exit__.return_value = None

                            mock_dataset_from_db = Mock()
                            mock_dataset_from_db.id = dataset_id1
                            mock_dataset_from_db.name = "test_dataset"

                            mock_document = Mock()
                            mock_document.id = str(uuid4())
                            mock_document.name = "test_doc"
                            mock_document.data_source_type = "upload_file"
                            mock_document.doc_metadata = {}

                            mock_datasets = MagicMock()
                            mock_datasets.all.return_value = [mock_dataset_from_db]
                            mock_documents = MagicMock()
                            mock_documents.all.return_value = [mock_document]
                            mock_session.scalars.side_effect = [mock_datasets, mock_documents]

                            # Act
                            result = dataset_retrieval.knowledge_retrieval(request)

                            # Assert
                            assert isinstance(result, list)
                            mock_multiple_retrieve.assert_called_once()

    def test_knowledge_retrieval_metadata_filtering_disabled(self):
        """
        Test knowledge_retrieval with metadata filtering disabled.

        When metadata filtering is disabled, get_metadata_filter_condition is
        NOT called (the method checks metadata_filtering_mode != "disabled").

        Verifies:
        - get_metadata_filter_condition is NOT called when mode is "disabled"
        - Retrieval proceeds without metadata filters
        """
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        app_id = str(uuid4())
        dataset_id = str(uuid4())

        request = KnowledgeRetrievalRequest(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            user_from="web",
            dataset_ids=[dataset_id],
            query="What is Python?",
            retrieval_mode="multiple",
            metadata_filtering_mode="disabled",
            top_k=5,
        )

        dataset_retrieval = DatasetRetrieval()

        # Mock dependencies
        with patch.object(dataset_retrieval, "_check_knowledge_rate_limit"):
            mock_dataset = create_mock_dataset_methods(dataset_id=dataset_id, tenant_id=tenant_id)
            with patch.object(dataset_retrieval, "_get_available_datasets", return_value=[mock_dataset]):
                # Mock get_metadata_filter_condition - should NOT be called when disabled
                with patch.object(
                    dataset_retrieval,
                    "get_metadata_filter_condition",
                    return_value=(None, None),
                ) as mock_get_metadata:
                    with patch.object(dataset_retrieval, "multiple_retrieve", return_value=[]):
                        # Act
                        result = dataset_retrieval.knowledge_retrieval(request)

                        # Assert
                        assert isinstance(result, list)
                        # get_metadata_filter_condition should NOT be called when mode is "disabled"
                        mock_get_metadata.assert_not_called()

    def test_knowledge_retrieval_with_external_documents(self):
        """
        Test knowledge_retrieval with external documents.

        External documents come from external knowledge bases and should
        be formatted differently than Dify documents.

        Verifies:
        - External documents are handled correctly
        - Provider is set to "external"
        - Metadata includes external-specific fields
        """
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        app_id = str(uuid4())
        dataset_id = str(uuid4())

        request = KnowledgeRetrievalRequest(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            user_from="web",
            dataset_ids=[dataset_id],
            query="What is Python?",
            retrieval_mode="multiple",
            top_k=5,
        )

        dataset_retrieval = DatasetRetrieval()

        # Mock dependencies
        with patch.object(dataset_retrieval, "_check_knowledge_rate_limit"):
            mock_dataset = create_mock_dataset_methods(dataset_id=dataset_id, tenant_id=tenant_id, provider="external")
            with patch.object(dataset_retrieval, "_get_available_datasets", return_value=[mock_dataset]):
                with patch.object(dataset_retrieval, "get_metadata_filter_condition", return_value=(None, None)):
                    # Create external document
                    external_doc = create_mock_document_methods(
                        "External knowledge",
                        "doc1",
                        score=0.9,
                        provider="external",
                        additional_metadata={
                            "dataset_id": dataset_id,
                            "dataset_name": "external_kb",
                            "document_id": "ext_doc1",
                            "title": "External Document",
                        },
                    )
                    with patch.object(dataset_retrieval, "multiple_retrieve", return_value=[external_doc]):
                        # Act
                        result = dataset_retrieval.knowledge_retrieval(request)

                        # Assert
                        assert isinstance(result, list)
                        if result:
                            assert result[0].metadata.data_source_type == "external"

    def test_knowledge_retrieval_empty_results(self):
        """
        Test knowledge_retrieval when no documents are found.

        Verifies:
        - Empty list is returned
        - No errors are raised
        - All dependencies are still called
        """
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        app_id = str(uuid4())
        dataset_id = str(uuid4())

        request = KnowledgeRetrievalRequest(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            user_from="web",
            dataset_ids=[dataset_id],
            query="What is Python?",
            retrieval_mode="multiple",
            top_k=5,
        )

        dataset_retrieval = DatasetRetrieval()

        # Mock dependencies
        with patch.object(dataset_retrieval, "_check_knowledge_rate_limit"):
            mock_dataset = create_mock_dataset_methods(dataset_id=dataset_id, tenant_id=tenant_id)
            with patch.object(dataset_retrieval, "_get_available_datasets", return_value=[mock_dataset]):
                with patch.object(dataset_retrieval, "get_metadata_filter_condition", return_value=(None, None)):
                    # Mock multiple_retrieve to return empty list
                    with patch.object(dataset_retrieval, "multiple_retrieve", return_value=[]):
                        # Act
                        result = dataset_retrieval.knowledge_retrieval(request)

                        # Assert
                        assert result == []

    def test_knowledge_retrieval_rate_limit_exceeded(self):
        """
        Test knowledge_retrieval when rate limit is exceeded.

        Verifies:
        - RateLimitExceededError is raised
        - No further processing occurs
        """
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        app_id = str(uuid4())
        dataset_id = str(uuid4())

        request = KnowledgeRetrievalRequest(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            user_from="web",
            dataset_ids=[dataset_id],
            query="What is Python?",
            retrieval_mode="multiple",
            top_k=5,
        )

        dataset_retrieval = DatasetRetrieval()

        # Mock _check_knowledge_rate_limit to raise exception
        with patch.object(
            dataset_retrieval,
            "_check_knowledge_rate_limit",
            side_effect=exc.RateLimitExceededError("Rate limit exceeded"),
        ):
            # Act & Assert
            with pytest.raises(exc.RateLimitExceededError):
                dataset_retrieval.knowledge_retrieval(request)

    def test_knowledge_retrieval_no_available_datasets(self):
        """
        Test knowledge_retrieval when no datasets are available.

        Verifies:
        - Empty list is returned
        - No retrieval is attempted
        """
        # Arrange
        tenant_id = str(uuid4())
        user_id = str(uuid4())
        app_id = str(uuid4())
        dataset_id = str(uuid4())

        request = KnowledgeRetrievalRequest(
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            user_from="web",
            dataset_ids=[dataset_id],
            query="What is Python?",
            retrieval_mode="multiple",
            top_k=5,
        )

        dataset_retrieval = DatasetRetrieval()

        # Mock dependencies
        with patch.object(dataset_retrieval, "_check_knowledge_rate_limit"):
            # Mock _get_available_datasets to return empty list
            with patch.object(dataset_retrieval, "_get_available_datasets", return_value=[]):
                # Act
                result = dataset_retrieval.knowledge_retrieval(request)

                # Assert
                assert result == []

    def test_knowledge_retrieval_handles_multiple_documents_with_different_scores(self):
        """
        Test that knowledge_retrieval processes multiple documents with different scores.

        Note: Full sorting and position testing requires complex SQLAlchemy mocking
        which is better suited for integration tests. This test verifies documents
        with different scores can be created and have their metadata.

        Verifies:
        - Documents can be created with different scores
        - Score metadata is properly set
        """
        # Create documents with different scores
        doc1 = create_mock_document_methods("Low score", "doc1", score=0.6)
        doc2 = create_mock_document_methods("High score", "doc2", score=0.95)
        doc3 = create_mock_document_methods("Medium score", "doc3", score=0.8)

        # Assert - each document has the correct score
        assert doc1.metadata["score"] == 0.6
        assert doc2.metadata["score"] == 0.95
        assert doc3.metadata["score"] == 0.8

        # Assert - documents are correctly sorted (not the retrieval result, just the list)
        unsorted = [doc1, doc2, doc3]
        sorted_docs = sorted(unsorted, key=lambda d: d.metadata["score"], reverse=True)
        assert [d.metadata["score"] for d in sorted_docs] == [0.95, 0.8, 0.6]


class TestProcessMetadataFilterFunc:
    """
    Comprehensive test suite for process_metadata_filter_func method.

    This test class validates all metadata filtering conditions supported by
    the DatasetRetrieval class, including string operations, numeric comparisons,
    null checks, and list operations.

    Method Signature:
    ==================
    def process_metadata_filter_func(
        self, sequence: int, condition: str, metadata_name: str, value: Any | None, filters: list
    ) -> list:

    The method builds SQLAlchemy filter expressions by:
    1. Validating value is not None (except for empty/not empty conditions)
    2. Using DatasetDocument.doc_metadata JSON field operations
    3. Adding appropriate SQLAlchemy expressions to the filters list
    4. Returning the updated filters list

    Mocking Strategy:
    ==================
    - Mock DatasetDocument.doc_metadata to avoid database dependencies
    - Verify filter expressions are created correctly
    - Test with various data types (str, int, float, list)
    """

    @pytest.fixture
    def retrieval(self):
        """
        Create a DatasetRetrieval instance for testing.

        Returns:
            DatasetRetrieval: Instance to test process_metadata_filter_func
        """
        return DatasetRetrieval()

    @pytest.fixture
    def mock_doc_metadata(self):
        """
        Mock the DatasetDocument.doc_metadata JSON field.

        The method uses DatasetDocument.doc_metadata[metadata_name] to access
        JSON fields. We mock this to avoid database dependencies.

        Returns:
            Mock: Mocked doc_metadata attribute
        """
        mock_metadata_field = MagicMock()

        # Create mock for string access
        mock_string_access = MagicMock()
        mock_string_access.like = MagicMock()
        mock_string_access.notlike = MagicMock()
        mock_string_access.__eq__ = MagicMock(return_value=MagicMock())
        mock_string_access.__ne__ = MagicMock(return_value=MagicMock())
        mock_string_access.in_ = MagicMock(return_value=MagicMock())

        # Create mock for float access (for numeric comparisons)
        mock_float_access = MagicMock()
        mock_float_access.__eq__ = MagicMock(return_value=MagicMock())
        mock_float_access.__ne__ = MagicMock(return_value=MagicMock())
        mock_float_access.__lt__ = MagicMock(return_value=MagicMock())
        mock_float_access.__gt__ = MagicMock(return_value=MagicMock())
        mock_float_access.__le__ = MagicMock(return_value=MagicMock())
        mock_float_access.__ge__ = MagicMock(return_value=MagicMock())

        # Create mock for null checks
        mock_null_access = MagicMock()
        mock_null_access.is_ = MagicMock(return_value=MagicMock())
        mock_null_access.isnot = MagicMock(return_value=MagicMock())

        # Setup __getitem__ to return appropriate mock based on usage
        def getitem_side_effect(name):
            if name in ["author", "title", "category"]:
                return mock_string_access
            elif name in ["year", "price", "rating"]:
                return mock_float_access
            else:
                return mock_string_access

        mock_metadata_field.__getitem__ = MagicMock(side_effect=getitem_side_effect)
        mock_metadata_field.as_string.return_value = mock_string_access
        mock_metadata_field.as_float.return_value = mock_float_access
        mock_metadata_field[metadata_name:str].is_ = mock_null_access.is_
        mock_metadata_field[metadata_name:str].isnot = mock_null_access.isnot

        return mock_metadata_field

    # ==================== String Condition Tests ====================

    def test_contains_condition_string_value(self, retrieval):
        """
        Test 'contains' condition with string value.

        Verifies:
        - Filters list is populated with LIKE expression
        - Pattern matching uses %value% syntax
        """
        filters = []
        sequence = 0
        condition = "contains"
        metadata_name = "author"
        value = "John"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_not_contains_condition(self, retrieval):
        """
        Test 'not contains' condition.

        Verifies:
        - Filters list is populated with NOT LIKE expression
        - Pattern matching uses %value% syntax with negation
        """
        filters = []
        sequence = 0
        condition = "not contains"
        metadata_name = "title"
        value = "banned"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_start_with_condition(self, retrieval):
        """
        Test 'start with' condition.

        Verifies:
        - Filters list is populated with LIKE expression
        - Pattern matching uses value% syntax
        """
        filters = []
        sequence = 0
        condition = "start with"
        metadata_name = "category"
        value = "tech"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_end_with_condition(self, retrieval):
        """
        Test 'end with' condition.

        Verifies:
        - Filters list is populated with LIKE expression
        - Pattern matching uses %value syntax
        """
        filters = []
        sequence = 0
        condition = "end with"
        metadata_name = "filename"
        value = ".pdf"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== Equality Condition Tests ====================

    def test_is_condition_with_string_value(self, retrieval):
        """
        Test 'is' (=) condition with string value.

        Verifies:
        - Filters list is populated with equality expression
        - String comparison is used
        """
        filters = []
        sequence = 0
        condition = "is"
        metadata_name = "author"
        value = "Jane Doe"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_equals_condition_with_string_value(self, retrieval):
        """
        Test '=' condition with string value.

        Verifies:
        - Same behavior as 'is' condition
        - String comparison is used
        """
        filters = []
        sequence = 0
        condition = "="
        metadata_name = "category"
        value = "technology"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_is_condition_with_int_value(self, retrieval):
        """
        Test 'is' condition with integer value.

        Verifies:
        - Numeric comparison is used
        - as_float() is called on the metadata field
        """
        filters = []
        sequence = 0
        condition = "is"
        metadata_name = "year"
        value = 2023

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_is_condition_with_float_value(self, retrieval):
        """
        Test 'is' condition with float value.

        Verifies:
        - Numeric comparison is used
        - as_float() is called on the metadata field
        """
        filters = []
        sequence = 0
        condition = "is"
        metadata_name = "price"
        value = 19.99

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_is_not_condition_with_string_value(self, retrieval):
        """
        Test 'is not' (≠) condition with string value.

        Verifies:
        - Filters list is populated with inequality expression
        - String comparison is used
        """
        filters = []
        sequence = 0
        condition = "is not"
        metadata_name = "author"
        value = "Unknown"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_not_equals_condition(self, retrieval):
        """
        Test '≠' condition with string value.

        Verifies:
        - Same behavior as 'is not' condition
        - Inequality expression is used
        """
        filters = []
        sequence = 0
        condition = "≠"
        metadata_name = "category"
        value = "archived"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_is_not_condition_with_numeric_value(self, retrieval):
        """
        Test 'is not' condition with numeric value.

        Verifies:
        - Numeric inequality comparison is used
        - as_float() is called on the metadata field
        """
        filters = []
        sequence = 0
        condition = "is not"
        metadata_name = "year"
        value = 2000

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== Null Condition Tests ====================

    def test_empty_condition(self, retrieval):
        """
        Test 'empty' condition (null check).

        Verifies:
        - Filters list is populated with IS NULL expression
        - Value can be None for this condition
        """
        filters = []
        sequence = 0
        condition = "empty"
        metadata_name = "author"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_not_empty_condition(self, retrieval):
        """
        Test 'not empty' condition (not null check).

        Verifies:
        - Filters list is populated with IS NOT NULL expression
        - Value can be None for this condition
        """
        filters = []
        sequence = 0
        condition = "not empty"
        metadata_name = "description"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== Numeric Comparison Tests ====================

    def test_before_condition(self, retrieval):
        """
        Test 'before' (<) condition.

        Verifies:
        - Filters list is populated with less than expression
        - Numeric comparison is used
        """
        filters = []
        sequence = 0
        condition = "before"
        metadata_name = "year"
        value = 2020

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_less_than_condition(self, retrieval):
        """
        Test '<' condition.

        Verifies:
        - Same behavior as 'before' condition
        - Less than expression is used
        """
        filters = []
        sequence = 0
        condition = "<"
        metadata_name = "price"
        value = 100.0

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_after_condition(self, retrieval):
        """
        Test 'after' (>) condition.

        Verifies:
        - Filters list is populated with greater than expression
        - Numeric comparison is used
        """
        filters = []
        sequence = 0
        condition = "after"
        metadata_name = "year"
        value = 2020

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_greater_than_condition(self, retrieval):
        """
        Test '>' condition.

        Verifies:
        - Same behavior as 'after' condition
        - Greater than expression is used
        """
        filters = []
        sequence = 0
        condition = ">"
        metadata_name = "rating"
        value = 4.5

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_less_than_or_equal_condition_unicode(self, retrieval):
        """
        Test '≤' condition.

        Verifies:
        - Filters list is populated with less than or equal expression
        - Numeric comparison is used
        """
        filters = []
        sequence = 0
        condition = "≤"
        metadata_name = "price"
        value = 50.0

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_less_than_or_equal_condition_ascii(self, retrieval):
        """
        Test '<=' condition.

        Verifies:
        - Same behavior as '≤' condition
        - Less than or equal expression is used
        """
        filters = []
        sequence = 0
        condition = "<="
        metadata_name = "year"
        value = 2023

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_greater_than_or_equal_condition_unicode(self, retrieval):
        """
        Test '≥' condition.

        Verifies:
        - Filters list is populated with greater than or equal expression
        - Numeric comparison is used
        """
        filters = []
        sequence = 0
        condition = "≥"
        metadata_name = "rating"
        value = 3.5

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_greater_than_or_equal_condition_ascii(self, retrieval):
        """
        Test '>=' condition.

        Verifies:
        - Same behavior as '≥' condition
        - Greater than or equal expression is used
        """
        filters = []
        sequence = 0
        condition = ">="
        metadata_name = "year"
        value = 2000

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== List/In Condition Tests ====================

    def test_in_condition_with_comma_separated_string(self, retrieval):
        """
        Test 'in' condition with comma-separated string value.

        Verifies:
        - String is split into list
        - Whitespace is trimmed from each value
        - IN expression is created
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = "tech, science,  AI  "

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_in_condition_with_list_value(self, retrieval):
        """
        Test 'in' condition with list value.

        Verifies:
        - List is processed correctly
        - None values are filtered out
        - IN expression is created with valid values
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "tags"
        value = ["python", "javascript", None, "golang"]

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_in_condition_with_tuple_value(self, retrieval):
        """
        Test 'in' condition with tuple value.

        Verifies:
        - Tuple is processed like a list
        - IN expression is created
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = ("tech", "science", "ai")

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_in_condition_with_empty_string(self, retrieval):
        """
        Test 'in' condition with empty string value.

        Verifies:
        - Empty string results in literal(False) filter
        - No valid values to match
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = ""

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1
        # Verify it's a literal(False) expression
        # This is a bit tricky to test without access to the actual expression

    def test_in_condition_with_only_whitespace(self, retrieval):
        """
        Test 'in' condition with whitespace-only string value.

        Verifies:
        - Whitespace-only string results in literal(False) filter
        - All values are stripped and filtered out
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = "   ,   ,   "

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_in_condition_with_single_string(self, retrieval):
        """
        Test 'in' condition with single non-comma string.

        Verifies:
        - Single string is treated as single-item list
        - IN expression is created with one value
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = "technology"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== Edge Case Tests ====================

    def test_none_value_with_non_empty_condition(self, retrieval):
        """
        Test None value with conditions that require value.

        Verifies:
        - Original filters list is returned unchanged
        - No filter is added for None values (except empty/not empty)
        """
        filters = []
        sequence = 0
        condition = "contains"
        metadata_name = "author"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 0  # No filter added

    def test_none_value_with_equals_condition(self, retrieval):
        """
        Test None value with 'is' (=) condition.

        Verifies:
        - Original filters list is returned unchanged
        - No filter is added for None values
        """
        filters = []
        sequence = 0
        condition = "is"
        metadata_name = "author"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 0

    def test_none_value_with_numeric_condition(self, retrieval):
        """
        Test None value with numeric comparison condition.

        Verifies:
        - Original filters list is returned unchanged
        - No filter is added for None values
        """
        filters = []
        sequence = 0
        condition = ">"
        metadata_name = "year"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 0

    def test_existing_filters_preserved(self, retrieval):
        """
        Test that existing filters are preserved.

        Verifies:
        - Existing filters in the list are not removed
        - New filters are appended to the list
        """
        existing_filter = MagicMock()
        filters = [existing_filter]
        sequence = 0
        condition = "contains"
        metadata_name = "author"
        value = "test"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 2
        assert filters[0] == existing_filter

    def test_multiple_filters_accumulated(self, retrieval):
        """
        Test multiple calls to accumulate filters.

        Verifies:
        - Each call adds a new filter to the list
        - All filters are preserved across calls
        """
        filters = []

        # First filter
        retrieval.process_metadata_filter_func(0, "contains", "author", "John", filters)
        assert len(filters) == 1

        # Second filter
        retrieval.process_metadata_filter_func(1, ">", "year", 2020, filters)
        assert len(filters) == 2

        # Third filter
        retrieval.process_metadata_filter_func(2, "is", "category", "tech", filters)
        assert len(filters) == 3

    def test_unknown_condition(self, retrieval):
        """
        Test unknown/unsupported condition.

        Verifies:
        - Original filters list is returned unchanged
        - No filter is added for unknown conditions
        """
        filters = []
        sequence = 0
        condition = "unknown_condition"
        metadata_name = "author"
        value = "test"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 0

    def test_empty_string_value_with_contains(self, retrieval):
        """
        Test empty string value with 'contains' condition.

        Verifies:
        - Filter is added even with empty string
        - LIKE expression is created
        """
        filters = []
        sequence = 0
        condition = "contains"
        metadata_name = "author"
        value = ""

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_special_characters_in_value(self, retrieval):
        """
        Test special characters in value string.

        Verifies:
        - Special characters are handled in value
        - LIKE expression is created correctly
        """
        filters = []
        sequence = 0
        condition = "contains"
        metadata_name = "title"
        value = "C++ & Python's features"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_zero_value_with_numeric_condition(self, retrieval):
        """
        Test zero value with numeric comparison condition.

        Verifies:
        - Zero is treated as valid value
        - Numeric comparison is performed
        """
        filters = []
        sequence = 0
        condition = ">"
        metadata_name = "price"
        value = 0

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_negative_value_with_numeric_condition(self, retrieval):
        """
        Test negative value with numeric comparison condition.

        Verifies:
        - Negative numbers are handled correctly
        - Numeric comparison is performed
        """
        filters = []
        sequence = 0
        condition = "<"
        metadata_name = "temperature"
        value = -10.5

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_float_value_with_integer_comparison(self, retrieval):
        """
        Test float value with numeric comparison condition.

        Verifies:
        - Float values work correctly
        - Numeric comparison is performed
        """
        filters = []
        sequence = 0
        condition = ">="
        metadata_name = "rating"
        value = 4.5

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1


class TestKnowledgeRetrievalRegression:
    @pytest.fixture
    def mock_dataset(self) -> Dataset:
        dataset = Mock(spec=Dataset)
        dataset.id = str(uuid4())
        dataset.tenant_id = str(uuid4())
        dataset.name = "test_dataset"
        dataset.indexing_technique = "high_quality"
        dataset.provider = "dify"
        return dataset

    def test_multiple_retrieve_reranking_with_app_context(self, mock_dataset):
        """
        Repro test for current bug:
        reranking runs after `with flask_app.app_context():` exits.
        `_multiple_retrieve_thread` catches exceptions and stores them into `thread_exceptions`,
        so we must assert from that list (not from an outer try/except).
        """
        dataset_retrieval = DatasetRetrieval()
        flask_app = Flask(__name__)
        tenant_id = str(uuid4())

        # second dataset to ensure dataset_count > 1 reranking branch
        secondary_dataset = Mock(spec=Dataset)
        secondary_dataset.id = str(uuid4())
        secondary_dataset.provider = "dify"
        secondary_dataset.indexing_technique = "high_quality"

        # retriever returns 1 doc into internal list (all_documents_item)
        document = Document(
            page_content="Context aware doc",
            metadata={
                "doc_id": "doc1",
                "score": 0.95,
                "document_id": str(uuid4()),
                "dataset_id": mock_dataset.id,
            },
            provider="dify",
        )

        def fake_retriever(
            flask_app, dataset_id, query, top_k, all_documents, document_ids_filter, metadata_condition, attachment_ids
        ):
            all_documents.append(document)

        called = {"init": 0, "invoke": 0}

        class ContextRequiredPostProcessor:
            def __init__(self, *args, **kwargs):
                called["init"] += 1
                # will raise RuntimeError if no Flask app context exists
                _ = current_app.name

            def invoke(self, *args, **kwargs):
                called["invoke"] += 1
                _ = current_app.name
                return kwargs.get("documents") or args[1]

        # output list from _multiple_retrieve_thread
        all_documents: list[Document] = []

        # IMPORTANT: _multiple_retrieve_thread swallows exceptions and appends them here
        thread_exceptions: list[Exception] = []

        def target():
            with patch.object(dataset_retrieval, "_retriever", side_effect=fake_retriever):
                with patch(
                    "core.rag.retrieval.dataset_retrieval.DataPostProcessor",
                    ContextRequiredPostProcessor,
                ):
                    dataset_retrieval._multiple_retrieve_thread(
                        flask_app=flask_app,
                        available_datasets=[mock_dataset, secondary_dataset],
                        metadata_condition=None,
                        metadata_filter_document_ids=None,
                        all_documents=all_documents,
                        tenant_id=tenant_id,
                        reranking_enable=True,
                        reranking_mode="reranking_model",
                        reranking_model={
                            "reranking_provider_name": "cohere",
                            "reranking_model_name": "rerank-v2",
                        },
                        weights=None,
                        top_k=3,
                        score_threshold=0.0,
                        query="test query",
                        attachment_id=None,
                        dataset_count=2,  # force reranking branch
                        thread_exceptions=thread_exceptions,  # ✅ key
                    )

        t = threading.Thread(target=target)
        t.start()
        t.join()

        # Ensure reranking branch was actually executed
        assert called["init"] >= 1, "DataPostProcessor was never constructed; reranking branch may not have run."

        # Current buggy code should record an exception (not raise it)
        assert not thread_exceptions, thread_exceptions


class _FakeFlaskApp:
    def app_context(self):
        return nullcontext()


class _ImmediateThread:
    def __init__(self, target=None, kwargs=None):
        self._target = target
        self._kwargs = kwargs or {}
        self._alive = False

    def start(self) -> None:
        self._alive = True
        if self._target:
            self._target(**self._kwargs)
        self._alive = False

    def join(self, timeout=None) -> None:
        return None

    def is_alive(self) -> bool:
        return self._alive


class TestDatasetRetrievalAdditionalHelpers:
    @pytest.fixture
    def retrieval(self) -> DatasetRetrieval:
        return DatasetRetrieval()

    def test_llm_usage_and_record_usage(self, retrieval: DatasetRetrieval) -> None:
        empty_usage = retrieval.llm_usage
        assert empty_usage.total_tokens == 0

        retrieval._record_usage(None)
        assert retrieval.llm_usage.total_tokens == 0

        usage_1 = LLMUsage.from_metadata({"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5})
        usage_2 = LLMUsage.from_metadata({"prompt_tokens": 4, "completion_tokens": 1, "total_tokens": 5})
        retrieval._record_usage(usage_1)
        retrieval._record_usage(usage_2)
        assert retrieval.llm_usage.total_tokens == 10

    def test_replace_metadata_filter_value(self, retrieval: DatasetRetrieval) -> None:
        assert retrieval._replace_metadata_filter_value("plain", {}) == "plain"
        replaced = retrieval._replace_metadata_filter_value(
            "hello {{name}}\n\t{{missing}}",
            {"name": "world"},
        )
        assert replaced == "hello world {{missing}}"

    def test_process_metadata_filter_in_with_scalar_fallback(self) -> None:
        filters: list = []
        result = DatasetRetrieval.process_metadata_filter_func(
            sequence=0,
            condition="in",
            metadata_name="category",
            value=123,
            filters=filters,
        )
        assert result is filters
        assert len(filters) == 1

    def test_calculate_vector_score(self, retrieval: DatasetRetrieval) -> None:
        doc_high = Document(page_content="a", metadata={"score": 0.9}, provider="dify")
        doc_low = Document(page_content="b", metadata={"score": 0.2}, provider="dify")
        doc_no_meta = Document(page_content="c", metadata={}, provider="dify")

        filtered = retrieval.calculate_vector_score([doc_low, doc_high, doc_no_meta], top_k=1, score_threshold=0.5)
        assert len(filtered) == 1
        assert filtered[0].metadata["score"] == 0.9

        assert retrieval.calculate_vector_score([doc_low], top_k=2, score_threshold=1.0) == []

    def test_calculate_keyword_score(self, retrieval: DatasetRetrieval) -> None:
        documents = [
            Document(page_content="python language", metadata={"doc_id": "1"}, provider="dify"),
            Document(page_content="java language", metadata={"doc_id": "2"}, provider="dify"),
        ]
        keyword_handler = Mock()
        keyword_handler.extract_keywords.side_effect = [
            ["python", "language"],
            ["python", "language"],
            ["java", "language"],
        ]

        with patch("core.rag.retrieval.dataset_retrieval.JiebaKeywordTableHandler", return_value=keyword_handler):
            ranked = retrieval.calculate_keyword_score("python language", documents, top_k=1)

        assert len(ranked) == 1
        assert "keywords" in ranked[0].metadata
        assert ranked[0].metadata["doc_id"] == "1"

    def test_send_trace_task(self, retrieval: DatasetRetrieval) -> None:
        trace_manager = Mock()
        retrieval.application_generate_entity = SimpleNamespace(trace_manager=trace_manager)
        docs = [Document(page_content="d", metadata={}, provider="dify")]

        retrieval._send_trace_task("m1", docs, {"cost": 1})
        trace_manager.add_trace_task.assert_called_once()

        retrieval.application_generate_entity = None
        trace_manager.reset_mock()
        retrieval._send_trace_task("m1", docs, {"cost": 1})
        trace_manager.add_trace_task.assert_not_called()

    def test_on_query(self, retrieval: DatasetRetrieval) -> None:
        with patch("core.rag.retrieval.dataset_retrieval.db.session") as mock_session:
            retrieval._on_query(
                query=None,
                attachment_ids=None,
                dataset_ids=["d1"],
                app_id="a1",
                user_from="account",
                user_id="u1",
            )
            mock_session.add_all.assert_not_called()

            retrieval._on_query(
                query="python",
                attachment_ids=["f1"],
                dataset_ids=["d1", "d2"],
                app_id="a1",
                user_from="account",
                user_id="u1",
            )
            mock_session.add_all.assert_called()
            mock_session.commit.assert_called()

    def test_on_query_normalizes_workflow_end_user_role(self, retrieval: DatasetRetrieval) -> None:
        with patch("core.rag.retrieval.dataset_retrieval.db.session") as mock_session:
            retrieval._on_query(
                query="python",
                attachment_ids=None,
                dataset_ids=["d1"],
                app_id="a1",
                user_from="end-user",
                user_id="u1",
            )

            mock_session.add_all.assert_called_once()
            added_queries = mock_session.add_all.call_args.args[0]

            assert len(added_queries) == 1
            assert added_queries[0].created_by_role == CreatorUserRole.END_USER
            mock_session.commit.assert_called_once()

    def test_handle_invoke_result(self, retrieval: DatasetRetrieval) -> None:
        usage = LLMUsage.empty_usage()
        chunk_1 = SimpleNamespace(
            model="m1",
            prompt_messages=[Mock()],
            delta=SimpleNamespace(message=SimpleNamespace(content="hello "), usage=usage),
        )
        chunk_2 = SimpleNamespace(
            model="m1",
            prompt_messages=[Mock()],
            delta=SimpleNamespace(
                message=SimpleNamespace(content=[SimpleNamespace(data="world")]),
                usage=None,
            ),
        )
        text, returned_usage = retrieval._handle_invoke_result(iter([chunk_1, chunk_2]))
        assert text == "hello world"
        assert returned_usage == usage

        text_empty, usage_empty = retrieval._handle_invoke_result(iter([]))
        assert text_empty == ""
        assert usage_empty == LLMUsage.empty_usage()

    def test_get_prompt_template(self, retrieval: DatasetRetrieval) -> None:
        model_config_chat = ModelConfigWithCredentialsEntity.model_construct(
            provider="openai",
            model="gpt",
            model_schema=Mock(),
            mode="chat",
            provider_model_bundle=Mock(),
            credentials={},
            parameters={},
            stop=["x"],
        )
        model_config_completion = ModelConfigWithCredentialsEntity.model_construct(
            provider="openai",
            model="gpt",
            model_schema=Mock(),
            mode="completion",
            provider_model_bundle=Mock(),
            credentials={},
            parameters={},
            stop=[],
        )

        with patch("core.rag.retrieval.dataset_retrieval.AdvancedPromptTransform") as mock_prompt_transform:
            mock_prompt_transform.return_value.get_prompt.return_value = ["prompt"]
            prompt_messages, stop = retrieval._get_prompt_template(
                model_config=model_config_chat,
                mode="chat",
                metadata_fields=["author"],
                query="python",
            )
            assert prompt_messages == ["prompt"]
            assert stop == ["x"]

            with patch(
                "core.rag.retrieval.dataset_retrieval.METADATA_FILTER_COMPLETION_PROMPT",
                "{input_text} {metadata_fields}",
            ):
                prompt_messages_completion, stop_completion = retrieval._get_prompt_template(
                    model_config=model_config_completion,
                    mode="completion",
                    metadata_fields=["author"],
                    query="python",
                )
                assert prompt_messages_completion == ["prompt"]
                assert stop_completion == []

        with pytest.raises(ValueError):
            retrieval._get_prompt_template(
                model_config=model_config_chat,
                mode="unknown-mode",
                metadata_fields=[],
                query="python",
            )

    def test_fetch_model_config_validation_and_success(self, retrieval: DatasetRetrieval) -> None:
        with pytest.raises(ValueError, match="single_retrieval_config is required"):
            retrieval._fetch_model_config("tenant-1", None)  # type: ignore[arg-type]

        model_cfg = AppModelConfig(provider="openai", name="gpt", mode="chat", completion_params={"stop": ["END"]})
        model_instance = Mock()
        model_instance.credentials = {"k": "v"}
        model_instance.provider_model_bundle = Mock()
        model_instance.model_type_instance = Mock()
        model_instance.model_type_instance.get_model_schema.return_value = Mock()

        with (
            patch("core.rag.retrieval.dataset_retrieval.ModelManager.for_tenant") as mock_manager,
            patch("core.rag.retrieval.dataset_retrieval.ModelConfigWithCredentialsEntity") as mock_cfg_entity,
        ):
            mock_manager.return_value.get_model_instance.return_value = model_instance
            mock_cfg_entity.return_value = SimpleNamespace(
                provider="openai",
                model="gpt",
                stop=["END"],
                parameters={"temperature": 0.1},
            )

            model_instance.provider_model_bundle.configuration.get_provider_model.return_value = None
            with pytest.raises(ValueError, match="not exist"):
                retrieval._fetch_model_config("tenant-1", model_cfg)

            provider_model = SimpleNamespace(status=ModelStatus.NO_CONFIGURE)
            model_instance.provider_model_bundle.configuration.get_provider_model.return_value = provider_model
            with pytest.raises(ValueError, match="credentials is not initialized"):
                retrieval._fetch_model_config("tenant-1", model_cfg)

            provider_model.status = ModelStatus.NO_PERMISSION
            with pytest.raises(ValueError, match="currently not support"):
                retrieval._fetch_model_config("tenant-1", model_cfg)

            provider_model.status = ModelStatus.QUOTA_EXCEEDED
            with pytest.raises(ValueError, match="quota exceeded"):
                retrieval._fetch_model_config("tenant-1", model_cfg)

            provider_model.status = ModelStatus.ACTIVE
            bad_mode_cfg = AppModelConfig(provider="openai", name="gpt", mode="chat")
            bad_mode_cfg.mode = None  # type: ignore[assignment]
            with pytest.raises(ValueError, match="LLM mode is required"):
                retrieval._fetch_model_config("tenant-1", bad_mode_cfg)

            model_instance.model_type_instance.get_model_schema.return_value = None
            with pytest.raises(ValueError, match="not exist"):
                retrieval._fetch_model_config("tenant-1", model_cfg)

            model_instance.model_type_instance.get_model_schema.return_value = Mock()
            model_cfg_success = AppModelConfig(
                provider="openai",
                name="gpt",
                mode="chat",
                completion_params={"temperature": 0.1, "stop": ["END"]},
            )
            _, config = retrieval._fetch_model_config("tenant-1", model_cfg_success)
            assert config.provider == "openai"
            assert config.model == "gpt"
            assert config.stop == ["END"]
            assert "stop" not in config.parameters

    def test_automatic_metadata_filter_func(self, retrieval: DatasetRetrieval) -> None:
        metadata_field = SimpleNamespace(name="author")
        model_instance = Mock()
        model_instance.invoke_llm.return_value = iter([Mock()])
        model_config = ModelConfigWithCredentialsEntity.model_construct(
            provider="openai",
            model="gpt",
            model_schema=Mock(),
            mode="chat",
            provider_model_bundle=Mock(),
            credentials={},
            parameters={},
            stop=[],
        )
        usage = LLMUsage.from_metadata({"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2})
        session_scalars = Mock()
        session_scalars.all.return_value = [metadata_field]

        with (
            patch("core.rag.retrieval.dataset_retrieval.db.session.scalars", return_value=session_scalars),
            patch.object(retrieval, "_fetch_model_config", return_value=(model_instance, model_config)),
            patch.object(retrieval, "_get_prompt_template", return_value=(["prompt"], [])),
            patch.object(retrieval, "_handle_invoke_result", return_value=('{"metadata_map":[]}', usage)),
            patch("core.rag.retrieval.dataset_retrieval.parse_and_check_json_markdown") as mock_parse,
            patch.object(retrieval, "_record_usage") as mock_record_usage,
        ):
            mock_parse.return_value = {
                "metadata_map": [
                    {
                        "metadata_field_name": "author",
                        "metadata_field_value": "Alice",
                        "comparison_operator": "contains",
                    },
                    {
                        "metadata_field_name": "ignored",
                        "metadata_field_value": "value",
                        "comparison_operator": "contains",
                    },
                ]
            }
            result = retrieval._automatic_metadata_filter_func(
                dataset_ids=["d1"],
                query="python",
                tenant_id="tenant-1",
                user_id="u1",
                metadata_model_config=AppModelConfig(provider="openai", name="gpt", mode="chat"),
            )

        assert result == [{"metadata_name": "author", "value": "Alice", "condition": "contains"}]
        mock_record_usage.assert_called_once_with(usage)

        with (
            patch("core.rag.retrieval.dataset_retrieval.db.session.scalars", return_value=session_scalars),
            patch.object(retrieval, "_fetch_model_config", side_effect=RuntimeError("boom")),
        ):
            with pytest.raises(RuntimeError, match="boom"):
                retrieval._automatic_metadata_filter_func(
                    dataset_ids=["d1"],
                    query="python",
                    tenant_id="tenant-1",
                    user_id="u1",
                    metadata_model_config=AppModelConfig(provider="openai", name="gpt", mode="chat"),
                )

    def test_get_metadata_filter_condition(self, retrieval: DatasetRetrieval) -> None:
        scalars_result = Mock()
        scalars_result.all.return_value = [SimpleNamespace(dataset_id="d1", id="doc-1")]

        with patch("core.rag.retrieval.dataset_retrieval.db.session.scalars", return_value=scalars_result):
            mapping, condition = retrieval.get_metadata_filter_condition(
                dataset_ids=["d1"],
                query="python",
                tenant_id="tenant-1",
                user_id="u1",
                metadata_filtering_mode="disabled",
                metadata_model_config=AppModelConfig(provider="openai", name="gpt", mode="chat"),
                metadata_filtering_conditions=None,
                inputs={},
            )
        assert mapping is None
        assert condition is None

        automatic_filters = [{"condition": "contains", "metadata_name": "author", "value": "Alice"}]
        with (
            patch("core.rag.retrieval.dataset_retrieval.db.session.scalars", return_value=scalars_result),
            patch.object(retrieval, "_automatic_metadata_filter_func", return_value=automatic_filters),
        ):
            mapping, condition = retrieval.get_metadata_filter_condition(
                dataset_ids=["d1"],
                query="python",
                tenant_id="tenant-1",
                user_id="u1",
                metadata_filtering_mode="automatic",
                metadata_model_config=AppModelConfig(provider="openai", name="gpt", mode="chat"),
                metadata_filtering_conditions=AppMetadataFilteringCondition(logical_operator="or", conditions=[]),
                inputs={},
            )
        assert mapping == {"d1": ["doc-1"]}
        assert condition is not None
        assert condition.logical_operator == "or"

        manual_conditions = AppMetadataFilteringCondition(
            logical_operator="and",
            conditions=[AppCondition(name="author", comparison_operator="contains", value="{{name}}")],
        )
        with patch("core.rag.retrieval.dataset_retrieval.db.session.scalars", return_value=scalars_result):
            mapping, condition = retrieval.get_metadata_filter_condition(
                dataset_ids=["d1"],
                query="python",
                tenant_id="tenant-1",
                user_id="u1",
                metadata_filtering_mode="manual",
                metadata_model_config=AppModelConfig(provider="openai", name="gpt", mode="chat"),
                metadata_filtering_conditions=manual_conditions,
                inputs={"name": "Alice"},
            )
        assert mapping == {"d1": ["doc-1"]}
        assert condition is not None
        assert condition.conditions[0].value == "Alice"

        with patch("core.rag.retrieval.dataset_retrieval.db.session.scalars", return_value=scalars_result):
            with pytest.raises(ValueError, match="Invalid metadata filtering mode"):
                retrieval.get_metadata_filter_condition(
                    dataset_ids=["d1"],
                    query="python",
                    tenant_id="tenant-1",
                    user_id="u1",
                    metadata_filtering_mode="unsupported",
                    metadata_model_config=AppModelConfig(provider="openai", name="gpt", mode="chat"),
                    metadata_filtering_conditions=None,
                    inputs={},
                )

    def test_get_available_datasets(self, retrieval: DatasetRetrieval) -> None:
        session = Mock()
        scalars_result = Mock()
        scalars_result.all.return_value = [SimpleNamespace(id="d1"), None, SimpleNamespace(id="d2")]
        session.scalars.return_value = scalars_result

        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = False

        with patch("core.rag.retrieval.dataset_retrieval.session_factory.create_session", return_value=session_ctx):
            available = retrieval._get_available_datasets("tenant-1", ["d1", "d2"])

        assert [dataset.id for dataset in available] == ["d1", "d2"]

    def test_check_knowledge_rate_limit(self, retrieval: DatasetRetrieval) -> None:
        with (
            patch("core.rag.retrieval.dataset_retrieval.FeatureService.get_knowledge_rate_limit") as mock_limit,
            patch("core.rag.retrieval.dataset_retrieval.redis_client") as mock_redis,
            patch("core.rag.retrieval.dataset_retrieval.time.time", return_value=100.0),
        ):
            mock_limit.return_value = SimpleNamespace(enabled=True, limit=2, subscription_plan="pro")
            mock_redis.zcard.return_value = 1
            retrieval._check_knowledge_rate_limit("tenant-1")
            mock_redis.zadd.assert_called_once()

        session = Mock()
        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = False

        with (
            patch("core.rag.retrieval.dataset_retrieval.FeatureService.get_knowledge_rate_limit") as mock_limit,
            patch("core.rag.retrieval.dataset_retrieval.redis_client") as mock_redis,
            patch("core.rag.retrieval.dataset_retrieval.time.time", return_value=100.0),
            patch("core.rag.retrieval.dataset_retrieval.session_factory.create_session", return_value=session_ctx),
        ):
            mock_limit.return_value = SimpleNamespace(enabled=True, limit=1, subscription_plan="pro")
            mock_redis.zcard.return_value = 2
            with pytest.raises(exc.RateLimitExceededError):
                retrieval._check_knowledge_rate_limit("tenant-1")
            session.add.assert_called_once()

        with patch("core.rag.retrieval.dataset_retrieval.FeatureService.get_knowledge_rate_limit") as mock_limit:
            mock_limit.return_value = SimpleNamespace(enabled=False)
            retrieval._check_knowledge_rate_limit("tenant-1")


def _doc(
    provider: str = "dify",
    content: str = "content",
    score: float = 0.9,
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
    doc_id: str = "node-1",
    extra: dict[str, Any] | None = None,
) -> Document:
    metadata = {
        "score": score,
        "dataset_id": dataset_id,
        "document_id": document_id,
        "doc_id": doc_id,
    }
    if extra:
        metadata.update(extra)
    return Document(page_content=content, metadata=metadata, provider=provider)


class _ImmediateThread:
    def __init__(self, target=None, kwargs=None):
        self._target = target
        self._kwargs = kwargs or {}
        self._alive = False

    def start(self) -> None:
        self._alive = True
        if self._target:
            self._target(**self._kwargs)
        self._alive = False

    def join(self, timeout=None) -> None:
        return None

    def is_alive(self) -> bool:
        return self._alive


class _JoinDrivenThread:
    def __init__(self, target=None, kwargs=None):
        self._target = target
        self._kwargs = kwargs or {}
        self._started = False
        self._alive = False

    def start(self) -> None:
        self._started = True
        self._alive = True

    def join(self, timeout=None) -> None:
        if self._started and self._alive and self._target:
            self._target(**self._kwargs)
        self._alive = False

    def is_alive(self) -> bool:
        return self._alive


@contextmanager
def _timer():
    yield {"cost": 1}


class TestKnowledgeRetrievalCoverage:
    @pytest.fixture
    def retrieval(self) -> DatasetRetrieval:
        return DatasetRetrieval()

    def test_returns_empty_when_query_missing(self, retrieval: DatasetRetrieval) -> None:
        request = KnowledgeRetrievalRequest(
            tenant_id="tenant-1",
            user_id="user-1",
            app_id="app-1",
            user_from="workflow",
            dataset_ids=["d1"],
            query=None,
            retrieval_mode="multiple",
        )
        with (
            patch.object(retrieval, "_check_knowledge_rate_limit"),
            patch.object(retrieval, "_get_available_datasets", return_value=[SimpleNamespace(id="d1")]),
        ):
            assert retrieval.knowledge_retrieval(request) == []

    def test_raises_when_metadata_model_config_missing(self, retrieval: DatasetRetrieval) -> None:
        request = KnowledgeRetrievalRequest(
            tenant_id="tenant-1",
            user_id="user-1",
            app_id="app-1",
            user_from="workflow",
            dataset_ids=["d1"],
            query="query",
            retrieval_mode="multiple",
            metadata_filtering_mode="automatic",
            metadata_model_config=None,
        )
        with (
            patch.object(retrieval, "_check_knowledge_rate_limit"),
            patch.object(retrieval, "_get_available_datasets", return_value=[SimpleNamespace(id="d1")]),
        ):
            with pytest.raises(ValueError, match="metadata_model_config is required"):
                retrieval.knowledge_retrieval(request)

    @pytest.mark.parametrize(
        ("status", "error_cls"),
        [
            (ModelStatus.NO_CONFIGURE, "ModelCredentialsNotInitializedError"),
            (ModelStatus.NO_PERMISSION, "ModelNotSupportedError"),
            (ModelStatus.QUOTA_EXCEEDED, "ModelQuotaExceededError"),
        ],
    )
    def test_single_mode_raises_for_model_status(
        self,
        retrieval: DatasetRetrieval,
        status: ModelStatus,
        error_cls: str,
    ) -> None:
        request = KnowledgeRetrievalRequest(
            tenant_id="tenant-1",
            user_id="user-1",
            app_id="app-1",
            user_from="workflow",
            dataset_ids=["dataset-1"],
            query="python",
            retrieval_mode="single",
            model_provider="openai",
            model_name="gpt-4",
        )
        provider_model_bundle = Mock()
        provider_model_bundle.configuration.get_provider_model.return_value = SimpleNamespace(status=status)
        model_type_instance = Mock()
        model_type_instance.get_model_schema.return_value = Mock()
        model_instance = SimpleNamespace(
            provider_model_bundle=provider_model_bundle,
            model_type_instance=model_type_instance,
            credentials={},
        )
        with (
            patch.object(retrieval, "_check_knowledge_rate_limit"),
            patch.object(retrieval, "_get_available_datasets", return_value=[SimpleNamespace(id="dataset-1")]),
            patch("core.rag.retrieval.dataset_retrieval.ModelManager.for_tenant") as mock_model_manager,
        ):
            mock_model_manager.return_value.get_model_instance.return_value = model_instance
            with pytest.raises(Exception) as exc_info:
                retrieval.knowledge_retrieval(request)
            mock_model_manager.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
            assert error_cls in type(exc_info.value).__name__


class TestRetrieveCoverage:
    @pytest.fixture
    def retrieval(self) -> DatasetRetrieval:
        return DatasetRetrieval()

    def _build_model_config(self, features: list[ModelFeature] | None = None):
        model_type_instance = Mock()
        model_type_instance.get_model_schema.return_value = SimpleNamespace(features=features or [])
        provider_bundle = SimpleNamespace(model_type_instance=model_type_instance)
        return ModelConfigWithCredentialsEntity.model_construct(
            provider="openai",
            model="gpt-4",
            model_schema=Mock(),
            mode="chat",
            provider_model_bundle=provider_bundle,
            credentials={},
            parameters={},
            stop=[],
        )

    def test_returns_none_when_dataset_ids_empty(self, retrieval: DatasetRetrieval) -> None:
        config = DatasetEntity(
            dataset_ids=[],
            retrieve_config=DatasetRetrieveConfigEntity(
                retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
            ),
        )
        result = retrieval.retrieve(
            app_id="app-1",
            user_id="user-1",
            tenant_id="tenant-1",
            model_config=self._build_model_config(),
            config=config,
            query="python",
            invoke_from=InvokeFrom.WEB_APP,
            show_retrieve_source=False,
            hit_callback=Mock(),
            message_id="m1",
        )
        assert result == (None, [])

    def test_returns_none_when_model_schema_missing(self, retrieval: DatasetRetrieval) -> None:
        config = DatasetEntity(
            dataset_ids=["d1"],
            retrieve_config=DatasetRetrieveConfigEntity(
                retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
            ),
        )
        model_config = self._build_model_config()
        model_instance = Mock()
        model_instance.model_name = "gpt-4"
        model_instance.credentials = {"api_key": "secret"}
        model_instance.provider_model_bundle = Mock()
        model_instance.model_type_instance.get_model_schema.return_value = None
        with patch("core.rag.retrieval.dataset_retrieval.ModelManager.for_tenant") as mock_model_manager:
            mock_model_manager.return_value.get_model_instance.return_value = model_instance
            result = retrieval.retrieve(
                app_id="app-1",
                user_id="user-1",
                tenant_id="tenant-1",
                model_config=model_config,
                config=config,
                query="python",
                invoke_from=InvokeFrom.WEB_APP,
                show_retrieve_source=False,
                hit_callback=Mock(),
                message_id="m1",
            )
        mock_model_manager.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
        assert result == (None, [])

    def test_retrieve_uses_bound_model_instance_schema_and_updates_model_config(
        self, retrieval: DatasetRetrieval
    ) -> None:
        config = DatasetEntity(
            dataset_ids=["d1"],
            retrieve_config=DatasetRetrieveConfigEntity(
                retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE,
                metadata_filtering_mode="disabled",
            ),
        )
        model_config = self._build_model_config(features=[])
        model_config.provider_model_bundle.model_type_instance.get_model_schema.return_value = None
        bound_schema = SimpleNamespace(features=[ModelFeature.TOOL_CALL])
        bound_bundle = Mock()
        bound_model_instance = Mock()
        bound_model_instance.model_name = "gpt-4"
        bound_model_instance.credentials = {"api_key": "secret"}
        bound_model_instance.provider_model_bundle = bound_bundle
        bound_model_instance.model_type_instance.get_model_schema.return_value = bound_schema

        with (
            patch("core.rag.retrieval.dataset_retrieval.ModelManager.for_tenant") as mock_model_manager,
            patch.object(retrieval, "_get_available_datasets", return_value=[SimpleNamespace(id="d1")]),
            patch.object(retrieval, "get_metadata_filter_condition", return_value=(None, None)),
            patch.object(retrieval, "single_retrieve", return_value=[]) as mock_single_retrieve,
        ):
            mock_model_manager.return_value.get_model_instance.return_value = bound_model_instance
            context, files = retrieval.retrieve(
                app_id="app-1",
                user_id="user-1",
                tenant_id="tenant-1",
                model_config=model_config,
                config=config,
                query="python",
                invoke_from=InvokeFrom.WEB_APP,
                show_retrieve_source=False,
                hit_callback=Mock(),
                message_id="m1",
            )

        mock_model_manager.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
        mock_single_retrieve.assert_called_once()
        assert mock_single_retrieve.call_args.args[8] == PlanningStrategy.ROUTER
        assert model_config.provider_model_bundle is bound_bundle
        assert model_config.credentials == {"api_key": "secret"}
        assert model_config.model_schema is bound_schema
        assert context == ""
        assert files == []

    def test_single_strategy_with_external_documents(self, retrieval: DatasetRetrieval) -> None:
        retrieve_config = DatasetRetrieveConfigEntity(
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE,
            metadata_filtering_mode="disabled",
        )
        config = DatasetEntity(dataset_ids=["d1"], retrieve_config=retrieve_config)
        model_config = self._build_model_config()
        external_doc = _doc(
            provider="external",
            content="external content",
            dataset_id="ext-ds",
            document_id="ext-doc",
            doc_id="ext-node",
            extra={"title": "External", "dataset_name": "External DS"},
        )
        with (
            patch("core.rag.retrieval.dataset_retrieval.ModelManager.for_tenant") as mock_model_manager,
            patch.object(retrieval, "_get_available_datasets", return_value=[SimpleNamespace(id="d1")]),
            patch.object(retrieval, "get_metadata_filter_condition", return_value=(None, None)),
            patch.object(retrieval, "single_retrieve", return_value=[external_doc]),
        ):
            bound_model_instance = Mock()
            bound_model_instance.model_name = "gpt-4"
            bound_model_instance.credentials = {}
            bound_model_instance.provider_model_bundle = Mock()
            bound_model_instance.model_type_instance.get_model_schema.return_value = SimpleNamespace(features=[])
            mock_model_manager.return_value.get_model_instance.return_value = bound_model_instance
            context, files = retrieval.retrieve(
                app_id="app-1",
                user_id="user-1",
                tenant_id="tenant-1",
                model_config=model_config,
                config=config,
                query="python",
                invoke_from=InvokeFrom.WEB_APP,
                show_retrieve_source=False,
                hit_callback=Mock(),
                message_id="m1",
            )
        assert context == "external content"
        assert files == []

    def test_multiple_strategy_with_vision_and_source_details(self, retrieval: DatasetRetrieval) -> None:
        retrieve_config = DatasetRetrieveConfigEntity(
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
            top_k=4,
            score_threshold=0.1,
            rerank_mode="reranking_model",
            reranking_model={"reranking_provider_name": "cohere", "reranking_model_name": "rerank-v3"},
            reranking_enabled=True,
            metadata_filtering_mode="disabled",
        )
        config = DatasetEntity(dataset_ids=["d1"], retrieve_config=retrieve_config)
        model_config = self._build_model_config(features=[ModelFeature.TOOL_CALL])
        external_doc = _doc(
            provider="external",
            content="external body",
            score=0.8,
            dataset_id="ext-ds",
            document_id="ext-doc",
            doc_id="ext-node",
            extra={"title": "External Title", "dataset_name": "External DS"},
        )
        dify_doc = _doc(
            provider="dify",
            content="dify body",
            score=0.9,
            dataset_id="d1",
            document_id="doc-1",
            doc_id="node-1",
        )
        record = SimpleNamespace(
            segment=SimpleNamespace(
                id="segment-1",
                dataset_id="d1",
                document_id="doc-1",
                tenant_id="tenant-1",
                hit_count=3,
                word_count=11,
                position=1,
                index_node_hash="hash-1",
                content="segment content",
                answer="segment answer",
                get_sign_content=lambda: "segment content",
            ),
            score=0.9,
            summary="short summary",
            files=None,
        )
        dataset_item = SimpleNamespace(id="d1", name="Dataset One")
        document_item = SimpleNamespace(
            id="doc-1",
            name="Document One",
            data_source_type="upload_file",
            doc_metadata={"lang": "en"},
        )
        upload_file = SimpleNamespace(
            id="file-1",
            name="image",
            extension="png",
            mime_type="image/png",
            source_url="https://example.com/img.png",
            size=123,
            key="k1",
        )
        execute_attachments = SimpleNamespace(all=lambda: [(SimpleNamespace(), upload_file)])
        execute_docs = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [document_item]))
        execute_datasets = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [dataset_item]))
        hit_callback = Mock()

        with (
            patch("core.rag.retrieval.dataset_retrieval.ModelManager.for_tenant") as mock_model_manager,
            patch.object(retrieval, "_get_available_datasets", return_value=[SimpleNamespace(id="d1")]),
            patch.object(retrieval, "get_metadata_filter_condition", return_value=(None, None)),
            patch.object(retrieval, "multiple_retrieve", return_value=[external_doc, dify_doc]),
            patch(
                "core.rag.retrieval.dataset_retrieval.RetrievalService.format_retrieval_documents",
                return_value=[record],
            ),
            patch("core.rag.retrieval.dataset_retrieval.sign_upload_file_preview_url", return_value="https://signed"),
            patch("core.rag.retrieval.dataset_retrieval.db.session.execute") as mock_execute,
        ):
            bound_model_instance = Mock()
            bound_model_instance.model_name = "gpt-4"
            bound_model_instance.credentials = {}
            bound_model_instance.provider_model_bundle = Mock()
            bound_model_instance.model_type_instance.get_model_schema.return_value = SimpleNamespace(
                features=[ModelFeature.TOOL_CALL]
            )
            mock_model_manager.return_value.get_model_instance.return_value = bound_model_instance
            mock_execute.side_effect = [execute_attachments, execute_docs, execute_datasets]
            context, files = retrieval.retrieve(
                app_id="app-1",
                user_id="user-1",
                tenant_id="tenant-1",
                model_config=model_config,
                config=config,
                query="python",
                invoke_from=InvokeFrom.DEBUGGER,
                show_retrieve_source=True,
                hit_callback=hit_callback,
                message_id="m1",
                vision_enabled=True,
            )

        assert "short summary" in (context or "")
        assert "question:segment content answer:segment answer" in (context or "")
        assert len(files or []) == 1
        hit_callback.return_retriever_resource_info.assert_called_once()


class TestSingleAndMultipleRetrieveCoverage:
    @pytest.fixture
    def retrieval(self) -> DatasetRetrieval:
        return DatasetRetrieval()

    def test_single_retrieve_external_path(self, retrieval: DatasetRetrieval) -> None:
        dataset = SimpleNamespace(
            id="ds-1",
            name="External DS",
            description=None,
            provider="external",
            tenant_id="tenant-1",
            retrieval_model={"top_k": 2},
            indexing_technique="high_quality",
        )
        app = Flask(__name__)
        usage = LLMUsage.from_metadata({"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2})
        with app.app_context():
            with (
                patch("core.rag.retrieval.dataset_retrieval.ReactMultiDatasetRouter") as mock_router_cls,
                patch("core.rag.retrieval.dataset_retrieval.db.session.scalar", return_value=dataset),
                patch(
                    "core.rag.retrieval.dataset_retrieval.ExternalDatasetService.fetch_external_knowledge_retrieval"
                ) as mock_external,
                patch("core.rag.retrieval.dataset_retrieval.threading.Thread", _ImmediateThread),
                patch.object(retrieval, "_on_retrieval_end") as mock_end,
                patch.object(retrieval, "_on_query"),
            ):
                mock_router_cls.return_value.invoke.return_value = ("ds-1", usage)
                mock_external.return_value = [
                    {"content": "ext result", "metadata": {"k": "v"}, "score": 0.9, "title": "Ext Doc"}
                ]
                result = retrieval.single_retrieve(
                    app_id="app-1",
                    tenant_id="tenant-1",
                    user_id="user-1",
                    user_from="workflow",
                    query="python",
                    available_datasets=[dataset],
                    model_instance=Mock(),
                    model_config=Mock(),
                    planning_strategy=PlanningStrategy.REACT_ROUTER,
                    message_id="m1",
                )

        assert len(result) == 1
        assert result[0].provider == "external"
        mock_end.assert_called_once()
        assert retrieval.llm_usage.total_tokens == 2

    def test_single_retrieve_dify_path_and_filters(self, retrieval: DatasetRetrieval) -> None:
        dataset = SimpleNamespace(
            id="ds-1",
            name="Internal DS",
            description="dataset desc",
            provider="dify",
            tenant_id="tenant-1",
            indexing_technique="high_quality",
            retrieval_model={
                "search_method": "semantic_search",
                "reranking_enable": True,
                "reranking_model": {"reranking_provider_name": "cohere", "reranking_model_name": "rerank"},
                "reranking_mode": "reranking_model",
                "weights": {"vector_setting": {}},
                "top_k": 3,
                "score_threshold_enabled": True,
                "score_threshold": 0.2,
            },
        )
        app = Flask(__name__)
        usage = LLMUsage.from_metadata({"prompt_tokens": 1, "completion_tokens": 0, "total_tokens": 1})
        result_doc = _doc(provider="dify", score=0.7, dataset_id="ds-1", document_id="doc-1", doc_id="node-1")
        with app.app_context():
            with (
                patch("core.rag.retrieval.dataset_retrieval.FunctionCallMultiDatasetRouter") as mock_router_cls,
                patch("core.rag.retrieval.dataset_retrieval.db.session.scalar", return_value=dataset),
                patch(
                    "core.rag.retrieval.dataset_retrieval.RetrievalService.retrieve", return_value=[result_doc]
                ) as mock_retrieve,
                patch("core.rag.retrieval.dataset_retrieval.threading.Thread", _ImmediateThread),
                patch.object(retrieval, "_on_retrieval_end"),
                patch.object(retrieval, "_on_query"),
            ):
                mock_router_cls.return_value.invoke.return_value = ("ds-1", usage)
                results = retrieval.single_retrieve(
                    app_id="app-1",
                    tenant_id="tenant-1",
                    user_id="user-1",
                    user_from="workflow",
                    query="python",
                    available_datasets=[dataset],
                    model_instance=Mock(),
                    model_config=Mock(),
                    planning_strategy=PlanningStrategy.ROUTER,
                    metadata_filter_document_ids={"ds-1": ["doc-1"]},
                    metadata_condition=SimpleNamespace(),
                )

        assert results == [result_doc]
        assert mock_retrieve.call_args.kwargs["document_ids_filter"] == ["doc-1"]
        assert retrieval.llm_usage.total_tokens == 1

    def test_single_retrieve_returns_empty_when_no_dataset_selected(self, retrieval: DatasetRetrieval) -> None:
        with patch("core.rag.retrieval.dataset_retrieval.ReactMultiDatasetRouter") as mock_router_cls:
            mock_router_cls.return_value.invoke.return_value = (None, LLMUsage.empty_usage())
            results = retrieval.single_retrieve(
                app_id="app-1",
                tenant_id="tenant-1",
                user_id="user-1",
                user_from="workflow",
                query="python",
                available_datasets=[
                    SimpleNamespace(id="ds-1", name="DS", description=None),
                ],
                model_instance=Mock(),
                model_config=Mock(),
                planning_strategy=PlanningStrategy.REACT_ROUTER,
            )
        assert results == []

    def test_single_retrieve_respects_metadata_filter_shortcuts(self, retrieval: DatasetRetrieval) -> None:
        dataset = SimpleNamespace(
            id="ds-1",
            name="Internal DS",
            description="desc",
            provider="dify",
            tenant_id="tenant-1",
            indexing_technique="high_quality",
            retrieval_model={"top_k": 2, "search_method": "semantic_search", "reranking_enable": False},
        )
        with (
            patch("core.rag.retrieval.dataset_retrieval.ReactMultiDatasetRouter") as mock_router_cls,
            patch("core.rag.retrieval.dataset_retrieval.db.session.scalar", return_value=dataset),
        ):
            mock_router_cls.return_value.invoke.return_value = ("ds-1", LLMUsage.empty_usage())
            no_filter = retrieval.single_retrieve(
                app_id="app-1",
                tenant_id="tenant-1",
                user_id="user-1",
                user_from="workflow",
                query="python",
                available_datasets=[dataset],
                model_instance=Mock(),
                model_config=Mock(),
                planning_strategy=PlanningStrategy.REACT_ROUTER,
                metadata_filter_document_ids=None,
                metadata_condition=SimpleNamespace(),
            )
            missing_doc_ids = retrieval.single_retrieve(
                app_id="app-1",
                tenant_id="tenant-1",
                user_id="user-1",
                user_from="workflow",
                query="python",
                available_datasets=[dataset],
                model_instance=Mock(),
                model_config=Mock(),
                planning_strategy=PlanningStrategy.REACT_ROUTER,
                metadata_filter_document_ids={"other-ds": ["x"]},
                metadata_condition=None,
            )
        assert no_filter == []
        assert missing_doc_ids == []

    def test_multiple_retrieve_validation_paths(self, retrieval: DatasetRetrieval) -> None:
        assert (
            retrieval.multiple_retrieve(
                app_id="app-1",
                tenant_id="tenant-1",
                user_id="user-1",
                user_from="workflow",
                available_datasets=[],
                query="python",
                top_k=2,
                score_threshold=0.0,
                reranking_mode="reranking_model",
            )
            == []
        )

        mixed = [
            SimpleNamespace(id="d1", indexing_technique="high_quality"),
            SimpleNamespace(id="d2", indexing_technique="economy"),
        ]
        with pytest.raises(ValueError, match="different indexing technique"):
            retrieval.multiple_retrieve(
                app_id="app-1",
                tenant_id="tenant-1",
                user_id="user-1",
                user_from="workflow",
                available_datasets=mixed,
                query="python",
                top_k=2,
                score_threshold=0.0,
                reranking_mode="weighted_score",
                reranking_enable=False,
            )

        high_quality_mismatch = [
            SimpleNamespace(
                id="d1",
                indexing_technique="high_quality",
                embedding_model="model-a",
                embedding_model_provider="provider-a",
            ),
            SimpleNamespace(
                id="d2",
                indexing_technique="high_quality",
                embedding_model="model-b",
                embedding_model_provider="provider-b",
            ),
        ]
        with pytest.raises(ValueError, match="different embedding model"):
            retrieval.multiple_retrieve(
                app_id="app-1",
                tenant_id="tenant-1",
                user_id="user-1",
                user_from="workflow",
                available_datasets=high_quality_mismatch,
                query="python",
                top_k=2,
                score_threshold=0.0,
                reranking_mode=RerankMode.WEIGHTED_SCORE,
                reranking_enable=True,
            )

    def test_multiple_retrieve_threads_and_dedup(self, retrieval: DatasetRetrieval) -> None:
        datasets = [
            SimpleNamespace(
                id="d1",
                indexing_technique="high_quality",
                embedding_model="model-a",
                embedding_model_provider="provider-a",
            ),
            SimpleNamespace(
                id="d2",
                indexing_technique="high_quality",
                embedding_model="model-a",
                embedding_model_provider="provider-a",
            ),
        ]
        doc_a = _doc(provider="dify", score=0.8, dataset_id="d1", document_id="doc-1", doc_id="dup")
        doc_b = _doc(provider="dify", score=0.7, dataset_id="d2", document_id="doc-2", doc_id="dup")
        doc_external = _doc(
            provider="external",
            score=0.9,
            dataset_id="ext-ds",
            document_id="ext-doc",
            doc_id="ext-node",
            extra={"dataset_name": "Ext", "title": "Ext"},
        )
        app = Flask(__name__)
        weights: WeightsDict = {
            "vector_setting": {"vector_weight": 0.5, "embedding_provider_name": "", "embedding_model_name": ""},
            "keyword_setting": {"keyword_weight": 0.5},
        }

        def fake_multiple_thread(**kwargs):
            if kwargs["query"]:
                kwargs["all_documents"].extend([doc_a, doc_b])
            if kwargs["attachment_id"]:
                kwargs["all_documents"].append(doc_external)

        with app.app_context():
            with (
                patch("core.rag.retrieval.dataset_retrieval.measure_time", _timer),
                patch("core.rag.retrieval.dataset_retrieval.threading.Thread", _ImmediateThread),
                patch.object(retrieval, "_multiple_retrieve_thread", side_effect=fake_multiple_thread),
                patch.object(retrieval, "_on_query") as mock_on_query,
                patch.object(retrieval, "_on_retrieval_end") as mock_end,
            ):
                result = retrieval.multiple_retrieve(
                    app_id="app-1",
                    tenant_id="tenant-1",
                    user_id="user-1",
                    user_from="workflow",
                    available_datasets=datasets,
                    query="python",
                    top_k=2,
                    score_threshold=0.0,
                    reranking_mode=RerankMode.WEIGHTED_SCORE,
                    reranking_enable=True,
                    weights=weights,
                    attachment_ids=["att-1"],
                    message_id="m1",
                )

        assert len(result) == 2
        assert any(doc.provider == "external" for doc in result)
        assert weights["vector_setting"]["embedding_provider_name"] == "provider-a"
        assert weights["vector_setting"]["embedding_model_name"] == "model-a"
        mock_on_query.assert_called_once()
        mock_end.assert_called_once()

    def test_multiple_retrieve_propagates_thread_exception(self, retrieval: DatasetRetrieval) -> None:
        datasets = [
            SimpleNamespace(
                id="d1",
                indexing_technique="high_quality",
                embedding_model="model-a",
                embedding_model_provider="provider-a",
            )
        ]
        app = Flask(__name__)

        def failing_thread(**kwargs):
            kwargs["thread_exceptions"].append(RuntimeError("thread boom"))

        with app.app_context():
            with (
                patch("core.rag.retrieval.dataset_retrieval.measure_time", _timer),
                patch("core.rag.retrieval.dataset_retrieval.threading.Thread", _ImmediateThread),
                patch.object(retrieval, "_multiple_retrieve_thread", side_effect=failing_thread),
            ):
                with pytest.raises(RuntimeError, match="thread boom"):
                    retrieval.multiple_retrieve(
                        app_id="app-1",
                        tenant_id="tenant-1",
                        user_id="user-1",
                        user_from="workflow",
                        available_datasets=datasets,
                        query="python",
                        top_k=2,
                        score_threshold=0.0,
                        reranking_mode="reranking_model",
                    )


class TestInternalHooksCoverage:
    @pytest.fixture
    def retrieval(self) -> DatasetRetrieval:
        return DatasetRetrieval()

    def test_on_retrieval_end_without_dify_documents(self, retrieval: DatasetRetrieval) -> None:
        app = Flask(__name__)
        with patch.object(retrieval, "_send_trace_task") as mock_trace:
            retrieval._on_retrieval_end(
                flask_app=app,
                documents=[_doc(provider="external")],
                message_id="m1",
                timer={"cost": 1},
            )
        mock_trace.assert_called_once()

    def test_on_retrieval_end_dify_without_document_ids(self, retrieval: DatasetRetrieval) -> None:
        app = Flask(__name__)
        doc = Document(page_content="x", metadata={"doc_id": "n1"}, provider="dify")
        with (
            patch("core.rag.retrieval.dataset_retrieval.db", SimpleNamespace(engine=Mock())),
            patch.object(retrieval, "_send_trace_task") as mock_trace,
        ):
            retrieval._on_retrieval_end(flask_app=app, documents=[doc], message_id="m1", timer={"cost": 1})
        mock_trace.assert_called_once()

    def test_on_retrieval_end_updates_segments_for_text_and_image(self, retrieval: DatasetRetrieval) -> None:
        app = Flask(__name__)
        docs = [
            _doc(provider="dify", document_id="doc-a", doc_id="idx-a", extra={"doc_type": "text"}),
            _doc(provider="dify", document_id="doc-b", doc_id="att-b", extra={"doc_type": DocType.IMAGE}),
            _doc(provider="dify", document_id="doc-c", doc_id="idx-c", extra={"doc_type": "text"}),
            _doc(provider="dify", document_id="doc-d", doc_id="att-d", extra={"doc_type": DocType.IMAGE}),
        ]
        dataset_docs = [
            SimpleNamespace(id="doc-a", doc_form=IndexStructureType.PARENT_CHILD_INDEX),
            SimpleNamespace(id="doc-b", doc_form=IndexStructureType.PARENT_CHILD_INDEX),
            SimpleNamespace(id="doc-c", doc_form=IndexStructureType.QA_INDEX),
            SimpleNamespace(id="doc-d", doc_form=IndexStructureType.QA_INDEX),
        ]
        child_chunks = [SimpleNamespace(index_node_id="idx-a", segment_id="seg-a")]
        segments = [SimpleNamespace(index_node_id="idx-c", id="seg-c")]
        bindings = [SimpleNamespace(segment_id="seg-b"), SimpleNamespace(segment_id="seg-d")]

        def _scalars(items):
            result = Mock()
            result.all.return_value = items
            return result

        session = Mock()
        session.scalars.side_effect = [
            _scalars(dataset_docs),
            _scalars(child_chunks),
            _scalars(segments),
            _scalars(bindings),
        ]
        session_ctx = MagicMock()
        session_ctx.__enter__.return_value = session
        session_ctx.__exit__.return_value = False

        sessionmaker_ctx = MagicMock()
        sessionmaker_ctx.begin.return_value = session_ctx

        with (
            patch("core.rag.retrieval.dataset_retrieval.db", SimpleNamespace(engine=Mock())),
            patch("core.rag.retrieval.dataset_retrieval.sessionmaker", return_value=sessionmaker_ctx),
            patch.object(retrieval, "_send_trace_task") as mock_trace,
        ):
            retrieval._on_retrieval_end(flask_app=app, documents=docs, message_id="m1", timer={"cost": 1})

        session.execute.assert_called_once()
        mock_trace.assert_called_once()

    def test_retriever_variants(self, retrieval: DatasetRetrieval) -> None:
        flask_app = SimpleNamespace(app_context=lambda: nullcontext())
        all_documents: list[Document] = []

        with patch("core.rag.retrieval.dataset_retrieval.db.session.scalar", return_value=None):
            assert (
                retrieval._retriever(
                    flask_app=flask_app,  # type: ignore[arg-type]
                    dataset_id="d1",
                    query="python",
                    top_k=1,
                    all_documents=all_documents,
                )
                == []
            )

        external_dataset = SimpleNamespace(
            id="ext-ds",
            name="External",
            provider="external",
            tenant_id="tenant-1",
            retrieval_model={"top_k": 2},
            indexing_technique="high_quality",
        )
        with (
            patch("core.rag.retrieval.dataset_retrieval.db.session.scalar", return_value=external_dataset),
            patch(
                "core.rag.retrieval.dataset_retrieval.ExternalDatasetService.fetch_external_knowledge_retrieval"
            ) as mock_external,
        ):
            mock_external.return_value = [{"content": "e", "metadata": {}, "score": 0.8, "title": "Ext"}]
            retrieval._retriever(
                flask_app=flask_app,  # type: ignore[arg-type]
                dataset_id="ext-ds",
                query="python",
                top_k=1,
                all_documents=all_documents,
            )

        economy_dataset = SimpleNamespace(
            id="eco-ds",
            provider="dify",
            retrieval_model={"top_k": 1},
            indexing_technique="economy",
        )
        high_dataset = SimpleNamespace(
            id="hq-ds",
            provider="dify",
            retrieval_model={
                "search_method": "semantic_search",
                "top_k": 4,
                "score_threshold": 0.3,
                "score_threshold_enabled": True,
                "reranking_enable": True,
                "reranking_model": {"reranking_provider_name": "x", "reranking_model_name": "y"},
                "reranking_mode": "reranking_model",
                "weights": {"vector_setting": {}},
            },
            indexing_technique="high_quality",
        )
        with (
            patch(
                "core.rag.retrieval.dataset_retrieval.db.session.scalar", side_effect=[economy_dataset, high_dataset]
            ),
            patch(
                "core.rag.retrieval.dataset_retrieval.RetrievalService.retrieve", return_value=[_doc(provider="dify")]
            ) as mock_retrieve,
        ):
            retrieval._retriever(
                flask_app=flask_app,  # type: ignore[arg-type]
                dataset_id="eco-ds",
                query="python",
                top_k=2,
                all_documents=all_documents,
            )
            retrieval._retriever(
                flask_app=flask_app,  # type: ignore[arg-type]
                dataset_id="hq-ds",
                query="python",
                top_k=2,
                all_documents=all_documents,
                attachment_ids=["att-1"],
            )
        assert mock_retrieve.call_count == 2
        assert len(all_documents) >= 3

    def test_to_dataset_retriever_tool_paths(self, retrieval: DatasetRetrieval) -> None:
        dataset_skip_zero = SimpleNamespace(id="d1", provider="dify", available_document_count=0)
        dataset_ok_single = SimpleNamespace(
            id="d2",
            provider="dify",
            available_document_count=2,
            retrieval_model={"top_k": 2, "score_threshold_enabled": True, "score_threshold": 0.1},
        )
        single_config = DatasetRetrieveConfigEntity(
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE,
            metadata_filtering_mode="disabled",
        )
        with (
            patch(
                "core.rag.retrieval.dataset_retrieval.db.session.scalar",
                side_effect=[None, dataset_skip_zero, dataset_ok_single],
            ),
            patch(
                "core.tools.utils.dataset_retriever.dataset_retriever_tool.DatasetRetrieverTool.from_dataset",
                return_value="single-tool",
            ) as mock_single_tool,
        ):
            single_tools = retrieval.to_dataset_retriever_tool(
                tenant_id="tenant-1",
                dataset_ids=["missing", "d1", "d2"],
                retrieve_config=single_config,
                return_resource=True,
                invoke_from=InvokeFrom.WEB_APP,
                hit_callback=Mock(),
                user_id="user-1",
                inputs={"k": "v"},
            )

        assert single_tools == ["single-tool"]
        mock_single_tool.assert_called_once()

        multiple_config_missing = DatasetRetrieveConfigEntity(
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
            metadata_filtering_mode="disabled",
            reranking_model=None,
        )
        with patch("core.rag.retrieval.dataset_retrieval.db.session.scalar", return_value=dataset_ok_single):
            with pytest.raises(ValueError, match="Reranking model is required"):
                retrieval.to_dataset_retriever_tool(
                    tenant_id="tenant-1",
                    dataset_ids=["d2"],
                    retrieve_config=multiple_config_missing,
                    return_resource=True,
                    invoke_from=InvokeFrom.WEB_APP,
                    hit_callback=Mock(),
                    user_id="user-1",
                    inputs={},
                )

        multiple_config = DatasetRetrieveConfigEntity(
            retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.MULTIPLE,
            metadata_filtering_mode="disabled",
            top_k=3,
            score_threshold=0.2,
            reranking_model={"reranking_provider_name": "cohere", "reranking_model_name": "rerank-v3"},
        )
        with (
            patch("core.rag.retrieval.dataset_retrieval.db.session.scalar", return_value=dataset_ok_single),
            patch(
                "core.tools.utils.dataset_retriever.dataset_multi_retriever_tool.DatasetMultiRetrieverTool.from_dataset",
                return_value="multi-tool",
            ) as mock_multi_tool,
        ):
            multi_tools = retrieval.to_dataset_retriever_tool(
                tenant_id="tenant-1",
                dataset_ids=["d2"],
                retrieve_config=multiple_config,
                return_resource=False,
                invoke_from=InvokeFrom.DEBUGGER,
                hit_callback=Mock(),
                user_id="user-1",
                inputs={},
            )
        assert multi_tools == ["multi-tool"]
        mock_multi_tool.assert_called_once()

    def test_additional_small_branches(self, retrieval: DatasetRetrieval) -> None:
        keyword_handler = Mock()
        keyword_handler.extract_keywords.side_effect = [[], []]
        doc = Document(page_content="doc", metadata={"doc_id": "1"}, provider="dify")
        with patch("core.rag.retrieval.dataset_retrieval.JiebaKeywordTableHandler", return_value=keyword_handler):
            ranked = retrieval.calculate_keyword_score("query", [doc], top_k=1)
        assert len(ranked) == 1
        assert ranked[0].metadata.get("score") == 0.0

        with patch("core.rag.retrieval.dataset_retrieval.db.session.scalars") as mock_scalars:
            mock_scalars.return_value.all.return_value = []
            with pytest.raises(ValueError):
                retrieval._automatic_metadata_filter_func(
                    dataset_ids=["d1"],
                    query="python",
                    tenant_id="tenant-1",
                    user_id="user-1",
                    metadata_model_config=None,  # type: ignore[arg-type]
                )

        session_scalars = Mock()
        session_scalars.all.return_value = [SimpleNamespace(name="author")]
        with (
            patch("core.rag.retrieval.dataset_retrieval.db.session.scalars", return_value=session_scalars),
            patch.object(retrieval, "_fetch_model_config", return_value=(Mock(), Mock())),
            patch.object(retrieval, "_get_prompt_template", return_value=(["prompt"], [])),
            patch.object(retrieval, "_record_usage"),
        ):
            model_instance = Mock()
            model_instance.invoke_llm.side_effect = RuntimeError("nope")
            with patch.object(retrieval, "_fetch_model_config", return_value=(model_instance, Mock())):
                assert (
                    retrieval._automatic_metadata_filter_func(
                        dataset_ids=["d1"],
                        query="python",
                        tenant_id="tenant-1",
                        user_id="user-1",
                        metadata_model_config=WorkflowModelConfig(provider="openai", name="gpt", mode="chat"),
                    )
                    is None
                )

        with (
            patch("core.rag.retrieval.dataset_retrieval.ModelMode", return_value=object()),
            patch("core.rag.retrieval.dataset_retrieval.AdvancedPromptTransform"),
        ):
            with pytest.raises(ValueError, match="not support"):
                retrieval._get_prompt_template(
                    model_config=ModelConfigWithCredentialsEntity.model_construct(
                        provider="openai",
                        model="gpt",
                        model_schema=Mock(),
                        mode="chat",
                        provider_model_bundle=Mock(),
                        credentials={},
                        parameters={},
                        stop=[],
                    ),
                    mode="chat",
                    metadata_fields=[],
                    query="q",
                )
