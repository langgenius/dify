"""Console suggested-question admission and actor/configuration isolation over SQLite."""

import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from http import HTTPStatus
from typing import cast
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, func, select, text, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.console.wraps as console_wraps
from controllers.common.rbac import RBACPermission, RBACResourceScope
from controllers.common.rbac.checks import RBACService
from controllers.console.app import message as controller
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_manager import ModelInstance
from core.ops.ops_trace_manager import TraceTask
from extensions.application_services.app import AppServices
from extensions.ext_database import db
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeError
from libs import login
from libs.external_api import ExternalApi
from models.account import Account, Tenant
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkspaceBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, Conversation, Message
from repositories.app.agent_app_repository import AgentAppRepository
from services import message_service
from services.app.agent_app_service import AgentAppAccessService
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_suggested_questions_adapters import MessageSuggestedQuestionsRuntime
from services.message_suggested_questions_service import (
    MessageSuggestedQuestions,
    SuggestedQuestionsAccount,
    SuggestedQuestionsActor,
    SuggestedQuestionsActorNotFoundError,
)
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message


@dataclass
class _Questions:
    questions: list[str] = field(default_factory=lambda: ["Next?"])
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
class _Agents:
    access: AgentAppAccessService


@dataclass
class _Services:
    apps: AppServices
    agent_apps: _Agents
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
        raise NotImplementedError

    def invoke_llm(
        self,
        *,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, object],
        stop: list[str],
        stream: bool,
    ) -> LLMResult:
        assert model_parameters == {"max_tokens": 256, "temperature": 0.0}
        assert stop == []
        assert stream is False
        self.prompts.append(prompt_messages[0].get_text_content())
        return LLMResult(
            model="test-model", message=AssistantPromptMessage(content='["Next?"]'), usage=LLMUsage.empty_usage()
        )

    def add_trace_task(self, task: TraceTask) -> None:
        self.traces.append(task)


@dataclass
class _Harness:
    flask_app: Flask
    target: App
    account: Account
    conversation: Conversation
    message: Message
    agent_id: str
    factory: sessionmaker[Session]
    services: _Services
    provider: _Provider
    permission_calls: list[tuple[str, str, RBACPermission, RBACResourceScope | None, str | None]]
    allowed: bool = True

    def get(self, route: str = "app") -> TestResponse:
        resource = f"apps/{self.target.id}" if route == "app" else f"agent/{self.agent_id}"
        return self.flask_app.test_client().get(f"/{resource}/chat-messages/{self.message.id}/suggested-questions")

    def add_agent(self, *, scope: AgentScope = AgentScope.ROSTER, backing: bool = True) -> None:
        with self.factory.begin() as session:
            session.execute(update(App).where(App.id == self.target.id).values(mode=AppMode.AGENT))
            session.add(
                Agent(
                    id=self.agent_id,
                    tenant_id=self.target.tenant_id,
                    name="Agent",
                    scope=scope,
                    source=AgentSource.AGENT_APP if scope == AgentScope.ROSTER else AgentSource.WORKFLOW,
                    status=AgentStatus.ACTIVE,
                    app_id=self.target.id if scope == AgentScope.ROSTER else str(uuid4()),
                    backing_app_id=self.target.id if scope == AgentScope.WORKFLOW_ONLY and backing else None,
                    workflow_id=str(uuid4()) if scope == AgentScope.WORKFLOW_ONLY else None,
                    workflow_node_id="node" if scope == AgentScope.WORKFLOW_ONLY else None,
                )
            )


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    app_services: AppServices,
) -> Iterator[_Harness]:
    target = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    account = make_account(account_id=str(uuid4()))
    tenant = Tenant(name="Workspace")
    tenant.id = target.tenant_id
    account._current_tenant = tenant
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
        inputs={},
    )
    config = AppModelConfig(
        app_id=target.id, suggested_questions_after_answer=json.dumps({"enabled": True, "prompt": "Console questions"})
    )
    message = make_message(
        message_id=str(uuid4()),
        app_id=target.id,
        conversation_id=conversation.id,
        inputs={},
        message={},
        query="How?",
        answer="Like this.",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=account.id,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([target, account, conversation, config, message])
        session.flush()
        target.app_model_config_id = config.id
        conversation.app_model_config_id = config.id
    sessions: list[Session] = []

    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    event.listen(sqlite_session_factory, "after_begin", track_session)
    provider = _Provider(target.tenant_id, sessions)

    def manager(*, tenant_id: str) -> _Provider:
        assert tenant_id == target.tenant_id
        return provider

    def trace_manager(*, app_id: str) -> _Provider:
        assert app_id == target.id
        return provider

    monkeypatch.setattr(message_service.ModelManager, "for_tenant", manager)
    monkeypatch.setattr(message_service, "TraceQueueManager", trace_manager)
    monkeypatch.setattr(login, "current_user", account)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: True)
    apply_config_overrides(monkeypatch, LOGIN_DISABLED=True, RBAC_ENABLED=False)
    flask_app = Flask(__name__)
    flask_app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(flask_app)
    services = _Services(
        app_services,
        _Agents(AgentAppAccessService(references=AgentAppRepository(session_factory=sqlite_session_factory))),
        MessageSuggestedQuestionsRuntime(session_factory=sqlite_session_factory),
    )
    flask_app.extensions["application_services"] = services
    api = ExternalApi(flask_app)
    api.add_resource(
        controller.MessageSuggestedQuestionApi,
        "/apps/<uuid:app_id>/chat-messages/<uuid:message_id>/suggested-questions",
    )
    api.add_resource(
        controller.AgentMessageSuggestedQuestionApi,
        "/agent/<uuid:agent_id>/chat-messages/<uuid:message_id>/suggested-questions",
    )
    result = _Harness(
        flask_app, target, account, conversation, message, str(uuid4()), sqlite_session_factory, services, provider, []
    )

    def permission(
        tenant_id: str,
        account_id: str,
        *,
        scene: RBACPermission,
        resource_type: RBACResourceScope | None,
        resource_id: str | None,
    ) -> bool:
        result.permission_calls.append((tenant_id, account_id, scene, resource_type, resource_id))
        return result.allowed

    monkeypatch.setattr(RBACService.CheckAccess, "check", permission)
    yield result
    event.remove(sqlite_session_factory, "after_begin", track_session)
    with flask_app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
@pytest.mark.parametrize("questions", [[], ["Next?", "More?"]])
def test_app_reference_and_account_are_passed_to_shared_runtime(
    harness: _Harness, mode: AppMode, questions: list[str]
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
            SuggestedQuestionsAccount(harness.account.id, "debugger"),
            harness.message.id,
        )
    ]
    assert all(
        not session.in_transaction() and not session.identity_map for session in harness.provider.admission_sessions
    )


@pytest.mark.parametrize("change", ["tenant", "status", "missing", "workflow", "completion", "hidden"])
def test_app_admission_rejects_unavailable_or_unsupported_apps(harness: _Harness, change: str) -> None:
    if change == "hidden":
        harness.add_agent(scope=AgentScope.WORKFLOW_ONLY)
    else:
        field_name, value = {
            "tenant": ("tenant_id", str(uuid4())),
            "status": ("status", "archived"),
            "missing": ("id", str(uuid4())),
            "workflow": ("mode", "workflow"),
            "completion": ("mode", "completion"),
        }[change]
        with harness.factory.begin() as session:
            if change == "status":
                session.execute(
                    text("UPDATE apps SET status = :status WHERE id = :id"), {"status": value, "id": harness.target.id}
                )
            else:
                session.execute(update(App).where(App.id == harness.target.id).values({field_name: value}))
    port = _Questions()
    harness.services.message_suggested_questions = port
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "app_not_found"
    assert not port.calls


@pytest.mark.parametrize("scope", [AgentScope.ROSTER, AgentScope.WORKFLOW_ONLY])
def test_agent_resolves_existing_backing_app(harness: _Harness, scope: AgentScope) -> None:
    harness.add_agent(scope=scope)
    port = _Questions()
    harness.services.message_suggested_questions = port
    response = harness.get("agent")
    assert response.status_code == HTTPStatus.OK
    assert port.calls == [
        (
            harness.target.id,
            harness.target.tenant_id,
            AppMode.AGENT,
            SuggestedQuestionsAccount(harness.account.id, "debugger"),
            harness.message.id,
        )
    ]
    assert all(
        not session.in_transaction() and not session.identity_map for session in harness.provider.admission_sessions
    )


@pytest.mark.parametrize("change", ["missing_backing", "tenant", "agent_status", "app_status", "app_mode"])
def test_agent_rejects_unavailable_runtime_without_creating_app(harness: _Harness, change: str) -> None:
    harness.add_agent(scope=AgentScope.WORKFLOW_ONLY, backing=change != "missing_backing")
    if change != "missing_backing":
        model, key, value = {
            "tenant": (Agent, "tenant_id", str(uuid4())),
            "agent_status": (Agent, "status", AgentStatus.ARCHIVED),
            "app_status": (App, "status", "archived"),
            "app_mode": (App, "mode", AppMode.CHAT),
        }[change]
        with harness.factory.begin() as session:
            if change == "app_status":
                session.execute(
                    text("UPDATE apps SET status = :status WHERE id = :id"), {"status": value, "id": harness.target.id}
                )
            else:
                session.execute(update(model).values({key: value}))
    response = harness.get("agent")
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "agent_not_found_error"
    with harness.factory() as session:
        assert session.scalar(select(func.count()).select_from(App)) == 1
        assert session.scalar(select(func.count()).select_from(AppModelConfig)) == 1
        if change == "missing_backing":
            assert session.scalar(select(Agent.backing_app_id)) is None


@pytest.mark.parametrize("route", ["app", "agent"])
@pytest.mark.parametrize("allowed", [True, False])
def test_real_rbac_admission_keeps_resource_scene(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, route: str, allowed: bool
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    if route == "agent":
        harness.add_agent()
    harness.allowed = allowed
    port = _Questions()
    harness.services.message_suggested_questions = port
    response = harness.get(route)
    assert response.status_code == (HTTPStatus.OK if allowed else HTTPStatus.FORBIDDEN)
    assert harness.permission_calls == [
        (
            harness.target.tenant_id,
            harness.account.id,
            RBACPermission.APP_VIEW_LAYOUT if route == "app" else RBACPermission.AGENT_TEST_AND_RUN,
            RBACResourceScope.APP if route == "app" else RBACResourceScope.AGENT,
            harness.target.id if route == "app" else harness.agent_id,
        )
    ]
    assert len(port.calls) == int(allowed)


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (AppDefinitionUnavailableError("stale app"), 400, "app_unavailable"),
        (SuggestedQuestionsActorNotFoundError("deleted account"), 401, "unauthorized"),
        (MessageNotExistsError(), 404, "not_found"),
        (ConversationNotExistsError(), 404, "not_found"),
        (ProviderTokenNotInitError(), 400, "provider_not_initialize"),
        (QuotaExceededError(), 400, "provider_quota_exceeded"),
        (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support"),
        (InvokeError("provider failed"), 400, "completion_request_error"),
        (SuggestedQuestionsAfterAnswerDisabledError(), 403, "app_suggested_questions_after_answer_disabled"),
        (RuntimeError("private credentials"), 500, "internal_server_error"),
    ],
)
@pytest.mark.parametrize("route", ["app", "agent"])
def test_precise_errors_are_translated_at_http_boundary(
    harness: _Harness, error: Exception, status: int, code: str, route: str
) -> None:
    if route == "agent":
        harness.add_agent()
    harness.services.message_suggested_questions = _Questions(failure=error)
    response = harness.get(route)
    assert response.status_code == status
    assert response.get_json()["code"] == code
    assert "private credentials" not in response.get_data(as_text=True)


def test_chat_runtime_uses_console_history_after_reference_session_closed(harness: _Harness) -> None:
    with harness.flask_app.app_context():
        caller_session = db.session()
        caller_app = caller_session.get(App, harness.target.id)
        assert caller_app is not None
        caller_app.name = "Pending caller edit"
        response = harness.get()
        assert db.session() is caller_session
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": ["Next?"]}
    assert len(harness.provider.prompts) == 1
    assert "Console questions" in harness.provider.prompts[0]
    assert "How?" in harness.provider.prompts[0]
    assert len(harness.provider.traces) == 1


@pytest.mark.parametrize("entity", [Message, Conversation])
@pytest.mark.parametrize("change", ["app_id", "from_account_id", "from_source"])
def test_runtime_cannot_read_another_accounts_message_or_conversation(
    harness: _Harness, entity: type[Message] | type[Conversation], change: str
) -> None:
    with harness.factory.begin() as session:
        session.execute(update(entity).values({change: "api" if change == "from_source" else str(uuid4())}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"] == ("Message not found" if entity is Message else "Conversation not found")
    assert not harness.provider.prompts


def test_agent_runtime_uses_current_accounts_personal_debug_draft(harness: _Harness) -> None:
    harness.add_agent()
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values({App.app_model_config_id: None}))
        session.add(
            AgentDebugConversation(
                tenant_id=harness.target.tenant_id,
                agent_id=harness.agent_id,
                app_id=harness.target.id,
                account_id=harness.account.id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                conversation_id=harness.conversation.id,
            )
        )
        for owner, prompt in [(harness.account.id, "My personal draft"), (str(uuid4()), "Other accounts secret draft")]:
            session.add(
                AgentConfigDraft(
                    tenant_id=harness.target.tenant_id,
                    agent_id=harness.agent_id,
                    account_id=owner,
                    draft_owner_key=owner,
                    draft_type=AgentConfigDraftType.DEBUG_BUILD,
                    config_snapshot=AgentSoulConfig.model_validate(
                        {"app_features": {"suggested_questions_after_answer": {"enabled": True, "prompt": prompt}}}
                    ),
                )
            )
    response = harness.get("agent")
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": ["Next?"]}
    assert "My personal draft" in harness.provider.prompts[0]
    assert "Other accounts secret draft" not in harness.provider.prompts[0]


@pytest.mark.parametrize("same_tenant", [True, False])
def test_agent_runtime_preserves_conversation_binding_scope(harness: _Harness, same_tenant: bool) -> None:
    harness.add_agent()
    draft_id, binding_id = str(uuid4()), str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values({App.app_model_config_id: None}))
        session.add(
            AgentConfigDraft(
                id=draft_id,
                tenant_id=harness.target.tenant_id,
                agent_id=harness.agent_id,
                draft_type=AgentConfigDraftType.DRAFT,
                config_snapshot=AgentSoulConfig.model_validate(
                    {
                        "app_features": {
                            "suggested_questions_after_answer": {
                                "enabled": True,
                                "prompt": "Conversation bound questions",
                            }
                        }
                    }
                ),
            )
        )
        session.add(
            AgentWorkspaceBinding(
                id=binding_id,
                tenant_id=harness.target.tenant_id if same_tenant else str(uuid4()),
                app_id=harness.target.id,
                workspace_id=str(uuid4()),
                agent_id=harness.agent_id,
                agent_config_version_id=draft_id,
                agent_config_version_kind=AgentConfigVersionKind.DRAFT,
                backend_binding_ref="existing-binding",
            )
        )
        session.execute(
            update(Conversation)
            .where(Conversation.id == harness.conversation.id)
            .values({Conversation.agent_workspace_binding_id: binding_id})
        )
    response = harness.get("agent")
    if same_tenant:
        assert response.status_code == HTTPStatus.OK
        assert "Conversation bound questions" in harness.provider.prompts[0]
    else:
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.get_json()["code"] == "agent_version_not_found_error"
        assert not harness.provider.prompts
