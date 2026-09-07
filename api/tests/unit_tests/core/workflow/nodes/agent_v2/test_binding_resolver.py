from collections.abc import Iterator
from uuid import uuid4

import pytest
from sqlalchemy import event, inspect
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql import Executable

from core.workflow.nodes.agent_v2.binding_resolver import WorkflowAgentBindingError, WorkflowAgentBindingResolver
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, WorkflowNodeJobConfig

RESOLVER_MODELS = (WorkflowAgentNodeBinding, Agent, AgentConfigSnapshot, AgentConfigRevision)


def _resolve_ids() -> dict[str, str]:
    return {
        "tenant_id": str(uuid4()),
        "app_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "node_id": "agent-node",
    }


def _agent(
    *,
    tenant_id: str,
    status: AgentStatus = AgentStatus.ACTIVE,
    scope: AgentScope = AgentScope.WORKFLOW_ONLY,
    source: AgentSource = AgentSource.WORKFLOW,
    app_id: str | None = None,
    active_config_snapshot_id: str | None = None,
    active_config_is_published: bool = True,
) -> Agent:
    return Agent(
        tenant_id=tenant_id,
        name=f"Agent {uuid4()}",
        description="",
        role="",
        icon_type=None,
        icon=None,
        icon_background=None,
        scope=scope,
        source=source,
        app_id=app_id,
        backing_app_id=None,
        workflow_id=None,
        workflow_node_id=None,
        active_config_snapshot_id=active_config_snapshot_id,
        active_config_has_model=True,
        active_config_is_published=active_config_is_published,
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


@pytest.fixture
def orm_statements(sqlite_session_factory: sessionmaker[Session]) -> Iterator[list[Executable]]:
    """Record statements executed by the service-owned SQLite sessions."""
    scalar_statements: list[Executable] = []

    def record_statement(execute_state: ORMExecuteState) -> None:
        scalar_statements.append(execute_state.statement)

    event.listen(sqlite_session_factory.class_, "do_orm_execute", record_statement)
    try:
        yield scalar_statements
    finally:
        event.remove(sqlite_session_factory.class_, "do_orm_execute", record_statement)


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_returns_detached_binding_bundle(
    sqlite_session: Session,
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
    bundle = WorkflowAgentBindingResolver().resolve(**ids)

    assert bundle.binding.id == binding.id
    assert bundle.agent.id == agent.id
    assert bundle.snapshot.id == snapshot.id
    assert inspect(bundle.binding).detached
    assert inspect(bundle.agent).detached
    assert inspect(bundle.snapshot).detached


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_uses_active_snapshot_for_roster_agent(
    sqlite_session: Session,
) -> None:
    ids = _resolve_ids()
    agent = _agent(
        tenant_id=ids["tenant_id"],
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )
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
    bundle = WorkflowAgentBindingResolver().resolve(**ids)

    assert bundle.snapshot.id == active_snapshot.id


@pytest.mark.parametrize(
    ("binding_type", "scope", "source"),
    [
        (WorkflowAgentBindingType.ROSTER_AGENT, AgentScope.ROSTER, AgentSource.ROSTER),
        (WorkflowAgentBindingType.INLINE_AGENT, AgentScope.WORKFLOW_ONLY, AgentSource.WORKFLOW),
    ],
)
@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_uses_pinned_snapshot_for_existing_node_execution(
    sqlite_session: Session,
    orm_statements: list[Executable],
    binding_type: WorkflowAgentBindingType,
    scope: AgentScope,
    source: AgentSource,
) -> None:
    ids = _resolve_ids()
    agent = _agent(
        tenant_id=ids["tenant_id"],
        scope=scope,
        source=source,
        active_config_snapshot_id=str(uuid4()),
    )
    sqlite_session.add(agent)
    sqlite_session.flush()
    pinned_snapshot = _snapshot(tenant_id=ids["tenant_id"], agent_id=agent.id)
    sqlite_session.add(pinned_snapshot)
    sqlite_session.flush()
    binding = _binding(
        ids=ids,
        agent_id=agent.id,
        snapshot_id=str(uuid4()),
        binding_type=binding_type,
    )
    sqlite_session.add(binding)
    sqlite_session.commit()
    bundle = WorkflowAgentBindingResolver().resolve(
        **ids,
        binding_id=binding.id,
        snapshot_id=pinned_snapshot.id,
    )

    assert bundle.snapshot.id == pinned_snapshot.id
    assert binding.id in orm_statements[0].compile().params.values()
    assert pinned_snapshot.id in orm_statements[-1].compile().params.values()


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_does_not_fallback_from_an_explicit_empty_snapshot(
    sqlite_session: Session,
) -> None:
    ids = _resolve_ids()
    agent = _agent(
        tenant_id=ids["tenant_id"],
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )
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
    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**ids, binding_id=binding.id, snapshot_id="")

    assert exc_info.value.error_code == "agent_config_snapshot_not_found"


@pytest.mark.parametrize(
    ("binding_id", "snapshot_id"),
    [("binding-1", None), (None, "snapshot-1")],
)
def test_binding_resolver_rejects_half_pinned_generation(
    binding_id: str | None,
    snapshot_id: str | None,
) -> None:
    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(
            **_resolve_ids(),
            binding_id=binding_id,
            snapshot_id=snapshot_id,
        )

    assert exc_info.value.error_code == "agent_binding_generation_invalid"


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_rejects_unpublished_roster_agent(
    sqlite_session: Session,
) -> None:
    ids = _resolve_ids()
    snapshot_id = str(uuid4())
    agent = _agent(
        tenant_id=ids["tenant_id"],
        scope=AgentScope.ROSTER,
        source=AgentSource.IMPORTED,
        app_id=str(uuid4()),
        active_config_snapshot_id=snapshot_id,
        active_config_is_published=False,
    )
    sqlite_session.add(agent)
    sqlite_session.flush()
    binding = _binding(
        ids=ids,
        agent_id=agent.id,
        snapshot_id=snapshot_id,
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
    )
    sqlite_session.add(binding)
    sqlite_session.commit()
    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**ids)

    assert exc_info.value.error_code == "agent_not_available"
    assert "not been published" in str(exc_info.value)


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_requires_publish_provenance_for_active_roster_snapshot(
    sqlite_session: Session,
) -> None:
    ids = _resolve_ids()
    agent = _agent(
        tenant_id=ids["tenant_id"],
        scope=AgentScope.ROSTER,
        source=AgentSource.IMPORTED,
        app_id=str(uuid4()),
        active_config_is_published=False,
    )
    sqlite_session.add(agent)
    sqlite_session.flush()
    snapshot = _snapshot(tenant_id=ids["tenant_id"], agent_id=agent.id)
    sqlite_session.add(snapshot)
    sqlite_session.flush()
    agent.active_config_snapshot_id = snapshot.id
    binding = _binding(
        ids=ids,
        agent_id=agent.id,
        snapshot_id=snapshot.id,
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
    )
    sqlite_session.add_all(
        [
            binding,
            AgentConfigRevision(
                tenant_id=ids["tenant_id"],
                agent_id=agent.id,
                current_snapshot_id=snapshot.id,
                revision=1,
                operation=AgentConfigRevisionOperation.IMPORT_PACKAGE,
            ),
        ]
    )
    sqlite_session.commit()
    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**ids)
    assert exc_info.value.error_code == "agent_not_available"

    sqlite_session.add(
        AgentConfigRevision(
            tenant_id=ids["tenant_id"],
            agent_id=agent.id,
            current_snapshot_id=snapshot.id,
            revision=2,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    sqlite_session.commit()

    bundle = WorkflowAgentBindingResolver().resolve(**ids)

    assert bundle.agent.id == agent.id
    assert bundle.snapshot.id == snapshot.id


def test_binding_resolver_raises_when_binding_missing() -> None:
    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**_resolve_ids())

    assert exc_info.value.error_code == "agent_binding_not_found"


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_raises_when_agent_archived(
    sqlite_session: Session,
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
    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**ids)

    assert exc_info.value.error_code == "agent_not_available"


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_raises_when_snapshot_missing(
    sqlite_session: Session,
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
    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        WorkflowAgentBindingResolver().resolve(**ids)

    assert exc_info.value.error_code == "agent_config_snapshot_not_found"
