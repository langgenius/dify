"""Web feedback through real passport admission, services, and SQLite writes."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from decimal import Decimal
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy import Connection, Engine, event, select, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from controllers.web.message import MessageFeedbackApi, MessageListApi
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from libs.external_api import ExternalApi
from libs.passport import PassportService
from models.enums import ConversationFromSource, CustomizeTokenStrategy, FeedbackFromSource, FeedbackRating
from models.model import App, EndUser, Message, MessageFeedback, Site
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message


@dataclass(frozen=True)
class _Harness:
    app: Flask
    target: App
    end_user: EndUser
    message: Message
    factory: sessionmaker[Session]
    sessions: list[Session]
    headers: dict[str, str]

    def post(self, payload: dict[str, object], *, message_id: str | None = None) -> TestResponse:
        return self.app.test_client().post(
            f"/messages/{message_id or self.message.id}/feedbacks", json=payload, headers=self.headers
        )

    def feedbacks(self) -> list[MessageFeedback]:
        with self.factory() as session:
            return list(session.scalars(select(MessageFeedback)).all())

    def assert_closed(self) -> None:
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)


@pytest.fixture
def harness(
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, SECRET_KEY="feedback-passport-test-key-32-bytes")
    target = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    end_user = make_end_user(end_user_id=str(uuid4()), tenant_id=target.tenant_id, app_id=target.id)
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        inputs={},
        app_id=target.id,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    message = make_message(
        message_id=str(uuid4()),
        inputs={},
        message={},
        query="question",
        answer="answer",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        app_id=target.id,
        conversation_id=conversation.id,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    site = Site(
        app_id=target.id,
        title="Feedback app",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code="feedback-app",
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([target, end_user, conversation, message, site])
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    sessions: list[Session] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        assert all(not previous.in_transaction() for previous in sessions if previous is not session)
        sessions.append(session)

    event.listen(sqlite_session_factory, "after_begin", track)
    event.listen(factory, "after_begin", track)
    event.listen(db.session.session_factory, "after_begin", track)
    redis_client = Redis()
    redis = RedisClientWrapper()
    redis.initialize(redis_client)
    app.extensions["application_services"] = build_application_services(
        database_client=factory, deployment_edition=DeploymentEdition.COMMUNITY, initialization_password="", redis=redis
    )
    api = ExternalApi(app)
    api.add_resource(MessageFeedbackApi, "/messages/<uuid:message_id>/feedbacks")
    api.add_resource(MessageListApi, "/messages")
    passport = PassportService().issue({"app_code": site.code, "app_id": target.id, "end_user_id": end_user.id})
    yield _Harness(
        app,
        target,
        end_user,
        message,
        sqlite_session_factory,
        sessions,
        {HEADER_NAME_APP_CODE: "feedback-app", HEADER_NAME_PASSPORT: passport},
    )
    event.remove(sqlite_session_factory, "after_begin", track)
    event.remove(factory, "after_begin", track)
    event.remove(db.session.session_factory, "after_begin", track)
    redis_client.close()
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def test_create_update_and_revoke_user_feedback(harness: _Harness) -> None:
    created = harness.post({"rating": "like", "content": "有帮助"})
    assert created.status_code == HTTPStatus.OK
    assert created.get_json() == {"result": "success"}
    assert created.headers["Content-Type"] == "application/json"
    [feedback] = harness.feedbacks()
    assert feedback.app_id == harness.target.id
    assert feedback.conversation_id == harness.message.conversation_id
    assert feedback.message_id == harness.message.id
    assert feedback.from_end_user_id == harness.end_user.id
    assert feedback.from_account_id is None
    assert feedback.from_source == FeedbackFromSource.USER
    assert feedback.rating == FeedbackRating.LIKE
    assert feedback.content == "有帮助"
    feedback_id = feedback.id

    updated = harness.post({"rating": "dislike", "content": ""})
    assert updated.status_code == HTTPStatus.OK
    [feedback] = harness.feedbacks()
    assert feedback.id == feedback_id
    assert feedback.rating == FeedbackRating.DISLIKE
    assert feedback.content == ""

    revoked = harness.post({"rating": None})
    assert revoked.status_code == HTTPStatus.OK
    assert revoked.get_json() == {"result": "success"}
    assert harness.feedbacks() == []
    harness.assert_closed()


@pytest.mark.parametrize("payload", [{}, {"rating": None, "content": "comment only"}])
def test_revoke_without_feedback_has_specific_error(harness: _Harness, payload: dict[str, object]) -> None:
    response = harness.post(payload)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "message_feedback_rating_required"
    assert harness.feedbacks() == []
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "from_end_user_id", "from_account_id", "from_source"])
def test_message_ownership_is_enforced(harness: _Harness, field: str) -> None:
    value = ConversationFromSource.CONSOLE if field == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == harness.message.id).values({field: value}))
    response = harness.post({"rating": "like"})
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "not_found"
    assert harness.feedbacks() == []
    harness.assert_closed()


def test_missing_message_returns_not_found(harness: _Harness) -> None:
    response = harness.post({"rating": "like"}, message_id=str(uuid4()))
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == "Message Not Exists."
    harness.assert_closed()


def test_corrupt_end_user_app_scope_cannot_write_feedback(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == harness.end_user.id).values(app_id=str(uuid4())))
    response = harness.post({"rating": "like"})
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == "End user not found"
    assert harness.feedbacks() == []


def test_invalid_rating_is_rejected_without_persistence(harness: _Harness) -> None:
    response = harness.post({"rating": "neutral"})
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    assert harness.feedbacks() == []


def test_revoking_user_feedback_preserves_admin_feedback(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.add(
            MessageFeedback(
                app_id=harness.target.id,
                conversation_id=harness.message.conversation_id,
                message_id=harness.message.id,
                rating=FeedbackRating.LIKE,
                from_source=FeedbackFromSource.ADMIN,
                from_account_id=str(uuid4()),
            )
        )
    assert harness.post({"rating": "dislike"}).status_code == HTTPStatus.OK
    assert harness.post({"rating": None}).status_code == HTTPStatus.OK
    [remaining] = harness.feedbacks()
    assert remaining.from_source == FeedbackFromSource.ADMIN
