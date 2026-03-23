"""
Unit tests for inner_api workspace module

Tests Pydantic model validation and endpoint handler logic.
Auth/setup decorators are tested separately in test_auth_wraps.py;
handler tests use inspect.unwrap() to bypass them and focus on business logic.
"""

import inspect
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError

from controllers.inner_api.workspace.workspace import (
    EnterpriseWorkspace,
    EnterpriseWorkspaceNoOwnerEmail,
    WorkspaceCreatePayload,
    WorkspaceOwnerlessPayload,
)


class TestWorkspaceCreatePayload:
    """Test WorkspaceCreatePayload Pydantic model validation"""

    def test_valid_payload(self):
        """Test valid payload with all fields passes validation"""
        data = {
            "name": "My Workspace",
            "owner_email": "owner@example.com",
        }
        payload = WorkspaceCreatePayload.model_validate(data)
        assert payload.name == "My Workspace"
        assert payload.owner_email == "owner@example.com"

    def test_missing_name_fails_validation(self):
        """Test that missing name fails validation"""
        data = {"owner_email": "owner@example.com"}
        with pytest.raises(ValidationError) as exc_info:
            WorkspaceCreatePayload.model_validate(data)
        assert "name" in str(exc_info.value)

    def test_missing_owner_email_fails_validation(self):
        """Test that missing owner_email fails validation"""
        data = {"name": "My Workspace"}
        with pytest.raises(ValidationError) as exc_info:
            WorkspaceCreatePayload.model_validate(data)
        assert "owner_email" in str(exc_info.value)


class TestWorkspaceOwnerlessPayload:
    """Test WorkspaceOwnerlessPayload Pydantic model validation"""

    def test_valid_payload(self):
        """Test valid payload with name passes validation"""
        data = {"name": "My Workspace"}
        payload = WorkspaceOwnerlessPayload.model_validate(data)
        assert payload.name == "My Workspace"

    def test_missing_name_fails_validation(self):
        """Test that missing name fails validation"""
        data = {}
        with pytest.raises(ValidationError) as exc_info:
            WorkspaceOwnerlessPayload.model_validate(data)
        assert "name" in str(exc_info.value)


class TestEnterpriseWorkspace:
    """Test EnterpriseWorkspace API endpoint handler logic.

    Uses inspect.unwrap() to bypass auth/setup decorators (tested in test_auth_wraps.py)
    and exercise the core business logic directly.
    """

    @pytest.fixture
    def api_instance(self):
        return EnterpriseWorkspace()

    def test_has_post_method(self, api_instance):
        """Test that EnterpriseWorkspace has post method"""
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)

    @patch("controllers.inner_api.workspace.workspace.tenant_was_created")
    @patch("controllers.inner_api.workspace.workspace.TenantService")
    @patch("controllers.inner_api.workspace.workspace.db")
    def test_post_creates_workspace_with_owner(self, mock_db, mock_tenant_svc, mock_event, api_instance, app: Flask):
        """Test that post() creates a workspace and assigns the owner account"""
        # Arrange
        mock_account = MagicMock()
        mock_account.email = "owner@example.com"
        mock_db.session.query.return_value.filter_by.return_value.first.return_value = mock_account

        now = datetime(2025, 1, 1, 12, 0, 0)
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-id"
        mock_tenant.name = "My Workspace"
        mock_tenant.plan = "sandbox"
        mock_tenant.status = "normal"
        mock_tenant.created_at = now
        mock_tenant.updated_at = now
        mock_tenant_svc.create_tenant.return_value = mock_tenant

        # Act — unwrap to bypass auth/setup decorators (tested in test_auth_wraps.py)
        unwrapped_post = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.workspace.workspace.inner_api_ns") as mock_ns:
                mock_ns.payload = {"name": "My Workspace", "owner_email": "owner@example.com"}
                result = unwrapped_post(api_instance)

        # Assert
        assert result["message"] == "enterprise workspace created."
        assert result["tenant"]["id"] == "tenant-id"
        assert result["tenant"]["name"] == "My Workspace"
        mock_tenant_svc.create_tenant.assert_called_once_with("My Workspace", is_from_dashboard=True)
        mock_tenant_svc.create_tenant_member.assert_called_once_with(mock_tenant, mock_account, role="owner")
        mock_event.send.assert_called_once_with(mock_tenant)

    @patch("controllers.inner_api.workspace.workspace.db")
    def test_post_returns_404_when_owner_not_found(self, mock_db, api_instance, app: Flask):
        """Test that post() returns 404 when the owner account does not exist"""
        # Arrange
        mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

        # Act
        unwrapped_post = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.workspace.workspace.inner_api_ns") as mock_ns:
                mock_ns.payload = {"name": "My Workspace", "owner_email": "missing@example.com"}
                result = unwrapped_post(api_instance)

        # Assert
        assert result == ({"message": "owner account not found."}, 404)


class TestEnterpriseWorkspaceNoOwnerEmail:
    """Test EnterpriseWorkspaceNoOwnerEmail API endpoint handler logic.

    Uses inspect.unwrap() to bypass auth/setup decorators (tested in test_auth_wraps.py)
    and exercise the core business logic directly.
    """

    @pytest.fixture
    def api_instance(self):
        return EnterpriseWorkspaceNoOwnerEmail()

    def test_has_post_method(self, api_instance):
        """Test that endpoint has post method"""
        assert hasattr(api_instance, "post")
        assert callable(api_instance.post)

    @patch("controllers.inner_api.workspace.workspace.tenant_was_created")
    @patch("controllers.inner_api.workspace.workspace.TenantService")
    def test_post_creates_ownerless_workspace(self, mock_tenant_svc, mock_event, api_instance, app: Flask):
        """Test that post() creates a workspace without an owner and returns expected fields"""
        # Arrange
        now = datetime(2025, 1, 1, 12, 0, 0)
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-id"
        mock_tenant.name = "My Workspace"
        mock_tenant.encrypt_public_key = "pub-key"
        mock_tenant.plan = "sandbox"
        mock_tenant.status = "normal"
        mock_tenant.custom_config = None
        mock_tenant.created_at = now
        mock_tenant.updated_at = now
        mock_tenant_svc.create_tenant.return_value = mock_tenant

        # Act — unwrap to bypass auth/setup decorators (tested in test_auth_wraps.py)
        unwrapped_post = inspect.unwrap(api_instance.post)
        with app.test_request_context():
            with patch("controllers.inner_api.workspace.workspace.inner_api_ns") as mock_ns:
                mock_ns.payload = {"name": "My Workspace"}
                result = unwrapped_post(api_instance)

        # Assert
        assert result["message"] == "enterprise workspace created."
        assert result["tenant"]["id"] == "tenant-id"
        assert result["tenant"]["encrypt_public_key"] == "pub-key"
        assert result["tenant"]["custom_config"] == {}
        mock_tenant_svc.create_tenant.assert_called_once_with("My Workspace", is_from_dashboard=True)
        mock_event.send.assert_called_once_with(mock_tenant)
