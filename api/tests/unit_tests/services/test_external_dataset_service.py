"""Tests for external knowledge API, binding, dataset, and retrieval operations.

Database-facing cases persist the minimum required ``TypeBase`` tables through
the shared in-memory SQLite fixture, including cross-tenant rows. HTTP calls,
pagination, and clocks remain mocked at their genuine I/O boundaries.
"""

import json
import re
from datetime import datetime
from typing import Any
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from models.dataset import Dataset, ExternalKnowledgeApis, ExternalKnowledgeBindings
from services.entities.external_knowledge_entities.external_knowledge_entities import (
    Authorization,
    AuthorizationConfig,
    ExternalDatasetCreatePayload,
    ExternalKnowledgeApiSetting,
)
from services.errors.dataset import DatasetNameDuplicateError
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.external_knowledge_service import ExternalDatasetService


class ExternalDatasetServiceTestDataFactory:
    """Build non-session value objects used by tests outside persistence paths."""

    @staticmethod
    def create_external_knowledge_api_mock(
        api_id: str = "api-123",
        tenant_id: str = "tenant-123",
        name: str = "Test API",
        settings: dict[str, Any] | None = None,
        **kwargs,
    ) -> Mock:
        """Create a mock ExternalKnowledgeApis object."""
        api = Mock(spec=ExternalKnowledgeApis)
        api.id = api_id
        api.tenant_id = tenant_id
        api.name = name
        api.description = kwargs.get("description", "Test description")

        if settings is None:
            settings = {"endpoint": "https://api.example.com", "api_key": "test-key-123"}

        api.settings = json.dumps(settings, ensure_ascii=False)
        api.settings_dict = settings
        api.created_by = kwargs.get("created_by", "user-123")
        api.updated_by = kwargs.get("updated_by", "user-123")
        api.created_at = kwargs.get("created_at", datetime(2024, 1, 1, 12, 0))
        api.updated_at = kwargs.get("updated_at", datetime(2024, 1, 1, 12, 0))

        for key, value in kwargs.items():
            if key not in ["description", "created_by", "updated_by", "created_at", "updated_at"]:
                setattr(api, key, value)

        return api

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        name: str = "Test Dataset",
        provider: str = "external",
        **kwargs,
    ) -> Mock:
        """Create a mock Dataset object."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.name = name
        dataset.provider = provider
        dataset.description = kwargs.get("description", "")
        dataset.retrieval_model = kwargs.get("retrieval_model", {})
        dataset.created_by = kwargs.get("created_by", "user-123")

        for key, value in kwargs.items():
            if key not in ["description", "retrieval_model", "created_by"]:
                setattr(dataset, key, value)

        return dataset

    @staticmethod
    def create_external_knowledge_binding_mock(
        binding_id: str = "binding-123",
        tenant_id: str = "tenant-123",
        dataset_id: str = "dataset-123",
        external_knowledge_api_id: str = "api-123",
        external_knowledge_id: str = "knowledge-123",
        **kwargs,
    ) -> Mock:
        """Create a mock ExternalKnowledgeBindings object."""
        binding = Mock(spec=ExternalKnowledgeBindings)
        binding.id = binding_id
        binding.tenant_id = tenant_id
        binding.dataset_id = dataset_id
        binding.external_knowledge_api_id = external_knowledge_api_id
        binding.external_knowledge_id = external_knowledge_id
        binding.created_by = kwargs.get("created_by", "user-123")

        for key, value in kwargs.items():
            if key != "created_by":
                setattr(binding, key, value)

        return binding

    @staticmethod
    def create_authorization_mock(
        auth_type: str = "api-key",
        api_key: str = "test-key",
        header: str = "Authorization",
        token_type: str = "bearer",
    ) -> Authorization:
        """Create an Authorization object."""
        config = AuthorizationConfig(api_key=api_key, type=token_type, header=header)
        return Authorization(type=auth_type, config=config)

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
    """Build a real Dataset row with the fields required by ExternalDatasetService."""
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


def _seed_external_retrieval_dependencies(
    session: Session,
    *,
    tenant_id: str = "tenant-123",
    dataset_id: str = "dataset-123",
    api_id: str = "api-123",
) -> tuple[ExternalKnowledgeBindings, ExternalKnowledgeApis]:
    """Seed the binding and API template required by fetch_external_knowledge_retrieval."""
    binding = _make_external_knowledge_binding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        external_knowledge_api_id=api_id,
    )
    api = _make_external_knowledge_api(api_id=api_id, tenant_id=tenant_id)
    _add_and_commit(session, binding, api)
    return binding, api


class TestExternalDatasetServiceGetAPIs:
    """Test get_external_knowledge_apis operations - comprehensive coverage."""

    @patch("services.external_knowledge_service.paginate_query")
    def test_get_external_knowledge_apis_success_basic(
        self, mock_paginate_query, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test successful retrieval of external knowledge APIs with pagination."""
        # Arrange
        tenant_id = "tenant-123"
        page = 1
        per_page = 10

        apis = [factory.create_external_knowledge_api_mock(api_id=f"api-{i}", name=f"API {i}") for i in range(5)]

        mock_pagination = MagicMock()
        mock_pagination.items = apis
        mock_pagination.total = 5
        mock_paginate_query.return_value = mock_pagination

        # Act
        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=page, per_page=per_page, tenant_id=tenant_id
        )

        # Assert
        assert len(result_items) == 5
        assert result_total == 5
        assert result_items[0].id == "api-0"
        assert result_items[4].id == "api-4"
        mock_paginate_query.assert_called_once()

    @patch("services.external_knowledge_service.paginate_query")
    def test_get_external_knowledge_apis_with_search_filter(
        self, mock_paginate_query, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test retrieval with search filter."""
        # Arrange
        tenant_id = "tenant-123"
        search = "production"

        apis = [factory.create_external_knowledge_api_mock(name="Production API")]

        mock_pagination = MagicMock()
        mock_pagination.items = apis
        mock_pagination.total = 1
        mock_paginate_query.return_value = mock_pagination

        # Act
        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=1, per_page=10, tenant_id=tenant_id, search=search
        )

        # Assert
        assert len(result_items) == 1
        assert result_total == 1
        assert result_items[0].name == "Production API"

    @patch("services.external_knowledge_service.paginate_query")
    def test_get_external_knowledge_apis_empty_results(
        self, mock_paginate_query, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test retrieval with no results."""
        # Arrange
        mock_pagination = MagicMock()
        mock_pagination.items = []
        mock_pagination.total = 0
        mock_paginate_query.return_value = mock_pagination

        # Act
        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=1, per_page=10, tenant_id="tenant-123"
        )

        # Assert
        assert len(result_items) == 0
        assert result_total == 0

    @patch("services.external_knowledge_service.paginate_query")
    def test_get_external_knowledge_apis_large_result_set(
        self, mock_paginate_query, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test retrieval with large result set."""
        # Arrange
        apis = [factory.create_external_knowledge_api_mock(api_id=f"api-{i}") for i in range(100)]

        mock_pagination = MagicMock()
        mock_pagination.items = apis[:10]
        mock_pagination.total = 100
        mock_paginate_query.return_value = mock_pagination

        # Act
        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=1, per_page=10, tenant_id="tenant-123"
        )

        # Assert
        assert len(result_items) == 10
        assert result_total == 100

    @patch("services.external_knowledge_service.paginate_query")
    def test_get_external_knowledge_apis_pagination_last_page(
        self, mock_paginate_query, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test last page pagination with partial results."""
        # Arrange
        apis = [factory.create_external_knowledge_api_mock(api_id=f"api-{i}") for i in range(95, 100)]

        mock_pagination = MagicMock()
        mock_pagination.items = apis
        mock_pagination.total = 100
        mock_paginate_query.return_value = mock_pagination

        # Act
        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=10, per_page=10, tenant_id="tenant-123"
        )

        # Assert
        assert len(result_items) == 5
        assert result_total == 100

    @patch("services.external_knowledge_service.paginate_query")
    def test_get_external_knowledge_apis_case_insensitive_search(
        self, mock_paginate_query, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test case-insensitive search functionality."""
        # Arrange
        apis = [
            factory.create_external_knowledge_api_mock(name="Production API"),
            factory.create_external_knowledge_api_mock(name="production backup"),
        ]

        mock_pagination = MagicMock()
        mock_pagination.items = apis
        mock_pagination.total = 2
        mock_paginate_query.return_value = mock_pagination

        # Act
        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=1, per_page=10, tenant_id="tenant-123", search="PRODUCTION"
        )

        # Assert
        assert len(result_items) == 2
        assert result_total == 2

    @patch("services.external_knowledge_service.paginate_query")
    def test_get_external_knowledge_apis_special_characters_search(
        self, mock_paginate_query, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test search with special characters."""
        # Arrange
        apis = [factory.create_external_knowledge_api_mock(name="API-v2.0 (beta)")]

        mock_pagination = MagicMock()
        mock_pagination.items = apis
        mock_pagination.total = 1
        mock_paginate_query.return_value = mock_pagination

        # Act
        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=1, per_page=10, tenant_id="tenant-123", search="v2.0"
        )

        # Assert
        assert len(result_items) == 1

    @patch("services.external_knowledge_service.paginate_query")
    def test_get_external_knowledge_apis_max_per_page_limit(
        self, mock_paginate_query, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test that max_per_page limit is enforced."""
        # Arrange
        apis = [factory.create_external_knowledge_api_mock(api_id=f"api-{i}") for i in range(100)]

        mock_pagination = MagicMock()
        mock_pagination.items = apis
        mock_pagination.total = 1000
        mock_paginate_query.return_value = mock_pagination

        # Act
        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=1, per_page=100, tenant_id="tenant-123"
        )

        # Assert
        call_args = mock_paginate_query.call_args
        assert call_args.kwargs["max_per_page"] == 100

    @patch("services.external_knowledge_service.paginate_query")
    def test_get_external_knowledge_apis_ordered_by_created_at_desc(
        self, mock_paginate_query, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test that results are ordered by created_at descending."""
        # Arrange
        apis = [
            factory.create_external_knowledge_api_mock(api_id=f"api-{i}", created_at=datetime(2024, 1, i, 12, 0))
            for i in range(1, 6)
        ]

        mock_pagination = MagicMock()
        mock_pagination.items = apis[::-1]  # Reversed to simulate DESC order
        mock_pagination.total = 5
        mock_paginate_query.return_value = mock_pagination

        # Act
        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=1, per_page=10, tenant_id="tenant-123"
        )

        # Assert
        assert result_items[0].created_at > result_items[-1].created_at


class TestExternalDatasetServiceValidateAPIList:
    """Test validate_api_list operations."""

    def test_validate_api_list_success_with_all_fields(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test successful validation with all required fields."""
        # Arrange
        api_settings = {"endpoint": "https://api.example.com", "api_key": "test-key-123"}

        # Act & Assert - should not raise
        ExternalDatasetService.validate_api_list(api_settings)

    def test_validate_api_list_missing_endpoint(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint is missing."""
        # Arrange
        api_settings = {"api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="endpoint is required"):
            ExternalDatasetService.validate_api_list(api_settings)

    def test_validate_api_list_empty_endpoint(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint is empty string."""
        # Arrange
        api_settings = {"endpoint": "", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="endpoint is required"):
            ExternalDatasetService.validate_api_list(api_settings)

    def test_validate_api_list_missing_api_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when API key is missing."""
        # Arrange
        api_settings = {"endpoint": "https://api.example.com"}

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalDatasetService.validate_api_list(api_settings)

    def test_validate_api_list_empty_api_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when API key is empty string."""
        # Arrange
        api_settings = {"endpoint": "https://api.example.com", "api_key": ""}

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalDatasetService.validate_api_list(api_settings)

    def test_validate_api_list_empty_dict(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when settings are empty dict."""
        # Arrange
        api_settings = {}

        # Act & Assert
        with pytest.raises(ValueError, match="api list is empty"):
            ExternalDatasetService.validate_api_list(api_settings)

    def test_validate_api_list_none_value(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when settings are None."""
        # Arrange
        api_settings = None

        # Act & Assert
        with pytest.raises(ValueError, match="api list is empty"):
            ExternalDatasetService.validate_api_list(api_settings)

    def test_validate_api_list_with_extra_fields(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation succeeds with extra fields present."""
        # Arrange
        api_settings = {
            "endpoint": "https://api.example.com",
            "api_key": "test-key",
            "timeout": 30,
            "retry_count": 3,
        }

        # Act & Assert - should not raise
        ExternalDatasetService.validate_api_list(api_settings)


@pytest.mark.parametrize("sqlite_session", [(ExternalKnowledgeApis,)], indirect=True)
class TestExternalDatasetServiceCreateAPI:
    """Test create_external_knowledge_api operations."""

    @patch("services.external_knowledge_service.ExternalDatasetService.check_endpoint_and_api_key")
    def test_create_external_knowledge_api_success_full(
        self, mock_check, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test successful creation with all fields."""
        # Arrange
        tenant_id = "tenant-123"
        user_id = "user-123"
        args = {
            "name": "Test API",
            "description": "Comprehensive test description",
            "settings": {"endpoint": "https://api.example.com", "api_key": "test-key-123"},
        }

        # Act
        result = ExternalDatasetService.create_external_knowledge_api(tenant_id, user_id, args, session=sqlite_session)

        # Assert
        assert result.name == "Test API"
        assert result.description == "Comprehensive test description"
        assert result.tenant_id == tenant_id
        assert result.created_by == user_id
        assert result.updated_by == user_id
        mock_check.assert_called_once_with(args["settings"])
        persisted_api = sqlite_session.get(ExternalKnowledgeApis, result.id)
        assert persisted_api is result

    @patch("services.external_knowledge_service.ExternalDatasetService.check_endpoint_and_api_key")
    def test_create_external_knowledge_api_minimal_fields(
        self, mock_check, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test creation with minimal required fields."""
        # Arrange
        args = {
            "name": "Minimal API",
            "settings": {"endpoint": "https://api.example.com", "api_key": "key"},
        }

        # Act
        result = ExternalDatasetService.create_external_knowledge_api(
            "tenant-123", "user-123", args, session=sqlite_session
        )

        # Assert
        assert result.name == "Minimal API"
        assert result.description == ""
        assert sqlite_session.get(ExternalKnowledgeApis, result.id) is result

    def test_create_external_knowledge_api_missing_settings(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test creation fails when settings are missing."""
        # Arrange
        args = {"name": "Test API", "description": "Test"}

        # Act & Assert
        with pytest.raises(ValueError, match="settings is required"):
            ExternalDatasetService.create_external_knowledge_api("tenant-123", "user-123", args, session=sqlite_session)

    def test_create_external_knowledge_api_none_settings(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test creation fails when settings are explicitly None."""
        # Arrange
        args = {"name": "Test API", "settings": None}

        # Act & Assert
        with pytest.raises(ValueError, match="settings is required"):
            ExternalDatasetService.create_external_knowledge_api("tenant-123", "user-123", args, session=sqlite_session)

    @patch("services.external_knowledge_service.ExternalDatasetService.check_endpoint_and_api_key")
    def test_create_external_knowledge_api_settings_json_serialization(
        self, mock_check, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test that settings are properly JSON serialized."""
        # Arrange
        settings = {
            "endpoint": "https://api.example.com",
            "api_key": "test-key",
            "custom_field": "value",
        }
        args = {"name": "Test API", "settings": settings}

        # Act
        result = ExternalDatasetService.create_external_knowledge_api(
            "tenant-123", "user-123", args, session=sqlite_session
        )

        # Assert
        assert isinstance(result.settings, str)
        parsed_settings = json.loads(result.settings)
        assert parsed_settings == settings

    @patch("services.external_knowledge_service.ExternalDatasetService.check_endpoint_and_api_key")
    def test_create_external_knowledge_api_unicode_handling(
        self, mock_check, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test proper handling of Unicode characters in name and description."""
        # Arrange
        args = {
            "name": "测试API",
            "description": "テストの説明",
            "settings": {"endpoint": "https://api.example.com", "api_key": "key"},
        }

        # Act
        result = ExternalDatasetService.create_external_knowledge_api(
            "tenant-123", "user-123", args, session=sqlite_session
        )

        # Assert
        assert result.name == "测试API"
        assert result.description == "テストの説明"

    @patch("services.external_knowledge_service.ExternalDatasetService.check_endpoint_and_api_key")
    def test_create_external_knowledge_api_long_description(
        self, mock_check, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test creation with very long description."""
        # Arrange
        long_description = "A" * 1000
        args = {
            "name": "Test API",
            "description": long_description,
            "settings": {"endpoint": "https://api.example.com", "api_key": "key"},
        }

        # Act
        result = ExternalDatasetService.create_external_knowledge_api(
            "tenant-123", "user-123", args, session=sqlite_session
        )

        # Assert
        assert result.description == long_description
        assert len(result.description) == 1000


class TestExternalDatasetServiceCheckEndpoint:
    """Test check_endpoint_and_api_key operations - extensive coverage."""

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_success_https(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test successful validation with HTTPS endpoint."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalDatasetService.check_endpoint_and_api_key(settings)
        mock_proxy.post.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_success_http(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test successful validation with HTTP endpoint."""
        # Arrange
        settings = {"endpoint": "http://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_missing_endpoint_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint key is missing."""
        # Arrange
        settings = {"api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="endpoint is required"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_empty_endpoint_string(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint is empty string."""
        # Arrange
        settings = {"endpoint": "", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="endpoint is required"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_whitespace_endpoint(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint is only whitespace."""
        # Arrange
        settings = {"endpoint": "   ", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_missing_api_key_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when api_key key is missing."""
        # Arrange
        settings = {"endpoint": "https://api.example.com"}

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_empty_api_key_string(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when api_key is empty string."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": ""}

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_no_scheme_url(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for URL without http:// or https://."""
        # Arrange
        settings = {"endpoint": "api.example.com", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint.*must start with http"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_invalid_scheme(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for URL with invalid scheme."""
        # Arrange
        settings = {"endpoint": "ftp://api.example.com", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="failed to connect to the endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_no_netloc(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for URL without network location."""
        # Arrange
        settings = {"endpoint": "http://", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_malformed_url(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for malformed URL."""
        # Arrange
        settings = {"endpoint": "https:///invalid", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_connection_timeout(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails on connection timeout."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}
        mock_proxy.post.side_effect = Exception("Connection timeout")

        # Act & Assert
        with pytest.raises(ValueError, match="failed to connect to the endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_network_error(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails on network error."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}
        mock_proxy.post.side_effect = Exception("Network unreachable")

        # Act & Assert
        with pytest.raises(ValueError, match="failed to connect to the endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_502_bad_gateway(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails with 502 Bad Gateway."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 502
        mock_proxy.post.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError, match="Bad Gateway.*failed to connect"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_404_not_found(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails with 404 Not Found."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_proxy.post.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError, match="Not Found.*failed to connect"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_403_forbidden(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails with 403 Forbidden (auth failure)."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "wrong-key"}

        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_proxy.post.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError, match="Forbidden.*Authorization failed"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_other_4xx_codes_pass(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test that other 4xx codes don't raise exceptions."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        for status_code in [400, 401, 405, 429]:
            mock_response = MagicMock()
            mock_response.status_code = status_code
            mock_proxy.post.return_value = mock_response

            # Act & Assert - should not raise
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_5xx_codes_except_502_pass(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test that 5xx codes except 502 don't raise exceptions."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        for status_code in [500, 501, 503, 504]:
            mock_response = MagicMock()
            mock_response.status_code = status_code
            mock_proxy.post.return_value = mock_response

            # Act & Assert - should not raise
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_with_port_number(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation with endpoint including port number."""
        # Arrange
        settings = {"endpoint": "https://api.example.com:8443", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_with_path(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation with endpoint including path."""
        # Arrange
        settings = {"endpoint": "https://api.example.com/v1/api", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalDatasetService.check_endpoint_and_api_key(settings)
        # Verify /retrieval is appended
        call_args = mock_proxy.post.call_args
        assert "/retrieval" in call_args[0][0]

    @patch("services.external_knowledge_service.ssrf_proxy")
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
        ExternalDatasetService.check_endpoint_and_api_key(settings)

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
        result = ExternalDatasetService.get_external_knowledge_api(api_id, tenant_id, session=sqlite_session)

        # Assert
        assert result.id == api_id

    def test_get_external_knowledge_api_not_found(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when API is not found."""
        # Act & Assert
        with pytest.raises(ValueError, match="api template not found"):
            ExternalDatasetService.get_external_knowledge_api("nonexistent-id", "tenant-123", session=sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(ExternalKnowledgeApis,)], indirect=True)
class TestExternalDatasetServiceUpdateAPI:
    """Test update_external_knowledge_api operations."""

    @patch("services.external_knowledge_service.naive_utc_now")
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
        result = ExternalDatasetService.update_external_knowledge_api(
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
        result = ExternalDatasetService.update_external_knowledge_api(
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
            ExternalDatasetService.update_external_knowledge_api(
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
            ExternalDatasetService.update_external_knowledge_api(
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
        result = ExternalDatasetService.update_external_knowledge_api(
            "tenant-123", "user-123", "api-123", args, session=sqlite_session
        )

        # Assert
        assert result.name == "New Name Only"


@pytest.mark.parametrize("sqlite_session", [(ExternalKnowledgeApis,)], indirect=True)
class TestExternalDatasetServiceDeleteAPI:
    """Test delete_external_knowledge_api operations."""

    def test_delete_external_knowledge_api_success(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test successful deletion of external knowledge API."""
        # Arrange
        api_id = "api-123"
        tenant_id = "tenant-123"

        existing_api = _make_external_knowledge_api(api_id=api_id, tenant_id=tenant_id)
        _add_and_commit(sqlite_session, existing_api)

        # Act
        ExternalDatasetService.delete_external_knowledge_api(tenant_id, api_id, session=sqlite_session)

        # Assert
        assert sqlite_session.get(ExternalKnowledgeApis, api_id) is None

    def test_delete_external_knowledge_api_not_found(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when API is not found."""
        # Act & Assert
        with pytest.raises(ValueError, match="api template not found"):
            ExternalDatasetService.delete_external_knowledge_api("tenant-123", "api-123", session=sqlite_session)

    def test_delete_external_knowledge_api_tenant_mismatch(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test error when tenant ID doesn't match."""
        # Arrange
        _add_and_commit(sqlite_session, _make_external_knowledge_api(api_id="api-123", tenant_id="tenant-123"))

        # Act & Assert
        with pytest.raises(ValueError, match="api template not found"):
            ExternalDatasetService.delete_external_knowledge_api("wrong-tenant", "api-123", session=sqlite_session)


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
        in_use, count = ExternalDatasetService.external_knowledge_api_use_check(
            api_id, tenant_id, session=sqlite_session
        )

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
        in_use, count = ExternalDatasetService.external_knowledge_api_use_check(
            api_id, tenant_id, session=sqlite_session
        )

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
        in_use, count = ExternalDatasetService.external_knowledge_api_use_check(
            api_id, tenant_id, session=sqlite_session
        )

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
        result = ExternalDatasetService.get_external_knowledge_binding_with_dataset_id(
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
            ExternalDatasetService.get_external_knowledge_binding_with_dataset_id(
                "tenant-123", "dataset-123", session=sqlite_session
            )


@pytest.mark.parametrize("sqlite_session", [(ExternalKnowledgeApis,)], indirect=True)
class TestExternalDatasetServiceDocumentValidate:
    """Test document_create_args_validate operations."""

    def test_document_create_args_validate_success_all_params(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test successful validation with all required parameters."""
        # Arrange
        tenant_id = "tenant-123"
        api_id = "api-123"

        settings = {
            "document_process_setting": [
                {"name": "param1", "required": True},
                {"name": "param2", "required": True},
                {"name": "param3", "required": False},
            ]
        }

        api = _make_external_knowledge_api(api_id=api_id, tenant_id=tenant_id, settings=[settings])
        _add_and_commit(sqlite_session, api)

        process_parameter = {"param1": "value1", "param2": "value2"}

        # Act & Assert - should not raise
        ExternalDatasetService.document_create_args_validate(
            tenant_id, api_id, process_parameter, session=sqlite_session
        )

    def test_document_create_args_validate_missing_required_param(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test validation fails when required parameter is missing."""
        # Arrange
        tenant_id = "tenant-123"
        api_id = "api-123"

        settings = {"document_process_setting": [{"name": "required_param", "required": True}]}

        api = _make_external_knowledge_api(api_id=api_id, tenant_id=tenant_id, settings=[settings])
        _add_and_commit(sqlite_session, api)

        process_parameter = {}

        # Act & Assert
        with pytest.raises(ValueError, match="required_param is required"):
            ExternalDatasetService.document_create_args_validate(
                tenant_id, api_id, process_parameter, session=sqlite_session
            )

    def test_document_create_args_validate_api_not_found(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test validation fails when API is not found."""
        # Act & Assert
        with pytest.raises(ValueError, match="api template not found"):
            ExternalDatasetService.document_create_args_validate("tenant-123", "api-123", {}, session=sqlite_session)

    def test_document_create_args_validate_no_custom_parameters(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test validation succeeds when no custom parameters defined."""
        # Arrange
        settings = {}
        api = _make_external_knowledge_api(settings=[settings])
        _add_and_commit(sqlite_session, api)

        # Act & Assert - should not raise
        ExternalDatasetService.document_create_args_validate("tenant-123", "api-123", {}, session=sqlite_session)

    def test_document_create_args_validate_optional_params_not_required(
        self, factory: ExternalDatasetServiceTestDataFactory, sqlite_session: Session
    ):
        """Test that optional parameters don't cause validation failure."""
        # Arrange
        settings = {
            "document_process_setting": [
                {"name": "required_param", "required": True},
                {"name": "optional_param", "required": False},
            ]
        }

        api = _make_external_knowledge_api(settings=[settings])
        _add_and_commit(sqlite_session, api)

        process_parameter = {"required_param": "value"}

        # Act & Assert - should not raise
        ExternalDatasetService.document_create_args_validate(
            "tenant-123", "api-123", process_parameter, session=sqlite_session
        )


class TestExternalDatasetServiceProcessAPI:
    """Test process_external_api operations - comprehensive HTTP method coverage."""

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_get_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing GET request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="get")

        mock_response = MagicMock()
        mock_proxy.get.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.get.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_post_request_with_data(
        self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test processing POST request with data."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="post", params={"key": "value", "data": "test"})

        mock_response = MagicMock()
        mock_proxy.post.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.post.assert_called_once()
        call_kwargs = mock_proxy.post.call_args.kwargs
        assert "data" in call_kwargs

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_put_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing PUT request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="put")

        mock_response = MagicMock()
        mock_proxy.put.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.put.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_delete_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing DELETE request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="delete")

        mock_response = MagicMock()
        mock_proxy.delete.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.delete.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_patch_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing PATCH request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="patch")

        mock_response = MagicMock()
        mock_proxy.patch.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.patch.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_head_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing HEAD request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="head")

        mock_response = MagicMock()
        mock_proxy.head.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.head.assert_called_once()

    def test_process_external_api_invalid_method(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test error for invalid HTTP method."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="INVALID")

        # Act & Assert
        with pytest.raises(Exception, match="Invalid http method"):
            ExternalDatasetService.process_external_api(settings, None)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_with_files(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing request with file uploads."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="post")
        files = {"file": ("test.txt", b"file content")}

        mock_response = MagicMock()
        mock_proxy.post.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, files)

        # Assert
        assert result == mock_response
        call_kwargs = mock_proxy.post.call_args.kwargs
        assert "files" in call_kwargs
        assert call_kwargs["files"] == files

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_follow_redirects(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test that follow_redirects is enabled."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="get")

        mock_response = MagicMock()
        mock_proxy.get.return_value = mock_response

        # Act
        ExternalDatasetService.process_external_api(settings, None)

        # Assert
        call_kwargs = mock_proxy.get.call_args.kwargs
        assert call_kwargs["follow_redirects"] is True


class TestExternalDatasetServiceAssemblingHeaders:
    """Test assembling_headers operations - comprehensive authorization coverage."""

    def test_assembling_headers_bearer_token(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with Bearer token."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="bearer", api_key="secret-key-123")

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert result["Authorization"] == "Bearer secret-key-123"

    def test_assembling_headers_basic_auth(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with Basic authentication."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="basic", api_key="credentials")

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert result["Authorization"] == "Basic credentials"

    def test_assembling_headers_custom_auth(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with custom authentication."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="custom", api_key="custom-token")

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert result["Authorization"] == "custom-token"

    def test_assembling_headers_custom_header_name(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with custom header name."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="bearer", api_key="key-123", header="X-API-Key")

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert result["X-API-Key"] == "Bearer key-123"
        assert "Authorization" not in result

    def test_assembling_headers_with_existing_headers(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers preserves existing headers."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="bearer", api_key="key")
        existing_headers = {
            "Content-Type": "application/json",
            "X-Custom": "value",
            "User-Agent": "TestAgent/1.0",
        }

        # Act
        result = ExternalDatasetService.assembling_headers(authorization, existing_headers)

        # Assert
        assert result["Authorization"] == "Bearer key"
        assert result["Content-Type"] == "application/json"
        assert result["X-Custom"] == "value"
        assert result["User-Agent"] == "TestAgent/1.0"

    def test_assembling_headers_empty_existing_headers(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with empty existing headers dict."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="bearer", api_key="key")
        existing_headers = {}

        # Act
        result = ExternalDatasetService.assembling_headers(authorization, existing_headers)

        # Assert
        assert result["Authorization"] == "Bearer key"
        assert len(result) == 1

    def test_assembling_headers_missing_api_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test error when API key is missing."""
        # Arrange
        config = AuthorizationConfig(api_key=None, type="bearer", header="Authorization")
        authorization = Authorization(type="api-key", config=config)

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalDatasetService.assembling_headers(authorization)

    def test_assembling_headers_missing_config(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test error when config is missing."""
        # Arrange
        authorization = Authorization(type="api-key", config=None)

        # Act & Assert
        with pytest.raises(ValueError, match="authorization config is required"):
            ExternalDatasetService.assembling_headers(authorization)

    def test_assembling_headers_default_header_name(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test that default header name is Authorization when not specified."""
        # Arrange
        config = AuthorizationConfig(api_key="key", type="bearer", header=None)
        authorization = Authorization(type="api-key", config=config)

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert "Authorization" in result


class TestExternalDatasetServiceGetSettings:
    """Test get_external_knowledge_api_settings operations."""

    def test_get_external_knowledge_api_settings_success(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test successful parsing of API settings."""
        # Arrange
        settings = {
            "url": "https://api.example.com/v1",
            "request_method": "post",
            "headers": {"Content-Type": "application/json", "X-Custom": "value"},
            "params": {"key1": "value1", "key2": "value2"},
        }

        # Act
        result = ExternalDatasetService.get_external_knowledge_api_settings(settings)

        # Assert
        assert isinstance(result, ExternalKnowledgeApiSetting)
        assert result.url == "https://api.example.com/v1"
        assert result.request_method == "post"
        assert result.headers["Content-Type"] == "application/json"
        assert result.params["key1"] == "value1"


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
        result = ExternalDatasetService.create_external_dataset(tenant_id, user_id, args, session=sqlite_session)

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
            ExternalDatasetService.create_external_dataset("tenant-123", "user-123", args, session=sqlite_session)

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
            ExternalDatasetService.create_external_dataset("tenant-123", "user-123", args, session=sqlite_session)

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
