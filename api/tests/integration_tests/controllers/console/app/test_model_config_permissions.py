"""Integration tests for ModelConfigResource permission verification."""

import uuid
from unittest import mock

import pytest
from flask.testing import FlaskClient

from controllers.console.app import model_config as model_config_api
from controllers.console.app import wraps
from libs.datetime_utils import naive_utc_now
from models import Account, App, Tenant
from models.account import TenantAccountRole
from models.model import AppMode
from services.app_model_config_service import AppModelConfigService


class TestModelConfigResourcePermissions:
    """Test permission verification for ModelConfigResource endpoint."""

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model for testing."""
        app = App()
        app.id = str(uuid.uuid4())
        app.mode = AppMode.CHAT.value
        app.tenant_id = str(uuid.uuid4())
        app.status = "normal"
        app.app_model_config_id = str(uuid.uuid4())
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
        """Valid request data for model config API."""
        return {
            "model": {
                "provider": "openai",
                "name": "gpt-4",
                "mode": "chat",
                "completion_params": {"temperature": 0.7, "max_tokens": 1000},
            },
            "user_input_form": [],
            "dataset_query_variable": "",
            "pre_prompt": "You are a helpful assistant.",
            "agent_mode": {"enabled": False, "tools": []},
        }

    def _setup_mocks(self, monkeypatch, mock_app_model, mock_user, mock_validate_response=None):
        """Setup common mocks for testing."""
        # Mock app loading
        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        # Mock current user
        monkeypatch.setattr(model_config_api, "current_user", mock_user)

        # Mock AccountService.load_user to prevent authentication issues
        from services.account_service import AccountService

        mock_load_user = mock.Mock(return_value=mock_user)
        monkeypatch.setattr(AccountService, "load_user", mock_load_user)

        # Mock AppModelConfigService.validate_configuration
        if mock_validate_response is None:
            mock_validate_response = {
                "model": {"provider": "openai", "name": "gpt-4", "mode": "chat", "completion_params": {}},
                "pre_prompt": "You are a helpful assistant.",
                "user_input_form": [],
                "dataset_query_variable": "",
                "agent_mode": {"enabled": False, "tools": []},
            }
        mock_validate_config = mock.Mock(return_value=mock_validate_response)
        monkeypatch.setattr(AppModelConfigService, "validate_configuration", mock_validate_config)

        # Mock database operations
        mock_db_session = mock.Mock()
        mock_db_session.add = mock.Mock()
        mock_db_session.flush = mock.Mock()
        mock_db_session.commit = mock.Mock()
        monkeypatch.setattr(model_config_api.db, "session", mock_db_session)

        # Mock app_model_config_was_updated event
        mock_event = mock.Mock()
        mock_event.send = mock.Mock()
        monkeypatch.setattr(model_config_api, "app_model_config_was_updated", mock_event)

    def test_post_with_owner_role_succeeds(
        self,
        test_client: FlaskClient,
        auth_header,
        monkeypatch,
        mock_app_model,
        mock_account,
        request_data,
    ):
        """Test that OWNER role can access model-config endpoint."""
        # Set user role to OWNER
        mock_account.role = TenantAccountRole.OWNER

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/model-config", headers=auth_header, json=request_data
        )

        assert response.status_code == 200
        assert response.json == {"result": "success"}

    def test_post_with_admin_role_succeeds(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, request_data
    ):
        """Test that ADMIN role can access model-config endpoint."""
        # Set user role to ADMIN
        mock_account.role = TenantAccountRole.ADMIN

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/model-config", headers=auth_header, json=request_data
        )

        assert response.status_code == 200
        assert response.json == {"result": "success"}

    def test_post_with_editor_role_succeeds(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, request_data
    ):
        """Test that EDITOR role can access model-config endpoint."""
        # Set user role to EDITOR
        mock_account.role = TenantAccountRole.EDITOR

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/model-config", headers=auth_header, json=request_data
        )

        assert response.status_code == 200
        assert response.json == {"result": "success"}

    def test_post_with_normal_role_forbidden(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, request_data
    ):
        """Test that NORMAL role gets 403 Forbidden from model-config endpoint."""
        # Set user role to NORMAL
        mock_account.role = TenantAccountRole.NORMAL

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/model-config", headers=auth_header, json=request_data
        )

        assert response.status_code == 403

    def test_post_with_dataset_operator_role_forbidden(
        self, test_client: FlaskClient, auth_header, monkeypatch, mock_app_model, mock_account, request_data
    ):
        """Test that DATASET_OPERATOR role gets 403 Forbidden from model-config endpoint."""
        # Set user role to DATASET_OPERATOR
        mock_account.role = TenantAccountRole.DATASET_OPERATOR

        self._setup_mocks(monkeypatch, mock_app_model, mock_account)

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/model-config", headers=auth_header, json=request_data
        )

        assert response.status_code == 403
