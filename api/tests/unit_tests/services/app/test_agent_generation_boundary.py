"""Public Agent generation uses only the injected database and releases it before I/O."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal, TypedDict, override

import pytest
from flask import Flask
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.app_config.entities import EasyUIBasedAppConfig
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import (
    AgentAppGenerateEntity,
    AgentChatAppGenerateEntity,
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
    DifyRunContext,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
)
from core.app.entities.task_entities import ChatbotAppBlockingResponse
from graphon.file import File
from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
from models.agent import AgentConfigDraft
from models.agent_config_entities import AgentSoulConfig
from models.annotation_reply import AnnotationReplies, AnnotationReply
from models.model import Account, App, AppMode, Conversation, EndUser, Message
from models.tool_runtime_contracts import WorkflowToolQueries
from repositories.agent.app_execution_repository import AgentAppExecutionRepository
from repositories.app.generation_repository import AppGenerationRepository
from services.app.generation.adapters import agent_app
from services.app.generation.adapters.agent_app import AgentAppGenerator
from services.app.generation.adapters.agent_runner import AgentAppRunner
from services.tools.provider_queries import ToolProviders
from tests.unit_tests.model_factories import make_account, make_app
from tests.unit_tests.repositories.agent.test_app_execution_repository import seed_agent


@pytest.fixture
def agent_sessions(sqlite_session_factory: sessionmaker[Session]) -> sessionmaker[Session]:
    return seed_agent(sqlite_session_factory)


class InlineThread:
    def __init__(self, *, target: Callable[..., object], kwargs: dict[str, object]) -> None:
        self.target = target
        self.kwargs = kwargs

    def start(self) -> None:
        self.target(**self.kwargs)


class BackendCall(TypedDict):
    agent_soul: AgentSoulConfig
    agent_config_snapshot_id: str
    session_scope_snapshot_id: object
    query: str


@dataclass
class Backend(AgentAppRunner):
    assert_released: Callable[[], None]
    calls: list[BackendCall] = field(default_factory=list)

    @override
    def run(
        self,
        *,
        dify_context: DifyRunContext,
        agent_id: str,
        agent_config_snapshot_id: str,
        agent_config_version_kind: Literal["snapshot", "draft", "build_draft"] = "snapshot",
        agent_soul: AgentSoulConfig,
        home_snapshot_id: str | None,
        conversation_id: str,
        query: str,
        message_id: str,
        model_name: str,
        queue_manager: AppQueueManager,
        files: list[File] | None = None,
        image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
        session_scope_snapshot_id: object = None,
        build_draft_id: str | None = None,
    ) -> None:
        self.assert_released()
        self.calls.append(
            {
                "agent_soul": agent_soul,
                "agent_config_snapshot_id": agent_config_snapshot_id,
                "session_scope_snapshot_id": session_scope_snapshot_id,
                "query": query,
            }
        )


class BoundaryGenerator(AgentAppGenerator):
    backend: Backend

    @override
    def _build_runner(self) -> AgentAppRunner:
        return self.backend

    @override
    def _run_input_guards(
        self,
        *,
        application_generate_entity: AgentAppGenerateEntity,
        app_model: App,
        message: Message,
        queue_manager: AppQueueManager,
    ) -> tuple[bool, str, AnnotationReply | None]:
        self.backend.assert_released()
        return False, application_generate_entity.query, None

    @override
    def _handle_response(
        self,
        application_generate_entity: ChatAppGenerateEntity | CompletionAppGenerateEntity | AgentChatAppGenerateEntity,
        queue_manager: AppQueueManager,
        conversation: Conversation,
        message: Message,
        user: Account | EndUser,
        stream: bool = False,
    ) -> ChatbotAppBlockingResponse:
        self.backend.assert_released()
        return ChatbotAppBlockingResponse(
            task_id=application_generate_entity.task_id,
            data=ChatbotAppBlockingResponse.Data(
                id=message.id,
                mode=conversation.mode.value,
                conversation_id=conversation.id,
                message_id=message.id,
                answer="",
                created_at=int(message.created_at.timestamp()),
            ),
        )


@pytest.mark.usefixtures("unbound_session_factory")
@pytest.mark.parametrize("draft_type", [None, "debug_build"])
def test_generate_closes_config_and_message_transactions(
    agent_sessions: sessionmaker[Session],
    app: Flask,
    app_records: AppGenerationRepository,
    annotation_replies: AnnotationReplies,
    tool_providers: ToolProviders,
    workflow_queries: WorkflowToolQueries,
    monkeypatch: pytest.MonkeyPatch,
    draft_type: Literal["debug_build"] | None,
) -> None:
    """Keep global factories unbound; neither input preparation nor backend waiting may hold a read transaction."""
    sessions = agent_sessions
    app_model = make_app(app_id="app", tenant_id="tenant", mode=AppMode.AGENT)
    user = make_account(account_id="account")
    with sessions.begin() as session:
        session.add(app_model)
        if draft_type:
            from tests.unit_tests.repositories.agent.test_app_execution_repository import add_build_draft

            add_build_draft(session)
    engine: Engine = sessions.kw["bind"]
    pool = engine.pool
    assert isinstance(pool, QueuePool)

    def assert_released() -> None:
        assert pool.checkedout() == 0

    def convert_model(_app_config: EasyUIBasedAppConfig) -> ModelConfigWithCredentialsEntity:
        assert_released()
        return ModelConfigWithCredentialsEntity.model_construct(
            provider="langgenius/openai/openai", model="gpt-4o-mini", mode="chat"
        )

    generator = BoundaryGenerator(
        tool_providers=tool_providers,
        agent_configs=AgentAppExecutionRepository(sessions),
        annotations=annotation_replies,
        records=app_records,
        workflow_queries=workflow_queries,
    )
    backend = Backend(assert_released)
    generator.backend = backend
    monkeypatch.setattr(agent_app.ModelConfigConverter, "convert", convert_model)
    monkeypatch.setattr(agent_app, "TraceQueueManager", lambda *_args: None)
    monkeypatch.setattr(agent_app.threading, "Thread", InlineThread)
    monkeypatch.setattr(agent_app.AgentAppGenerateResponseConverter, "convert", lambda **kwargs: kwargs["response"])

    with app.app_context():
        generator.generate(
            app_model=app_model,
            user=user,
            args={"query": "original question", "inputs": {}, "draft_type": draft_type},
            invoke_from=InvokeFrom.DEBUGGER,
        )
        assert len(backend.calls) == 1
        first = backend.calls[0]
        assert first["agent_soul"].prompt.system_prompt == ("build" if draft_type else "Published")
        with sessions.begin() as session:
            assert session.get(AgentConfigDraft, first["agent_config_snapshot_id"]) is not None
    assert first["session_scope_snapshot_id"] == first["agent_config_snapshot_id"]
    assert first["query"] == "original question"
    assert_released()
    with sessions() as session:
        assert len(session.scalars(select(Message)).all()) == 1
