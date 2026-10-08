"""Public Agent generate/resume calls use only the injected database and release it before I/O."""

from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, ModelConfigWithCredentialsEntity
from models.agent import AgentConfigDraft
from models.model import AppMode, Conversation, Message
from repositories.agent.app_execution_repository import AgentAppExecutionRepository
from services.app.generation.adapters import agent_app
from services.app.generation.adapters.agent_app import AgentAppGenerator
from tests.unit_tests.model_factories import make_account, make_app
from tests.unit_tests.repositories.agent.test_app_execution_repository import seed_agent


@pytest.fixture
def agent_sessions(sqlite_session_factory):
    return seed_agent(sqlite_session_factory)


class InlineThread:
    def __init__(self, *, target, kwargs):
        self.target = target
        self.kwargs = kwargs

    def start(self):
        self.target(**self.kwargs)


@dataclass
class Backend:
    assert_released: Callable[[], None]
    calls: list[dict] = field(default_factory=list)

    def run(self, **kwargs):
        self.assert_released()
        self.calls.append(kwargs)


class BoundaryGenerator(AgentAppGenerator):
    def _build_runner(self):
        return self.backend

    def _run_input_guards(self, *, application_generate_entity, **_kwargs):
        self.backend.assert_released()
        return False, application_generate_entity.query, None

    def _handle_response(self, **_kwargs):
        self.backend.assert_released()
        return {}


@pytest.mark.usefixtures("unbound_session_factory")
@pytest.mark.parametrize("draft_type", [None, "debug_build"])
def test_generate_and_resume_close_config_and_message_transactions(
    agent_sessions: sessionmaker[Session],
    app,
    app_records,
    annotation_replies,
    human_forms,
    tool_providers,
    workflow_queries,
    monkeypatch,
    draft_type,
):
    """Keep global factories unbound; neither input preparation nor backend waiting may hold a read transaction."""
    sessions = agent_sessions
    app_model = make_app(app_id="app", tenant_id="tenant", mode=AppMode.AGENT)
    user = make_account(account_id="account")
    with sessions.begin() as session:
        session.add(app_model)
        if draft_type:
            from tests.unit_tests.repositories.agent.test_app_execution_repository import add_build_draft

            add_build_draft(session)
    engine = sessions.kw["bind"]

    def assert_released():
        assert engine.pool.checkedout() == 0

    def convert_model(_app_config):
        assert_released()
        return ModelConfigWithCredentialsEntity.model_construct(
            provider="langgenius/openai/openai", model="gpt-4o-mini", mode="chat"
        )

    generator = BoundaryGenerator(
        tool_providers=tool_providers,
        agent_configs=AgentAppExecutionRepository(sessions),
        forms=human_forms,
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
            conversation = session.scalar(select(Conversation))
            assert conversation is not None
            conversation_id = conversation.id
            if draft_type:
                from models.agent import (
                    AgentConfigVersionKind,
                    AgentWorkspace,
                    AgentWorkspaceBinding,
                    AgentWorkspaceOwnerType,
                )

                workspace = AgentWorkspace(
                    id="build-workspace",
                    tenant_id="tenant",
                    app_id="app",
                    owner_type=AgentWorkspaceOwnerType.BUILD_DRAFT,
                    owner_id="build",
                    owner_scope_key="root",
                    backend_workspace_ref="workspace",
                )
                binding = AgentWorkspaceBinding(
                    id="build-binding",
                    tenant_id="tenant",
                    app_id="app",
                    workspace_id=workspace.id,
                    agent_id="agent",
                    agent_config_version_id="build",
                    agent_config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
                    backend_binding_ref="binding",
                    pending_form_id="form",
                )
                session.add_all([workspace, binding])
                session.get(AgentConfigDraft, "build").agent_workspace_binding_id = binding.id
        generator.resume_after_form_submission(
            app_model=app_model,
            user=user,
            conversation_id=conversation_id,
            form_id="form",
            invoke_from=InvokeFrom.DEBUGGER,
        )
    assert len(backend.calls) == 2
    resumed = backend.calls[1]
    assert resumed["agent_config_snapshot_id"] == first["agent_config_snapshot_id"]
    assert resumed["session_scope_snapshot_id"] == first["agent_config_snapshot_id"]
    assert resumed["query"] == "original question"
    assert_released()
    with sessions() as session:
        assert len(session.scalars(select(Message)).all()) == 2
