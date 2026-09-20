"""external dataset retrieval tests."""

import json
import re
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from models.dataset import ExternalKnowledgeApis, ExternalKnowledgeBindings
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.external_knowledge_service import ExternalDatasetService
from tests.unit_tests.services._external_dataset_helpers import (
    ExternalDatasetServiceTestDataFactory,
    _add_and_commit,
    _make_external_knowledge_api,
    _make_external_knowledge_binding,
    _seed_external_retrieval_dependencies,
)
from tests.unit_tests.services._external_dataset_helpers import (
    factory as factory,  # noqa: PLC0414 - register the shared pytest fixture
)


@pytest.mark.parametrize("sqlite_session", [(ExternalKnowledgeApis, ExternalKnowledgeBindings)], indirect=True)
class TestExternalDatasetServiceFetchRetrieval:
    """Test fetch_external_knowledge_retrieval operations."""

    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_success_with_results(
        self, mock_process, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test successful external knowledge retrieval with results."""
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"
        query = "test query for retrieval"

        _seed_external_retrieval_dependencies(sqlite_session, tenant_id=tenant_id, dataset_id=dataset_id)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "records": [
                {"content": "result 1", "score": 0.9},
                {"content": "result 2", "score": 0.8},
            ]
        }
        mock_process.return_value = mock_response

        external_retrieval_parameters = {"top_k": 5, "score_threshold_enabled": False}

        # Act
        result = ExternalDatasetService.fetch_external_knowledge_retrieval(
            tenant_id, dataset_id, query, external_retrieval_parameters, session=sqlite_session
        )

        # Assert
        assert len(result) == 2
        assert result[0]["content"] == "result 1"
        assert result[1]["score"] == 0.8

    def test_fetch_external_knowledge_retrieval_binding_not_found_error(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when external knowledge binding is not found."""
        # Act & Assert
        with pytest.raises(ExternalKnowledgeRetrievalError, match="external knowledge binding not found"):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                "tenant-123", "dataset-123", "query", {}, session=sqlite_session
            )

    def test_fetch_external_knowledge_retrieval_cross_tenant_api_template_error(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when a binding points to an API template outside the dataset tenant."""
        # Arrange
        binding = _make_external_knowledge_binding(tenant_id="tenant-123", external_knowledge_api_id="api-123")
        cross_tenant_api = _make_external_knowledge_api(api_id="api-123", tenant_id="other-tenant")
        _add_and_commit(sqlite_session, binding, cross_tenant_api)

        # Act & Assert
        with pytest.raises(ExternalKnowledgeRetrievalError, match="external api template not found"):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                "tenant-123", "dataset-123", "query", {}, session=sqlite_session
            )

    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_empty_results(
        self, mock_process, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test retrieval with empty results."""
        # Arrange
        _seed_external_retrieval_dependencies(sqlite_session)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"records": []}
        mock_process.return_value = mock_response

        # Act
        result = ExternalDatasetService.fetch_external_knowledge_retrieval(
            "tenant-123", "dataset-123", "query", {"top_k": 5}, session=sqlite_session
        )

        # Assert
        assert len(result) == 0

    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_with_score_threshold(
        self, mock_process, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test retrieval with score threshold enabled."""
        # Arrange
        _seed_external_retrieval_dependencies(sqlite_session)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"records": [{"content": "high score result"}]}
        mock_process.return_value = mock_response

        external_retrieval_parameters = {
            "top_k": 5,
            "score_threshold_enabled": True,
            "score_threshold": 0.75,
        }

        # Act
        result = ExternalDatasetService.fetch_external_knowledge_retrieval(
            "tenant-123",
            "dataset-123",
            "query",
            external_retrieval_parameters,
            session=sqlite_session,
        )

        # Assert
        assert len(result) == 1
        # Verify score threshold was passed in request
        call_args = mock_process.call_args[0][0]
        assert call_args.params["retrieval_setting"]["score_threshold"] == 0.75

    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_non_200_status_raises_exception(
        self, mock_process, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test that non-200 status code raises Exception with response text."""
        # Arrange
        _seed_external_retrieval_dependencies(sqlite_session)

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error: Database connection failed"
        mock_process.return_value = mock_response

        # Act & Assert
        with pytest.raises(ExternalKnowledgeRetrievalError, match="Internal Server Error: Database connection failed"):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                "tenant-123", "dataset-123", "query", {"top_k": 5}, session=sqlite_session
            )

    @pytest.mark.parametrize(
        ("status_code", "error_message"),
        [
            (400, "Bad Request: Invalid query parameters"),
            (401, "Unauthorized: Invalid API key"),
            (403, "Forbidden: Access denied to resource"),
            (404, "Not Found: Knowledge base not found"),
            (429, "Too Many Requests: Rate limit exceeded"),
            (500, "Internal Server Error: Database connection failed"),
            (502, "Bad Gateway: External service unavailable"),
            (503, "Service Unavailable: Maintenance mode"),
        ],
    )
    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_various_error_status_codes(
        self,
        mock_process,
        factory: ExternalDatasetServiceTestDataFactory,
        sqlite_session: Session,
        status_code,
        error_message,
    ):
        """Test that various error status codes raise exceptions with response text."""
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"

        _seed_external_retrieval_dependencies(sqlite_session, tenant_id=tenant_id, dataset_id=dataset_id)

        mock_response = MagicMock()
        mock_response.status_code = status_code
        mock_response.text = error_message
        mock_process.return_value = mock_response

        # Act & Assert
        with pytest.raises(ExternalKnowledgeRetrievalError, match=re.escape(error_message)):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                tenant_id, dataset_id, "query", {"top_k": 5}, session=sqlite_session
            )

    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_empty_response_text(
        self, mock_process, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test exception with empty response text."""
        # Arrange
        _seed_external_retrieval_dependencies(sqlite_session)

        mock_response = MagicMock()
        mock_response.status_code = 503
        mock_response.text = ""
        mock_process.return_value = mock_response

        # Act & Assert
        with pytest.raises(ExternalKnowledgeRetrievalError):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                "tenant-123", "dataset-123", "query", {"top_k": 5}, session=sqlite_session
            )

    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_invalid_json_response(
        self, mock_process, factory, sqlite_session: Session
    ):
        """Test malformed JSON success responses are normalized to external retrieval errors."""
        _seed_external_retrieval_dependencies(sqlite_session)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.side_effect = json.JSONDecodeError("Expecting value", "", 0)
        mock_process.return_value = mock_response

        with pytest.raises(ExternalKnowledgeRetrievalError, match="invalid external knowledge response"):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                "tenant-123", "dataset-123", "query", {"top_k": 5}, session=sqlite_session
            )

    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_invalid_success_payload_shape(
        self, mock_process, factory, sqlite_session: Session
    ):
        """Test malformed success payload shapes are normalized to external retrieval errors."""
        _seed_external_retrieval_dependencies(sqlite_session)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = ["not-a-dict"]
        mock_process.return_value = mock_response

        with pytest.raises(ExternalKnowledgeRetrievalError, match="invalid external knowledge response"):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                "tenant-123", "dataset-123", "query", {"top_k": 5}, session=sqlite_session
            )

    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_invalid_records_shape(
        self, mock_process, factory, sqlite_session: Session
    ):
        """Test non-list records payloads are normalized to external retrieval errors."""
        _seed_external_retrieval_dependencies(sqlite_session)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"records": {"unexpected": "shape"}}
        mock_process.return_value = mock_response

        with pytest.raises(ExternalKnowledgeRetrievalError, match="invalid external knowledge response"):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                "tenant-123", "dataset-123", "query", {"top_k": 5}, session=sqlite_session
            )

    @patch("services.external_knowledge_service.ExternalDatasetService.process_external_api")
    def test_fetch_external_knowledge_retrieval_wraps_transport_errors(
        self, mock_process, factory, sqlite_session: Session
    ):
        """Test transport/runtime failures are normalized to external retrieval errors."""
        _seed_external_retrieval_dependencies(sqlite_session)
        mock_process.side_effect = RuntimeError("connection reset by peer")

        with pytest.raises(ExternalKnowledgeRetrievalError, match="connection reset by peer"):
            ExternalDatasetService.fetch_external_knowledge_retrieval(
                "tenant-123", "dataset-123", "query", {"top_k": 5}, session=sqlite_session
            )
