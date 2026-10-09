"""Web more-like-this HTTP contracts through real JWT, services and SQLite.

Only the generation port is controlled here: these tests cover admission,
source ownership, feature policy and HTTP response/close behavior. The concrete
model and generation pipeline has separate tests.
"""

import json
from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import JsonValue
from sqlalchemy import Connection, Engine, delete, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.web.message as module
import controllers.web.wraps as web_wraps
from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from enums import DeploymentEdition
from graphon.model_runtime.errors.invoke import InvokeError
from libs.external_api import ExternalApi
from libs.passport import PassportService
from models.enums import ConversationFromSource, CustomizeTokenStrategy
from models.model import App, AppMode, AppModelConfig, Conversation, EndUser, Message, Site
from repositories.message_repository import MessageRepository
from services.entities.message_entities import MessageActor, MessageEndUser
from services.message_more_like_this_service import (
    MessageMoreLikeThisService,
    MoreLikeThisResponse,
    MoreLikeThisSource,
)
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message

_BLOCKING: dict[str, object] = {"answer": "你好", "metadata": {}, "usage": None, "created_at": 0}
_CHUNKS = ('data: {"answer":"你好"}\n\n', "data: [DONE]\n\n")


@dataclass
class _Stream:
    remaining: Iterator[str] = field(default_factory=lambda: iter(_CHUNKS))
    close_calls: int = 0

    def __iter__(self) -> Iterator[str]:
        return self

    def __next__(self) -> str:
        return next(self.remaining)

    def close(self) -> None:
        self.close_calls += 1


@dataclass
class _Generator:
    """Observe the detached generation boundary without replacing query policy."""

    sessions: list[Session]
    calls: list[tuple[MoreLikeThisSource, MessageActor, dict[str, JsonValue], bool]] = field(default_factory=list)
    response: MoreLikeThisResponse = field(default_factory=lambda: dict(_BLOCKING))
    error: Exception | None = None

    def generate(
        self,
        *,
        source: MoreLikeThisSource,
        actor: MessageActor,
        model_config: dict[str, JsonValue],
        streaming: bool,
    ) -> MoreLikeThisResponse:
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        self.calls.append((source, actor, model_config, streaming))
        if self.error is not None:
            raise self.error
        return self.response


@dataclass(frozen=True)
class _Services:
    message_more_like_this: MessageMoreLikeThisService


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
    generator: _Generator
    passport: str

    @property
    def headers(self) -> dict[str, str]:
        return {HEADER_NAME_APP_CODE: "more-like-this-app", HEADER_NAME_PASSPORT: self.passport}

    def url(self, *, query: str = "response_mode=blocking") -> str:
        return f"/messages/{self.message.id}/more-like-this?{query}"

    def get(self, *, query: str = "response_mode=blocking") -> TestResponse:
        return self.app.test_client().get(self.url(query=query), headers=self.headers)

    def assert_closed(self) -> None:
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Generator[_Harness, None, None]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, SECRET_KEY="more-like-this-http-test-key")
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
        session.add_all([target, end_user, current_config, historical_config, site, conversation, message])
        session.flush()
        target.app_model_config_id = current_config.id
        conversation.app_model_config_id = historical_config.id

    admission_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
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
    monkeypatch.setattr(web_wraps.session_factory, "create_session", admission_factory)
    passport = PassportService().issue({"app_code": site.code, "app_id": target.id, "end_user_id": end_user.id})
    generator = _Generator(sessions=sessions)
    service = MessageMoreLikeThisService(
        repository=MessageRepository(session_factory=query_factory), generator=generator
    )
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    app.extensions["application_services"] = _Services(message_more_like_this=service)
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
        generator,
        passport,
    )
    event.remove(admission_factory, "after_begin", track)
    event.remove(query_factory, "after_begin", track_query)


def test_blocking_response_uses_historical_config_after_sessions_close(harness: _Harness) -> None:
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == _BLOCKING
    assert dict(response.headers) == {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": str(len(response.data)),
    }
    [(source, actor, config, streaming)] = harness.generator.calls
    assert source.app_id == harness.target.id
    assert source.tenant_id == harness.target.tenant_id
    assert source.query == "Original query"
    assert source.inputs == {"topic": "Earlier topic"}
    assert actor == MessageEndUser(end_user_id=harness.end_user.id)
    assert config["pre_prompt"] == "Historical prompt"
    assert config["model"] == {
        "provider": "openai",
        "name": "historical-model",
        "mode": "completion",
        "completion_params": {"temperature": 0.9},
    }
    assert streaming is False
    with harness.factory() as session:
        persisted = session.get(AppModelConfig, harness.historical_config.id)
        assert persisted is not None
        assert persisted.model_dict["completion_params"]["temperature"] == 0.2
    harness.assert_closed()


@pytest.mark.parametrize("consume_all", [False, True])
def test_stream_response_keeps_sse_and_releases_a_partially_consumed_port(harness: _Harness, consume_all: bool) -> None:
    stream = _Stream()
    harness.generator.response = stream
    response = harness.get(query="response_mode=streaming")
    assert response.status_code == HTTPStatus.OK
    assert dict(response.headers) == {"Content-Type": "text/event-stream; charset=utf-8"}
    if consume_all:
        assert response.data == "".join(_CHUNKS).encode()
    else:
        assert next(iter(response.response)) == _CHUNKS[0].encode()
        assert stream.close_calls == 0
    response.close()
    if not consume_all:
        assert stream.close_calls == 1
    assert harness.generator.calls[0][-1] is True
    harness.assert_closed()


@pytest.mark.parametrize("query", ["", "response_mode=invalid"])
def test_invalid_response_mode_is_rejected_before_source_queries(harness: _Harness, query: str) -> None:
    response = harness.get(query=query)
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    assert harness.query_sessions == []
    assert harness.generator.calls == []
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT, AppMode.WORKFLOW])
def test_non_completion_app_is_rejected_before_source_queries(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    response = harness.get()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_completion_app"
    assert harness.query_sessions == []
    assert harness.generator.calls == []


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
    assert harness.generator.calls == []
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
    assert harness.generator.calls == []
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "from_end_user_id", "from_account_id", "from_source"])
def test_message_ownership_is_enforced_through_http(harness: _Harness, field: str) -> None:
    value = ConversationFromSource.CONSOLE if field == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == harness.message.id).values({field: value}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "not_found"
    assert harness.generator.calls == []
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "tenant_id"])
def test_foreign_end_user_is_rejected_after_jwt_admission(harness: _Harness, field: str) -> None:
    with harness.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == harness.end_user.id).values({field: str(uuid4())}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "not_found"
    assert "End user" in response.get_json()["message"]
    assert harness.generator.calls == []
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
    assert harness.generator.calls == []
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
    assert harness.generator.calls == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("error", "status", "code", "message"),
    [
        (
            ProviderTokenNotInitError("Missing model credentials"),
            400,
            "provider_not_initialize",
            "Missing model credentials",
        ),
        (QuotaExceededError(), 400, "provider_quota_exceeded", None),
        (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support", None),
        (InvokeError("Provider rejected generation"), 400, "completion_request_error", "Provider rejected generation"),
        (RuntimeError("External generation failed"), 500, "internal_server_error", None),
    ],
)
def test_generation_port_errors_preserve_http_codes(
    harness: _Harness, error: Exception, status: int, code: str, message: str | None
) -> None:
    harness.generator.error = error
    response = harness.get()
    assert response.status_code == status
    assert response.get_json()["code"] == code
    if message is not None:
        assert response.get_json()["message"] == message
    assert len(harness.generator.calls) == 1
    harness.assert_closed()
