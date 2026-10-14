"""Console deletion retains account ownership and commits lifecycle changes together."""

from dataclasses import dataclass
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.agent.workspace import AgentWorkspaceNotFoundError
from machinery.context import RequestContext
from models.account import Account
from models.agent import (
    Agent,
    AgentConfigVersionKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation
from repositories.conversation_repository import ConversationRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.conversation_entities import ConsoleConversationKind
from services.errors.conversation import ConversationNotExistsError


@dataclass(frozen=True)
class ConsoleDeletionData:
    context: RequestContext
    app_id: str
    conversation_id: str
    workspace_ids: tuple[str, ...]
    binding_id: str


@pytest.fixture
def deletion_data(sqlite_session_factory: sessionmaker[Session]) -> ConsoleDeletionData:
    with sqlite_session_factory.begin() as session:
        account = Account(name="Maintainer", email="maintainer@example.com", timezone="UTC")
        app = App(tenant_id=str(uuid4()), name="Chat", mode=AppMode.CHAT, enable_api=True, enable_site=True)
        session.add_all([account, app])
        session.flush()
        conversation = Conversation(
            app_id=app.id,
            mode=AppMode.CHAT,
            name="Owned conversation",
            inputs={},
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=account.id,
            from_end_user_id=None,
            is_deleted=False,
        )
        session.add(conversation)
        session.flush()
        workspaces = [
            AgentWorkspace(
                tenant_id=app.tenant_id,
                app_id=app.id,
                owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                owner_id=conversation.id,
                owner_scope_key=scope,
                backend_workspace_ref=f"workspace-{scope}",
                status=AgentWorkingResourceStatus.ACTIVE,
                active_guard=1,
            )
            for scope in ("root", "node:workflow-binding")
        ]
        session.add_all(workspaces)
        session.flush()
        binding = AgentWorkspaceBinding(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workspace_id=workspaces[0].id,
            agent_id=str(uuid4()),
            agent_config_version_id=str(uuid4()),
            agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
            backend_binding_ref="binding",
            status=AgentWorkingResourceStatus.ACTIVE,
        )
        session.add(binding)
        session.flush()
        conversation.agent_workspace_binding_id = binding.id
        return ConsoleDeletionData(
            context=RequestContext(
                request_id="test", trace_id=None, account_id=account.id, active_workspace_id=app.tenant_id
            ),
            app_id=app.id,
            conversation_id=conversation.id,
            workspace_ids=tuple(workspace.id for workspace in workspaces),
            binding_id=binding.id,
        )


def _assert_active(factory: sessionmaker[Session], data: ConsoleDeletionData) -> None:
    with factory() as session:
        assert session.get_one(Conversation, data.conversation_id).is_deleted is False
        for workspace_id in data.workspace_ids:
            workspace = session.get_one(AgentWorkspace, workspace_id)
            assert workspace.status == AgentWorkingResourceStatus.ACTIVE
            assert workspace.active_guard == 1
            assert workspace.retired_at is None
        binding = session.get_one(AgentWorkspaceBinding, data.binding_id)
        assert binding.status == AgentWorkingResourceStatus.ACTIVE
        assert binding.retired_at is None


@pytest.mark.parametrize(
    ("kind", "mode"),
    [
        ("completion", AppMode.COMPLETION),
        ("chat", AppMode.CHAT),
        ("chat", AppMode.AGENT_CHAT),
        ("chat", AppMode.ADVANCED_CHAT),
        ("chat", AppMode.AGENT),
    ],
)
def test_delete_commits_retirement_and_returns_cleanup_references(
    sqlite_session_factory: sessionmaker[Session],
    deletion_data: ConsoleDeletionData,
    kind: ConsoleConversationKind,
    mode: AppMode,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(App, deletion_data.app_id).mode = mode
    repository = ConversationRepository(session_factory=sqlite_session_factory)

    deleted = repository.delete_console(
        deletion_data.context, deletion_data.app_id, deletion_data.conversation_id, kind=kind
    )

    assert deleted.tenant_id == deletion_data.context.active_workspace_id
    assert deleted.conversation_id == deletion_data.conversation_id
    assert set(deleted.retired_workspace_ids) == set(deletion_data.workspace_ids)
    with sqlite_session_factory() as session:
        assert session.get_one(Conversation, deletion_data.conversation_id).is_deleted is True
        for workspace_id in deletion_data.workspace_ids:
            workspace = session.get_one(AgentWorkspace, workspace_id)
            assert workspace.status == AgentWorkingResourceStatus.RETIRED
            assert workspace.active_guard is None
            assert workspace.retired_at is not None
        binding = session.get_one(AgentWorkspaceBinding, deletion_data.binding_id)
        assert binding.status == AgentWorkingResourceStatus.RETIRED
        assert binding.retired_at is not None
    with pytest.raises(ConversationNotExistsError):
        repository.delete_console(deletion_data.context, deletion_data.app_id, deletion_data.conversation_id, kind=kind)


def test_delete_conversation_without_agent_workspaces(
    sqlite_session_factory: sessionmaker[Session], deletion_data: ConsoleDeletionData
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(Conversation, deletion_data.conversation_id).agent_workspace_binding_id = None
        session.delete(session.get_one(AgentWorkspaceBinding, deletion_data.binding_id))
        for workspace_id in deletion_data.workspace_ids:
            session.delete(session.get_one(AgentWorkspace, workspace_id))

    deleted = ConversationRepository(session_factory=sqlite_session_factory).delete_console(
        deletion_data.context, deletion_data.app_id, deletion_data.conversation_id, kind="chat"
    )

    assert deleted.retired_workspace_ids == ()
    with sqlite_session_factory() as session:
        assert session.get_one(Conversation, deletion_data.conversation_id).is_deleted is True


@pytest.mark.parametrize("change", ["missing", "tenant", "status", "mode", "hidden_agent"])
@pytest.mark.parametrize("kind", ["completion", "chat"])
def test_delete_rejects_unavailable_or_hidden_app_without_retiring_conversation(
    sqlite_session_factory: sessionmaker[Session],
    deletion_data: ConsoleDeletionData,
    change: str,
    kind: ConsoleConversationKind,
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get_one(App, deletion_data.app_id)
        app.mode = AppMode.COMPLETION if kind == "completion" else AppMode.CHAT
        if change == "missing":
            session.delete(app)
        elif change == "tenant":
            app.tenant_id = str(uuid4())
        elif change == "status":
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app.id})
        elif change == "mode":
            app.mode = AppMode.CHAT if kind == "completion" else AppMode.COMPLETION
        else:
            app.mode = AppMode.AGENT
            session.add(
                Agent(
                    tenant_id=app.tenant_id,
                    name="Hidden",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    backing_app_id=app.id,
                    status=AgentStatus.ARCHIVED,
                )
            )
    with pytest.raises(ConsoleAppNotFoundError):
        ConversationRepository(session_factory=sqlite_session_factory).delete_console(
            deletion_data.context, deletion_data.app_id, deletion_data.conversation_id, kind=kind
        )
    _assert_active(sqlite_session_factory, deletion_data)


@pytest.mark.parametrize("change", ["app", "account", "source", "end_user", "deleted", "missing"])
def test_delete_requires_exact_console_conversation_owner(
    sqlite_session_factory: sessionmaker[Session], deletion_data: ConsoleDeletionData, change: str
) -> None:
    conversation_id = deletion_data.conversation_id
    with sqlite_session_factory.begin() as session:
        conversation = session.get_one(Conversation, conversation_id)
        if change == "app":
            conversation.app_id = str(uuid4())
        elif change == "account":
            conversation.from_account_id = str(uuid4())
        elif change == "source":
            conversation.from_source = ConversationFromSource.API
        elif change == "end_user":
            conversation.from_end_user_id = str(uuid4())
        elif change == "deleted":
            conversation.is_deleted = True
        else:
            conversation_id = str(uuid4())
    with pytest.raises(ConversationNotExistsError):
        ConversationRepository(session_factory=sqlite_session_factory).delete_console(
            deletion_data.context, deletion_data.app_id, conversation_id, kind="chat"
        )
    with sqlite_session_factory() as session:
        conversation = session.get_one(Conversation, deletion_data.conversation_id)
        assert conversation.is_deleted is (change == "deleted")
        for workspace_id in deletion_data.workspace_ids:
            assert session.get_one(AgentWorkspace, workspace_id).status == AgentWorkingResourceStatus.ACTIVE


def test_wrong_binding_owner_prevents_all_lifecycle_changes(
    sqlite_session_factory: sessionmaker[Session], deletion_data: ConsoleDeletionData
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(AgentWorkspace, deletion_data.workspace_ids[0]).owner_id = str(uuid4())
    with pytest.raises(AgentWorkspaceNotFoundError, match="Binding is unavailable"):
        ConversationRepository(session_factory=sqlite_session_factory).delete_console(
            deletion_data.context, deletion_data.app_id, deletion_data.conversation_id, kind="chat"
        )
    _assert_active(sqlite_session_factory, deletion_data)


def test_failed_database_write_rolls_back_workspace_and_binding_retirement(
    sqlite_session_factory: sessionmaker[Session], deletion_data: ConsoleDeletionData
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(
            text(
                "CREATE TRIGGER reject_conversation_deletion BEFORE UPDATE OF is_deleted ON conversations "
                "WHEN NEW.is_deleted = 1 BEGIN SELECT RAISE(ABORT, 'conversation deletion rejected'); END"
            )
        )
    try:
        with pytest.raises(IntegrityError, match="conversation deletion rejected"):
            ConversationRepository(session_factory=sqlite_session_factory).delete_console(
                deletion_data.context, deletion_data.app_id, deletion_data.conversation_id, kind="chat"
            )
        _assert_active(sqlite_session_factory, deletion_data)
    finally:
        with sqlite_session_factory.begin() as session:
            session.execute(text("DROP TRIGGER reject_conversation_deletion"))
