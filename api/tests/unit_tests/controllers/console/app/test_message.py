from __future__ import annotations

import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from http import HTTPStatus
from inspect import unwrap
from typing import cast
from unittest.mock import MagicMock
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
from controllers.console.app import message as message_module
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_manager import ModelInstance
from core.ops.ops_trace_manager import TraceTask
from extensions.application_services.app import AppServices
from extensions.application_services.rbac import RBACServices
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
from models.enums import ConversationFromSource, CreatorUserRole, FeedbackFromSource, FeedbackRating
from models.model import (
    App,
    AppAnnotationHitHistory,
    AppMode,
    AppModelConfig,
    Conversation,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageFeedback,
)
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
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_message
from tests.helpers.unit.rbac_fakes import RBACDomain


def _account() -> Account:
    account = Account(name="Account", email="account@example.com")
    account.id = "account-1"
    return account


def _app(*, app_id: str = "app-1") -> App:
    return App(
        id=app_id,
        tenant_id="tenant-1",
        name="Chat App",
        description="",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )


def _persist_message(session: Session, *, message_id: str, app_id: str = "app-1") -> Message:
    conversation = Conversation(
        app_id=app_id,
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.CHAT,
        name="Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.DEBUGGER,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="account-1",
    )
    conversation.id = "conversation-1"
    message = Message(
        app_id=app_id,
        conversation_id=conversation.id,
        inputs={},
        query="query",
        message="",
        message_tokens=0,
        message_unit_price=0,
        message_price_unit=0,
        answer="answer",
        answer_tokens=0,
        answer_unit_price=0,
        answer_price_unit=0,
        provider_response_latency=0,
        total_price=0,
        currency="USD",
        invoke_from=InvokeFrom.DEBUGGER,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="account-1",
        app_mode=AppMode.CHAT,
    )
    message.id = message_id
    session.add_all([_account(), _app(app_id=app_id), conversation, message])
    session.flush()
    return message


class TestMessageApiCases:
    @staticmethod
    def test_app_message_routes_pass_injected_session(
        app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
    ) -> None:
        session = unbound_session
        current_user = _account()
        app_model = _app()
        message_id = "550e8400-e29b-41d4-a716-446655440000"
        list_messages = MagicMock(return_value={"data": []})
        update_feedback = MagicMock(return_value={"result": "success"})
        get_message_detail = MagicMock(return_value={"id": message_id})
        monkeypatch.setattr(message_module, "_list_chat_messages", list_messages)
        monkeypatch.setattr(message_module, "_update_message_feedback", update_feedback)
        monkeypatch.setattr(message_module, "_get_message_detail", get_message_detail)

        assert unwrap(message_module.ChatMessageListApi.get)(
            message_module.ChatMessageListApi(),
            message_module.ChatMessagesQuery(conversation_id="550e8400-e29b-41d4-a716-446655440001"),
            session,
            current_user,
            app_model,
        ) == {"data": []}
        assert unwrap(message_module.MessageFeedbackApi.post)(
            message_module.MessageFeedbackApi(),
            message_module.AppMessageFeedbackPayload(message_id=message_id, rating="like"),
            session,
            current_user,
            app_model,
        ) == {"result": "success"}
        assert unwrap(message_module.MessageApi.get)(message_module.MessageApi(), session, app_model, message_id) == {
            "id": message_id
        }

        assert list_messages.call_args.kwargs["session"] is session
        assert update_feedback.call_args.kwargs["session"] is session
        assert get_message_detail.call_args.kwargs["session"] is session

    @staticmethod
    def test_update_message_feedback_commits_injected_session(app: Flask, sqlite_session: Session) -> None:
        message_id = "550e8400-e29b-41d4-a716-446655440000"
        message = _persist_message(sqlite_session, message_id=message_id)
        feedback = MessageFeedback(
            app_id=message.app_id,
            conversation_id=message.conversation_id,
            message_id=message.id,
            rating=FeedbackRating.DISLIKE,
            from_source=FeedbackFromSource.ADMIN,
            from_account_id="account-1",
        )
        sqlite_session.add(feedback)
        sqlite_session.commit()
        session = sqlite_session
        commits: list[str] = []
        event.listen(session, "after_commit", lambda _session: commits.append("commit"))

        with app.test_request_context(json={"message_id": message_id, "rating": "like", "content": "helpful"}):
            result = message_module._update_message_feedback(
                args=message_module.AppMessageFeedbackPayload(
                    message_id=message_id,
                    rating="like",
                    content="helpful",
                ),
                session=session,
                current_user=_account(),
                app_model=_app(),
            )

        assert result == {"result": "success"}
        updated_feedback = sqlite_session.get(MessageFeedback, feedback.id)
        assert updated_feedback is not None
        assert updated_feedback.rating == FeedbackRating.LIKE
        assert updated_feedback.content == "helpful"
        assert commits == ["commit"]

    @staticmethod
    def test_get_message_detail_uses_injected_session(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
        message_id = "550e8400-e29b-41d4-a716-446655440000"
        message = _persist_message(sqlite_session, message_id=message_id)
        response_source = object()
        response_source_factory = MagicMock(return_value=response_source)
        session = sqlite_session
        monkeypatch.setattr(message_module, "attach_message_extra_contents", MagicMock())
        monkeypatch.setattr(message_module, "MessageResponseSource", response_source_factory)
        monkeypatch.setattr(message_module, "dump_response", lambda _model, value: value)

        result = message_module._get_message_detail(
            session=session,
            app_model=_app(),
            message_id=message_id,
        )

        assert result is response_source
        response_source_factory.assert_called_once_with(message, session=session)

    @staticmethod
    def test_message_response_source_uses_caller_session_for_nested_fields(sqlite_session: Session) -> None:
        session = sqlite_session
        message_id = "550e8400-e29b-41d4-a716-446655440000"
        message = _persist_message(sqlite_session, message_id=message_id)
        message.inputs = {"topic": "support"}
        feedback = MessageFeedback(
            app_id=message.app_id,
            conversation_id=message.conversation_id,
            message_id=message.id,
            rating=FeedbackRating.LIKE,
            from_source=FeedbackFromSource.USER,
            from_account_id="account-1",
        )
        annotation = MessageAnnotation(
            app_id=message.app_id,
            question="Question",
            content="Answer",
            account_id="account-1",
            conversation_id=message.conversation_id,
            message_id=message.id,
        )
        annotation.id = "annotation-1"
        annotation_hit = AppAnnotationHitHistory(
            app_id=message.app_id,
            annotation_id=annotation.id,
            source="annotation",
            question="Question",
            account_id="account-1",
            score=0.0,
            message_id=message.id,
            annotation_question="Question",
            annotation_content="Answer",
        )
        thought = MessageAgentThought(
            message_id=message.id,
            position=1,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
            thought="Consider the request",
            tool_labels_str="{}",
            tool_meta_str="{}",
        )
        sqlite_session.add_all([feedback, annotation, annotation_hit, thought])
        sqlite_session.commit()

        source = message_module.MessageResponseSource(message, session=session)

        assert source.inputs == {"topic": "support"}
        assert source.user_feedback is feedback
        assert source.feedbacks[0].from_account.id == "account-1"
        annotation_source = source.annotation
        assert annotation_source is not None
        assert annotation_source.account.id == "account-1"
        annotation_hit_history_source = source.annotation_hit_history
        assert annotation_hit_history_source is not None
        assert annotation_hit_history_source.annotation_create_account.id == "account-1"
        assert source.agent_thoughts == [thought]
        assert source.message_files == []

    @staticmethod
    def test_chat_messages_query_valid(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test valid ChatMessagesQuery with all fields."""
        query = message_module.ChatMessagesQuery(
            conversation_id="550e8400-e29b-41d4-a716-446655440000",
            first_id="550e8400-e29b-41d4-a716-446655440001",
            limit=50,
        )
        assert query.limit == 50

    @staticmethod
    def test_chat_messages_query_defaults(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test ChatMessagesQuery with defaults."""
        query = message_module.ChatMessagesQuery(conversation_id="550e8400-e29b-41d4-a716-446655440000")
        assert query.first_id is None
        assert query.limit == 20

    @staticmethod
    def test_chat_messages_query_empty_first_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test ChatMessagesQuery converts empty first_id to None."""
        query = message_module.ChatMessagesQuery(
            conversation_id="550e8400-e29b-41d4-a716-446655440000",
            first_id="",
        )
        assert query.first_id is None

    @staticmethod
    def test_message_feedback_payload_valid_like(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test AppMessageFeedbackPayload with like rating."""
        payload = message_module.AppMessageFeedbackPayload(
            message_id="550e8400-e29b-41d4-a716-446655440000",
            rating="like",
            content="Good answer",
        )
        assert payload.rating == "like"
        assert payload.content == "Good answer"

    @staticmethod
    def test_message_feedback_payload_valid_dislike(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test AppMessageFeedbackPayload with dislike rating."""
        payload = message_module.AppMessageFeedbackPayload(
            message_id="550e8400-e29b-41d4-a716-446655440000",
            rating="dislike",
        )
        assert payload.rating == "dislike"

    @staticmethod
    def test_message_feedback_payload_no_rating(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test AppMessageFeedbackPayload without rating."""
        payload = message_module.AppMessageFeedbackPayload(message_id="550e8400-e29b-41d4-a716-446655440000")
        assert payload.rating is None

    @staticmethod
    def test_annotation_count_response(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test AnnotationCountResponse creation."""
        response = message_module.AnnotationCountResponse(count=10)
        assert response.count == 10

    @staticmethod
    def test_suggested_questions_response(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
        """Test SuggestedQuestionsResponse creation."""
        response = message_module.SuggestedQuestionsResponse(data=["What is AI?", "How does ML work?"])
        assert len(response.data) == 2
        assert response.data[0] == "What is AI?"

    @staticmethod
    def test_message_detail_response_normalizes_aliases_and_timestamp(
        app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Test MessageDetailResponse normalizes alias fields and datetime timestamps."""
        created_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
        response = message_module.MessageDetailResponse.model_validate(
            {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "conversation_id": "550e8400-e29b-41d4-a716-446655440001",
                "inputs": {"foo": "bar"},
                "query": "hello",
                "message": [{"text": "hello"}],
                "message_tokens": 7,
                "answer": "world",
                "answer_tokens": 11,
                "provider_response_latency": 1.25,
                "from_source": "user",
                "from_end_user_id": None,
                "from_account_id": "550e8400-e29b-41d4-a716-446655440002",
                "feedbacks": [],
                "workflow_run_id": None,
                "annotation": None,
                "annotation_hit_history": None,
                "status": "normal",
                "created_at": created_at,
                "agent_thoughts": [],
                "message_files": [],
                "message_metadata_dict": {"token_usage": 3},
                "error": None,
                "parent_message_id": None,
                "extra_contents": [],
            }
        )
        assert response.answer == "world"
        assert response.message_tokens == 7
        assert response.answer_tokens == 11
        assert response.provider_response_latency == 1.25
        assert response.metadata == {"token_usage": 3}
        assert response.created_at == int(created_at.timestamp())
        assert response.model_dump(mode="json") == {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "conversation_id": "550e8400-e29b-41d4-a716-446655440001",
            "inputs": {"foo": "bar"},
            "query": "hello",
            "message": [{"text": "hello"}],
            "message_tokens": 7,
            "answer": "world",
            "answer_tokens": 11,
            "provider_response_latency": 1.25,
            "from_source": "user",
            "from_end_user_id": None,
            "from_account_id": "550e8400-e29b-41d4-a716-446655440002",
            "feedbacks": [],
            "workflow_run_id": None,
            "annotation": None,
            "annotation_hit_history": None,
            "created_at": int(created_at.timestamp()),
            "agent_thoughts": [],
            "message_files": [],
            "metadata": {"token_usage": 3},
            "retriever_resources": [],
            "status": "normal",
            "error": None,
            "parent_message_id": None,
            "extra_contents": [],
        }


"""Console suggested-question admission and actor/configuration isolation over SQLite."""


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
    rbac: RBACServices


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


class TestMessageSuggestedQuestionsCases:
    @staticmethod
    @pytest.fixture
    def harness(
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
        sqlite_session_factory: sessionmaker[Session],
        app_services: AppServices,
        rbac_domain: RBACDomain,
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
            app_id=target.id,
            suggested_questions_after_answer=json.dumps({"enabled": True, "prompt": "Console questions"}),
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
        flask_app.config.update(
            TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url)
        )
        db.init_app(flask_app)
        services = _Services(
            app_services,
            _Agents(AgentAppAccessService(references=AgentAppRepository(session_factory=sqlite_session_factory))),
            MessageSuggestedQuestionsRuntime(session_factory=sqlite_session_factory),
            rbac_domain.rbac,
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
            flask_app,
            target,
            account,
            conversation,
            message,
            str(uuid4()),
            sqlite_session_factory,
            services,
            provider,
            [],
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

    @staticmethod
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

    @staticmethod
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
                        text("UPDATE apps SET status = :status WHERE id = :id"),
                        {"status": value, "id": harness.target.id},
                    )
                else:
                    session.execute(update(App).where(App.id == harness.target.id).values({field_name: value}))
        port = _Questions()
        harness.services.message_suggested_questions = port
        response = harness.get()
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.get_json()["code"] == "app_not_found"
        assert not port.calls

    @staticmethod
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

    @staticmethod
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
                        text("UPDATE apps SET status = :status WHERE id = :id"),
                        {"status": value, "id": harness.target.id},
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    @pytest.mark.parametrize("entity", [Message, Conversation])
    @pytest.mark.parametrize("change", ["app_id", "from_account_id", "from_source"])
    def test_runtime_cannot_read_another_accounts_message_or_conversation(
        harness: _Harness, entity: type[Message] | type[Conversation], change: str
    ) -> None:
        with harness.factory.begin() as session:
            session.execute(update(entity).values({change: "api" if change == "from_source" else str(uuid4())}))
        response = harness.get()
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.get_json()["message"] == (
            "Message not found" if entity is Message else "Conversation not found"
        )
        assert not harness.provider.prompts

    @staticmethod
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
            for owner, prompt in [
                (harness.account.id, "My personal draft"),
                (str(uuid4()), "Other accounts secret draft"),
            ]:
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

    @staticmethod
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
