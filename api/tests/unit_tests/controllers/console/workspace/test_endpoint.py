"""Unit tests for Workspace Endpoint Controller.

This module tests all endpoints related to plugin endpoint management:
- Endpoint creation
- Endpoint listing (with pagination and filtering)
- Endpoint update
- Endpoint deletion
- Endpoint enable/disable
- Authorization checks
- Input validation
"""

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden

from controllers.console.workspace.endpoint import (
    EndpointCreateApi,
    EndpointDeleteApi,
    EndpointDisableApi,
    EndpointEnableApi,
    EndpointListApi,
    EndpointListForSinglePluginApi,
    EndpointUpdateApi,
)
from core.plugin.impl.exc import PluginPermissionDeniedError
from models import TenantAccountRole
from models.account import Account


class BaseEndpointApiTest:
    """Base test class with common fixtures for endpoint API tests."""

    @pytest.fixture
    def app(self):
        """Create Flask app for testing."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        app.config["SECRET_KEY"] = "test-secret-key"
        return app

    @pytest.fixture
    def mock_account(self):
        """Create a mock account."""
        account = MagicMock(spec=Account)
        account.id = "user-123"
        account.email = "test@example.com"
        account.current_tenant_id = "tenant-456"
        account.current_role = TenantAccountRole.ADMIN
        account.is_authenticated = True
        account.is_admin_or_owner = True
        return account

    @pytest.fixture
    def mock_account_normal(self):
        """Create a mock normal user account (non-privileged)."""
        account = MagicMock(spec=Account)
        account.id = "user-789"
        account.email = "user@example.com"
        account.current_tenant_id = "tenant-456"
        account.current_role = TenantAccountRole.NORMAL
        account.is_authenticated = True
        account.is_admin_or_owner = False
        return account

    @pytest.fixture
    def mock_endpoint_service(self):
        """Mock EndpointService."""
        with patch("controllers.console.workspace.endpoint.EndpointService") as mock_service:
            yield mock_service

    @pytest.fixture
    def mock_decorators(self):
        """Mock decorators to avoid database access."""
        with (
            patch("controllers.console.wraps.db") as mock_db,
            patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"),
            patch("libs.login.dify_config.LOGIN_DISABLED", False),
            patch("libs.login.check_csrf_token") as mock_csrf,
        ):
            mock_db.session.query.return_value.first.return_value = MagicMock()
            mock_csrf.return_value = None
            yield {"db": mock_db, "csrf": mock_csrf}


class TestEndpointCreateApi(BaseEndpointApiTest):
    """Unit tests for EndpointCreateApi."""

    def test_create_endpoint_success(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test successful endpoint creation with valid plugin identifier."""
        # Arrange
        plugin_id = "test-plugin/1.0.0"
        name = "Test Endpoint"
        settings = {"api_key": "test-key", "base_url": "https://api.example.com"}
        expected_result = True

        mock_endpoint_service.create_endpoint.return_value = expected_result

        with app.test_request_context(
            method="POST",
            json={
                "plugin_unique_identifier": plugin_id,
                "name": name,
                "settings": settings,
            },
            path="/workspaces/current/endpoints/create",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "plugin_unique_identifier": plugin_id,
                            "name": name,
                            "settings": settings,
                        }
                    ),
                ),
            ):
                resource = EndpointCreateApi()
                result = resource.post()

        # Assert
        assert result == {"success": expected_result}
        mock_endpoint_service.create_endpoint.assert_called_once_with(
            tenant_id="tenant-456",
            user_id="user-123",
            plugin_unique_identifier=plugin_id,
            name=name,
            settings=settings,
        )

    def test_create_endpoint_invalid_plugin_identifier(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test endpoint creation with invalid plugin identifier raises PluginPermissionDeniedError."""
        # Arrange
        invalid_plugin_id = "invalid-plugin"
        name = "Test Endpoint"
        settings = {"api_key": "test-key"}

        error_description = "Plugin not found or access denied"
        mock_endpoint_service.create_endpoint.side_effect = PluginPermissionDeniedError(error_description)

        with app.test_request_context(
            method="POST",
            json={
                "plugin_unique_identifier": invalid_plugin_id,
                "name": name,
                "settings": settings,
            },
            path="/workspaces/current/endpoints/create",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "plugin_unique_identifier": invalid_plugin_id,
                            "name": name,
                            "settings": settings,
                        }
                    ),
                ),
            ):
                resource = EndpointCreateApi()

                # Act & Assert
                with pytest.raises(ValueError) as exc_info:
                    resource.post()
                assert error_description in str(exc_info.value)

    def test_create_endpoint_empty_name(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test endpoint creation with empty name raises validation error."""
        # Arrange
        plugin_id = "test-plugin/1.0.0"
        empty_name = ""
        settings = {"api_key": "test-key"}

        with app.test_request_context(
            method="POST",
            json={
                "plugin_unique_identifier": plugin_id,
                "name": empty_name,
                "settings": settings,
            },
            path="/workspaces/current/endpoints/create",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "plugin_unique_identifier": plugin_id,
                            "name": empty_name,
                            "settings": settings,
                        }
                    ),
                ),
            ):
                resource = EndpointCreateApi()

                # Act & Assert
                with pytest.raises(ValidationError):
                    resource.post()

    def test_create_endpoint_invalid_settings(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test endpoint creation with invalid settings format."""
        # Arrange
        plugin_id = "test-plugin/1.0.0"
        name = "Test Endpoint"
        invalid_settings = "not-a-dict"  # Should be dict

        with app.test_request_context(
            method="POST",
            json={
                "plugin_unique_identifier": plugin_id,
                "name": name,
                "settings": invalid_settings,
            },
            path="/workspaces/current/endpoints/create",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "plugin_unique_identifier": plugin_id,
                            "name": name,
                            "settings": invalid_settings,
                        }
                    ),
                ),
            ):
                resource = EndpointCreateApi()

                # Act & Assert
                with pytest.raises(ValidationError):
                    resource.post()


class TestEndpointListApi(BaseEndpointApiTest):
    """Unit tests for EndpointListApi."""

    def test_list_endpoints_success(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test successful endpoint listing with pagination."""
        # Arrange
        page = 1
        page_size = 10
        expected_endpoints = [
            {"id": "endpoint-1", "name": "Endpoint 1", "plugin_id": "plugin-1"},
            {"id": "endpoint-2", "name": "Endpoint 2", "plugin_id": "plugin-2"},
        ]

        mock_endpoint_service.list_endpoints.return_value = expected_endpoints

        with app.test_request_context(
            method="GET",
            query_string={"page": page, "page_size": page_size},
            path="/workspaces/current/endpoints/list",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = EndpointListApi()
                result = resource.get()

        # Assert
        assert result == {"endpoints": expected_endpoints}
        mock_endpoint_service.list_endpoints.assert_called_once_with(
            tenant_id="tenant-456",
            user_id="user-123",
            page=page,
            page_size=page_size,
        )

    def test_list_endpoints_empty_result(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test endpoint listing returns empty list when no endpoints exist."""
        # Arrange
        page = 1
        page_size = 10
        expected_endpoints = []

        mock_endpoint_service.list_endpoints.return_value = expected_endpoints

        with app.test_request_context(
            method="GET",
            query_string={"page": page, "page_size": page_size},
            path="/workspaces/current/endpoints/list",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = EndpointListApi()
                result = resource.get()

        # Assert
        assert result == {"endpoints": []}
        mock_endpoint_service.list_endpoints.assert_called_once_with(
            tenant_id="tenant-456", user_id="user-123", page=page, page_size=page_size
        )

    def test_list_endpoints_pagination(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test endpoint listing with different pagination parameters."""
        # Arrange
        page = 2
        page_size = 5
        expected_endpoints = [{"id": f"endpoint-{i}", "name": f"Endpoint {i}"} for i in range(6, 11)]

        mock_endpoint_service.list_endpoints.return_value = expected_endpoints

        with app.test_request_context(
            method="GET",
            query_string={"page": page, "page_size": page_size},
            path="/workspaces/current/endpoints/list",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = EndpointListApi()
                result = resource.get()

        # Assert
        assert result == {"endpoints": expected_endpoints}
        mock_endpoint_service.list_endpoints.assert_called_once_with(
            tenant_id="tenant-456",
            user_id="user-123",
            page=page,
            page_size=page_size,
        )

    def test_list_endpoints_invalid_page(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test endpoint listing with invalid page number raises validation error."""
        # Arrange
        invalid_page = 0  # Should be >= 1
        page_size = 10

        with app.test_request_context(
            method="GET",
            query_string={"page": invalid_page, "page_size": page_size},
            path="/workspaces/current/endpoints/list",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = EndpointListApi()

                # Act & Assert
                with pytest.raises(ValidationError):
                    resource.get()


class TestEndpointListForSinglePluginApi(BaseEndpointApiTest):
    """Unit tests for EndpointListForSinglePluginApi."""

    def test_list_endpoints_for_plugin_success(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test successful endpoint listing for a specific plugin."""
        # Arrange
        plugin_id = "test-plugin/1.0.0"
        page = 1
        page_size = 10
        expected_endpoints = [
            {"id": "endpoint-1", "name": "Endpoint 1", "plugin_id": plugin_id},
            {"id": "endpoint-2", "name": "Endpoint 2", "plugin_id": plugin_id},
        ]

        mock_endpoint_service.list_endpoints_for_single_plugin.return_value = expected_endpoints

        with app.test_request_context(
            method="GET",
            query_string={"plugin_id": plugin_id, "page": page, "page_size": page_size},
            path="/workspaces/current/endpoints/list/plugin",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = EndpointListForSinglePluginApi()
                result = resource.get()

        # Assert
        assert result == {"endpoints": expected_endpoints}
        mock_endpoint_service.list_endpoints_for_single_plugin.assert_called_once_with(
            tenant_id="tenant-456",
            user_id="user-123",
            plugin_id=plugin_id,
            page=page,
            page_size=page_size,
        )

    def test_list_endpoints_for_plugin_filtering(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test that endpoint listing correctly filters by plugin_id."""
        # Arrange
        plugin_id = "specific-plugin/1.0.0"
        page = 1
        page_size = 10
        expected_endpoints = [{"id": "endpoint-1", "name": "Endpoint 1", "plugin_id": plugin_id}]

        mock_endpoint_service.list_endpoints_for_single_plugin.return_value = expected_endpoints

        with app.test_request_context(
            method="GET",
            query_string={"plugin_id": plugin_id, "page": page, "page_size": page_size},
            path="/workspaces/current/endpoints/list/plugin",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
            ):
                resource = EndpointListForSinglePluginApi()
                result = resource.get()

        # Assert
        assert result == {"endpoints": expected_endpoints}
        # Verify plugin_id was passed correctly
        call_args = mock_endpoint_service.list_endpoints_for_single_plugin.call_args
        assert call_args.kwargs["plugin_id"] == plugin_id


class TestEndpointUpdateApi(BaseEndpointApiTest):
    """Unit tests for EndpointUpdateApi."""

    def test_update_endpoint_success(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test successful endpoint update."""
        # Arrange
        endpoint_id = "endpoint-123"
        name = "Updated Endpoint Name"
        settings = {"api_key": "new-key", "base_url": "https://new-api.example.com"}
        expected_result = True

        mock_endpoint_service.update_endpoint.return_value = expected_result

        with app.test_request_context(
            method="POST",
            json={
                "endpoint_id": endpoint_id,
                "name": name,
                "settings": settings,
            },
            path="/workspaces/current/endpoints/update",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "endpoint_id": endpoint_id,
                            "name": name,
                            "settings": settings,
                        }
                    ),
                ),
            ):
                resource = EndpointUpdateApi()
                result = resource.post()

        # Assert
        assert result == {"success": expected_result}
        mock_endpoint_service.update_endpoint.assert_called_once_with(
            tenant_id="tenant-456",
            user_id="user-123",
            endpoint_id=endpoint_id,
            name=name,
            settings=settings,
        )

    def test_update_endpoint_unauthorized(self, app, mock_account_normal, mock_endpoint_service, mock_decorators):
        """Test that non-privileged users cannot update endpoints."""
        # Arrange
        endpoint_id = "endpoint-123"
        name = "Updated Endpoint Name"
        settings = {"api_key": "new-key"}

        with app.test_request_context(
            method="POST",
            json={
                "endpoint_id": endpoint_id,
                "name": name,
                "settings": settings,
            },
            path="/workspaces/current/endpoints/update",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account_normal, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_normal),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "endpoint_id": endpoint_id,
                            "name": name,
                            "settings": settings,
                        }
                    ),
                ),
            ):
                resource = EndpointUpdateApi()

                # Act & Assert
                with pytest.raises(Forbidden):
                    resource.post()


class TestEndpointDeleteApi(BaseEndpointApiTest):
    """Unit tests for EndpointDeleteApi."""

    def test_delete_endpoint_success(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test successful endpoint deletion."""
        # Arrange
        endpoint_id = "endpoint-123"
        expected_result = True

        mock_endpoint_service.delete_endpoint.return_value = expected_result

        with app.test_request_context(
            method="POST",
            json={"endpoint_id": endpoint_id},
            path="/workspaces/current/endpoints/delete",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "endpoint_id": endpoint_id,
                        }
                    ),
                ),
            ):
                resource = EndpointDeleteApi()
                result = resource.post()

        # Assert
        assert result == {"success": expected_result}
        mock_endpoint_service.delete_endpoint.assert_called_once_with(
            tenant_id="tenant-456",
            user_id="user-123",
            endpoint_id=endpoint_id,
        )

    def test_delete_endpoint_unauthorized(self, app, mock_account_normal, mock_endpoint_service, mock_decorators):
        """Test that non-privileged users cannot delete endpoints."""
        # Arrange
        endpoint_id = "endpoint-123"

        with app.test_request_context(
            method="POST",
            json={"endpoint_id": endpoint_id},
            path="/workspaces/current/endpoints/delete",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account_normal, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_normal),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "endpoint_id": endpoint_id,
                        }
                    ),
                ),
            ):
                resource = EndpointDeleteApi()

                # Act & Assert
                with pytest.raises(Forbidden):
                    resource.post()


class TestEndpointEnableApi(BaseEndpointApiTest):
    """Unit tests for EndpointEnableApi."""

    def test_enable_endpoint_success(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test successful endpoint enable."""
        # Arrange
        endpoint_id = "endpoint-123"
        expected_result = True

        mock_endpoint_service.enable_endpoint.return_value = expected_result

        with app.test_request_context(
            method="POST",
            json={"endpoint_id": endpoint_id},
            path="/workspaces/current/endpoints/enable",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "endpoint_id": endpoint_id,
                        }
                    ),
                ),
            ):
                resource = EndpointEnableApi()
                result = resource.post()

        # Assert
        assert result == {"success": expected_result}
        mock_endpoint_service.enable_endpoint.assert_called_once_with(
            tenant_id="tenant-456",
            user_id="user-123",
            endpoint_id=endpoint_id,
        )

    def test_enable_endpoint_unauthorized(self, app, mock_account_normal, mock_endpoint_service, mock_decorators):
        """Test that non-privileged users cannot enable endpoints."""
        # Arrange
        endpoint_id = "endpoint-123"

        with app.test_request_context(
            method="POST",
            json={"endpoint_id": endpoint_id},
            path="/workspaces/current/endpoints/enable",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account_normal, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_normal),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "endpoint_id": endpoint_id,
                        }
                    ),
                ),
            ):
                resource = EndpointEnableApi()

                # Act & Assert
                with pytest.raises(Forbidden):
                    resource.post()


class TestEndpointDisableApi(BaseEndpointApiTest):
    """Unit tests for EndpointDisableApi."""

    def test_disable_endpoint_success(self, app, mock_account, mock_endpoint_service, mock_decorators):
        """Test successful endpoint disable."""
        # Arrange
        endpoint_id = "endpoint-123"
        expected_result = True

        mock_endpoint_service.disable_endpoint.return_value = expected_result

        with app.test_request_context(
            method="POST",
            json={"endpoint_id": endpoint_id},
            path="/workspaces/current/endpoints/disable",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "endpoint_id": endpoint_id,
                        }
                    ),
                ),
            ):
                resource = EndpointDisableApi()
                result = resource.post()

        # Assert
        assert result == {"success": expected_result}
        mock_endpoint_service.disable_endpoint.assert_called_once_with(
            tenant_id="tenant-456",
            user_id="user-123",
            endpoint_id=endpoint_id,
        )

    def test_disable_endpoint_unauthorized(self, app, mock_account_normal, mock_endpoint_service, mock_decorators):
        """Test that non-privileged users cannot disable endpoints."""
        # Arrange
        endpoint_id = "endpoint-123"

        with app.test_request_context(
            method="POST",
            json={"endpoint_id": endpoint_id},
            path="/workspaces/current/endpoints/disable",
        ):
            with (
                patch(
                    "controllers.console.workspace.endpoint.current_account_with_tenant",
                    return_value=(mock_account_normal, "tenant-456"),
                ),
                patch("libs.login._get_user", return_value=mock_account_normal),
                patch(
                    "controllers.console.workspace.endpoint.console_ns",
                    new=MagicMock(
                        payload={
                            "endpoint_id": endpoint_id,
                        }
                    ),
                ),
            ):
                resource = EndpointDisableApi()

                # Act & Assert
                with pytest.raises(Forbidden):
                    resource.post()
