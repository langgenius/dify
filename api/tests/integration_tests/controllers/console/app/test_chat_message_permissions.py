"""Integration tests for ChatMessageApi permission verification."""

import uuid
from types import SimpleNamespace
from unittest import mock

import pytest
from flask.testing import FlaskClient

from controllers.console.app import completion as completion_api
from controllers.console.app import message as message_api
from controllers.console.app import wraps
from libs.datetime_utils import naive_utc_now
from models import App, Tenant
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.model import AppMode
from services.app_generate_service import AppGenerateService


class TestChatMessageApiPermissions:
    """Test permission verification for ChatMessageApi endpoint."""

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model for testing."""
        app = App()
        app.id = str(uuid.uuid4())
        app.mode = AppMode.CHAT
        app.tenant_id = str(uuid.uuid4())
        app.status = "normal"
        return app

    @pytest.fixture
    def mock_account(self, monkeypatch: pytest.MonkeyPatch):
        """Create a mock Account for testing."""

        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.last_active_at = naive_utc_now()
        account.created_at = naive_utc_now()
        account.updated_at = naive_utc_now()
        account.id = str(uuid.uuid4())

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
        """Test that OWNER role can access chat-messages endpoint."""

        """Setup common mocks for testing."""
        # Mock app loading

        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        # Mock current user
        monkeypatch.setattr(completion_api, "current_user", mock_account)

        mock_generate = mock.Mock(return_value={"message": "Test response"})
        monkeypatch.setattr(AppGenerateService, "generate", mock_generate)

        # Set user role to OWNER
        mock_account.role = role

        response = test_client.post(
            f"/console/api/apps/{mock_app_model.id}/chat-messages",
            headers=auth_header,
            json={
                "inputs": {},
                "query": "Hello, world!",
                "model_config": {
                    "model": {"provider": "openai", "name": "gpt-4", "mode": "chat", "completion_params": {}}
                },
                "response_mode": "blocking",
            },
        )

        assert response.status_code == status

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
    def test_get_requires_edit_permission(
        self,
        test_client: FlaskClient,
        auth_header,
        monkeypatch,
        mock_app_model,
        mock_account,
        role: TenantAccountRole,
        status: int,
    ):
        """Ensure GET chat-messages endpoint enforces edit permissions."""

        mock_load_app_model = mock.Mock(return_value=mock_app_model)
        monkeypatch.setattr(wraps, "_load_app_model", mock_load_app_model)

        conversation_id = uuid.uuid4()
        created_at = naive_utc_now()

        mock_conversation = SimpleNamespace(id=str(conversation_id), app_id=str(mock_app_model.id))
        mock_message = SimpleNamespace(
            id=str(uuid.uuid4()),
            conversation_id=str(conversation_id),
            inputs=[],
            query="hello",
            message=[{"text": "hello"}],
            message_tokens=0,
            re_sign_file_url_answer="",
            answer_tokens=0,
            provider_response_latency=0.0,
            from_source="console",
            from_end_user_id=None,
            from_account_id=mock_account.id,
            feedbacks=[],
            workflow_run_id=None,
            annotation=None,
            annotation_hit_history=None,
            created_at=created_at,
            agent_thoughts=[],
            message_files=[],
            message_metadata_dict={},
            status="success",
            error="",
            parent_message_id=None,
        )

        class MockQuery:
            def __init__(self, model):
                self.model = model

            def where(self, *args, **kwargs):
                return self

            def first(self):
                if getattr(self.model, "__name__", "") == "Conversation":
                    return mock_conversation
                return None

            def order_by(self, *args, **kwargs):
                return self

            def limit(self, *_):
                return self

            def all(self):
                if getattr(self.model, "__name__", "") == "Message":
                    return [mock_message]
                return []

        mock_session = mock.Mock()
        mock_session.query.side_effect = MockQuery
        mock_session.scalar.return_value = False

        monkeypatch.setattr(message_api, "db", SimpleNamespace(session=mock_session))
        monkeypatch.setattr(message_api, "current_user", mock_account)

        class DummyPagination:
            def __init__(self, data, limit, has_more):
                self.data = data
                self.limit = limit
                self.has_more = has_more

        monkeypatch.setattr(message_api, "InfiniteScrollPagination", DummyPagination)

        mock_account.role = role

        response = test_client.get(
            f"/console/api/apps/{mock_app_model.id}/chat-messages",
            headers=auth_header,
            query_string={"conversation_id": str(conversation_id)},
        )

        assert response.status_code == status
