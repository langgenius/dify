"""Trial suggested questions through HTTP, real ownership queries, and SQLite."""

from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import cast
from uuid import uuid4

import pytest
from flask import Flask, Request
from sqlalchemy import Connection, Engine, delete, event, select, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

import controllers.console.explore.trial as trial_module
import controllers.console.explore.trial_app_admission as admission_module
import controllers.console.wraps as console_wraps
import core.ops.trace_source as trace_source_module
import libs.login as login_module
import services.message_service as message_module
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_context import get_credit_usage_metadata
from core.model_manager import ModelInstance
from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace, TraceProviderSettings
from enums import DeploymentEdition
from extensions.ext_database import db
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from graphon.model_runtime.entities import PromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeError
from libs.external_api import ExternalApi
from models import Account, AccountTrialAppRecord, App, AppMode, Conversation, Message, Tenant, TrialApp
from models.account import AccountStatus
from models.enums import ConversationFromSource
from models.model import AppModelConfig
from repositories.trial_app_repository import TrialAppRepository
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.message_suggested_questions_adapters import MessageSuggestedQuestionsRuntime
from services.message_suggested_questions_service import (
    SuggestedQuestionsAccount,
    SuggestedQuestionsActor,
    SuggestedQuestionsActorNotFoundError,
)
from services.trial_app_access_service import TrialAppAccessService
from tests.unit_tests.core.ops.test_message_trace import RecordingQueue


@dataclass
class _Features:
    enabled: bool = True
    setup_completed: bool = True
    events: list[str] = field(default_factory=list)

    def is_trial_enabled(self) -> bool:
        self.events.append("feature")
        return self.enabled


@dataclass
class _Provider:
    read_sessions: list[Session]
    tenant_ids: list[str] = field(default_factory=list)
    histories: list[str] = field(default_factory=list)
    trace_queue: RecordingQueue = field(default_factory=RecordingQueue)
    questions: list[str] = field(default_factory=lambda: ["Next question?", "Another question?"])
    failure: Exception | None = None
    missing_model: bool = False
    app_type: str = "chatbot"

    def get_default_model_instance(self, *, tenant_id: str, model_type: ModelType) -> ModelInstance:
        assert model_type == ModelType.LLM
        self.tenant_ids.append(tenant_id)
        if self.missing_model:
            raise ProviderTokenNotInitError("No default model")
        return cast(ModelInstance, self)

    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int:
        return len(prompt_messages)

    def generate(
        self,
        *,
        tenant_id: str,
        histories: str,
        instruction_prompt: str | None,
        model_config: object,
        trace_recorder: MessageTraceRecorder | None,
    ) -> Sequence[str]:
        # Admission and ORM reload finish before the legacy runtime's model I/O.
        assert len(self.read_sessions) == 2
        assert all(not session.in_transaction() and not session.identity_map for session in self.read_sessions)
        assert self.tenant_ids == [tenant_id]
        assert instruction_prompt == "Suggest concise follow-ups"
        assert model_config is None
        assert get_credit_usage_metadata() == {"app_type": self.app_type}
        self.histories.append(histories)
        if self.failure is not None:
            raise self.failure
        assert trace_recorder is not None
        assert trace_recorder.source.tenant_id == tenant_id
        trace_recorder.record_operation(
            "suggested_questions",
            span_type="llm",
            inputs=histories,
            outputs=self.questions,
            attributes={"operation_type": "suggested_question"},
            independent=True,
        )
        return self.questions


@dataclass(frozen=True)
class _ApplicationServices:
    trial_app_access: TrialAppAccessService
    recommended_app_queries: _Features
    message_suggested_questions: MessageSuggestedQuestionsRuntime


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    trial: TrialApp
    conversation: Conversation
    message: Message
    config: AppModelConfig
    factory: sessionmaker[Session]
    features: _Features
    provider: _Provider
    legacy_sessions: list[Session]

    def get(self, *, app_id: str | None = None, message_id: str | None = None) -> TestResponse:
        return self.app.test_client().get(
            f"/trial-apps/{app_id or self.target.id}/messages/{message_id or self.message.id}/suggested-questions"
        )

    def assert_closed(self) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.provider.read_sessions + self.legacy_sessions
        )

    def usage(self) -> int | None:
        with self.factory() as session:
            return session.scalar(
                select(AccountTrialAppRecord.count).where(
                    AccountTrialAppRecord.app_id == self.target.id,
                    AccountTrialAppRecord.account_id == self.account.id,
                )
            )


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> Iterator[_Harness]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, INIT_PASSWORD="", LOGIN_DISABLED=False)
    features = _Features()
    account = Account(name="Trial viewer", email="trial@example.com")
    account._current_tenant = Tenant(name="Viewer workspace")
    target = App(tenant_id=str(uuid4()), name="Trial app", mode=AppMode.CHAT, enable_site=True, enable_api=False)
    target.id = str(uuid4())
    trial = TrialApp(app_id=target.id, tenant_id=str(uuid4()), trial_limit=3)
    config = AppModelConfig(
        app_id=target.id,
        suggested_questions_after_answer='{"enabled":true,"prompt":"Suggest concise follow-ups"}',
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([account, target, trial, config])
        session.flush()
        target.app_model_config_id = config.id
        conversation = Conversation(
            app_id=target.id,
            app_model_config_id=config.id,
            mode=AppMode.CHAT,
            name="Trial conversation",
            inputs={},
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=account.id,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=target.id,
            conversation_id=conversation.id,
            inputs={},
            query="What is a trial?",
            message={},
            message_unit_price=Decimal(0),
            answer="A way to try an app.",
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=account.id,
        )
        session.add(message)

    read_sessions: list[Session] = []
    read_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    @event.listens_for(read_factory, "after_begin")
    def track_read(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        read_sessions.append(session)

    provider = _Provider(read_sessions)
    services = _ApplicationServices(
        trial_app_access=TrialAppAccessService(apps=TrialAppRepository(session_factory=read_factory)),
        recommended_app_queries=features,
        message_suggested_questions=MessageSuggestedQuestionsRuntime(session_factory=read_factory),
    )

    def setup_completed() -> bool:
        features.events.append("setup")
        return features.setup_completed

    def csrf(_request: Request, account_id: str) -> None:
        assert account_id == account.id
        features.events.append("csrf")

    for module in (trial_module, admission_module):
        monkeypatch.setattr(module, "application_services", lambda: services)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", setup_completed)
    monkeypatch.setattr(login_module, "current_user", account)
    monkeypatch.setattr(login_module, "check_csrf_token", csrf)

    def model_manager(*, tenant_id: str) -> _Provider:
        assert tenant_id == target.tenant_id
        return provider

    def trace_provider_settings(tenant_id: str, app_id: str | None) -> tuple[TraceProviderSettings, ...]:
        assert tenant_id == target.tenant_id
        assert app_id == target.id
        return (
            TraceProviderSettings(
                tenant_id=tenant_id, app_id=app_id, provider_name="recording", config_id=str(uuid4())
            ),
        )

    monkeypatch.setattr(message_module.ModelManager, "for_tenant", model_manager)
    monkeypatch.setattr(message_module.LLMGenerator, "generate_suggested_questions_after_answer", provider.generate)
    monkeypatch.setattr(trace_source_module, "get_trace_provider_settings", trace_provider_settings)

    app = Flask(__name__)
    app.extensions["ops_trace_queue"] = provider.trace_queue
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    legacy_sessions: list[Session] = []

    def track_legacy(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        legacy_sessions.append(session)

    event.listen(db.session.session_factory, "after_begin", track_legacy)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)
    api = ExternalApi(app)
    api.add_resource(
        trial_module.TrialMessageSuggestedQuestionApi,
        "/trial-apps/<uuid:app_id>/messages/<uuid:message_id>/suggested-questions",
    )
    yield _Harness(
        app,
        account,
        target,
        trial,
        conversation,
        message,
        config,
        sqlite_session_factory,
        features,
        provider,
        legacy_sessions,
    )
    event.remove(db.session.session_factory, "after_begin", track_legacy)
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


def _assert_error(response: TestResponse, status: int, code: str, message: str | None = None) -> None:
    assert response.status_code == status, response.get_json()
    body = response.get_json()
    assert body["code"] == code
    assert body["status"] == status
    assert body["message"]
    if message is not None:
        assert body["message"] == message
    assert response.headers["Content-Type"] == "application/json"


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT])
@pytest.mark.parametrize("questions", [["Next question?", "Another question?"], []])
def test_questions_keep_response_history_owner_and_usage(
    harness: _Harness, questions: list[str], mode: AppMode
) -> None:
    harness.provider.questions = questions
    harness.provider.app_type = "chatbot" if mode == AppMode.CHAT else "agent"
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values(mode=mode))
    with harness.factory.begin() as session:
        session.add_all(
            [
                AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=1),
                AccountTrialAppRecord(app_id=harness.target.id, account_id=str(uuid4()), count=3),
            ]
        )

    response = harness.get()

    assert response.status_code == 200, response.get_json()
    assert response.get_json() == {"data": questions}
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)
    assert harness.provider.histories == ["Human: What is a trial?\nAssistant: A way to try an app."]
    assert harness.provider.tenant_ids == [harness.target.tenant_id]
    assert harness.target.tenant_id not in {harness.trial.tenant_id, harness.account.current_tenant_id}
    assert len(harness.provider.trace_queue.items) == 1
    trace = CompletedTrace.model_validate_json(harness.provider.trace_queue.items[0].trace_json)
    assert trace.source.tenant_id == harness.target.tenant_id
    assert trace.source.app_id == harness.target.id
    assert trace.source.actor_id == harness.account.id
    assert trace.source.message_id == harness.message.id
    assert trace.source.conversation_id == harness.conversation.id
    assert trace.spans[0].outputs == questions
    assert harness.features.events == ["setup", "csrf", "feature"]
    assert harness.usage() == 1
    assert len(harness.legacy_sessions) == 1
    harness.assert_closed()


@pytest.mark.parametrize("entity", ["message", "conversation"])
@pytest.mark.parametrize("mismatch", ["missing", "app", "account", "source", "end-user"])
def test_message_and_conversation_require_complete_owner_chain(harness: _Harness, entity: str, mismatch: str) -> None:
    message_id = harness.message.id
    with harness.factory.begin() as session:
        record = (
            session.get(Message, harness.message.id)
            if entity == "message"
            else session.get(Conversation, harness.conversation.id)
        )
        assert record is not None
        match mismatch:
            case "missing":
                if entity == "message":
                    message_id = str(uuid4())
                else:
                    session.delete(record)
            case "app":
                record.app_id = str(uuid4())
            case "account":
                record.from_account_id = str(uuid4())
            case "source":
                record.from_source = ConversationFromSource.API
            case "end-user":
                record.from_end_user_id = str(uuid4())

    response = harness.get(message_id=message_id)

    _assert_error(response, 404, "not_found", "Message not found" if entity == "message" else "Conversation not found")
    assert harness.provider.histories == []
    assert harness.usage() is None
    harness.assert_closed()


def test_deleted_conversation_is_not_visible(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values(is_deleted=True))
    _assert_error(harness.get(), 404, "not_found", "Conversation not found")
    assert harness.provider.histories == []
    harness.assert_closed()


@pytest.mark.parametrize("config", [None, '{"enabled":false}'])
def test_disabled_or_unset_suggestions_have_specific_error(harness: _Harness, config: str | None) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.config.id)
            .values(suggested_questions_after_answer=config)
        )
    _assert_error(harness.get(), 403, "app_suggested_questions_after_answer_disabled")
    assert harness.provider.histories == []
    harness.assert_closed()


def test_absent_default_model_keeps_empty_success(harness: _Harness) -> None:
    harness.provider.missing_model = True
    response = harness.get()
    assert response.status_code == 200
    assert response.get_json() == {"data": []}
    assert harness.provider.histories == []
    assert harness.provider.trace_queue.items == []
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW, AppMode.AGENT])
def test_unsupported_app_modes_fail_before_runtime(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    _assert_error(harness.get(), 400, "not_chat_app")
    assert len(harness.provider.read_sessions) == 1
    assert harness.legacy_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("denial", "status", "code"),
    [
        ("setup", 401, "not_setup"),
        ("feature", 403, "trial_app_feature_disabled"),
        ("missing_trial", 403, "trial_app_not_allowed"),
        ("missing_app", 403, "trial_app_not_allowed"),
        ("quota", 403, "trial_app_limit_exceeded"),
        ("uninitialized", 400, "account_not_initialized"),
        ("unauthenticated", 401, "unauthorized"),
    ],
)
def test_admission_blocks_before_runtime(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, denial: str, status: int, code: str
) -> None:
    if denial == "setup":
        harness.features.setup_completed = False
    elif denial == "feature":
        harness.features.enabled = False
    elif denial == "uninitialized":
        harness.account.status = AccountStatus.UNINITIALIZED
    elif denial == "unauthenticated":
        monkeypatch.setattr(login_module, "current_user", None)
    else:
        with harness.factory.begin() as session:
            if denial == "missing_trial":
                session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
            elif denial == "missing_app":
                session.execute(delete(App).where(App.id == harness.target.id))
            else:
                session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))
    response = harness.get()
    if denial == "unauthenticated":
        assert response.status_code == 401
        assert response.get_json() == {"code": "unauthorized", "message": "Unauthorized."}
    else:
        _assert_error(response, status, code)
    assert harness.legacy_sessions == []
    assert harness.provider.histories == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("failure", "code", "message"),
    [
        (
            ProviderTokenNotInitError("Missing tenant credentials"),
            "provider_not_initialize",
            "Missing tenant credentials",
        ),
        (QuotaExceededError(), "provider_quota_exceeded", None),
        (ModelCurrentlyNotSupportError(), "model_currently_not_support", None),
        (InvokeError("Provider unavailable"), "completion_request_error", "Provider unavailable"),
    ],
)
def test_provider_failures_preserve_specific_errors_and_close_session(
    harness: _Harness, failure: Exception, code: str, message: str | None
) -> None:
    harness.provider.failure = failure
    _assert_error(harness.get(), 400, code, message)
    assert len(harness.provider.histories) == 1
    assert harness.provider.trace_queue.items == []
    assert harness.usage() is None
    harness.assert_closed()


@pytest.mark.parametrize("failure", [None, InvokeError("Provider unavailable")])
def test_runtime_preserves_outer_request_session(harness: _Harness, failure: Exception | None) -> None:
    harness.provider.failure = failure
    with harness.app.app_context():
        outer_session = db.session()
        app_model = outer_session.get(App, harness.target.id)
        assert app_model is not None
        app_model.name = "Pending caller change"

        response = harness.get()

        assert response.status_code == (200 if failure is None else 400)
        assert db.session() is outer_session
        assert outer_session.in_transaction()
        assert app_model in outer_session.dirty
        assert app_model.name == "Pending caller change"
        assert len(harness.legacy_sessions) == 2
        inner_session = harness.legacy_sessions[1]
        assert inner_session is not outer_session
        assert not inner_session.in_transaction()
        assert not inner_session.identity_map
    harness.assert_closed()
    with harness.factory() as session:
        saved_app = session.get(App, harness.target.id)
        assert saved_app is not None
        assert saved_app.name == "Trial app"


def test_advanced_chat_without_published_workflow_keeps_empty_success(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.ADVANCED_CHAT))
    response = harness.get()
    assert response.status_code == 200
    assert response.get_json() == {"data": []}
    assert len(harness.provider.read_sessions) == 2
    assert harness.provider.histories == []
    assert harness.usage() is None
    harness.assert_closed()


@pytest.mark.parametrize(
    ("failure", "status", "code", "message"),
    [
        (AppDefinitionUnavailableError("App changed after admission"), 400, "app_unavailable", None),
        (SuggestedQuestionsActorNotFoundError("Account disappeared"), 401, "unauthorized", "Account no longer exists."),
    ],
)
def test_reload_errors_have_explicit_http_mapping(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    status: int,
    code: str,
    message: str | None,
) -> None:
    def reject_reload(
        _self: MessageSuggestedQuestionsRuntime,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: SuggestedQuestionsActor,
        message_id: str,
    ) -> list[str]:
        assert (app_id, app_owner_tenant_id, expected_app_mode, message_id) == (
            harness.target.id,
            harness.target.tenant_id,
            harness.target.mode,
            harness.message.id,
        )
        assert actor == SuggestedQuestionsAccount(account_id=harness.account.id, invoke_from="explore")
        raise failure

    monkeypatch.setattr(MessageSuggestedQuestionsRuntime, "get_suggested_questions", reject_reload)
    _assert_error(harness.get(), status, code, message)
    assert harness.provider.histories == []
    assert harness.usage() is None
    harness.assert_closed()
