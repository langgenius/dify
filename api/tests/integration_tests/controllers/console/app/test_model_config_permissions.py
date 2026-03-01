"""Integration tests for ModelConfigResource permission verification."""

import uuid
from unittest import mock

import pytest
from flask.testing import FlaskClient

from controllers.console.app import model_config as model_config_api
from controllers.console.app import wraps
from libs.datetime_utils import naive_utc_now
from models import App, Tenant
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.model import AppMode
from services.app_model_config_service import AppModelConfigService


class TestModelConfigResourcePermissions:
    """Test permission verification for ModelConfigResource endpoint."""

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model for testing."""
        app = App()
        app.id = str(uuid.uuid4())
        app.mode = AppMode.CHAT
        app.tenant_id = str(uuid.uuid4())
        app.status = "normal"
        app.app_model_config_id = str(uuid.uuid4())
        return app

    @pytest.fixture
    def mock_account(self, monkeypatch: pytest.MonkeyPatch):
        """Create a mock Account for testing."""

        account = Account(name="Test User", email="test@example.com")
        account.id = str(uuid.uuid4())
        account.last_active_at = naive_utc_now()
        account.created_at = naive_utc_now()
        account.updated_at = naive_utc_now()

        # Create mock tenant
        tenant = Tenant(name="Test Tenant")
        tenant.id = str(uuid.uuid4())

        mock_session_instance = mock.Mock()

        mock_tenant_join = TenantAccountJoin(role=TenantAccountRole.OWNER)
        monkeypatch.setattr(mock_session_instance, "scalar", mock.Mock(return_value=mock_tenant_join))

        mock_scalars_result = mock.Mock()
        mock_scalars_result.one.return_value = tenant
        monkeypatch.setattr(mock_session_instance, "scalars", mock.Mock(return_value=mock_scalars_result))

        mock_session_context = mock.Mock()
        mock_session_context.__enter__.return_value = mock_session_instance
        monkeypatch.setattr("models.account.Session", lambda _, expire_on_commit: mock_session_context)

        account.current_tenant = tenant
        return account

    @pytest.mark.parametrize(
        ("role", "status"),
        [
            (TenantAccountRole.OWNER, 200),
            (TenantAccountRole.ADMIN, 200),
            (TenantAccountRole.EDITOR, 200),
            (TenantAccountRole.NORMAL, 403),
            (TenantAccountRole.DATASET_OPERATOR, 403),
        ],
    )
    def test_post_with_owner_role_succeeds(
        self,
        test_client: FlaskClient,
        auth_header,
        monkeypatch,
        mock_app_model,
        mock_account,
        role: TenantAccountRole,
        status: int,
    ):
        """Test that OWNER role can access model-config endpoint."""
        # Set user role to OWNER
        mock_account.role = role

        # Mock app loading
        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        # Mock current user
        monkeypatch.setattr(model_config_api, "current_user", mock_account)

        # Mock AccountService.load_user to prevent authentication issues
        from services.account_service import AccountService

        mock_load_user = mock.Mock(return_value=mock_account)
        monkeypatch.setattr(AccountService, "load_user", mock_load_user)

        mock_validate_config = mock.Mock(
            return_value={
                "model": {"provider": "openai", "name": "gpt-4", "mode": "chat", "completion_params": {}},
                "pre_prompt": "You are a helpful assistant.",
                "user_input_form": [],
                "dataset_query_variable": "",
                "agent_mode": {"enabled": False, "tools": []},
            }
        )
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

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/model-config",
            headers=auth_header,
            json={
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
            },
        )

        assert response.status_code == status
