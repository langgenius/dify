"""Exercise feedback policy, persistence, and telemetry through real dependencies."""

import json
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from celery import Celery
from celery import current_app as current_celery_app
from celery.signals import before_task_publish
from sqlalchemy import Connection, Engine, event, func, inspect, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from enums import DeploymentEdition
from models import Account, App, AppMode, Conversation, EndUser, Message
from models.enums import ConversationFromSource, EndUserType, FeedbackFromSource, FeedbackRating
from models.model import InstalledApp, MessageFeedback
from repositories.message_repository import MessageRepository
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.entities.message_entities import MessageAccount, MessageActor, MessageEndUser
from services.errors.message import FeedbackRatingRequiredError, MessageActorNotFoundError, MessageNotExistsError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.message_feedback_service import MessageFeedbackService


@dataclass
class _Harness:
    service: MessageFeedbackService
    app: App
    account: Account
    end_user: EndUser
    actor: MessageActor
    message: Message
    factory: sessionmaker[Session]
    sessions: list[Session]
    committed_sessions: list[Session]

    def set_feedback(self, *, rating: FeedbackRating | None, content: str | None = None) -> None:
        self.service.set_feedback(
            app_id=self.app.id,
            app_owner_tenant_id=self.app.tenant_id,
            actor=self.actor,
            message_id=self.message.id,
            rating=rating,
            content=content,
        )

    def assert_closed(self) -> None:
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)


def _message(session: Session, *, app: App, actor: MessageActor) -> Message:
    account_id = actor.account_id if isinstance(actor, MessageAccount) else None
    end_user_id = actor.end_user_id if isinstance(actor, MessageEndUser) else None
    source = ConversationFromSource.CONSOLE if isinstance(actor, MessageAccount) else ConversationFromSource.API
    conversation = Conversation(
        app_id=app.id,
        mode=AppMode.CHAT,
        name="Feedback conversation",
        inputs={},
        from_source=source,
        from_account_id=account_id,
        from_end_user_id=end_user_id,
    )
    session.add(conversation)
    session.flush()
    message = Message(
        app_id=app.id,
        conversation_id=conversation.id,
        inputs={},
        query="Question",
        answer="Answer",
        message={},
        message_unit_price=0,
        answer_unit_price=0,
        currency="USD",
        from_source=source,
        from_account_id=account_id,
        from_end_user_id=end_user_id,
    )
    session.add(message)
    session.flush()
    return message


@pytest.fixture(params=["account", "end_user"])
def harness(
    request: pytest.FixtureRequest,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> _Harness:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, ENTERPRISE_TELEMETRY_ENABLED=False)
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Chat", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        account = Account(name="Reviewer", email="reviewer@example.com")
        session.add_all([app, account])
        session.flush()
        end_user = EndUser(
            tenant_id=app.tenant_id, app_id=app.id, type=EndUserType.SERVICE_API, session_id=str(uuid4())
        )
        session.add(end_user)
        session.flush()
        actor: MessageActor = (
            MessageAccount(account_id=account.id)
            if request.param == "account"
            else MessageEndUser(end_user_id=end_user.id)
        )
        message = _message(session, app=app, actor=actor)

    sessions: list[Session] = []
    committed_sessions: list[Session] = []
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    @event.listens_for(factory, "after_begin")
    def record_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    @event.listens_for(factory, "after_commit")
    def record_commit(session: Session) -> None:
        committed_sessions.append(session)

    return _Harness(
        service=MessageFeedbackService(
            repository=MessageRepository(
                session_factory=factory, extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=factory)
            )
        ),
        app=app,
        account=account,
        end_user=end_user,
        actor=actor,
        message=message,
        factory=sqlite_session_factory,
        sessions=sessions,
        committed_sessions=committed_sessions,
    )


def _feedback(harness: _Harness) -> MessageFeedback | None:
    with harness.factory() as session:
        return session.scalar(select(MessageFeedback).where(MessageFeedback.message_id == harness.message.id))


def test_create_update_and_revoke_feedback_preserve_identity_and_optional_content(harness: _Harness) -> None:
    harness.set_feedback(rating=FeedbackRating.LIKE, content="")
    first = _feedback(harness)
    assert first is not None
    assert first.app_id == harness.app.id
    assert first.conversation_id == harness.message.conversation_id
    assert first.rating == FeedbackRating.LIKE
    assert first.content == ""
    assert first.from_source == (
        FeedbackFromSource.ADMIN if isinstance(harness.actor, MessageAccount) else FeedbackFromSource.USER
    )
    assert first.from_account_id == (harness.account.id if isinstance(harness.actor, MessageAccount) else None)
    assert first.from_end_user_id == (harness.end_user.id if isinstance(harness.actor, MessageEndUser) else None)

    harness.set_feedback(rating=FeedbackRating.DISLIKE, content=None)
    updated = _feedback(harness)
    assert updated is not None
    assert (updated.id, updated.rating, updated.content) == (first.id, FeedbackRating.DISLIKE, None)
    assert updated.created_at == first.created_at

    harness.set_feedback(rating=None, content="Ignored when revoking")
    assert _feedback(harness) is None
    assert len(harness.committed_sessions) == 3
    harness.assert_closed()


def test_revocation_without_feedback_has_specific_error_and_does_not_commit(harness: _Harness) -> None:
    with pytest.raises(FeedbackRatingRequiredError):
        harness.set_feedback(rating=None)
    assert _feedback(harness) is None
    assert harness.committed_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "from_account_id", "from_end_user_id", "from_source"])
def test_owned_feedback_checks_every_message_owner_predicate(harness: _Harness, field: str) -> None:
    value = str(uuid4())
    if field == "from_source":
        value = (
            ConversationFromSource.API if isinstance(harness.actor, MessageAccount) else ConversationFromSource.CONSOLE
        )
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == harness.message.id).values({field: value}))
    with pytest.raises(MessageNotExistsError):
        harness.set_feedback(rating=FeedbackRating.LIKE)
    assert _feedback(harness) is None
    assert harness.committed_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize("missing", ["app", "actor", "message"])
def test_feedback_revalidates_resources_after_admission(harness: _Harness, missing: str) -> None:
    with harness.factory.begin() as session:
        if missing == "app":
            record = session.get(App, harness.app.id)
        elif missing == "message":
            record = session.get(Message, harness.message.id)
        elif isinstance(harness.actor, MessageAccount):
            record = session.get(Account, harness.account.id)
        else:
            record = session.get(EndUser, harness.end_user.id)
        assert record is not None
        session.delete(record)
    error = {
        "app": AppDefinitionUnavailableError,
        "actor": MessageActorNotFoundError,
        "message": MessageNotExistsError,
    }[missing]
    with pytest.raises(error):
        harness.set_feedback(rating=FeedbackRating.LIKE)
    assert harness.committed_sessions == []
    harness.assert_closed()


def test_feedback_rejects_an_app_from_another_tenant(harness: _Harness) -> None:
    with pytest.raises(AppDefinitionUnavailableError):
        harness.service.set_feedback(
            app_id=harness.app.id,
            app_owner_tenant_id=str(uuid4()),
            actor=harness.actor,
            message_id=harness.message.id,
            rating=FeedbackRating.LIKE,
            content=None,
        )
    assert _feedback(harness) is None
    assert harness.committed_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "tenant_id"])
def test_end_user_must_belong_to_both_app_and_owner_tenant(harness: _Harness, field: str) -> None:
    with harness.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == harness.end_user.id).values({field: str(uuid4())}))
    with pytest.raises(MessageActorNotFoundError):
        harness.service.set_feedback(
            app_id=harness.app.id,
            app_owner_tenant_id=harness.app.tenant_id,
            actor=MessageEndUser(end_user_id=harness.end_user.id),
            message_id=harness.message.id,
            rating=FeedbackRating.LIKE,
            content=None,
        )
    assert harness.committed_sessions == []


def test_admin_feedback_is_app_wide_and_preserves_the_original_reviewer(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        second_reviewer = Account(name="Another reviewer", email="second-reviewer@example.com")
        session.add(second_reviewer)
        session.flush()
    for account_id, rating in (
        (harness.account.id, FeedbackRating.LIKE),
        (second_reviewer.id, FeedbackRating.DISLIKE),
    ):
        harness.service.set_admin_feedback(
            app_id=harness.app.id,
            app_owner_tenant_id=harness.app.tenant_id,
            account_id=account_id,
            message_id=harness.message.id,
            rating=rating,
            content="Admin feedback",
        )
    feedback = _feedback(harness)
    assert feedback is not None
    assert feedback.rating == FeedbackRating.DISLIKE
    assert feedback.from_source == FeedbackFromSource.ADMIN
    assert feedback.from_account_id == harness.account.id
    assert feedback.from_end_user_id is None
    with harness.factory() as session:
        assert session.scalar(select(func.count()).select_from(MessageFeedback)) == 1
    harness.assert_closed()


def test_admin_scope_still_checks_the_message_app(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == harness.message.id).values(app_id=str(uuid4())))
    with pytest.raises(MessageNotExistsError):
        harness.service.set_admin_feedback(
            app_id=harness.app.id,
            app_owner_tenant_id=harness.app.tenant_id,
            account_id=harness.account.id,
            message_id=harness.message.id,
            rating=FeedbackRating.LIKE,
            content=None,
        )
    assert _feedback(harness) is None
    assert harness.committed_sessions == []


def test_user_and_admin_feedback_coexist_and_are_revoked_independently(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        message = _message(session, app=harness.app, actor=MessageEndUser(end_user_id=harness.end_user.id))
    for actor in (MessageEndUser(end_user_id=harness.end_user.id), MessageAccount(account_id=harness.account.id)):
        if isinstance(actor, MessageEndUser):
            harness.service.set_feedback(
                app_id=harness.app.id,
                app_owner_tenant_id=harness.app.tenant_id,
                actor=actor,
                message_id=message.id,
                rating=FeedbackRating.LIKE,
                content="End-user feedback",
            )
        else:
            harness.service.set_admin_feedback(
                app_id=harness.app.id,
                app_owner_tenant_id=harness.app.tenant_id,
                account_id=actor.account_id,
                message_id=message.id,
                rating=FeedbackRating.DISLIKE,
                content="Admin feedback",
            )
    harness.service.set_feedback(
        app_id=harness.app.id,
        app_owner_tenant_id=harness.app.tenant_id,
        actor=MessageEndUser(end_user_id=harness.end_user.id),
        message_id=message.id,
        rating=None,
        content=None,
    )
    with harness.factory() as session:
        remaining = session.scalars(select(MessageFeedback).where(MessageFeedback.message_id == message.id)).all()
    assert len(remaining) == 1
    assert (remaining[0].from_source, remaining[0].rating) == (FeedbackFromSource.ADMIN, FeedbackRating.DISLIKE)


def _installation(harness: _Harness) -> InstalledAppRef:
    with harness.factory.begin() as session:
        installed = InstalledApp(
            tenant_id=str(uuid4()),
            app_id=harness.app.id,
            app_owner_tenant_id=harness.app.tenant_id,
            position=0,
            is_pinned=False,
        )
        session.add(installed)
        session.flush()
    return InstalledAppRef(
        id=installed.id,
        tenant_id=installed.tenant_id,
        app_id=harness.app.id,
        app_owner_tenant_id=harness.app.tenant_id,
        app_mode=harness.app.mode,
    )


def test_cross_workspace_installation_uses_the_app_owner_and_does_not_change_usage(harness: _Harness) -> None:
    installation = _installation(harness)
    with harness.factory() as session:
        last_used = session.scalar(select(InstalledApp.last_used_at).where(InstalledApp.id == installation.id))
    harness.service.set_feedback(
        app_id=harness.app.id,
        app_owner_tenant_id=harness.app.tenant_id,
        actor=harness.actor,
        message_id=harness.message.id,
        rating=FeedbackRating.LIKE,
        content="Shared app",
        installed_app=installation,
    )
    assert _feedback(harness) is not None
    with harness.factory() as session:
        assert session.scalar(select(InstalledApp.last_used_at).where(InstalledApp.id == installation.id)) == last_used
    harness.assert_closed()


@pytest.mark.parametrize("mismatch", ["id", "tenant_id", "app_id", "app_owner_tenant_id", "deleted"])
def test_installed_feedback_revalidates_installation_in_the_write_transaction(harness: _Harness, mismatch: str) -> None:
    installation = _installation(harness)
    if mismatch == "deleted":
        with harness.factory.begin() as session:
            installed = session.get(InstalledApp, installation.id)
            assert installed is not None
            session.delete(installed)
    else:
        installation = replace(installation, **{mismatch: str(uuid4())})
    with pytest.raises(InstalledAppNotFoundError):
        harness.service.set_feedback(
            app_id=harness.app.id,
            app_owner_tenant_id=harness.app.tenant_id,
            actor=harness.actor,
            message_id=harness.message.id,
            rating=FeedbackRating.LIKE,
            content=None,
            installed_app=installation,
        )
    assert _feedback(harness) is None
    assert harness.committed_sessions == []
    harness.assert_closed()


def test_listing_preserves_detached_fields_tied_timestamp_order_and_pagination(harness: _Harness) -> None:
    timestamp = datetime(2026, 10, 9, 10, 30, 1, 123456)
    with harness.factory.begin() as session:
        records: list[MessageFeedback] = []
        for index in range(3):
            feedback = MessageFeedback(
                app_id=harness.app.id,
                conversation_id=harness.message.conversation_id,
                message_id=harness.message.id,
                rating=FeedbackRating.LIKE,
                content="" if index == 0 else None,
                from_source=FeedbackFromSource.ADMIN,
                from_account_id=harness.account.id,
            )
            feedback.created_at = timestamp if index < 2 else timestamp - timedelta(hours=1)
            feedback.updated_at = timestamp
            session.add(feedback)
            records.append(feedback)
        # A valid foreign-app row must not change pagination or appear in results.
        other_app = App(
            tenant_id=harness.app.tenant_id, name="Other", mode=AppMode.CHAT, enable_site=True, enable_api=True
        )
        session.add(other_app)
        session.flush()
        decoy_message = _message(session, app=other_app, actor=harness.actor)
        decoy = MessageFeedback(
            app_id=other_app.id,
            conversation_id=decoy_message.conversation_id,
            message_id=decoy_message.id,
            rating=FeedbackRating.DISLIKE,
            from_source=FeedbackFromSource.ADMIN,
            from_account_id=harness.account.id,
        )
        decoy.created_at = timestamp + timedelta(hours=1)
        session.add(decoy)
        session.flush()
        expected = [
            record.to_dict() for record in sorted(records, key=lambda row: (row.created_at, row.id), reverse=True)
        ]

    first = harness.service.get_feedbacks(
        app_id=harness.app.id, app_owner_tenant_id=harness.app.tenant_id, page=1, limit=2
    )
    last = harness.service.get_feedbacks(
        app_id=harness.app.id, app_owner_tenant_id=harness.app.tenant_id, page=2, limit=2
    )
    empty = harness.service.get_feedbacks(
        app_id=harness.app.id, app_owner_tenant_id=harness.app.tenant_id, page=3, limit=2
    )
    assert [asdict(record) for record in first + last] == expected
    assert len(first) == 2
    assert len(last) == 1
    assert empty == []
    assert first[0].created_at == "2026-10-09T10:30:01.123456"
    assert all(inspect(record, raiseerr=False) is None for record in first + last)
    assert harness.committed_sessions == []
    harness.assert_closed()


def test_listing_rejects_a_foreign_tenant_even_when_feedback_exists(harness: _Harness) -> None:
    harness.set_feedback(rating=FeedbackRating.LIKE)
    with pytest.raises(AppDefinitionUnavailableError):
        harness.service.get_feedbacks(app_id=harness.app.id, app_owner_tenant_id=str(uuid4()), page=1, limit=20)
    harness.assert_closed()


@pytest.fixture
def telemetry_broker(config_overrides: Callable[..., None]) -> Iterator[Celery]:
    """Use Celery's real in-memory transport without workers or network access."""
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE, ENTERPRISE_TELEMETRY_ENABLED=True)
    restore_app = current_celery_app.set_current
    broker = Celery("message-feedback-tests", broker="memory://")
    broker.conf.update(task_always_eager=False, task_ignore_result=True)
    try:
        yield broker
    finally:
        broker.close()
        restore_app()


def test_telemetry_is_published_after_commit_and_close_for_create_and_update_only(
    harness: _Harness, telemetry_broker: Celery
) -> None:
    assert telemetry_broker.conf.broker_url == "memory://"
    published: list[tuple[object, bool, int]] = []

    def record_publish(sender: object, body: object, **_kwargs: object) -> None:
        if sender == "tasks.enterprise_telemetry_task.process_enterprise_telemetry":
            closed = all(not session.in_transaction() and not session.identity_map for session in harness.sessions)
            published.append((body, closed, len(harness.committed_sessions)))

    before_task_publish.connect(record_publish, weak=False)
    try:
        harness.set_feedback(rating=FeedbackRating.LIKE, content="First")
        harness.set_feedback(rating=FeedbackRating.DISLIKE, content="Updated")
        harness.set_feedback(rating=None)
        harness.service.set_admin_feedback(
            app_id=harness.app.id,
            app_owner_tenant_id=harness.app.tenant_id,
            account_id=harness.account.id,
            message_id=harness.message.id,
            rating=FeedbackRating.LIKE,
            content="Admin route remains silent",
        )
    finally:
        before_task_publish.disconnect(record_publish)  # type: ignore[attr-defined]  # Missing from celery-types.

    assert len(published) == 2
    for index, (body, closed, commits) in enumerate(published):
        assert closed
        assert commits == index + 1
        assert isinstance(body, tuple)
        args = body[0]
        assert isinstance(args, tuple)
        envelope = json.loads(args[0])
        assert envelope["tenant_id"] == harness.app.tenant_id
        assert envelope["payload"] == {
            "app_id": harness.app.id,
            "conversation_id": harness.message.conversation_id,
            "message_id": harness.message.id,
            "rating": "like" if index == 0 else "dislike",
            "from_source": "admin" if isinstance(harness.actor, MessageAccount) else "user",
            "from_account_id": harness.account.id if isinstance(harness.actor, MessageAccount) else None,
            "from_end_user_id": harness.end_user.id if isinstance(harness.actor, MessageEndUser) else None,
            "content": "First" if index == 0 else "Updated",
        }
    harness.assert_closed()


def test_telemetry_transport_failure_does_not_rollback_feedback(
    harness: _Harness, telemetry_broker: Celery, caplog: pytest.LogCaptureFixture
) -> None:
    telemetry_broker.conf.broker_url = "nonexistent-feedback-test-transport://"
    harness.set_feedback(rating=FeedbackRating.LIKE, content="Persist before telemetry")
    feedback = _feedback(harness)
    assert feedback is not None
    assert feedback.content == "Persist before telemetry"
    assert len(harness.committed_sessions) == 1
    assert "telemetry" in caplog.text.lower()
    harness.assert_closed()


@pytest.mark.parametrize("operation", ["INSERT", "UPDATE", "DELETE"])
def test_failed_database_write_rolls_back_without_publishing_telemetry(
    harness: _Harness, telemetry_broker: Celery, operation: str
) -> None:
    assert telemetry_broker.conf.broker_url == "memory://"
    if operation != "INSERT":
        harness.set_feedback(rating=FeedbackRating.LIKE, content="Original")
    before = _feedback(harness)
    harness.committed_sessions.clear()
    with harness.factory.begin() as session:
        # A real database error exercises flush/rollback without replacing the
        # transaction or repository with a failing test implementation.
        session.execute(
            text(
                f"CREATE TRIGGER reject_feedback_write BEFORE {operation} ON message_feedbacks "
                "BEGIN SELECT RAISE(ABORT, 'feedback write rejected'); END"
            )
        )
    published: list[object] = []

    def record_publish(sender: object, **_kwargs: object) -> None:
        if sender == "tasks.enterprise_telemetry_task.process_enterprise_telemetry":
            published.append(sender)

    before_task_publish.connect(record_publish, weak=False)
    try:
        with pytest.raises(IntegrityError, match="feedback write rejected"):
            harness.set_feedback(rating=None if operation == "DELETE" else FeedbackRating.DISLIKE, content="Changed")
    finally:
        before_task_publish.disconnect(record_publish)  # type: ignore[attr-defined]  # Missing from celery-types.
    after = _feedback(harness)
    if before is None:
        assert after is None
    else:
        assert after is not None
        assert after.to_dict() == before.to_dict()
    assert harness.committed_sessions == []
    assert published == []
    harness.assert_closed()
