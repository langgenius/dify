import json
from dataclasses import replace
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import Engine, event, inspect, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.enums import ConversationFromSource, CreatorUserRole, FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, Conversation, InstalledApp, Message, MessageAgentThought, MessageFeedback
from repositories.installed_app_message_repository import SQLAlchemyInstalledAppMessageRepository
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import FirstMessageNotExistsError, MessageNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_message_service import FeedbackRatingRequiredError, MessagePage, MessageRating

_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"
_OWNER_TENANT_ID = "22222222-2222-4222-8222-222222222222"
_TIME = datetime(2026, 9, 8, 12, 30)


@pytest.fixture
def installation(sqlite_session_factory: sessionmaker[Session]) -> InstalledAppRef:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=_OWNER_TENANT_ID, name="Shared chat", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        installation = InstalledApp(
            tenant_id=str(uuid4()), app_id=app.id, app_owner_tenant_id=app.tenant_id, position=0, is_pinned=False
        )
        session.add(installation)
        session.flush()
        return InstalledAppRef(id=installation.id, tenant_id=installation.tenant_id, app_id=app.id, app_mode="chat")


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
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=_ACCOUNT_ID,
        from_end_user_id=None,
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
    repository = SQLAlchemyInstalledAppMessageRepository(session_factory=sqlite_session_factory)
    page = repository.get_page(
        installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id, first_id=None, limit=2
    )
    final = repository.get_page(
        installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id, first_id=middle.id, limit=2
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
    repository = SQLAlchemyInstalledAppMessageRepository(session_factory=sqlite_session_factory)
    assert repository.get_page(
        installed_app=installation, account_id=_ACCOUNT_ID, conversation_id="", first_id=str(uuid4()), limit=20
    ) == MessagePage(limit=20, has_more=False, data=())
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        _message(session, conversation)
        _message(session, conversation)
    page = repository.get_page(
        installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id, first_id=None, limit=1
    )
    assert page.has_more is True
    assert len(page.data) == 1
    assert repository.get_page(
        installed_app=installation,
        account_id=_ACCOUNT_ID,
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
        SQLAlchemyInstalledAppMessageRepository(session_factory=sqlite_session_factory).get_page(
            installed_app=installation, account_id=_ACCOUNT_ID, conversation_id=conversation.id, first_id=None, limit=20
        )


def test_cursor_must_belong_to_the_requested_conversation(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        other_message = _message(session, _conversation(session, installation))
    repository = SQLAlchemyInstalledAppMessageRepository(session_factory=sqlite_session_factory)
    for cursor in (other_message.id, str(uuid4())):
        with pytest.raises(FirstMessageNotExistsError):
            repository.get_page(
                installed_app=installation,
                account_id=_ACCOUNT_ID,
                conversation_id=conversation.id,
                first_id=cursor,
                limit=20,
            )


@pytest.mark.parametrize("mismatch", ["id", "tenant_id", "app_id", "deleted_app", "deleted_installation"])
def test_read_and_feedback_revalidate_installation_after_admission(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = _conversation(session, installation)
        message = _message(session, conversation)
        if mismatch == "deleted_app":
            app = session.get(App, installation.app_id)
            assert app is not None
            session.delete(app)
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
    repository = SQLAlchemyInstalledAppMessageRepository(session_factory=sqlite_session_factory)
    with pytest.raises(InstalledAppNotFoundError):
        repository.get_page(
            installed_app=ref, account_id=_ACCOUNT_ID, conversation_id=conversation.id, first_id=None, limit=20
        )
    with pytest.raises(InstalledAppNotFoundError):
        repository.set_feedback(
            installed_app=ref, account_id=_ACCOUNT_ID, message_id=message.id, rating="like", content=None
        )


@pytest.mark.parametrize("mismatch", ["app_id", "from_account_id", "from_source", "from_end_user_id"])
def test_feedback_checks_each_message_ownership_predicate(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef, mismatch: str
) -> None:
    with sqlite_session_factory.begin() as session:
        message = _message(session, _conversation(session, installation))
        value = ConversationFromSource.API if mismatch == "from_source" else str(uuid4())
        session.execute(update(Message).where(Message.id == message.id).values({mismatch: value}))
    repository = SQLAlchemyInstalledAppMessageRepository(session_factory=sqlite_session_factory)
    with pytest.raises(MessageNotExistsError):
        repository.set_feedback(
            installed_app=installation, account_id=_ACCOUNT_ID, message_id=message.id, rating="like", content=None
        )
    with sqlite_session_factory() as session:
        assert session.scalars(select(MessageFeedback)).all() == []


def test_feedback_create_update_and_delete_preserve_admin_scope_and_owner_tenant(
    sqlite_session_factory: sessionmaker[Session], installation: InstalledAppRef
) -> None:
    with sqlite_session_factory.begin() as session:
        message = _message(session, _conversation(session, installation))
        user_feedback = _feedback(session, message, source=FeedbackFromSource.USER)
    repository = SQLAlchemyInstalledAppMessageRepository(session_factory=sqlite_session_factory)
    with pytest.raises(FeedbackRatingRequiredError, match=message.id):
        repository.set_feedback(
            installed_app=installation, account_id=_ACCOUNT_ID, message_id=message.id, rating=None, content=None
        )
    created = repository.set_feedback(
        installed_app=installation, account_id=_ACCOUNT_ID, message_id=message.id, rating="like", content=""
    )
    assert created is not None
    assert (
        created.tenant_id,
        created.app_id,
        created.conversation_id,
        created.message_id,
        created.account_id,
        created.rating,
        created.content,
    ) == (_OWNER_TENANT_ID, installation.app_id, message.conversation_id, message.id, _ACCOUNT_ID, "like", "")
    with sqlite_session_factory.begin() as session:
        feedback = message.admin_feedback_with_session(session=session)
        assert feedback is not None
        assert (feedback.from_source, feedback.from_account_id, feedback.from_end_user_id, feedback.content) == (
            FeedbackFromSource.ADMIN,
            _ACCOUNT_ID,
            None,
            "",
        )
        feedback.from_account_id = original_owner = str(uuid4())
        feedback_id = feedback.id
    updated = repository.set_feedback(
        installed_app=installation, account_id=_ACCOUNT_ID, message_id=message.id, rating="dislike", content=None
    )
    assert updated is not None
    assert (updated.rating, updated.content) == ("dislike", None)
    with sqlite_session_factory() as session:
        feedback = session.get(MessageFeedback, feedback_id)
        assert feedback is not None
        assert (feedback.rating, feedback.content, feedback.from_account_id) == (
            FeedbackRating.DISLIKE,
            None,
            original_owner,
        )
    assert (
        repository.set_feedback(
            installed_app=installation, account_id=_ACCOUNT_ID, message_id=message.id, rating=None, content=None
        )
        is None
    )
    with sqlite_session_factory() as session:
        remaining = session.scalars(select(MessageFeedback)).all()
        assert [feedback.id for feedback in remaining] == [user_feedback.id]
        assert (remaining[0].rating, remaining[0].content) == (FeedbackRating.LIKE, "Original")


@pytest.mark.parametrize("operation", ["create", "update", "delete"])
def test_failed_feedback_commit_rolls_back_and_preserves_original_error(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    installation: InstalledAppRef,
    operation: Literal["create", "update", "delete"],
) -> None:
    with sqlite_session_factory.begin() as session:
        message = _message(session, _conversation(session, installation))
        if operation != "create":
            _feedback(session, message, source=FeedbackFromSource.ADMIN)
    failing_factory = sessionmaker(bind=sqlite_engine)
    failure = RuntimeError("database commit unavailable")

    @event.listens_for(failing_factory, "before_commit")
    def fail_commit(session: Session) -> None:
        session.flush()
        raise failure

    rating: MessageRating | None = None if operation == "delete" else "dislike"
    with pytest.raises(RuntimeError) as error:
        SQLAlchemyInstalledAppMessageRepository(session_factory=failing_factory).set_feedback(
            installed_app=installation,
            account_id=_ACCOUNT_ID,
            message_id=message.id,
            rating=rating,
            content="Discarded",
        )
    assert error.value is failure
    with sqlite_session_factory() as session:
        feedback = message.admin_feedback_with_session(session=session)
        if operation == "create":
            assert feedback is None
        else:
            assert feedback is not None
            assert (feedback.rating, feedback.content) == (FeedbackRating.LIKE, "Original")
