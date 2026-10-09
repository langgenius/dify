from collections.abc import Iterator
from unittest.mock import MagicMock, Mock, create_autospec
from uuid import uuid4

import pytest
from agenton.compositor import CompositorSessionSnapshot
from flask import Flask
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql import ClauseElement, Executable

from core.workflow.nodes.agent_v2.session_store import WorkflowAgentSessionScope, WorkflowAgentWorkspaceStore
from enums.agent import WorkflowAgentBindingType
from graphon.enums import WorkflowNodeExecutionStatus
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentHomeSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
    AgentWorkingResourceStatus,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, WorkflowNodeJobConfig
from models.agent_runtime_contracts import WorkflowAgentBindingError
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from repositories.agent.runtime_repository import WorkflowAgentBindingResolver
from services.agent.workspace_service import AgentWorkspaceService


@pytest.fixture
def binding_resolver(sqlite_session_factory: sessionmaker[Session]) -> WorkflowAgentBindingResolver:
    return WorkflowAgentBindingResolver(sqlite_session_factory)


@pytest.mark.parametrize("explicit_worker", [False, True])
def test_node_binding_resolution_uses_injected_database_through_nested_factories(
    app: Flask, monkeypatch: pytest.MonkeyPatch, binding_resolver: WorkflowAgentBindingResolver, explicit_worker: bool
) -> None:
    from clients.agent_backend import AgentBackendRunClient
    from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
    from enums import DeploymentEdition
    from extensions.ext_application_services import build_application_services
    from extensions.ext_redis import RedisClientWrapper
    from graphon.runtime import GraphRuntimeState, VariablePool
    from models.base import TypeBase
    from services.workflow.execution.adapters.agent_v2.agent_node import DifyAgentNode
    from services.workflow.execution.adapters.node_factory import DifyGraphInitContext, DifyNodeFactory

    # The normal unit-test factory remains bound to its empty database. The
    # configured application/worker uses a second database with these bindings.
    engine = create_engine("sqlite://")
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(
        "clients.agent_backend.factory.create_agent_backend_run_client",
        Mock(return_value=create_autospec(AgentBackendRunClient, instance=True, spec_set=True)),
    )
    try:
        TypeBase.metadata.create_all(
            engine, tables=[TypeBase.metadata.tables[model.__tablename__] for model in RESOLVER_MODELS]
        )
        ids = _resolve_ids()
        with sessions.begin() as session:
            agent = _agent(tenant_id=ids["tenant_id"])
            session.add(agent)
            session.flush()
            snapshot = _snapshot(tenant_id=ids["tenant_id"], agent_id=agent.id)
            session.add(snapshot)
            session.flush()
            session.add(
                _binding(
                    ids=ids,
                    agent_id=agent.id,
                    snapshot_id=snapshot.id,
                    binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                )
            )
        with pytest.raises(WorkflowAgentBindingError, match="not found"):
            binding_resolver.resolve(**ids)

        services = build_application_services(
            database_client=sessions,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=create_autospec(RedisClientWrapper, instance=True, spec_set=True),
        )
        resolver = WorkflowAgentBindingResolver(sessions) if explicit_worker else services.workflow_agent_bindings
        monkeypatch.delitem(app.extensions, "application_services", raising=False)
        context = DifyGraphInitContext(
            workflow_id=ids["workflow_id"],
            graph_config={"nodes": [], "edges": []},
            call_depth=0,
            run_context=build_dify_run_context(
                tenant_id=ids["tenant_id"],
                app_id=ids["app_id"],
                user_id="account",
                user_from=UserFrom.ACCOUNT,
                invoke_from=InvokeFrom.DEBUGGER,
            ),
        )
        with app.app_context():
            factory = DifyNodeFactory.from_graph_init_context(
                graph_init_context=context,
                graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0),
                agent_binding_resolver=resolver,
                workflow_runtime=services.workflow_runtime,
            )
            nested = factory.with_runtime_state(GraphRuntimeState(variable_pool=VariablePool(), start_at=0))
            for owner in (factory, nested):
                node = owner.create_node(
                    {"id": ids["node_id"], "data": {"type": "agent", "version": "2", "agent_node_kind": "dify_agent"}}
                )
                assert isinstance(node, DifyAgentNode)
                bundle = node._binding_resolver.resolve(**ids)
                assert bundle.snapshot.id == snapshot.id
                assert inspect(bundle.snapshot).detached

            # Single-node debugging must reach the same injected database,
            # without consulting an installed Flask application container.
            from services.workflow.execution.adapters.workflow_entry import WorkflowEntry
            from tests.unit_tests.model_factories import make_workflow

            node_config = {
                "id": ids["node_id"],
                "data": {"type": "agent", "version": "2", "title": "Agent", "agent_node_kind": "dify_agent"},
            }
            workflow = make_workflow(
                tenant_id=ids["tenant_id"],
                app_id=ids["app_id"],
                workflow_id=ids["workflow_id"],
                graph={"nodes": [node_config], "edges": []},
            )
            monkeypatch.setattr(WorkflowEntry, "_run_node_with_layers", Mock())
            node, _ = WorkflowEntry.single_step_run(
                workflow=workflow,
                node_id=ids["node_id"],
                user_id="account",
                user_inputs={},
                variable_pool=VariablePool(),
                agent_binding_resolver=resolver,
                workflow_runtime=services.workflow_runtime,
            )
            assert isinstance(node, DifyAgentNode)
            assert node._binding_resolver.resolve(**ids).snapshot.id == snapshot.id
            with pytest.raises(ValueError, match="injected binding resolver"):
                WorkflowEntry.single_step_run(
                    workflow=workflow,
                    node_id=ids["node_id"],
                    user_id="account",
                    user_inputs={},
                    variable_pool=VariablePool(),
                    workflow_runtime=services.workflow_runtime,
                )
    finally:
        engine.dispose()


RESOLVER_MODELS = (WorkflowAgentNodeBinding, Agent, AgentConfigSnapshot, AgentConfigRevision)
CHATFLOW_MODELS = (
    *RESOLVER_MODELS,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentHomeSnapshot,
    WorkflowNodeExecutionModel,
)


def _conversation_participant(
    session: Session,
    *,
    ids: dict[str, str],
    binding: WorkflowAgentNodeBinding,
    snapshot: AgentConfigSnapshot,
) -> AgentWorkspaceBinding:
    workspace = AgentWorkspace(
        tenant_id=ids["tenant_id"],
        app_id=ids["app_id"],
        owner_type=AgentWorkspaceOwnerType.CONVERSATION,
        owner_id=ids["conversation_id"],
        owner_scope_key=f"{ids['node_id']}:{binding.id}",
        backend_workspace_ref="workspace-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        active_guard=1,
    )
    session.add(workspace)
    session.flush()
    participant = AgentWorkspaceBinding(
        tenant_id=ids["tenant_id"],
        app_id=ids["app_id"],
        workspace_id=workspace.id,
        agent_id=snapshot.agent_id,
        agent_config_version_id=snapshot.id,
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        base_home_snapshot_id=snapshot.home_snapshot_id,
        backend_binding_ref="participant-ref",
        status=AgentWorkingResourceStatus.ACTIVE,
        session_snapshot=CompositorSessionSnapshot(layers=[]).model_dump_json(),
    )
    session.add(participant)
    session.flush()
    return participant


@pytest.mark.parametrize("sqlite_session", [CHATFLOW_MODELS], indirect=True)
@pytest.mark.parametrize("binding_type", [WorkflowAgentBindingType.ROSTER_AGENT, WorkflowAgentBindingType.INLINE_AGENT])
def test_chatflow_keeps_participant_config_and_home_after_agent_update(
    binding_resolver: WorkflowAgentBindingResolver,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    binding_type: WorkflowAgentBindingType,
) -> None:
    ids = {**_resolve_ids(), "conversation_id": str(uuid4())}
    is_roster = binding_type == WorkflowAgentBindingType.ROSTER_AGENT
    agent = _agent(
        tenant_id=ids["tenant_id"],
        scope=AgentScope.ROSTER if is_roster else AgentScope.WORKFLOW_ONLY,
        source=AgentSource.ROSTER if is_roster else AgentSource.WORKFLOW,
    )
    sqlite_session.add(agent)
    sqlite_session.flush()
    original = _snapshot(tenant_id=ids["tenant_id"], agent_id=agent.id)
    original.home_snapshot_id = str(uuid4())
    sqlite_session.add(original)
    sqlite_session.flush()
    agent.active_config_snapshot_id = original.id
    binding = _binding(ids=ids, agent_id=agent.id, snapshot_id=original.id, binding_type=binding_type)
    sqlite_session.add(binding)
    sqlite_session.flush()
    participant = _conversation_participant(sqlite_session, ids=ids, binding=binding, snapshot=original)
    sqlite_session.commit()
    resolver = binding_resolver
    assert resolver.resolve(**ids).snapshot.id == original.id

    published = _snapshot(tenant_id=ids["tenant_id"], agent_id=agent.id)
    published.version = 2
    published.home_snapshot_id = str(uuid4())
    sqlite_session.add(published)
    sqlite_session.flush()
    agent.active_config_snapshot_id = published.id
    if not is_roster:
        binding.current_snapshot_id = published.id
    sqlite_session.commit()

    continuing = resolver.resolve(**ids)
    assert continuing.snapshot.id == original.id
    assert continuing.snapshot.home_snapshot_id == original.home_snapshot_id
    assert resolver.resolve(**{**ids, "conversation_id": str(uuid4())}).snapshot.id == published.id
    assert (
        resolver.resolve(
            tenant_id=ids["tenant_id"],
            app_id=ids["app_id"],
            workflow_id=ids["workflow_id"],
            node_id=ids["node_id"],
        ).snapshot.id
        == published.id
    )

    execution = WorkflowNodeExecutionModel(
        tenant_id=ids["tenant_id"],
        app_id=ids["app_id"],
        workflow_id=ids["workflow_id"],
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id=str(uuid4()),
        index=1,
        node_execution_id=str(uuid4()),
        node_id=ids["node_id"],
        node_type="agent",
        title="Agent",
        status=WorkflowNodeExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
    )
    sqlite_session.add(execution)
    sqlite_session.commit()
    create_binding = MagicMock(side_effect=AssertionError("must reuse the existing participant"))
    monkeypatch.setattr(AgentWorkspaceService, "create_binding", create_binding)
    scope = WorkflowAgentSessionScope(
        **ids,
        workflow_run_id=execution.workflow_run_id,
        node_execution_id=execution.id,
        workflow_agent_binding_id=binding.id,
        agent_id=agent.id,
        agent_config_snapshot_id=continuing.snapshot.id,
    )
    stored = WorkflowAgentWorkspaceStore().load_or_create_node_execution_session(
        scope,
        home_snapshot_id=continuing.snapshot.home_snapshot_id,
    )
    assert stored.binding_id == participant.id
    assert stored.backend_binding_ref == participant.backend_binding_ref
    assert stored.session_snapshot == CompositorSessionSnapshot(layers=[])
    create_binding.assert_not_called()

    agent.status = AgentStatus.ARCHIVED
    sqlite_session.commit()
    with pytest.raises(WorkflowAgentBindingError, match="not available"):
        resolver.resolve(**ids)


@pytest.mark.parametrize("mismatch", ["tenant", "app", "conversation", "node", "agent", "retired"])
@pytest.mark.parametrize("sqlite_session", [CHATFLOW_MODELS], indirect=True)
def test_chatflow_pin_is_scoped_to_active_conversation_node_participant(
    binding_resolver: WorkflowAgentBindingResolver,
    sqlite_session: Session,
    mismatch: str,
) -> None:
    ids = {**_resolve_ids(), "conversation_id": str(uuid4())}
    agent = _agent(tenant_id=ids["tenant_id"], scope=AgentScope.ROSTER, source=AgentSource.ROSTER)
    sqlite_session.add(agent)
    sqlite_session.flush()
    current = _snapshot(tenant_id=ids["tenant_id"], agent_id=agent.id)
    sqlite_session.add(current)
    sqlite_session.flush()
    agent.active_config_snapshot_id = current.id
    binding = _binding(
        ids=ids, agent_id=agent.id, snapshot_id=current.id, binding_type=WorkflowAgentBindingType.ROSTER_AGENT
    )
    sqlite_session.add(binding)
    sqlite_session.flush()
    participant = _conversation_participant(sqlite_session, ids=ids, binding=binding, snapshot=current)
    participant.agent_config_version_id = str(uuid4())
    workspace = sqlite_session.get(AgentWorkspace, participant.workspace_id)
    assert workspace is not None
    match mismatch:
        case "tenant":
            workspace.tenant_id = str(uuid4())
        case "app":
            workspace.app_id = str(uuid4())
        case "conversation":
            workspace.owner_id = str(uuid4())
        case "node":
            workspace.owner_scope_key = "another-node:another-binding"
        case "agent":
            participant.agent_id = str(uuid4())
        case "retired":
            participant.status = AgentWorkingResourceStatus.RETIRED
    sqlite_session.commit()

    assert binding_resolver.resolve(**ids).snapshot.id == current.id


@pytest.mark.parametrize("version_kind", [AgentConfigVersionKind.DRAFT, AgentConfigVersionKind.SNAPSHOT])
@pytest.mark.parametrize("sqlite_session", [CHATFLOW_MODELS], indirect=True)
def test_chatflow_never_falls_back_from_invalid_pinned_generation(
    binding_resolver: WorkflowAgentBindingResolver,
    sqlite_session: Session,
    version_kind: AgentConfigVersionKind,
) -> None:
    ids = {**_resolve_ids(), "conversation_id": str(uuid4())}
    agent = _agent(tenant_id=ids["tenant_id"], scope=AgentScope.ROSTER, source=AgentSource.ROSTER)
    sqlite_session.add(agent)
    sqlite_session.flush()
    current = _snapshot(tenant_id=ids["tenant_id"], agent_id=agent.id)
    sqlite_session.add(current)
    sqlite_session.flush()
    agent.active_config_snapshot_id = current.id
    binding = _binding(
        ids=ids, agent_id=agent.id, snapshot_id=current.id, binding_type=WorkflowAgentBindingType.ROSTER_AGENT
    )
    sqlite_session.add(binding)
    sqlite_session.flush()
    participant = _conversation_participant(sqlite_session, ids=ids, binding=binding, snapshot=current)
    participant.agent_config_version_kind = version_kind
    participant.agent_config_version_id = str(uuid4())
    sqlite_session.commit()

    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        binding_resolver.resolve(**ids)
    expected = (
        "agent_binding_generation_invalid"
        if version_kind == AgentConfigVersionKind.DRAFT
        else "agent_config_snapshot_not_found"
    )
    assert exc_info.value.error_code == expected


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
    binding_resolver: WorkflowAgentBindingResolver,
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
    bundle = binding_resolver.resolve(**ids)

    assert bundle.binding.id == binding.id
    assert bundle.agent.id == agent.id
    assert bundle.snapshot.id == snapshot.id
    assert inspect(bundle.binding).detached
    assert inspect(bundle.agent).detached
    assert inspect(bundle.snapshot).detached


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_uses_active_snapshot_for_roster_agent(
    binding_resolver: WorkflowAgentBindingResolver,
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
    bundle = binding_resolver.resolve(**ids)

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
    binding_resolver: WorkflowAgentBindingResolver,
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
    bundle = binding_resolver.resolve(
        **ids,
        binding_id=binding.id,
        snapshot_id=pinned_snapshot.id,
    )

    assert bundle.snapshot.id == pinned_snapshot.id
    first_statement = orm_statements[0]
    last_statement = orm_statements[-1]
    assert isinstance(first_statement, ClauseElement)
    assert isinstance(last_statement, ClauseElement)
    assert binding.id in first_statement.compile().params.values()
    assert pinned_snapshot.id in last_statement.compile().params.values()


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_does_not_fallback_from_an_explicit_empty_snapshot(
    binding_resolver: WorkflowAgentBindingResolver,
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
        binding_resolver.resolve(**ids, binding_id=binding.id, snapshot_id="")

    assert exc_info.value.error_code == "agent_config_snapshot_not_found"


@pytest.mark.parametrize(
    ("binding_id", "snapshot_id"),
    [("binding-1", None), (None, "snapshot-1")],
)
def test_binding_resolver_rejects_half_pinned_generation(
    binding_resolver: WorkflowAgentBindingResolver,
    binding_id: str | None,
    snapshot_id: str | None,
) -> None:
    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        binding_resolver.resolve(
            **_resolve_ids(),
            binding_id=binding_id,
            snapshot_id=snapshot_id,
        )

    assert exc_info.value.error_code == "agent_binding_generation_invalid"


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_rejects_unpublished_roster_agent(
    binding_resolver: WorkflowAgentBindingResolver,
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
        binding_resolver.resolve(**ids)

    assert exc_info.value.error_code == "agent_not_available"
    assert "not been published" in str(exc_info.value)


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_requires_publish_provenance_for_active_roster_snapshot(
    binding_resolver: WorkflowAgentBindingResolver,
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
        binding_resolver.resolve(**ids)
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

    bundle = binding_resolver.resolve(**ids)

    assert bundle.agent.id == agent.id
    assert bundle.snapshot.id == snapshot.id


def test_binding_resolver_raises_when_binding_missing(
    binding_resolver: WorkflowAgentBindingResolver,
) -> None:
    with pytest.raises(WorkflowAgentBindingError) as exc_info:
        binding_resolver.resolve(**_resolve_ids())

    assert exc_info.value.error_code == "agent_binding_not_found"


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_raises_when_agent_archived(
    binding_resolver: WorkflowAgentBindingResolver,
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
        binding_resolver.resolve(**ids)

    assert exc_info.value.error_code == "agent_not_available"


@pytest.mark.parametrize("sqlite_session", [RESOLVER_MODELS], indirect=True)
def test_binding_resolver_raises_when_snapshot_missing(
    binding_resolver: WorkflowAgentBindingResolver,
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
        binding_resolver.resolve(**ids)

    assert exc_info.value.error_code == "agent_config_snapshot_not_found"
