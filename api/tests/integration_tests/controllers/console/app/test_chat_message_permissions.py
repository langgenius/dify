"""Integration tests for ChatMessageApi permission verification."""

import uuid
from unittest import mock

import pytest
from flask.testing import FlaskClient

from controllers.console.app import completion as completion_api
from controllers.console.app import wraps
from libs.datetime_utils import naive_utc_now
from models import Account, App, Tenant
from models.account import TenantAccountRole
from models.model import AppMode
from services.app_generate_service import AppGenerateService


class TestChatMessageApiPermissions:
    """Test permission verification for ChatMessageApi endpoint."""

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model for testing."""
        app = App()
        app.id = str(uuid.uuid4())
        app.mode = AppMode.CHAT.value
        app.tenant_id = str(uuid.uuid4())
        app.status = "normal"
        return app

    @pytest.fixture
    def mock_account(self):
        """Create a mock Account for testing."""

        account = Account()
        account.id = str(uuid.uuid4())
        account.name = "Test User"
        account.email = "test@example.com"
        account.last_active_at = naive_utc_now()
        account.created_at = naive_utc_now()
        account.updated_at = naive_utc_now()

        # Create mock tenant
        tenant = Tenant()
        tenant.id = str(uuid.uuid4())
        tenant.name = "Test Tenant"

        account._current_tenant = tenant
        return account

    @pytest.fixture
    def request_data(self):
        """Valid request data for chat message API."""
        return {
            "inputs": {},
            "query": "Hello, world!",
            "model_config": {"model": {"provider": "openai", "name": "gpt-4", "mode": "chat", "completion_params": {}}},
            "response_mode": "blocking",
        }

    def _setup_mocks(self, monkeypatch, mock_app_model, mock_user, mock_generate_response=None):
        """Setup common mocks for testing."""
        # Mock app loading
        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        # Mock current user
        monkeypatch.setattr(completion_api, "current_user", mock_user)

        # Mock AppGenerateService.generate
        if mock_generate_response is None:
            mock_generate_response = {"message": "Test response"}
        mock_generate = mock.Mock(return_value=mock_generate_response)
        monkeypatch.setattr(AppGenerateService, "generate", mock_generate)

    def test_post_with_owner_role_succeeds(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, request_data
    ):
        """Test that OWNER role can access chat-messages endpoint."""
        # Set user role to OWNER
        mock_account.role = TenantAccountRole.OWNER

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/chat-messages", headers=auth_header, json=request_data
        )

        assert response.status_code == 200

    def test_post_with_admin_role_succeeds(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, request_data
    ):
        """Test that ADMIN role can access chat-messages endpoint."""
        # Set user role to ADMIN
        mock_account.role = TenantAccountRole.ADMIN

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/chat-messages", headers=auth_header, json=request_data
        )

        assert response.status_code == 200

    def test_post_with_editor_role_succeeds(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, request_data
    ):
        """Test that EDITOR role can access chat-messages endpoint."""
        # Set user role to EDITOR
        mock_account.role = TenantAccountRole.EDITOR

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/chat-messages", headers=auth_header, json=request_data
        )

        assert response.status_code == 200

    def test_post_with_normal_role_forbidden(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, request_data
    ):
        """Test that NORMAL role gets 403 Forbidden from chat-messages endpoint."""
        # Set user role to NORMAL
        mock_account.role = TenantAccountRole.NORMAL

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/chat-messages", headers=auth_header, json=request_data
        )

        assert response.status_code == 403

    def test_post_with_dataset_operator_role_forbidden(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, request_data
    ):
        """Test that DATASET_OPERATOR role gets 403 Forbidden from chat-messages endpoint."""
        # Set user role to DATASET_OPERATOR
        mock_account.role = TenantAccountRole.DATASET_OPERATOR

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/chat-messages", headers=auth_header, json=request_data
        )

        assert response.status_code == 403
