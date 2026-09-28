"""Shared runtime ownership, configuration selection, and session lifecycle."""

import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal, cast
from uuid import uuid4

import httpx
import pytest
from flask import Flask, g
from sqlalchemy import Connection, Engine, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

import services.message_service as message_module
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.file import remote_fetcher
from core.model_context import get_credit_usage_metadata, use_credit_usage_metadata
from core.model_manager import ModelInstance
from core.ops.ops_trace_manager import TraceTask
from extensions.ext_database import db
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities import AssistantPromptMessage, PromptMessage
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from models import Account, App, AppMode, Conversation, Message
from models.enums import ConversationFromSource, CreatorUserRole, EndUserType
from models.model import AppModelConfig, EndUser, MessageFile
from models.workflow import Workflow, WorkflowType
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_suggested_questions_adapters import MessageSuggestedQuestionsRuntime
from services.message_suggested_questions_service import (
    SuggestedQuestionsAccount,
    SuggestedQuestionsActor,
    SuggestedQuestionsActorNotFoundError,
    SuggestedQuestionsEndUser,
)

type _InvokeFrom = Literal["debugger", "explore", "web-app", "service-api"]


@dataclass
class _Provider:
    read_sessions: list[Session]
    tenant_id: str
    app_id: str
    prompts: list[str] = field(default_factory=list)
    model_requests: list[tuple[str, str]] = field(default_factory=list)
    invocation_parameters: list[Mapping[str, object]] = field(default_factory=list)
    metadata: list[Mapping[str, object] | None] = field(default_factory=list)
    traces: list[TraceTask] = field(default_factory=list)
    model_sessions: list[Session] = field(default_factory=list)
    io_sessions: list[tuple[str, bool]] = field(default_factory=list)
    failure: Exception | None = None
    token_failure: Exception | None = None
    history_model_failure: bool = False
    generation_model_failure: bool = False

    def record_io(self, stage: str) -> None:
        self.io_sessions.append(
            (
                stage,
                all(
                    not session.in_transaction() and not session.identity_map
                    for session in self.read_sessions + self.model_sessions
                ),
            )
        )

    def _resolve_model(self, *, tenant_id: str, model_type: ModelType) -> ModelInstance:
        assert tenant_id == self.tenant_id
        assert model_type == ModelType.LLM
        assert self.read_sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.read_sessions)
        # Simulate ModelManager's real scoped database lookup, so both resolution
        # stages must dispose their sessions before token/schema/provider I/O.
        session = db.session()
        assert session.get(App, self.app_id) is not None
        self.model_sessions.append(session)
        if self.history_model_failure or (self.generation_model_failure and len(self.model_sessions) > 1):
            raise RuntimeError("No model available")
        return cast(ModelInstance, self)

    def get_default_model_instance(self, *, tenant_id: str, model_type: ModelType) -> ModelInstance:
        self.model_requests.append(("default", "default"))
        return self._resolve_model(tenant_id=tenant_id, model_type=model_type)

    def get_model_instance(self, *, tenant_id: str, model_type: ModelType, provider: str, model: str) -> ModelInstance:
        self.model_requests.append((provider, model))
        return self._resolve_model(tenant_id=tenant_id, model_type=model_type)

    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int:
        self.record_io("tokens")
        if self.token_failure is not None:
            raise self.token_failure
        return len(prompt_messages)

    def get_model_schema(self) -> AIModelEntity:
        self.record_io("schema")
        return AIModelEntity.model_construct(parameter_rules=[])

    def invoke_llm(
        self,
        *,
        prompt_messages: list[PromptMessage],
        model_parameters: Mapping[str, object],
        stop: list[str],
        stream: bool,
    ) -> LLMResult:
        self.record_io("invoke")
        assert stream is False
        assert stop == []
        self.invocation_parameters.append(model_parameters)
        self.prompts.append(prompt_messages[0].get_text_content())
        self.metadata.append(get_credit_usage_metadata())
        if self.failure is not None:
            raise self.failure
        return LLMResult(
            model="question-model",
            message=AssistantPromptMessage(content='["What next?"]'),
            usage=LLMUsage.empty_usage(),
        )

    def add_trace_task(self, task: TraceTask) -> None:
        self.traces.append(task)


@dataclass(frozen=True)
class _Harness:
    flask_app: Flask
    target: App
    account: Account
    end_user: EndUser
    conversation: Conversation
    message: Message
    factory: sessionmaker[Session]
    runtime: MessageSuggestedQuestionsRuntime
    provider: _Provider
    legacy_sessions: list[Session]

    def actor(self, invoke_from: _InvokeFrom) -> SuggestedQuestionsActor:
        if invoke_from in {"explore", "debugger"}:
            with self.factory.begin() as session:
                for model, record_id in ((Message, self.message.id), (Conversation, self.conversation.id)):
                    session.execute(
                        update(model)
                        .where(model.id == record_id)
                        .values(
                            from_source=ConversationFromSource.CONSOLE,
                            from_account_id=self.account.id,
                            from_end_user_id=None,
                        )
                    )
            return SuggestedQuestionsAccount(account_id=self.account.id, invoke_from=invoke_from)
        return SuggestedQuestionsEndUser(end_user_id=self.end_user.id, invoke_from=invoke_from)

    def get(self, actor: SuggestedQuestionsActor) -> list[str]:
        return self.runtime.get_suggested_questions(
            app_id=self.target.id,
            app_owner_tenant_id=self.target.tenant_id,
            expected_app_mode=self.target.mode,
            actor=actor,
            message_id=self.message.id,
        )

    def assert_closed(self) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.provider.read_sessions + self.legacy_sessions
        )
        assert all(closed for _stage, closed in self.provider.io_sessions), self.provider.io_sessions


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    target = App(
        id=str(uuid4()), tenant_id=str(uuid4()), name="Shared", mode=AppMode.CHAT, enable_site=True, enable_api=True
    )
    account = Account(name="Debugger", email="debugger@example.com")
    end_user = EndUser(
        tenant_id=target.tenant_id, app_id=target.id, type=EndUserType.SERVICE_API, session_id=str(uuid4())
    )
    config = AppModelConfig(
        app_id=target.id, suggested_questions_after_answer='{"enabled":true,"prompt":"Published questions"}'
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([target, account, end_user, config])
        session.flush()
        target.app_model_config_id = config.id
        conversation = Conversation(
            app_id=target.id,
            app_model_config_id=config.id,
            mode=AppMode.CHAT,
            name="End-user conversation",
            inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=target.id,
            conversation_id=conversation.id,
            inputs={},
            query="How does this work?",
            message={},
            message_unit_price=Decimal(0),
            answer="Like this.",
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
        )
        session.add(message)

    read_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    read_sessions: list[Session] = []

    @event.listens_for(read_factory, "after_begin")
    def track_read(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        read_sessions.append(session)

    provider = _Provider(read_sessions, target.tenant_id, target.id)

    def model_manager(*, tenant_id: str) -> _Provider:
        assert tenant_id == target.tenant_id
        return provider

    def trace_manager(*, app_id: str) -> _Provider:
        assert app_id == target.id
        return provider

    monkeypatch.setattr(message_module.ModelManager, "for_tenant", model_manager)
    monkeypatch.setattr(message_module, "TraceQueueManager", trace_manager)
    flask_app = Flask(__name__)
    flask_app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(flask_app)
    legacy_sessions: list[Session] = []

    def track_legacy(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        legacy_sessions.append(session)

    event.listen(db.session.session_factory, "after_begin", track_legacy)
    yield _Harness(
        flask_app,
        target,
        account,
        end_user,
        conversation,
        message,
        sqlite_session_factory,
        MessageSuggestedQuestionsRuntime(session_factory=read_factory),
        provider,
        legacy_sessions,
    )
    event.remove(db.session.session_factory, "after_begin", track_legacy)
    with flask_app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("change", ["app_id", "tenant", "mode", "account"])
def test_runtime_rejects_stale_reference_before_legacy_queries(
    harness: _Harness, change: Literal["app_id", "tenant", "mode", "account"]
) -> None:
    account_id = str(uuid4()) if change == "account" else harness.account.id
    app_id = str(uuid4()) if change == "app_id" else harness.target.id
    error_type = SuggestedQuestionsActorNotFoundError if change == "account" else AppDefinitionUnavailableError
    with pytest.raises(error_type, match=account_id if change == "account" else app_id):
        harness.runtime.get_suggested_questions(
            app_id=app_id,
            app_owner_tenant_id=str(uuid4()) if change == "tenant" else harness.target.tenant_id,
            expected_app_mode=AppMode.ADVANCED_CHAT if change == "mode" else harness.target.mode,
            actor=SuggestedQuestionsAccount(account_id=account_id, invoke_from="explore"),
            message_id=harness.message.id,
        )
    assert len(harness.provider.read_sessions) == 1
    assert not harness.legacy_sessions
    harness.assert_closed()


@pytest.mark.parametrize("change", ["missing", "tenant", "app"])
def test_end_user_reload_requires_the_admitted_app_owner(
    harness: _Harness, change: Literal["missing", "tenant", "app"]
) -> None:
    end_user_id = str(uuid4()) if change == "missing" else harness.end_user.id
    if change != "missing":
        values = {"tenant_id" if change == "tenant" else "app_id": str(uuid4())}
        with harness.factory.begin() as session:
            session.execute(update(EndUser).where(EndUser.id == end_user_id).values(values))
    with pytest.raises(SuggestedQuestionsActorNotFoundError, match=end_user_id):
        harness.get(SuggestedQuestionsEndUser(end_user_id=end_user_id, invoke_from="service-api"))
    assert not harness.legacy_sessions
    harness.assert_closed()


@pytest.mark.parametrize("invoke_from", ["debugger", "explore", "web-app", "service-api"])
@pytest.mark.parametrize("provider_failure", [False, True])
def test_runtime_preserves_history_configuration_credit_context_and_caller_session(
    harness: _Harness, invoke_from: _InvokeFrom, provider_failure: bool
) -> None:
    if provider_failure:
        harness.provider.failure = RuntimeError("Provider unavailable")
    actor = harness.actor(invoke_from)
    model_config = {"provider": "vendor", "name": "question-model"}
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.target.app_model_config_id)
            .values(
                suggested_questions_after_answer=json.dumps(
                    {"enabled": True, "prompt": "Published questions", "model": model_config}
                )
            )
        )
    with harness.flask_app.app_context():
        caller_session = db.session()
        caller_app = caller_session.get(App, harness.target.id)
        assert caller_app is not None
        caller_app.name = "Pending caller edit"
        harness.legacy_sessions.clear()
        original_metadata = get_credit_usage_metadata()
        with use_credit_usage_metadata({"request_id": "suggestions-request"}):
            inherited_metadata = get_credit_usage_metadata()
            assert harness.get(actor) == ([] if provider_failure else ["What next?"])
            assert get_credit_usage_metadata() == inherited_metadata
            assert harness.provider.metadata == [
                {
                    **(inherited_metadata or {}),
                    "app_type": CreditUsageAppType.CHATBOT,
                    "created_by": CreditUsageCreatedBy.SUGGESTED_QUESTIONS,
                }
            ]
        assert get_credit_usage_metadata() == original_metadata
        assert db.session() is caller_session
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
        assert caller_app.name == "Pending caller edit"
        assert len(harness.provider.model_sessions) == 2
        assert harness.provider.model_sessions[0] is not harness.provider.model_sessions[1]
        assert all(session is not caller_session for session in harness.legacy_sessions)
        harness.assert_closed()
    assert len(harness.provider.prompts) == 1
    assert harness.provider.prompts[0].startswith(
        "Human: How does this work?\nAssistant: Like this.\nPublished questions\n"
    )
    assert harness.provider.model_requests == [("default", "default"), ("vendor", "question-model")]
    assert [stage for stage, _closed in harness.provider.io_sessions] == ["tokens", "invoke"]
    assert harness.provider.invocation_parameters == [{}]
    assert len(harness.provider.traces) == 1


@pytest.mark.parametrize("invoke_from", ["explore", "service-api"])
@pytest.mark.parametrize("entity", ["message", "conversation"])
@pytest.mark.parametrize("change", ["id", "app_id", "from_account_id", "from_end_user_id", "from_source"])
def test_message_and_conversation_ownership_are_enforced(
    harness: _Harness,
    invoke_from: Literal["explore", "service-api"],
    entity: Literal["message", "conversation"],
    change: Literal["id", "app_id", "from_account_id", "from_end_user_id", "from_source"],
) -> None:
    actor = harness.actor(invoke_from)
    model = Message if entity == "message" else Conversation
    record_id = harness.message.id if entity == "message" else harness.conversation.id
    if change == "from_source":
        value = ConversationFromSource.API if invoke_from == "explore" else ConversationFromSource.CONSOLE
    else:
        value = str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(model).where(model.id == record_id).values({change: value}))
    error_type = MessageNotExistsError if entity == "message" else ConversationNotExistsError
    with harness.flask_app.app_context(), pytest.raises(error_type):
        harness.get(actor)
    assert not harness.provider.prompts
    harness.assert_closed()


@pytest.mark.parametrize("invoke_from", ["explore", "web-app"])
def test_actor_cannot_read_a_deleted_conversation(
    harness: _Harness, invoke_from: Literal["explore", "web-app"]
) -> None:
    actor = harness.actor(invoke_from)
    with harness.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values(is_deleted=True))
    with harness.flask_app.app_context(), pytest.raises(ConversationNotExistsError):
        harness.get(actor)
    assert not harness.provider.prompts
    harness.assert_closed()


@pytest.mark.parametrize("case", ["disabled", "missing_workflow", "history_provider_failure"])
def test_account_preserves_disabled_feature_and_missing_workflow_or_model_behavior(
    harness: _Harness, case: Literal["disabled", "missing_workflow", "history_provider_failure"]
) -> None:
    actor = harness.actor("explore")
    with harness.factory.begin() as session:
        if case == "disabled":
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == harness.target.app_model_config_id)
                .values(suggested_questions_after_answer='{"enabled":false}')
            )
        elif case == "missing_workflow":
            session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.ADVANCED_CHAT))
            # Admit the new mode so this covers missing workflow, not a stale reference.
            harness.target.mode = AppMode.ADVANCED_CHAT
        else:
            harness.provider.history_model_failure = True
    with harness.flask_app.app_context():
        if case == "disabled":
            with pytest.raises(SuggestedQuestionsAfterAnswerDisabledError):
                harness.get(actor)
        else:
            assert harness.get(actor) == []
    assert len(harness.legacy_sessions) == (1 if case == "history_provider_failure" else 0)
    assert not harness.provider.prompts
    assert not harness.provider.traces
    harness.assert_closed()


@pytest.mark.parametrize("invoke_from", ["debugger", "explore"])
def test_advanced_chat_debugger_uses_draft_while_explore_uses_published_workflow(
    harness: _Harness, invoke_from: Literal["debugger", "explore"]
) -> None:
    actor = harness.actor(invoke_from)
    with harness.factory.begin() as session:
        for version, prompt in ((Workflow.VERSION_DRAFT, "Draft questions"), ("published", "Published questions")):
            workflow = Workflow(
                tenant_id=harness.target.tenant_id,
                app_id=harness.target.id,
                type=WorkflowType.CHAT,
                version=version,
                graph='{"nodes":[],"edges":[]}',
                features=json.dumps({"suggested_questions_after_answer": {"enabled": True, "prompt": prompt}}),
                created_by=harness.account.id,
            )
            session.add(workflow)
            session.flush()
            if version != Workflow.VERSION_DRAFT:
                session.execute(update(App).where(App.id == harness.target.id).values({App.workflow_id: workflow.id}))
        session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.ADVANCED_CHAT))
        session.execute(
            update(Conversation).where(Conversation.id == harness.conversation.id).values(mode=AppMode.ADVANCED_CHAT)
        )
    with harness.flask_app.app_context():
        assert harness.runtime.get_suggested_questions(
            app_id=harness.target.id,
            app_owner_tenant_id=harness.target.tenant_id,
            expected_app_mode=AppMode.ADVANCED_CHAT,
            actor=actor,
            message_id=harness.message.id,
        ) == ["What next?"]
    expected_prompt = "Draft questions" if invoke_from == "debugger" else "Published questions"
    assert len(harness.provider.prompts) == 1
    assert expected_prompt in harness.provider.prompts[0]
    assert harness.provider.model_requests == [("default", "default"), ("default", "default")]
    assert [stage for stage, _closed in harness.provider.io_sessions] == ["tokens", "schema", "invoke"]
    harness.assert_closed()


@pytest.mark.parametrize("failure_stage", ["tokens", "generation_model"])
def test_runtime_releases_sessions_when_history_or_second_model_stage_fails(
    harness: _Harness, failure_stage: Literal["tokens", "generation_model"]
) -> None:
    actor = harness.actor("explore")
    if failure_stage == "tokens":
        harness.provider.token_failure = RuntimeError("Token counter unavailable")
    else:
        harness.provider.generation_model_failure = True
    with harness.flask_app.app_context():
        if failure_stage == "tokens":
            with pytest.raises(RuntimeError, match="Token counter unavailable"):
                harness.get(actor)
        else:
            assert harness.get(actor) == []
    assert len(harness.provider.model_sessions) == (1 if failure_stage == "tokens" else 2)
    assert not harness.provider.prompts
    assert len(harness.provider.traces) == (0 if failure_stage == "tokens" else 1)
    harness.assert_closed()


@pytest.mark.parametrize("remote_failure", [False, True])
def test_remote_attachment_is_loaded_after_history_and_model_sessions_close(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, remote_failure: bool
) -> None:
    actor = harness.actor("explore")
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.target.app_model_config_id)
            .values(
                file_upload=json.dumps(
                    {"enabled": True, "allowed_file_types": ["image"], "allowed_file_upload_methods": ["remote_url"]}
                )
            )
        )
        session.add(
            MessageFile(
                message_id=harness.message.id,
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.REMOTE_URL,
                url="https://example.com/history.png",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=harness.account.id,
            )
        )
    requests: list[str] = []

    def fetch(method: str, url: str, **_kwargs: object) -> httpx.Response:
        harness.provider.record_io("attachment")
        requests.append(method)
        assert url == "https://example.com/history.png"
        if remote_failure:
            raise RuntimeError("Attachment unavailable")
        return httpx.Response(
            200,
            headers={"content-type": "image/png", "content-length": "3"},
            content=b"png",
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr(remote_fetcher, "make_request", fetch)
    with harness.flask_app.app_context():
        if remote_failure:
            with pytest.raises(RuntimeError, match="Attachment unavailable"):
                harness.get(actor)
        else:
            assert harness.get(actor) == ["What next?"]
    assert requests
    assert requests[0] == "HEAD"
    if remote_failure:
        assert not harness.provider.prompts
        assert not harness.provider.traces
    else:
        assert harness.provider.prompts[0].startswith("Human: [image]\nHow does this work?\nAssistant: Like this.")
    harness.assert_closed()


@pytest.mark.parametrize("failure_stage", [None, "provider_sql", "trace"])
def test_runtime_keeps_its_context_state_while_releasing_sessions_and_preserving_the_caller(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, failure_stage: Literal["provider_sql", "trace"] | None
) -> None:
    actor = harness.actor("explore")
    runtime_steps: list[str] = []
    invocation_sessions: list[Session] = []
    trace_sessions: list[Session] = []
    resolve_model = harness.provider._resolve_model
    count_tokens = harness.provider.get_llm_num_tokens
    invoke_llm = harness.provider.invoke_llm

    def resolve(*, tenant_id: str, model_type: ModelType) -> ModelInstance:
        assert g.get("caller_marker") is None
        if not runtime_steps:
            g.suggested_question_steps = runtime_steps
        assert g.get("suggested_question_steps") is runtime_steps
        runtime_steps.append("model")
        return resolve_model(tenant_id=tenant_id, model_type=model_type)

    def tokens(prompt_messages: Sequence[PromptMessage]) -> int:
        assert g.get("suggested_question_steps") is runtime_steps
        runtime_steps.append("tokens")
        return count_tokens(prompt_messages)

    def invoke(
        *, prompt_messages: list[PromptMessage], model_parameters: Mapping[str, object], stop: list[str], stream: bool
    ) -> LLMResult:
        assert g.get("suggested_question_steps") is runtime_steps
        runtime_steps.append("invoke")
        if failure_stage == "provider_sql":
            # A real failed flush poisons this scoped session. LLMGenerator
            # catches the error, so tracing must receive a fresh session.
            session = db.session()
            invocation_sessions.append(session)
            session.add(
                App(id=harness.target.id, tenant_id=harness.target.tenant_id, name="Duplicate", mode=AppMode.CHAT)
            )
            try:
                session.flush()
            finally:
                assert not session.is_active
        return invoke_llm(prompt_messages=prompt_messages, model_parameters=model_parameters, stop=stop, stream=stream)

    def trace(task: TraceTask) -> None:
        assert g.get("suggested_question_steps") is runtime_steps
        runtime_steps.append("trace")
        session = db.session()
        trace_sessions.append(session)
        app = session.get(App, harness.target.id)
        assert app is not None
        assert app.name == "Shared"
        if failure_stage == "trace":
            raise RuntimeError("Trace backend unavailable")
        harness.provider.traces.append(task)

    monkeypatch.setattr(harness.provider, "_resolve_model", resolve)
    monkeypatch.setattr(harness.provider, "get_llm_num_tokens", tokens)
    monkeypatch.setattr(harness.provider, "invoke_llm", invoke)
    monkeypatch.setattr(harness.provider, "add_trace_task", trace)
    with harness.flask_app.app_context():
        caller_marker = object()
        g.caller_marker = caller_marker
        caller_session = db.session()
        caller_app = caller_session.get(App, harness.target.id)
        assert caller_app is not None
        caller_app.name = "Pending caller edit"
        harness.legacy_sessions.clear()
        if failure_stage == "trace":
            with pytest.raises(RuntimeError, match="Trace backend unavailable"):
                harness.get(actor)
        else:
            assert harness.get(actor) == ([] if failure_stage == "provider_sql" else ["What next?"])
        assert g.caller_marker is caller_marker
        assert g.get("suggested_question_steps") is None
        assert db.session() is caller_session
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
        assert caller_app.name == "Pending caller edit"
        assert all(session is not caller_session for session in harness.legacy_sessions)
        harness.assert_closed()

    assert runtime_steps == ["model", "tokens", "model", "invoke", "trace"]
    assert len(trace_sessions) == 1
    assert not trace_sessions[0].in_transaction()
    if failure_stage == "provider_sql":
        assert len(invocation_sessions) == 1
        assert trace_sessions[0] is not invocation_sessions[0]
    with harness.factory() as session:
        persisted_app = session.get(App, harness.target.id)
        assert persisted_app is not None
        assert persisted_app.name == "Shared"
