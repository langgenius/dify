"""Real Composer saves keep binding and frozen graph session policies aligned."""

from uuid import UUID

from sqlalchemy.orm import Session
from typing_extensions import TypedDict

from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.model import AppMode
from models.workflow import Workflow
from services.agent.composer_service import AgentComposerService
from services.entities.agent_entities import ComposerSavePayload
from tests.helpers.unit.model_factories import make_account, make_app, make_workflow


class _ComposerGraph(TypedDict):
    nodes: list[dict[str, object]]
    edges: list[dict[str, object]]


def _create_composer_target(session: Session) -> tuple[Workflow, WorkflowAgentNodeBinding]:
    graph: _ComposerGraph = {
        "nodes": [{"id": "node-1", "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}],
        "edges": [],
    }
    workflow = make_workflow(workflow_id="workflow-1", graph=graph)
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Company research",
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
        active_config_snapshot_id="snapshot-1",
    )
    snapshot = AgentConfigSnapshot(
        id="snapshot-1", tenant_id="tenant-1", agent_id=agent.id, version=1, config_snapshot=AgentSoulConfig()
    )
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id=workflow.id,
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id=agent.id,
        current_snapshot_id=snapshot.id,
        node_job_config=WorkflowNodeJobConfig(),
    )
    session.add_all([make_account(), make_app(mode=AppMode.ADVANCED_CHAT), workflow, agent, snapshot, binding])
    session.commit()
    return workflow, binding


def _save_job(session: Session, node_job: dict[str, object]) -> WorkflowNodeJobConfig:
    state = AgentComposerService.save_workflow_composer(
        session=session,
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        account_id="account-1",
        payload=ComposerSavePayload.model_validate(
            {"variant": "workflow", "save_strategy": "node_job_only", "node_job": node_job}
        ),
    )
    return WorkflowNodeJobConfig.model_validate(state["node_job"])


def test_composer_mode_changes_are_persisted_and_never_restore_an_old_generation(sqlite_session: Session) -> None:
    workflow, binding = _create_composer_target(sqlite_session)
    original_graph = workflow.graph_dict
    disabled = _save_job(sqlite_session, {"continue_agent_session": False})
    disabled_generation = disabled.session_generation
    assert str(UUID(disabled_generation)) == disabled_generation
    assert binding.node_job_config.continue_agent_session is False
    assert workflow.graph_dict["nodes"][0]["data"]["continue_agent_session"] is False
    assert workflow.graph_dict["nodes"][0]["data"]["agent_session_generation"] == disabled_generation
    assert "continue_agent_session" not in original_graph["nodes"][0]["data"]

    omitted = _save_job(sqlite_session, {"workflow_prompt": "Research a different company"})
    assert omitted.continue_agent_session is False
    assert omitted.session_generation == disabled_generation

    enabled = _save_job(sqlite_session, {"continue_agent_session": True, "session_generation": disabled_generation})
    assert enabled.continue_agent_session is True
    assert enabled.session_generation not in {"", disabled_generation}
    reloaded = AgentComposerService.load_workflow_composer(
        session=sqlite_session, tenant_id="tenant-1", app_id="app-1", node_id="node-1"
    )
    assert WorkflowNodeJobConfig.model_validate(reloaded["node_job"]) == enabled
    assert workflow.graph_dict["nodes"][0]["data"]["agent_session_generation"] == enabled.session_generation


def test_legacy_composer_save_preserves_existing_chat_session_identity(sqlite_session: Session) -> None:
    workflow, binding = _create_composer_target(sqlite_session)
    state = _save_job(sqlite_session, {"workflow_prompt": "Updated task"})
    assert state.continue_agent_session is True
    assert state.session_generation == ""
    assert binding.node_job_config.session_generation == ""
    assert workflow.graph_dict["nodes"][0]["data"]["agent_session_generation"] == ""
