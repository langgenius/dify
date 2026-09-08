from dataclasses import replace
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, inspect, select, update
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import App, AppMode, Conversation, InstalledApp, Message
from models.web import PinnedConversation
from repositories.installed_app_conversation_repository import SQLAlchemyInstalledAppConversationRepository
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.errors.message import MessageNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_conversation_service import ConversationDeletion, ConversationPage

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
            id=installed_app.id, tenant_id=installed_app.tenant_id, app_id=app.id, app_mode=app.mode.value
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
        inputs={"empty": "", "list": [], "zero": 0, "flag": False, "none": None},
        introduction=None,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=_ACCOUNT_ID,
        from_end_user_id=None,
        created_at=_TIME - timedelta(days=1),
        updated_at=updated_at,
        invoke_from=invoke_from,
        is_deleted=False,
    )
    session.add(conversation)
    session.flush()
    return conversation


def _message(session: Session, conversation: Conversation, *, query: str, created_at: datetime) -> None:
    session.add(
        Message(
            app_id=conversation.app_id,
            conversation_id=conversation.id,
            inputs={},
            query=query,
            message={},
            message_unit_price=Decimal(0),
            answer="",
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=_ACCOUNT_ID,
            created_at=created_at,
        )
    )


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
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)
    assert repository.get_page(
        installed_app=installation, account_id=_ACCOUNT_ID, last_id=None, limit=20, pinned=None
    ) == ConversationPage(limit=20, has_more=False, data=())
    assert repository.get_page(
        installed_app=installation, account_id=_ACCOUNT_ID, last_id=str(uuid4()), limit=20, pinned=True
    ) == ConversationPage(limit=20, has_more=False, data=())
    with pytest.raises(LastConversationNotExistsError):
        repository.get_page(
            installed_app=installation, account_id=_ACCOUNT_ID, last_id=str(uuid4()), limit=20, pinned=None
        )


def test_page_keeps_updated_order_cursor_and_detached_inputs(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        old = _conversation(session, installation, updated_at=_TIME - timedelta(hours=1))
        newest = _conversation(session, installation, updated_at=_TIME + timedelta(hours=1))
        middle = _conversation(session, installation)
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)

    first_page = repository.get_page(
        installed_app=installation, account_id=_ACCOUNT_ID, last_id=None, limit=2, pinned=None
    )
    final_page = repository.get_page(
        installed_app=installation, account_id=_ACCOUNT_ID, last_id=middle.id, limit=1, pinned=None
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
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)
    page = repository.get_page(installed_app=installation, account_id=_ACCOUNT_ID, last_id=None, limit=1, pinned=None)
    assert len(page.data) == 1
    assert page.has_more is False
    assert (
        repository.get_page(
            installed_app=installation, account_id=_ACCOUNT_ID, last_id=page.data[0].id, limit=1, pinned=None
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
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)

    for pinned, expected in [(None, [legacy.id, explore.id]), (True, [legacy.id]), (False, [explore.id])]:
        page = repository.get_page(
            installed_app=installation, account_id=_ACCOUNT_ID, last_id=None, limit=20, pinned=pinned
        )
        assert [item.id for item in page.data] == expected
        assert page.has_more is False
    for cursor, pinned in [(debugging.id, None), (explore.id, True), (legacy.id, False)]:
        with pytest.raises(LastConversationNotExistsError):
            repository.get_page(
                installed_app=installation, account_id=_ACCOUNT_ID, last_id=cursor, limit=20, pinned=pinned
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
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)

    assert (
        repository.get_page(
            installed_app=installation, account_id=_ACCOUNT_ID, last_id=None, limit=20, pinned=None
        ).data
        == ()
    )
    with pytest.raises(LastConversationNotExistsError):
        repository.get_page(
            installed_app=installation, account_id=_ACCOUNT_ID, last_id=conversation_id, limit=20, pinned=None
        )
    with pytest.raises(ConversationNotExistsError):
        repository.get(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation_id)
    with pytest.raises(ConversationNotExistsError):
        repository.get_name_source(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation_id)
    with pytest.raises(ConversationNotExistsError):
        repository.rename(
            installed_app=installation,
            account_id=_ACCOUNT_ID,
            conversation_id=conversation_id,
            name="Unauthorized",
            updated_at=_TIME,
        )
    with pytest.raises(ConversationNotExistsError):
        repository.delete(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation_id)
    with pytest.raises(ConversationNotExistsError):
        repository.set_pinned(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation_id, is_pinned=True
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
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)

    with pytest.raises(InstalledAppNotFoundError):
        repository.get_page(installed_app=installation, account_id=_ACCOUNT_ID, last_id=None, limit=20, pinned=True)
    with pytest.raises(InstalledAppNotFoundError):
        repository.get_name_source(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id)
    with pytest.raises(InstalledAppNotFoundError):
        repository.rename(
            installed_app=installation,
            account_id=_ACCOUNT_ID,
            conversation_id=conversation.id,
            name="Unauthorized",
            updated_at=_TIME,
        )
    with pytest.raises(InstalledAppNotFoundError):
        repository.delete(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id)
    for is_pinned in (True, False):
        with pytest.raises(InstalledAppNotFoundError):
            repository.set_pinned(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id, is_pinned=is_pinned
            )


def test_name_source_uses_first_message_and_real_app_owner_tenant(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        _message(session, conversation, query="Later", created_at=_TIME)
        _message(session, conversation, query="First", created_at=_TIME - timedelta(hours=1))
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)
    connection_events: list[str] = []

    @event.listens_for(sqlite_engine, "checkout")
    def track_checkout(_connection: object, _record: object, _proxy: object) -> None:
        connection_events.append("checkout")

    @event.listens_for(sqlite_engine, "checkin")
    def track_checkin(_connection: object, _record: object) -> None:
        connection_events.append("checkin")

    result = repository.get_name_source(
        installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id
    )
    assert connection_events == ["checkout", "checkin"]
    assert result.tenant_id == _OWNER_TENANT_ID != installation.tenant_id
    assert result.query == "First"
    record = repository.get(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id)
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
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)
    with pytest.raises(MessageNotExistsError, match=conversation.id):
        repository.get_name_source(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id)


@pytest.mark.parametrize("updated_at", [None, _TIME + timedelta(hours=1)])
def test_rename_commits_and_materializes_automatic_or_explicit_updated_at(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, updated_at: datetime | None
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)
    result = repository.rename(
        installed_app=installation,
        account_id=_ACCOUNT_ID,
        conversation_id=conversation.id,
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
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)
    for _ in range(2):
        repository.set_pinned(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id, is_pinned=True
        )
    with sqlite_session_factory() as session:
        assert len(session.scalars(select(PinnedConversation)).all()) == 4

    for _ in range(2):
        repository.set_pinned(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id, is_pinned=False
        )
    repository.set_pinned(
        installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=str(uuid4()), is_pinned=False
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
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)
    repository.set_pinned(
        installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=missing_id, is_pinned=True
    )
    repository.set_pinned(
        installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=missing_id, is_pinned=False
    )
    with sqlite_session_factory() as session:
        assert session.scalars(select(PinnedConversation)).all() == []


def test_delete_commits_soft_deletion_and_returns_owner_tenant_for_cleanup(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=sqlite_session_factory)
    deleted = repository.delete(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id)

    assert deleted == ConversationDeletion(
        tenant_id=_OWNER_TENANT_ID, conversation_id=conversation.id, retired_binding_id=None
    )
    with sqlite_session_factory() as session:
        stored = session.get(Conversation, conversation.id)
        assert stored is not None
        assert stored.is_deleted is True
    with pytest.raises(ConversationNotExistsError):
        repository.delete(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id)


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

    repository = SQLAlchemyInstalledAppConversationRepository(session_factory=failing_factory)

    def mutate() -> None:
        if operation == "rename":
            repository.rename(
                installed_app=installation,
                account_id=_ACCOUNT_ID,
                conversation_id=conversation.id,
                name="Discarded",
                updated_at=_TIME + timedelta(hours=1),
            )
        elif operation == "delete":
            repository.delete(installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id)
        else:
            repository.set_pinned(
                installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id, is_pinned=True
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
