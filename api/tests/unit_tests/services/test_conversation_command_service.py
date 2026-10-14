"""Conversation commands exercise persistence, ownership and cleanup ordering."""

from dataclasses import dataclass, replace
from uuid import uuid4

import pytest
from sqlalchemy import Engine, delete, event, select, update
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import Account
from models.agent import (
    AgentConfigVersionKind,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.enums import ConversationFromSource, CreatorUserRole, EndUserType
from models.model import App, AppMode, Conversation, EndUser
from models.web import PinnedConversation
from repositories.conversation_repository import ConversationRepository
from services.conversation_command_service import ConversationCleanup, ConversationCommandService
from services.entities.conversation_entities import EndUserConversationRef
from services.errors.conversation import ConversationNotExistsError


@pytest.fixture
def end_user_ref(sqlite_session_factory: sessionmaker[Session]) -> EndUserConversationRef:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Chat", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        end_user = EndUser(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        session.add(end_user)
        session.flush()
        conversation = Conversation(
            app_id=app.id,
            mode=AppMode.CHAT,
            name="Original",
            inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
            from_account_id=None,
            is_deleted=False,
        )
        session.add(conversation)
        session.flush()
        return EndUserConversationRef(
            app_id=app.id,
            tenant_id=app.tenant_id,
            end_user_id=end_user.id,
            conversation_id=conversation.id,
        )


def _unexpected_cleanup(**_kwargs: object) -> None:
    raise AssertionError("No cleanup should be dispatched")


def _service(
    factory: sessionmaker[Session], *, cleanup: ConversationCleanup = _unexpected_cleanup
) -> ConversationCommandService:
    return ConversationCommandService(
        conversations=ConversationRepository(session_factory=factory), enqueue_delete_cleanup=cleanup
    )


def test_delete_commits_and_returns_connection_before_dispatching_workspace_cleanup(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, end_user_ref: EndUserConversationRef
) -> None:
    with sqlite_session_factory.begin() as session:
        workspace = AgentWorkspace(
            id=str(uuid4()),
            tenant_id=end_user_ref.tenant_id,
            app_id=end_user_ref.app_id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=end_user_ref.conversation_id,
            owner_scope_key="conversation-binding",
            backend_workspace_ref="backend-workspace",
            status=AgentWorkingResourceStatus.ACTIVE,
            active_guard=1,
        )
        session.add(workspace)
    events: list[str] = []

    @event.listens_for(sqlite_engine, "checkout")
    def checkout(_connection: object, _record: object, _proxy: object) -> None:
        events.append("checkout")

    @event.listens_for(sqlite_engine, "checkin")
    def checkin(_connection: object, _record: object) -> None:
        events.append("checkin")

    def cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
        assert events == ["checkout", "checkin"]
        assert (tenant_id, conversation_id) == (end_user_ref.tenant_id, end_user_ref.conversation_id)
        assert retired_workspace_ids == (workspace.id,)
        events.append("cleanup")
        with sqlite_session_factory() as session:
            assert session.scalar(select(Conversation.is_deleted).where(Conversation.id == conversation_id)) is True
            stored_workspace = session.get(AgentWorkspace, workspace.id)
            assert stored_workspace is not None
            assert stored_workspace.status == AgentWorkingResourceStatus.RETIRED
            assert stored_workspace.active_guard is None
            assert stored_workspace.retired_at is not None

    service = _service(sqlite_session_factory, cleanup=cleanup)
    service.delete(ref=end_user_ref)
    assert events == ["checkout", "checkin", "cleanup", "checkout", "checkin"]
    with pytest.raises(ConversationNotExistsError):
        service.delete(ref=end_user_ref)
    assert events.count("cleanup") == 1


def test_failed_delete_commit_preserves_conversation_and_workspace_without_cleanup(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, end_user_ref: EndUserConversationRef
) -> None:
    with sqlite_session_factory.begin() as session:
        workspace = AgentWorkspace(
            id=str(uuid4()),
            tenant_id=end_user_ref.tenant_id,
            app_id=end_user_ref.app_id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=end_user_ref.conversation_id,
            owner_scope_key="conversation-binding",
            backend_workspace_ref="backend-workspace",
            status=AgentWorkingResourceStatus.ACTIVE,
            active_guard=1,
        )
        session.add(workspace)
    factory = sessionmaker(bind=sqlite_engine)
    failure = RuntimeError("Database commit failed")

    @event.listens_for(factory, "before_commit")
    def fail_commit(_session: Session) -> None:
        raise failure

    with pytest.raises(RuntimeError) as error:
        _service(factory).delete(ref=end_user_ref)
    assert error.value is failure
    with sqlite_session_factory() as session:
        assert (
            session.scalar(select(Conversation.is_deleted).where(Conversation.id == end_user_ref.conversation_id))
            is False
        )
        stored_workspace = session.get(AgentWorkspace, workspace.id)
        assert stored_workspace is not None
        assert stored_workspace.status == AgentWorkingResourceStatus.ACTIVE
        assert stored_workspace.active_guard == 1
        assert stored_workspace.retired_at is None


@pytest.mark.parametrize("operation", ["delete", "pin"])
@pytest.mark.parametrize(
    "mismatch", ["app_id", "from_source", "from_account_id", "from_end_user_id", "is_deleted", "missing"]
)
def test_end_user_commands_reject_every_conversation_owner_mismatch(
    sqlite_session_factory: sessionmaker[Session],
    end_user_ref: EndUserConversationRef,
    operation: str,
    mismatch: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        if mismatch == "missing":
            session.execute(delete(Conversation).where(Conversation.id == end_user_ref.conversation_id))
        else:
            value: str | bool = True if mismatch == "is_deleted" else str(uuid4())
            if mismatch == "from_source":
                value = ConversationFromSource.CONSOLE
            session.execute(
                update(Conversation).where(Conversation.id == end_user_ref.conversation_id).values({mismatch: value})
            )
    service = _service(sqlite_session_factory)
    if operation == "delete":
        with pytest.raises(ConversationNotExistsError):
            service.delete(ref=end_user_ref)
    else:
        with pytest.raises(ConversationNotExistsError):
            service.set_pinned(ref=end_user_ref, is_pinned=True)
    with sqlite_session_factory() as session:
        assert session.scalars(select(PinnedConversation)).all() == []
        stored = session.get(Conversation, end_user_ref.conversation_id)
        if mismatch == "missing":
            assert stored is None
        else:
            assert stored is not None
            assert stored.is_deleted is (mismatch == "is_deleted")


@pytest.mark.parametrize("operation", ["delete", "pin", "unpin"])
@pytest.mark.parametrize(
    "mismatch", ["app_tenant", "end_user_tenant", "end_user_app", "app_missing", "end_user_missing"]
)
def test_end_user_commands_revalidate_app_and_end_user_owner_chain(
    sqlite_session_factory: sessionmaker[Session],
    end_user_ref: EndUserConversationRef,
    operation: str,
    mismatch: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        pin = PinnedConversation(
            app_id=end_user_ref.app_id,
            conversation_id=end_user_ref.conversation_id,
            created_by_role=CreatorUserRole.END_USER,
            created_by=end_user_ref.end_user_id,
        )
        session.add(pin)
        if mismatch == "app_tenant":
            session.execute(update(App).where(App.id == end_user_ref.app_id).values(tenant_id=str(uuid4())))
        elif mismatch == "end_user_tenant":
            session.execute(
                update(EndUser).where(EndUser.id == end_user_ref.end_user_id).values(tenant_id=str(uuid4()))
            )
        elif mismatch == "end_user_app":
            session.execute(update(EndUser).where(EndUser.id == end_user_ref.end_user_id).values(app_id=str(uuid4())))
        elif mismatch == "app_missing":
            session.execute(delete(App).where(App.id == end_user_ref.app_id))
        else:
            session.execute(delete(EndUser).where(EndUser.id == end_user_ref.end_user_id))
    service = _service(sqlite_session_factory)
    if operation == "delete":
        with pytest.raises(ConversationNotExistsError):
            service.delete(ref=end_user_ref)
    else:
        with pytest.raises(ConversationNotExistsError):
            service.set_pinned(ref=end_user_ref, is_pinned=operation == "pin")
    with sqlite_session_factory() as session:
        assert (
            session.scalar(select(Conversation.is_deleted).where(Conversation.id == end_user_ref.conversation_id))
            is False
        )
        assert session.get(PinnedConversation, pin.id) is not None


def test_end_user_pin_and_unpin_are_idempotent_and_preserve_other_roles_and_owners(
    sqlite_session_factory: sessionmaker[Session], end_user_ref: EndUserConversationRef
) -> None:
    with sqlite_session_factory.begin() as session:
        other_pins = [
            PinnedConversation(
                app_id=app_id,
                conversation_id=end_user_ref.conversation_id,
                created_by_role=role,
                created_by=actor_id,
            )
            for app_id, role, actor_id in [
                (end_user_ref.app_id, CreatorUserRole.ACCOUNT, end_user_ref.end_user_id),
                (end_user_ref.app_id, CreatorUserRole.END_USER, str(uuid4())),
                (str(uuid4()), CreatorUserRole.END_USER, end_user_ref.end_user_id),
            ]
        ]
        session.add_all(other_pins)
    service = _service(sqlite_session_factory)
    for _ in range(2):
        service.set_pinned(ref=end_user_ref, is_pinned=True)
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(PinnedConversation)).all()) == 4
    for _ in range(2):
        service.set_pinned(ref=end_user_ref, is_pinned=False)
    service.set_pinned(ref=replace(end_user_ref, conversation_id=str(uuid4())), is_pinned=False)
    with sqlite_session_factory() as session:
        assert {pin.id for pin in session.scalars(select(PinnedConversation))} == {pin.id for pin in other_pins}


@pytest.mark.parametrize("state", ["deleted", "missing"])
def test_end_user_existing_pin_and_unpin_do_not_require_live_conversation(
    sqlite_session_factory: sessionmaker[Session], end_user_ref: EndUserConversationRef, state: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            PinnedConversation(
                app_id=end_user_ref.app_id,
                conversation_id=end_user_ref.conversation_id,
                created_by_role=CreatorUserRole.END_USER,
                created_by=end_user_ref.end_user_id,
            )
        )
        if state == "deleted":
            session.execute(
                update(Conversation).where(Conversation.id == end_user_ref.conversation_id).values(is_deleted=True)
            )
        else:
            session.execute(delete(Conversation).where(Conversation.id == end_user_ref.conversation_id))
    service = _service(sqlite_session_factory)
    service.set_pinned(ref=end_user_ref, is_pinned=True)
    service.set_pinned(ref=end_user_ref, is_pinned=False)
    service.set_pinned(ref=end_user_ref, is_pinned=False)
    with sqlite_session_factory() as session:
        assert session.scalars(select(PinnedConversation)).all() == []


@dataclass(frozen=True)
class ConsoleDeletionData:
    context: RequestContext
    app_id: str
    conversation_id: str
    workspace_ids: tuple[str, ...]
    binding_ids: tuple[str, ...]


@pytest.fixture
def console_deletion(sqlite_session_factory: sessionmaker[Session]) -> ConsoleDeletionData:
    context = RequestContext(
        request_id="console-delete", trace_id=None, account_id=str(uuid4()), active_workspace_id=str(uuid4())
    )
    with sqlite_session_factory.begin() as session:
        app = App(
            tenant_id=context.active_workspace_id, name="Chat", mode=AppMode.CHAT, enable_api=True, enable_site=True
        )
        account = Account(name="Owner", email="owner@example.com")
        account.id = context.account_id
        session.add_all([app, account])
        session.flush()
        conversation = Conversation(
            app_id=app.id,
            mode=AppMode.CHAT,
            name="Console conversation",
            inputs={},
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=context.account_id,
            from_end_user_id=None,
            is_deleted=False,
        )
        session.add(conversation)
        session.flush()
        workspaces: list[AgentWorkspace] = []
        bindings: list[AgentWorkspaceBinding] = []
        for owner_scope_key in ("root", "node-1:workflow-binding"):
            workspace = AgentWorkspace(
                id=str(uuid4()),
                tenant_id=app.tenant_id,
                app_id=app.id,
                owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                owner_id=conversation.id,
                owner_scope_key=owner_scope_key,
                backend_workspace_ref=owner_scope_key,
                status=AgentWorkingResourceStatus.ACTIVE,
                active_guard=1,
            )
            binding = AgentWorkspaceBinding(
                id=str(uuid4()),
                tenant_id=app.tenant_id,
                app_id=app.id,
                workspace_id=workspace.id,
                agent_id=str(uuid4()),
                agent_config_version_id=str(uuid4()),
                agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
                backend_binding_ref=owner_scope_key,
                status=AgentWorkingResourceStatus.ACTIVE,
            )
            session.add_all([workspace, binding])
            workspaces.append(workspace)
            bindings.append(binding)
        conversation.agent_workspace_binding_id = bindings[0].id
        return ConsoleDeletionData(
            context=context,
            app_id=app.id,
            conversation_id=conversation.id,
            workspace_ids=tuple(workspace.id for workspace in workspaces),
            binding_ids=tuple(binding.id for binding in bindings),
        )


@pytest.mark.parametrize("has_root_binding", [False, True])
def test_console_delete_retires_all_workspaces_and_returns_connection_before_cleanup(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    console_deletion: ConsoleDeletionData,
    has_root_binding: bool,
) -> None:
    data = console_deletion
    if not has_root_binding:
        with sqlite_session_factory.begin() as session:
            session.execute(
                update(Conversation)
                .where(Conversation.id == data.conversation_id)
                .values(agent_workspace_binding_id=None)
            )
    events: list[str] = []

    @event.listens_for(sqlite_engine, "checkout")
    def checkout(_connection: object, _record: object, _proxy: object) -> None:
        events.append("checkout")

    @event.listens_for(sqlite_engine, "checkin")
    def checkin(_connection: object, _record: object) -> None:
        events.append("checkin")

    def cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
        assert events == ["checkout", "checkin"]
        assert (tenant_id, conversation_id) == (data.context.active_workspace_id, data.conversation_id)
        assert set(retired_workspace_ids) == set(data.workspace_ids)
        events.append("cleanup")
        with sqlite_session_factory() as session:
            assert session.get_one(Conversation, conversation_id).is_deleted is True
            for workspace_id in data.workspace_ids:
                workspace = session.get_one(AgentWorkspace, workspace_id)
                assert workspace.status == AgentWorkingResourceStatus.RETIRED
                assert workspace.active_guard is None
                assert workspace.retired_at is not None
            for binding_id in data.binding_ids:
                binding = session.get_one(AgentWorkspaceBinding, binding_id)
                assert binding.status == AgentWorkingResourceStatus.RETIRED
                assert binding.retired_at is not None

    service = _service(sqlite_session_factory, cleanup=cleanup)
    service.delete_console(data.context, data.app_id, data.conversation_id, kind="chat")
    assert events == ["checkout", "checkin", "cleanup", "checkout", "checkin"]
    with pytest.raises(ConversationNotExistsError):
        service.delete_console(data.context, data.app_id, data.conversation_id, kind="chat")
    assert events.count("cleanup") == 1


def test_console_delete_failed_commit_rolls_back_root_and_node_resources_without_cleanup(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, console_deletion: ConsoleDeletionData
) -> None:
    data = console_deletion
    factory = sessionmaker(bind=sqlite_engine)

    @event.listens_for(factory, "before_commit")
    def fail_commit(session: Session) -> None:
        # Flush actual writes before the failure to exercise transaction rollback.
        session.flush()
        raise RuntimeError("Database commit failed")

    with pytest.raises(RuntimeError, match="Database commit failed"):
        _service(factory).delete_console(data.context, data.app_id, data.conversation_id, kind="chat")
    with sqlite_session_factory() as session:
        assert session.get_one(Conversation, data.conversation_id).is_deleted is False
        for workspace_id in data.workspace_ids:
            workspace = session.get_one(AgentWorkspace, workspace_id)
            assert workspace.status == AgentWorkingResourceStatus.ACTIVE
            assert workspace.active_guard == 1
            assert workspace.retired_at is None
        for binding_id in data.binding_ids:
            binding = session.get_one(AgentWorkspaceBinding, binding_id)
            assert binding.status == AgentWorkingResourceStatus.ACTIVE
            assert binding.retired_at is None


def test_console_cleanup_failure_cannot_rollback_committed_deletion(
    sqlite_session_factory: sessionmaker[Session], console_deletion: ConsoleDeletionData
) -> None:
    data = console_deletion

    def cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
        assert (tenant_id, conversation_id) == (data.context.active_workspace_id, data.conversation_id)
        assert set(retired_workspace_ids) == set(data.workspace_ids)
        raise RuntimeError("Cleanup transport unavailable")

    with pytest.raises(RuntimeError, match="Cleanup transport unavailable"):
        _service(sqlite_session_factory, cleanup=cleanup).delete_console(
            data.context, data.app_id, data.conversation_id, kind="chat"
        )
    with sqlite_session_factory() as session:
        assert session.get_one(Conversation, data.conversation_id).is_deleted is True
        for workspace_id in data.workspace_ids:
            assert session.get_one(AgentWorkspace, workspace_id).status == AgentWorkingResourceStatus.RETIRED
