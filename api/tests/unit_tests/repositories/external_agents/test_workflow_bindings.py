"""Real SQL transactions for epoch transitions, CAS and selection fences."""

import copy
import json
from collections.abc import Iterator
from typing import NotRequired
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from typing_extensions import TypedDict

from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import Agent, AgentKind, AgentScope, AgentSource, AgentStatus, WorkflowAgentNodeBinding
from models.external_agent import ExternalAgentHead
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from repositories.external_agents.workflow_bindings import (
    ExternalWorkflowBindingRepository,
    project_external_bindings,
    sync_external_bindings,
)
from services.agent.dsl_service import AgentDslService
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.app_dsl_service import AppDslService
from services.external_agents.contracts import ExternalAgentConflictError, ExternalAgentForbiddenError
from services.external_agents.io_contracts import JsonObject
from services.external_agents.workflow_portability import reference_value

type BindingDomain = tuple[sessionmaker[Session], RequestContext, str, str, str, str]


class Reference(TypedDict):
    binding_type: str
    agent_id: str | None
    original_reference: NotRequired[JsonObject]


class AgentData(TypedDict):
    type: str
    version: str
    agent_node_kind: str
    agent_task: str
    agent_declared_outputs: list[dict[str, str]]
    external_wait: dict[str, bool]
    agent_binding: Reference


class AgentNode(TypedDict):
    id: str
    data: AgentData


class AgentGraph(TypedDict):
    nodes: list[AgentNode]
    edges: list[dict[str, str]]


def stored[T](session: Session, model: type[T], key: object) -> T:
    value = session.get(model, key)
    assert value is not None
    return value


def uid() -> str:
    return str(uuid4())


def graph(agent_id: str) -> AgentGraph:
    return {
        "nodes": [
            {
                "id": "one",
                "data": {
                    "type": "agent",
                    "version": "2",
                    "agent_node_kind": "external_a2a",
                    "agent_task": "A task",
                    "agent_declared_outputs": [{"name": "text", "type": "string"}],
                    "external_wait": {"enabled": False},
                    "agent_binding": {"binding_type": "roster_agent", "agent_id": agent_id},
                },
            }
        ],
        "edges": [{"source": "one", "target": "end"}],
    }


@pytest.fixture
def domain() -> Iterator[BindingDomain]:
    engine = create_engine("sqlite://")
    for model in (TenantAccountJoin, Agent, ExternalAgentHead, WorkflowAgentNodeBinding, App, Workflow):
        model.metadata.tables[model.__tablename__].create(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    context = RequestContext("test", None, uid(), uid())
    app_id, workflow_id, agent_a, agent_b = uid(), uid(), uid(), uid()
    with sessions.begin() as session:
        session.add(
            TenantAccountJoin(
                tenant_id=context.active_workspace_id, account_id=context.account_id, role=TenantAccountRole.EDITOR
            )
        )
        session.add(
            App(
                id=app_id,
                tenant_id=context.active_workspace_id,
                name="Workflow",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
            )
        )
        for identifier in (agent_a, agent_b):
            session.add(
                Agent(
                    id=identifier,
                    tenant_id=context.active_workspace_id,
                    name=identifier,
                    agent_kind=AgentKind.EXTERNAL_A2A,
                    scope=AgentScope.ROSTER,
                    source=AgentSource.ROSTER,
                    status=AgentStatus.ACTIVE,
                )
            )
            session.add(
                ExternalAgentHead(
                    agent_id=identifier,
                    tenant_id=context.active_workspace_id,
                    active_connection_revision_id=uid(),
                    enabled=False,
                )
            )
        session.add(
            Workflow(
                id=workflow_id,
                tenant_id=context.active_workspace_id,
                app_id=app_id,
                type=WorkflowType.WORKFLOW,
                version=Workflow.VERSION_DRAFT,
                graph=json.dumps(graph(agent_a)),
                _features="{}",
                created_by=context.account_id,
            )
        )
    yield sessions, context, app_id, workflow_id, agent_a, agent_b
    engine.dispose()


def test_sync_external_has_no_native_snapshot_and_real_change_alone_rotates_epoch(domain: BindingDomain) -> None:
    sessions, context, _app, workflow_id, agent_a, agent_b = domain
    with sessions.begin() as session:
        workflow = stored(session, Workflow, workflow_id)
        WorkflowAgentPublishService.sync_agent_bindings_for_draft(
            session=session, draft_workflow=workflow, account_id=context.account_id
        )
        binding = session.scalars(select(WorkflowAgentNodeBinding)).one()
        first = binding.binding_epoch
        assert first
        assert binding.current_snapshot_id is None
        assert binding.external_job_config["schema_version"] == 1
        sync_external_bindings(session=session, workflow=workflow, account_id=context.account_id)
        assert binding.binding_epoch == first
        workflow.graph = json.dumps(graph(agent_b))
        sync_external_bindings(session=session, workflow=workflow, account_id=context.account_id)
        second = binding.binding_epoch
        assert second != first
        workflow.graph = json.dumps(graph(agent_a))
        sync_external_bindings(session=session, workflow=workflow, account_id=context.account_id)
        assert binding.binding_epoch not in (first, second)


def test_export_never_enters_native_package_or_exports_connection(domain: BindingDomain) -> None:
    sessions, context, _app, workflow_id, agent_a, _b = domain
    with sessions.begin() as session:
        workflow = stored(session, Workflow, workflow_id)
        sync_external_bindings(session=session, workflow=workflow, account_id=context.account_id)
        exported, packages = AgentDslService(session).export_workflow_packages(
            workflow=workflow, graph=workflow.graph_dict
        )
        assert packages == {}
        binding = exported["nodes"][0]["data"]["agent_binding"]
        assert "agent_id" not in binding
        assert "binding_epoch" not in binding
        assert binding["original_reference"]["agent_id"] == agent_a
        assert exported["edges"] == workflow.graph_dict["edges"]


@pytest.mark.parametrize("allowed", [True, False])
def test_disabled_same_workspace_dsl_reference_restores_only_when_currently_accessible(
    domain: BindingDomain, allowed: bool
) -> None:
    sessions, context, _app, workflow_id, agent_a, _b = domain
    expected_actor, expected_tenant = context.account_id, context.active_workspace_id

    class CurrentAssetAccess:
        def role(self, context: RequestContext) -> str | None:
            assert context.account_id == expected_actor
            return "editor"

        def visible_agent_ids(self, context: RequestContext) -> frozenset[str] | None:
            assert context.active_workspace_id == expected_tenant
            return None if allowed else frozenset[str]()

    with sessions.begin() as session:
        workflow = stored(session, Workflow, workflow_id)
        sync_external_bindings(session=session, workflow=workflow, account_id=context.account_id)
        exported, _packages = AgentDslService(session).export_workflow_packages(
            workflow=workflow, graph=workflow.graph_dict
        )
    with sessions() as session:
        importer = AppDslService(session, external_access=CurrentAssetAccess())
        importer._preflight_external_references(
            exported, tenant_id=context.active_workspace_id, account_id=context.account_id
        )
        restored = importer._import_external_graph(
            exported, tenant_id=context.active_workspace_id, account_id=context.account_id
        )
        binding = restored["nodes"][0]["data"]["agent_binding"]
        assert binding.get("agent_id") == (agent_a if allowed else None)
        assert binding["original_reference"]["agent_id"] == agent_a
        assert bool(importer._warnings) is not allowed


def test_published_external_binding_preserves_generation_without_a_native_snapshot_table(domain: BindingDomain) -> None:
    sessions, context, app_id, workflow_id, _a, _b = domain
    with sessions.begin() as session:
        draft = stored(session, Workflow, workflow_id)
        sync_external_bindings(session=session, workflow=draft, account_id=context.account_id)
        epoch = session.scalars(select(WorkflowAgentNodeBinding.binding_epoch)).one()
        published = Workflow(
            id=uid(),
            tenant_id=context.active_workspace_id,
            app_id=app_id,
            type=WorkflowType.WORKFLOW,
            version="published",
            graph=draft.graph,
            _features="{}",
            created_by=context.account_id,
        )
        session.add(published)
        WorkflowAgentPublishService.copy_agent_node_bindings_to_published(
            session=session, draft_workflow=draft, published_workflow=published
        )
        session.flush()
        rows = tuple(session.scalars(select(WorkflowAgentNodeBinding)))
        assert len(rows) == 2
        assert all(row.binding_epoch == epoch for row in rows)
        assert all(row.current_snapshot_id is None for row in rows)


def test_rebind_cas_and_permission_failure_leave_whole_draft_unchanged(domain: BindingDomain) -> None:
    sessions, context, app_id, workflow_id, _a, agent_b = domain
    repo = ExternalWorkflowBindingRepository(sessions=sessions)
    with sessions() as session:
        original = stored(session, Workflow, workflow_id).unique_hash
    for expected_hash, visible_ids, error in [
        ("stale", None, ExternalAgentConflictError),
        (original, frozenset[str](), ExternalAgentForbiddenError),
    ]:
        with pytest.raises(error):
            repo.rebind(
                context=context,
                app_id=app_id,
                node_id="one",
                target_agent_id=agent_b,
                expected_hash=expected_hash,
                include_matching=True,
                visible_ids=visible_ids,
            )
        with sessions() as session:
            assert stored(session, Workflow, workflow_id).unique_hash == original
            assert session.scalar(select(WorkflowAgentNodeBinding)) is None
    result = repo.rebind(
        context=context,
        app_id=app_id,
        node_id="one",
        target_agent_id=agent_b,
        expected_hash=original,
        include_matching=True,
        visible_ids=None,
    )
    assert result.node_ids == ("one",)
    with sessions() as session:
        workflow = stored(session, Workflow, workflow_id)
        projected = project_external_bindings(session=session, workflow=workflow, graph=workflow.graph_dict)
        assert projected["nodes"][0]["data"]["agent_binding"]["agent_id"] == agent_b
        assert projected["edges"] == graph(agent_b)["edges"]
        assert result.binding_epochs["one"]


def test_batch_rebind_changes_only_selected_and_matching_unconnected_rows(domain: BindingDomain) -> None:
    sessions, context, app_id, workflow_id, agent_a, agent_b = domain
    with sessions.begin() as session:
        workflow = stored(session, Workflow, workflow_id)
        original = graph(agent_a)
        source = reference_value(workspace_id=context.active_workspace_id, agent_id=agent_a, name="A")
        original["nodes"][0]["data"]["agent_binding"]["original_reference"] = source
        for identifier, connected in [("matching", False), ("connected", True), ("different", False)]:
            extra = copy.deepcopy(original["nodes"][0])
            extra["id"] = identifier
            extra["data"]["agent_task"] = identifier
            extra["data"]["agent_binding"]["agent_id"] = agent_a if connected else None
            if identifier == "different":
                extra["data"]["agent_binding"]["original_reference"] = reference_value(
                    workspace_id=context.active_workspace_id, agent_id=uid(), name="A"
                )
            original["nodes"].append(extra)
        workflow.graph = json.dumps(original)
        sync_external_bindings(session=session, workflow=workflow, account_id=context.account_id)
        prior_hash = workflow.unique_hash
        connected_epoch = session.scalars(
            select(WorkflowAgentNodeBinding.binding_epoch).where(WorkflowAgentNodeBinding.node_id == "connected")
        ).one()
    result = ExternalWorkflowBindingRepository(sessions=sessions).rebind(
        context=context,
        app_id=app_id,
        node_id="one",
        target_agent_id=agent_b,
        expected_hash=prior_hash,
        include_matching=True,
        visible_ids=None,
    )
    assert result.node_ids == ("one", "matching")
    with sessions() as session:
        rows = {row.node_id: row for row in session.scalars(select(WorkflowAgentNodeBinding))}
        assert rows["one"].agent_id == agent_b
        assert rows["matching"].agent_id == agent_b
        assert rows["matching"].external_job_config["agent_task"] == "matching"
        assert rows["connected"].agent_id == agent_a
        assert rows["connected"].binding_epoch == connected_epoch
        assert rows["different"].agent_id is None
