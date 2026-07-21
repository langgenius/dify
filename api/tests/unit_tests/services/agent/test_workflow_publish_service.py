from types import SimpleNamespace
from unittest.mock import ANY, Mock

import pytest

from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.workflow import Workflow, WorkflowType
from services.agent.dsl_service import AgentDslService
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


def test_inline_binding_reuses_existing_node_owned_agent(monkeypatch) -> None:
    session = Mock()
    draft_workflow = _workflow()
    existing_binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="pasted-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="existing-agent",
        current_snapshot_id="existing-snapshot",
        node_job_config={},
        created_by="account-1",
    )
    existing_agent = SimpleNamespace(id="existing-agent")
    monkeypatch.setattr(
        WorkflowAgentPublishService,
        "_resolve_inline_agent_graph_binding",
        Mock(side_effect=_InlineAgentOwnershipError("source belongs to another node")),
    )
    monkeypatch.setattr(
        WorkflowAgentPublishService,
        "_resolve_existing_inline_binding_agent",
        Mock(return_value=existing_agent),
    )
    clone = Mock()
    monkeypatch.setattr(WorkflowAgentPublishService, "_clone_inline_graph_binding_for_node", clone)

    WorkflowAgentPublishService._sync_agent_binding_for_node(
        session=session,
        draft_workflow=draft_workflow,
        node_id="pasted-node",
        node_data={"agent_task": "Summarize"},
        node_binding={
            "binding_type": WorkflowAgentBindingType.INLINE_AGENT.value,
            "agent_id": "source-agent",
            "current_snapshot_id": "source-snapshot",
        },
        existing_binding=existing_binding,
        account_id="account-1",
    )

    assert existing_binding.agent_id == "existing-agent"
    assert existing_binding.current_snapshot_id == "existing-snapshot"
    clone.assert_not_called()


def test_resolve_existing_inline_binding_agent_returns_valid_agent_or_none(monkeypatch) -> None:
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config={},
        created_by="account-1",
    )
    resolved = SimpleNamespace(id="agent-1")
    resolver = Mock(return_value=resolved)
    monkeypatch.setattr(WorkflowAgentPublishService, "_resolve_inline_agent_graph_binding", resolver)

    assert (
        WorkflowAgentPublishService._resolve_existing_inline_binding_agent(
            session=Mock(),
            draft_workflow=_workflow(),
            node_id="node-1",
            existing_binding=binding,
        )
        is resolved
    )

    resolver.side_effect = ValueError("stale")
    assert (
        WorkflowAgentPublishService._resolve_existing_inline_binding_agent(
            session=Mock(),
            draft_workflow=_workflow(),
            node_id="node-1",
            existing_binding=binding,
        )
        is None
    )


def test_clone_inline_graph_binding_for_node_clones_source(monkeypatch) -> None:
    session = Mock()
    source_agent = SimpleNamespace(id="source-agent")
    source_snapshot = SimpleNamespace(id="source-snapshot")
    session.scalar.side_effect = [source_agent, source_snapshot]
    target_agent = SimpleNamespace(id="target-agent")
    target_snapshot = SimpleNamespace(id="target-snapshot")
    clone = Mock(return_value=(target_agent, target_snapshot))
    monkeypatch.setattr(AgentDslService, "clone_inline_binding_for_node", clone)
    node_job = WorkflowNodeJobConfig(workflow_prompt="work")

    result = WorkflowAgentPublishService._clone_inline_graph_binding_for_node(
        session=session,
        draft_workflow=_workflow(),
        node_id="target-node",
        source_agent_id="source-agent",
        source_snapshot_id="source-snapshot",
        node_job=node_job,
        account_id="account-1",
    )

    assert result == (target_agent, "target-snapshot")
    clone.assert_called_once_with(
        workflow=ANY,
        node_id="target-node",
        source_agent=source_agent,
        source_snapshot=source_snapshot,
        node_job=node_job,
        account_id="account-1",
    )


@pytest.mark.parametrize("scalar_results", [[None], [SimpleNamespace(id="source-agent"), None]])
def test_clone_inline_graph_binding_for_node_rejects_missing_source(scalar_results: list[object | None]) -> None:
    session = Mock()
    session.scalar.side_effect = scalar_results

    with pytest.raises(ValueError, match="unavailable inline agent|missing inline agent config snapshot"):
        WorkflowAgentPublishService._clone_inline_graph_binding_for_node(
            session=session,
            draft_workflow=_workflow(),
            node_id="target-node",
            source_agent_id="source-agent",
            source_snapshot_id="source-snapshot",
            node_job=WorkflowNodeJobConfig(),
            account_id="account-1",
        )


def test_restore_clones_inline_binding_owned_by_published_workflow(monkeypatch) -> None:
    source = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="published-workflow",
        workflow_version="published",
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="published-agent",
        current_snapshot_id="published-snapshot",
        node_job_config={"workflow_prompt": "work"},
        created_by="account-1",
    )
    session = Mock()
    session.scalars.side_effect = [SimpleNamespace(all=lambda: []), SimpleNamespace(all=lambda: [source])]
    monkeypatch.setattr(
        WorkflowAgentPublishService,
        "_resolve_inline_agent_graph_binding",
        Mock(side_effect=ValueError("owned by published workflow")),
    )
    clone = Mock(return_value=(SimpleNamespace(id="draft-agent"), "draft-snapshot"))
    monkeypatch.setattr(WorkflowAgentPublishService, "_clone_inline_graph_binding_for_node", clone)

    WorkflowAgentPublishService.restore_agent_node_bindings_to_draft(
        session=session,
        source_workflow=_workflow(workflow_id="published-workflow", version="published"),
        draft_workflow=_workflow(workflow_id="draft-workflow"),
        account_id="account-2",
    )

    clone.assert_called_once()
    restored = session.add.call_args.args[0]
    assert restored.agent_id == "draft-agent"
    assert restored.current_snapshot_id == "draft-snapshot"
