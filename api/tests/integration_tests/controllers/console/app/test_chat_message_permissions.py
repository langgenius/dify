"""Integration tests for ChatMessageApi permission verification."""

import uuid
from unittest import mock

import pytest
from flask.testing import FlaskClient

from controllers.console.app import completion as completion_api
from controllers.console.app import message as message_api
from controllers.console.app import wraps
from libs.datetime_utils import naive_utc_now
from models import App, Tenant
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import AppStatus, ConversationFromSource, MessageStatus
from models.model import AppMode, Conversation, Message
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
        app.status = AppStatus.NORMAL
        app.enable_site = True
        app.enable_api = True
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

        mock_conversation = mock.MagicMock(spec=Conversation)
        mock_conversation.id = str(conversation_id)
        mock_conversation.app_id = str(mock_app_model.id)

        mock_message = mock.MagicMock(spec=Message)
        mock_message.id = str(uuid.uuid4())
        mock_message.conversation_id = str(conversation_id)
        mock_message.inputs = {}
        mock_message.query = "hello"
        mock_message.message = {"text": "hello"}
        mock_message.message_tokens = 0
        mock_message.re_sign_file_url_answer = ""
        mock_message.answer_tokens = 0
        mock_message.provider_response_latency = 0.0
        mock_message.from_source = ConversationFromSource.CONSOLE
        mock_message.from_end_user_id = None
        mock_message.from_account_id = mock_account.id
        mock_message.feedbacks = []
        mock_message.workflow_run_id = None
        mock_message.annotation = None
        mock_message.annotation_hit_history = None
        mock_message.created_at = created_at
        mock_message.agent_thoughts = []
        mock_message.message_files = []
        mock_message.extra_contents = []
        mock_message.message_metadata_dict = {}
        mock_message.status = MessageStatus.NORMAL
        mock_message.error = ""
        mock_message.parent_message_id = None

        mock_session = mock.Mock()
        mock_session.scalar.return_value = mock_conversation
        mock_scalars_result = mock.Mock()
        mock_scalars_result.all.return_value = [mock_message]
        mock_session.scalars.return_value = mock_scalars_result

        db_stub = mock.Mock()
        db_stub.session = mock_session
        monkeypatch.setattr(message_api, "db", db_stub)
        monkeypatch.setattr(message_api, "attach_message_extra_contents", lambda *_args, **_kwargs: None)

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
