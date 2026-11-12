import json
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, inspect, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.agent.workspace import AgentWorkspaceNotFoundError
from fields.conversation_fields import Conversation as CompletionResponse
from fields.conversation_fields import ConversationResponseSource, ConversationWithSummary
from graphon.enums import WorkflowExecutionStatus
from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod, FileType
from libs.datetime_utils import naive_utc_now
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
from models.enums import (
    ConversationFromSource,
    ConversationStatus,
    CreatorUserRole,
    EndUserType,
    FeedbackFromSource,
    FeedbackRating,
    InvokeFrom,
    MessageFileBelongsTo,
    WorkflowRunTriggeredFrom,
)
from models.enums import InvokeFrom as ModelInvokeFrom
from models.model import (
    App,
    AppMode,
    Conversation,
    EndUser,
    InstalledApp,
    Message,
    MessageAnnotation,
    MessageFeedback,
    MessageFile,
)
from models.web import PinnedConversation
from models.workflow import WorkflowRun, WorkflowType
from repositories.conversation_repository import ConversationRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.conversation_entities import (
    ConsoleChatConversationRecord,
    ConsoleCompletionConversationDetail,
    ConsoleCompletionConversationRecord,
    ConsoleConversationFilters,
    ConsoleConversationKind,
    ConsoleConversationPage,
    ConsoleConversationScope,
    ConversationAnnotationStatus,
    ConversationListSource,
    ConversationPage,
    ConversationSort,
    EndUserConversationRef,
    EndUserConversationScope,
    InstalledAppConversationRef,
    InstalledAppConversationScope,
)
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.errors.message import MessageNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef

_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"


_OWNER_TENANT_ID = "22222222-2222-4222-8222-222222222222"


_TIME = datetime(2026, 9, 8, 12, 30)


@pytest.fixture
def installation(sqlite_session_factory: sessionmaker[Session]) -> InstalledAppRef:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=_OWNER_TENANT_ID, name="Shared chat", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        installed_app = InstalledApp(
            tenant_id=str(uuid4()), app_id=app.id, app_owner_tenant_id=app.tenant_id, position=0, is_pinned=False
        )
        session.add(installed_app)
        session.flush()
        return InstalledAppRef(
            id=installed_app.id,
            tenant_id=installed_app.tenant_id,
            app_id=app.id,
            app_owner_tenant_id=app.tenant_id,
            app_mode=app.mode.value,
        )


def _conversation(
    session: Session,
    installation: InstalledAppRef,
    *,
    updated_at: datetime = _TIME,
    invoke_from: InvokeFrom | None = InvokeFrom.EXPLORE,
) -> Conversation:
    conversation = Conversation(
        app_id=installation.app_id,
        mode=AppMode.CHAT,
        name="Original name",
        _inputs={"empty": "", "list": [], "zero": 0, "flag": False, "none": None},
        introduction=None,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=_ACCOUNT_ID,
        from_end_user_id=None,
        invoke_from=ModelInvokeFrom(invoke_from) if invoke_from is not None else None,
        is_deleted=False,
    )
    conversation.created_at = _TIME - timedelta(days=1)
    conversation.updated_at = updated_at
    session.add(conversation)
    session.flush()
    return conversation


def _message(session: Session, conversation: Conversation, *, query: str, created_at: datetime) -> None:
    created_message = Message(
        app_id=conversation.app_id,
        conversation_id=conversation.id,
        _inputs={},
        query=query,
        message={},
        message_unit_price=Decimal(0),
        answer="",
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=_ACCOUNT_ID,
    )
    created_message.created_at = created_at
    session.add(created_message)


def _pin(
    session: Session,
    installation: InstalledAppRef,
    conversation_id: str,
    *,
    role: CreatorUserRole = CreatorUserRole.ACCOUNT,
    account_id: str = _ACCOUNT_ID,
) -> None:
    session.add(
        PinnedConversation(
            app_id=installation.app_id,
            conversation_id=conversation_id,
            created_by_role=role,
            created_by=account_id,
        )
    )


def test_page_preserves_empty_result_and_pinned_empty_short_circuit(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    assert repository.get_page(
        scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
        invoke_from="explore",
        sort_by="-updated_at",
        last_id=None,
        limit=20,
        pinned=None,
    ) == ConversationPage(tenant_id=_OWNER_TENANT_ID, limit=20, has_more=False, data=())
    assert repository.get_page(
        scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
        invoke_from="explore",
        sort_by="-updated_at",
        last_id=str(uuid4()),
        limit=20,
        pinned=True,
    ) == ConversationPage(tenant_id=_OWNER_TENANT_ID, limit=20, has_more=False, data=())
    with pytest.raises(LastConversationNotExistsError):
        repository.get_page(
            scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
            invoke_from="explore",
            sort_by="-updated_at",
            last_id=str(uuid4()),
            limit=20,
            pinned=None,
        )


def test_page_keeps_updated_order_cursor_and_detached_inputs(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        old = _conversation(session, installation, updated_at=_TIME - timedelta(hours=1))
        newest = _conversation(session, installation, updated_at=_TIME + timedelta(hours=1))
        middle = _conversation(session, installation)
    repository = ConversationRepository(session_factory=sqlite_session_factory)

    first_page = repository.get_page(
        scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
        invoke_from="explore",
        sort_by="-updated_at",
        last_id=None,
        limit=2,
        pinned=None,
    )
    final_page = repository.get_page(
        scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
        invoke_from="explore",
        sort_by="-updated_at",
        last_id=middle.id,
        limit=1,
        pinned=None,
    )

    assert [item.id for item in first_page.data] == [newest.id, middle.id]
    assert first_page.limit == 2
    assert first_page.has_more is True
    assert [item.id for item in final_page.data] == [old.id]
    assert final_page.has_more is False
    record = first_page.data[0]
    assert inspect(record, raiseerr=False) is None
    assert record.inputs == {"empty": "", "list": [], "zero": 0, "flag": False, "none": None}
    assert record.name == "Original name"
    assert record.status == "normal"
    assert record.introduction is None
    assert record.created_at == _TIME - timedelta(days=1)
    assert record.updated_at == newest.updated_at


def test_page_keeps_existing_strict_timestamp_behavior_for_ties(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        _conversation(session, installation)
        _conversation(session, installation)
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    page = repository.get_page(
        scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
        invoke_from="explore",
        sort_by="-updated_at",
        last_id=None,
        limit=1,
        pinned=None,
    )
    assert len(page.data) == 1
    assert page.has_more is False
    assert (
        repository.get_page(
            scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
            invoke_from="explore",
            sort_by="-updated_at",
            last_id=page.data[0].id,
            limit=1,
            pinned=None,
        ).data
        == ()
    )


def test_page_filters_invoke_source_and_scopes_pins_to_account_role_and_owner(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        legacy = _conversation(session, installation, invoke_from=None, updated_at=_TIME + timedelta(hours=1))
        explore = _conversation(session, installation)
        debugging = _conversation(session, installation, invoke_from=InvokeFrom.DEBUGGER)
        _pin(session, installation, legacy.id)
        _pin(session, installation, explore.id, role=CreatorUserRole.END_USER)
        _pin(session, installation, explore.id, account_id=str(uuid4()))
        _pin(session, replace(installation, app_id=str(uuid4())), explore.id)
    repository = ConversationRepository(session_factory=sqlite_session_factory)

    for pinned, expected in [(None, [legacy.id, explore.id]), (True, [legacy.id]), (False, [explore.id])]:
        page = repository.get_page(
            scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
            invoke_from="explore",
            sort_by="-updated_at",
            last_id=None,
            limit=20,
            pinned=pinned,
        )
        assert [item.id for item in page.data] == expected
        assert page.has_more is False
    for cursor, pinned in [(debugging.id, None), (explore.id, True), (legacy.id, False)]:
        with pytest.raises(LastConversationNotExistsError):
            repository.get_page(
                scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
                invoke_from="explore",
                sort_by="-updated_at",
                last_id=cursor,
                limit=20,
                pinned=pinned,
            )


@pytest.mark.parametrize("mismatch", ["app_id", "from_account_id", "from_source", "from_end_user_id", "is_deleted"])
def test_every_conversation_ownership_predicate_protects_reads_and_mutations(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        value: str | bool = True if mismatch == "is_deleted" else str(uuid4())
        if mismatch == "from_source":
            value = ConversationFromSource.API
        session.execute(update(Conversation).where(Conversation.id == conversation.id).values({mismatch: value}))
        conversation_id = conversation.id
    repository = ConversationRepository(session_factory=sqlite_session_factory)

    assert (
        repository.get_page(
            scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
            invoke_from="explore",
            sort_by="-updated_at",
            last_id=None,
            limit=20,
            pinned=None,
        ).data
        == ()
    )
    with pytest.raises(LastConversationNotExistsError):
        repository.get_page(
            scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
            invoke_from="explore",
            sort_by="-updated_at",
            last_id=conversation_id,
            limit=20,
            pinned=None,
        )
    with pytest.raises(ConversationNotExistsError):
        repository.get(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation_id
            )
        )
    with pytest.raises(ConversationNotExistsError):
        repository.get_name_source(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation_id
            )
        )
    with pytest.raises(ConversationNotExistsError):
        repository.rename(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation_id
            ),
            name="Unauthorized",
            updated_at=_TIME,
        )
    with pytest.raises(ConversationNotExistsError):
        repository.delete(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation_id
            )
        )
    with pytest.raises(ConversationNotExistsError):
        repository.set_pinned(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation_id
            ),
            is_pinned=True,
        )
    with sqlite_session_factory() as session:
        stored = session.get(Conversation, conversation_id)
        assert stored is not None
        assert stored.name == "Original name"
        assert stored.is_deleted is (mismatch == "is_deleted")
        assert session.scalars(select(PinnedConversation)).all() == []


@pytest.mark.parametrize("mismatch", ["id", "tenant_id", "app_id", "deleted_app", "deleted_installation"])
def test_all_operations_revalidate_complete_installation_and_actual_app(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        if mismatch == "deleted_app":
            app = session.get(App, installation.app_id)
            assert app is not None
            session.delete(app)
        elif mismatch == "deleted_installation":
            installed_app = session.get(InstalledApp, installation.id)
            assert installed_app is not None
            session.delete(installed_app)
        else:
            installation = replace(installation, **{mismatch: str(uuid4())})
    repository = ConversationRepository(session_factory=sqlite_session_factory)

    with pytest.raises(InstalledAppNotFoundError):
        repository.get_page(
            scope=InstalledAppConversationScope(installed_app=installation, account_id=_ACCOUNT_ID),
            invoke_from="explore",
            sort_by="-updated_at",
            last_id=None,
            limit=20,
            pinned=True,
        )
    with pytest.raises(InstalledAppNotFoundError):
        repository.get_name_source(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
            )
        )
    with pytest.raises(InstalledAppNotFoundError):
        repository.rename(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
            ),
            name="Unauthorized",
            updated_at=_TIME,
        )
    with pytest.raises(InstalledAppNotFoundError):
        repository.delete(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
            )
        )
    for is_pinned in (True, False):
        with pytest.raises(InstalledAppNotFoundError):
            repository.set_pinned(
                ref=InstalledAppConversationRef(
                    installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
                ),
                is_pinned=is_pinned,
            )


def test_name_source_uses_first_message_and_real_app_owner_tenant(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        _message(session, conversation, query="Later", created_at=_TIME)
        _message(session, conversation, query="First", created_at=_TIME - timedelta(hours=1))
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    connection_events: list[str] = []

    @event.listens_for(sqlite_engine, "checkout")
    def track_checkout(_connection: object, _record: object, _proxy: object) -> None:
        connection_events.append("checkout")

    @event.listens_for(sqlite_engine, "checkin")
    def track_checkin(_connection: object, _record: object) -> None:
        connection_events.append("checkin")

    result = repository.get_name_source(
        ref=InstalledAppConversationRef(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
        )
    )
    assert connection_events == ["checkout", "checkin"]
    assert result.tenant_id == _OWNER_TENANT_ID != installation.tenant_id
    assert result.query == "First"
    record = repository.get(
        ref=InstalledAppConversationRef(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
        )
    )
    assert record.name == "Original name"
    assert inspect(record, raiseerr=False) is None
    assert connection_events == ["checkout", "checkin", "checkout", "checkin"]


def test_name_source_rejects_missing_message_and_message_from_other_app(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        _message(session, conversation, query="Wrong app", created_at=_TIME)
        session.flush()
        session.execute(update(Message).values(app_id=str(uuid4())))
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    with pytest.raises(MessageNotExistsError, match=conversation.id):
        repository.get_name_source(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
            )
        )


@pytest.mark.parametrize("updated_at", [None, _TIME + timedelta(hours=1)])
def test_rename_commits_and_materializes_automatic_or_explicit_updated_at(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, updated_at: datetime | None
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    result = repository.rename(
        ref=InstalledAppConversationRef(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
        ),
        name="",
        updated_at=updated_at,
    )

    with sqlite_session_factory() as session:
        stored = session.get(Conversation, conversation.id)
        assert stored is not None
        assert stored.name == result.name == ""
        assert stored.updated_at == result.updated_at
        if updated_at is not None:
            assert result.updated_at == updated_at
        else:
            # The model's existing onupdate default still runs for automatic names.
            assert result.updated_at != _TIME
    assert result.inputs["flag"] is False


def test_pin_and_unpin_are_idempotent_and_preserve_other_owners(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        _pin(session, installation, conversation.id, role=CreatorUserRole.END_USER)
        _pin(session, installation, conversation.id, account_id=str(uuid4()))
        _pin(session, replace(installation, app_id=str(uuid4())), conversation.id)
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    for _ in range(2):
        repository.set_pinned(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
            ),
            is_pinned=True,
        )
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(PinnedConversation)).all()) == 4

    for _ in range(2):
        repository.set_pinned(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
            ),
            is_pinned=False,
        )
    repository.set_pinned(
        ref=InstalledAppConversationRef(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=str(uuid4())
        ),
        is_pinned=False,
    )
    with sqlite_session_factory() as session:
        remaining = session.scalars(select(PinnedConversation)).all()
        assert len(remaining) == 3
        assert all(
            pin.created_by_role != CreatorUserRole.ACCOUNT
            or pin.created_by != _ACCOUNT_ID
            or pin.app_id != installation.app_id
            for pin in remaining
        )


def test_existing_pin_and_unpin_do_not_require_live_conversation(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    missing_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        _pin(session, installation, missing_id)
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    repository.set_pinned(
        ref=InstalledAppConversationRef(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=missing_id),
        is_pinned=True,
    )
    repository.set_pinned(
        ref=InstalledAppConversationRef(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=missing_id),
        is_pinned=False,
    )
    with sqlite_session_factory() as session:
        assert session.scalars(select(PinnedConversation)).all() == []


@pytest.mark.parametrize("workspace_count", [0, 2])
def test_delete_commits_soft_deletion_and_returns_owner_tenant_for_cleanup(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, workspace_count: int
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        workspaces = [
            AgentWorkspace(
                id=str(uuid4()),
                tenant_id=_OWNER_TENANT_ID,
                app_id=conversation.app_id,
                owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                owner_id=conversation.id,
                owner_scope_key=f"node-{index}:workflow-binding-{index}",
                backend_workspace_ref=f"backend-workspace-{index}",
                status=AgentWorkingResourceStatus.ACTIVE,
                active_guard=1,
            )
            for index in range(workspace_count)
        ]
        session.add_all(workspaces)
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    deleted = repository.delete(
        ref=InstalledAppConversationRef(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
        )
    )

    assert deleted.tenant_id == _OWNER_TENANT_ID
    assert deleted.conversation_id == conversation.id
    assert set(deleted.retired_workspace_ids) == {workspace.id for workspace in workspaces}
    with sqlite_session_factory() as session:
        stored = session.get(Conversation, conversation.id)
        assert stored is not None
        assert stored.is_deleted is True
        for workspace in workspaces:
            stored_workspace = session.get(AgentWorkspace, workspace.id)
            assert stored_workspace is not None
            assert stored_workspace.status == AgentWorkingResourceStatus.RETIRED
            assert stored_workspace.retired_at is not None
            assert stored_workspace.active_guard is None
    with pytest.raises(ConversationNotExistsError):
        repository.delete(
            ref=InstalledAppConversationRef(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
            )
        )


@pytest.mark.parametrize("operation", ["rename", "delete", "pin"])
def test_failed_commit_rolls_back_mutations_and_propagates_original_error(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    installation: InstalledAppRef,
    operation: Literal["rename", "delete", "pin"],
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
    failing_factory = sessionmaker(bind=sqlite_engine)
    failure = RuntimeError("database commit unavailable")

    @event.listens_for(failing_factory, "before_commit")
    def fail_commit(_session: Session) -> None:
        raise failure

    repository = ConversationRepository(session_factory=failing_factory)

    def mutate() -> None:
        if operation == "rename":
            repository.rename(
                ref=InstalledAppConversationRef(
                    installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
                ),
                name="Discarded",
                updated_at=_TIME + timedelta(hours=1),
            )
        elif operation == "delete":
            repository.delete(
                ref=InstalledAppConversationRef(
                    installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
                )
            )
        else:
            repository.set_pinned(
                ref=InstalledAppConversationRef(
                    installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
                ),
                is_pinned=True,
            )

    with pytest.raises(RuntimeError) as error:
        mutate()
    assert error.value is failure
    with sqlite_session_factory() as session:
        stored = session.get(Conversation, conversation.id)
        assert stored is not None
        assert stored.name == "Original name"
        assert stored.updated_at == _TIME
        assert stored.is_deleted is False
        assert session.scalars(select(PinnedConversation)).all() == []


def test_end_user_and_installed_account_refs_never_cross_owner_domains(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        account_conversation = _conversation(session, installation)
        end_user = EndUser(
            id=_ACCOUNT_ID,
            tenant_id=installation.app_owner_tenant_id,
            app_id=installation.app_id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        session.add(end_user)
        end_user_conversation = Conversation(
            app_id=installation.app_id,
            mode=AppMode.CHAT,
            name="End-user conversation",
            _inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
            from_account_id=None,
            is_deleted=False,
        )
        session.add(end_user_conversation)
        session.flush()
        account_ref = InstalledAppConversationRef(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=account_conversation.id
        )
        end_user_ref = EndUserConversationRef(
            app_id=installation.app_id,
            tenant_id=installation.app_owner_tenant_id,
            end_user_id=end_user.id,
            conversation_id=end_user_conversation.id,
        )
        _message(session, account_conversation, query="Account question", created_at=_TIME)
        _message(session, end_user_conversation, query="End-user question", created_at=_TIME)
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    assert repository.get(ref=account_ref).name == "Original name"
    assert repository.get(ref=end_user_ref).name == "End-user conversation"
    assert repository.get_name_source(ref=account_ref).query == "Account question"
    assert repository.get_name_source(ref=end_user_ref).query == "End-user question"

    for foreign_ref in (
        replace(account_ref, conversation_id=end_user_ref.conversation_id),
        replace(end_user_ref, conversation_id=account_ref.conversation_id),
        replace(end_user_ref, tenant_id=installation.tenant_id),
    ):
        with pytest.raises(ConversationNotExistsError):
            repository.get(ref=foreign_ref)
        with pytest.raises(ConversationNotExistsError):
            repository.get_name_source(ref=foreign_ref)
        with pytest.raises(ConversationNotExistsError):
            repository.rename(ref=foreign_ref, name="Forbidden", updated_at=_TIME)
        with pytest.raises(ConversationNotExistsError):
            repository.delete(ref=foreign_ref)
        with pytest.raises(ConversationNotExistsError):
            repository.set_pinned(ref=foreign_ref, is_pinned=True)
    assert repository.get(ref=account_ref).name == "Original name"
    assert repository.get(ref=end_user_ref).name == "End-user conversation"


@pytest.fixture
def end_user_scope(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> EndUserConversationScope:
    with sqlite_session_factory.begin() as session:
        user = EndUser(
            id=_ACCOUNT_ID,
            tenant_id=installation.app_owner_tenant_id,
            app_id=installation.app_id,
            type=EndUserType.BROWSER,
            session_id=str(uuid4()),
        )
        session.add(user)
        session.flush()
        assert user.app_id is not None
        return EndUserConversationScope(app_id=user.app_id, tenant_id=user.tenant_id, end_user_id=user.id)


def _end_user_conversation(
    session: Session,
    scope: EndUserConversationScope,
    *,
    created_at: datetime = _TIME,
    updated_at: datetime = _TIME,
    invoke_from: InvokeFrom | None = InvokeFrom.WEB_APP,
) -> Conversation:
    conversation = Conversation(
        app_id=scope.app_id,
        mode=AppMode.CHAT,
        name="End-user conversation",
        _inputs={"empty": "", "flag": False, "zero": 0, "nested": {"list": [None, 0]}},
        from_source=ConversationFromSource.API,
        from_account_id=None,
        from_end_user_id=scope.end_user_id,
        invoke_from=ModelInvokeFrom(invoke_from) if invoke_from is not None else None,
        is_deleted=False,
    )
    conversation.created_at = created_at
    conversation.updated_at = updated_at
    session.add(conversation)
    session.flush()
    return conversation


@pytest.mark.parametrize("sort_by", ["created_at", "-created_at", "updated_at", "-updated_at"])
def test_end_user_page_orders_and_advances_using_selected_timestamp(
    sqlite_session_factory: sessionmaker[Session], end_user_scope: EndUserConversationScope, sort_by: ConversationSort
) -> None:
    with sqlite_session_factory.begin() as session:
        first_created = _end_user_conversation(
            session, end_user_scope, created_at=_TIME - timedelta(hours=1), updated_at=_TIME + timedelta(hours=1)
        )
        second_created = _end_user_conversation(
            session, end_user_scope, created_at=_TIME, updated_at=_TIME - timedelta(hours=1)
        )
        last_created = _end_user_conversation(
            session, end_user_scope, created_at=_TIME + timedelta(hours=1), updated_at=_TIME
        )
    chronological_ids = (
        [first_created.id, second_created.id, last_created.id]
        if sort_by.endswith("created_at")
        else [second_created.id, last_created.id, first_created.id]
    )
    expected = list(reversed(chronological_ids)) if sort_by.startswith("-") else chronological_ids
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    first_page = repository.get_page(
        scope=end_user_scope, invoke_from="web-app", last_id=None, limit=2, pinned=None, sort_by=sort_by
    )
    second_page = repository.get_page(
        scope=end_user_scope, invoke_from="web-app", last_id=expected[1], limit=2, pinned=None, sort_by=sort_by
    )
    assert first_page.tenant_id == end_user_scope.tenant_id
    assert [record.id for record in first_page.data] == expected[:2]
    assert first_page.has_more is True
    assert [record.id for record in second_page.data] == expected[2:]
    assert second_page.has_more is False


@pytest.mark.parametrize("sort_by", ["created_at", "-created_at", "updated_at", "-updated_at"])
def test_end_user_page_preserves_strict_timestamp_cursor_for_ties(
    sqlite_session_factory: sessionmaker[Session], end_user_scope: EndUserConversationScope, sort_by: ConversationSort
) -> None:
    with sqlite_session_factory.begin() as session:
        _end_user_conversation(session, end_user_scope)
        _end_user_conversation(session, end_user_scope)
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    page = repository.get_page(
        scope=end_user_scope, invoke_from="web-app", last_id=None, limit=1, pinned=None, sort_by=sort_by
    )
    assert len(page.data) == 1
    assert page.has_more is False
    following_page = repository.get_page(
        scope=end_user_scope,
        invoke_from="web-app",
        last_id=page.data[0].id,
        limit=1,
        pinned=None,
        sort_by=sort_by,
    )
    assert following_page.data == ()
    assert following_page.has_more is False


@pytest.mark.parametrize("invoke_from", ["web-app", "service-api"])
def test_end_user_page_filters_invocation_and_scopes_pins_to_app_actor_and_role(
    sqlite_session_factory: sessionmaker[Session],
    installation: InstalledAppRef,
    end_user_scope: EndUserConversationScope,
    invoke_from: ConversationListSource,
) -> None:
    with sqlite_session_factory.begin() as session:
        legacy = _end_user_conversation(
            session, end_user_scope, invoke_from=None, updated_at=_TIME + timedelta(hours=1)
        )
        matching = _end_user_conversation(session, end_user_scope, invoke_from=InvokeFrom(invoke_from))
        different_source = _end_user_conversation(
            session,
            end_user_scope,
            invoke_from=InvokeFrom.SERVICE_API if invoke_from == "web-app" else InvokeFrom.WEB_APP,
        )
        _conversation(session, installation, invoke_from=InvokeFrom(invoke_from))
        _pin(session, installation, legacy.id, role=CreatorUserRole.END_USER)
        _pin(session, installation, matching.id, role=CreatorUserRole.ACCOUNT)
        _pin(session, installation, matching.id, role=CreatorUserRole.END_USER, account_id=str(uuid4()))
        _pin(session, replace(installation, app_id=str(uuid4())), matching.id, role=CreatorUserRole.END_USER)
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    for pinned, expected in [(None, [legacy.id, matching.id]), (True, [legacy.id]), (False, [matching.id])]:
        page = repository.get_page(
            scope=end_user_scope, invoke_from=invoke_from, last_id=None, limit=20, pinned=pinned, sort_by="-updated_at"
        )
        assert [record.id for record in page.data] == expected
    for cursor, pinned in [(different_source.id, None), (matching.id, True), (legacy.id, False)]:
        with pytest.raises(LastConversationNotExistsError):
            repository.get_page(
                scope=end_user_scope,
                invoke_from=invoke_from,
                last_id=cursor,
                limit=20,
                pinned=pinned,
                sort_by="-updated_at",
            )


@pytest.mark.parametrize("mismatch", ["app_id", "from_end_user_id", "from_source", "from_account_id", "is_deleted"])
def test_end_user_page_and_cursor_reject_every_conversation_owner_mismatch(
    sqlite_session_factory: sessionmaker[Session], end_user_scope: EndUserConversationScope, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        matching = _end_user_conversation(session, end_user_scope)
        unrelated = _end_user_conversation(session, end_user_scope)
        value: str | bool = True if mismatch == "is_deleted" else str(uuid4())
        if mismatch == "from_source":
            value = ConversationFromSource.CONSOLE
        session.execute(update(Conversation).where(Conversation.id == unrelated.id).values({mismatch: value}))
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    page = repository.get_page(
        scope=end_user_scope, invoke_from="web-app", last_id=None, limit=20, pinned=None, sort_by="-updated_at"
    )
    assert [record.id for record in page.data] == [matching.id]
    with pytest.raises(LastConversationNotExistsError):
        repository.get_page(
            scope=end_user_scope,
            invoke_from="web-app",
            last_id=unrelated.id,
            limit=20,
            pinned=None,
            sort_by="-updated_at",
        )


@pytest.mark.parametrize(
    "mismatch", ["app_id", "tenant_id", "end_user_id", "user_app", "user_tenant", "missing_user", "missing_app"]
)
def test_end_user_page_revalidates_complete_app_and_user_owner_chain(
    sqlite_session_factory: sessionmaker[Session], end_user_scope: EndUserConversationScope, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        _end_user_conversation(session, end_user_scope)
        if mismatch == "missing_app":
            app = session.get(App, end_user_scope.app_id)
            assert app is not None
            session.delete(app)
        elif mismatch.startswith("user_") or mismatch == "missing_user":
            user = session.get(EndUser, end_user_scope.end_user_id)
            assert user is not None
            if mismatch == "missing_user":
                session.delete(user)
            elif mismatch == "user_app":
                user.app_id = str(uuid4())
            else:
                user.tenant_id = str(uuid4())
        else:
            end_user_scope = replace(end_user_scope, **{mismatch: str(uuid4())})
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    with pytest.raises(ConversationNotExistsError):
        repository.get_page(
            scope=end_user_scope,
            invoke_from="web-app",
            last_id=None,
            limit=20,
            pinned=True,
            sort_by="-updated_at",
        )


def test_end_user_empty_page_keeps_missing_cursor_and_empty_pin_semantics(
    sqlite_session_factory: sessionmaker[Session], end_user_scope: EndUserConversationScope
) -> None:
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    assert repository.get_page(
        scope=end_user_scope, invoke_from="web-app", last_id=None, limit=20, pinned=None, sort_by="-updated_at"
    ) == ConversationPage(tenant_id=end_user_scope.tenant_id, limit=20, has_more=False, data=())
    assert (
        repository.get_page(
            scope=end_user_scope,
            invoke_from="web-app",
            last_id=str(uuid4()),
            limit=20,
            pinned=True,
            sort_by="-updated_at",
        ).data
        == ()
    )
    with pytest.raises(LastConversationNotExistsError):
        repository.get_page(
            scope=end_user_scope,
            invoke_from="web-app",
            last_id=str(uuid4()),
            limit=20,
            pinned=False,
            sort_by="-updated_at",
        )


_CONSOLE_LIST_TIME = datetime(2026, 10, 13, 12, 30)


_FILTERS = ConsoleConversationFilters(
    keyword=None, start=None, end=None, annotation_status="all", sort_by="-updated_at", page=1, limit=20
)


@dataclass(frozen=True)
class ConsoleData:
    context: RequestContext
    app_id: str
    end_user_id: str


@pytest.fixture
def console_data(sqlite_session_factory: sessionmaker[Session]) -> ConsoleData:
    with sqlite_session_factory.begin() as session:
        account = Account(name="Maintainer", email="maintainer@example.com", timezone="Asia/Shanghai")
        app = App(tenant_id=str(uuid4()), name="Chat app", mode=AppMode.CHAT, enable_api=True, enable_site=True)
        session.add_all([account, app])
        session.flush()
        end_user = EndUser(
            tenant_id=app.tenant_id, app_id=app.id, type=EndUserType.BROWSER, session_id="visitor-needle"
        )
        session.add(end_user)
        session.flush()
        return ConsoleData(
            context=RequestContext(
                request_id="test", trace_id=None, account_id=account.id, active_workspace_id=app.tenant_id
            ),
            app_id=app.id,
            end_user_id=end_user.id,
        )


def _console_conversation(session: Session, data: ConsoleData, *, mode: AppMode = AppMode.CHAT) -> Conversation:
    conversation = Conversation(
        app_id=data.app_id,
        mode=mode,
        name="Conversation",
        _inputs={},
        from_source=ConversationFromSource.API,
        from_end_user_id=data.end_user_id,
        from_account_id=None,
        status=ConversationStatus.NORMAL,
        invoke_from=InvokeFrom.SERVICE_API,
        is_deleted=False,
    )
    conversation.created_at = _CONSOLE_LIST_TIME
    conversation.updated_at = _CONSOLE_LIST_TIME
    session.add(conversation)
    session.flush()
    return conversation


def _console_message(session: Session, conversation: Conversation, *, query: str = "First query") -> Message:
    message = Message(
        app_id=conversation.app_id,
        conversation_id=conversation.id,
        _inputs={"zero": 0, "empty": "", "none": None},
        query=query,
        message=[{"text": "Prompt text"}],
        message_unit_price=Decimal(0),
        answer="Answer",
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=conversation.from_end_user_id,
    )
    message.created_at = _CONSOLE_LIST_TIME
    session.add(message)
    session.flush()
    return message


def _scope(
    factory: sessionmaker[Session], data: ConsoleData, *, kind: ConsoleConversationKind = "chat"
) -> ConsoleConversationScope:
    return ConversationRepository(session_factory=factory).get_console_scope(data.context, data.app_id, kind=kind)


def _page(
    factory: sessionmaker[Session], data: ConsoleData, *, filters: ConsoleConversationFilters = _FILTERS
) -> ConsoleConversationPage:
    return ConversationRepository(session_factory=factory).get_console_page(
        scope=_scope(factory, data), filters=filters
    )


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_chat_scope_allows_supported_modes_and_returns_account_timezone(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, mode: AppMode
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get_one(App, console_data.app_id)
        app.mode = mode
    scope = _scope(sqlite_session_factory, console_data)
    assert scope == ConsoleConversationScope(
        app_id=console_data.app_id,
        tenant_id=console_data.context.active_workspace_id,
        app_mode=mode,
        timezone="Asia/Shanghai",
    )


@pytest.mark.parametrize("change", ["missing", "tenant", "status", "mode", "hidden_agent"])
def test_scope_rejects_unavailable_or_hidden_app(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, change: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get_one(App, console_data.app_id)
        if change == "missing":
            session.delete(app)
        elif change == "tenant":
            app.tenant_id = str(uuid4())
        elif change == "status":
            session.execute(
                text("UPDATE apps SET status = :status WHERE id = :id"), {"status": "disabled", "id": app.id}
            )
        elif change == "mode":
            app.mode = AppMode.COMPLETION
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
    with pytest.raises(ConsoleAppNotFoundError) as error:
        _scope(sqlite_session_factory, console_data)
    assert str(error.value) == (
        "App mode is not in the supported list: ['advanced-chat', 'agent', 'agent-chat', 'chat']"
        if change == "mode"
        else "App not found."
    )


@pytest.mark.parametrize("change", ["missing", "tenant", "status", "mode", "hidden_agent"])
def test_page_rechecks_app_after_scope_resolution(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, change: str
) -> None:
    if change == "hidden_agent":
        with sqlite_session_factory.begin() as session:
            session.get_one(App, console_data.app_id).mode = AppMode.AGENT
    scope = _scope(sqlite_session_factory, console_data)
    with sqlite_session_factory.begin() as session:
        app = session.get_one(App, console_data.app_id)
        if change == "missing":
            session.delete(app)
        elif change == "tenant":
            app.tenant_id = str(uuid4())
        elif change == "status":
            session.execute(
                text("UPDATE apps SET status = :status WHERE id = :id"), {"status": "disabled", "id": app.id}
            )
        elif change == "mode":
            app.mode = AppMode.ADVANCED_CHAT
        else:
            session.add(
                Agent(
                    tenant_id=app.tenant_id,
                    name="Hidden",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    backing_app_id=app.id,
                )
            )
    with pytest.raises(ConsoleAppNotFoundError) as error:
        ConversationRepository(session_factory=sqlite_session_factory).get_console_page(scope=scope, filters=_FILTERS)
    assert str(error.value) == (
        "App mode changed from 'chat' to 'advanced-chat' after admission." if change == "mode" else "App not found."
    )


def test_console_page_spans_actors_but_excludes_deleted_and_other_apps(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    with sqlite_session_factory.begin() as session:
        first = _console_conversation(session, console_data)
        other_user = _console_conversation(session, console_data)
        other_user.from_end_user_id = str(uuid4())
        account = _console_conversation(session, console_data)
        account.from_source = ConversationFromSource.CONSOLE
        account.from_end_user_id = None
        account.from_account_id = console_data.context.account_id
        deleted = _console_conversation(session, console_data)
        deleted.is_deleted = True
        other_app = _console_conversation(session, console_data)
        other_app.app_id = str(uuid4())
    page = _page(sqlite_session_factory, console_data)
    assert {item.id for item in page.items} == {first.id, other_user.id, account.id}
    assert page.total == 3
    assert page.has_next is False
    assert page.tenant_id == console_data.context.active_workspace_id


@pytest.mark.parametrize("field", ["query", "answer", "name", "introduction", "end_user"])
def test_chat_keyword_matches_each_legacy_field_case_insensitively_without_duplicates(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, field: str
) -> None:
    with sqlite_session_factory.begin() as session:
        row = _console_conversation(session, console_data)
        message = _console_message(session, row, query="Other")
        _console_message(session, row, query="Other")
        if field == "query":
            message.query = "Some NEEDLE phrase"
        elif field == "answer":
            message.answer = "Some NEEDLE phrase"
        elif field == "name":
            row.name = "Some NEEDLE phrase"
        elif field == "introduction":
            row.introduction = "Some NEEDLE phrase"
        no_messages = _console_conversation(session, console_data)
        no_messages.name = "NEEDLE"
    page = _page(sqlite_session_factory, console_data, filters=replace(_FILTERS, keyword="needle"))
    assert [item.id for item in page.items] == [row.id]
    assert page.total == 1


@pytest.mark.parametrize("keyword", ["%", "_", "\\"])
def test_keyword_treats_wildcards_as_literal_characters(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, keyword: str
) -> None:
    with sqlite_session_factory.begin() as session:
        literal = _console_conversation(session, console_data)
        _console_message(session, literal, query=f"Literal {keyword}")
        ordinary = _console_conversation(session, console_data)
        _console_message(session, ordinary, query="Ordinary text")
    page = _page(sqlite_session_factory, console_data, filters=replace(_FILTERS, keyword=keyword))
    assert [item.id for item in page.items] == [literal.id]


def test_completion_keeps_message_join_duplicates_and_only_completion_rows(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(App, console_data.app_id).mode = AppMode.COMPLETION
        row = _console_conversation(session, console_data, mode=AppMode.COMPLETION)
        _console_message(session, row, query="Needle 1")
        _console_message(session, row, query="Needle 2")
        wrong_mode = _console_conversation(session, console_data)
        _console_message(session, wrong_mode, query="Needle")
    page = ConversationRepository(session_factory=sqlite_session_factory).get_console_page(
        scope=_scope(sqlite_session_factory, console_data, kind="completion"),
        filters=replace(_FILTERS, keyword="needle", limit=1),
    )
    assert [item.id for item in page.items] == [row.id]
    assert page.total == 2
    assert page.has_next is True


@pytest.mark.parametrize("annotation_status", ["all", "annotated", "not_annotated"])
def test_annotation_filter_and_pagination(
    sqlite_session_factory: sessionmaker[Session],
    console_data: ConsoleData,
    annotation_status: ConversationAnnotationStatus,
) -> None:
    with sqlite_session_factory.begin() as session:
        annotated = _console_conversation(session, console_data)
        plain = _console_conversation(session, console_data)
        session.add_all(
            [
                MessageAnnotation(
                    app_id=console_data.app_id,
                    conversation_id=annotated.id,
                    question="Question",
                    content="Answer",
                    account_id=console_data.context.account_id,
                ),
                MessageAnnotation(
                    app_id=console_data.app_id,
                    conversation_id=annotated.id,
                    question="Question 2",
                    content="Answer 2",
                    account_id=console_data.context.account_id,
                ),
            ]
        )
    page = _page(sqlite_session_factory, console_data, filters=replace(_FILTERS, annotation_status=annotation_status))
    expected = (
        {annotated.id, plain.id}
        if annotation_status == "all"
        else {annotated.id if annotation_status == "annotated" else plain.id}
    )
    assert {item.id for item in page.items} == expected
    assert page.total == len(expected)


@pytest.mark.parametrize("sort_by", ["created_at", "-created_at", "updated_at", "-updated_at"])
def test_time_filter_and_sort_use_the_same_column_and_include_end_minute(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, sort_by: ConversationSort
) -> None:
    with sqlite_session_factory.begin() as session:
        before = _console_conversation(session, console_data)
        before.created_at = _CONSOLE_LIST_TIME - timedelta(seconds=1)
        before.updated_at = _CONSOLE_LIST_TIME - timedelta(seconds=1)
        start = _console_conversation(session, console_data)
        end = _console_conversation(session, console_data)
        end.created_at = _CONSOLE_LIST_TIME.replace(second=59)
        end.updated_at = _CONSOLE_LIST_TIME.replace(second=59)
        after = _console_conversation(session, console_data)
        after.created_at = _CONSOLE_LIST_TIME + timedelta(minutes=1)
        after.updated_at = _CONSOLE_LIST_TIME + timedelta(minutes=1)
        other_column = _console_conversation(session, console_data)
        if "updated" in sort_by:
            other_column.updated_at = _CONSOLE_LIST_TIME + timedelta(minutes=2)
        else:
            other_column.created_at = _CONSOLE_LIST_TIME + timedelta(minutes=2)
    page = _page(
        sqlite_session_factory,
        console_data,
        filters=replace(
            _FILTERS, start=_CONSOLE_LIST_TIME, end=_CONSOLE_LIST_TIME.replace(second=59), sort_by=sort_by, limit=1
        ),
    )
    assert page.total == 2
    assert page.has_next is True
    assert [item.id for item in page.items] == [end.id if sort_by.startswith("-") else start.id]
    next_page = _page(
        sqlite_session_factory,
        console_data,
        filters=replace(
            _FILTERS,
            start=_CONSOLE_LIST_TIME,
            end=_CONSOLE_LIST_TIME.replace(second=59),
            sort_by=sort_by,
            limit=1,
            page=2,
        ),
    )
    assert next_page.has_next is False
    assert [item.id for item in next_page.items] == [start.id if sort_by.startswith("-") else end.id]


def test_advanced_chat_hides_debugger_and_null_invoke_source(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(App, console_data.app_id).mode = AppMode.ADVANCED_CHAT
        visible = _console_conversation(session, console_data, mode=AppMode.ADVANCED_CHAT)
        debugger = _console_conversation(session, console_data, mode=AppMode.ADVANCED_CHAT)
        debugger.invoke_from = InvokeFrom.DEBUGGER
        legacy = _console_conversation(session, console_data, mode=AppMode.ADVANCED_CHAT)
        legacy.invoke_from = None
    assert [item.id for item in _page(sqlite_session_factory, console_data).items] == [visible.id]


@pytest.mark.parametrize("completion", [False, True])
def test_snapshots_match_existing_response_fields_and_close_all_read_sessions(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, console_data: ConsoleData, completion: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        mode = AppMode.COMPLETION if completion else AppMode.CHAT
        session.get_one(App, console_data.app_id).mode = mode
        row = _console_conversation(session, console_data, mode=mode)
        row.override_model_configs = json.dumps(
            {"model": {"name": "selected-model", "provider": "provider"}, "pre_prompt": "Prefix"}
        )
        first = _console_message(session, row)
        session.add(
            MessageAnnotation(
                app_id=console_data.app_id,
                conversation_id=row.id,
                question="Reviewed",
                content="Annotation",
                account_id=console_data.context.account_id,
            )
        )
        session.add(
            MessageFeedback(
                app_id=console_data.app_id,
                conversation_id=row.id,
                message_id=first.id,
                rating=FeedbackRating.LIKE,
                from_source=FeedbackFromSource.USER,
            )
        )
        session.add(
            MessageFeedback(
                app_id=console_data.app_id,
                conversation_id=row.id,
                message_id=first.id,
                rating=FeedbackRating.DISLIKE,
                from_source=FeedbackFromSource.ADMIN,
            )
        )
    response_type = CompletionResponse if completion else ConversationWithSummary
    with sqlite_session_factory() as session:
        row = session.get_one(Conversation, row.id)
        expected = response_type.model_validate(ConversationResponseSource(row, session=session)).model_dump(
            mode="json"
        )
    checkouts: list[int] = []
    checkins: list[int] = []

    def checked_out(_connection: object, _record: object, _proxy: object) -> None:
        checkouts.append(1)

    def checked_in(_connection: object, _record: object) -> None:
        checkins.append(1)

    event.listen(sqlite_engine, "checkout", checked_out)
    event.listen(sqlite_engine, "checkin", checked_in)
    try:
        scope = _scope(sqlite_session_factory, console_data, kind="completion" if completion else "chat")
        page = ConversationRepository(session_factory=sqlite_session_factory).get_console_page(
            scope=scope, filters=_FILTERS
        )
        assert len(checkouts) == len(checkins) == 2
        item = page.items[0]
        assert response_type.model_validate(item).model_dump(mode="json") == expected
        assert len(checkouts) == 2  # Detached serialization cannot execute SQL.
        assert item.model_config["model"] == expected["model_config"]["model"]
        if completion:
            assert isinstance(item, ConsoleCompletionConversationRecord)
            assert item.first_message is not None
            assert item.first_message.inputs == {"zero": 0, "empty": "", "none": None}
            assert item.annotation is not None
            assert item.annotation.account is not None
            assert item.annotation.account.email == "maintainer@example.com"
        else:
            assert isinstance(item, ConsoleChatConversationRecord)
            assert item.summary_or_query == "First query"
            assert item.message_count == 1
            assert item.annotated is True
    finally:
        event.remove(sqlite_engine, "checkout", checked_out)
        event.remove(sqlite_engine, "checkin", checked_in)


def test_empty_page_preserves_requested_page_and_limit(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    assert _page(
        sqlite_session_factory, console_data, filters=replace(_FILTERS, page=8, limit=5)
    ) == ConsoleConversationPage(
        tenant_id=console_data.context.active_workspace_id, page=8, per_page=5, total=0, has_next=False, items=()
    )


def test_completion_returns_raw_file_inputs_without_restoration(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData
) -> None:
    # An invalid/missing upload would fail file restoration. Persistence must only
    # snapshot it; the query service owns restoration after this session closes.
    raw_file = {
        "dify_model_identity": "__dify__file__",
        "transfer_method": "local_file",
        "upload_file_id": str(uuid4()),
    }
    with sqlite_session_factory.begin() as session:
        session.get_one(App, console_data.app_id).mode = AppMode.COMPLETION
        row = _console_conversation(session, console_data, mode=AppMode.COMPLETION)
        message = _console_message(session, row)
        message.inputs = {"attachment": raw_file}
    result = (
        ConversationRepository(session_factory=sqlite_session_factory)
        .get_console_page(scope=_scope(sqlite_session_factory, console_data, kind="completion"), filters=_FILTERS)
        .items[0]
    )
    assert isinstance(result, ConsoleCompletionConversationRecord)
    assert result.first_message is not None
    assert result.first_message.inputs == {"attachment": raw_file}


@pytest.mark.parametrize("completion", [False, True])
def test_empty_conversation_snapshot_preserves_nullable_and_zero_fields(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, completion: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        mode = AppMode.COMPLETION if completion else AppMode.CHAT
        session.get_one(App, console_data.app_id).mode = mode
        _console_conversation(session, console_data, mode=mode)
    record = (
        ConversationRepository(session_factory=sqlite_session_factory)
        .get_console_page(
            scope=_scope(sqlite_session_factory, console_data, kind="completion" if completion else "chat"),
            filters=_FILTERS,
        )
        .items[0]
    )
    assert record.read_at is None
    assert record.user_feedback_stats == record.admin_feedback_stats == {"like": 0, "dislike": 0}
    if completion:
        assert isinstance(record, ConsoleCompletionConversationRecord)
        assert record.first_message is None
        assert record.annotation is None
    else:
        assert isinstance(record, ConsoleChatConversationRecord)
        assert record.summary_or_query == ""
        assert record.message_count == 0
        assert record.annotated is False
        assert record.status_count is None


@pytest.mark.parametrize("foreign_app", [False, True])
def test_chat_status_counts_preserve_duplicate_messages_and_app_scope(
    sqlite_session_factory: sessionmaker[Session], console_data: ConsoleData, foreign_app: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        row = _console_conversation(session, console_data)
        run = WorkflowRun(
            tenant_id=console_data.context.active_workspace_id,
            app_id=str(uuid4()) if foreign_app else console_data.app_id,
            workflow_id=str(uuid4()),
            type=WorkflowType.CHAT,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=WorkflowExecutionStatus.SUCCEEDED,
            created_by_role=CreatorUserRole.END_USER,
            created_by=console_data.end_user_id,
        )
        session.add(run)
        session.flush()
        first = _console_message(session, row)
        first.workflow_run_id = run.id
        second = _console_message(session, row)
        second.workflow_run_id = run.id
        missing = _console_message(session, row)
        missing.workflow_run_id = str(uuid4())
    record = _page(sqlite_session_factory, console_data).items[0]
    assert isinstance(record, ConsoleChatConversationRecord)
    assert record.message_count == 3
    assert record.status_count == {"success": 0 if foreign_app else 2, "failed": 0, "partial_success": 0, "paused": 0}


_CONSOLE_DETAIL_TIME = datetime(2020, 1, 2, 3, 4, 5)


@dataclass(frozen=True)
class DetailData:
    context: RequestContext
    app_id: str
    conversation_id: str
    end_user_id: str


@pytest.fixture
def detail_data(sqlite_session_factory: sessionmaker[Session]) -> DetailData:
    with sqlite_session_factory.begin() as session:
        account = Account(name="Maintainer", email="detail-reader@example.com", timezone="UTC")
        app = App(tenant_id=str(uuid4()), name="Console detail", mode=AppMode.CHAT, enable_api=True, enable_site=True)
        session.add_all([account, app])
        session.flush()
        end_user = EndUser(tenant_id=app.tenant_id, app_id=app.id, type=EndUserType.BROWSER, session_id="detail-user")
        session.add(end_user)
        session.flush()
        conversation = Conversation(
            app_id=app.id,
            mode=AppMode.CHAT,
            name="Conversation",
            _inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
            from_account_id=None,
            introduction="Introduction",
            is_deleted=False,
        )
        conversation.created_at = _CONSOLE_DETAIL_TIME
        conversation.updated_at = _CONSOLE_DETAIL_TIME
        session.add(conversation)
        session.flush()
        return DetailData(
            context=RequestContext(
                request_id="detail", trace_id=None, account_id=account.id, active_workspace_id=app.tenant_id
            ),
            app_id=app.id,
            conversation_id=conversation.id,
            end_user_id=end_user.id,
        )


def _detail_message(session: Session, data: DetailData) -> Message:
    message = Message(
        app_id=data.app_id,
        conversation_id=data.conversation_id,
        _inputs={"zero": 0, "none": None, "empty": []},
        query="Question",
        message=[{"text": "Raw prompt"}],
        message_unit_price=Decimal(0),
        answer="Raw answer",
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=data.end_user_id,
    )
    message.created_at = _CONSOLE_DETAIL_TIME
    session.add(message)
    session.flush()
    return message


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_detail_materializes_after_session_closes_without_marking_read(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    detail_data: DetailData,
    kind: ConsoleConversationKind,
) -> None:
    data = detail_data
    with sqlite_session_factory.begin() as session:
        mode = AppMode.CHAT if kind == "chat" else AppMode.COMPLETION
        session.get_one(App, data.app_id).mode = mode
        session.execute(
            update(Conversation)
            .where(Conversation.id == data.conversation_id)
            .values({Conversation.mode: mode, Conversation.updated_at: _CONSOLE_DETAIL_TIME})
        )
        _detail_message(session, data)
    events: list[str] = []

    @event.listens_for(sqlite_engine, "checkout")
    def checkout(_connection: object, _record: object, _proxy: object) -> None:
        events.append("checkout")

    @event.listens_for(sqlite_engine, "checkin")
    def checkin(_connection: object, _record: object) -> None:
        events.append("checkin")

    @event.listens_for(sqlite_engine, "commit")
    def commit(_connection: object) -> None:
        events.append("commit")

    source = ConversationRepository(session_factory=sqlite_session_factory).get_console_detail(
        data.context, data.app_id, data.conversation_id, kind=kind
    )
    assert events == ["checkout", "checkin"]
    assert source.tenant_id == data.context.active_workspace_id
    assert source.record.id == data.conversation_id
    assert source.record.created_at == _CONSOLE_DETAIL_TIME
    assert source.record.from_end_user_id == data.end_user_id
    assert source.files == ()
    with sqlite_session_factory() as session:
        stored = session.get_one(Conversation, data.conversation_id)
        assert stored.read_at is None
        assert stored.read_account_id is None
        assert stored.updated_at == _CONSOLE_DETAIL_TIME


@pytest.mark.parametrize("actor", ["current_account", "other_account", "end_user"])
@pytest.mark.parametrize("soft_deleted", [False, True])
def test_detail_and_mark_are_app_wide_even_for_other_actors_and_soft_deleted_rows(
    sqlite_session_factory: sessionmaker[Session], detail_data: DetailData, actor: str, soft_deleted: bool
) -> None:
    data = detail_data
    with sqlite_session_factory.begin() as session:
        conversation = session.get_one(Conversation, data.conversation_id)
        conversation.is_deleted = soft_deleted
        if actor != "end_user":
            conversation.from_source = ConversationFromSource.CONSOLE
            conversation.from_end_user_id = None
            conversation.from_account_id = data.context.account_id if actor == "current_account" else str(uuid4())
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    source = repository.get_console_detail(data.context, data.app_id, data.conversation_id, kind="chat")
    assert source.record.id == data.conversation_id
    repository.mark_console_read(data.context, data.app_id, data.conversation_id, kind="chat")
    with sqlite_session_factory() as session:
        stored = session.get_one(Conversation, data.conversation_id)
        assert stored.read_account_id == data.context.account_id
        assert stored.read_at is not None
        assert stored.is_deleted is soft_deleted


@pytest.mark.parametrize("operation", ["detail", "mark"])
@pytest.mark.parametrize("change", ["missing", "tenant", "status", "mode", "hidden_agent"])
def test_detail_and_mark_reject_unavailable_app_without_writing(
    sqlite_session_factory: sessionmaker[Session], detail_data: DetailData, operation: str, change: str
) -> None:
    data = detail_data
    with sqlite_session_factory.begin() as session:
        app = session.get_one(App, data.app_id)
        if change == "missing":
            session.delete(app)
        elif change == "tenant":
            app.tenant_id = str(uuid4())
        elif change == "status":
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app.id})
        elif change == "mode":
            app.mode = AppMode.COMPLETION
        else:
            app.mode = AppMode.AGENT
            session.add(
                Agent(
                    tenant_id=app.tenant_id,
                    name="Hidden workflow agent",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    backing_app_id=app.id,
                )
            )
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    query = repository.get_console_detail if operation == "detail" else repository.mark_console_read
    with pytest.raises(ConsoleAppNotFoundError):
        query(data.context, data.app_id, data.conversation_id, kind="chat")
    with sqlite_session_factory() as session:
        stored = session.get_one(Conversation, data.conversation_id)
        assert stored.read_at is None
        assert stored.read_account_id is None
        assert stored.updated_at == _CONSOLE_DETAIL_TIME


@pytest.mark.parametrize("operation", ["detail", "mark"])
@pytest.mark.parametrize("change", ["missing", "other_app"])
def test_detail_and_mark_scope_conversation_id_to_app(
    sqlite_session_factory: sessionmaker[Session], detail_data: DetailData, operation: str, change: str
) -> None:
    data = detail_data
    conversation_id = str(uuid4()) if change == "missing" else data.conversation_id
    if change == "other_app":
        with sqlite_session_factory.begin() as session:
            session.get_one(Conversation, data.conversation_id).app_id = str(uuid4())
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    query = repository.get_console_detail if operation == "detail" else repository.mark_console_read
    with pytest.raises(ConversationNotExistsError):
        query(data.context, data.app_id, conversation_id, kind="chat")
    with sqlite_session_factory() as session:
        stored = session.get_one(Conversation, data.conversation_id)
        assert stored.read_at is None
        assert stored.read_account_id is None


def test_mark_commits_first_reader_without_changing_update_time_or_overwriting_on_repeat(
    sqlite_session_factory: sessionmaker[Session], detail_data: DetailData
) -> None:
    data = detail_data
    repository = ConversationRepository(session_factory=sqlite_session_factory)
    before = naive_utc_now()
    repository.mark_console_read(data.context, data.app_id, data.conversation_id, kind="chat")
    after = naive_utc_now()
    with sqlite_session_factory() as session:
        stored = session.get_one(Conversation, data.conversation_id)
        first_read = stored.read_at
        assert first_read is not None
        assert before <= first_read <= after
        assert stored.read_account_id == data.context.account_id
        assert stored.updated_at == _CONSOLE_DETAIL_TIME
    other_context = data.context._replace(account_id=str(uuid4()))
    repository.mark_console_read(other_context, data.app_id, data.conversation_id, kind="chat")
    with sqlite_session_factory() as session:
        stored = session.get_one(Conversation, data.conversation_id)
        assert stored.read_at == first_read
        assert stored.read_account_id == data.context.account_id
        assert stored.updated_at == _CONSOLE_DETAIL_TIME


def test_completion_detail_keeps_raw_attachment_references_and_answer_without_external_io(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, detail_data: DetailData
) -> None:
    data = detail_data
    raw_file = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "transfer_method": "remote_url",
        "type": "image",
        "url": "https://example.invalid/unresolved-image.png",
    }
    raw_answer = "![image](https://example.invalid/files/tools/example.png?timestamp=1&nonce=n&sign=s)"
    with sqlite_session_factory.begin() as session:
        session.get_one(App, data.app_id).mode = AppMode.COMPLETION
        session.get_one(Conversation, data.conversation_id).mode = AppMode.COMPLETION
        message = _detail_message(session, data)
        message.inputs = {"file": raw_file, "files": [raw_file], "zero": 0, "none": None}
        message.answer = raw_answer
        remote = MessageFile(
            message_id=message.id,
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            created_by_role=CreatorUserRole.END_USER,
            created_by=data.end_user_id,
            url=raw_file["url"],
            belongs_to=MessageFileBelongsTo.USER,
        )
        session.add(remote)
    commits: list[object] = []

    @event.listens_for(sqlite_engine, "commit")
    def record_commit(connection: object) -> None:
        commits.append(connection)

    source = ConversationRepository(session_factory=sqlite_session_factory).get_console_detail(
        data.context, data.app_id, data.conversation_id, kind="completion"
    )
    assert isinstance(source.record, ConsoleCompletionConversationDetail)
    first = source.record.first_message
    assert first is not None
    assert first.id == message.id
    assert first.inputs == {"file": raw_file, "files": [raw_file], "zero": 0, "none": None}
    assert first.answer == raw_answer
    assert first.message_files == []
    assert len(source.files) == 1
    reference = source.files[0]
    assert reference.id == remote.id
    assert reference.type == "image"
    assert reference.transfer_method == "remote_url"
    assert reference.url == raw_file["url"]
    assert reference.upload_file_id is None
    assert reference.belongs_to == "user"
    assert commits == []


def test_completion_detail_with_no_messages_returns_no_message_or_files(
    sqlite_session_factory: sessionmaker[Session], detail_data: DetailData
) -> None:
    data = detail_data
    with sqlite_session_factory.begin() as session:
        session.get_one(App, data.app_id).mode = AppMode.COMPLETION
        session.get_one(Conversation, data.conversation_id).mode = AppMode.COMPLETION
    source = ConversationRepository(session_factory=sqlite_session_factory).get_console_detail(
        data.context, data.app_id, data.conversation_id, kind="completion"
    )
    assert isinstance(source.record, ConsoleCompletionConversationDetail)
    assert source.record.first_message is None
    assert source.files == ()


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
            _inputs={},
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
