"""Console details use app-wide reads and a separate bounded read-marker write."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, text, update
from sqlalchemy.orm import Session, sessionmaker

from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod, FileType
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.account import Account
from models.agent import Agent, AgentScope, AgentSource
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from models.model import App, AppMode, Conversation, EndUser, Message, MessageFile
from repositories.conversation_repository import ConversationRepository
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.conversation_entities import ConsoleCompletionConversationDetail, ConsoleConversationKind
from services.errors.conversation import ConversationNotExistsError

_TIME = datetime(2020, 1, 2, 3, 4, 5)


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
        end_user = EndUser(tenant_id=app.tenant_id, app_id=app.id, type="browser", session_id="detail-user")
        session.add(end_user)
        session.flush()
        conversation = Conversation(
            app_id=app.id,
            mode=AppMode.CHAT,
            name="Conversation",
            inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
            from_account_id=None,
            created_at=_TIME,
            updated_at=_TIME,
            introduction="Introduction",
            is_deleted=False,
        )
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


def _message(session: Session, data: DetailData) -> Message:
    message = Message(
        app_id=data.app_id,
        conversation_id=data.conversation_id,
        inputs={"zero": 0, "none": None, "empty": []},
        query="Question",
        message=[{"text": "Raw prompt"}],
        message_unit_price=Decimal(0),
        answer="Raw answer",
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=data.end_user_id,
        created_at=_TIME,
    )
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
            .values({Conversation.mode: mode, Conversation.updated_at: _TIME})
        )
        _message(session, data)
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
    assert source.record.created_at == _TIME
    assert source.record.from_end_user_id == data.end_user_id
    assert source.files == ()
    with sqlite_session_factory() as session:
        stored = session.get_one(Conversation, data.conversation_id)
        assert stored.read_at is None
        assert stored.read_account_id is None
        assert stored.updated_at == _TIME


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
        assert stored.updated_at == _TIME


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
        assert before <= first_read <= after
        assert stored.read_account_id == data.context.account_id
        assert stored.updated_at == _TIME
    other_context = data.context._replace(account_id=str(uuid4()))
    repository.mark_console_read(other_context, data.app_id, data.conversation_id, kind="chat")
    with sqlite_session_factory() as session:
        stored = session.get_one(Conversation, data.conversation_id)
        assert stored.read_at == first_read
        assert stored.read_account_id == data.context.account_id
        assert stored.updated_at == _TIME


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
        message = _message(session, data)
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
