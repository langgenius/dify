"""Pipeline tool lifecycle through the real Engine and SQLAlchemy repositories."""

import json
from unittest.mock import Mock

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from clients.agent_backend import FakeAgentBackendRunClient, FakeAgentBackendScenario
from core.app.apps.pipeline.pipeline_runner import PipelineRunner
from core.app.entities.app_invoke_entities import InvokeFrom
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserActionConfig
from models import Account
from models.agent import AgentWorkspace, AgentWorkspaceBinding, WorkflowAgentBindingType
from models.dataset import Document
from models.enums import WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm
from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from services.agent.workspace_service import AgentWorkspaceService
from services.workflow_run_agg import WorkflowRunAgg
from tests.unit_tests.core.app.apps.pipeline.test_pipeline_runner import (
    _build_app_generate_entity,
    _build_runner,
    _document,
    _persist_scope,
    _workflow,
)
from tests.unit_tests.core.workflow.nodes.agent_v2.test_binding_resolver import _agent, _binding, _snapshot
from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _install_backend_client


def _pipeline_tool_runner(
    sqlite_engine: Engine, invoke_from: InvokeFrom, source_node_data: dict[str, object]
) -> tuple[PipelineRunner, SQLAlchemyWorkflowExecutionRepository, SQLAlchemyWorkflowNodeExecutionRepository]:
    source_graph = {
        "nodes": [
            {"id": "source-start", "data": {"type": "start", "title": "Start", "variables": list[object]()}},
            {"id": "source-node", "data": source_node_data},
            {"id": "source-end", "data": {"type": "end", "title": "End", "outputs": list[object]()}},
        ],
        "edges": [
            {"source": "source-start", "target": "source-node"},
            {"source": "source-node", "target": "source-end", "sourceHandle": "source"},
        ],
    }
    with Session(sqlite_engine, expire_on_commit=False) as session:
        session.add(
            App(
                id="source-app",
                tenant_id="tenant",
                name="Source",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
            )
        )
        session.add(
            Workflow(
                id="source-workflow",
                tenant_id="tenant",
                app_id="source-app",
                type="workflow",
                version="v1",
                graph=json.dumps(source_graph),
                features="{}",
                created_by="user",
            )
        )
        provider = WorkflowToolProvider(
            tenant_id="tenant",
            app_id="source-app",
            user_id="user",
            version="v1",
            name="source",
            label="Source",
            description="Source",
            icon="{}",
        )
        session.add(provider)
        session.flush()
        graph = {
            "nodes": [
                {"id": "start", "data": {"type": "start", "title": "Start", "variables": list[object]()}},
                {
                    "id": "tool",
                    "data": {
                        "type": "tool",
                        "title": "Tool",
                        "provider_id": provider.id,
                        "provider_type": "workflow",
                        "provider_name": "source",
                        "tool_name": "source",
                        "tool_label": "Source",
                        "tool_configurations": dict[str, object](),
                        "tool_parameters": dict[str, object](),
                    },
                },
            ],
            "edges": [{"source": "start", "target": "tool"}],
        }
        _, _, workflow = _persist_scope(session, workflow=_workflow(graph=graph), documents=(_document(),))
    entity = _build_app_generate_entity().model_copy(
        update={"invoke_from": invoke_from, "document_id": None if invoke_from == InvokeFrom.DEBUGGER else "doc"}
    )
    runner = _build_runner(entity, sqlite_engine, workflow)
    user = Account(name="User", email="pipeline@example.com")
    user.id = entity.user_id
    runs = SQLAlchemyWorkflowExecutionRepository(
        sqlite_engine,
        "tenant",
        user,
        "pipe",
        WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING
        if invoke_from == InvokeFrom.DEBUGGER
        else WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN,
    )
    nodes = SQLAlchemyWorkflowNodeExecutionRepository(
        sqlite_engine, "tenant", user, "pipe", WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN
    )
    return runner, runs, nodes


@pytest.mark.parametrize("invoke_from", [InvokeFrom.DEBUGGER, InvokeFrom.PUBLISHED_PIPELINE])
def test_pipeline_rejects_human_input_tool_before_creating_run_or_form(
    sqlite_engine: Engine, invoke_from: InvokeFrom
) -> None:
    human_input = HumanInputNodeData(title="Approval", user_actions=[UserActionConfig(id="approve", title="Approve")])
    runner, runs, nodes = _pipeline_tool_runner(sqlite_engine, invoke_from, human_input.model_dump(mode="json"))

    with pytest.raises(ValueError, match="Human Input nodes are not supported"):
        WorkflowRunAgg.run(runner, None, runs, nodes)

    with Session(sqlite_engine) as session:
        assert session.scalar(select(WorkflowRun)) is None
        assert session.scalar(select(WorkflowNodeExecutionModel)) is None
        assert session.scalar(select(HumanInputForm)) is None
        document = session.get(Document, "doc")
        assert document is not None
        if invoke_from == InvokeFrom.PUBLISHED_PIPELINE:
            assert document.indexing_status == "error"
            assert document.error == "Human Input nodes are not supported in this execution context."
        else:
            assert document.indexing_status == "waiting"
            assert document.error is None


@pytest.mark.parametrize("invoke_from", [InvokeFrom.DEBUGGER, InvokeFrom.PUBLISHED_PIPELINE])
@pytest.mark.parametrize(
    ("scenario", "status"),
    [(FakeAgentBackendScenario.SUCCESS, "succeeded"), (FakeAgentBackendScenario.FAILED, "failed")],
)
def test_pipeline_retires_nested_agent_workspace_when_run_ends(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    invoke_from: InvokeFrom,
    scenario: FakeAgentBackendScenario,
    status: str,
) -> None:
    runner, runs, nodes = _pipeline_tool_runner(
        sqlite_engine, invoke_from, {"type": "agent", "version": "2", "agent_node_kind": "dify_agent", "title": "Agent"}
    )
    with Session(sqlite_engine) as session:
        agent = _agent(tenant_id="tenant")
        session.add(agent)
        session.flush()
        snapshot = _snapshot(tenant_id="tenant", agent_id=agent.id)
        session.add(snapshot)
        session.flush()
        session.add(
            _binding(
                ids={
                    "tenant_id": "tenant",
                    "app_id": "source-app",
                    "workflow_id": "source-workflow",
                    "node_id": "source-node",
                },
                agent_id=agent.id,
                snapshot_id=snapshot.id,
                binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            )
        )
        session.commit()
    backend_client = _install_backend_client(monkeypatch)
    monkeypatch.setattr(
        "clients.agent_backend.factory.create_agent_backend_run_client",
        lambda **_kwargs: FakeAgentBackendRunClient(scenario=scenario),
    )
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.runtime_request_builder.resolve_model_context_window", lambda **_kwargs: None
    )
    collect_task = Mock()
    monkeypatch.setattr("tasks.collect_agent_resources_task.collect_agent_resources.delay", collect_task)

    WorkflowRunAgg.run(runner, None, runs, nodes)
    list(runner._queue_manager.listen())

    with Session(sqlite_engine) as session:
        run = session.get(WorkflowRun, runner.application_generate_entity.workflow_execution_id)
        assert run is not None
        assert run.status == status
        agent_execution = session.scalars(
            select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "source-node")
        ).one()
        assert agent_execution.status == status
        workspace = session.scalars(select(AgentWorkspace)).one()
        binding = session.scalars(select(AgentWorkspaceBinding)).one()
        assert (workspace.app_id, workspace.owner_id, workspace.status) == ("source-app", run.id, "retired")
        assert binding.status == "retired"
        workspace_id, binding_id = workspace.id, binding.id
    collect_task.assert_called_once_with(
        tenant_id="tenant", workspace_ids=[workspace_id], binding_ids=[], home_snapshot_ids=[], purge_agent_ids=[]
    )
    AgentWorkspaceService.collect_retired_workspace(tenant_id="tenant", workspace_id=workspace_id)
    backend_client.destroy_execution_binding_sync.assert_called_once()
    with Session(sqlite_engine) as session:
        assert session.get(AgentWorkspace, workspace_id) is None
        assert session.get(AgentWorkspaceBinding, binding_id) is None
