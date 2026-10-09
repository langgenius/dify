import json
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy import Connection, event, inspect, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from extensions.storage.storage_type import StorageType
from graphon.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType
from models import Account, EndUser
from models.enums import ConversationFromSource, CreatorUserRole, EndUserType, FeedbackFromSource, FeedbackRating
from models.human_input import HumanInputFormStatus
from models.model import (
    App,
    AppAnnotationHitHistory,
    AppMode,
    Conversation,
    InstalledApp,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageFeedback,
    MessageFile,
    UploadFile,
)
from repositories.message_repository import MessageRepository
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.entities.message_entities import MessageAccount, MessageActor, MessageEndUser, MessagePage, MessageRecord
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import FirstMessageNotExistsError, MessageActorNotFoundError, MessageNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from tests.test_containers_integration_tests.helpers.execution_extra_content import create_human_input_message_fixture

_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"
_OWNER_TENANT_ID = "22222222-2222-4222-8222-222222222222"
_TIME = datetime(2026, 9, 8, 12, 30)


@pytest.fixture
def installation(sqlite_session_factory: sessionmaker[Session]) -> InstalledAppRef:
    with sqlite_session_factory.begin() as session:
        account = Account(name="Reviewer", email="reviewer@example.com")
        account.id = _ACCOUNT_ID
        session.add(account)
        app = App(tenant_id=_OWNER_TENANT_ID, name="Shared chat", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        installation = InstalledApp(
            tenant_id=str(uuid4()), app_id=app.id, app_owner_tenant_id=app.tenant_id, position=0, is_pinned=False
        )
        session.add(installation)
        session.flush()
        return InstalledAppRef(
            id=installation.id,
            tenant_id=installation.tenant_id,
            app_id=app.id,
            app_owner_tenant_id=app.tenant_id,
            app_mode="chat",
        )


def _conversation(session: Session, installation: InstalledAppRef) -> Conversation:
    conversation = Conversation(
        app_id=installation.app_id,
        mode=AppMode.CHAT,
        name="Chat",
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=_ACCOUNT_ID,
        from_end_user_id=None,
        is_deleted=False,
    )
    session.add(conversation)
    session.flush()
    return conversation


def _message(session: Session, conversation: Conversation, *, created_at: datetime = _TIME) -> Message:
    message = Message(
        app_id=conversation.app_id,
        conversation_id=conversation.id,
        inputs={"empty": "", "list": [], "zero": 0, "false": False, "none": None},
        query="Question",
        message={},
        answer="Answer",
        message_tokens=2,
        message_unit_price=Decimal(0),
        answer_tokens=3,
        answer_unit_price=Decimal(0),
        provider_response_latency=0.5,
        total_price=Decimal("0.0000001"),
        currency="USD",
        from_source=conversation.from_source,
        from_account_id=conversation.from_account_id,
        from_end_user_id=conversation.from_end_user_id,
        created_at=created_at,
    )
    session.add(message)
    session.flush()
    return message


def _feedback(session: Session, message: Message, *, source: FeedbackFromSource) -> MessageFeedback:
    feedback = MessageFeedback(
        app_id=message.app_id,
        conversation_id=message.conversation_id,
        message_id=message.id,
        rating=FeedbackRating.LIKE,
        content="Original",
        from_source=source,
        from_account_id=str(uuid4()),
    )
    session.add(feedback)
    session.flush()
    return feedback


def test_page_keeps_cursor_order_and_detaches_complete_message_data(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        old = _message(session, conversation, created_at=_TIME - timedelta(hours=1))
        middle = _message(session, conversation)
        newest = _message(session, conversation, created_at=_TIME + timedelta(hours=1))
        middle.parent_message_id = old.id
        middle.message_metadata = json.dumps(
            {"retriever_resources": [{"position": 1, "content": "context"}], "usage": {"total_tokens": 5}}
        )
        _feedback(session, middle, source=FeedbackFromSource.USER)
        admin = _feedback(session, middle, source=FeedbackFromSource.ADMIN)
        admin.rating = FeedbackRating.DISLIKE
        later = MessageAgentThought(
            message_id=middle.id, position=2, created_by_role=CreatorUserRole.ACCOUNT, created_by=_ACCOUNT_ID
        )
        earlier = MessageAgentThought(
            message_id=middle.id,
            message_chain_id=str(uuid4()),
            position=1,
            thought="Thinking",
            answer="Partial answer",
            tool="search",
            tool_labels_str='{"search":{"en_US":"Search"}}',
            tool_input='{"query":"query"}',
            observation="Found",
            message_files='["file-id"]',
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=_ACCOUNT_ID,
        )
        session.add_all([later, earlier])
    repository = MessageRepository(
        session_factory=sqlite_session_factory,
        extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
    )
    page = repository.get_message_page(
        installed_app=installation,
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        actor=MessageAccount(account_id=_ACCOUNT_ID),
        conversation_id=conversation.id,
        first_id=None,
        limit=2,
    )
    final = repository.get_message_page(
        installed_app=installation,
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        actor=MessageAccount(account_id=_ACCOUNT_ID),
        conversation_id=conversation.id,
        first_id=middle.id,
        limit=2,
    )

    assert [item.id for item in page.data] == [middle.id, newest.id]
    assert (page.limit, page.has_more) == (2, True)
    assert [item.id for item in final.data] == [old.id]
    assert final.has_more is False
    record = page.data[0]
    assert inspect(record, raiseerr=False) is None
    assert (record.conversation_id, record.parent_message_id) == (conversation.id, old.id)
    assert record.inputs == {"empty": "", "list": [], "zero": 0, "false": False, "none": None}
    assert (record.query, record.answer, record.created_at) == ("Question", "Answer", _TIME)
    assert record.feedback is not None
    assert record.feedback.rating == "like"
    assert inspect(record.feedback, raiseerr=False) is None
    assert record.retriever_resources == [{"position": 1, "content": "context"}]
    assert record.metadata == {
        "retriever_resources": [{"position": 1, "content": "context"}],
        "usage": {"total_tokens": 5},
    }
    assert record.message_files == []
    assert record.extra_contents == []
    assert (record.message_tokens, record.answer_tokens, record.provider_response_latency) == (2, 3, 0.5)
    assert (record.total_price, record.currency, record.status, record.error) == (
        Decimal("0.0000001"),
        "USD",
        "normal",
        None,
    )
    assert [thought.position for thought in record.agent_thoughts] == [1, 2]
    thought = record.agent_thoughts[0]
    assert inspect(thought, raiseerr=False) is None
    assert (thought.id, thought.message_chain_id, thought.message_id) == (
        earlier.id,
        earlier.message_chain_id,
        middle.id,
    )
    assert (thought.thought, thought.answer, thought.tool) == ("Thinking", "Partial answer", "search")
    assert (thought.tool_labels, thought.tool_input, thought.observation) == (
        {"search": {"en_US": "Search"}},
        '{"query":"query"}',
        "Found",
    )
    assert thought.files == ["file-id"]
    assert thought.created_at == earlier.created_at


def test_empty_conversation_and_strict_timestamp_ties_preserve_legacy_page_behavior(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    repository = MessageRepository(
        session_factory=sqlite_session_factory,
        extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
    )
    assert repository.get_message_page(
        installed_app=installation,
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        actor=MessageAccount(account_id=_ACCOUNT_ID),
        conversation_id="",
        first_id=str(uuid4()),
        limit=20,
    ) == MessagePage(limit=20, has_more=False, data=())
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        _message(session, conversation)
        _message(session, conversation)
    page = repository.get_message_page(
        installed_app=installation,
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        actor=MessageAccount(account_id=_ACCOUNT_ID),
        conversation_id=conversation.id,
        first_id=None,
        limit=1,
    )
    assert page.has_more is True
    assert len(page.data) == 1
    assert repository.get_message_page(
        installed_app=installation,
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        actor=MessageAccount(account_id=_ACCOUNT_ID),
        conversation_id=conversation.id,
        first_id=page.data[0].id,
        limit=1,
    ) == MessagePage(limit=1, has_more=False, data=())


@pytest.mark.parametrize("mismatch", ["app_id", "from_account_id", "from_source", "from_end_user_id", "is_deleted"])
def test_listing_checks_each_conversation_ownership_predicate(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        _message(session, conversation)
        value: str | bool = True if mismatch == "is_deleted" else str(uuid4())
        if mismatch == "from_source":
            value = ConversationFromSource.API
        session.execute(update(Conversation).where(Conversation.id == conversation.id).values({mismatch: value}))
    with pytest.raises(ConversationNotExistsError):
        MessageRepository(
            session_factory=sqlite_session_factory,
            extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
        ).get_message_page(
            installed_app=installation,
            app_id=installation.app_id,
            app_owner_tenant_id=installation.app_owner_tenant_id,
            actor=MessageAccount(account_id=_ACCOUNT_ID),
            conversation_id=conversation.id,
            first_id=None,
            limit=20,
        )


def test_cursor_must_belong_to_the_requested_conversation(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        other_message = _message(session, _conversation(session, installation))
    repository = MessageRepository(
        session_factory=sqlite_session_factory,
        extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
    )
    for cursor in (other_message.id, str(uuid4())):
        with pytest.raises(FirstMessageNotExistsError):
            repository.get_message_page(
                installed_app=installation,
                app_id=installation.app_id,
                app_owner_tenant_id=installation.app_owner_tenant_id,
                actor=MessageAccount(account_id=_ACCOUNT_ID),
                conversation_id=conversation.id,
                first_id=cursor,
                limit=20,
            )


@pytest.mark.parametrize(
    "mismatch",
    ["id", "tenant_id", "app_id", "app_owner_tenant_id", "installed_owner", "deleted_app", "deleted_installation"],
)
def test_read_revalidates_installation_after_admission(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        _message(session, conversation)
        if mismatch == "deleted_app":
            app = session.get(App, installation.app_id)
            assert app is not None
            session.delete(app)
        elif mismatch == "installed_owner":
            session.execute(
                update(InstalledApp).where(InstalledApp.id == installation.id).values(app_owner_tenant_id=str(uuid4()))
            )
        elif mismatch == "deleted_installation":
            installed = session.get(InstalledApp, installation.id)
            assert installed is not None
            session.delete(installed)
    ref = installation
    if mismatch == "id":
        ref = replace(ref, id=str(uuid4()))
    elif mismatch == "tenant_id":
        ref = replace(ref, tenant_id=str(uuid4()))
    elif mismatch == "app_id":
        ref = replace(ref, app_id=str(uuid4()))
    elif mismatch == "app_owner_tenant_id":
        ref = replace(ref, app_owner_tenant_id=str(uuid4()))
    repository = MessageRepository(
        session_factory=sqlite_session_factory,
        extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
    )
    with pytest.raises(InstalledAppNotFoundError):
        repository.get_message_page(
            installed_app=ref,
            app_id=installation.app_id,
            app_owner_tenant_id=installation.app_owner_tenant_id,
            actor=MessageAccount(account_id=_ACCOUNT_ID),
            conversation_id=conversation.id,
            first_id=None,
            limit=20,
        )


@dataclass
class _ActorHarness:
    repository: MessageRepository
    installation: InstalledAppRef
    actor: MessageActor
    conversation: Conversation
    factory: sessionmaker[Session]
    sessions: list[Session]

    def page(self, *, first_id: str | None = None, limit: int = 2) -> MessagePage[MessageRecord]:
        return self.repository.get_message_page(
            app_id=self.installation.app_id,
            app_owner_tenant_id=self.installation.app_owner_tenant_id,
            actor=self.actor,
            conversation_id=self.conversation.id,
            first_id=first_id,
            limit=limit,
            installed_app=None,
        )

    def assert_closed(self) -> None:
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)


@pytest.fixture(params=["account", "end_user"])
def actor_harness(
    request: pytest.FixtureRequest, sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> _ActorHarness:
    actor: MessageActor = MessageAccount(account_id=_ACCOUNT_ID)
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        if request.param == "end_user":
            user = EndUser(
                tenant_id=installation.app_owner_tenant_id,
                app_id=installation.app_id,
                type=EndUserType.SERVICE_API,
                session_id=str(uuid4()),
            )
            session.add(user)
            session.flush()
            actor = MessageEndUser(end_user_id=user.id)
            conversation.from_source = ConversationFromSource.API
            conversation.from_account_id = None
            conversation.from_end_user_id = user.id
    sessions: list[Session] = []

    @event.listens_for(sqlite_session_factory, "after_begin")
    def record_session(session: Session, _transaction: object, _connection: object) -> None:
        sessions.append(session)

    return _ActorHarness(
        repository=MessageRepository(
            session_factory=sqlite_session_factory,
            extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
        ),
        installation=installation,
        actor=actor,
        conversation=conversation,
        factory=sqlite_session_factory,
        sessions=sessions,
    )


def test_account_and_end_user_history_empty_pages_and_order(actor_harness: _ActorHarness) -> None:
    harness = actor_harness
    assert harness.page() == MessagePage(limit=2, has_more=False, data=())
    with harness.factory.begin() as session:
        older = _message(session, harness.conversation, created_at=_TIME - timedelta(hours=1))
        middle = _message(session, harness.conversation)
        newest = _message(session, harness.conversation, created_at=_TIME + timedelta(hours=1))
        decoy = _message(session, _conversation(session, harness.installation))
    page = harness.page()
    assert [message.id for message in page.data] == [middle.id, newest.id]
    assert page.has_more is True
    assert decoy.id not in {message.id for message in page.data}
    last = harness.page(first_id=middle.id)
    assert [message.id for message in last.data] == [older.id]
    assert last.has_more is False
    harness.assert_closed()


@pytest.mark.parametrize("mismatch", ["app_id", "from_source", "from_account_id", "from_end_user_id", "is_deleted"])
def test_each_actor_conversation_scope_is_required(actor_harness: _ActorHarness, mismatch: str) -> None:
    harness = actor_harness
    with harness.factory.begin() as session:
        value: str | bool = True if mismatch == "is_deleted" else str(uuid4())
        if mismatch == "from_source":
            value = "console" if isinstance(harness.actor, MessageEndUser) else "api"
        session.execute(
            update(Conversation).where(Conversation.id == harness.conversation.id).values({mismatch: value})
        )
    with pytest.raises(ConversationNotExistsError):
        harness.page()
    harness.assert_closed()


def test_deleted_actor_is_revalidated_against_current_database(actor_harness: _ActorHarness) -> None:
    harness = actor_harness
    with harness.factory.begin() as session:
        if isinstance(harness.actor, MessageAccount):
            account = session.get(Account, harness.actor.account_id)
            assert account is not None
            session.delete(account)
        else:
            user = session.get(EndUser, harness.actor.end_user_id)
            assert user is not None
            session.delete(user)
    with pytest.raises(MessageActorNotFoundError):
        harness.page()
    harness.assert_closed()


def test_message_and_cursor_must_match_app_even_with_valid_conversation(actor_harness: _ActorHarness) -> None:
    harness = actor_harness
    with harness.factory.begin() as session:
        valid = _message(session, harness.conversation)
        decoy = _message(session, harness.conversation, created_at=_TIME + timedelta(hours=1))
        decoy.app_id = str(uuid4())
    page = harness.page(limit=1)
    assert [message.id for message in page.data] == [valid.id]
    assert page.has_more is False
    with pytest.raises(FirstMessageNotExistsError):
        harness.page(first_id=decoy.id)
    harness.assert_closed()


@pytest.mark.parametrize("deleted", [False, True])
def test_app_owner_chain_is_revalidated_before_empty_actor_page(actor_harness: _ActorHarness, deleted: bool) -> None:
    harness = actor_harness
    with harness.factory.begin() as session:
        app = session.get(App, harness.installation.app_id)
        assert app is not None
        if deleted:
            session.delete(app)
        else:
            app.tenant_id = str(uuid4())
    with pytest.raises(AppDefinitionUnavailableError):
        harness.repository.get_message_page(
            app_id=harness.installation.app_id,
            app_owner_tenant_id=harness.installation.app_owner_tenant_id,
            actor=harness.actor,
            conversation_id="",
            first_id=None,
            limit=20,
            installed_app=None,
        )
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT])
@pytest.mark.parametrize("mismatch", ["from_account_id", "from_source", "from_end_user_id", "is_deleted"])
def test_console_uses_actual_app_mode_for_ownership(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mode: AppMode, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(update(App).where(App.id == installation.app_id).values(mode=mode))
        conversation = _conversation(session, installation)
        message = _message(session, conversation)
        value: str | bool = True if mismatch == "is_deleted" else str(uuid4())
        if mismatch == "from_source":
            value = "api"
        session.execute(update(Conversation).where(Conversation.id == conversation.id).values({mismatch: value}))
    repository = MessageRepository(
        session_factory=sqlite_session_factory,
        extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
    )
    if mode == AppMode.AGENT:
        with pytest.raises(ConversationNotExistsError):
            repository.get_console_message_page(
                app_id=installation.app_id,
                app_owner_tenant_id=installation.app_owner_tenant_id,
                account_id=_ACCOUNT_ID,
                conversation_id=conversation.id,
                first_id=None,
                limit=1,
            )
    else:
        page = repository.get_console_message_page(
            app_id=installation.app_id,
            app_owner_tenant_id=installation.app_owner_tenant_id,
            account_id=_ACCOUNT_ID,
            conversation_id=conversation.id,
            first_id=None,
            limit=1,
        )
        assert [item.id for item in page.data] == [message.id]


def test_console_strict_timestamp_has_more_and_cursor_scope(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        older = _message(session, conversation, created_at=_TIME - timedelta(hours=1))
        first = _message(session, conversation)
        _message(session, conversation)
        decoy = _message(session, conversation, created_at=_TIME - timedelta(hours=2))
        decoy.app_id = str(uuid4())
    repository = MessageRepository(
        session_factory=sqlite_session_factory,
        extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
    )
    page = repository.get_console_message_page(
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        account_id=_ACCOUNT_ID,
        conversation_id=conversation.id,
        first_id=None,
        limit=1,
    )
    assert page.has_more is True
    final = repository.get_console_message_page(
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        account_id=_ACCOUNT_ID,
        conversation_id=conversation.id,
        first_id=first.id,
        limit=1,
    )
    assert [item.id for item in final.data] == [older.id]
    assert final.has_more is False
    with sqlite_session_factory.begin() as session:
        session.execute(update(Message).where(Message.id == older.id).values(created_at=_TIME))
    tied_page = repository.get_console_message_page(
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        account_id=_ACCOUNT_ID,
        conversation_id=conversation.id,
        first_id=None,
        limit=1,
    )
    assert tied_page.has_more is False
    with pytest.raises(FirstMessageNotExistsError):
        repository.get_console_message_page(
            app_id=installation.app_id,
            app_owner_tenant_id=installation.app_owner_tenant_id,
            account_id=_ACCOUNT_ID,
            conversation_id=conversation.id,
            first_id=decoy.id,
            limit=1,
        )


@pytest.mark.parametrize("detail", [False, True], ids=["page", "detail"])
def test_console_detaches_annotation_feedback_file_and_input_data(actor_harness: _ActorHarness, detail: bool) -> None:
    harness = actor_harness
    with harness.factory.begin() as session:
        message = _message(session, harness.conversation)
        message.message = {"messages": [{"role": "user", "text": "Question"}]}
        message.workflow_run_id = str(uuid4())
        upload = UploadFile(
            tenant_id=harness.installation.app_owner_tenant_id,
            storage_type=StorageType.LOCAL,
            key="upload/report.txt",
            name="report.txt",
            size=7,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=_ACCOUNT_ID,
            created_at=_TIME,
            used=True,
        )
        session.add(upload)
        attachment = MessageFile(
            message_id=message.id,
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            upload_file_id=upload.id,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=_ACCOUNT_ID,
        )
        session.add(attachment)
        message.inputs = {
            "file": {
                "dify_model_identity": FILE_MODEL_IDENTITY,
                "transfer_method": "remote_url",
                "type": "document",
                "url": "https://example.com/report.txt",
                "filename": "report.txt",
                "extension": ".txt",
                "mime_type": "text/plain",
                "size": 7,
            }
        }
        message.answer = f"[report](/files/{upload.id}/file-preview?timestamp=1&nonce=old&sign=old)"
        feedback = _feedback(session, message, source=FeedbackFromSource.ADMIN)
        feedback.from_account_id = _ACCOUNT_ID
        annotation = MessageAnnotation(
            app_id=message.app_id,
            conversation_id=message.conversation_id,
            message_id=message.id,
            question="Question",
            content="Annotated answer",
            account_id=_ACCOUNT_ID,
        )
        session.add(annotation)
        session.flush()
        session.add(
            AppAnnotationHitHistory(
                app_id=message.app_id,
                annotation_id=annotation.id,
                message_id=message.id,
                source="api",
                question="Question",
                account_id=_ACCOUNT_ID,
                score=1.0,
                annotation_question="Question",
                annotation_content="Annotated answer",
            )
        )
    if detail:
        record = harness.repository.get_console_message(
            app_id=harness.installation.app_id,
            app_owner_tenant_id=harness.installation.app_owner_tenant_id,
            account_id=_ACCOUNT_ID,
            message_id=message.id,
        )
    else:
        page = harness.repository.get_console_message_page(
            app_id=harness.installation.app_id,
            app_owner_tenant_id=harness.installation.app_owner_tenant_id,
            account_id=_ACCOUNT_ID,
            conversation_id=harness.conversation.id,
            first_id=None,
            limit=20,
        )
        record = page.data[0]
    harness.assert_closed()
    assert inspect(record, raiseerr=False) is None
    assert record.message == {"messages": [{"role": "user", "text": "Question"}]}
    assert record.workflow_run_id == message.workflow_run_id
    assert record.from_source == harness.conversation.from_source
    assert record.from_account_id == harness.conversation.from_account_id
    assert record.from_end_user_id == harness.conversation.from_end_user_id
    assert record.annotation is not None
    assert record.annotation.id == annotation.id
    assert record.annotation.content == "Annotated answer"
    assert record.annotation.account is not None
    assert (record.annotation.account.id, record.annotation.account.name, record.annotation.account.email) == (
        _ACCOUNT_ID,
        "Reviewer",
        "reviewer@example.com",
    )
    assert record.annotation_hit_history is not None
    assert record.annotation_hit_history.id == annotation.id
    assert record.annotation_hit_history.annotation_create_account == record.annotation.account
    assert record.annotation_hit_history.created_at == annotation.created_at
    assert record.feedbacks[0].from_account == record.annotation.account
    assert (record.feedbacks[0].rating, record.feedbacks[0].content, record.feedbacks[0].from_source) == (
        "like",
        "Original",
        "admin",
    )
    file = record.message_files[0]
    assert inspect(file, raiseerr=False) is None
    assert (
        file.id,
        file.filename,
        file.type,
        file.mime_type,
        file.size,
        file.transfer_method,
        file.upload_file_id,
    ) == (attachment.id, "report.txt", "document", "text/plain", 7, "local_file", upload.id)
    assert file.url is not None
    assert upload.id in file.url
    assert upload.id in record.answer
    assert "sign=old" not in record.answer
    input_file = record.inputs["file"]
    assert isinstance(input_file, File)
    assert input_file.filename == "report.txt"
    assert input_file.remote_url == "https://example.com/report.txt"
    assert record.extra_contents == []


@pytest.mark.parametrize("actor_harness", ["end_user"], indirect=True)
@pytest.mark.parametrize("mismatch", ["app_id", "tenant_id"])
def test_end_user_must_belong_to_app_and_tenant(actor_harness: _ActorHarness, mismatch: str) -> None:
    harness = actor_harness
    assert isinstance(harness.actor, MessageEndUser)
    with harness.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == harness.actor.end_user_id).values({mismatch: str(uuid4())}))
    with pytest.raises(MessageActorNotFoundError):
        harness.page()
    harness.assert_closed()


@pytest.mark.parametrize(
    "mismatch", ["app_tenant", "deleted_app", "deleted_account", "conversation_app", "missing_conversation"]
)
def test_console_revalidates_entire_owner_chain(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        _message(session, conversation)
        if mismatch == "app_tenant":
            session.execute(update(App).where(App.id == installation.app_id).values(tenant_id=str(uuid4())))
        elif mismatch == "deleted_app":
            app = session.get(App, installation.app_id)
            assert app is not None
            session.delete(app)
        elif mismatch == "deleted_account":
            account = session.get(Account, _ACCOUNT_ID)
            assert account is not None
            session.delete(account)
        elif mismatch == "conversation_app":
            conversation.app_id = str(uuid4())
    expected_error = (
        AppDefinitionUnavailableError
        if mismatch in {"app_tenant", "deleted_app"}
        else MessageActorNotFoundError
        if mismatch == "deleted_account"
        else ConversationNotExistsError
    )
    with pytest.raises(expected_error):
        MessageRepository(
            session_factory=sqlite_session_factory,
            extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
        ).get_console_message_page(
            app_id=installation.app_id,
            app_owner_tenant_id=installation.app_owner_tenant_id,
            account_id=_ACCOUNT_ID,
            conversation_id=str(uuid4()) if mismatch == "missing_conversation" else conversation.id,
            first_id=None,
            limit=20,
        )


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT])
def test_console_empty_conversation_and_cursor_from_other_conversation(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mode: AppMode
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(update(App).where(App.id == installation.app_id).values(mode=mode))
        conversation = _conversation(session, installation)
        other = _message(session, _conversation(session, installation))
    repository = MessageRepository(
        session_factory=sqlite_session_factory,
        extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
    )
    assert repository.get_console_message_page(
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        account_id=_ACCOUNT_ID,
        conversation_id=conversation.id,
        first_id=None,
        limit=2,
    ) == MessagePage(limit=2, has_more=False, data=())
    with pytest.raises(FirstMessageNotExistsError):
        repository.get_console_message_page(
            app_id=installation.app_id,
            app_owner_tenant_id=installation.app_owner_tenant_id,
            account_id=_ACCOUNT_ID,
            conversation_id=conversation.id,
            first_id=other.id,
            limit=2,
        )


@pytest.mark.parametrize("mode", list(AppMode))
def test_console_detail_preserves_app_wide_access_for_every_mode(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mode: AppMode
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(update(App).where(App.id == installation.app_id).values(mode=mode))
        other_account = Account(name="Other author", email="other-author@example.com")
        session.add(other_account)
        session.flush()
        conversation = _conversation(session, installation)
        conversation.from_account_id = other_account.id
        conversation.is_deleted = True
        message = _message(session, conversation)
    repository = MessageRepository(
        session_factory=sqlite_session_factory,
        extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
    )
    record = repository.get_console_message(
        app_id=installation.app_id,
        app_owner_tenant_id=installation.app_owner_tenant_id,
        account_id=_ACCOUNT_ID,
        message_id=message.id,
    )
    assert record.id == message.id
    assert record.conversation_id == conversation.id
    assert record.from_account_id == other_account.id
    assert inspect(record, raiseerr=False) is None


@pytest.mark.parametrize("mismatch", ["app_tenant", "deleted_app", "deleted_account", "message_app", "missing_message"])
def test_console_detail_rechecks_app_tenant_actor_and_message_ownership(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        message = _message(session, conversation)
        foreign_app = App(
            tenant_id=str(uuid4()), name="Foreign app", mode=AppMode.CHAT, enable_site=True, enable_api=True
        )
        session.add(foreign_app)
        session.flush()
        if mismatch == "app_tenant":
            session.execute(update(App).where(App.id == installation.app_id).values(tenant_id=foreign_app.tenant_id))
        elif mismatch == "deleted_app":
            app = session.get(App, installation.app_id)
            assert app is not None
            session.delete(app)
        elif mismatch == "deleted_account":
            account = session.get(Account, _ACCOUNT_ID)
            assert account is not None
            session.delete(account)
        elif mismatch == "message_app":
            message.app_id = foreign_app.id
    expected_error = (
        AppDefinitionUnavailableError
        if mismatch in {"app_tenant", "deleted_app"}
        else MessageActorNotFoundError
        if mismatch == "deleted_account"
        else MessageNotExistsError
    )
    with pytest.raises(expected_error):
        MessageRepository(
            session_factory=sqlite_session_factory,
            extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=sqlite_session_factory),
        ).get_console_message(
            app_id=installation.app_id,
            app_owner_tenant_id=installation.app_owner_tenant_id,
            account_id=_ACCOUNT_ID,
            message_id=str(uuid4()) if mismatch == "missing_message" else message.id,
        )


@pytest.mark.parametrize("submitted", [False, True], ids=["waiting", "submitted"])
def test_console_detail_loads_complete_extra_content_after_its_session_closes(
    sqlite_session_factory: sessionmaker[Session], submitted: bool
) -> None:
    with sqlite_session_factory() as session:
        fixture = create_human_input_message_fixture(session)
        if not submitted:
            fixture.form.status = HumanInputFormStatus.WAITING
            fixture.form.selected_action_id = None
            fixture.form.submitted_at = None
            fixture.form.submitted_data = None
        session.commit()
        app_id, tenant_id = fixture.app.id, fixture.app.tenant_id
        account_id, message_id = fixture.account.id, fixture.message.id
        form_id, workflow_run_id = fixture.form.id, fixture.message.workflow_run_id
        expiration_time = int(fixture.form.expiration_time.timestamp())

    message_sessions: list[Session] = []
    content_sessions: list[Session] = []
    contents_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

    def record_message_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        message_sessions.append(session)

    def assert_message_session_closed(
        session: Session, _transaction: SessionTransaction, _connection: Connection
    ) -> None:
        assert message_sessions
        assert all(not previous.in_transaction() and not previous.identity_map for previous in message_sessions)
        content_sessions.append(session)

    event.listen(sqlite_session_factory, "after_begin", record_message_session)
    event.listen(contents_factory, "after_begin", assert_message_session_closed)
    try:
        record = MessageRepository(
            session_factory=sqlite_session_factory,
            extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=contents_factory),
        ).get_console_message(
            app_id=app_id,
            app_owner_tenant_id=tenant_id,
            account_id=account_id,
            message_id=message_id,
        )
    finally:
        event.remove(sqlite_session_factory, "after_begin", record_message_session)
        event.remove(contents_factory, "after_begin", assert_message_session_closed)
    assert content_sessions
    assert all(not session.in_transaction() and not session.identity_map for session in content_sessions)
    expected_content: dict[str, JsonValue] = {
        "workflow_run_id": workflow_run_id,
        "type": "human_input",
        "submitted": submitted,
        "form_definition": {
            "form_id": form_id,
            "node_id": "node-id",
            "node_title": "Approval",
            "form_content": "Rendered block",
            "inputs": [],
            "actions": [{"id": "approve", "title": "Approve request", "button_style": "default"}],
            "display_in_ui": True,
            "resolved_default_values": {},
            "expiration_time": expiration_time,
        },
    }
    if submitted:
        expected_content["form_submission_data"] = {
            "node_id": "node-id",
            "node_title": "Approval",
            "rendered_content": "Rendered block",
            "action_id": "approve",
            "action_text": "Approve request",
            "submitted_data": {"name": "Alice"},
        }
    assert record.id == message_id
    assert record.extra_contents == [expected_content]
