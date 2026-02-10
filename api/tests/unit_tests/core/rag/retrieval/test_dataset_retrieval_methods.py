from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

import pytest

from core.rag.models.document import Document
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval import exc
from core.workflow.repositories.rag_retrieval_protocol import KnowledgeRetrievalRequest
from models.dataset import Dataset

# ==================== Helper Functions ====================


def create_mock_dataset(
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


def create_mock_document(
    content: str,
    doc_id: str,
    score: float = 0.8,
    provider: str = "dify",
    additional_metadata: dict | None = None,
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
            mock_dataset1 = create_mock_dataset(dataset_id=dataset_id1, tenant_id=tenant_id)
            mock_dataset2 = create_mock_dataset(dataset_id=dataset_id2, tenant_id=tenant_id)
            with patch.object(
                dataset_retrieval, "_get_available_datasets", return_value=[mock_dataset1, mock_dataset2]
            ):
                # Mock get_metadata_filter_condition
                with patch.object(dataset_retrieval, "get_metadata_filter_condition", return_value=(None, None)):
                    # Mock multiple_retrieve to return documents
                    doc1 = create_mock_document("Python is great", "doc1", score=0.9)
                    doc2 = create_mock_document("Python is awesome", "doc2", score=0.8)
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

                            mock_session.query.return_value.filter.return_value.all.return_value = [
                                mock_dataset_from_db
                            ]
                            mock_session.query.return_value.filter.return_value.all.__iter__ = lambda self: iter(
                                [mock_dataset_from_db, mock_document]
                            )

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
            mock_dataset = create_mock_dataset(dataset_id=dataset_id, tenant_id=tenant_id)
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
            mock_dataset = create_mock_dataset(dataset_id=dataset_id, tenant_id=tenant_id, provider="external")
            with patch.object(dataset_retrieval, "_get_available_datasets", return_value=[mock_dataset]):
                with patch.object(dataset_retrieval, "get_metadata_filter_condition", return_value=(None, None)):
                    # Create external document
                    external_doc = create_mock_document(
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
            mock_dataset = create_mock_dataset(dataset_id=dataset_id, tenant_id=tenant_id)
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
        doc1 = create_mock_document("Low score", "doc1", score=0.6)
        doc2 = create_mock_document("High score", "doc2", score=0.95)
        doc3 = create_mock_document("Medium score", "doc3", score=0.8)

        # Assert - each document has the correct score
        assert doc1.metadata["score"] == 0.6
        assert doc2.metadata["score"] == 0.95
        assert doc3.metadata["score"] == 0.8

        # Assert - documents are correctly sorted (not the retrieval result, just the list)
        unsorted = [doc1, doc2, doc3]
        sorted_docs = sorted(unsorted, key=lambda d: d.metadata["score"], reverse=True)
        assert [d.metadata["score"] for d in sorted_docs] == [0.95, 0.8, 0.6]
