"""external dataset service tests."""

import json
from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from models.dataset import Dataset, ExternalKnowledgeApis, ExternalKnowledgeBindings
from services.entities.external_knowledge_entities.external_knowledge_entities import (
    ExternalDatasetCreatePayload,
    ExternalKnowledgeApiSetting,
)
from services.errors.dataset import DatasetNameDuplicateError
from services.external_knowledge_service import ExternalDatasetService
from tests.unit_tests.services._external_dataset_helpers import (
    ExternalDatasetServiceTestDataFactory,
    _add_and_commit,
    _make_dataset,
    _make_external_knowledge_api,
    _make_external_knowledge_binding,
)
from tests.unit_tests.services._external_dataset_helpers import (
    factory as factory,  # noqa: PLC0414 - register the shared pytest fixture
)


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

        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
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

        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
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

        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
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

        result_items, result_total = ExternalDatasetService.get_external_knowledge_apis(
            page=1,
            per_page=1000,
            tenant_id="tenant-123",
            session=sqlite_session,
        )

        assert len(result_items) == 100
        assert result_total == 101


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
