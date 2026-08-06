from types import SimpleNamespace
from unittest.mock import ANY, Mock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.agent.dsl_service import AgentDslService
from services.agent.workflow_publish_service import WorkflowAgentPublishService


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


def _inline_agent(
    *,
    agent_id: str,
    workflow_id: str,
    node_id: str,
    tenant_id: str = "tenant-1",
) -> Agent:
    return Agent(
        id=agent_id,
        tenant_id=tenant_id,
        name=f"Inline {agent_id}",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        status=AgentStatus.ACTIVE,
        app_id="app-1",
        workflow_id=workflow_id,
        workflow_node_id=node_id,
    )


def _snapshot(*, snapshot_id: str, agent_id: str, version: int = 1) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id=snapshot_id,
        tenant_id="tenant-1",
        agent_id=agent_id,
        version=version,
        config_snapshot=AgentSoulConfig(),
    )


def test_inline_binding_from_another_node_is_cloned(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    source_agent = _inline_agent(agent_id="source-agent", workflow_id="workflow-1", node_id="source-node")
    source_snapshot = _snapshot(snapshot_id="source-snapshot", agent_id=source_agent.id)
    sqlite_session.add_all([source_agent, source_snapshot])
    sqlite_session.commit()
    target_agent = _inline_agent(agent_id="target-agent", workflow_id="workflow-1", node_id="pasted-node")
    target_snapshot = _snapshot(snapshot_id="target-snapshot", agent_id=target_agent.id)
    clone = Mock(return_value=(target_agent, target_snapshot))
    monkeypatch.setattr(AgentDslService, "clone_inline_binding_for_node", clone)

    WorkflowAgentPublishService._sync_agent_binding_for_node(
        session=sqlite_session,
        draft_workflow=_workflow(),
        node_id="pasted-node",
        node_data={"agent_task": "Summarize the input"},
        node_binding={
            "binding_type": WorkflowAgentBindingType.INLINE_AGENT.value,
            "agent_id": source_agent.id,
            "current_snapshot_id": source_snapshot.id,
        },
        existing_binding=None,
        account_id="account-1",
    )
    sqlite_session.flush()

    clone.assert_called_once()
    binding = sqlite_session.scalar(
        select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "pasted-node")
    )
    assert binding is not None
    assert binding.agent_id == "target-agent"
    assert binding.current_snapshot_id == "target-snapshot"
    assert binding.node_job_config.workflow_prompt == "Summarize the input"


def test_draft_sync_resolves_roster_agents() -> None:
    draft_workflow = _workflow()
    draft_workflow.graph = (
        '{"nodes":['
        '{"id":"node-b","data":{"type":"agent","version":"2","agent_node_kind":"dify_agent",'
        '"agent_binding":{"binding_type":"roster_agent","agent_id":"agent-b"}}},'
        '{"id":"node-a","data":{"type":"agent","version":"2","agent_node_kind":"dify_agent",'
        '"agent_binding":{"binding_type":"roster_agent","agent_id":"agent-a"}}}'
        '],"edges":[]}'
    )
    session = Mock()
    session.scalars.return_value = SimpleNamespace(all=lambda: [])
    agents = {
        agent_id: SimpleNamespace(
            id=agent_id,
            scope=AgentScope.ROSTER,
            active_config_snapshot_id=f"{agent_id}-snapshot",
        )
        for agent_id in ("agent-a", "agent-b")
    }
    session.scalar.side_effect = [agents["agent-b"], agents["agent-a"]]

    WorkflowAgentPublishService.sync_agent_bindings_for_draft(
        session=session,
        draft_workflow=draft_workflow,
        account_id="account-1",
    )

    assert session.scalar.call_count == 2
    assert {call.args[0].agent_id for call in session.add.call_args_list} == {"agent-a", "agent-b"}


def test_restore_replaces_bindings_and_returns_only_replaced_inline_agent(sqlite_session: Session) -> None:
    existing_inline = WorkflowAgentNodeBinding(
        id="existing-inline",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="draft-workflow",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="old-inline-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="old-inline-agent",
        current_snapshot_id="old-inline-snapshot",
        node_job_config={},
        created_by="account-1",
    )
    existing_roster = WorkflowAgentNodeBinding(
        id="existing-roster",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="draft-workflow",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="old-roster-node",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="old-roster-agent",
        current_snapshot_id="old-roster-snapshot",
        node_job_config={},
        created_by="account-1",
    )
    source = WorkflowAgentNodeBinding(
        id="source-roster",
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
    roster_agent = Agent(
        id="roster-agent",
        tenant_id="tenant-1",
        name="Roster Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
        status=AgentStatus.ACTIVE,
        app_id="roster-app",
        active_config_snapshot_id="published-snapshot",
    )
    sqlite_session.add_all([existing_inline, existing_roster, source, roster_agent])
    sqlite_session.commit()
    retirement_candidates = WorkflowAgentPublishService.restore_agent_node_bindings_to_draft(
        session=sqlite_session,
        source_workflow=_workflow(workflow_id="published-workflow", version="2026-07-13 00:00:00"),
        draft_workflow=_workflow(workflow_id="draft-workflow"),
        account_id="account-2",
    )

    assert sqlite_session.get(WorkflowAgentNodeBinding, existing_inline.id) is None
    assert sqlite_session.get(WorkflowAgentNodeBinding, existing_roster.id) is None
    restored = sqlite_session.scalar(
        select(WorkflowAgentNodeBinding).where(
            WorkflowAgentNodeBinding.workflow_id == "draft-workflow",
            WorkflowAgentNodeBinding.node_id == "agent-node",
        )
    )
    assert restored is not None
    assert restored.workflow_version == Workflow.VERSION_DRAFT
    assert restored.agent_id == "roster-agent"
    assert restored.current_snapshot_id == "published-snapshot"
    assert restored.node_job_config.workflow_prompt == "Use the roster agent"
    assert retirement_candidates == {"old-inline-agent"}


def test_publish_copy_uses_current_roster_snapshot() -> None:
    draft_workflow = _workflow()
    draft_workflow.graph = (
        '{"nodes":[{"id":"agent-node","data":{"type":"agent","version":"2",'
        '"agent_node_kind":"dify_agent"}}],"edges":[]}'
    )
    published_workflow = _workflow(workflow_id="published", version="published")
    binding = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="roster-agent",
        current_snapshot_id="old-snapshot",
        node_job_config={},
        created_by="account-1",
    )
    session = Mock()
    active_agent = SimpleNamespace(
        id="roster-agent",
        scope=AgentScope.ROSTER,
        active_config_snapshot_id="active-snapshot",
    )
    session.scalar.return_value = active_agent
    session.scalars.return_value = SimpleNamespace(all=lambda: [binding])

    WorkflowAgentPublishService.copy_agent_node_bindings_to_published(
        session=session,
        draft_workflow=draft_workflow,
        published_workflow=published_workflow,
    )

    copied = session.add.call_args.args[0]
    assert copied.agent_id == "roster-agent"
    assert copied.current_snapshot_id == "active-snapshot"


@pytest.mark.parametrize(
    "sqlite_session",
    [(App, Agent, WorkflowAgentNodeBinding)],
    indirect=True,
)
def test_publish_binding_copy_keeps_previous_published_owner(
    sqlite_session: Session,
) -> None:
    draft_workflow = _workflow()
    draft_workflow.graph = (
        '{"nodes":[{"id":"agent-node","data":{"type":"agent","version":"2",'
        '"agent_node_kind":"dify_agent"}}],"edges":[]}'
    )
    published_workflow = _workflow(workflow_id="published-new", version="published-new")
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Workflow",
        description="",
        mode=AppMode.WORKFLOW,
        workflow_id="published-previous",
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
        api_rpm=0,
        api_rph=0,
    )
    previous_inline_binding = WorkflowAgentNodeBinding(
        id="previous-inline-binding",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="published-previous",
        workflow_version="published-previous",
        node_id="previous-inline-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="previous-inline-agent",
        current_snapshot_id="previous-inline-snapshot",
        node_job_config={},
        created_by="account-1",
    )
    previous_roster_binding = WorkflowAgentNodeBinding(
        id="previous-roster-binding",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="published-previous",
        workflow_version="published-previous",
        node_id="previous-roster-node",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id="previous-roster-agent",
        current_snapshot_id="previous-roster-snapshot",
        node_job_config={},
        created_by="account-1",
    )
    draft_binding = WorkflowAgentNodeBinding(
        id="draft-binding",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="draft-inline-agent",
        current_snapshot_id="draft-inline-snapshot",
        node_job_config={"workflow_prompt": "work"},
        created_by="account-1",
    )
    sqlite_session.add_all([app, previous_inline_binding, previous_roster_binding, draft_binding])
    sqlite_session.commit()
    result = WorkflowAgentPublishService.copy_agent_node_bindings_to_published(
        session=sqlite_session,
        draft_workflow=draft_workflow,
        published_workflow=published_workflow,
    )
    sqlite_session.flush()

    assert result is None
    assert sqlite_session.get(WorkflowAgentNodeBinding, previous_inline_binding.id) is previous_inline_binding
    assert sqlite_session.get(WorkflowAgentNodeBinding, previous_roster_binding.id) is previous_roster_binding
    copied = sqlite_session.scalar(
        select(WorkflowAgentNodeBinding).where(
            WorkflowAgentNodeBinding.workflow_id == "published-new",
            WorkflowAgentNodeBinding.workflow_version == "published-new",
        )
    )
    assert copied is not None
    assert copied.agent_id == "draft-inline-agent"
    assert copied.current_snapshot_id == "draft-inline-snapshot"


def test_inline_binding_reuses_existing_node_owned_agent(sqlite_session: Session) -> None:
    existing_agent = _inline_agent(agent_id="existing-agent", workflow_id="workflow-1", node_id="pasted-node")
    existing_snapshot = _snapshot(snapshot_id="existing-snapshot", agent_id=existing_agent.id)
    existing_binding = WorkflowAgentNodeBinding(
        id="existing-binding",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version=Workflow.VERSION_DRAFT,
        node_id="pasted-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id=existing_agent.id,
        current_snapshot_id=existing_snapshot.id,
        node_job_config={},
        created_by="account-1",
    )
    sqlite_session.add_all([existing_agent, existing_snapshot, existing_binding])
    sqlite_session.commit()

    WorkflowAgentPublishService._sync_agent_binding_for_node(
        session=sqlite_session,
        draft_workflow=_workflow(),
        node_id="pasted-node",
        node_data={"agent_task": "Summarize"},
        node_binding={
            "binding_type": WorkflowAgentBindingType.INLINE_AGENT.value,
            "agent_id": "unavailable-source-agent",
            "current_snapshot_id": "unavailable-source-snapshot",
        },
        existing_binding=existing_binding,
        account_id="account-1",
    )
    sqlite_session.flush()

    stored = sqlite_session.get(WorkflowAgentNodeBinding, existing_binding.id)
    assert stored is not None
    assert stored.agent_id == "existing-agent"
    assert stored.current_snapshot_id == "existing-snapshot"
    assert stored.node_job_config.workflow_prompt == "Summarize"


def test_resolve_existing_inline_binding_agent_returns_valid_agent_or_none(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
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
    resolved = _inline_agent(agent_id="agent-1", workflow_id="workflow-1", node_id="node-1")
    resolver = Mock(return_value=resolved)
    monkeypatch.setattr(WorkflowAgentPublishService, "_resolve_inline_agent_graph_binding", resolver)

    assert (
        WorkflowAgentPublishService._resolve_existing_inline_binding_agent(
            session=unbound_session,
            draft_workflow=_workflow(),
            node_id="node-1",
            existing_binding=binding,
        )
        is resolved
    )

    resolver.side_effect = ValueError("stale")
    assert (
        WorkflowAgentPublishService._resolve_existing_inline_binding_agent(
            session=unbound_session,
            draft_workflow=_workflow(),
            node_id="node-1",
            existing_binding=binding,
        )
        is None
    )


def test_resolve_roster_binding_rejects_unpublished_agent(sqlite_session: Session) -> None:
    sqlite_session.add(
        Agent(
            id="decoy-agent",
            tenant_id="tenant-1",
            name="Decoy",
            scope=AgentScope.ROSTER,
            source=AgentSource.AGENT_APP,
            status=AgentStatus.ACTIVE,
            app_id="decoy-app",
        )
    )
    sqlite_session.commit()
    with pytest.raises(ValueError, match="unavailable or unpublished roster agent"):
        WorkflowAgentPublishService._resolve_roster_agent_graph_binding(
            session=sqlite_session,
            draft_workflow=_workflow(),
            node_id="agent-node",
            agent_id="agent-1",
        )


def test_clone_inline_graph_binding_for_node_clones_source(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    source_agent = _inline_agent(agent_id="source-agent", workflow_id="source-workflow", node_id="source-node")
    source_snapshot = _snapshot(snapshot_id="source-snapshot", agent_id=source_agent.id)
    sqlite_session.add_all([source_agent, source_snapshot])
    sqlite_session.commit()
    target_agent = _inline_agent(agent_id="target-agent", workflow_id="workflow-1", node_id="target-node")
    target_snapshot = _snapshot(snapshot_id="target-snapshot", agent_id=target_agent.id)
    clone = Mock(return_value=(target_agent, target_snapshot))
    monkeypatch.setattr(AgentDslService, "clone_inline_binding_for_node", clone)

    result = WorkflowAgentPublishService._clone_inline_graph_binding_for_node(
        session=sqlite_session,
        draft_workflow=_workflow(),
        node_id="target-node",
        source_agent_id="source-agent",
        source_snapshot_id="source-snapshot",
        account_id="account-1",
    )

    assert result == (target_agent, "target-snapshot")
    clone.assert_called_once_with(
        workflow=ANY,
        node_id="target-node",
        source_agent=source_agent,
        source_snapshot=source_snapshot,
        account_id="account-1",
    )


@pytest.mark.parametrize("persist_source_agent", [False, True])
def test_clone_inline_graph_binding_for_node_rejects_missing_source(
    sqlite_session: Session, persist_source_agent: bool
) -> None:
    if persist_source_agent:
        sqlite_session.add(_inline_agent(agent_id="source-agent", workflow_id="source-workflow", node_id="source-node"))
        sqlite_session.commit()

    with pytest.raises(ValueError, match="unavailable inline agent|missing inline agent config snapshot"):
        WorkflowAgentPublishService._clone_inline_graph_binding_for_node(
            session=sqlite_session,
            draft_workflow=_workflow(),
            node_id="target-node",
            source_agent_id="source-agent",
            source_snapshot_id="source-snapshot",
            account_id="account-1",
        )


def test_restore_clones_inline_binding_owned_by_published_workflow(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    source_agent = _inline_agent(agent_id="published-agent", workflow_id="published-workflow", node_id="agent-node")
    source_snapshot = _snapshot(snapshot_id="published-snapshot", agent_id=source_agent.id)
    source = WorkflowAgentNodeBinding(
        id="published-binding",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="published-workflow",
        workflow_version="published",
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id=source_agent.id,
        current_snapshot_id=source_snapshot.id,
        node_job_config={"workflow_prompt": "work"},
        created_by="account-1",
    )
    sqlite_session.add_all([source_agent, source_snapshot, source])
    sqlite_session.commit()
    target_agent = _inline_agent(agent_id="draft-agent", workflow_id="draft-workflow", node_id="agent-node")
    target_snapshot = _snapshot(snapshot_id="draft-snapshot", agent_id=target_agent.id)
    clone = Mock(return_value=(target_agent, target_snapshot))
    monkeypatch.setattr(AgentDslService, "clone_inline_binding_for_node", clone)

    WorkflowAgentPublishService.restore_agent_node_bindings_to_draft(
        session=sqlite_session,
        source_workflow=_workflow(workflow_id="published-workflow", version="published"),
        draft_workflow=_workflow(workflow_id="draft-workflow"),
        account_id="account-2",
    )

    clone.assert_called_once()
    restored = sqlite_session.scalar(
        select(WorkflowAgentNodeBinding).where(
            WorkflowAgentNodeBinding.workflow_id == "draft-workflow",
            WorkflowAgentNodeBinding.workflow_version == Workflow.VERSION_DRAFT,
        )
    )
    assert restored is not None
    assert restored.agent_id == "draft-agent"
    assert restored.current_snapshot_id == "draft-snapshot"
