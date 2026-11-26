"""Native bindings preserve confirmed snapshots and native output contracts."""

import re

import pytest
import sqlalchemy.orm
from pydantic import JsonValue, ValidationError
from typing_extensions import TypedDict

from core.dify_builder.models import Actor, Graph
from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidationError
from services.dify_builder.agent_binding import AgentBindingSelection
from tests.builder_agent_fixtures import AgentCase
from tests.helpers.unit.config_override import apply_config_overrides


class ResolveSelection(TypedDict, closed=True):
    tenant_id: str
    app_id: str
    workflow_id: str
    node_id: str
    builder_actor: Actor
    selected_agent_id: str
    selected_snapshot_id: str
    conversation_id: str | None


def test_active_roster_drift_requires_reconfirmation() -> None:
    from services.dify_builder.agent_binding import AgentSnapshotChanged, require_selected_snapshot

    with pytest.raises(AgentSnapshotChanged) as error:
        require_selected_snapshot(selected_snapshot_id="snapshot-3", effective_snapshot_id="snapshot-4")
    assert error.value.effective_snapshot_id == "snapshot-4"
    require_selected_snapshot(selected_snapshot_id="snapshot-3", effective_snapshot_id="snapshot-3")


def test_native_job_contract_survives_graph_translation_and_prompt() -> None:
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.agent.graph_prompt import published_variables_of
    from services.dify_builder.agent.graph_translate import to_intents
    from services.dify_builder.agent_binding import native_node_data

    job = WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": "Review {{#start.report#}}",
            "declared_outputs": [
                {"name": "risks", "type": "array", "array_item": {"type": "object"}},
                {"name": "summary", "type": "string"},
            ],
        }
    )
    data = native_node_data(agent_id="agent-1", snapshot_id="snapshot-3", node_job=job)
    assert data["type"] == "agent"
    assert data["version"] == "2"
    assert data["agent_node_kind"] == "dify_agent"
    assert data["agent_binding"] == {
        "binding_type": "roster_agent",
        "agent_id": "agent-1",
        "current_snapshot_id": "snapshot-3",
    }
    outputs = data["agent_declared_outputs"]
    assert isinstance(outputs, list)
    names: list[JsonValue] = []
    for item in outputs:
        assert isinstance(item, dict)
        names.append(item["name"])
    assert names == ["risks", "summary"]
    intents = to_intents({"nodes": [{"id": "review", "data": data}], "edges": []})
    assert intents[0].args["config"]["agent_declared_outputs"] == data["agent_declared_outputs"]
    assert published_variables_of({"data": data}) == frozenset({"text", "risks", "summary"})


def test_only_bound_new_agent_is_admitted_by_proposal_policy() -> None:
    from core.dify_builder.models import MutationIntent
    from services.dify_builder.node_policy import proposal_policy_rejections

    data = {
        "version": "2",
        "agent_node_kind": "dify_agent",
        "agent_binding": {"binding_type": "roster_agent", "agent_id": "a", "current_snapshot_id": "s"},
    }
    graph: Graph = {"nodes": [], "edges": []}
    assert (
        proposal_policy_rejections(
            graph, [MutationIntent(op="create_node", args={"node_type": "agent", "config": data})]
        )
        == []
    )
    assert proposal_policy_rejections(
        graph, [MutationIntent(op="create_node", args={"node_type": "agent", "config": {}})]
    )


@pytest.fixture
def agent_case(sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch) -> AgentCase:
    from tests.builder_agent_fixtures import make_case

    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    case = make_case(sqlite_session)
    sqlite_session.commit()
    sqlite_session.begin()
    return case


def _selection(case: AgentCase) -> AgentBindingSelection:
    from services.dify_builder.agent_binding import AgentBindingSelection
    from services.dify_builder.agent_catalog import project_published_agent

    candidate = project_published_agent(agent=case.agent, snapshot=case.snapshot)
    return AgentBindingSelection(
        agent_id=case.agent.id, snapshot_id=case.snapshot.id, capability_digest=candidate.capability_digest
    )


def test_builder_agent_draft_keeps_the_same_revision_after_editor_save(
    agent_case: AgentCase,
    sqlite_session: sqlalchemy.orm.Session,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import Mock
    from uuid import uuid4

    from sqlalchemy import select

    from models.account import Account
    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from models.model import App
    from services.agent import session_policy
    from services.agent.workflow_publish_service import WorkflowAgentPublishService
    from services.dify_builder import dify_port
    from services.dify_builder.agent_binding import native_node_data
    from services.dify_builder.revision import execution_revision
    from services.workflow_service import WorkflowService

    allocate_generation = Mock(wraps=uuid4)
    monkeypatch.setattr(session_policy, "uuid4", allocate_generation)
    actor, workflow = agent_case.actor, agent_case.workflow
    selection = _selection(agent_case)
    original_hash = workflow.unique_hash
    candidate = dict(workflow.graph_dict)
    node_data = native_node_data(
        agent_id=selection.agent_id,
        snapshot_id=selection.snapshot_id,
        node_job=WorkflowNodeJobConfig(declared_outputs=[{"name": "summary", "type": "string"}]),
    )
    node_data["continue_agent_session"] = False
    candidate["nodes"].append({"id": "review", "data": node_data})
    selections = {"review": selection}
    prepared, bindings = dify_port._prepare_native_agent_graph(
        session=sqlite_session,
        actor=actor,
        workflow=workflow,
        graph=candidate,
        selections=selections,
        authorization=None,
    )
    assert bindings is not None
    assert workflow.unique_hash == original_hash
    allocate_generation.assert_not_called()

    app = sqlite_session.get(App, workflow.app_id)
    account = sqlite_session.get(Account, actor.account_id)
    assert app is not None
    assert account is not None
    service = WorkflowService(sqlite_session_factory)
    monkeypatch.setattr(dify_port, "WorkflowService", lambda: service)
    updated = dify_port._sync_graph_only(
        app, prepared, workflow, original_hash, account, sqlite_session, app.id, commit=False
    )
    bindings.sync_prepared_bindings(actor=actor, workflow=updated, selections=selections)
    allocate_generation.assert_called_once_with()
    assert updated.graph_dict["nodes"][1]["data"]["agent_binding"]["agent_id"] == selection.agent_id
    binding = sqlite_session.scalar(
        select(WorkflowAgentNodeBinding).where(
            WorkflowAgentNodeBinding.tenant_id == actor.tenant_id,
            WorkflowAgentNodeBinding.workflow_id == workflow.id,
            WorkflowAgentNodeBinding.node_id == "review",
        )
    )
    assert binding is not None
    assert binding.current_snapshot_id == selection.snapshot_id
    job = WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict)
    saved_node = updated.graph_dict["nodes"][1]["data"]
    assert saved_node["continue_agent_session"] is job.continue_agent_session is False
    assert saved_node["agent_session_generation"] == job.session_generation
    assert job.session_generation

    revision = execution_revision(updated)
    editor_graph = WorkflowAgentPublishService.project_draft_bindings_to_graph(
        session=sqlite_session, draft_workflow=updated
    )
    editor_save = service.sync_draft_workflow(
        app_model=app,
        graph=editor_graph,
        features=updated.features_dict,
        unique_hash=updated.unique_hash,
        account=account,
        environment_variables=[],
        conversation_variables=[],
        session=sqlite_session,
        graph_only=True,
        commit=False,
    )
    assert execution_revision(editor_save) == revision


def test_prepare_then_native_sync_share_one_rollback(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session
) -> None:
    import json

    from sqlalchemy import select

    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.agent_binding import AgentBindingService

    case = agent_case
    selection = _selection(case)
    graph_before = case.workflow.graph
    service = AgentBindingService(sqlite_session)
    data = service.prepare_node(
        actor=case.actor,
        workflow=case.workflow,
        candidate_graph=dict(case.workflow.graph_dict),
        node_id="review",
        selection=selection,
        node_job=WorkflowNodeJobConfig(
            workflow_prompt="Review {{#start.report#}}", declared_outputs=[{"name": "summary", "type": "string"}]
        ),
    )
    graph = case.workflow.graph_dict
    graph["nodes"].append({"id": "review", "data": data})
    case.workflow.graph = json.dumps(graph)
    service.sync_prepared_bindings(actor=case.actor, workflow=case.workflow, selections={"review": selection})
    saved_binding = sqlite_session.scalar(
        select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == case.workflow.id)
    )
    assert saved_binding is not None
    assert saved_binding.current_snapshot_id == selection.snapshot_id
    workflow_id = case.workflow.id
    sqlite_session.rollback()
    from models.workflow import Workflow

    restored = sqlite_session.get(Workflow, workflow_id)
    assert restored is not None
    assert restored.graph == graph_before
    assert (
        sqlite_session.scalar(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == workflow_id)
        )
        is None
    )


def test_changed_start_snapshot_stops_before_native_sync(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session
) -> None:
    from models.agent import AgentConfigSnapshot
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.agent_binding import AgentBindingService, AgentSnapshotChanged

    case = agent_case
    selection = _selection(case)
    replacement = AgentConfigSnapshot(
        tenant_id=case.actor.tenant_id, agent_id=case.agent.id, version=2, config_snapshot=case.snapshot.config_snapshot
    )
    sqlite_session.add(replacement)
    sqlite_session.flush()
    case.agent.active_config_snapshot_id = replacement.id
    from models.agent import AgentConfigRevision, AgentConfigRevisionOperation

    sqlite_session.add(
        AgentConfigRevision(
            tenant_id=case.actor.tenant_id,
            agent_id=case.agent.id,
            current_snapshot_id=replacement.id,
            revision=2,
            operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
        )
    )
    sqlite_session.flush()
    with pytest.raises(AgentSnapshotChanged):
        AgentBindingService(sqlite_session).prepare_node(
            actor=case.actor,
            workflow=case.workflow,
            candidate_graph=dict(case.workflow.graph_dict),
            node_id="review",
            selection=selection,
            node_job=WorkflowNodeJobConfig(),
        )
    assert "review" not in [n["id"] for n in case.workflow.graph_dict["nodes"]]


@pytest.mark.parametrize(
    "job",
    [
        {"workflow_prompt": "{{#missing.report#}}"},
        {"workflow_prompt": "{{#review.summary#}}"},
        {"declared_outputs": [{"name": "summary", "type": "string"}, {"name": "summary", "type": "number"}]},
    ],
)
def test_prepare_uses_native_input_and_output_validators(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session, job: dict[str, JsonValue]
) -> None:
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.agent_binding import AgentBindingService

    if "declared_outputs" in job:
        reason = "Workflow Agent node review has duplicate output name summary."
    elif isinstance(job["workflow_prompt"], str) and "missing" in job["workflow_prompt"]:
        reason = "Workflow Agent node review references missing previous node missing."
    else:
        reason = "Workflow Agent node review references non-upstream previous node review."
    with pytest.raises(WorkflowAgentNodeValidationError, match=re.escape(reason)):
        AgentBindingService(sqlite_session).prepare_node(
            actor=agent_case.actor,
            workflow=agent_case.workflow,
            candidate_graph=dict(agent_case.workflow.graph_dict),
            node_id="review",
            selection=_selection(agent_case),
            node_job=WorkflowNodeJobConfig.model_validate(job),
        )


def test_current_membership_revocation_blocks_apply(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session
) -> None:
    from sqlalchemy import delete

    from models.account import TenantAccountJoin
    from models.agent_config_entities import WorkflowNodeJobConfig
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.agent_binding import AgentBindingService

    sqlite_session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == agent_case.actor.account_id))
    with pytest.raises(BuilderExecutionPolicyError, match="agent_access_denied"):
        AgentBindingService(sqlite_session).prepare_node(
            actor=agent_case.actor,
            workflow=agent_case.workflow,
            candidate_graph=dict(agent_case.workflow.graph_dict),
            node_id="review",
            selection=_selection(agent_case),
            node_job=WorkflowNodeJobConfig(),
        )


def test_sync_cannot_skip_native_selection_admission(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.agent_binding import AgentBindingService

    with pytest.raises(BuilderExecutionPolicyError, match="agent_binding_not_prepared"):
        AgentBindingService(sqlite_session).sync_prepared_bindings(
            actor=agent_case.actor, workflow=agent_case.workflow, selections={"review": _selection(agent_case)}
        )


def test_translation_rejects_invalid_native_declared_output_type() -> None:
    from services.dify_builder.agent.graph_translate import to_intents

    data = {
        "type": "agent",
        "version": "2",
        "title": "Review",
        "agent_node_kind": "dify_agent",
        "agent_declared_outputs": [{"name": "summary", "type": "invented-type"}],
    }
    with pytest.raises(ValidationError, match=r"declared_outputs\.0\.type"):
        to_intents({"nodes": [{"id": "review", "data": data}], "edges": []})


def test_full_native_node_job_is_persisted_in_existing_binding_owner(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session
) -> None:
    import json

    from sqlalchemy import select

    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.agent_binding import AgentBindingService

    service = AgentBindingService(sqlite_session)
    selection = _selection(agent_case)
    job = WorkflowNodeJobConfig.model_validate(
        {
            "mode": "let_agent_figure_it_out",
            "human_contacts": [{"contact_id": "contact-1", "tenant_id": agent_case.actor.tenant_id, "channel": "chat"}],
        }
    )
    data = service.prepare_node(
        actor=agent_case.actor,
        workflow=agent_case.workflow,
        candidate_graph=dict(agent_case.workflow.graph_dict),
        node_id="review",
        selection=selection,
        node_job=job,
    )
    graph = agent_case.workflow.graph_dict
    graph["nodes"].append({"id": "review", "data": data})
    agent_case.workflow.graph = json.dumps(graph)
    service.sync_prepared_bindings(
        actor=agent_case.actor, workflow=agent_case.workflow, selections={"review": selection}
    )
    binding = sqlite_session.scalar(
        select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == agent_case.workflow.id)
    )
    assert binding is not None
    assert binding.node_job_config_dict["mode"] == "let_agent_figure_it_out"
    assert binding is not None
    assert binding.node_job_config_dict["human_contacts"][0]["contact_id"] == "contact-1"


def test_native_authorization_rpc_precedes_draft_transaction(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder import agent_access as access_service
    from services.dify_builder.agent_binding import AgentBindingService
    from services.enterprise.rbac_service import RBACService

    app_id, agent_id = agent_case.workflow.app_id, agent_case.agent.id
    sqlite_session.rollback()
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    checked = []

    def remote_check(*_args: object, **_kwargs: object) -> bool:
        assert not sqlite_session.in_transaction()
        checked.append("RPC")
        return True

    monkeypatch.setattr(RBACService.CheckAccess, "check", remote_check)
    monkeypatch.setattr(
        access_service,
        "resolve_current_agent_access_filter",
        lambda **_kwargs: access_service.AgentAccessFilter.unrestricted(),
    )
    grant = AgentBindingService.authorize(actor=agent_case.actor, app_id=app_id, agent_ids=frozenset({agent_id}))
    assert checked == ["RPC", "RPC"]
    sqlite_session.begin()
    AgentBindingService(sqlite_session, authorization=grant).prepare_node(
        actor=agent_case.actor,
        workflow=agent_case.workflow,
        candidate_graph=dict(agent_case.workflow.graph_dict),
        node_id="review",
        selection=_selection(agent_case),
        node_job=WorkflowNodeJobConfig(),
    )
    assert checked == ["RPC", "RPC"]


@pytest.mark.parametrize("omission", ["additional", "empty", "advanced_existing", "removed_existing"])
def test_sync_requires_complete_graph_and_existing_binding_coverage(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session, omission: str
) -> None:
    import json

    from models.agent import (
        AgentConfigRevision,
        AgentConfigRevisionOperation,
        AgentConfigSnapshot,
        WorkflowAgentBindingType,
        WorkflowAgentNodeBinding,
    )
    from models.agent_config_entities import WorkflowNodeJobConfig
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.agent_binding import AgentBindingService, native_node_data
    from tests.builder_agent_fixtures import add_agent

    case = agent_case
    selection = _selection(case)
    service = AgentBindingService(sqlite_session)
    data = service.prepare_node(
        actor=case.actor,
        workflow=case.workflow,
        candidate_graph=dict(case.workflow.graph_dict),
        node_id="review",
        selection=selection,
        node_job=WorkflowNodeJobConfig(),
    )
    graph = case.workflow.graph_dict
    graph["nodes"].append({"id": "review", "data": data})
    other_snapshot: AgentConfigSnapshot | None = None
    if omission != "empty":
        other_agent, other_snapshot = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Unprepared Agent")
        other_data = native_node_data(
            agent_id=other_agent.id, snapshot_id=other_snapshot.id, node_job=WorkflowNodeJobConfig()
        )
        if omission != "removed_existing":
            graph["nodes"].append({"id": "unprepared", "data": other_data})
        if omission in {"advanced_existing", "removed_existing"}:
            sqlite_session.add(
                WorkflowAgentNodeBinding(
                    tenant_id=case.actor.tenant_id,
                    app_id=case.workflow.app_id,
                    workflow_id=case.workflow.id,
                    workflow_version="draft",
                    node_id="unprepared",
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    agent_id=other_agent.id,
                    current_snapshot_id=other_snapshot.id,
                    node_job_config=WorkflowNodeJobConfig(),
                )
            )
            if omission == "advanced_existing":
                replacement = AgentConfigSnapshot(
                    tenant_id=case.actor.tenant_id,
                    agent_id=other_agent.id,
                    version=2,
                    config_snapshot=other_snapshot.config_snapshot,
                )
                sqlite_session.add(replacement)
                sqlite_session.flush()
                other_agent.active_config_snapshot_id = replacement.id
                sqlite_session.add(
                    AgentConfigRevision(
                        tenant_id=case.actor.tenant_id,
                        agent_id=other_agent.id,
                        current_snapshot_id=replacement.id,
                        revision=2,
                        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
                    )
                )
    case.workflow.graph = json.dumps(graph)
    sqlite_session.flush()
    with pytest.raises(BuilderExecutionPolicyError, match="agent_binding_not_prepared"):
        service.sync_prepared_bindings(
            actor=case.actor, workflow=case.workflow, selections={} if omission == "empty" else {"review": selection}
        )
    from sqlalchemy import select

    bindings = sqlite_session.scalars(
        select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == case.workflow.id)
    ).all()
    if omission in {"advanced_existing", "removed_existing"}:
        assert other_snapshot is not None
        assert [(binding.node_id, binding.current_snapshot_id) for binding in bindings] == [
            ("unprepared", other_snapshot.id)
        ]
    else:
        assert bindings == []


def test_complete_prepared_multi_agent_graph_syncs_all_owned_bindings(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session
) -> None:
    import json

    from sqlalchemy import select

    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.agent_binding import AgentBindingService

    service = AgentBindingService(sqlite_session)
    selection = _selection(agent_case)
    graph = agent_case.workflow.graph_dict
    for node_id in ("first", "second"):
        data = service.prepare_node(
            actor=agent_case.actor,
            workflow=agent_case.workflow,
            candidate_graph=dict(agent_case.workflow.graph_dict),
            node_id=node_id,
            selection=selection,
            node_job=WorkflowNodeJobConfig(),
        )
        graph["nodes"].append({"id": node_id, "data": data})
    agent_case.workflow.graph = json.dumps(graph)
    service.sync_prepared_bindings(
        actor=agent_case.actor, workflow=agent_case.workflow, selections={"first": selection, "second": selection}
    )
    bindings = sqlite_session.scalars(
        select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == agent_case.workflow.id)
    ).all()
    assert {(binding.node_id, binding.current_snapshot_id) for binding in bindings} == {
        ("first", selection.snapshot_id),
        ("second", selection.snapshot_id),
    }
