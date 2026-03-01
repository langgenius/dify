"""Integration tests for Trigger Provider subscription permission verification."""

import uuid
from unittest import mock

import pytest
from flask.testing import FlaskClient

from controllers.console.workspace import trigger_providers as trigger_providers_api
from libs.datetime_utils import naive_utc_now
from models import Tenant
from models.account import Account, TenantAccountJoin, TenantAccountRole


class TestTriggerProviderSubscriptionPermissions:
    """Test permission verification for Trigger Provider subscription endpoints."""

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
        account.current_tenant_id = tenant.id
        return account

    @pytest.mark.parametrize(
        ("role", "list_status", "get_status", "update_status", "create_status", "build_status", "delete_status"),
        [
            # Admin/Owner can do everything
            (TenantAccountRole.OWNER, 200, 200, 200, 200, 200, 200),
            (TenantAccountRole.ADMIN, 200, 200, 200, 200, 200, 200),
            # Editor can list, get, update (parameters), but not create, build, or delete
            (TenantAccountRole.EDITOR, 200, 200, 200, 403, 403, 403),
            # Normal user cannot do anything
            (TenantAccountRole.NORMAL, 403, 403, 403, 403, 403, 403),
            # Dataset operator cannot do anything
            (TenantAccountRole.DATASET_OPERATOR, 403, 403, 403, 403, 403, 403),
        ],
    )
    def test_trigger_subscription_permissions(
        self,
        test_client: FlaskClient,
        auth_header,
        monkeypatch,
        mock_account,
        role: TenantAccountRole,
        list_status: int,
        get_status: int,
        update_status: int,
        create_status: int,
        build_status: int,
        delete_status: int,
    ):
        """Test that different roles have appropriate permissions for trigger subscription operations."""
        # Set user role
        mock_account.role = role

        # Mock current user
        monkeypatch.setattr(trigger_providers_api, "current_user", mock_account)

        # Mock AccountService.load_user to prevent authentication issues
        from services.account_service import AccountService

        mock_load_user = mock.Mock(return_value=mock_account)
        monkeypatch.setattr(AccountService, "load_user", mock_load_user)

        # Test data
        provider = "some_provider/some_trigger"
        subscription_builder_id = str(uuid.uuid4())
        subscription_id = str(uuid.uuid4())

        # Mock service methods
        mock_list_subscriptions = mock.Mock(return_value=[])
        monkeypatch.setattr(
            "services.trigger.trigger_provider_service.TriggerProviderService.list_trigger_provider_subscriptions",
            mock_list_subscriptions,
        )

        mock_get_subscription_builder = mock.Mock(return_value={"id": subscription_builder_id})
        monkeypatch.setattr(
            "services.trigger.trigger_subscription_builder_service.TriggerSubscriptionBuilderService.get_subscription_builder_by_id",
            mock_get_subscription_builder,
        )

        mock_update_subscription_builder = mock.Mock(return_value={"id": subscription_builder_id})
        monkeypatch.setattr(
            "services.trigger.trigger_subscription_builder_service.TriggerSubscriptionBuilderService.update_trigger_subscription_builder",
            mock_update_subscription_builder,
        )

        mock_create_subscription_builder = mock.Mock(return_value={"id": subscription_builder_id})
        monkeypatch.setattr(
            "services.trigger.trigger_subscription_builder_service.TriggerSubscriptionBuilderService.create_trigger_subscription_builder",
            mock_create_subscription_builder,
        )

        mock_update_and_build_builder = mock.Mock()
        monkeypatch.setattr(
            "services.trigger.trigger_subscription_builder_service.TriggerSubscriptionBuilderService.update_and_build_builder",
            mock_update_and_build_builder,
        )

        mock_delete_provider = mock.Mock()
        mock_delete_plugin_trigger = mock.Mock()
        mock_db_session = mock.Mock()
        mock_db_session.commit = mock.Mock()

        def mock_session_func(engine=None):
            return mock_session_context

        mock_session_context = mock.Mock()
        mock_session_context.__enter__.return_value = mock_db_session
        mock_session_context.__exit__.return_value = None

        monkeypatch.setattr("services.trigger.trigger_provider_service.Session", mock_session_func)
        monkeypatch.setattr("services.trigger.trigger_subscription_operator_service.Session", mock_session_func)

        monkeypatch.setattr(
            "services.trigger.trigger_provider_service.TriggerProviderService.delete_trigger_provider",
            mock_delete_provider,
        )
        monkeypatch.setattr(
            "services.trigger.trigger_subscription_operator_service.TriggerSubscriptionOperatorService.delete_plugin_trigger_by_subscription",
            mock_delete_plugin_trigger,
        )

        # Test 1: List subscriptions (should work for Editor, Admin, Owner)
        response = test_client.get(
            f"/console/api/workspaces/current/trigger-provider/{provider}/subscriptions/list",
            headers=auth_header,
        )
        assert response.status_code == list_status

        # Test 2: Get subscription builder (should work for Editor, Admin, Owner)
        response = test_client.get(
            f"/console/api/workspaces/current/trigger-provider/{provider}/subscriptions/builder/{subscription_builder_id}",
            headers=auth_header,
        )
        assert response.status_code == get_status

        # Test 3: Update subscription builder parameters (should work for Editor, Admin, Owner)
        response = test_client.post(
            f"/console/api/workspaces/current/trigger-provider/{provider}/subscriptions/builder/update/{subscription_builder_id}",
            headers=auth_header,
            json={"parameters": {"webhook_url": "https://example.com/webhook"}},
        )
        assert response.status_code == update_status

        # Test 4: Create subscription builder (should only work for Admin, Owner)
        response = test_client.post(
            f"/console/api/workspaces/current/trigger-provider/{provider}/subscriptions/builder/create",
            headers=auth_header,
            json={"credential_type": "api_key"},
        )
        assert response.status_code == create_status

        # Test 5: Build/activate subscription (should only work for Admin, Owner)
        response = test_client.post(
            f"/console/api/workspaces/current/trigger-provider/{provider}/subscriptions/builder/build/{subscription_builder_id}",
            headers=auth_header,
            json={"name": "Test Subscription"},
        )
        assert response.status_code == build_status

        # Test 6: Delete subscription (should only work for Admin, Owner)
        response = test_client.post(
            f"/console/api/workspaces/current/trigger-provider/{subscription_id}/subscriptions/delete",
            headers=auth_header,
        )
        assert response.status_code == delete_status

    @pytest.mark.parametrize(
        ("role", "status"),
        [
            (TenantAccountRole.OWNER, 200),
            (TenantAccountRole.ADMIN, 200),
            # Editor should be able to access logs for debugging
            (TenantAccountRole.EDITOR, 200),
            (TenantAccountRole.NORMAL, 403),
            (TenantAccountRole.DATASET_OPERATOR, 403),
        ],
    )
    def test_trigger_subscription_logs_permissions(
        self,
        test_client: FlaskClient,
        auth_header,
        monkeypatch,
        mock_account,
        role: TenantAccountRole,
        status: int,
    ):
        """Test that different roles have appropriate permissions for accessing subscription logs."""
        # Set user role
        mock_account.role = role

        # Mock current user
        monkeypatch.setattr(trigger_providers_api, "current_user", mock_account)

        # Mock AccountService.load_user to prevent authentication issues
        from services.account_service import AccountService

        mock_load_user = mock.Mock(return_value=mock_account)
        monkeypatch.setattr(AccountService, "load_user", mock_load_user)

        # Test data
        provider = "some_provider/some_trigger"
        subscription_builder_id = str(uuid.uuid4())

        # Mock service method
        mock_list_logs = mock.Mock(return_value=[])
        monkeypatch.setattr(
            "services.trigger.trigger_subscription_builder_service.TriggerSubscriptionBuilderService.list_logs",
            mock_list_logs,
        )

        # Test access to logs
        response = test_client.get(
            f"/console/api/workspaces/current/trigger-provider/{provider}/subscriptions/builder/logs/{subscription_builder_id}",
            headers=auth_header,
        )
        assert response.status_code == status
