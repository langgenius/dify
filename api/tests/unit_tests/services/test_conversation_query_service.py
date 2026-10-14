"""Conversation listing materializes data before restoring file inputs."""

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from graphon.file import FILE_MODEL_IDENTITY, File
from machinery.context import RequestContext
from models.enums import ConversationFromSource, EndUserType
from models.model import App, AppMode, Conversation, EndUser, InstalledApp, Message
from models.utils.file_input_compat import restore_input_files
from repositories.conversation_repository import ConversationRepository
from services.conversation_query_service import ConversationQueryService
from services.entities.conversation_entities import (
    ConsoleCompletionConversationRecord,
    ConsoleConversationFilters,
    ConsoleConversationScope,
    ConversationInputValue,
    ConversationListSource,
    ConversationScope,
    EndUserConversationScope,
    InstalledAppConversationScope,
)
from services.installed_app_access_service import InstalledAppRef
from services.message_query_adapters import MessageFileResolver
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message


@dataclass(frozen=True)
class QueryContext:
    scope: ConversationScope
    tenant_id: str
    conversation_id: str
    invoke_from: ConversationListSource


@pytest.fixture(params=["installed", "end_user"])
def query_context(request: pytest.FixtureRequest, sqlite_session_factory: sessionmaker[Session]) -> QueryContext:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Chat", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        account_id = str(uuid4())
        if request.param == "installed":
            installation = InstalledApp(
                tenant_id=str(uuid4()), app_id=app.id, app_owner_tenant_id=app.tenant_id, position=0, is_pinned=False
            )
            session.add(installation)
            session.flush()
            scope: ConversationScope = InstalledAppConversationScope(
                installed_app=InstalledAppRef(
                    id=installation.id,
                    tenant_id=installation.tenant_id,
                    app_id=app.id,
                    app_owner_tenant_id=app.tenant_id,
                    app_mode=app.mode.value,
                ),
                account_id=account_id,
            )
            invoke_from: ConversationListSource = "explore"
            conversation = Conversation(
                app_id=app.id,
                mode=AppMode.CHAT,
                name="Original",
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=account_id,
                from_end_user_id=None,
                invoke_from=invoke_from,
                is_deleted=False,
            )
        else:
            user = EndUser(tenant_id=app.tenant_id, app_id=app.id, type=EndUserType.BROWSER, session_id=str(uuid4()))
            session.add(user)
            session.flush()
            scope = EndUserConversationScope(app_id=app.id, tenant_id=app.tenant_id, end_user_id=user.id)
            invoke_from = "web-app"
            conversation = Conversation(
                app_id=app.id,
                mode=AppMode.CHAT,
                name="Original",
                inputs={},
                from_source=ConversationFromSource.API,
                from_account_id=None,
                from_end_user_id=user.id,
                invoke_from=invoke_from,
                is_deleted=False,
            )
        session.add(conversation)
        session.flush()
        return QueryContext(
            scope=scope, tenant_id=app.tenant_id, conversation_id=conversation.id, invoke_from=invoke_from
        )


def _record_connections(engine: Engine) -> list[str]:
    events: list[str] = []

    @event.listens_for(engine, "checkout")
    def checkout(_connection: object, _record: object, _proxy: object) -> None:
        events.append("checkout")

    @event.listens_for(engine, "checkin")
    def checkin(_connection: object, _record: object) -> None:
        events.append("checkin")

    return events


def test_query_restores_real_file_inputs_after_returning_database_connection(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, query_context: QueryContext
) -> None:
    file_mapping: dict[str, JsonValue] = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "transfer_method": "remote_url",
        "type": "document",
        "url": "https://example.com/report.pdf",
        "filename": "report.pdf",
        "extension": ".pdf",
        "mime_type": "application/pdf",
        "size": 1,
    }
    inputs: dict[str, ConversationInputValue] = {
        "file": file_mapping,
        "files": [file_mapping],
        "mixed": [file_mapping, "unchanged"],
        "nested": {"file": file_mapping},
        "empty": [],
        "zero": 0,
        "flag": False,
        "none": None,
    }
    with sqlite_session_factory.begin() as session:
        conversation = session.get(Conversation, query_context.conversation_id)
        assert conversation is not None
        conversation.inputs = deepcopy(inputs)
    connection_events = _record_connections(sqlite_engine)

    def restore(
        *, inputs: Mapping[str, ConversationInputValue], tenant_resolver: Callable[[], str]
    ) -> dict[str, ConversationInputValue]:
        assert connection_events == ["checkout", "checkin"]
        assert tenant_resolver() == query_context.tenant_id
        connection_events.append("restore")
        return restore_input_files(inputs=inputs, tenant_resolver=tenant_resolver)

    service = ConversationQueryService(
        files=MessageFileResolver(),
        conversations=ConversationRepository(session_factory=sqlite_session_factory),
        restore_inputs=restore,
    )
    result = service.get_page(
        scope=query_context.scope,
        invoke_from=query_context.invoke_from,
        last_id=None,
        limit=20,
        pinned=None,
        sort_by="-updated_at",
    )
    assert connection_events == ["checkout", "checkin", "restore"]
    assert result.tenant_id == query_context.tenant_id
    assert len(result.data) == 1
    restored = result.data[0]
    assert restored.id == query_context.conversation_id
    assert restored.name == "Original"
    assert restored.status == "normal"
    file = restored.inputs["file"]
    assert isinstance(file, File)
    assert file.remote_url == "https://example.com/report.pdf"
    assert restored.inputs["files"] == [file]
    assert restored.inputs["mixed"] == inputs["mixed"]
    assert restored.inputs["nested"] == inputs["nested"]
    assert restored.inputs["empty"] == []
    assert restored.inputs["zero"] == 0
    assert restored.inputs["flag"] is False
    assert restored.inputs["none"] is None
    with sqlite_session_factory() as session:
        stored = session.get(Conversation, query_context.conversation_id)
        assert stored is not None
        assert stored._inputs == inputs


def test_repository_returns_detached_raw_file_inputs_without_restoring_or_committing(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, query_context: QueryContext
) -> None:
    # Invalid file metadata would fail if the repository accidentally restored it.
    inputs: dict[str, ConversationInputValue] = {
        "file": {"dify_model_identity": FILE_MODEL_IDENTITY, "transfer_method": "invalid"},
        "nested": {"values": [0, None]},
    }
    with sqlite_session_factory.begin() as session:
        conversation = session.get(Conversation, query_context.conversation_id)
        assert conversation is not None
        conversation.inputs = inputs
    connection_events = _record_connections(sqlite_engine)
    commits: list[bool] = []

    @event.listens_for(sqlite_session_factory, "after_commit")
    def committed(_session: Session) -> None:
        commits.append(True)

    result = ConversationRepository(session_factory=sqlite_session_factory).get_page(
        scope=query_context.scope,
        invoke_from=query_context.invoke_from,
        last_id=None,
        limit=20,
        pinned=None,
        sort_by="-updated_at",
    )
    assert connection_events == ["checkout", "checkin"]
    assert commits == []
    assert result.data[0].inputs == inputs
    nested = result.data[0].inputs["nested"]
    assert isinstance(nested, dict)
    nested["values"] = ["changed"]
    with sqlite_session_factory() as session:
        stored = session.get(Conversation, query_context.conversation_id)
        assert stored is not None
        assert stored._inputs == inputs


def test_invalid_file_input_error_propagates_after_repository_connection_is_closed(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, query_context: QueryContext
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = session.get(Conversation, query_context.conversation_id)
        assert conversation is not None
        conversation.inputs = {"file": {"dify_model_identity": FILE_MODEL_IDENTITY, "transfer_method": "invalid"}}
    connection_events = _record_connections(sqlite_engine)
    service = ConversationQueryService(
        files=MessageFileResolver(),
        conversations=ConversationRepository(session_factory=sqlite_session_factory),
        restore_inputs=restore_input_files,
    )
    with pytest.raises(ValueError):
        service.get_page(
            scope=query_context.scope,
            invoke_from=query_context.invoke_from,
            last_id=None,
            limit=20,
            pinned=None,
            sort_by="-updated_at",
        )
    assert connection_events == ["checkout", "checkin"]
    with sqlite_session_factory() as session:
        assert (
            session.scalar(select(Conversation.id).where(Conversation.id == query_context.conversation_id)) is not None
        )


@pytest.fixture
def console_scope(sqlite_session_factory: sessionmaker[Session]) -> ConsoleConversationScope:
    with sqlite_session_factory.begin() as session:
        session.add(make_account(timezone="Asia/Shanghai"))
        session.add(make_app(mode=AppMode.COMPLETION))
        session.add(make_conversation(mode=AppMode.COMPLETION, inputs={}, from_source=ConversationFromSource.API))
        session.add(
            make_message(
                inputs={},
                query="Question",
                message=[{"text": "Prompt"}],
                answer="Answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                total_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            )
        )
    return ConversationRepository(session_factory=sqlite_session_factory).get_console_scope(
        RequestContext(request_id="test", trace_id=None, account_id="account-1", active_workspace_id="tenant-1"),
        "app-1",
        kind="completion",
    )


def _console_filters() -> ConsoleConversationFilters:
    return ConsoleConversationFilters(
        keyword=None, start=None, end=None, annotation_status="all", sort_by="-created_at", page=1, limit=20
    )


def test_console_message_file_inputs_restore_after_all_database_projections_complete(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, console_scope: ConsoleConversationScope
) -> None:
    file_mapping: dict[str, JsonValue] = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "transfer_method": "remote_url",
        "type": "document",
        "url": "https://example.com/report.pdf",
        "filename": "report.pdf",
        "extension": ".pdf",
        "mime_type": "application/pdf",
        "size": 1,
    }
    inputs: dict[str, ConversationInputValue] = {"file": file_mapping, "zero": 0, "none": None}
    with sqlite_session_factory.begin() as session:
        message = session.get_one(Message, "message-1")
        message.inputs = deepcopy(inputs)
    connection_events = _record_connections(sqlite_engine)
    commits: list[bool] = []

    @event.listens_for(sqlite_session_factory, "after_commit")
    def committed(_session: Session) -> None:
        commits.append(True)

    def restore(
        *, inputs: Mapping[str, ConversationInputValue], tenant_resolver: Callable[[], str]
    ) -> dict[str, ConversationInputValue]:
        assert connection_events == ["checkout", "checkin"]
        assert tenant_resolver() == console_scope.tenant_id
        connection_events.append("restore")
        return restore_input_files(inputs=inputs, tenant_resolver=tenant_resolver)

    service = ConversationQueryService(
        files=MessageFileResolver(),
        conversations=ConversationRepository(session_factory=sqlite_session_factory),
        restore_inputs=restore,
    )
    page = service.get_console_page(scope=console_scope, filters=_console_filters())

    assert console_scope.timezone == "Asia/Shanghai"
    assert connection_events == ["checkout", "checkin", "restore"]
    assert commits == []
    record = page.items[0]
    assert isinstance(record, ConsoleCompletionConversationRecord)
    assert record.first_message is not None
    file = record.first_message.inputs["file"]
    assert isinstance(file, File)
    assert file.remote_url == "https://example.com/report.pdf"
    assert record.first_message.inputs["zero"] == 0
    assert record.first_message.inputs["none"] is None
    with sqlite_session_factory() as session:
        message = session.get_one(Message, "message-1")
        assert message._inputs == inputs


def test_console_invalid_file_metadata_fails_after_connection_release(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, console_scope: ConsoleConversationScope
) -> None:
    with sqlite_session_factory.begin() as session:
        message = session.get_one(Message, "message-1")
        message.inputs = {"file": {"dify_model_identity": FILE_MODEL_IDENTITY, "transfer_method": "invalid"}}
    connection_events = _record_connections(sqlite_engine)
    service = ConversationQueryService(
        files=MessageFileResolver(),
        conversations=ConversationRepository(session_factory=sqlite_session_factory),
        restore_inputs=restore_input_files,
    )

    with pytest.raises(ValueError):
        service.get_console_page(scope=console_scope, filters=_console_filters())

    assert connection_events == ["checkout", "checkin"]
