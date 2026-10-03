"""Web suggested questions through HTTP, real admission, and SQLite ownership queries."""

import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from http import HTTPStatus
from typing import Literal, cast
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.web.message as message_controller
import controllers.web.wraps as web_wraps
from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_manager import ModelInstance
from core.ops.ops_trace_manager import TraceTask
from extensions.ext_database import db
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeError
from libs.external_api import ExternalApi
from models.enums import ConversationFromSource, CustomizeTokenStrategy
from models.model import App, AppMode, AppModelConfig, Conversation, EndUser, Message, Site
from repositories.message_suggested_questions_repository import SuggestedQuestionsRepository
from services import message_suggested_questions_generator as generator_module
from services.agent.errors import AgentVersionNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_suggested_questions_generator import SuggestedQuestionsGenerator
from services.message_suggested_questions_queries import SuggestedQuestionsQuery
from services.message_suggested_questions_service import (
    MessageSuggestedQuestions,
    MessageSuggestedQuestionsService,
    SuggestedQuestionsActor,
    SuggestedQuestionsActorNotFoundError,
    SuggestedQuestionsEndUser,
)
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message


@dataclass
class _Questions:
    questions: list[str] = field(default_factory=lambda: ["What next?"])
    failure: Exception | None = None
    calls: list[tuple[str, str, str, SuggestedQuestionsActor, str]] = field(default_factory=list)

    def get_suggested_questions(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: SuggestedQuestionsActor,
        message_id: str,
    ) -> list[str]:
        self.calls.append((app_id, app_owner_tenant_id, expected_app_mode, actor, message_id))
        if self.failure is not None:
            raise self.failure
        return self.questions


@dataclass
class _Services:
    message_suggested_questions: MessageSuggestedQuestions


@dataclass
class _Provider:
    tenant_id: str
    admission_sessions: list[Session]
    prompts: list[str] = field(default_factory=list)
    traces: list[TraceTask] = field(default_factory=list)

    def get_default_model_instance(self, *, tenant_id: str, model_type: ModelType) -> ModelInstance:
        assert tenant_id == self.tenant_id
        assert model_type == ModelType.LLM
        assert self.admission_sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.admission_sessions)
        return cast(ModelInstance, self)

    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int:
        return len(prompt_messages)

    def get_model_schema(self) -> None:
        # Providers without schema metadata use the generator's existing defaults.
        raise NotImplementedError

    def invoke_llm(
        self,
        *,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object],
        stop: list[str],
        stream: bool,
    ) -> LLMResult:
        assert all(not session.in_transaction() and not session.identity_map for session in self.admission_sessions)
        assert model_parameters == {"max_tokens": 256, "temperature": 0.0}
        assert stop == []
        assert stream is False
        self.prompts.append(prompt_messages[0].get_text_content())
        return LLMResult(
            model="test-model",
            message=AssistantPromptMessage(content='["What next?"]'),
            usage=LLMUsage.empty_usage(),
        )

    def add_trace_task(self, task: TraceTask) -> None:
        self.traces.append(task)


@dataclass(frozen=True)
class _Harness:
    app: Flask
    target: App
    end_user: EndUser
    message: Message
    factory: sessionmaker[Session]
    services: _Services
    provider: _Provider
    sessions: list[Session]

    def get(self) -> TestResponse:
        return self.app.test_client().get(
            f"/messages/{self.message.id}/suggested-questions",
            headers={HEADER_NAME_APP_CODE: "public-app", HEADER_NAME_PASSPORT: "test-passport"},
        )

    def assert_closed(self, *, caller: Session | None = None) -> None:
        assert self.sessions
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.sessions
            if session is not caller
        )


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    target = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    end_user = make_end_user(end_user_id=str(uuid4()), tenant_id=target.tenant_id, app_id=target.id)
    config = AppModelConfig(
        app_id=target.id,
        suggested_questions_after_answer=json.dumps({"enabled": True, "prompt": "Ask concise questions"}),
    )
    site = Site(
        app_id=target.id,
        title="Public app",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code="public-app",
    )
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        inputs={},
    )
    message = make_message(
        message_id=str(uuid4()),
        app_id=target.id,
        conversation_id=conversation.id,
        inputs={},
        message={},
        query="How does it work?",
        answer="Like this.",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([target, end_user, config, site, conversation, message])
        session.flush()
        target.app_model_config_id = config.id
        conversation.app_model_config_id = config.id

    read_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    sessions: list[Session] = []

    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    admission_sessions: list[Session] = []

    def track_admission(session: Session, transaction: SessionTransaction, connection: Connection) -> None:
        admission_sessions.append(session)
        track_session(session, transaction, connection)

    event.listen(read_factory, "after_begin", track_admission)
    monkeypatch.setattr(web_wraps.session_factory, "create_session", read_factory)
    monkeypatch.setattr(web_wraps.SystemFeatureService, "is_webapp_auth_enabled", lambda: False)

    def verify(_passport: web_wraps.PassportService, token: str) -> dict[str, str]:
        assert token == "test-passport"
        return {"app_code": site.code or "", "app_id": target.id, "end_user_id": end_user.id}

    monkeypatch.setattr(web_wraps.PassportService, "verify", verify)
    provider = _Provider(target.tenant_id, admission_sessions)

    def model_manager(*, tenant_id: str) -> _Provider:
        assert tenant_id == target.tenant_id
        return provider

    def trace_manager(*, app_id: str) -> _Provider:
        assert app_id == target.id
        return provider

    monkeypatch.setattr(generator_module.ModelManager, "for_tenant", model_manager)
    monkeypatch.setattr(generator_module, "TraceQueueManager", trace_manager)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    event.listen(db.session.session_factory, "after_begin", track_session)
    queries = SuggestedQuestionsQuery(session_factory=read_factory, repository_factory=SuggestedQuestionsRepository)
    services = _Services(MessageSuggestedQuestionsService(queries=queries, generator=SuggestedQuestionsGenerator()))
    app.extensions["application_services"] = services
    api = ExternalApi(app)
    api.add_resource(message_controller.MessageSuggestedQuestionApi, "/messages/<uuid:message_id>/suggested-questions")
    yield _Harness(app, target, end_user, message, sqlite_session_factory, services, provider, sessions)
    event.remove(read_factory, "after_begin", track_admission)
    event.remove(db.session.session_factory, "after_begin", track_session)
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
@pytest.mark.parametrize("questions", [["What next?", "Tell me more."], []])
def test_admitted_actor_and_app_are_passed_to_shared_capability(
    harness: _Harness,
    mode: AppMode,
    questions: list[str],
) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    port = _Questions(questions=questions)
    harness.services.message_suggested_questions = port
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.headers["Content-Type"] == "application/json"
    assert response.get_json() == {"data": questions}
    assert port.calls == [
        (
            harness.target.id,
            harness.target.tenant_id,
            mode,
            SuggestedQuestionsEndUser(end_user_id=harness.end_user.id, invoke_from="web-app"),
            harness.message.id,
        )
    ]
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_app_is_rejected_before_shared_capability(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    port = _Questions()
    harness.services.message_suggested_questions = port
    response = harness.get()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_chat_app"
    assert port.calls == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("failure", "status", "code", "message"),
    [
        (AgentVersionNotFoundError(), 404, "agent_version_not_found_error", "Agent config version not found"),
        (MessageNotExistsError(), 404, "not_found", "Message not found"),
        (ConversationNotExistsError(), 404, "not_found", "Conversation not found"),
        (SuggestedQuestionsActorNotFoundError("stale actor"), 404, "not_found", "End user not found"),
        (AppDefinitionUnavailableError("stale app"), 400, "app_unavailable", "App unavailable"),
        (
            SuggestedQuestionsAfterAnswerDisabledError(),
            403,
            "app_suggested_questions_after_answer_disabled",
            "disabled",
        ),
        (
            ProviderTokenNotInitError("Missing provider credential"),
            400,
            "provider_not_initialize",
            "Missing provider credential",
        ),
        (QuotaExceededError(), 400, "provider_quota_exceeded", "quota"),
        (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support", "not support"),
        (InvokeError("Provider invocation failed"), 400, "completion_request_error", "Provider invocation failed"),
        (RuntimeError("private failure detail"), 500, "internal_server_error", "internal error"),
    ],
)
def test_errors_keep_specific_http_codes(
    harness: _Harness,
    failure: Exception,
    status: int,
    code: str,
    message: str,
) -> None:
    harness.services.message_suggested_questions = _Questions(failure=failure)
    response = harness.get()
    assert response.status_code == status
    assert response.headers["Content-Type"] == "application/json"
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert message in body["message"]
    assert "private failure detail" not in response.get_data(as_text=True)
    harness.assert_closed()


def test_real_runtime_keeps_caller_session_and_renders_owned_message(harness: _Harness) -> None:
    with harness.app.app_context():
        caller = db.session()
        app_model = caller.get(App, harness.target.id)
        assert app_model is not None
        app_model.name = "Uncommitted caller change"
        response = harness.get()
        assert response.status_code == HTTPStatus.OK
        assert response.get_json() == {"data": ["What next?"]}
        assert db.session() is caller
        assert caller.in_transaction()
        assert app_model in caller.dirty
        harness.assert_closed(caller=caller)
    assert len(harness.provider.prompts) == 1
    assert "Human: How does it work?\nAssistant: Like this." in harness.provider.prompts[0]
    assert "Ask concise questions" in harness.provider.prompts[0]
    assert len(harness.provider.traces) == 1
    with harness.factory() as session:
        persisted = session.get(App, harness.target.id)
        assert persisted is not None
        assert persisted.name == harness.target.name


@pytest.mark.parametrize("field_name", ["tenant_id", "app_id"])
def test_real_runtime_rejects_end_user_from_another_owner(
    harness: _Harness,
    field_name: Literal["tenant_id", "app_id"],
) -> None:
    with harness.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == harness.end_user.id).values({field_name: str(uuid4())}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == "End user not found"
    assert harness.provider.prompts == []
    harness.assert_closed()


@pytest.mark.parametrize("model", [Message, Conversation])
@pytest.mark.parametrize("field_name", ["app_id", "from_end_user_id", "from_source"])
def test_real_runtime_rejects_message_or_conversation_outside_actor_scope(
    harness: _Harness,
    model: type[Message] | type[Conversation],
    field_name: Literal["app_id", "from_end_user_id", "from_source"],
) -> None:
    record_id = harness.message.id if model is Message else harness.message.conversation_id
    value = ConversationFromSource.CONSOLE if field_name == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(model).where(model.id == record_id).values({field_name: value}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == ("Message not found" if model is Message else "Conversation not found")
    assert harness.provider.prompts == []
    harness.assert_closed()
