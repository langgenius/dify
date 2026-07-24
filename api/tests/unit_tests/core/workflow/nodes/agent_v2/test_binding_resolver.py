from uuid import uuid4

import pytest
from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.workflow.nodes.agent_v2.binding_resolver as resolver_module
from core.workflow.nodes.agent_v2.binding_resolver import WorkflowAgentBindingError, WorkflowAgentBindingResolver
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, WorkflowNodeJobConfig

RESOLVER_MODELS = (WorkflowAgentNodeBinding, Agent, AgentConfigSnapshot)


def _resolve_ids() -> dict[str, str]:
    return {
        "tenant_id": str(uuid4()),
        "app_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "node_id": "agent-node",
    }


def _agent(*, tenant_id: str, status: AgentStatus = AgentStatus.ACTIVE) -> Agent:
    return Agent(
        tenant_id=tenant_id,
        name=f"Agent {uuid4()}",
        description="",
        role="",
        icon_type=None,
        icon=None,
        icon_background=None,
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        app_id=None,
        backing_app_id=None,
        workflow_id=None,
        workflow_node_id=None,
        active_config_snapshot_id=None,
        active_config_has_model=True,
        active_config_is_published=True,
        status=status,
        created_by=None,
        updated_by=None,
        archived_by=None,
        archived_at=None,
    )


def _snapshot(*, tenant_id: str, agent_id: str) -> AgentConfigSnapshot:
    return AgentConfigSnapshot(
        tenant_id=tenant_id,
        agent_id=agent_id,
        version=1,
        config_snapshot=AgentSoulConfig(
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            )
        ),
        summary=None,
        version_note=None,
        created_by=None,
    )


def _binding(
    *, ids: dict[str, str], agent_id: str, snapshot_id: str, binding_type: WorkflowAgentBindingType
) -> WorkflowAgentNodeBinding:
    return WorkflowAgentNodeBinding(
        tenant_id=ids["tenant_id"],
        app_id=ids["app_id"],
        workflow_id=ids["workflow_id"],
        workflow_version="draft",
        node_id=ids["node_id"],
        binding_type=binding_type,
        agent_id=agent_id,
        current_snapshot_id=snapshot_id,
        node_job_config=WorkflowNodeJobConfig(),
        created_by=None,
        updated_by=None,
    )


def _bind_factory(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(resolver_module.session_factory, "create_session", factory)


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_returns_detached_binding_bundle(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
) -> None:
    ids = _resolve_ids()
    agent = _agent(tenant_id=ids["tenant_id"])
    sqlite_session.add(agent)
    sqlite_session.flush()
    snapshot = _snapshot(tenant_id=ids["tenant_id"], agent_id=agent.id)
    sqlite_session.add(snapshot)
    sqlite_session.flush()
    binding = _binding(
        ids=ids,
        agent_id=agent.id,
        snapshot_id=snapshot.id,
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
    )
    sqlite_session.add(binding)
    sqlite_session.commit()
    _bind_factory(monkeypatch, sqlite_engine)

    bundle = WorkflowAgentBindingResolver().resolve(**ids)

    assert bundle.binding.id == binding.id
    assert bundle.agent.id == agent.id
    assert bundle.snapshot.id == snapshot.id
    assert inspect(bundle.binding).detached
    assert inspect(bundle.agent).detached
    assert inspect(bundle.snapshot).detached


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_uses_active_snapshot_for_roster_agent(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
) -> None:
    ids = _resolve_ids()
    agent = _agent(tenant_id=ids["tenant_id"])
    sqlite_session.add(agent)
    sqlite_session.flush()
    active_snapshot = _snapshot(tenant_id=ids["tenant_id"], agent_id=agent.id)
    sqlite_session.add(active_snapshot)
    sqlite_session.flush()
    agent.active_config_snapshot_id = active_snapshot.id
    binding = _binding(
        ids=ids,
        agent_id=agent.id,
        snapshot_id=str(uuid4()),
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
    )
    sqlite_session.add(binding)
    sqlite_session.commit()
    _bind_factory(monkeypatch, sqlite_engine)

    bundle = WorkflowAgentBindingResolver().resolve(**ids)

    assert bundle.snapshot.id == active_snapshot.id


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_raises_when_binding_missing(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
) -> None:
    _bind_factory(monkeypatch, sqlite_engine)

    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**_resolve_ids())

    assert exc_info.value.error_code == "agent_binding_not_found"


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_raises_when_agent_archived(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
) -> None:
    ids = _resolve_ids()
    agent = _agent(tenant_id=ids["tenant_id"], status=AgentStatus.ARCHIVED)
    sqlite_session.add(agent)
    sqlite_session.flush()
    binding = _binding(
        ids=ids,
        agent_id=agent.id,
        snapshot_id=str(uuid4()),
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
    )
    sqlite_session.add(binding)
    sqlite_session.commit()
    _bind_factory(monkeypatch, sqlite_engine)

    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**ids)

    assert exc_info.value.error_code == "agent_not_available"


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_raises_when_snapshot_missing(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
) -> None:
    ids = _resolve_ids()
    agent = _agent(tenant_id=ids["tenant_id"])
    sqlite_session.add(agent)
    sqlite_session.flush()
    binding = _binding(
        ids=ids,
        agent_id=agent.id,
        snapshot_id=str(uuid4()),
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
    )
    sqlite_session.add(binding)
    sqlite_session.commit()
    _bind_factory(monkeypatch, sqlite_engine)

    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**ids)

    assert exc_info.value.error_code == "agent_config_snapshot_not_found"
