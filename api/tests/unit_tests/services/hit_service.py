"""
Unit tests for HitTestingService.

This module contains comprehensive unit tests for the HitTestingService class,
which handles retrieval testing operations for datasets, including internal
dataset retrieval and external knowledge base retrieval.
"""

from unittest.mock import MagicMock, Mock, patch

import pytest

from core.rag.models.document import Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from models import Account
from models.dataset import Dataset
from services.hit_testing_service import HitTestingService


class HitTestingTestDataFactory:
    """
    Factory class for creating test data and mock objects for hit testing service tests.

    This factory provides static methods to create mock objects for datasets, users,
    documents, and retrieval records used in HitTestingService unit tests.
    """

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        provider: str = "vendor",
        retrieval_model: dict | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock dataset with specified attributes.

        Args:
            dataset_id: Unique identifier for the dataset
            tenant_id: Tenant identifier
            provider: Dataset provider (vendor, external, etc.)
            retrieval_model: Optional retrieval model configuration
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Dataset instance
        """
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.provider = provider
        dataset.retrieval_model = retrieval_model
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str = "user-789",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock user (Account) with specified attributes.

        Args:
            user_id: Unique identifier for the user
            tenant_id: Tenant identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as an Account instance
        """
        user = Mock(spec=Account)
        user.id = user_id
        user.current_tenant_id = tenant_id
        user.name = "Test User"
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user

    @staticmethod
    def create_document_mock(
        content: str = "Test document content",
        metadata: dict | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock Document from core.rag.models.document.

        Args:
            content: Document content/text
            metadata: Optional metadata dictionary
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Document instance
        """
        document = Mock(spec=Document)
        document.page_content = content
        document.metadata = metadata or {}
        for key, value in kwargs.items():
            setattr(document, key, value)
        return document

    @staticmethod
    def create_retrieval_record_mock(
        content: str = "Test content",
        score: float = 0.95,
        **kwargs,
    ) -> Mock:
        """
        Create a mock retrieval record.

        Args:
            content: Record content
            score: Retrieval score
            **kwargs: Additional fields for the record

        Returns:
            Mock object with model_dump method returning record data
        """
        record = Mock()
        record.model_dump.return_value = {
            "content": content,
            "score": score,
            **kwargs,
        }
        return record


class TestHitTestingServiceRetrieve:
    """
    Tests for HitTestingService.retrieve method (hit_testing).

    This test class covers the main retrieval testing functionality, including
    various retrieval model configurations, metadata filtering, and query logging.
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session.

        Provides a mocked database session for testing database operations
        like adding and committing DatasetQuery records.
        """
        with patch("services.hit_testing_service.db.session") as mock_db:
            yield mock_db

    def test_retrieve_success_with_default_retrieval_model(self, mock_db_session):
        """
        Test successful retrieval with default retrieval model.

        Verifies that the retrieve method works correctly when no custom
        retrieval model is provided, using the default retrieval configuration.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock(retrieval_model=None)
        account = HitTestingTestDataFactory.create_user_mock()
        query = "test query"
        retrieval_model = None
        external_retrieval_model = {}

        documents = [
            HitTestingTestDataFactory.create_document_mock(content="Doc 1"),
            HitTestingTestDataFactory.create_document_mock(content="Doc 2"),
        ]

        mock_records = [
            HitTestingTestDataFactory.create_retrieval_record_mock(content="Doc 1"),
            HitTestingTestDataFactory.create_retrieval_record_mock(content="Doc 2"),
        ]

        with (
            patch("services.hit_testing_service.RetrievalService.retrieve") as mock_retrieve,
            patch("services.hit_testing_service.RetrievalService.format_retrieval_documents") as mock_format,
            patch("services.hit_testing_service.time.perf_counter") as mock_perf_counter,
        ):
            mock_perf_counter.side_effect = [0.0, 0.1]  # start, end
            mock_retrieve.return_value = documents
            mock_format.return_value = mock_records

            # Act
            result = HitTestingService.retrieve(dataset, query, account, retrieval_model, external_retrieval_model)

            # Assert
            assert result["query"]["content"] == query
            assert len(result["records"]) == 2
            mock_retrieve.assert_called_once()
            mock_db_session.add.assert_called_once()
            mock_db_session.commit.assert_called_once()

    def test_retrieve_success_with_custom_retrieval_model(self, mock_db_session):
        """
        Test successful retrieval with custom retrieval model.

        Verifies that custom retrieval model parameters (search method, reranking,
        score threshold, etc.) are properly passed to RetrievalService.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock()
        account = HitTestingTestDataFactory.create_user_mock()
        query = "test query"
        retrieval_model = {
            "search_method": RetrievalMethod.KEYWORD_SEARCH,
            "reranking_enable": True,
            "reranking_model": {"reranking_provider_name": "cohere", "reranking_model_name": "rerank-1"},
            "top_k": 5,
            "score_threshold_enabled": True,
            "score_threshold": 0.7,
            "weights": {"vector_setting": 0.5, "keyword_setting": 0.5},
        }
        external_retrieval_model = {}

        documents = [HitTestingTestDataFactory.create_document_mock()]
        mock_records = [HitTestingTestDataFactory.create_retrieval_record_mock()]

        with (
            patch("services.hit_testing_service.RetrievalService.retrieve") as mock_retrieve,
            patch("services.hit_testing_service.RetrievalService.format_retrieval_documents") as mock_format,
            patch("services.hit_testing_service.time.perf_counter") as mock_perf_counter,
        ):
            mock_perf_counter.side_effect = [0.0, 0.1]
            mock_retrieve.return_value = documents
            mock_format.return_value = mock_records

            # Act
            result = HitTestingService.retrieve(dataset, query, account, retrieval_model, external_retrieval_model)

            # Assert
            assert result["query"]["content"] == query
            mock_retrieve.assert_called_once()
            call_kwargs = mock_retrieve.call_args[1]
            assert call_kwargs["retrieval_method"] == RetrievalMethod.KEYWORD_SEARCH
            assert call_kwargs["top_k"] == 5
            assert call_kwargs["score_threshold"] == 0.7
            assert call_kwargs["reranking_model"] == retrieval_model["reranking_model"]

    def test_retrieve_with_metadata_filtering(self, mock_db_session):
        """
        Test retrieval with metadata filtering conditions.

        Verifies that metadata filtering conditions are properly processed
        and document ID filters are applied to the retrieval query.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock()
        account = HitTestingTestDataFactory.create_user_mock()
        query = "test query"
        retrieval_model = {
            "metadata_filtering_conditions": {
                "conditions": [
                    {"field": "category", "operator": "is", "value": "test"},
                ],
            },
        }
        external_retrieval_model = {}

        mock_dataset_retrieval = MagicMock()
        mock_dataset_retrieval.get_metadata_filter_condition.return_value = (
            {dataset.id: ["doc-1", "doc-2"]},
            None,
        )

        documents = [HitTestingTestDataFactory.create_document_mock()]
        mock_records = [HitTestingTestDataFactory.create_retrieval_record_mock()]

        with (
            patch("services.hit_testing_service.RetrievalService.retrieve") as mock_retrieve,
            patch("services.hit_testing_service.RetrievalService.format_retrieval_documents") as mock_format,
            patch("services.hit_testing_service.DatasetRetrieval") as mock_dataset_retrieval_class,
            patch("services.hit_testing_service.time.perf_counter") as mock_perf_counter,
        ):
            mock_perf_counter.side_effect = [0.0, 0.1]
            mock_dataset_retrieval_class.return_value = mock_dataset_retrieval
            mock_retrieve.return_value = documents
            mock_format.return_value = mock_records

            # Act
            result = HitTestingService.retrieve(dataset, query, account, retrieval_model, external_retrieval_model)

            # Assert
            assert result["query"]["content"] == query
            mock_dataset_retrieval.get_metadata_filter_condition.assert_called_once()
            call_kwargs = mock_retrieve.call_args[1]
            assert call_kwargs["document_ids_filter"] == ["doc-1", "doc-2"]

    def test_retrieve_with_metadata_filtering_no_documents(self, mock_db_session):
        """
        Test retrieval with metadata filtering that returns no documents.

        Verifies that when metadata filtering results in no matching documents,
        an empty result is returned without calling RetrievalService.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock()
        account = HitTestingTestDataFactory.create_user_mock()
        query = "test query"
        retrieval_model = {
            "metadata_filtering_conditions": {
                "conditions": [
                    {"field": "category", "operator": "is", "value": "test"},
                ],
            },
        }
        external_retrieval_model = {}

        mock_dataset_retrieval = MagicMock()
        mock_dataset_retrieval.get_metadata_filter_condition.return_value = ({}, True)

        with (
            patch("services.hit_testing_service.DatasetRetrieval") as mock_dataset_retrieval_class,
            patch("services.hit_testing_service.RetrievalService.format_retrieval_documents") as mock_format,
        ):
            mock_dataset_retrieval_class.return_value = mock_dataset_retrieval
            mock_format.return_value = []

            # Act
            result = HitTestingService.retrieve(dataset, query, account, retrieval_model, external_retrieval_model)

            # Assert
            assert result["query"]["content"] == query
            assert result["records"] == []

    def test_retrieve_with_dataset_retrieval_model(self, mock_db_session):
        """
        Test retrieval using dataset's retrieval model when not provided.

        Verifies that when no retrieval model is provided, the dataset's
        retrieval model is used as a fallback.
        """
        # Arrange
        dataset_retrieval_model = {
            "search_method": RetrievalMethod.HYBRID_SEARCH,
            "top_k": 3,
        }
        dataset = HitTestingTestDataFactory.create_dataset_mock(retrieval_model=dataset_retrieval_model)
        account = HitTestingTestDataFactory.create_user_mock()
        query = "test query"
        retrieval_model = None
        external_retrieval_model = {}

        documents = [HitTestingTestDataFactory.create_document_mock()]
        mock_records = [HitTestingTestDataFactory.create_retrieval_record_mock()]

        with (
            patch("services.hit_testing_service.RetrievalService.retrieve") as mock_retrieve,
            patch("services.hit_testing_service.RetrievalService.format_retrieval_documents") as mock_format,
            patch("services.hit_testing_service.time.perf_counter") as mock_perf_counter,
        ):
            mock_perf_counter.side_effect = [0.0, 0.1]
            mock_retrieve.return_value = documents
            mock_format.return_value = mock_records

            # Act
            result = HitTestingService.retrieve(dataset, query, account, retrieval_model, external_retrieval_model)

            # Assert
            assert result["query"]["content"] == query
            call_kwargs = mock_retrieve.call_args[1]
            assert call_kwargs["retrieval_method"] == RetrievalMethod.HYBRID_SEARCH
            assert call_kwargs["top_k"] == 3


class TestHitTestingServiceExternalRetrieve:
    """
    Tests for HitTestingService.external_retrieve method.

    This test class covers external knowledge base retrieval functionality,
    including query escaping, response formatting, and provider validation.
    """

    @pytest.fixture
    def mock_db_session(self):
        """
        Mock database session.

        Provides a mocked database session for testing database operations
        like adding and committing DatasetQuery records.
        """
        with patch("services.hit_testing_service.db.session") as mock_db:
            yield mock_db

    def test_external_retrieve_success(self, mock_db_session):
        """
        Test successful external retrieval.

        Verifies that external knowledge base retrieval works correctly,
        including query escaping, document formatting, and query logging.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock(provider="external")
        account = HitTestingTestDataFactory.create_user_mock()
        query = 'test query with "quotes"'
        external_retrieval_model = {"top_k": 5, "score_threshold": 0.8}
        metadata_filtering_conditions = {}

        external_documents = [
            {"content": "External doc 1", "title": "Title 1", "score": 0.95, "metadata": {"key": "value"}},
            {"content": "External doc 2", "title": "Title 2", "score": 0.85, "metadata": {}},
        ]

        with (
            patch("services.hit_testing_service.RetrievalService.external_retrieve") as mock_external_retrieve,
            patch("services.hit_testing_service.time.perf_counter") as mock_perf_counter,
        ):
            mock_perf_counter.side_effect = [0.0, 0.1]
            mock_external_retrieve.return_value = external_documents

            # Act
            result = HitTestingService.external_retrieve(
                dataset, query, account, external_retrieval_model, metadata_filtering_conditions
            )

            # Assert
            assert result["query"]["content"] == query
            assert len(result["records"]) == 2
            assert result["records"][0]["content"] == "External doc 1"
            assert result["records"][0]["title"] == "Title 1"
            assert result["records"][0]["score"] == 0.95
            mock_external_retrieve.assert_called_once()
            # Verify query was escaped
            assert mock_external_retrieve.call_args[1]["query"] == 'test query with \\"quotes\\"'
            mock_db_session.add.assert_called_once()
            mock_db_session.commit.assert_called_once()

    def test_external_retrieve_non_external_provider(self, mock_db_session):
        """
        Test external retrieval with non-external provider (should return empty).

        Verifies that when the dataset provider is not "external", the method
        returns an empty result without performing retrieval or database operations.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock(provider="vendor")
        account = HitTestingTestDataFactory.create_user_mock()
        query = "test query"
        external_retrieval_model = {}
        metadata_filtering_conditions = {}

        # Act
        result = HitTestingService.external_retrieve(
            dataset, query, account, external_retrieval_model, metadata_filtering_conditions
        )

        # Assert
        assert result["query"]["content"] == query
        assert result["records"] == []
        mock_db_session.add.assert_not_called()

    def test_external_retrieve_with_metadata_filtering(self, mock_db_session):
        """
        Test external retrieval with metadata filtering conditions.

        Verifies that metadata filtering conditions are properly passed
        to the external retrieval service.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock(provider="external")
        account = HitTestingTestDataFactory.create_user_mock()
        query = "test query"
        external_retrieval_model = {"top_k": 3}
        metadata_filtering_conditions = {"category": "test"}

        external_documents = [{"content": "Doc 1", "title": "Title", "score": 0.9, "metadata": {}}]

        with (
            patch("services.hit_testing_service.RetrievalService.external_retrieve") as mock_external_retrieve,
            patch("services.hit_testing_service.time.perf_counter") as mock_perf_counter,
        ):
            mock_perf_counter.side_effect = [0.0, 0.1]
            mock_external_retrieve.return_value = external_documents

            # Act
            result = HitTestingService.external_retrieve(
                dataset, query, account, external_retrieval_model, metadata_filtering_conditions
            )

            # Assert
            assert result["query"]["content"] == query
            assert len(result["records"]) == 1
            call_kwargs = mock_external_retrieve.call_args[1]
            assert call_kwargs["metadata_filtering_conditions"] == metadata_filtering_conditions

    def test_external_retrieve_empty_documents(self, mock_db_session):
        """
        Test external retrieval with empty document list.

        Verifies that when external retrieval returns no documents,
        an empty result is properly formatted and returned.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock(provider="external")
        account = HitTestingTestDataFactory.create_user_mock()
        query = "test query"
        external_retrieval_model = {}
        metadata_filtering_conditions = {}

        with (
            patch("services.hit_testing_service.RetrievalService.external_retrieve") as mock_external_retrieve,
            patch("services.hit_testing_service.time.perf_counter") as mock_perf_counter,
        ):
            mock_perf_counter.side_effect = [0.0, 0.1]
            mock_external_retrieve.return_value = []

            # Act
            result = HitTestingService.external_retrieve(
                dataset, query, account, external_retrieval_model, metadata_filtering_conditions
            )

            # Assert
            assert result["query"]["content"] == query
            assert result["records"] == []


class TestHitTestingServiceCompactRetrieveResponse:
    """
    Tests for HitTestingService.compact_retrieve_response method.

    This test class covers response formatting for internal dataset retrieval,
    ensuring documents are properly formatted into retrieval records.
    """

    def test_compact_retrieve_response_success(self):
        """
        Test successful response formatting.

        Verifies that documents are properly formatted into retrieval records
        with correct structure and data.
        """
        # Arrange
        query = "test query"
        documents = [
            HitTestingTestDataFactory.create_document_mock(content="Doc 1"),
            HitTestingTestDataFactory.create_document_mock(content="Doc 2"),
        ]

        mock_records = [
            HitTestingTestDataFactory.create_retrieval_record_mock(content="Doc 1", score=0.95),
            HitTestingTestDataFactory.create_retrieval_record_mock(content="Doc 2", score=0.85),
        ]

        with patch("services.hit_testing_service.RetrievalService.format_retrieval_documents") as mock_format:
            mock_format.return_value = mock_records

            # Act
            result = HitTestingService.compact_retrieve_response(query, documents)

            # Assert
            assert result["query"]["content"] == query
            assert len(result["records"]) == 2
            assert result["records"][0]["content"] == "Doc 1"
            assert result["records"][0]["score"] == 0.95
            mock_format.assert_called_once_with(documents)

    def test_compact_retrieve_response_empty_documents(self):
        """
        Test response formatting with empty document list.

        Verifies that an empty document list results in an empty records array
        while maintaining the correct response structure.
        """
        # Arrange
        query = "test query"
        documents = []

        with patch("services.hit_testing_service.RetrievalService.format_retrieval_documents") as mock_format:
            mock_format.return_value = []

            # Act
            result = HitTestingService.compact_retrieve_response(query, documents)

            # Assert
            assert result["query"]["content"] == query
            assert result["records"] == []


class TestHitTestingServiceCompactExternalRetrieveResponse:
    """
    Tests for HitTestingService.compact_external_retrieve_response method.

    This test class covers response formatting for external knowledge base
    retrieval, ensuring proper field extraction and provider validation.
    """

    def test_compact_external_retrieve_response_external_provider(self):
        """
        Test external response formatting for external provider.

        Verifies that external documents are properly formatted with all
        required fields (content, title, score, metadata).
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock(provider="external")
        query = "test query"
        documents = [
            {"content": "Doc 1", "title": "Title 1", "score": 0.95, "metadata": {"key": "value"}},
            {"content": "Doc 2", "title": "Title 2", "score": 0.85, "metadata": {}},
        ]

        # Act
        result = HitTestingService.compact_external_retrieve_response(dataset, query, documents)

        # Assert
        assert result["query"]["content"] == query
        assert len(result["records"]) == 2
        assert result["records"][0]["content"] == "Doc 1"
        assert result["records"][0]["title"] == "Title 1"
        assert result["records"][0]["score"] == 0.95
        assert result["records"][0]["metadata"] == {"key": "value"}

    def test_compact_external_retrieve_response_non_external_provider(self):
        """
        Test external response formatting for non-external provider.

        Verifies that non-external providers return an empty records array
        regardless of input documents.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock(provider="vendor")
        query = "test query"
        documents = [{"content": "Doc 1"}]

        # Act
        result = HitTestingService.compact_external_retrieve_response(dataset, query, documents)

        # Assert
        assert result["query"]["content"] == query
        assert result["records"] == []

    def test_compact_external_retrieve_response_missing_fields(self):
        """
        Test external response formatting with missing optional fields.

        Verifies that missing optional fields (title, score, metadata) are
        handled gracefully by setting them to None.
        """
        # Arrange
        dataset = HitTestingTestDataFactory.create_dataset_mock(provider="external")
        query = "test query"
        documents = [
            {"content": "Doc 1"},  # Missing title, score, metadata
            {"content": "Doc 2", "title": "Title 2"},  # Missing score, metadata
        ]

        # Act
        result = HitTestingService.compact_external_retrieve_response(dataset, query, documents)

        # Assert
        assert result["query"]["content"] == query
        assert len(result["records"]) == 2
        assert result["records"][0]["content"] == "Doc 1"
        assert result["records"][0]["title"] is None
        assert result["records"][0]["score"] is None
        assert result["records"][0]["metadata"] is None


class TestHitTestingServiceHitTestingArgsCheck:
    """
    Tests for HitTestingService.hit_testing_args_check method.

    This test class covers query argument validation, ensuring queries
    meet the required criteria (non-empty, max 250 characters).
    """

    def test_hit_testing_args_check_success(self):
        """
        Test successful argument validation.

        Verifies that valid queries pass validation without raising errors.
        """
        # Arrange
        args = {"query": "valid query"}

        # Act & Assert (should not raise)
        HitTestingService.hit_testing_args_check(args)

    def test_hit_testing_args_check_empty_query(self):
        """
        Test validation fails with empty query.

        Verifies that empty queries raise a ValueError with appropriate message.
        """
        # Arrange
        args = {"query": ""}

        # Act & Assert
        with pytest.raises(ValueError, match="Query is required and cannot exceed 250 characters"):
            HitTestingService.hit_testing_args_check(args)

    def test_hit_testing_args_check_none_query(self):
        """
        Test validation fails with None query.

        Verifies that None queries raise a ValueError with appropriate message.
        """
        # Arrange
        args = {"query": None}

        # Act & Assert
        with pytest.raises(ValueError, match="Query is required and cannot exceed 250 characters"):
            HitTestingService.hit_testing_args_check(args)

    def test_hit_testing_args_check_too_long_query(self):
        """
        Test validation fails with query exceeding 250 characters.

        Verifies that queries longer than 250 characters raise a ValueError.
        """
        # Arrange
        args = {"query": "a" * 251}

        # Act & Assert
        with pytest.raises(ValueError, match="Query is required and cannot exceed 250 characters"):
            HitTestingService.hit_testing_args_check(args)

    def test_hit_testing_args_check_exactly_250_characters(self):
        """
        Test validation succeeds with exactly 250 characters.

        Verifies that queries with exactly 250 characters (the maximum)
        pass validation successfully.
        """
        # Arrange
        args = {"query": "a" * 250}

        # Act & Assert (should not raise)
        HitTestingService.hit_testing_args_check(args)


class TestHitTestingServiceEscapeQueryForSearch:
    """
    Tests for HitTestingService.escape_query_for_search method.

    This test class covers query escaping functionality for external search,
    ensuring special characters are properly escaped.
    """

    def test_escape_query_for_search_with_quotes(self):
        """
        Test escaping quotes in query.

        Verifies that double quotes in queries are properly escaped with
        backslashes for external search compatibility.
        """
        # Arrange
        query = 'test query with "quotes"'

        # Act
        result = HitTestingService.escape_query_for_search(query)

        # Assert
        assert result == 'test query with \\"quotes\\"'

    def test_escape_query_for_search_without_quotes(self):
        """
        Test query without quotes (no change).

        Verifies that queries without quotes remain unchanged after escaping.
        """
        # Arrange
        query = "test query without quotes"

        # Act
        result = HitTestingService.escape_query_for_search(query)

        # Assert
        assert result == query

    def test_escape_query_for_search_multiple_quotes(self):
        """
        Test escaping multiple quotes in query.

        Verifies that all occurrences of double quotes in a query are
        properly escaped, not just the first one.
        """
        # Arrange
        query = 'test "query" with "multiple" quotes'

        # Act
        result = HitTestingService.escape_query_for_search(query)

        # Assert
        assert result == 'test \\"query\\" with \\"multiple\\" quotes'

    def test_escape_query_for_search_empty_string(self):
        """
        Test escaping empty string.

        Verifies that empty strings are handled correctly and remain empty
        after the escaping operation.
        """
        # Arrange
        query = ""

        # Act
        result = HitTestingService.escape_query_for_search(query)

        # Assert
        assert result == ""
