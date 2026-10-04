"""Web suggested questions through HTTP, real admission, and SQLite ownership queries."""

import json
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from decimal import Decimal
from http import HTTPStatus
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, delete, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.exceptions import Forbidden
from werkzeug.test import TestResponse

import controllers.web.message as message_controller
import controllers.web.wraps as web_wraps
from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_manager import ModelInstance, ModelManager
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.plugin.impl.model_runtime_factory import create_plugin_model_manager
from enums import DeploymentEdition
from extensions.ext_database import db
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.errors.invoke import InvokeError
from libs.external_api import ExternalApi
from libs.passport import PassportService
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource, CustomizeTokenStrategy
from models.model import App, AppMode, AppModelConfig, Conversation, EndUser, Message, Site
from models.workflow import Workflow
from repositories.message_suggested_questions_repository import SuggestedQuestionsRepository
from services import message_suggested_questions_generator as generator_module
from services.message_suggested_questions_generator import SuggestedQuestionsGenerator
from services.message_suggested_questions_queries import SuggestedQuestionsQuery
from services.message_suggested_questions_service import (
    MessageSuggestedQuestions,
    MessageSuggestedQuestionsService,
)
from tests.unit_tests.core.model_fixtures import make_model_config, make_model_instance
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message


@dataclass
class _Services:
    message_suggested_questions: MessageSuggestedQuestions


@dataclass(frozen=True)
class _Harness:
    app: Flask
    target: App
    end_user: EndUser
    message: Message
    factory: sessionmaker[Session]
    admission_factory: sessionmaker[Session]
    questions: list[str]
    prompts: list[str]
    traces: list[TraceTask]
    passport: str
    sessions: list[Session]

    def get(self) -> TestResponse:
        return self.app.test_client().get(
            f"/messages/{self.message.id}/suggested-questions",
            headers={HEADER_NAME_APP_CODE: "public-app", HEADER_NAME_PASSPORT: self.passport},
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
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, SECRET_KEY="suggested-questions-test-secret-key")
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
    passport = PassportService().issue({"app_code": site.code, "app_id": target.id, "end_user_id": end_user.id})
    model = make_model_instance(provider="openai", model="test-model")
    schema = make_model_config(provider="openai", model="test-model", mode="chat").model_schema
    manager = create_plugin_model_manager(tenant_id=target.tenant_id)
    questions = ["What next?"]
    prompts: list[str] = []
    traces: list[TraceTask] = []

    def resolve_model(*, tenant_id: str, model_type: ModelType) -> ModelInstance:
        assert tenant_id == target.tenant_id
        assert model_type == ModelType.LLM
        assert admission_sessions
        assert all(not session.in_transaction() and not session.identity_map for session in admission_sessions)
        return model

    def model_manager(*, tenant_id: str) -> ModelManager:
        assert tenant_id == target.tenant_id
        return manager

    def model_schema(_runtime: PluginModelRuntime, **_kwargs: object) -> AIModelEntity:
        return schema

    def tokens(_runtime: PluginModelRuntime, *, prompt_messages: Sequence[PromptMessage], **_kwargs: object) -> int:
        return len(prompt_messages)

    def invoke(
        _runtime: PluginModelRuntime,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict[str, object],
        stop: Sequence[str] | None,
        stream: bool,
        **_kwargs: object,
    ) -> LLMResult:
        assert all(not session.in_transaction() and not session.identity_map for session in admission_sessions)
        assert model_parameters == {"max_tokens": 256, "temperature": 0.0}
        assert not stop
        assert stream is False
        prompts.append(prompt_messages[0].get_text_content())
        return LLMResult(
            model="test-model",
            message=AssistantPromptMessage(content=json.dumps(questions)),
            usage=LLMUsage.empty_usage(),
        )

    add_trace_task = TraceQueueManager.add_trace_task

    def record_trace(queue: TraceQueueManager, task: TraceTask) -> None:
        assert queue.app_id == target.id
        traces.append(task)
        add_trace_task(queue, task)

    # Keep model/manager/trace implementations real; replace credential resolution,
    # plugin I/O and the background timer, and observe the actual trace submission.
    monkeypatch.setattr(manager, "get_default_model_instance", resolve_model)
    monkeypatch.setattr(generator_module.ModelManager, "for_tenant", model_manager)
    monkeypatch.setattr(PluginModelRuntime, "get_model_schema", model_schema)
    monkeypatch.setattr(PluginModelRuntime, "get_llm_num_tokens", tokens)
    monkeypatch.setattr(PluginModelRuntime, "invoke_llm", invoke)
    monkeypatch.setattr(TraceQueueManager, "start_timer", lambda _self: None)
    monkeypatch.setattr(TraceQueueManager, "add_trace_task", record_trace)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    event.listen(db.session.session_factory, "after_begin", track_session)
    queries = SuggestedQuestionsQuery(session_factory=read_factory, repository_factory=SuggestedQuestionsRepository)
    services = _Services(MessageSuggestedQuestionsService(queries=queries, generator=SuggestedQuestionsGenerator()))
    app.extensions["application_services"] = services
    api = ExternalApi(app)
    api.add_resource(message_controller.MessageSuggestedQuestionApi, "/messages/<uuid:message_id>/suggested-questions")
    yield _Harness(
        app,
        target,
        end_user,
        message,
        sqlite_session_factory,
        read_factory,
        questions,
        prompts,
        traces,
        passport,
        sessions,
    )
    event.remove(read_factory, "after_begin", track_admission)
    event.remove(db.session.session_factory, "after_begin", track_session)
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
@pytest.mark.parametrize("questions", [["What next?", "Tell me more."], []])
def test_chat_modes_generate_through_shared_capability(
    harness: _Harness,
    mode: AppMode,
    questions: list[str],
) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
        if mode == AppMode.ADVANCED_CHAT:
            workflow = Workflow.new(
                tenant_id=harness.target.tenant_id,
                app_id=harness.target.id,
                type="chat",
                version="published",
                graph="{}",
                features='{"suggested_questions_after_answer":{"enabled":true}}',
                created_by=str(uuid4()),
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )
            session.add(workflow)
            session.flush()
            app_model = session.get(App, harness.target.id)
            assert app_model is not None
            app_model.workflow_id = workflow.id
        elif mode == AppMode.AGENT:
            agent = Agent(
                tenant_id=harness.target.tenant_id,
                app_id=harness.target.id,
                name="Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
            )
            session.add(agent)
            session.flush()
            snapshot = AgentConfigSnapshot(
                tenant_id=agent.tenant_id,
                agent_id=agent.id,
                version=1,
                config_snapshot=AgentSoulConfig.model_validate(
                    {"app_features": {"suggested_questions_after_answer": {"enabled": True}}}
                ),
            )
            session.add(snapshot)
            session.flush()
            agent.active_config_snapshot_id = snapshot.id
    harness.questions[:] = questions
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.headers["Content-Type"] == "application/json"
    assert response.get_json() == {"data": questions}
    assert len(harness.prompts) == 1
    assert "Human: How does it work?\nAssistant: Like this." in harness.prompts[0]
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_app_is_rejected_before_shared_capability(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    response = harness.get()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_chat_app"
    assert harness.prompts == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("resource", "status", "code", "message"),
    [
        ("agent_version", 404, "agent_version_not_found_error", "Agent config version not found"),
        ("message", 404, "not_found", "Message not found"),
        ("conversation", 404, "not_found", "Conversation not found"),
        ("disabled", 403, "app_suggested_questions_after_answer_disabled", "disabled"),
    ],
)
def test_resource_errors_keep_specific_http_codes(
    harness: _Harness,
    resource: Literal["agent_version", "message", "conversation", "disabled"],
    status: int,
    code: str,
    message: str,
) -> None:
    with harness.factory.begin() as session:
        if resource == "message":
            session.execute(delete(Message).where(Message.id == harness.message.id))
        elif resource == "conversation":
            session.execute(delete(Conversation).where(Conversation.id == harness.message.conversation_id))
        elif resource == "disabled":
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.app_id == harness.target.id)
                .values(suggested_questions_after_answer='{"enabled":false}')
            )
        else:
            session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.AGENT))
            session.add(
                Agent(
                    tenant_id=harness.target.tenant_id,
                    app_id=harness.target.id,
                    name="Broken agent",
                    scope=AgentScope.ROSTER,
                    source=AgentSource.AGENT_APP,
                    active_config_snapshot_id=str(uuid4()),
                )
            )
    response = harness.get()
    assert response.status_code == status
    assert response.headers["Content-Type"] == "application/json"
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert message in body["message"]
    assert harness.prompts == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("failure", "status", "code", "message"),
    [
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
        (Forbidden("private failure detail"), 500, "internal_server_error", "internal error"),
    ],
)
def test_history_token_errors_keep_specific_http_codes(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    status: int,
    code: str,
    message: str,
) -> None:
    def fail_token_count(_runtime: PluginModelRuntime, **_kwargs: object) -> int:
        raise failure

    monkeypatch.setattr(PluginModelRuntime, "get_llm_num_tokens", fail_token_count)
    response = harness.get()
    assert response.status_code == status
    assert response.headers["Content-Type"] == "application/json"
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert message in body["message"]
    assert "private failure detail" not in response.get_data(as_text=True)
    assert harness.prompts == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("resource", "status", "code", "message"),
    [
        ("end_user", 404, "not_found", "End user not found"),
        (
            "app_mode",
            400,
            "app_unavailable",
            "App unavailable, please check your app configurations.",
        ),
    ],
)
def test_resource_changes_after_admission_keep_specific_errors(
    harness: _Harness,
    resource: Literal["end_user", "app_mode"],
    status: int,
    code: str,
    message: str,
) -> None:
    # Change persisted state after the real admission transaction ends; the
    # application service and repository must reject the now-stale reference.
    def change_resource(_session: Session, _transaction: SessionTransaction) -> None:
        with harness.factory.begin() as session:
            if resource == "end_user":
                session.execute(delete(EndUser).where(EndUser.id == harness.end_user.id))
            else:
                session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.WORKFLOW))

    event.listen(harness.admission_factory, "after_transaction_end", change_resource, once=True)
    try:
        response = harness.get()
    finally:
        event.remove(harness.admission_factory, "after_transaction_end", change_resource)
    assert response.status_code == status
    assert response.get_json()["code"] == code
    assert response.get_json()["message"] == message
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
    assert len(harness.prompts) == 1
    assert "Human: How does it work?\nAssistant: Like this." in harness.prompts[0]
    assert "Ask concise questions" in harness.prompts[0]
    assert len(harness.traces) == 1
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
    assert harness.prompts == []
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
    assert harness.prompts == []
    harness.assert_closed()
