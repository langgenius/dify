"""Conversation naming with real ownership checks and bounded SQLite transactions."""

from dataclasses import replace
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy import Engine, delete, event, inspect, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.enums import ConversationFromSource, EndUserType
from models.model import App, AppMode, Conversation, EndUser, Message
from repositories.conversation_repository import ConversationRepository
from services.conversation_name_service import (
    ConversationNameRequiredError,
    ConversationNameService,
)
from services.entities.conversation_entities import ConversationRecord, EndUserConversationRef
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError

_TIME = datetime(2024, 1, 1, 12, 0)
_INPUTS: dict[str, JsonValue] = {"empty": "", "list": [], "zero": 0, "flag": False, "none": None}


@pytest.fixture
def conversation_ref(sqlite_session_factory: sessionmaker[Session]) -> EndUserConversationRef:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Chat", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        end_user = EndUser(tenant_id=app.tenant_id, app_id=app.id, type=EndUserType.BROWSER, session_id=str(uuid4()))
        session.add(end_user)
        session.flush()
        conversation = Conversation(
            app_id=app.id,
            mode=AppMode.CHAT,
            name="Original name",
            inputs=_INPUTS,
            introduction=None,
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
            from_account_id=None,
            created_at=_TIME - timedelta(days=1),
            updated_at=_TIME,
            is_deleted=False,
        )
        session.add(conversation)
        session.flush()
        return EndUserConversationRef(
            app_id=app.id, tenant_id=app.tenant_id, end_user_id=end_user.id, conversation_id=conversation.id
        )


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> ConversationRepository:
    return ConversationRepository(session_factory=sqlite_session_factory)


def _message(session: Session, ref: EndUserConversationRef, *, query: str, created_at: datetime) -> None:
    session.add(
        Message(
            app_id=ref.app_id,
            conversation_id=ref.conversation_id,
            inputs={},
            query=query,
            message={},
            message_unit_price=Decimal(0),
            answer="",
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.API,
            from_end_user_id=ref.end_user_id,
            created_at=created_at,
        )
    )


def _rename(
    service: ConversationNameService,
    ref: EndUserConversationRef,
    *,
    name: str | None = None,
    auto_generate: bool = True,
) -> ConversationRecord:
    return service.rename(
        ref=ref,
        app_mode="chat",
        name=name,
        auto_generate=auto_generate,
    )


def _unexpected_generation(**_kwargs: str) -> str:
    raise AssertionError("Manual names and invalid ownership must not enter the model provider")


def test_automatic_name_closes_source_connection_before_provider_and_reopens_for_write(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    conversation_ref: EndUserConversationRef,
    repository: ConversationRepository,
) -> None:
    with sqlite_session_factory.begin() as session:
        _message(session, conversation_ref, query="Later", created_at=_TIME)
        _message(session, conversation_ref, query="First", created_at=_TIME - timedelta(hours=1))
    connection_events: list[str] = []

    @event.listens_for(sqlite_engine, "checkout")
    def checkout(_connection: object, _record: object, _proxy: object) -> None:
        connection_events.append("checkout")

    @event.listens_for(sqlite_engine, "checkin")
    def checkin(_connection: object, _record: object) -> None:
        connection_events.append("checkin")

    def generate_name(*, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str:
        assert connection_events == ["checkout", "checkin"]
        assert (tenant_id, app_id, conversation_id, query, app_mode) == (
            conversation_ref.tenant_id,
            conversation_ref.app_id,
            conversation_ref.conversation_id,
            "First",
            "chat",
        )
        connection_events.append("generate")
        return "Generated name"

    result = _rename(ConversationNameService(conversations=repository, generate_name=generate_name), conversation_ref)
    assert connection_events == ["checkout", "checkin", "generate", "checkout", "checkin"]
    assert inspect(result, raiseerr=False) is None
    assert result.name == "Generated name"
    assert result.inputs == _INPUTS
    assert result.introduction is None
    assert result.created_at == _TIME - timedelta(days=1)
    stored = repository.get(ref=conversation_ref)
    assert stored == result
    # The model's existing onupdate default still runs for an automatic name.
    assert result.updated_at != _TIME


@pytest.mark.parametrize("name", ["Manual name", ""])
def test_manual_name_commits_without_entering_provider(
    conversation_ref: EndUserConversationRef, repository: ConversationRepository, name: str
) -> None:
    result = _rename(
        ConversationNameService(conversations=repository, generate_name=_unexpected_generation),
        conversation_ref,
        name=name,
        auto_generate=False,
    )
    assert result.name == name
    assert result.updated_at is not None
    assert result.updated_at > _TIME
    assert result.inputs == _INPUTS
    assert repository.get(ref=conversation_ref) == result


def test_missing_manual_name_does_not_touch_database(
    sqlite_engine: Engine, conversation_ref: EndUserConversationRef, repository: ConversationRepository
) -> None:
    statements: list[str] = []

    @event.listens_for(sqlite_engine, "before_cursor_execute")
    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        statements.append(statement)

    with pytest.raises(ConversationNameRequiredError):
        _rename(
            ConversationNameService(conversations=repository, generate_name=_unexpected_generation),
            conversation_ref,
            auto_generate=False,
        )
    assert statements == []


def test_generation_failure_returns_fresh_record_and_does_not_overwrite_concurrent_name(
    sqlite_session_factory: sessionmaker[Session],
    conversation_ref: EndUserConversationRef,
    repository: ConversationRepository,
) -> None:
    with sqlite_session_factory.begin() as session:
        _message(session, conversation_ref, query="First", created_at=_TIME)

    def generate_name(**_kwargs: str) -> str:
        with sqlite_session_factory.begin() as session:
            conversation = session.get(Conversation, conversation_ref.conversation_id)
            assert conversation is not None
            conversation.name = "Changed while generating"
            conversation.updated_at = _TIME + timedelta(hours=1)
        raise RuntimeError("Provider unavailable")

    result = _rename(ConversationNameService(conversations=repository, generate_name=generate_name), conversation_ref)
    assert result.name == "Changed while generating"
    assert result.updated_at == _TIME + timedelta(hours=1)
    assert repository.get(ref=conversation_ref) == result


def test_write_commit_failure_rolls_back_and_is_not_suppressed_as_provider_failure(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    conversation_ref: EndUserConversationRef,
    repository: ConversationRepository,
) -> None:
    with sqlite_session_factory.begin() as session:
        _message(session, conversation_ref, query="First", created_at=_TIME)
    failing_factory = sessionmaker(bind=sqlite_engine)

    @event.listens_for(failing_factory, "before_commit")
    def fail_commit(_session: Session) -> None:
        raise RuntimeError("Database commit unavailable")

    def generate_name(**_kwargs: str) -> str:
        return "Must be rolled back"

    service = ConversationNameService(
        conversations=ConversationRepository(session_factory=failing_factory),
        generate_name=generate_name,
    )
    with pytest.raises(RuntimeError, match="Database commit unavailable"):
        _rename(service, conversation_ref)
    record = repository.get(ref=conversation_ref)
    assert record.name == "Original name"
    assert record.updated_at == _TIME


@pytest.mark.parametrize("change", ["soft_delete", "hard_delete", "end_user", "tenant"])
def test_generation_rechecks_ownership_and_deletion_before_writing(
    sqlite_session_factory: sessionmaker[Session],
    conversation_ref: EndUserConversationRef,
    repository: ConversationRepository,
    change: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        _message(session, conversation_ref, query="First", created_at=_TIME)

    def generate_name(**_kwargs: str) -> str:
        with sqlite_session_factory.begin() as session:
            statement = update(Conversation).where(Conversation.id == conversation_ref.conversation_id)
            if change == "hard_delete":
                session.execute(delete(Message).where(Message.conversation_id == conversation_ref.conversation_id))
                session.execute(delete(Conversation).where(Conversation.id == conversation_ref.conversation_id))
            elif change == "soft_delete":
                session.execute(statement.values(is_deleted=True))
            elif change == "end_user":
                session.execute(statement.values(from_end_user_id=str(uuid4())))
            else:
                session.execute(update(App).where(App.id == conversation_ref.app_id).values(tenant_id=str(uuid4())))
        return "Must not be written"

    with pytest.raises(ConversationNotExistsError):
        _rename(ConversationNameService(conversations=repository, generate_name=generate_name), conversation_ref)
    with sqlite_session_factory() as session:
        stored = session.get(Conversation, conversation_ref.conversation_id)
        if change == "hard_delete":
            assert stored is None
        else:
            assert stored is not None
            assert stored.name == "Original name"


@pytest.mark.parametrize(
    "mismatch",
    [
        "app_id",
        "tenant_id",
        "end_user_id",
        "conversation_app",
        "source",
        "account",
        "deleted",
        "user_app",
        "user_tenant",
    ],
)
def test_complete_owner_chain_protects_source_reads_and_writes(
    sqlite_session_factory: sessionmaker[Session],
    conversation_ref: EndUserConversationRef,
    repository: ConversationRepository,
    mismatch: str,
) -> None:
    original_ref = conversation_ref
    with sqlite_session_factory.begin() as session:
        _message(session, conversation_ref, query="First", created_at=_TIME)
        if mismatch in {"app_id", "tenant_id", "end_user_id"}:
            conversation_ref = replace(conversation_ref, **{mismatch: str(uuid4())})
        elif mismatch in {"user_app", "user_tenant"}:
            column = "app_id" if mismatch == "user_app" else "tenant_id"
            session.execute(
                update(EndUser).where(EndUser.id == conversation_ref.end_user_id).values({column: str(uuid4())})
            )
        else:
            changes = {
                "conversation_app": {"app_id": str(uuid4())},
                "source": {"from_source": ConversationFromSource.CONSOLE},
                "account": {"from_account_id": str(uuid4())},
                "deleted": {"is_deleted": True},
            }
            session.execute(
                update(Conversation)
                .where(Conversation.id == conversation_ref.conversation_id)
                .values(changes[mismatch])
            )
    for operation in [repository.get, repository.get_name_source]:
        with pytest.raises(ConversationNotExistsError):
            operation(ref=conversation_ref)
    service = ConversationNameService(conversations=repository, generate_name=_unexpected_generation)
    with pytest.raises(ConversationNotExistsError):
        _rename(service, conversation_ref)
    with pytest.raises(ConversationNotExistsError):
        _rename(service, conversation_ref, name="Unauthorized", auto_generate=False)
    with sqlite_session_factory() as session:
        assert session.scalar(select(Conversation.name).where(Conversation.id == original_ref.conversation_id)) == (
            "Original name"
        )


@pytest.mark.parametrize("foreign_message", [False, True])
def test_automatic_name_requires_a_message_from_the_owned_app(
    sqlite_session_factory: sessionmaker[Session],
    conversation_ref: EndUserConversationRef,
    repository: ConversationRepository,
    foreign_message: bool,
) -> None:
    if foreign_message:
        with sqlite_session_factory.begin() as session:
            _message(session, replace(conversation_ref, app_id=str(uuid4())), query="Wrong app", created_at=_TIME)
    with pytest.raises(MessageNotExistsError):
        _rename(
            ConversationNameService(conversations=repository, generate_name=_unexpected_generation), conversation_ref
        )
    assert repository.get(ref=conversation_ref).name == "Original name"
