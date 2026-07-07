import pytest

from core.workflow.nodes.agent_v2.binding_resolver import (
    WorkflowAgentBindingError,
    WorkflowAgentBindingResolver,
)
from models.agent import Agent, AgentConfigSnapshot, AgentStatus, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, WorkflowNodeJobConfig


class FakeSession:
    def __init__(self, scalar_results):
        self._scalar_results = list(scalar_results)
        self.expunge_calls = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def scalar(self, _stmt):
        if not self._scalar_results:
            return None
        return self._scalar_results.pop(0)

    def expunge(self, value):
        self.expunge_calls.append(value)


def _binding() -> WorkflowAgentNodeBinding:
    return WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig(),
    )


def _agent(*, status: AgentStatus = AgentStatus.ACTIVE) -> Agent:
    return Agent(id="agent-1", tenant_id="tenant-1", name="Agent", status=status)


def _snapshot() -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            )
        ),
    )


def _resolve() -> dict[str, str]:
    return {
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "node_id": "agent-node",
    }


def test_binding_resolver_returns_detached_binding_bundle(monkeypatch: pytest.MonkeyPatch):
    fake_session = FakeSession([_binding(), _agent(), _snapshot()])
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.binding_resolver.session_factory.create_session",
        lambda: fake_session,
    )

    bundle = WorkflowAgentBindingResolver().resolve(**_resolve())

    assert bundle.binding.id == "binding-1"
    assert bundle.agent.id == "agent-1"
    assert bundle.snapshot.id == "snapshot-1"
    assert fake_session.expunge_calls == [bundle.binding, bundle.agent, bundle.snapshot]


def test_binding_resolver_uses_active_snapshot_for_roster_agent(monkeypatch: pytest.MonkeyPatch):
    binding = _binding()
    binding.binding_type = WorkflowAgentBindingType.ROSTER_AGENT
    binding.current_snapshot_id = "old-snapshot"
    agent = _agent()
    agent.active_config_snapshot_id = "active-snapshot"
    snapshot = _snapshot()
    snapshot.id = "active-snapshot"
    fake_session = FakeSession([binding, agent, snapshot])
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.binding_resolver.session_factory.create_session",
        lambda: fake_session,
    )

    bundle = WorkflowAgentBindingResolver().resolve(**_resolve())

    assert bundle.snapshot.id == "active-snapshot"


def test_binding_resolver_raises_when_binding_missing(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.binding_resolver.session_factory.create_session",
        lambda: FakeSession([None]),
    )

    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**_resolve())

    assert exc_info.value.error_code == "agent_binding_not_found"


def test_binding_resolver_raises_when_agent_archived(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.binding_resolver.session_factory.create_session",
        lambda: FakeSession([_binding(), _agent(status=AgentStatus.ARCHIVED)]),
    )

    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**_resolve())

    assert exc_info.value.error_code == "agent_not_available"


def test_binding_resolver_raises_when_snapshot_missing(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.binding_resolver.session_factory.create_session",
        lambda: FakeSession([_binding(), _agent(), None]),
    )

    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**_resolve())

    assert exc_info.value.error_code == "agent_config_snapshot_not_found"
