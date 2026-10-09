"""Web more-like-this through real JWT, services, generator, and SQLite.

Persisted invalid provider metadata triggers model preparation failure without a
model server. Successful generation belongs to runtime integration coverage.
"""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from decimal import Decimal
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Flask
from redis import Redis
from sqlalchemy import Connection, Engine, delete, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.web.message as module
from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from libs.external_api import ExternalApi
from libs.passport import PassportService
from models.enums import ConversationFromSource, CustomizeTokenStrategy
from models.model import App, AppMode, AppModelConfig, Conversation, EndUser, Message, Site
from models.provider import Provider
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message


@dataclass(frozen=True)
class _Harness:
    app: Flask
    target: App
    end_user: EndUser
    message: Message
    current_config: AppModelConfig
    historical_config: AppModelConfig
    factory: sessionmaker[Session]
    sessions: list[Session]
    query_sessions: list[Session]
    passport: str

    @property
    def headers(self) -> dict[str, str]:
        return {HEADER_NAME_APP_CODE: "more-like-this-app", HEADER_NAME_PASSPORT: self.passport}

    def url(self, *, query: str = "response_mode=blocking") -> str:
        return f"/messages/{self.message.id}/more-like-this?{query}"

    def get(self, *, query: str = "response_mode=blocking") -> TestResponse:
        return self.app.test_client().get(self.url(query=query), headers=self.headers)

    def assert_closed(self, *, caller: Session | None = None) -> None:
        assert self.sessions
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.sessions
            if session is not caller
        )


@pytest.fixture
def harness(
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, SECRET_KEY="more-like-this-http-test-key-at-least-32-bytes"
    )
    target = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()), mode=AppMode.COMPLETION)
    end_user = make_end_user(end_user_id=str(uuid4()), tenant_id=target.tenant_id, app_id=target.id)
    current_config = AppModelConfig(app_id=target.id, more_like_this='{"enabled":true}', pre_prompt="New prompt")
    historical_config = AppModelConfig(
        app_id=target.id,
        more_like_this='{"enabled":false}',
        pre_prompt="Historical prompt",
        model=json.dumps(
            {
                "provider": "openai",
                "name": "historical-model",
                "mode": "completion",
                "completion_params": {"temperature": 0.2},
            }
        ),
    )
    site = Site(
        app_id=target.id,
        title="Completion app",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code="more-like-this-app",
    )
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        mode=AppMode.COMPLETION,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        inputs={"topic": "Earlier topic"},
    )
    message = make_message(
        message_id=str(uuid4()),
        app_id=target.id,
        conversation_id=conversation.id,
        inputs={"topic": "Earlier topic"},
        message={},
        query="Original query",
        answer="Original answer",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    with sqlite_session_factory.begin() as session:
        # A real stored provider ID fails validation before plugin discovery.
        provider = Provider(tenant_id=target.tenant_id, provider_name="invalid/provider", is_valid=True)
        session.add_all([target, end_user, current_config, historical_config, site, conversation, message, provider])
        session.flush()
        target.app_model_config_id = current_config.id
        conversation.app_model_config_id = historical_config.id

    admission_factory = sqlite_session_factory
    query_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    sessions: list[Session] = []
    query_sessions: list[Session] = []

    def track(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    def track_query(session: Session, transaction: SessionTransaction, connection: Connection) -> None:
        query_sessions.append(session)
        track(session, transaction, connection)

    event.listen(admission_factory, "after_begin", track)
    event.listen(query_factory, "after_begin", track_query)
    passport = PassportService().issue({"app_code": site.code, "app_id": target.id, "end_user_id": end_user.id})
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    event.listen(db.session.session_factory, "after_begin", track)
    redis_client = Redis()
    redis = RedisClientWrapper()
    redis.initialize(redis_client)
    app.extensions["application_services"] = build_application_services(
        database_client=query_factory,
        deployment_edition=DeploymentEdition.COMMUNITY,
        initialization_password="",
        redis=redis,
    )
    api = ExternalApi(app)
    api.add_resource(module.MessageMoreLikeThisApi, "/messages/<uuid:message_id>/more-like-this")
    yield _Harness(
        app,
        target,
        end_user,
        message,
        current_config,
        historical_config,
        sqlite_session_factory,
        sessions,
        query_sessions,
        passport,
    )
    event.remove(admission_factory, "after_begin", track)
    event.remove(query_factory, "after_begin", track_query)
    event.remove(db.session.session_factory, "after_begin", track)
    redis_client.close()
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("response_mode", ["blocking", "streaming"])
def test_stored_provider_error_propagates_through_the_real_generator(harness: _Harness, response_mode: str) -> None:
    response = harness.get(query=f"response_mode={response_mode}")
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json() == {
        "code": "invalid_param",
        "message": "Invalid plugin id invalid/provider",
        "status": HTTPStatus.BAD_REQUEST,
    }
    assert response.headers["Content-Type"] == "application/json"
    with harness.factory() as session:
        persisted = session.get(AppModelConfig, harness.historical_config.id)
        assert persisted is not None
        assert persisted.model_dict["completion_params"]["temperature"] == 0.2
    harness.assert_closed()


def test_real_preparation_failure_preserves_caller_session_and_pending_edits(harness: _Harness) -> None:
    with harness.app.app_context():
        caller = db.session()
        app_model = caller.get(App, harness.target.id)
        assert app_model is not None
        app_model.name = "Uncommitted caller change"
        response = harness.get()
        assert response.status_code == HTTPStatus.BAD_REQUEST
        assert response.get_json()["message"] == "Invalid plugin id invalid/provider"
        assert db.session() is caller
        assert caller.in_transaction()
        assert app_model in caller.dirty
        harness.assert_closed(caller=caller)
    with harness.factory() as session:
        persisted = session.get(App, harness.target.id)
        assert persisted is not None
        assert persisted.name == harness.target.name


@pytest.mark.parametrize("query", ["", "response_mode=invalid"])
def test_invalid_response_mode_is_rejected_before_source_queries(harness: _Harness, query: str) -> None:
    response = harness.get(query=query)
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    assert harness.query_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT, AppMode.WORKFLOW])
def test_non_completion_app_is_rejected_before_source_queries(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    response = harness.get()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_completion_app"
    assert harness.query_sessions == []


@pytest.mark.parametrize("feature", [None, "", "{}", '{"enabled":false}'])
def test_disabled_current_feature_wins_over_corrupt_historical_configuration(
    harness: _Harness, feature: str | None
) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig).where(AppModelConfig.id == harness.current_config.id).values(more_like_this=feature)
        )
        session.execute(
            update(AppModelConfig).where(AppModelConfig.id == harness.historical_config.id).values(model="broken-json")
        )
    response = harness.get()
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "app_more_like_this_disabled"
    harness.assert_closed()


@pytest.mark.parametrize(
    ("current", "field", "value"),
    [
        (True, "more_like_this", '{"secret":"private-config-value"'),
        (True, "more_like_this", '["private-config-value"]'),
        (False, "model", '{"secret":"private-config-value"'),
        (False, "model", '["private-config-value"]'),
        (False, "model", '{"completion_params":["private-config-value"]}'),
        (False, "model", None),
    ],
    ids=["feature-json", "feature-shape", "model-json", "model-shape", "parameter-shape", "missing-model"],
)
def test_corrupt_persisted_configuration_returns_app_unavailable(
    harness: _Harness, current: bool, field: str, value: str | None
) -> None:
    """None represents a missing model payload in an existing configuration row."""
    config_id = harness.current_config.id if current else harness.historical_config.id
    with harness.factory.begin() as session:
        session.execute(update(AppModelConfig).where(AppModelConfig.id == config_id).values({field: value}))

    response = harness.get()

    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json() == {
        "code": "app_unavailable",
        "message": "App unavailable, please check your app configurations.",
        "status": HTTPStatus.BAD_REQUEST,
    }
    assert b"private-config-value" not in response.data
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "from_end_user_id", "from_account_id", "from_source"])
def test_message_ownership_is_enforced_through_http(harness: _Harness, field: str) -> None:
    value = ConversationFromSource.CONSOLE if field == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == harness.message.id).values({field: value}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "not_found"
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "tenant_id"])
def test_foreign_end_user_is_rejected_after_jwt_admission(harness: _Harness, field: str) -> None:
    with harness.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == harness.end_user.id).values({field: str(uuid4())}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "not_found"
    assert "End user" in response.get_json()["message"]
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "from_end_user_id", "from_account_id", "from_source"])
def test_foreign_conversation_cannot_supply_historical_config(harness: _Harness, field: str) -> None:
    value = ConversationFromSource.CONSOLE if field == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(
            update(Conversation).where(Conversation.id == harness.message.conversation_id).values({field: value})
        )
    response = harness.get()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "app_unavailable"
    harness.assert_closed()


@pytest.mark.parametrize("resource", ["conversation", "historical_config", "foreign_config"])
def test_missing_or_foreign_history_is_app_unavailable(harness: _Harness, resource: str) -> None:
    with harness.factory.begin() as session:
        if resource == "conversation":
            session.execute(delete(Conversation).where(Conversation.id == harness.message.conversation_id))
        elif resource == "historical_config":
            session.execute(delete(AppModelConfig).where(AppModelConfig.id == harness.historical_config.id))
        else:
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == harness.historical_config.id)
                .values(app_id=str(uuid4()))
            )
    response = harness.get()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "app_unavailable"
    harness.assert_closed()


def test_incomplete_historical_model_reaches_generic_error_without_exposing_configuration(
    harness: _Harness, caplog: pytest.LogCaptureFixture
) -> None:
    # The persisted model is an object, but it lacks the provider field required
    # by the real completion configuration converter.
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.historical_config.id)
            .values(model=json.dumps({"name": "private-model-name", "completion_params": {}}))
        )
    response = harness.get()
    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    assert response.get_json()["code"] == "internal_server_error"
    assert b"private-model-name" not in response.data
    failures = [
        record.exc_info[1]
        for record in caplog.records
        if record.name == "controllers.web.message" and record.exc_info is not None
    ]
    assert len(failures) == 1
    assert isinstance(failures[0], KeyError)
    assert failures[0].args == ("provider",)
    harness.assert_closed()
