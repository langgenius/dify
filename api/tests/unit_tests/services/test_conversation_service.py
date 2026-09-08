"""
Comprehensive unit tests for ConversationService.

This file provides complete test coverage for all ConversationService methods.
Tests are organized by functionality and include edge cases, error handling,
and both positive and negative test scenarios. Database paths use isolated
in-memory SQLite sessions with persisted ORM rows.
"""

import json
from dataclasses import replace
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from sqlalchemy import asc, desc, event
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.credit_usage import CreditUsageAppType
from core.model_context import get_credit_usage_metadata, use_credit_usage_metadata
from libs.datetime_utils import naive_utc_now
from models import Account, ConversationVariable
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.enums import AppStatus, ConversationFromSource, ConversationStatus
from models.model import App, AppMode, Conversation, Message
from repositories.conversation_lifecycle import retire_conversation
from services import conversation_service
from services.agent.workspace_service import AgentWorkspaceNotFoundError, WorkspaceOwnerScope
from services.conversation_service import ConversationService
from services.errors.message import MessageNotExistsError

TENANT_ID = "11111111-1111-1111-1111-111111111111"
APP_ID = "22222222-2222-2222-2222-222222222222"
ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
CONVERSATION_ID = "44444444-4444-4444-4444-444444444444"
VARIABLE_ID = "55555555-5555-5555-5555-555555555555"
OTHER_VARIABLE_ID = "66666666-6666-6666-6666-666666666666"
OTHER_APP_ID = "77777777-7777-7777-7777-777777777777"
OTHER_CONVERSATION_ID = "88888888-8888-8888-8888-888888888888"
OTHER_APP_VARIABLE_ID = "99999999-9999-9999-9999-999999999999"
OTHER_CONVERSATION_VARIABLE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def _conversation_variable(
    *,
    variable_id: str,
    name: str,
    value: str,
    conversation_id: str = CONVERSATION_ID,
    app_id: str = APP_ID,
) -> ConversationVariable:
    return ConversationVariable(
        id=variable_id,
        conversation_id=conversation_id,
        app_id=app_id,
        data=json.dumps(
            {
                "id": variable_id,
                "name": name,
                "value_type": "string",
                "value": value,
            }
        ),
    )


def _workspace_binding(binding_id: str) -> AgentWorkspaceBinding:
    return AgentWorkspaceBinding(
        id=binding_id,
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        workspace_id="workspace-1",
        agent_id="agent-1",
        base_home_snapshot_id=None,
        agent_config_version_id="config-1",
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="backend-binding-1",
        status=AgentWorkingResourceStatus.ACTIVE,
    )


class ConversationServiceTestDataFactory:
    """
    Factory for creating test ORM objects.

    Provides reusable methods to create consistent model objects for testing
    conversation-related operations.
    """

    @staticmethod
    def create_account(account_id: str = ACCOUNT_ID, **kwargs) -> Account:
        """
        Create an Account object.

        Args:
            account_id: Unique identifier for the account
            **kwargs: Additional attributes to set on the model

        Returns:
            Account object with specified attributes
        """
        account = Account(name="Test User", email="test@example.com")
        account.id = account_id
        for key, value in kwargs.items():
            setattr(account, key, value)
        return account

    @staticmethod
    def create_app(app_id: str = APP_ID, tenant_id: str = TENANT_ID, **kwargs) -> App:
        """
        Create an App object.

        Args:
            app_id: Unique identifier for the app
            tenant_id: Tenant/workspace identifier
            **kwargs: Additional attributes to set on the model

        Returns:
            App object with specified attributes
        """
        app = App(
            id=app_id,
            tenant_id=tenant_id,
            name=kwargs.get("name", "Test App"),
            mode=kwargs.get("mode", AppMode.CHAT),
            status=kwargs.get("status", AppStatus.NORMAL),
            description="",
            enable_site=False,
            enable_api=False,
            max_active_requests=None,
        )
        for key, value in kwargs.items():
            setattr(app, key, value)
        return app

    @staticmethod
    def create_conversation(
        conversation_id: str = CONVERSATION_ID,
        app_id: str = APP_ID,
        from_source: ConversationFromSource = ConversationFromSource.CONSOLE,
        **kwargs,
    ) -> Conversation:
        """
        Create a Conversation object.

        Args:
            conversation_id: Unique identifier for the conversation
            app_id: Associated app identifier
            from_source: Source of conversation ('console' or 'api')
            **kwargs: Additional attributes to set on the model

        Returns:
            Conversation object with specified attributes
        """
        conversation = Conversation(
            id=conversation_id,
            app_id=app_id,
            mode=AppMode.CHAT,
            name=kwargs.get("name", "Test Conversation"),
            status=kwargs.get("status", ConversationStatus.NORMAL),
            from_source=from_source,
            from_end_user_id=kwargs.get("from_end_user_id"),
            from_account_id=kwargs.get("from_account_id", ACCOUNT_ID),
            is_deleted=kwargs.get("is_deleted", False),
            created_at=kwargs.get("created_at", naive_utc_now()),
            updated_at=kwargs.get("updated_at", naive_utc_now()),
        )
        conversation._inputs = {}
        for key, value in kwargs.items():
            setattr(conversation, key, value)
        return conversation


@pytest.fixture
def conversation_workspace(sqlite_session: Session) -> tuple[AgentWorkspace, AgentWorkspaceBinding]:
    workspace = AgentWorkspace(
        id="workspace-1",
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id=CONVERSATION_ID,
        owner_scope_key="root",
        backend_workspace_ref="backend-workspace-1",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    binding = _workspace_binding("binding-1")
    sqlite_session.add_all([workspace, binding])
    sqlite_session.flush()
    return workspace, binding


def test_delete_retires_then_commits_before_enqueue(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    conversation_workspace: tuple[AgentWorkspace, AgentWorkspaceBinding],
) -> None:
    workspace, binding = conversation_workspace
    app = ConversationServiceTestDataFactory.create_app()
    account = ConversationServiceTestDataFactory.create_account()
    conversation = ConversationServiceTestDataFactory.create_conversation()
    conversation.agent_workspace_binding_id = binding.id
    sqlite_session.add(conversation)
    sqlite_session.commit()
    events: list[str] = []
    event.listen(sqlite_session, "after_commit", lambda _session: events.append("commit"))

    def enqueue(*, tenant_id: str, binding_ids: tuple[str, ...]) -> None:
        assert tenant_id == TENANT_ID
        assert binding_ids == (binding.id,)
        assert not sqlite_session.in_transaction()
        assert conversation.is_deleted is True
        assert binding.status == workspace.status == AgentWorkingResourceStatus.RETIRED
        assert binding.retired_at is not None
        assert workspace.retired_at is not None
        assert workspace.active_guard is None
        events.append("agent cleanup")

    monkeypatch.setattr(conversation_service, "enqueue_agent_resource_collection", enqueue)
    delete_related = MagicMock(side_effect=lambda _conversation_id: events.append("conversation cleanup"))
    monkeypatch.setattr(conversation_service.delete_conversation_related_data, "delay", delete_related)

    ConversationService.delete(app, conversation.id, account, session=sqlite_session)

    assert events == ["commit", "agent cleanup", "conversation cleanup"]
    delete_related.assert_called_once_with(conversation.id)


def test_delete_commit_failure_rolls_back_all_lifecycle_changes_without_enqueue(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    conversation_workspace: tuple[AgentWorkspace, AgentWorkspaceBinding],
) -> None:
    workspace, binding = conversation_workspace
    app = ConversationServiceTestDataFactory.create_app()
    account = ConversationServiceTestDataFactory.create_account()
    conversation = ConversationServiceTestDataFactory.create_conversation()
    conversation.agent_workspace_binding_id = binding.id
    sqlite_session.add(conversation)
    sqlite_session.commit()

    def fail_commit(session: Session) -> None:
        session.flush()
        raise RuntimeError("commit failed")

    event.listen(sqlite_session, "before_commit", fail_commit, once=True)
    enqueue_collection = MagicMock()
    delete_related = MagicMock()
    monkeypatch.setattr(conversation_service, "enqueue_agent_resource_collection", enqueue_collection)
    monkeypatch.setattr(conversation_service.delete_conversation_related_data, "delay", delete_related)

    with pytest.raises(RuntimeError, match="commit failed"):
        ConversationService.delete(app, conversation.id, account, session=sqlite_session)

    assert conversation.is_deleted is False
    assert binding.status == workspace.status == AgentWorkingResourceStatus.ACTIVE
    assert binding.retired_at is None
    assert workspace.retired_at is None
    assert workspace.active_guard == 1
    enqueue_collection.assert_not_called()
    delete_related.assert_not_called()


def test_retire_leaves_commit_and_cleanup_to_the_caller(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    conversation_workspace: tuple[AgentWorkspace, AgentWorkspaceBinding],
) -> None:
    workspace, binding = conversation_workspace
    app = ConversationServiceTestDataFactory.create_app()
    conversation = ConversationServiceTestDataFactory.create_conversation()
    conversation.agent_workspace_binding_id = binding.id
    sqlite_session.add(conversation)
    sqlite_session.commit()
    enqueue_collection = MagicMock()
    delete_related = MagicMock()
    monkeypatch.setattr(conversation_service, "enqueue_agent_resource_collection", enqueue_collection)
    monkeypatch.setattr(conversation_service.delete_conversation_related_data, "delay", delete_related)

    retired_binding_id = retire_conversation(app_model=app, conversation=conversation, session=sqlite_session)
    sqlite_session.flush()

    assert retired_binding_id == binding.id
    assert conversation.is_deleted is True
    assert binding.status == workspace.status == AgentWorkingResourceStatus.RETIRED
    enqueue_collection.assert_not_called()
    delete_related.assert_not_called()
    sqlite_session.rollback()
    restored = sqlite_session.get(Conversation, CONVERSATION_ID)
    assert restored is not None
    assert restored.is_deleted is False
    assert binding.status == workspace.status == AgentWorkingResourceStatus.ACTIVE


_CONVERSATION_OWNER = WorkspaceOwnerScope(
    tenant_id=TENANT_ID,
    app_id=APP_ID,
    owner_type=AgentWorkspaceOwnerType.CONVERSATION,
    owner_id=CONVERSATION_ID,
)


@pytest.mark.parametrize(
    "scope",
    [
        replace(_CONVERSATION_OWNER, tenant_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        replace(_CONVERSATION_OWNER, app_id=OTHER_APP_ID),
        replace(_CONVERSATION_OWNER, owner_type=AgentWorkspaceOwnerType.WORKFLOW_RUN),
        replace(_CONVERSATION_OWNER, owner_id=OTHER_CONVERSATION_ID),
        replace(_CONVERSATION_OWNER, owner_scope_key="other"),
    ],
    ids=["tenant", "app", "owner type", "owner id", "owner scope"],
)
def test_retire_rejects_participants_owned_by_another_scope(
    scope: WorkspaceOwnerScope,
    sqlite_session: Session,
    conversation_workspace: tuple[AgentWorkspace, AgentWorkspaceBinding],
) -> None:
    workspace, binding = conversation_workspace
    workspace.tenant_id = scope.tenant_id
    workspace.app_id = scope.app_id
    workspace.owner_type = scope.owner_type
    workspace.owner_id = scope.owner_id
    workspace.owner_scope_key = scope.owner_scope_key
    app = ConversationServiceTestDataFactory.create_app()
    conversation = ConversationServiceTestDataFactory.create_conversation()
    conversation.agent_workspace_binding_id = binding.id
    sqlite_session.add(conversation)
    sqlite_session.commit()

    with pytest.raises(AgentWorkspaceNotFoundError, match="participant Binding is unavailable"):
        retire_conversation(app_model=app, conversation=conversation, session=sqlite_session)

    assert conversation.is_deleted is False
    assert binding.status == workspace.status == AgentWorkingResourceStatus.ACTIVE


def test_delete_keeps_soft_deleted_marker_when_dispatch_fails(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    app = ConversationServiceTestDataFactory.create_app()
    account = ConversationServiceTestDataFactory.create_account()
    conversation = ConversationServiceTestDataFactory.create_conversation()
    sqlite_session.add(conversation)
    sqlite_session.flush()
    monkeypatch.setattr(
        conversation_service.delete_conversation_related_data,
        "delay",
        MagicMock(side_effect=RuntimeError("broker unavailable")),
    )

    ConversationService.delete(app, conversation.id, account, session=sqlite_session)

    persisted = sqlite_session.get(Conversation, conversation.id)
    assert persisted is not None
    assert persisted.is_deleted is True


def test_cleanup_propagates_agent_enqueue_failure_before_conversation_enqueue(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        conversation_service, "enqueue_agent_resource_collection", MagicMock(side_effect=RuntimeError("unavailable"))
    )
    delete_related = MagicMock()
    monkeypatch.setattr(conversation_service.delete_conversation_related_data, "delay", delete_related)

    with pytest.raises(RuntimeError, match="unavailable"):
        ConversationService.enqueue_delete_cleanup(
            tenant_id=TENANT_ID, conversation_id=CONVERSATION_ID, retired_binding_id="binding-1"
        )

    delete_related.assert_not_called()


@pytest.mark.parametrize("naming_fails", [False, True])
def test_legacy_auto_generate_name_preserves_metadata_and_persists_success_or_original_title(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, naming_fails: bool
) -> None:
    app = ConversationServiceTestDataFactory.create_app(mode=AppMode.ADVANCED_CHAT)
    conversation = ConversationServiceTestDataFactory.create_conversation(mode=AppMode.ADVANCED_CHAT)
    message = Message(
        app_id=APP_ID,
        conversation_id=CONVERSATION_ID,
        _inputs={},
        query="First query",
        message={},
        answer="Answer",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=ACCOUNT_ID,
    )
    sqlite_session.add_all([app, conversation, message])
    sqlite_session.commit()
    calls: list[tuple[str, str, str, str, dict[str, object]]] = []

    def generate(tenant_id: str, query: str, conversation_id: str, app_id: str) -> str:
        calls.append((tenant_id, query, conversation_id, app_id, dict(get_credit_usage_metadata() or {})))
        if naming_fails:
            raise RuntimeError("Provider unavailable")
        return "Generated title"

    monkeypatch.setattr(conversation_service.LLMGenerator, "generate_conversation_name", generate)
    previous_metadata = get_credit_usage_metadata()
    with use_credit_usage_metadata({"request_id": "legacy-name-request"}):
        inherited_metadata = dict(get_credit_usage_metadata() or {})
        result = ConversationService.auto_generate_name(app, conversation, session=sqlite_session)
        assert get_credit_usage_metadata() == inherited_metadata
    assert get_credit_usage_metadata() == previous_metadata
    # Assert outside the best-effort naming call so its exception suppression
    # cannot hide failed assertions inside the external provider callback.
    assert calls == [
        (
            TENANT_ID,
            "First query",
            CONVERSATION_ID,
            APP_ID,
            {"app_type": CreditUsageAppType.CHATFLOW, **inherited_metadata},
        )
    ]
    assert result is conversation
    sqlite_session.refresh(result)
    assert result.name == ("Test Conversation" if naming_fails else "Generated title")


def test_legacy_auto_generate_name_reports_missing_first_message(sqlite_session: Session) -> None:
    app = ConversationServiceTestDataFactory.create_app()
    conversation = ConversationServiceTestDataFactory.create_conversation()
    sqlite_session.add(conversation)
    sqlite_session.commit()

    with pytest.raises(MessageNotExistsError):
        ConversationService.auto_generate_name(app, conversation, session=sqlite_session)

    assert conversation.name == "Test Conversation"


class TestConversationServicePagination:
    """Test conversation pagination operations."""

    def test_pagination_with_empty_include_ids(self, sqlite_session: Session):
        """
        Test that empty include_ids returns empty result.

        When include_ids is an empty list, the service should short-circuit
        and return empty results without querying the database.
        """
        # Arrange - Set up test data
        app_model = ConversationServiceTestDataFactory.create_app()
        user = ConversationServiceTestDataFactory.create_account()

        # Act - Call the service method with empty include_ids
        result = ConversationService.pagination_by_last_id(
            session=sqlite_session,
            app_model=app_model,
            user=user,
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
            include_ids=[],  # Empty list should trigger early return
            exclude_ids=None,
        )

        # Assert - Verify empty result without database query
        assert result.data == []  # No conversations returned
        assert result.has_more is False  # No more pages available
        assert result.limit == 20  # Limit preserved in response
        assert not sqlite_session.in_transaction()

    def test_pagination_returns_empty_when_user_is_none(self, sqlite_session: Session):
        """
        Test that pagination returns empty result when user is None.

        This ensures proper handling of unauthenticated requests.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app()

        # Act
        result = ConversationService.pagination_by_last_id(
            session=sqlite_session,
            app_model=app_model,
            user=None,  # No user provided
            last_id=None,
            limit=20,
            invoke_from=InvokeFrom.WEB_APP,
        )

        # Assert - should return empty result without querying database
        assert result.data == []
        assert result.has_more is False
        assert result.limit == 20
        assert not sqlite_session.in_transaction()


class TestConversationServiceHelpers:
    """Test helper methods in ConversationService."""

    def test_get_sort_params_with_descending_sort(self):
        """
        Test _get_sort_params with descending sort prefix.

        When sort_by starts with '-', should return field name and desc function.
        """
        # Act
        field, direction = ConversationService._get_sort_params("-updated_at")

        # Assert
        assert field == "updated_at"
        assert direction == desc

    def test_get_sort_params_with_ascending_sort(self):
        """
        Test _get_sort_params with ascending sort.

        When sort_by doesn't start with '-', should return field name and asc function.
        """
        # Act
        field, direction = ConversationService._get_sort_params("created_at")

        # Assert
        assert field == "created_at"
        assert direction == asc

    def test_build_filter_condition_with_descending_sort(self):
        """
        Test _build_filter_condition with descending sort direction.

        Should create a less-than filter condition.
        """
        # Arrange
        conversation = ConversationServiceTestDataFactory.create_conversation()
        conversation.updated_at = naive_utc_now()

        # Act
        condition = ConversationService._build_filter_condition(
            sort_field="updated_at",
            sort_direction=desc,
            reference_conversation=conversation,
        )

        # Assert
        # The condition should be a comparison expression
        assert condition is not None

    def test_build_filter_condition_with_ascending_sort(self):
        """
        Test _build_filter_condition with ascending sort direction.

        Should create a greater-than filter condition.
        """
        # Arrange
        conversation = ConversationServiceTestDataFactory.create_conversation()
        conversation.created_at = naive_utc_now()

        # Act
        condition = ConversationService._build_filter_condition(
            sort_field="created_at",
            sort_direction=asc,
            reference_conversation=conversation,
        )

        # Assert
        # The condition should be a comparison expression
        assert condition is not None


class TestConversationServiceConversationalVariable:
    """Test conversational variable operations."""

    @pytest.mark.parametrize("sqlite_session", [(Conversation, ConversationVariable)], indirect=True)
    def test_get_conversational_variable_with_name_filter_mysql(
        self,
        sqlite_session: Session,
        config_overrides,
    ):
        """
        Test variable filtering by name for MySQL databases.

        Should apply JSON extraction filter for variable names.
        """
        # Arrange
        app_model = ConversationServiceTestDataFactory.create_app()
        user = ConversationServiceTestDataFactory.create_account()
        conversation = ConversationServiceTestDataFactory.create_conversation()
        matching_variable = _conversation_variable(
            variable_id=VARIABLE_ID,
            name="test_var",
            value="matching",
        )
        other_variable = _conversation_variable(
            variable_id=OTHER_VARIABLE_ID,
            name="unrelated",
            value="excluded",
        )
        other_app_variable = _conversation_variable(
            variable_id=OTHER_APP_VARIABLE_ID,
            name="test_var",
            value="other-app",
            app_id=OTHER_APP_ID,
        )
        other_conversation_variable = _conversation_variable(
            variable_id=OTHER_CONVERSATION_VARIABLE_ID,
            name="test_var",
            value="other-conversation",
            conversation_id=OTHER_CONVERSATION_ID,
        )
        sqlite_session.add_all(
            [
                conversation,
                matching_variable,
                other_variable,
                other_app_variable,
                other_conversation_variable,
            ]
        )
        sqlite_session.commit()
        config_overrides(DB_TYPE="mysql")

        # Act
        result = ConversationService.get_conversational_variable(
            app_model=app_model,
            conversation_id=CONVERSATION_ID,
            user=user,
            limit=10,
            last_id=None,
            variable_name="test_var",
            session=sqlite_session,
        )

        # Assert - SQLite executes the MySQL-compatible JSON extraction boundary.
        assert result.has_more is False
        assert result.limit == 10
        assert len(result.data) == 1
        assert result.data[0]["id"] == VARIABLE_ID
        assert result.data[0]["name"] == "test_var"
        assert result.data[0]["value"] == "matching"
