"""Installed-app conversation orchestration over real SQLite transactions."""

from dataclasses import replace
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, delete, event, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, InstalledApp, Message
from models.utils.file_input_compat import restore_input_files
from repositories.conversation_repository import ConversationRepository
from services.conversation_command_service import ConversationCleanup, ConversationCommandService
from services.conversation_name_service import (
    ConversationNameGenerator,
    ConversationNameRequiredError,
    ConversationNameService,
)
from services.conversation_query_service import ConversationQueryService
from services.entities.conversation_entities import InstalledAppConversationRef
from services.errors.conversation import ConversationNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_conversation_service import (
    ConversationNotChatAppError,
    InstalledAppConversationService,
)

_TIME = datetime(2024, 1, 1)


@pytest.fixture
def ref(sqlite_session_factory: sessionmaker[Session]) -> InstalledAppConversationRef:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Shared chat", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        installation = InstalledApp(
            tenant_id=str(uuid4()), app_id=app.id, app_owner_tenant_id=app.tenant_id, position=0, is_pinned=False
        )
        session.add(installation)
        session.flush()
        account_id = str(uuid4())
        conversation = Conversation(
            app_id=app.id,
            mode=AppMode.CHAT,
            name="Original",
            inputs={"count": 0},
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=account_id,
            from_end_user_id=None,
            updated_at=_TIME,
            is_deleted=False,
        )
        session.add(conversation)
        session.flush()
        session.add(
            Message(
                app_id=app.id,
                conversation_id=conversation.id,
                inputs={},
                query="First",
                message={},
                message_unit_price=Decimal(0),
                answer="",
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=account_id,
            )
        )
        return InstalledAppConversationRef(
            installed_app=InstalledAppRef(
                id=installation.id,
                app_id=app.id,
                tenant_id=installation.tenant_id,
                app_owner_tenant_id=app.tenant_id,
                app_mode=app.mode.value,
            ),
            account_id=account_id,
            conversation_id=conversation.id,
        )


def _unexpected_generation(**_kwargs: str) -> str:
    raise AssertionError("Unexpected generation")


def _unexpected_cleanup(**_kwargs: object) -> None:
    raise AssertionError("Unexpected cleanup")


def _service(
    factory: sessionmaker[Session], *, generate_name: ConversationNameGenerator, cleanup: ConversationCleanup
) -> InstalledAppConversationService:
    repository = ConversationRepository(session_factory=factory)
    return InstalledAppConversationService(
        queries=ConversationQueryService(conversations=repository, restore_inputs=restore_input_files),
        names=ConversationNameService(conversations=repository, generate_name=generate_name),
        commands=ConversationCommandService(conversations=repository, enqueue_delete_cleanup=cleanup),
    )


def test_auto_name_uses_actual_app_owner_and_releases_source_connection(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, ref: InstalledAppConversationRef
) -> None:
    events: list[str] = []

    @event.listens_for(sqlite_engine, "checkout")
    def checkout(_connection: object, _record: object, _proxy: object) -> None:
        events.append("checkout")

    @event.listens_for(sqlite_engine, "checkin")
    def checkin(_connection: object, _record: object) -> None:
        events.append("checkin")

    def generate_name(*, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str:
        assert events == ["checkout", "checkin"]
        assert tenant_id == ref.installed_app.app_owner_tenant_id != ref.installed_app.tenant_id
        assert (app_id, conversation_id, query, app_mode) == (ref.app_id, ref.conversation_id, "First", "chat")
        events.append("generate")
        return "Generated"

    service = _service(sqlite_session_factory, generate_name=generate_name, cleanup=_unexpected_cleanup)
    result = service.rename(
        installed_app=ref.installed_app,
        account_id=ref.account_id,
        conversation_id=ref.conversation_id,
        name="Ignored",
        auto_generate=True,
    )
    assert result.name == "Generated"
    assert result.inputs == {"count": 0}
    assert result.updated_at != _TIME
    assert events == ["checkout", "checkin", "generate", "checkout", "checkin"]
    assert ConversationRepository(session_factory=sqlite_session_factory).get(ref=ref) == result


def test_generation_failure_returns_concurrently_updated_name(
    sqlite_session_factory: sessionmaker[Session], ref: InstalledAppConversationRef
) -> None:
    def generate_name(**_kwargs: str) -> str:
        with sqlite_session_factory.begin() as session:
            session.execute(
                update(Conversation).where(Conversation.id == ref.conversation_id).values(name="Concurrent name")
            )
        raise RuntimeError("Provider unavailable")

    service = _service(sqlite_session_factory, generate_name=generate_name, cleanup=_unexpected_cleanup)
    result = service.rename(
        installed_app=ref.installed_app,
        account_id=ref.account_id,
        conversation_id=ref.conversation_id,
        name=None,
        auto_generate=True,
    )
    assert result.name == "Concurrent name"
    assert ConversationRepository(session_factory=sqlite_session_factory).get(ref=ref) == result


@pytest.mark.parametrize(
    "change", ["conversation_deleted", "account", "installation_deleted", "installation_tenant", "installation_app"]
)
def test_auto_name_rechecks_installation_and_account_before_writing(
    sqlite_session_factory: sessionmaker[Session], ref: InstalledAppConversationRef, change: str
) -> None:
    def generate_name(**_kwargs: str) -> str:
        with sqlite_session_factory.begin() as session:
            if change == "conversation_deleted":
                session.execute(
                    update(Conversation).where(Conversation.id == ref.conversation_id).values(is_deleted=True)
                )
            elif change == "account":
                session.execute(
                    update(Conversation)
                    .where(Conversation.id == ref.conversation_id)
                    .values({Conversation.from_account_id: str(uuid4())})
                )
            elif change == "installation_deleted":
                session.execute(delete(InstalledApp).where(InstalledApp.id == ref.installed_app.id))
            elif change == "installation_tenant":
                session.execute(
                    update(InstalledApp).where(InstalledApp.id == ref.installed_app.id).values(tenant_id=str(uuid4()))
                )
            else:
                session.execute(
                    update(InstalledApp).where(InstalledApp.id == ref.installed_app.id).values(app_id=str(uuid4()))
                )
        return "Must not persist"

    service = _service(sqlite_session_factory, generate_name=generate_name, cleanup=_unexpected_cleanup)
    error = InstalledAppNotFoundError if change.startswith("installation") else ConversationNotExistsError
    with pytest.raises(error):
        service.rename(
            installed_app=ref.installed_app,
            account_id=ref.account_id,
            conversation_id=ref.conversation_id,
            name=None,
            auto_generate=True,
        )
    with sqlite_session_factory() as session:
        assert session.scalar(select(Conversation.name).where(Conversation.id == ref.conversation_id)) == "Original"


def test_manual_name_is_committed_without_generation(
    sqlite_session_factory: sessionmaker[Session], ref: InstalledAppConversationRef
) -> None:
    service = _service(sqlite_session_factory, generate_name=_unexpected_generation, cleanup=_unexpected_cleanup)
    result = service.rename(
        installed_app=ref.installed_app,
        account_id=ref.account_id,
        conversation_id=ref.conversation_id,
        name="Manual",
        auto_generate=False,
    )
    assert result.name == "Manual"
    assert result.updated_at is not None
    assert result.updated_at > _TIME
    assert ConversationRepository(session_factory=sqlite_session_factory).get(ref=ref) == result


def test_missing_manual_name_does_not_modify_conversation(
    sqlite_session_factory: sessionmaker[Session], ref: InstalledAppConversationRef
) -> None:
    service = _service(sqlite_session_factory, generate_name=_unexpected_generation, cleanup=_unexpected_cleanup)
    with pytest.raises(ConversationNameRequiredError):
        service.rename(
            installed_app=ref.installed_app,
            account_id=ref.account_id,
            conversation_id=ref.conversation_id,
            name=None,
            auto_generate=False,
        )
    stored = ConversationRepository(session_factory=sqlite_session_factory).get(ref=ref)
    assert stored.name == "Original"
    assert stored.updated_at == _TIME


def test_cleanup_observes_committed_delete_and_app_owner(
    sqlite_session_factory: sessionmaker[Session], ref: InstalledAppConversationRef
) -> None:
    queued: list[str] = []

    def cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
        assert tenant_id == ref.installed_app.app_owner_tenant_id
        assert conversation_id == ref.conversation_id
        assert retired_workspace_ids == ()
        with sqlite_session_factory() as session:
            assert session.scalar(select(Conversation.is_deleted).where(Conversation.id == conversation_id)) is True
        queued.append(conversation_id)

    service = _service(sqlite_session_factory, generate_name=_unexpected_generation, cleanup=cleanup)
    service.delete(installed_app=ref.installed_app, account_id=ref.account_id, conversation_id=ref.conversation_id)
    assert queued == [ref.conversation_id]


def test_failed_delete_rolls_back_before_cleanup(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, ref: InstalledAppConversationRef
) -> None:
    failing_factory = sessionmaker(bind=sqlite_engine)

    @event.listens_for(failing_factory, "before_commit")
    def fail_commit(_session: Session) -> None:
        raise RuntimeError("Commit failed")

    service = _service(failing_factory, generate_name=_unexpected_generation, cleanup=_unexpected_cleanup)
    with pytest.raises(RuntimeError, match="Commit failed"):
        service.delete(installed_app=ref.installed_app, account_id=ref.account_id, conversation_id=ref.conversation_id)
    assert ConversationRepository(session_factory=sqlite_session_factory).get(ref=ref).name == "Original"


@pytest.mark.parametrize("mode", ["completion", "workflow", "agent", "unknown"])
def test_non_chat_mode_is_rejected_before_rename_or_delete(
    sqlite_session_factory: sessionmaker[Session], ref: InstalledAppConversationRef, mode: str
) -> None:
    service = _service(sqlite_session_factory, generate_name=_unexpected_generation, cleanup=_unexpected_cleanup)
    installed_app = replace(ref.installed_app, app_mode=mode)
    with pytest.raises(ConversationNotChatAppError):
        service.rename(
            installed_app=installed_app,
            account_id=ref.account_id,
            conversation_id=ref.conversation_id,
            name="Forbidden",
            auto_generate=False,
        )
    with pytest.raises(ConversationNotChatAppError):
        service.delete(installed_app=installed_app, account_id=ref.account_id, conversation_id=ref.conversation_id)
    stored = ConversationRepository(session_factory=sqlite_session_factory).get(ref=ref)
    assert stored.name == "Original"


def test_list_uses_shared_query_and_explore_scope(
    sqlite_session_factory: sessionmaker[Session], ref: InstalledAppConversationRef
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            Conversation(
                app_id=ref.app_id,
                mode=AppMode.CHAT,
                name="Other invocation",
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=ref.account_id,
                from_end_user_id=None,
                invoke_from="debugger",
                is_deleted=False,
            )
        )
    service = _service(sqlite_session_factory, generate_name=_unexpected_generation, cleanup=_unexpected_cleanup)
    page = service.get_page(
        installed_app=ref.installed_app, account_id=ref.account_id, last_id=None, limit=20, pinned=None
    )
    assert [record.id for record in page.data] == [ref.conversation_id]
    assert page.data[0].inputs == {"count": 0}
    assert page.tenant_id == ref.installed_app.app_owner_tenant_id
    assert page.has_more is False
    assert (
        service.get_page(
            installed_app=ref.installed_app, account_id=ref.account_id, last_id=None, limit=20, pinned=True
        ).data
        == ()
    )
