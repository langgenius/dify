"""Tests for external knowledge API, binding, dataset, and retrieval operations.

Database-facing cases persist the minimum required ``TypeBase`` tables through
the shared in-memory SQLite fixture, including cross-tenant rows. HTTP calls,
pagination, and clocks remain mocked at their genuine I/O boundaries.
"""

import json
from datetime import datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from models.dataset import Dataset, ExternalKnowledgeApis, ExternalKnowledgeBindings
from repositories.knowledge import external_repository
from services.errors.dataset import DatasetNameDuplicateError
from services.knowledge.entities.external import ExternalDatasetCreatePayload, ExternalKnowledgeApiSetting
from services.knowledge.external.adapters import ExternalKnowledgeGateway


class ExternalDatasetServiceTestDataFactory:
    """Build non-session value objects used by tests outside persistence paths."""

    @staticmethod
    def create_external_knowledge_api_mock(
        api_id: str = "api-123",
        tenant_id: str = "tenant-123",
        name: str = "Test API",
        settings: dict[str, Any] | None = None,
        description: str = "Test description",
        created_by: str = "user-123",
        updated_by: str = "user-123",
        created_at: datetime = datetime(2024, 1, 1, 12, 0),
        updated_at: datetime = datetime(2024, 1, 1, 12, 0),
    ) -> ExternalKnowledgeApis:
        """Create an ExternalKnowledgeApis object."""
        api = ExternalKnowledgeApis(
            name=name,
            description=description,
            tenant_id=tenant_id,
            settings="{}",
            created_by=created_by,
            updated_by=updated_by,
        )
        api.id = api_id

        if settings is None:
            settings = {"endpoint": "https://api.example.com", "api_key": "test-key-123"}

        api.settings = json.dumps(settings, ensure_ascii=False)
        api.created_at = created_at
        api.updated_at = updated_at

        return api

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        name: str = "Test Dataset",
        provider: str = "external",
        description: str = "",
        retrieval_model: dict[str, Any] | None = None,
        created_by: str = "user-123",
    ) -> Dataset:
        """Create a Dataset object."""
        return Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name=name,
            provider=provider,
            description=description,
            retrieval_model=retrieval_model or {},
            created_by=created_by,
        )

    @staticmethod
    def create_external_knowledge_binding_mock(
        binding_id: str = "binding-123",
        tenant_id: str = "tenant-123",
        dataset_id: str = "dataset-123",
        external_knowledge_api_id: str = "api-123",
        external_knowledge_id: str = "knowledge-123",
        created_by: str = "user-123",
    ) -> ExternalKnowledgeBindings:
        """Create an ExternalKnowledgeBindings object."""
        binding = ExternalKnowledgeBindings(
            tenant_id=tenant_id,
            external_knowledge_api_id=external_knowledge_api_id,
            dataset_id=dataset_id,
            external_knowledge_id=external_knowledge_id,
            created_by=created_by,
        )
        binding.id = binding_id

        return binding

    @staticmethod
    def create_api_setting_mock(
        url: str = "https://api.example.com/retrieval",
        request_method: str = "post",
        headers: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> ExternalKnowledgeApiSetting:
        """Create an ExternalKnowledgeApiSetting object."""
        if headers is None:
            headers = {"Content-Type": "application/json"}
        if params is None:
            params = {}

        return ExternalKnowledgeApiSetting(url=url, request_method=request_method, headers=headers, params=params)


@pytest.fixture
def factory():
    """Provide the test data factory to all tests."""
    return ExternalDatasetServiceTestDataFactory()


def _make_external_knowledge_api(
    *,
    api_id: str = "api-123",
    tenant_id: str = "tenant-123",
    name: str = "Test API",
    description: str = "Test description",
    settings: dict[str, Any] | list[dict[str, Any]] | None = None,
    created_by: str = "user-123",
    updated_by: str = "user-123",
) -> ExternalKnowledgeApis:
    """Build a real ExternalKnowledgeApis row for SQLite-backed service tests."""
    if settings is None:
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key-123"}
    api = ExternalKnowledgeApis(
        tenant_id=tenant_id,
        created_by=created_by,
        updated_by=updated_by,
        name=name,
        description=description,
        settings=json.dumps(settings, ensure_ascii=False),
    )
    api.id = api_id
    return api


def _make_dataset(
    *,
    dataset_id: str = "dataset-123",
    tenant_id: str = "tenant-123",
    name: str = "Test Dataset",
    provider: str = "external",
    description: str = "",
    retrieval_model: dict[str, Any] | None = None,
    created_by: str = "user-123",
) -> Dataset:
    """Build a real Dataset row with the fields required by ExternalKnowledgeGateway."""
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=name,
        description=description,
        provider=provider,
        retrieval_model=retrieval_model or {},
        created_by=created_by,
        maintainer=created_by,
    )
    return dataset


def _make_external_knowledge_binding(
    *,
    binding_id: str = "binding-123",
    tenant_id: str = "tenant-123",
    dataset_id: str = "dataset-123",
    external_knowledge_api_id: str = "api-123",
    external_knowledge_id: str = "knowledge-123",
    created_by: str = "user-123",
) -> ExternalKnowledgeBindings:
    """Build a real ExternalKnowledgeBindings row for tenant-scoped lookup tests."""
    binding = ExternalKnowledgeBindings(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        external_knowledge_api_id=external_knowledge_api_id,
        external_knowledge_id=external_knowledge_id,
        created_by=created_by,
    )
    binding.id = binding_id
    return binding


def _add_and_commit(session: Session, *objects: object) -> None:
    """Persist rows so service methods exercise real SQLAlchemy queries."""
    session.add_all(objects)
    session.commit()


class TestExternalDatasetServiceGetAPIs:
    """Exercise API filtering, ordering, pagination, and tenant scope through SQLite."""

    def test_get_external_knowledge_apis_paginates_in_descending_order_and_scopes_tenant(
        self, sqlite_session: Session
    ) -> None:
        apis = []
        for index in range(15):
            api = _make_external_knowledge_api(
                api_id=f"api-{index:02d}",
                name=f"API {index:02d}",
            )
            api.created_at = datetime(2024, 1, index + 1, 12, 0)
            apis.append(api)
        foreign_api = _make_external_knowledge_api(
            api_id="api-foreign",
            tenant_id="tenant-foreign",
            name="Foreign API",
        )
        foreign_api.created_at = datetime(2025, 1, 1, 12, 0)
        _add_and_commit(sqlite_session, *apis, foreign_api)

        result_items, result_total = external_repository.get_external_knowledge_apis(
            page=2,
            per_page=5,
            tenant_id="tenant-123",
            session=sqlite_session,
        )

        assert result_total == 15
        assert [api.id for api in result_items] == ["api-09", "api-08", "api-07", "api-06", "api-05"]
        assert all(api.tenant_id == "tenant-123" for api in result_items)

    @pytest.mark.parametrize(
        ("search", "expected_names"),
        [
            ("PRODUCTION", {"Production API", "production backup"}),
            ("v2.0", {"API-v2.0 (beta)"}),
        ],
    )
    def test_get_external_knowledge_apis_filters_names_case_insensitively(
        self, sqlite_session: Session, search: str, expected_names: set[str]
    ) -> None:
        _add_and_commit(
            sqlite_session,
            _make_external_knowledge_api(api_id="api-production", name="Production API"),
            _make_external_knowledge_api(api_id="api-backup", name="production backup"),
            _make_external_knowledge_api(api_id="api-versioned", name="API-v2.0 (beta)"),
            _make_external_knowledge_api(api_id="api-unrelated", name="Staging API"),
            _make_external_knowledge_api(
                api_id="api-foreign",
                tenant_id="tenant-foreign",
                name="Production foreign",
            ),
        )

        result_items, result_total = external_repository.get_external_knowledge_apis(
            page=1,
            per_page=10,
            tenant_id="tenant-123",
            search=search,
            session=sqlite_session,
        )

        assert result_total == len(expected_names)
        assert {api.name for api in result_items} == expected_names

    def test_get_external_knowledge_apis_returns_empty_page(self, sqlite_session: Session) -> None:
        _add_and_commit(
            sqlite_session,
            _make_external_knowledge_api(api_id="api-foreign", tenant_id="tenant-foreign"),
        )

        result_items, result_total = external_repository.get_external_knowledge_apis(
            page=1,
            per_page=10,
            tenant_id="tenant-123",
            session=sqlite_session,
        )

        assert result_items == []
        assert result_total == 0

    def test_get_external_knowledge_apis_caps_page_size_at_one_hundred(self, sqlite_session: Session) -> None:
        _add_and_commit(
            sqlite_session,
            *[_make_external_knowledge_api(api_id=f"api-{index:03d}", name=f"API {index:03d}") for index in range(101)],
        )

        result_items, result_total = external_repository.get_external_knowledge_apis(
            page=1,
            per_page=1000,
            tenant_id="tenant-123",
            session=sqlite_session,
        )

        assert len(result_items) == 100
        assert result_total == 101


class TestExternalDatasetServiceCheckEndpoint:
    """Test check_endpoint_and_api_key operations - extensive coverage."""

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_success_https(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test successful validation with HTTPS endpoint."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)
        mock_proxy.post.assert_called_once()

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_success_http(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test successful validation with HTTP endpoint."""
        # Arrange
        settings = {"endpoint": "http://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_sends_json_body(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Regression for #39402: the validation probe must POST a JSON body matching the
        External Knowledge API retrieval contract, not a body-less request that providers
        such as RAGFlow reject (empty POST -> 502 ERR_ZERO_SIZE_OBJECT)."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act
        ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

        # Assert - a non-empty JSON body is sent with the JSON content type
        mock_proxy.post.assert_called_once()
        _, call_kwargs = mock_proxy.post.call_args
        assert call_kwargs["headers"]["Content-Type"] == "application/json"
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-key"
        sent_body = json.loads(call_kwargs["data"])
        assert "knowledge_id" in sent_body
        assert "query" in sent_body
        assert sent_body["retrieval_setting"] == {"top_k": 1, "score_threshold": 0.0}

    def test_check_endpoint_missing_endpoint_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint key is missing."""
        # Arrange
        settings = {"api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="endpoint is required"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    def test_check_endpoint_empty_endpoint_string(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint is empty string."""
        # Arrange
        settings = {"endpoint": "", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="endpoint is required"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    def test_check_endpoint_whitespace_endpoint(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint is only whitespace."""
        # Arrange
        settings = {"endpoint": "   ", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    def test_check_endpoint_missing_api_key_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when api_key key is missing."""
        # Arrange
        settings = {"endpoint": "https://api.example.com"}

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    def test_check_endpoint_empty_api_key_string(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when api_key is empty string."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": ""}

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    def test_check_endpoint_no_scheme_url(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for URL without http:// or https://."""
        # Arrange
        settings = {"endpoint": "api.example.com", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint.*must start with http"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    def test_check_endpoint_invalid_scheme(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for URL with invalid scheme."""
        # Arrange
        settings = {"endpoint": "ftp://api.example.com", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="failed to connect to the endpoint"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    def test_check_endpoint_no_netloc(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for URL without network location."""
        # Arrange
        settings = {"endpoint": "http://", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    def test_check_endpoint_malformed_url(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for malformed URL."""
        # Arrange
        settings = {"endpoint": "https:///invalid", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_connection_timeout(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails on connection timeout."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}
        mock_proxy.post.side_effect = Exception("Connection timeout")

        # Act & Assert
        with pytest.raises(ValueError, match="failed to connect to the endpoint"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_network_error(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails on network error."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}
        mock_proxy.post.side_effect = Exception("Network unreachable")

        # Act & Assert
        with pytest.raises(ValueError, match="failed to connect to the endpoint"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_502_bad_gateway(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails with 502 Bad Gateway."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 502
        mock_proxy.post.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError, match="Bad Gateway.*failed to connect"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_404_not_found(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails with 404 Not Found."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_proxy.post.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError, match="Not Found.*failed to connect"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_403_forbidden(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails with 403 Forbidden (auth failure)."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "wrong-key"}

        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_proxy.post.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError, match="Forbidden.*Authorization failed"):
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_403_message_does_not_echo_api_key(
        self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Regression for #39888: the 403 error message must not contain the raw api_key.

        Before the fix, `external_knowledge_service.py:117` interpolated
        `api_key` into the `ValueError` message, so the credential round-tripped
        in the application log (via `current_app.logger.exception` in
        `api/libs/external_api.py:94`) and in the 400 response body
        (`{"code": "invalid_param", "message": str(e), ...}`). The 403 status
        from the upstream provider was the only signal that the key was bad;
        echoing it back is just a plaintext credential leak.
        """
        # Arrange -- a real-looking key with a prefix that would be a high-signal
        # substring to grep for in logs.
        api_key = "sk-abcdefghijklmnop1234567890ABCDEF"
        settings = {"endpoint": "https://api.example.com", "api_key": api_key}

        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_proxy.post.return_value = mock_response

        # Act
        with pytest.raises(ValueError) as exc_info:
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

        # Assert -- the message names the failure but does not include the key.
        message = str(exc_info.value)
        assert "Forbidden" in message
        assert "Authorization failed" in message
        assert api_key not in message
        # Belt-and-braces: also check the prefix and a 6-char tail to catch
        # regressions that only echo part of the key.
        assert "sk-abcdef" not in message
        assert "CDEF" not in message

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_other_4xx_codes_pass(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test that other 4xx codes don't raise exceptions."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        for status_code in [400, 401, 405, 429]:
            mock_response = MagicMock()
            mock_response.status_code = status_code
            mock_proxy.post.return_value = mock_response

            # Act & Assert - should not raise
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_5xx_codes_except_502_pass(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test that 5xx codes except 502 don't raise exceptions."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        for status_code in [500, 501, 503, 504]:
            mock_response = MagicMock()
            mock_response.status_code = status_code
            mock_proxy.post.return_value = mock_response

            # Act & Assert - should not raise
            ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_with_port_number(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation with endpoint including port number."""
        # Arrange
        settings = {"endpoint": "https://api.example.com:8443", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_with_path(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation with endpoint including path."""
        # Arrange
        settings = {"endpoint": "https://api.example.com/v1/api", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)
        # Verify /retrieval is appended
        call_args = mock_proxy.post.call_args
        assert "/retrieval" in call_args[0][0]

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_check_endpoint_authorization_header_format(
        self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test that Authorization header is properly formatted."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key-123"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act
        ExternalKnowledgeGateway.check_endpoint_and_api_key(settings)

        # Assert
        call_kwargs = mock_proxy.post.call_args.kwargs
        assert "headers" in call_kwargs
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-key-123"


@pytest.mark.parametrize("sqlite_session", [(ExternalKnowledgeApis,)], indirect=True)
class TestExternalDatasetServiceGetAPI:
    """Test get_external_knowledge_api operations."""

    def test_get_external_knowledge_api_success(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test successful retrieval of external knowledge API."""
        # Arrange
        api_id = "api-123"
        expected_api = _make_external_knowledge_api(api_id=api_id)
        _add_and_commit(sqlite_session, expected_api)

        # Act
        tenant_id = "tenant-123"
        result = external_repository.get_external_knowledge_api(api_id, tenant_id, session=sqlite_session)

        # Assert
        assert result.id == api_id

    def test_get_external_knowledge_api_not_found(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when API is not found."""
        # Act & Assert
        with pytest.raises(ValueError, match="api template not found"):
            external_repository.get_external_knowledge_api("nonexistent-id", "tenant-123", session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(ExternalKnowledgeApis,)], indirect=True)
class TestExternalDatasetServiceUpdateAPI:
    """Test update_external_knowledge_api operations."""

    @patch("repositories.knowledge.external_repository.naive_utc_now")
    def test_update_external_knowledge_api_success_all_fields(
        self, mock_now, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test successful update with all fields."""
        # Arrange
        api_id = "api-123"
        tenant_id = "tenant-123"
        user_id = "user-456"
        current_time = datetime(2024, 1, 2, 12, 0)
        mock_now.return_value = current_time

        existing_api = _make_external_knowledge_api(api_id=api_id, tenant_id=tenant_id)
        _add_and_commit(sqlite_session, existing_api)

        args = {
            "name": "Updated API",
            "description": "Updated description",
            "settings": {"endpoint": "https://new.example.com", "api_key": "new-key"},
        }

        # Act
        result = external_repository.update_external_knowledge_api(
            tenant_id, user_id, api_id, args, session=sqlite_session
        )

        # Assert
        assert result.name == "Updated API"
        assert result.description == "Updated description"
        assert result.updated_by == user_id
        assert result.updated_at == current_time
        assert sqlite_session.get(ExternalKnowledgeApis, api_id) is result

    def test_update_external_knowledge_api_preserve_hidden_api_key(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test that hidden API key is preserved from existing settings."""
        # Arrange
        api_id = "api-123"
        tenant_id = "tenant-123"

        existing_api = _make_external_knowledge_api(
            api_id=api_id,
            tenant_id=tenant_id,
            settings={"endpoint": "https://api.example.com", "api_key": "original-secret-key"},
        )
        _add_and_commit(sqlite_session, existing_api)

        args = {
            "name": "Updated API",
            "settings": {"endpoint": "https://api.example.com", "api_key": HIDDEN_VALUE},
        }

        # Act
        result = external_repository.update_external_knowledge_api(
            tenant_id, "user-123", api_id, args, session=sqlite_session
        )

        # Assert
        settings = json.loads(result.settings)
        assert settings["api_key"] == "original-secret-key"

    def test_update_external_knowledge_api_not_found(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when API is not found."""
        # Arrange
        args = {"name": "Updated API"}

        # Act & Assert
        with pytest.raises(ValueError, match="api template not found"):
            external_repository.update_external_knowledge_api(
                "tenant-123", "user-123", "api-123", args, session=sqlite_session
            )

    def test_update_external_knowledge_api_tenant_mismatch(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when tenant ID doesn't match."""
        # Arrange
        _add_and_commit(sqlite_session, _make_external_knowledge_api(api_id="api-123", tenant_id="tenant-123"))
        args = {"name": "Updated API"}

        # Act & Assert
        with pytest.raises(ValueError, match="api template not found"):
            external_repository.update_external_knowledge_api(
                "wrong-tenant", "user-123", "api-123", args, session=sqlite_session
            )

    def test_update_external_knowledge_api_name_only(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test updating only the name field."""
        # Arrange
        existing_api = _make_external_knowledge_api(
            description="Original description",
            settings={"endpoint": "https://api.example.com", "api_key": "key"},
        )
        _add_and_commit(sqlite_session, existing_api)

        args = {"name": "New Name Only"}

        # Act
        result = external_repository.update_external_knowledge_api(
            "tenant-123", "user-123", "api-123", args, session=sqlite_session
        )

        # Assert
        assert result.name == "New Name Only"


@pytest.mark.parametrize("sqlite_session", [(ExternalKnowledgeBindings,)], indirect=True)
class TestExternalDatasetServiceAPIUseCheck:
    """Test external_knowledge_api_use_check operations."""

    def test_external_knowledge_api_use_check_in_use_single(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test API use check when API has one binding."""
        # Arrange
        api_id = "api-123"
        tenant_id = "tenant-123"

        _add_and_commit(
            sqlite_session,
            _make_external_knowledge_binding(external_knowledge_api_id=api_id, tenant_id=tenant_id),
            _make_external_knowledge_binding(
                binding_id="binding-other",
                external_knowledge_api_id=api_id,
                tenant_id="other-tenant",
            ),
        )

        # Act
        in_use, count = external_repository.external_knowledge_api_use_check(api_id, tenant_id, session=sqlite_session)

        # Assert
        assert in_use is True
        assert count == 1

    def test_external_knowledge_api_use_check_in_use_multiple(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test API use check with multiple bindings."""
        # Arrange
        api_id = "api-123"
        tenant_id = "tenant-123"

        _add_and_commit(
            sqlite_session,
            *[
                _make_external_knowledge_binding(
                    binding_id=f"binding-{index}",
                    external_knowledge_api_id=api_id,
                    tenant_id=tenant_id,
                    dataset_id=f"dataset-{index}",
                )
                for index in range(10)
            ],
        )

        # Act
        in_use, count = external_repository.external_knowledge_api_use_check(api_id, tenant_id, session=sqlite_session)

        # Assert
        assert in_use is True
        assert count == 10

    def test_external_knowledge_api_use_check_not_in_use(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test API use check when API is not in use."""
        # Arrange
        api_id = "api-123"
        tenant_id = "tenant-123"

        _add_and_commit(
            sqlite_session,
            _make_external_knowledge_binding(
                external_knowledge_api_id=api_id,
                tenant_id="other-tenant",
            ),
        )

        # Act
        in_use, count = external_repository.external_knowledge_api_use_check(api_id, tenant_id, session=sqlite_session)

        # Assert
        assert in_use is False
        assert count == 0


@pytest.mark.parametrize("sqlite_session", [(ExternalKnowledgeBindings,)], indirect=True)
class TestExternalDatasetServiceGetBinding:
    """Test get_external_knowledge_binding_with_dataset_id operations."""

    def test_get_external_knowledge_binding_success(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test successful retrieval of external knowledge binding."""
        # Arrange
        tenant_id = "tenant-123"
        dataset_id = "dataset-123"

        expected_binding = _make_external_knowledge_binding(tenant_id=tenant_id, dataset_id=dataset_id)
        _add_and_commit(sqlite_session, expected_binding)

        # Act
        result = external_repository.get_external_knowledge_binding_with_dataset_id(
            tenant_id, dataset_id, session=sqlite_session
        )

        # Assert
        assert result.dataset_id == dataset_id
        assert result.tenant_id == tenant_id

    def test_get_external_knowledge_binding_not_found(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when binding is not found."""
        # Act & Assert
        with pytest.raises(ValueError, match="external knowledge binding not found"):
            external_repository.get_external_knowledge_binding_with_dataset_id(
                "tenant-123", "dataset-123", session=sqlite_session
            )


class TestExternalDatasetServiceProcessAPI:
    """Test process_external_api operations - comprehensive HTTP method coverage."""

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_process_external_api_get_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing GET request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="get")

        mock_response = MagicMock()
        mock_proxy.get.return_value = mock_response

        # Act
        result = ExternalKnowledgeGateway.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.get.assert_called_once()

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_process_external_api_post_request_with_data(
        self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test processing POST request with data."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="post", params={"key": "value", "data": "test"})

        mock_response = MagicMock()
        mock_proxy.post.return_value = mock_response

        # Act
        result = ExternalKnowledgeGateway.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.post.assert_called_once()
        call_kwargs = mock_proxy.post.call_args.kwargs
        assert "data" in call_kwargs

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_process_external_api_put_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing PUT request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="put")

        mock_response = MagicMock()
        mock_proxy.put.return_value = mock_response

        # Act
        result = ExternalKnowledgeGateway.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.put.assert_called_once()

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_process_external_api_delete_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing DELETE request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="delete")

        mock_response = MagicMock()
        mock_proxy.delete.return_value = mock_response

        # Act
        result = ExternalKnowledgeGateway.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.delete.assert_called_once()

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_process_external_api_patch_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing PATCH request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="patch")

        mock_response = MagicMock()
        mock_proxy.patch.return_value = mock_response

        # Act
        result = ExternalKnowledgeGateway.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.patch.assert_called_once()

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_process_external_api_head_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing HEAD request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="head")

        mock_response = MagicMock()
        mock_proxy.head.return_value = mock_response

        # Act
        result = ExternalKnowledgeGateway.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.head.assert_called_once()

    def test_process_external_api_invalid_method(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test error for invalid HTTP method."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="INVALID")

        # Act & Assert
        with pytest.raises(Exception, match="Invalid http method"):
            ExternalKnowledgeGateway.process_external_api(settings, None)

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_process_external_api_with_files(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing request with file uploads."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="post")
        files = {"file": ("test.txt", b"file content")}

        mock_response = MagicMock()
        mock_proxy.post.return_value = mock_response

        # Act
        result = ExternalKnowledgeGateway.process_external_api(settings, files)

        # Assert
        assert result == mock_response
        call_kwargs = mock_proxy.post.call_args.kwargs
        assert "files" in call_kwargs
        assert call_kwargs["files"] == files

    @patch("services.knowledge.external.adapters.ssrf_proxy")
    def test_process_external_api_follow_redirects(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test that follow_redirects is enabled."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="get")

        mock_response = MagicMock()
        mock_proxy.get.return_value = mock_response

        # Act
        ExternalKnowledgeGateway.process_external_api(settings, None)

        # Assert
        call_kwargs = mock_proxy.get.call_args.kwargs
        assert call_kwargs["follow_redirects"] is True


@pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, ExternalKnowledgeApis, ExternalKnowledgeBindings)],
    indirect=True,
)
class TestExternalDatasetServiceCreateDataset:
    """Test create_external_dataset operations."""

    def test_create_external_dataset_success_full(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test successful creation of external dataset with all fields."""
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-123"
        args = ExternalDatasetCreatePayload.model_validate(
            {
                "name": "Test External Dataset",
                "description": "Comprehensive test description",
                "external_knowledge_api_id": "api-123",
                "external_knowledge_id": "knowledge-123",
                "external_retrieval_model": {"top_k": 5, "score_threshold": 0.7},
            }
        )

        api = _make_external_knowledge_api(api_id="api-123", tenant_id=tenant_id)
        _add_and_commit(sqlite_session, api)

        # Act
        result = external_repository.create_external_dataset(tenant_id, user_id, args, session=sqlite_session)

        # Assert
        assert result.name == "Test External Dataset"
        assert result.description == "Comprehensive test description"
        assert result.provider == "external"
        assert result.created_by == user_id
        binding = sqlite_session.scalar(
            select(ExternalKnowledgeBindings).where(
                ExternalKnowledgeBindings.dataset_id == result.id,
                ExternalKnowledgeBindings.tenant_id == tenant_id,
            )
        )
        assert binding is not None
        assert binding.external_knowledge_api_id == "api-123"
        assert binding.external_knowledge_id == "knowledge-123"

    def test_create_external_dataset_duplicate_name_error(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when dataset name already exists."""
        # Arrange
        existing_dataset = _make_dataset(name="Duplicate Dataset")
        _add_and_commit(sqlite_session, existing_dataset)

        args = ExternalDatasetCreatePayload.model_validate(
            {
                "name": "Duplicate Dataset",
                "external_knowledge_api_id": "api-123",
                "external_knowledge_id": "knowledge-123",
            }
        )

        # Act & Assert
        with pytest.raises(DatasetNameDuplicateError):
            external_repository.create_external_dataset("tenant-123", "user-123", args, session=sqlite_session)

    def test_create_external_dataset_api_not_found_error(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when external knowledge API is not found."""
        args = ExternalDatasetCreatePayload.model_validate(
            {
                "name": "Test Dataset",
                "external_knowledge_api_id": "nonexistent-api",
                "external_knowledge_id": "knowledge-123",
            }
        )

        # Act & Assert
        with pytest.raises(ValueError, match="api template not found"):
            external_repository.create_external_dataset("tenant-123", "user-123", args, session=sqlite_session)

    def test_create_external_dataset_missing_knowledge_id_error(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when external_knowledge_id is missing."""
        # Arrange
        api = _make_external_knowledge_api()
        _add_and_commit(sqlite_session, api)

        # Act & Assert
        with pytest.raises(ValueError, match="external_knowledge_id"):
            ExternalDatasetCreatePayload.model_validate(
                {"name": "Test Dataset", "external_knowledge_api_id": "api-123"}
            )

    def test_create_external_dataset_missing_api_id_error(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when external_knowledge_api_id is missing."""
        # Act & Assert
        with pytest.raises(ValueError, match="external_knowledge_api_id"):
            ExternalDatasetCreatePayload.model_validate(
                {"name": "Test Dataset", "external_knowledge_id": "knowledge-123"}
            )
