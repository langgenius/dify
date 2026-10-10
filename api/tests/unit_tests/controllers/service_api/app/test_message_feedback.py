"""Feedback endpoints through real API token admission, repositories, and SQLite."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Flask
from flask_login import LoginManager
from redis import Redis
from sqlalchemy import Connection, Engine, delete, event, select, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants.resource_access_token import ResourceAccessTokenResourceType
from controllers.service_api.app.message import AppGetFeedbacksApi, MessageFeedbackApi
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from libs.external_api import ExternalApi
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.enums import ConversationFromSource, EndUserType, FeedbackFromSource, FeedbackRating
from models.model import ApiToken, App, EndUser, Message, MessageFeedback
from models.resource_access_token import ResourceAccessToken
from services.auth.resource_access_token_contracts import ResourceAccessTokenCreateResult, ResourceAccessTokenResource
from services.resource_access_token_service import ResourceAccessTokenService
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message


@dataclass(frozen=True)
class _Harness:
    app: Flask
    target: App
    tenant: Tenant
    owner: Account
    end_user: EndUser
    message: Message
    factory: sessionmaker[Session]
    sessions: list[Session]
    resource_access_tokens: ResourceAccessTokenService
    end_user_queries: list[str]

    def post(
        self,
        payload: dict[str, object],
        *,
        user: str | None = "alice",
        message_id: str | None = None,
        authorization: str | None = "Bearer feedback-test-token",
    ) -> TestResponse:
        body = dict(payload)
        if user is not None:
            body["user"] = user
        headers: dict[str, str] = {"Authorization": authorization} if authorization is not None else {}
        return self.app.test_client().post(
            f"/messages/{message_id or self.message.id}/feedbacks", json=body, headers=headers
        )

    def get(
        self,
        query: str = "",
        *,
        authorization: str = "Bearer feedback-test-token",
        requested_app_id: str | None = None,
    ) -> TestResponse:
        headers = {"Authorization": authorization}
        if requested_app_id is not None:
            headers["X-Dify-App-ID"] = requested_app_id
        return self.app.test_client().get(f"/app/feedbacks{query}", headers=headers)

    def create_resource_token(self, *app_ids: str) -> ResourceAccessTokenCreateResult:
        return self.resource_access_tokens.create(
            RequestContext(
                request_id="feedback-resource-token-test",
                trace_id=None,
                account_id=self.owner.id,
                active_workspace_id=self.tenant.id,
            ),
            name="Feedback integration",
            resources=tuple(
                ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app_id) for app_id in app_ids
            ),
        )

    def feedbacks(self) -> list[MessageFeedback]:
        with self.factory() as session:
            return list(session.scalars(select(MessageFeedback)).all())

    def assert_closed(self) -> None:
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    tenant = Tenant(name="API feedback workspace")
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id)
    owner = Account(name="Owner", email=f"owner-{tenant.id}@example.com")
    membership = TenantAccountJoin(tenant_id=tenant.id, account_id=owner.id, role=TenantAccountRole.OWNER)
    end_user = make_end_user(
        end_user_id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=target.id,
        end_user_type=EndUserType.SERVICE_API,
        session_id="alice",
        external_user_id="alice",
    )
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
    token = ApiToken(app_id=target.id, tenant_id=tenant.id, type="app", token="feedback-test-token")
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, owner, membership, target, end_user, conversation, message, token])
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    LoginManager(app)
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    sessions: list[Session] = []
    end_user_queries: list[str] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        assert all(not previous.in_transaction() for previous in sessions if previous is not session)
        sessions.append(session)

    def track_end_user_queries(_connection: Connection, _cursor: object, statement: str, *_args: object) -> None:
        if "end_users" in statement:
            end_user_queries.append(statement)

    event.listen(sqlite_session_factory, "after_begin", track)
    event.listen(factory, "after_begin", track)
    event.listen(db.session.session_factory, "after_begin", track)
    event.listen(sqlite_engine, "before_cursor_execute", track_end_user_queries)
    redis_client = Redis()
    redis = RedisClientWrapper()
    redis.initialize(redis_client)
    services = build_application_services(
        database_client=factory, deployment_edition=DeploymentEdition.COMMUNITY, initialization_password="", redis=redis
    )
    app.extensions["application_services"] = services
    api = ExternalApi(app)
    api.add_resource(MessageFeedbackApi, "/messages/<uuid:message_id>/feedbacks")
    api.add_resource(AppGetFeedbacksApi, "/app/feedbacks")
    yield _Harness(
        app,
        target,
        tenant,
        owner,
        end_user,
        message,
        sqlite_session_factory,
        sessions,
        services.resource_access_tokens,
        end_user_queries,
    )
    event.remove(sqlite_session_factory, "after_begin", track)
    event.remove(factory, "after_begin", track)
    event.remove(db.session.session_factory, "after_begin", track)
    event.remove(sqlite_engine, "before_cursor_execute", track_end_user_queries)
    redis_client.close()
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def test_feedback_create_update_and_revoke(harness: _Harness) -> None:
    created = harness.post({"rating": "like", "content": "useful"})
    assert created.status_code == HTTPStatus.OK
    assert created.get_json() == {"result": "success"}
    assert created.headers["Content-Type"] == "application/json"
    [feedback] = harness.feedbacks()
    original_id = feedback.id
    assert feedback.from_source == FeedbackFromSource.USER
    assert feedback.from_end_user_id == harness.end_user.id
    assert feedback.from_account_id is None
    assert feedback.app_id == harness.target.id
    assert feedback.message_id == harness.message.id
    assert feedback.conversation_id == harness.message.conversation_id
    assert feedback.rating == FeedbackRating.LIKE
    assert feedback.content == "useful"
    updated = harness.post({"rating": "dislike", "content": None})
    assert updated.status_code == HTTPStatus.OK
    [feedback] = harness.feedbacks()
    assert feedback.id == original_id
    assert feedback.rating == FeedbackRating.DISLIKE
    assert feedback.content is None
    assert harness.post({"rating": None}).get_json() == {"result": "success"}
    assert harness.feedbacks() == []
    harness.assert_closed()


@pytest.mark.parametrize("rating", [None, "like"])
def test_other_end_user_cannot_change_the_message_feedback(harness: _Harness, rating: str | None) -> None:
    assert harness.post({"rating": "like"}).status_code == HTTPStatus.OK
    response = harness.post({"rating": rating}, user="other-user")
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "not_found"
    [feedback] = harness.feedbacks()
    assert feedback.from_end_user_id == harness.end_user.id
    assert feedback.rating == FeedbackRating.LIKE
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "from_source", "from_account_id"])
def test_foreign_app_or_console_message_is_not_accessible(harness: _Harness, field: str) -> None:
    value = ConversationFromSource.CONSOLE if field == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == harness.message.id).values({field: value}))
    response = harness.post({"rating": "like"})
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "not_found"
    assert harness.feedbacks() == []


def test_revoke_without_existing_feedback_has_precise_error(harness: _Harness) -> None:
    response = harness.post({"rating": None})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "message_feedback_rating_required"
    assert harness.feedbacks() == []
    harness.assert_closed()


@pytest.mark.parametrize("user", [None, ""])
def test_missing_user_does_not_write_feedback(harness: _Harness, user: str | None) -> None:
    response = harness.post({"rating": "like"}, user=user)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["message"] == "Arg user must be provided."
    assert harness.feedbacks() == []


@pytest.mark.parametrize("authorization", [None, "Basic feedback-test-token"])
def test_invalid_authorization_is_rejected(harness: _Harness, authorization: str | None) -> None:
    response = harness.post({"rating": "like"}, authorization=authorization)
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert harness.sessions == []


def test_invalid_rating_is_rejected(harness: _Harness) -> None:
    response = harness.post({"rating": "neutral"})
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    assert harness.feedbacks() == []


def test_feedback_list_preserves_shape_nulls_timestamp_format_and_stable_order(harness: _Harness) -> None:
    timestamp = datetime(2024, 1, 2, 3, 4, 5)
    records = [
        MessageFeedback(
            app_id=harness.target.id,
            conversation_id=harness.message.conversation_id,
            message_id=harness.message.id,
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.USER,
            from_end_user_id=harness.end_user.id,
        ),
        MessageFeedback(
            app_id=harness.target.id,
            conversation_id=harness.message.conversation_id,
            message_id=harness.message.id,
            rating=FeedbackRating.DISLIKE,
            content="admin comment",
            from_source=FeedbackFromSource.ADMIN,
            from_account_id=harness.owner.id,
        ),
        MessageFeedback(
            app_id=str(uuid4()),
            conversation_id=str(uuid4()),
            message_id=str(uuid4()),
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.USER,
            from_end_user_id=str(uuid4()),
        ),
    ]
    for index, record in enumerate(records, start=1):
        record.id = f"00000000-0000-0000-0000-{index:012d}"
        record.created_at = timestamp
        record.updated_at = timestamp
    with harness.factory.begin() as session:
        session.add_all(records)
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": [records[1].to_dict(), records[0].to_dict()]}
    assert response.headers["Content-Type"] == "application/json"
    assert harness.get("?page=2&limit=1").get_json() == {"data": [records[0].to_dict()]}
    assert harness.get("?page=3&limit=1").get_json() == {"data": []}
    harness.assert_closed()


@pytest.mark.parametrize("query", ["?page=0", "?limit=0", "?limit=102"])
def test_list_rejects_invalid_page_or_limit(harness: _Harness, query: str) -> None:
    response = harness.get(query)
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    harness.assert_closed()


@pytest.mark.parametrize("missing", ["membership", "account"])
def test_app_only_list_still_requires_workspace_owner(harness: _Harness, missing: str) -> None:
    with harness.factory.begin() as session:
        if missing == "membership":
            session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == harness.tenant.id))
        else:
            session.execute(delete(Account).where(Account.id == harness.owner.id))
    response = harness.get()
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.get_json()["message"] == "Tenant owner account not found or tenant is not active."
    harness.assert_closed()


@pytest.mark.parametrize("role", [TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_app_only_list_rejects_non_owner_membership(harness: _Harness, role: TenantAccountRole) -> None:
    with harness.factory.begin() as session:
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == harness.tenant.id,
                TenantAccountJoin.account_id == harness.owner.id,
            )
        )
        assert membership is not None
        membership.role = role

    response = harness.get()
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.get_json()["message"] == "Tenant owner account not found or tenant is not active."
    harness.assert_closed()


@pytest.mark.parametrize("endpoint", ["write", "list"])
def test_archived_workspace_is_rejected(harness: _Harness, endpoint: str) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Tenant).where(Tenant.id == harness.tenant.id).values(status=TenantStatus.ARCHIVE))
    response = harness.post({"rating": "like"}) if endpoint == "write" else harness.get()
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "workspace_archived"
    assert harness.feedbacks() == []
    harness.assert_closed()


def test_empty_feedback_list_keeps_data_array(harness: _Harness) -> None:
    response = harness.get("?limit=101")
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": []}
    harness.assert_closed()


def test_resource_token_can_create_and_list_feedback_without_provisioning_on_get(harness: _Harness) -> None:
    token = harness.create_resource_token(harness.target.id)
    authorization = f"Bearer {token.token}"

    response = harness.post({"rating": "like", "content": "resource token feedback"}, authorization=authorization)

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    [feedback] = harness.feedbacks()
    assert feedback.from_end_user_id == harness.end_user.id
    assert feedback.content == "resource token feedback"
    assert harness.end_user_queries
    harness.end_user_queries.clear()

    response = harness.get("?user=must-not-be-provisioned", authorization=authorization)

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": [feedback.to_dict()]}
    assert harness.end_user_queries == []
    with harness.factory() as session:
        assert session.scalars(select(EndUser.id)).all() == [harness.end_user.id]
        stored_token = session.get(ResourceAccessToken, token.token_id)
        assert stored_token is not None
        assert stored_token.last_used_at is not None
    harness.assert_closed()


@pytest.mark.parametrize("select_other_app", [False, True], ids=["first-app", "second-app"])
def test_multiple_app_resource_token_lists_only_header_selected_app(harness: _Harness, select_other_app: bool) -> None:
    other = make_app(app_id=str(uuid4()), tenant_id=harness.tenant.id)
    records = [
        MessageFeedback(
            app_id=app_id,
            conversation_id=str(uuid4()),
            message_id=str(uuid4()),
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.ADMIN,
            from_account_id=harness.owner.id,
            content=app_id,
        )
        for app_id in (harness.target.id, other.id)
    ]
    with harness.factory.begin() as session:
        session.add_all([other, *records])
    token = harness.create_resource_token(harness.target.id, other.id)
    selected = records[1 if select_other_app else 0]

    response = harness.get(
        "?user=must-not-be-provisioned",
        authorization=f"Bearer {token.token}",
        requested_app_id=selected.app_id,
    )

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": [selected.to_dict()]}
    assert harness.end_user_queries == []
    with harness.factory() as session:
        stored_token = session.get(ResourceAccessToken, token.token_id)
        assert stored_token is not None
        assert stored_token.last_used_at is not None
    harness.assert_closed()


def test_multiple_app_resource_token_list_requires_app_header(harness: _Harness) -> None:
    other = make_app(app_id=str(uuid4()), tenant_id=harness.tenant.id)
    with harness.factory.begin() as session:
        session.add(other)
    token = harness.create_resource_token(harness.target.id, other.id)

    response = harness.get("?user=must-not-be-provisioned", authorization=f"Bearer {token.token}")

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json() == {
        "code": "bad_request",
        "message": "App ID is required when a resource access token is bound to multiple apps.",
        "status": 400,
    }
    assert harness.end_user_queries == []
    with harness.factory() as session:
        stored_token = session.get(ResourceAccessToken, token.token_id)
        assert stored_token is not None
        assert stored_token.last_used_at is None
    harness.assert_closed()


@pytest.mark.parametrize("missing", ["membership", "account"])
def test_resource_token_requires_owner_for_list_but_not_feedback_write(harness: _Harness, missing: str) -> None:
    token = harness.create_resource_token(harness.target.id)
    authorization = f"Bearer {token.token}"
    with harness.factory.begin() as session:
        if missing == "membership":
            session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == harness.tenant.id))
        else:
            session.execute(delete(Account).where(Account.id == harness.owner.id))

    response = harness.get("?user=must-not-be-provisioned", authorization=authorization)

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.get_json()["message"] == "Tenant owner account not found or tenant is not active."
    assert harness.end_user_queries == []
    assert harness.feedbacks() == []
    harness.assert_closed()

    response = harness.post({"rating": "like"}, authorization=authorization)

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    [feedback] = harness.feedbacks()
    assert feedback.from_end_user_id == harness.end_user.id
    assert harness.end_user_queries
    harness.assert_closed()
