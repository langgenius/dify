from types import SimpleNamespace
from unittest.mock import Mock

from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.workflow import Workflow, WorkflowType
from services.agent.workflow_publish_service import WorkflowAgentPublishService, _InlineAgentOwnershipError


def _workflow(*, workflow_id: str = "workflow-1", version: str = Workflow.VERSION_DRAFT) -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=version,
        graph={"nodes": [], "edges": []},
        features={},
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
    )


def test_inline_binding_from_another_node_is_cloned(monkeypatch) -> None:
    session = Mock()
    draft_workflow = _workflow()
    monkeypatch.setattr(
        WorkflowAgentPublishService,
        "_resolve_inline_agent_graph_binding",
        Mock(side_effect=_InlineAgentOwnershipError("source belongs to another node")),
    )
    monkeypatch.setattr(
        WorkflowAgentPublishService,
        "_resolve_existing_inline_binding_agent",
        Mock(return_value=None),
    )
    clone = Mock(return_value=(SimpleNamespace(id="target-agent"), "target-snapshot"))
    monkeypatch.setattr(WorkflowAgentPublishService, "_clone_inline_graph_binding_for_node", clone)

    WorkflowAgentPublishService._sync_agent_binding_for_node(
        session=session,
        draft_workflow=draft_workflow,
        node_id="pasted-node",
        node_data={"agent_task": "Summarize the input"},
        node_binding={
            "binding_type": WorkflowAgentBindingType.INLINE_AGENT.value,
            "agent_id": "source-agent",
            "current_snapshot_id": "source-snapshot",
        },
        existing_binding=None,
        account_id="account-1",
    )

    clone.assert_called_once()
    binding = session.add.call_args.args[0]
    assert isinstance(binding, WorkflowAgentNodeBinding)
    assert binding.agent_id == "target-agent"
    assert binding.current_snapshot_id == "target-snapshot"
    assert binding.node_job_config.workflow_prompt == "Summarize the input"


def test_restore_replaces_draft_bindings_with_published_bindings() -> None:
    existing = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="draft-workflow",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="old-node",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="old-agent",
        current_snapshot_id="old-snapshot",
        node_job_config={},
        created_by="account-1",
    )
    source = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="published-workflow",
        workflow_version="2026-07-13 00:00:00",
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="roster-agent",
        current_snapshot_id="published-snapshot",
        node_job_config={"workflow_prompt": "Use the roster agent"},
        created_by="account-1",
    )
    session = Mock()
    session.scalars.side_effect = [SimpleNamespace(all=lambda: [existing]), SimpleNamespace(all=lambda: [source])]

    WorkflowAgentPublishService.restore_agent_node_bindings_to_draft(
        session=session,
        source_workflow=_workflow(workflow_id="published-workflow", version="2026-07-13 00:00:00"),
        draft_workflow=_workflow(workflow_id="draft-workflow"),
        account_id="account-2",
    )

    session.delete.assert_called_once_with(existing)
    restored = session.add.call_args.args[0]
    assert isinstance(restored, WorkflowAgentNodeBinding)
    assert restored.workflow_id == "draft-workflow"
    assert restored.workflow_version == Workflow.VERSION_DRAFT
    assert restored.agent_id == "roster-agent"
    assert restored.current_snapshot_id == "published-snapshot"
    assert restored.node_job_config.workflow_prompt == "Use the roster agent"
    session.flush.assert_called_once()
