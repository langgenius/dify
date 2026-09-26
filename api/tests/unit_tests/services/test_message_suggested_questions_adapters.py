"""Shared runtime ownership, configuration selection, and session lifecycle."""

import json
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal, cast
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

import services.message_service as message_module
from core.credit_usage import CreditUsageAppType
from core.model_context import get_credit_usage_metadata, use_credit_usage_metadata
from core.model_manager import ModelInstance
from core.ops.ops_trace_manager import TraceTask
from extensions.ext_database import db
from graphon.model_runtime.entities import PromptMessage
from graphon.model_runtime.entities.model_entities import ModelType
from models import Account, App, AppMode, Conversation, Message
from models.enums import ConversationFromSource, EndUserType
from models.model import AppModelConfig, EndUser
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
    prompts: list[str | None] = field(default_factory=list)
    histories: list[str] = field(default_factory=list)
    model_configs: list[object] = field(default_factory=list)
    metadata: list[Mapping[str, object] | None] = field(default_factory=list)
    traces: list[TraceTask] = field(default_factory=list)
    failure: Exception | None = None
    history_model_failure: bool = False

    def get_default_model_instance(self, *, tenant_id: str, model_type: ModelType) -> ModelInstance:
        assert tenant_id == self.tenant_id
        assert model_type == ModelType.LLM
        assert self.read_sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.read_sessions)
        if self.history_model_failure:
            raise RuntimeError("No history model")
        return cast(ModelInstance, self)

    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int:
        return len(prompt_messages)

    def generate(
        self, *, tenant_id: str, histories: str, instruction_prompt: str | None, model_config: object
    ) -> list[str]:
        assert tenant_id == self.tenant_id
        self.prompts.append(instruction_prompt)
        self.histories.append(histories)
        self.model_configs.append(model_config)
        self.metadata.append(get_credit_usage_metadata())
        if self.failure is not None:
            raise self.failure
        return ["What next?"]

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

    provider = _Provider(read_sessions, target.tenant_id)

    def model_manager(*, tenant_id: str) -> _Provider:
        assert tenant_id == target.tenant_id
        return provider

    def trace_manager(*, app_id: str) -> _Provider:
        assert app_id == target.id
        return provider

    monkeypatch.setattr(message_module.ModelManager, "for_tenant", model_manager)
    monkeypatch.setattr(message_module.LLMGenerator, "generate_suggested_questions_after_answer", provider.generate)
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
            if provider_failure:
                with pytest.raises(RuntimeError, match="Provider unavailable"):
                    harness.get(actor)
            else:
                assert harness.get(actor) == ["What next?"]
            assert get_credit_usage_metadata() == inherited_metadata
            assert harness.provider.metadata == [{**(inherited_metadata or {}), "app_type": CreditUsageAppType.CHATBOT}]
        assert get_credit_usage_metadata() == original_metadata
        assert db.session() is caller_session
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
        assert caller_app.name == "Pending caller edit"
        assert len(harness.legacy_sessions) == 1
        assert harness.legacy_sessions[0] is not caller_session
        harness.assert_closed()
    assert harness.provider.prompts == ["Published questions"]
    assert harness.provider.histories == ["Human: How does this work?\nAssistant: Like this."]
    assert harness.provider.model_configs == [model_config]
    assert len(harness.provider.traces) == (0 if provider_failure else 1)


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
    assert not harness.provider.histories
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
    assert not harness.provider.histories
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
    assert len(harness.legacy_sessions) == 1
    assert not harness.provider.histories
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
    assert harness.provider.prompts == ["Draft questions" if invoke_from == "debugger" else "Published questions"]
    assert harness.provider.model_configs == [None]
    harness.assert_closed()
