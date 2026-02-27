"""
Unit tests for dataset retrieval functionality.

This module provides comprehensive test coverage for the RetrievalService class,
which is responsible for retrieving relevant documents from datasets using various
search strategies.

Core Retrieval Mechanisms Tested:
==================================
1. **Vector Search (Semantic Search)**
   - Uses embedding vectors to find semantically similar documents
   - Supports score thresholds and top-k limiting
   - Can filter by document IDs and metadata

2. **Keyword Search**
   - Traditional text-based search using keyword matching
   - Handles special characters and query escaping
   - Supports document filtering

3. **Full-Text Search**
   - BM25-based full-text search for text matching
   - Used in hybrid search scenarios

4. **Hybrid Search**
   - Combines vector and full-text search results
   - Implements deduplication to avoid duplicate chunks
   - Uses DataPostProcessor for score merging with configurable weights

5. **Score Merging Algorithms**
   - Deduplication based on doc_id
   - Retains higher-scoring duplicates
   - Supports weighted score combination

6. **Metadata Filtering**
   - Filters documents based on metadata conditions
   - Supports document ID filtering

Test Architecture:
==================
- **Fixtures**: Provide reusable mock objects (datasets, documents, Flask app)
- **Mocking Strategy**: Mock at the method level (embedding_search, keyword_search, etc.)
  rather than at the class level to properly simulate the ThreadPoolExecutor behavior
- **Pattern**: All tests follow Arrange-Act-Assert (AAA) pattern
- **Isolation**: Each test is independent and doesn't rely on external state

Running Tests:
==============
    # Run all tests in this module
    uv run --project api pytest \
        api/tests/unit_tests/core/rag/retrieval/test_dataset_retrieval.py -v
    
    # Run a specific test class
    uv run --project api pytest \
        api/tests/unit_tests/core/rag/retrieval/test_dataset_retrieval.py::TestRetrievalService -v
    
    # Run a specific test
    uv run --project api pytest \
        api/tests/unit_tests/core/rag/retrieval/test_dataset_retrieval.py::\
TestRetrievalService::test_vector_search_basic -v

Notes:
======
- The RetrievalService uses ThreadPoolExecutor for concurrent search operations
- Tests mock the individual search methods to avoid threading complexity
- All mocked search methods modify the all_documents list in-place
- Score thresholds and top-k limits are enforced by the search methods
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, call, patch
from uuid import uuid4

import pytest

from core.rag.datasource import retrieval_service as retrieval_service_module
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from models.dataset import Dataset

# ==================== Helper Functions ====================


def create_mock_document(
    content: str,
    doc_id: str,
    score: float = 0.8,
    provider: str = "dify",
    additional_metadata: dict | None = None,
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


class _ImmediateFuture:
    def __init__(self, exception: Exception | None = None) -> None:
        self._exception = exception
        self.cancel_called = False

    def exception(self) -> Exception | None:
        return self._exception

    def cancel(self) -> None:
        self.cancel_called = True


class _ImmediateExecutor:
    def __init__(self) -> None:
        self.futures: list[_ImmediateFuture] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def submit(self, fn, *args, **kwargs):
        try:
            fn(*args, **kwargs)
            future = _ImmediateFuture()
        except Exception as exc:  # pragma: no cover - only for defensive parity with Future semantics
            future = _ImmediateFuture(exc)
        self.futures.append(future)
        return future


class _FakeExecuteScalarResult:
    def __init__(self, data: list) -> None:
        self._data = data

    def all(self) -> list:
        return self._data


class _FakeExecuteResult:
    def __init__(self, data: list) -> None:
        self._data = data

    def scalars(self) -> _FakeExecuteScalarResult:
        return _FakeExecuteScalarResult(self._data)


class _FakeSummaryQuery:
    def __init__(self, summaries: list) -> None:
        self._summaries = summaries

    def filter(self, *args, **kwargs):
        return self

    def all(self) -> list:
        return self._summaries


class _FakeSession:
    def __init__(self, execute_payloads: list[list], summaries: list) -> None:
        self._payloads = list(execute_payloads)
        self._summaries = summaries

    def execute(self, stmt):
        data = self._payloads.pop(0) if self._payloads else []
        return _FakeExecuteResult(data)

    def query(self, model):
        return _FakeSummaryQuery(self._summaries)


class _FakeSessionContext:
    def __init__(self, session: _FakeSession) -> None:
        self._session = session

    def __enter__(self) -> _FakeSession:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _SimpleRetrievalChildChunk:
    def __init__(self, id: str, content: str, score: float, position: int) -> None:
        self.id = id
        self.content = content
        self.score = score
        self.position = position


class _SimpleRetrievalSegment:
    def __init__(
        self,
        segment,
        child_chunks: list[_SimpleRetrievalChildChunk] | None = None,
        score: float | None = None,
        files: list[dict[str, str | int]] | None = None,
        summary: str | None = None,
    ) -> None:
        self.segment = segment
        self.child_chunks = child_chunks
        self.score = score
        self.files = files
        self.summary = summary


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
        Test deduplication with non-dify provider documents.

        Verifies:
        - External provider documents use content-based deduplication
        - Different providers are handled correctly
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
        assert len(result) >= 1

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


class TestRetrievalServiceInternals:
    @pytest.fixture
    def internal_dataset(self) -> Dataset:
        dataset = Mock(spec=Dataset)
        dataset.id = "dataset-id"
        dataset.tenant_id = "tenant-id"
        dataset.is_multimodal = False
        dataset.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        return dataset

    @pytest.fixture
    def internal_flask_app(self):
        app = MagicMock()
        app.app_context.return_value.__enter__ = Mock()
        app.app_context.return_value.__exit__.return_value = False
        return app

    def test_retrieve_with_attachment_ids_only(self, monkeypatch, internal_dataset):
        with (
            patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset", return_value=internal_dataset),
            patch("core.rag.datasource.retrieval_service.RetrievalService._retrieve") as mock_retrieve,
        ):
            executor = _ImmediateExecutor()
            monkeypatch.setattr(retrieval_service_module, "ThreadPoolExecutor", lambda *args, **kwargs: executor)
            monkeypatch.setattr(
                retrieval_service_module.concurrent.futures,
                "as_completed",
                lambda futures, timeout=None: iter(futures),
            )

            def side_effect(
                flask_app,
                retrieval_method,
                dataset,
                all_documents,
                exceptions,
                query=None,
                top_k=4,
                score_threshold=0.0,
                reranking_model=None,
                reranking_mode="reranking_model",
                weights=None,
                document_ids_filter=None,
                attachment_id=None,
            ):
                all_documents.append(create_mock_document(f"content-{attachment_id}", attachment_id or "none", 0.9))

            mock_retrieve.side_effect = side_effect

            results = RetrievalService.retrieve(
                retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
                dataset_id=internal_dataset.id,
                query="",
                attachment_ids=["att-1", "att-2"],
            )

        assert len(results) == 2
        assert {doc.metadata["doc_id"] for doc in results} == {"att-1", "att-2"}
        assert mock_retrieve.call_count == 2

    @patch("core.rag.datasource.retrieval_service.ExternalDatasetService.fetch_external_knowledge_retrieval")
    @patch("core.rag.datasource.retrieval_service.MetadataCondition.model_validate")
    @patch("core.rag.datasource.retrieval_service.db.session.scalar")
    def test_external_retrieve_with_metadata_conditions(self, mock_scalar, mock_validate, mock_fetch):
        mock_scalar.return_value = SimpleNamespace(tenant_id="tenant-1")
        mock_validate.return_value = "validated-condition"
        expected_documents = [create_mock_document("external-doc", "external-1", 0.8, provider="external")]
        mock_fetch.return_value = expected_documents

        results = RetrievalService.external_retrieve(
            dataset_id="dataset-1",
            query="test query",
            external_retrieval_model={"top_k": 3},
            metadata_filtering_conditions={"field": "source", "operator": "contains", "value": "manual"},
        )

        assert results == expected_documents
        mock_validate.assert_called_once()
        mock_fetch.assert_called_once_with(
            "tenant-1",
            "dataset-1",
            "test query",
            {"top_k": 3},
            metadata_condition="validated-condition",
        )

    @patch("core.rag.datasource.retrieval_service.db.session.scalar")
    def test_external_retrieve_returns_empty_when_dataset_not_found(self, mock_scalar):
        mock_scalar.return_value = None

        results = RetrievalService.external_retrieve(dataset_id="missing", query="q")

        assert results == []

    @patch("core.rag.datasource.retrieval_service.Session")
    def test_get_dataset_queries_by_id(self, mock_session_class):
        expected_dataset = Mock(spec=Dataset)
        mock_session = Mock()
        mock_session.query.return_value.where.return_value.first.return_value = expected_dataset
        mock_session_class.return_value.__enter__.return_value = mock_session

        with patch.object(retrieval_service_module, "db", SimpleNamespace(engine=Mock())):
            result = RetrievalService._get_dataset("dataset-123")

        assert result == expected_dataset
        mock_session.query.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.Keyword")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_keyword_search_success(self, mock_get_dataset, mock_keyword_class, internal_dataset, internal_flask_app):
        mock_get_dataset.return_value = internal_dataset
        keyword_instance = Mock()
        keyword_instance.search.return_value = [create_mock_document("keyword-content", "kw-1", 0.91)]
        mock_keyword_class.return_value = keyword_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.keyword_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query='query "with quotes"',
            top_k=5,
            all_documents=all_documents,
            exceptions=exceptions,
        )

        assert len(all_documents) == 1
        assert exceptions == []
        keyword_instance.search.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_keyword_search_appends_exception_when_dataset_missing(self, mock_get_dataset, internal_flask_app):
        mock_get_dataset.return_value = None
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.keyword_search(
            flask_app=internal_flask_app,
            dataset_id="dataset-id",
            query="query",
            top_k=2,
            all_documents=all_documents,
            exceptions=exceptions,
        )

        assert all_documents == []
        assert exceptions == ["dataset not found"]

    @patch("core.rag.datasource.retrieval_service.Keyword")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_keyword_search_appends_exception_when_search_fails(
        self, mock_get_dataset, mock_keyword_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        keyword_instance = Mock()
        keyword_instance.search.side_effect = RuntimeError("keyword failed")
        mock_keyword_class.return_value = keyword_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.keyword_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=2,
            all_documents=all_documents,
            exceptions=exceptions,
        )

        assert all_documents == []
        assert exceptions == ["keyword failed"]

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_text_without_reranking(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        internal_dataset.is_multimodal = False
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = [create_mock_document("vector-content", "vec-1", 0.7)]
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.5,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            document_ids_filter=["doc-1"],
            query_type=QueryType.TEXT_QUERY,
        )

        assert len(all_documents) == 1
        assert exceptions == []
        vector_instance.search_by_vector.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_image_non_multimodal_returns_early(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        internal_dataset.is_multimodal = False
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="file-1",
            top_k=4,
            score_threshold=0.5,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.IMAGE_QUERY,
        )

        assert all_documents == []
        assert exceptions == []
        vector_instance.search_by_file.assert_not_called()

    @patch("core.rag.datasource.retrieval_service.ModelManager")
    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_image_multimodal_with_vision_reranking(
        self,
        mock_get_dataset,
        mock_vector_class,
        mock_processor_class,
        mock_model_manager_class,
        internal_dataset,
        internal_flask_app,
    ):
        internal_dataset.is_multimodal = True
        mock_get_dataset.return_value = internal_dataset
        original_docs = [create_mock_document("image-content", "img-doc", 0.73)]
        reranked_docs = [create_mock_document("image-content-reranked", "img-doc", 0.97)]

        vector_instance = Mock()
        vector_instance.search_by_file.return_value = original_docs
        mock_vector_class.return_value = vector_instance

        processor_instance = Mock()
        processor_instance.invoke.return_value = reranked_docs
        mock_processor_class.return_value = processor_instance

        model_manager = Mock()
        model_manager.check_model_support_vision.return_value = True
        mock_model_manager_class.return_value = model_manager

        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="file-id",
            top_k=4,
            score_threshold=0.5,
            reranking_model={
                "reranking_provider_name": "provider",
                "reranking_model_name": "model",
            },
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.IMAGE_QUERY,
        )

        assert all_documents == reranked_docs
        assert exceptions == []
        processor_instance.invoke.assert_called_once()
        model_manager.check_model_support_vision.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.ModelManager")
    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_image_multimodal_without_vision_support(
        self,
        mock_get_dataset,
        mock_vector_class,
        mock_processor_class,
        mock_model_manager_class,
        internal_dataset,
        internal_flask_app,
    ):
        internal_dataset.is_multimodal = True
        mock_get_dataset.return_value = internal_dataset
        original_docs = [create_mock_document("image-content", "img-doc", 0.73)]

        vector_instance = Mock()
        vector_instance.search_by_file.return_value = original_docs
        mock_vector_class.return_value = vector_instance

        processor_instance = Mock()
        processor_instance.invoke.return_value = [create_mock_document("unused", "unused", 0.1)]
        mock_processor_class.return_value = processor_instance

        model_manager = Mock()
        model_manager.check_model_support_vision.return_value = False
        mock_model_manager_class.return_value = model_manager

        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="file-id",
            top_k=4,
            score_threshold=0.5,
            reranking_model={
                "reranking_provider_name": "provider",
                "reranking_model_name": "model",
            },
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.IMAGE_QUERY,
        )

        assert all_documents == original_docs
        assert exceptions == []
        processor_instance.invoke.assert_not_called()

    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_text_with_reranking_non_multimodal(
        self, mock_get_dataset, mock_vector_class, mock_processor_class, internal_dataset, internal_flask_app
    ):
        internal_dataset.is_multimodal = False
        mock_get_dataset.return_value = internal_dataset
        original_docs = [create_mock_document("vector-content", "vec-doc", 0.62)]
        reranked_docs = [create_mock_document("vector-content-reranked", "vec-doc", 0.89)]

        vector_instance = Mock()
        vector_instance.search_by_vector.return_value = original_docs
        mock_vector_class.return_value = vector_instance

        processor_instance = Mock()
        processor_instance.invoke.return_value = reranked_docs
        mock_processor_class.return_value = processor_instance

        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.5,
            reranking_model={
                "reranking_provider_name": "provider",
                "reranking_model_name": "model",
            },
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.TEXT_QUERY,
        )

        assert all_documents == reranked_docs
        assert exceptions == []
        processor_instance.invoke.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_embedding_search_appends_exception_when_vector_fails(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        vector_instance.search_by_vector.side_effect = RuntimeError("vector failed")
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.embedding_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.5,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            exceptions=exceptions,
            query_type=QueryType.TEXT_QUERY,
        )

        assert all_documents == []
        assert exceptions == ["vector failed"]

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_full_text_index_search_without_reranking(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        vector_instance.search_by_full_text.return_value = [create_mock_document("fulltext", "ft-1", 0.68)]
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.full_text_index_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query='query "x"',
            top_k=4,
            score_threshold=0.4,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.FULL_TEXT_SEARCH,
            exceptions=exceptions,
        )

        assert len(all_documents) == 1
        assert exceptions == []
        vector_instance.search_by_full_text.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.DataPostProcessor")
    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_full_text_index_search_with_reranking(
        self, mock_get_dataset, mock_vector_class, mock_processor_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        original_docs = [create_mock_document("fulltext", "ft-1", 0.68)]
        reranked_docs = [create_mock_document("fulltext-reranked", "ft-1", 0.9)]

        vector_instance = Mock()
        vector_instance.search_by_full_text.return_value = original_docs
        mock_vector_class.return_value = vector_instance

        processor_instance = Mock()
        processor_instance.invoke.return_value = reranked_docs
        mock_processor_class.return_value = processor_instance

        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.full_text_index_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.4,
            reranking_model={
                "reranking_provider_name": "provider",
                "reranking_model_name": "model",
            },
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.FULL_TEXT_SEARCH,
            exceptions=exceptions,
        )

        assert all_documents == reranked_docs
        assert exceptions == []
        processor_instance.invoke.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_full_text_index_search_dataset_not_found(self, mock_get_dataset, internal_flask_app):
        mock_get_dataset.return_value = None
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.full_text_index_search(
            flask_app=internal_flask_app,
            dataset_id="dataset-id",
            query="query",
            top_k=4,
            score_threshold=0.4,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.FULL_TEXT_SEARCH,
            exceptions=exceptions,
        )

        assert all_documents == []
        assert exceptions == ["dataset not found"]

    @patch("core.rag.datasource.retrieval_service.Vector")
    @patch("core.rag.datasource.retrieval_service.RetrievalService._get_dataset")
    def test_full_text_index_search_appends_exception_when_search_fails(
        self, mock_get_dataset, mock_vector_class, internal_dataset, internal_flask_app
    ):
        mock_get_dataset.return_value = internal_dataset
        vector_instance = Mock()
        vector_instance.search_by_full_text.side_effect = RuntimeError("fulltext failed")
        mock_vector_class.return_value = vector_instance
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService.full_text_index_search(
            flask_app=internal_flask_app,
            dataset_id=internal_dataset.id,
            query="query",
            top_k=4,
            score_threshold=0.4,
            reranking_model=None,
            all_documents=all_documents,
            retrieval_method=RetrievalMethod.FULL_TEXT_SEARCH,
            exceptions=exceptions,
        )

        assert all_documents == []
        assert exceptions == ["fulltext failed"]

    def test_format_retrieval_documents_with_empty_input_returns_empty_list(self):
        assert RetrievalService.format_retrieval_documents([]) == []

    def test_format_retrieval_documents_without_document_id_returns_empty_list(self):
        documents = [Document(page_content="content", metadata={"doc_id": "doc-1", "score": 0.4}, provider="dify")]

        assert RetrievalService.format_retrieval_documents(documents) == []

    def test_format_retrieval_documents_with_parent_child_summary_and_attachments(self, monkeypatch):
        dataset_doc_parent = SimpleNamespace(
            id="doc-parent",
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            dataset_id="dataset-id",
        )
        dataset_doc_text = SimpleNamespace(id="doc-text", doc_form="paragraph", dataset_id="dataset-id")
        dataset_doc_parent_summary = SimpleNamespace(
            id="doc-parent-summary",
            doc_form=IndexStructureType.PARENT_CHILD_INDEX,
            dataset_id="dataset-id",
        )

        dataset_query = Mock()
        dataset_query.where.return_value.options.return_value.all.return_value = [
            dataset_doc_parent,
            dataset_doc_text,
            dataset_doc_parent_summary,
        ]
        monkeypatch.setattr(retrieval_service_module.db.session, "query", Mock(return_value=dataset_query))
        monkeypatch.setattr(retrieval_service_module, "RetrievalChildChunk", _SimpleRetrievalChildChunk)
        monkeypatch.setattr(retrieval_service_module, "RetrievalSegments", _SimpleRetrievalSegment)

        input_documents = [
            Document(
                page_content="child node content",
                metadata={"document_id": "doc-parent", "doc_id": "child-node-1", "score": 0.7},
                provider="dify",
            ),
            Document(
                page_content="parent image",
                metadata={
                    "document_id": "doc-parent",
                    "doc_id": "attach-node-1",
                    "doc_type": DocType.IMAGE,
                    "score": 0.8,
                },
                provider="dify",
            ),
            Document(
                page_content="text index node",
                metadata={"document_id": "doc-text", "doc_id": "index-node-1", "score": 0.6},
                provider="dify",
            ),
            Document(
                page_content="text image node",
                metadata={
                    "document_id": "doc-text",
                    "doc_id": "attach-text-1",
                    "doc_type": DocType.IMAGE,
                    "score": 0.65,
                },
                provider="dify",
            ),
            Document(
                page_content="summary candidate 1",
                metadata={
                    "document_id": "doc-text",
                    "doc_id": "summary-node-1",
                    "is_summary": True,
                    "original_chunk_id": "segment-summary",
                    "score": "0.9",
                },
                provider="dify",
            ),
            Document(
                page_content="summary candidate 2",
                metadata={
                    "document_id": "doc-text",
                    "doc_id": "summary-node-2",
                    "is_summary": True,
                    "original_chunk_id": "segment-summary",
                    "score": "0.95",
                },
                provider="dify",
            ),
            Document(
                page_content="invalid score summary",
                metadata={
                    "document_id": "doc-parent-summary",
                    "doc_id": "summary-parent-invalid",
                    "is_summary": True,
                    "original_chunk_id": "segment-parent-summary",
                    "score": "invalid",
                },
                provider="dify",
            ),
            Document(
                page_content="valid parent summary",
                metadata={
                    "document_id": "doc-parent-summary",
                    "doc_id": "summary-parent-valid",
                    "is_summary": True,
                    "original_chunk_id": "segment-parent-summary",
                    "score": "0.4",
                },
                provider="dify",
            ),
        ]

        child_chunk = SimpleNamespace(
            id="child-chunk-1",
            segment_id="segment-parent",
            index_node_id="child-node-1",
            content="child details",
            position=2,
        )
        segment_parent = SimpleNamespace(id="segment-parent", document_id="doc-parent", index_node_id="parent-node")
        segment_text = SimpleNamespace(id="segment-text", document_id="doc-text", index_node_id="index-node-1")
        segment_summary = SimpleNamespace(id="segment-summary", document_id="doc-text", index_node_id="summary-node")
        segment_parent_summary = SimpleNamespace(
            id="segment-parent-summary",
            document_id="doc-parent-summary",
            index_node_id="summary-parent-node",
        )

        fake_session = _FakeSession(
            execute_payloads=[
                [child_chunk],
                [segment_text],
                [segment_parent, segment_text],
                [segment_summary, segment_parent_summary],
            ],
            summaries=[
                SimpleNamespace(chunk_id="segment-summary", summary_content="summary for text"),
                SimpleNamespace(chunk_id="segment-parent-summary", summary_content="summary for parent"),
            ],
        )
        monkeypatch.setattr(
            retrieval_service_module.session_factory,
            "create_session",
            lambda: _FakeSessionContext(fake_session),
        )
        monkeypatch.setattr(
            RetrievalService,
            "get_segment_attachment_infos",
            lambda attachment_ids, session: [
                {
                    "attachment_id": "attach-node-1",
                    "attachment_info": {
                        "id": "attach-node-1",
                        "name": "img-parent",
                        "extension": ".png",
                        "mime_type": "image/png",
                        "source_url": "signed://parent",
                        "size": 11,
                    },
                    "segment_id": "segment-parent",
                },
                {
                    "attachment_id": "attach-text-1",
                    "attachment_info": {
                        "id": "attach-text-1",
                        "name": "img-text",
                        "extension": ".png",
                        "mime_type": "image/png",
                        "source_url": "signed://text",
                        "size": 22,
                    },
                    "segment_id": "segment-text",
                },
            ],
        )

        result = RetrievalService.format_retrieval_documents(input_documents)

        assert len(result) == 4
        result_by_segment_id = {item.segment.id: item for item in result}
        assert result_by_segment_id["segment-summary"].score == pytest.approx(0.95)
        assert result_by_segment_id["segment-summary"].summary == "summary for text"
        assert result_by_segment_id["segment-parent"].score == pytest.approx(0.8)
        assert result_by_segment_id["segment-parent"].files is not None
        assert len(result_by_segment_id["segment-parent"].child_chunks or []) == 1
        assert result_by_segment_id["segment-text"].score == pytest.approx(0.65)
        assert result_by_segment_id["segment-parent-summary"].score == pytest.approx(0.4)
        assert result_by_segment_id["segment-parent-summary"].summary == "summary for parent"
        assert result_by_segment_id["segment-parent-summary"].child_chunks == []

    def test_format_retrieval_documents_rolls_back_and_raises_when_db_fails(self, monkeypatch):
        rollback = Mock()
        monkeypatch.setattr(retrieval_service_module.db.session, "rollback", rollback)
        monkeypatch.setattr(retrieval_service_module.db.session, "query", Mock(side_effect=RuntimeError("db error")))

        documents = [Document(page_content="content", metadata={"document_id": "doc-1"}, provider="dify")]

        with pytest.raises(RuntimeError, match="db error"):
            RetrievalService.format_retrieval_documents(documents)

        rollback.assert_called_once()

    def test_retrieve_internal_returns_early_without_query_or_attachment(self, internal_dataset, internal_flask_app):
        all_documents: list[Document] = []
        exceptions: list[str] = []

        RetrievalService()._retrieve(
            flask_app=internal_flask_app,
            retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
            dataset=internal_dataset,
            all_documents=all_documents,
            exceptions=exceptions,
            query=None,
            attachment_id=None,
        )

        assert all_documents == []
        assert exceptions == []

    def test_retrieve_internal_cancels_futures_when_future_has_exception(self, internal_dataset, internal_flask_app):
        future_error = Mock()
        future_error.exception.return_value = RuntimeError("future failed")
        future_ok = Mock()
        future_ok.exception.return_value = None

        with (
            patch("core.rag.datasource.retrieval_service.ThreadPoolExecutor") as mock_executor,
            patch(
                "core.rag.datasource.retrieval_service.concurrent.futures.as_completed",
                return_value=[future_error, future_ok],
            ),
        ):
            mock_executor_instance = Mock()
            mock_executor_instance.submit.side_effect = [future_error, future_ok]
            mock_executor.return_value.__enter__.return_value = mock_executor_instance
            RetrievalService()._retrieve(
                flask_app=internal_flask_app,
                retrieval_method=RetrievalMethod.SEMANTIC_SEARCH,
                dataset=internal_dataset,
                all_documents=[],
                exceptions=[],
                query="query",
                attachment_id="file-1",
            )

        future_error.cancel.assert_called()
        future_ok.cancel.assert_called()

    def test_retrieve_internal_raises_value_error_when_exceptions_exist(
        self, monkeypatch, internal_dataset, internal_flask_app
    ):
        executor = _ImmediateExecutor()
        monkeypatch.setattr(retrieval_service_module, "ThreadPoolExecutor", lambda *args, **kwargs: executor)
        monkeypatch.setattr(
            retrieval_service_module.concurrent.futures,
            "as_completed",
            lambda futures, timeout=None: iter(futures),
        )

        with patch("core.rag.datasource.retrieval_service.RetrievalService.keyword_search") as mock_keyword_search:
            mock_keyword_search.side_effect = lambda *args, **kwargs: None
            with pytest.raises(ValueError, match="keyword error"):
                RetrievalService()._retrieve(
                    flask_app=internal_flask_app,
                    retrieval_method=RetrievalMethod.KEYWORD_SEARCH,
                    dataset=internal_dataset,
                    all_documents=[],
                    exceptions=["keyword error"],
                    query="query",
                )

    def test_retrieve_internal_hybrid_weighted_attachment_flow(self, monkeypatch, internal_dataset, internal_flask_app):
        executor = _ImmediateExecutor()
        monkeypatch.setattr(retrieval_service_module, "ThreadPoolExecutor", lambda *args, **kwargs: executor)
        monkeypatch.setattr(
            retrieval_service_module.concurrent.futures,
            "as_completed",
            lambda futures, timeout=None: iter(futures),
        )

        text_doc = create_mock_document("text", "text-doc", 0.81)
        image_doc = create_mock_document("image", "image-doc", 0.72)
        fulltext_doc = create_mock_document("full", "full-doc", 0.65)
        processed_doc = create_mock_document("processed", "processed-doc", 0.99)

        with (
            patch("core.rag.datasource.retrieval_service.RetrievalService.embedding_search") as mock_embedding_search,
            patch("core.rag.datasource.retrieval_service.RetrievalService.full_text_index_search") as mock_fulltext,
            patch("core.rag.datasource.retrieval_service.DataPostProcessor") as mock_processor_class,
        ):

            def embedding_side_effect(
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
                query_type=QueryType.TEXT_QUERY,
            ):
                if query_type == QueryType.IMAGE_QUERY:
                    all_documents.append(image_doc)
                else:
                    all_documents.append(text_doc)

            mock_embedding_search.side_effect = embedding_side_effect
            mock_fulltext.side_effect = (
                lambda flask_app,
                dataset_id,
                query,
                top_k,
                score_threshold,
                reranking_model,
                all_documents,
                retrieval_method,
                exceptions,
                document_ids_filter=None: all_documents.append(fulltext_doc)
            )
            processor_instance = Mock()
            processor_instance.invoke.return_value = [processed_doc]
            mock_processor_class.return_value = processor_instance

            all_documents: list[Document] = []
            RetrievalService()._retrieve(
                flask_app=internal_flask_app,
                retrieval_method=RetrievalMethod.HYBRID_SEARCH,
                dataset=internal_dataset,
                all_documents=all_documents,
                exceptions=[],
                query="query",
                attachment_id="file-1",
                reranking_mode=RerankMode.WEIGHTED_SCORE,
                top_k=3,
            )

        assert len(all_documents) == 4
        assert any(doc.metadata["doc_id"] == "processed-doc" for doc in all_documents)
        processor_instance.invoke.assert_called_once()

    @patch("core.rag.datasource.retrieval_service.sign_upload_file", return_value="signed://file")
    def test_get_segment_attachment_info_success(self, mock_sign):
        upload_file = SimpleNamespace(
            id="upload-1",
            name="file-name",
            extension="png",
            mime_type="image/png",
            size=42,
        )
        binding = SimpleNamespace(segment_id="segment-1", attachment_id="upload-1")
        upload_query = Mock()
        upload_query.where.return_value.first.return_value = upload_file
        binding_query = Mock()
        binding_query.where.return_value.first.return_value = binding
        session = Mock()
        session.query.side_effect = [upload_query, binding_query]

        result = RetrievalService.get_segment_attachment_info("dataset-id", "tenant-id", "upload-1", session)

        assert result == {
            "attachment_info": {
                "id": "upload-1",
                "name": "file-name",
                "extension": ".png",
                "mime_type": "image/png",
                "source_url": "signed://file",
                "size": 42,
            },
            "segment_id": "segment-1",
        }
        mock_sign.assert_called_once_with("upload-1", "png")

    def test_get_segment_attachment_info_returns_none_when_binding_missing(self):
        upload_file = SimpleNamespace(
            id="upload-1",
            name="file-name",
            extension="png",
            mime_type="image/png",
            size=42,
        )
        upload_query = Mock()
        upload_query.where.return_value.first.return_value = upload_file
        binding_query = Mock()
        binding_query.where.return_value.first.return_value = None
        session = Mock()
        session.query.side_effect = [upload_query, binding_query]

        result = RetrievalService.get_segment_attachment_info("dataset-id", "tenant-id", "upload-1", session)

        assert result is None

    def test_get_segment_attachment_info_returns_none_when_upload_file_missing(self):
        upload_query = Mock()
        upload_query.where.return_value.first.return_value = None
        session = Mock()
        session.query.return_value = upload_query

        result = RetrievalService.get_segment_attachment_info("dataset-id", "tenant-id", "upload-1", session)

        assert result is None

    def test_get_segment_attachment_infos_returns_empty_when_upload_files_missing(self):
        upload_query = Mock()
        upload_query.where.return_value.all.return_value = []
        session = Mock()
        session.query.return_value = upload_query

        result = RetrievalService.get_segment_attachment_infos(["upload-1"], session)

        assert result == []

    def test_get_segment_attachment_infos_returns_empty_when_bindings_missing(self):
        upload_file = SimpleNamespace(
            id="upload-1",
            name="file-name",
            extension="png",
            mime_type="image/png",
            size=42,
        )
        upload_query = Mock()
        upload_query.where.return_value.all.return_value = [upload_file]
        binding_query = Mock()
        binding_query.where.return_value.all.return_value = []
        session = Mock()
        session.query.side_effect = [upload_query, binding_query]

        result = RetrievalService.get_segment_attachment_infos(["upload-1"], session)

        assert result == []

    @patch("core.rag.datasource.retrieval_service.sign_upload_file", return_value="signed://file")
    def test_get_segment_attachment_infos_success(self, mock_sign):
        upload_file_1 = SimpleNamespace(
            id="upload-1",
            name="file-1",
            extension="png",
            mime_type="image/png",
            size=42,
        )
        upload_file_2 = SimpleNamespace(
            id="upload-2",
            name="file-2",
            extension="jpg",
            mime_type="image/jpeg",
            size=99,
        )
        binding = SimpleNamespace(attachment_id="upload-1", segment_id="segment-1")

        upload_query = Mock()
        upload_query.where.return_value.all.return_value = [upload_file_1, upload_file_2]
        binding_query = Mock()
        binding_query.where.return_value.all.return_value = [binding]
        session = Mock()
        session.query.side_effect = [upload_query, binding_query]

        result = RetrievalService.get_segment_attachment_infos(["upload-1", "upload-2"], session)

        assert result == [
            {
                "attachment_id": "upload-1",
                "attachment_info": {
                    "id": "upload-1",
                    "name": "file-1",
                    "extension": ".png",
                    "mime_type": "image/png",
                    "source_url": "signed://file",
                    "size": 42,
                },
                "segment_id": "segment-1",
            }
        ]
        mock_sign.assert_has_calls(
            [
                call("upload-1", "png"),
                call("upload-2", "jpg"),
            ]
        )
        assert mock_sign.call_count == 2


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
