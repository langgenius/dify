"""Native bindings preserve confirmed snapshots and native output contracts."""

import pytest


def test_active_roster_drift_requires_reconfirmation():
    from services.dify_builder.native_testing.agent_binding import AgentSnapshotChanged, require_selected_snapshot

    with pytest.raises(AgentSnapshotChanged) as error:
        require_selected_snapshot(selected_snapshot_id="snapshot-3", effective_snapshot_id="snapshot-4")
    assert error.value.effective_snapshot_id == "snapshot-4"
    require_selected_snapshot(selected_snapshot_id="snapshot-3", effective_snapshot_id="snapshot-3")


def test_native_job_contract_survives_graph_translation_and_prompt():
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.agent.graph_prompt import published_variables_of
    from services.dify_builder.agent.graph_translate import to_intents
    from services.dify_builder.native_testing.agent_binding import native_node_data

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
    assert [item["name"] for item in data["agent_declared_outputs"]] == ["risks", "summary"]
    intents = to_intents({"nodes": [{"id": "review", "data": data}], "edges": []})
    assert intents[0].args["config"]["agent_declared_outputs"] == data["agent_declared_outputs"]
    assert published_variables_of({"data": data}) == frozenset({"text", "risks", "summary"})


def test_only_bound_new_agent_is_admitted_by_proposal_policy():
    from core.dify_builder.models import MutationIntent
    from services.dify_builder.node_policy import proposal_policy_rejections

    data = {
        "version": "2",
        "agent_node_kind": "dify_agent",
        "agent_binding": {"binding_type": "roster_agent", "agent_id": "a", "current_snapshot_id": "s"},
    }
    graph = {"nodes": [], "edges": []}
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
def agent_case(sqlite_session, monkeypatch):
    from configs import dify_config
    from tests.builder_agent_fixtures import make_case

    monkeypatch.setattr(dify_config, "RBAC_ENABLED", False)
    case = make_case(sqlite_session)
    sqlite_session.commit()
    sqlite_session.begin()
    return case


def _selection(case):
    from services.dify_builder.native_testing.agent_binding import AgentBindingSelection
    from services.dify_builder.native_testing.agent_catalog import project_published_agent

    candidate = project_published_agent(agent=case.agent, snapshot=case.snapshot)
    return AgentBindingSelection(
        agent_id=case.agent.id, snapshot_id=case.snapshot.id, capability_digest=candidate.capability_digest
    )


def test_prepare_then_native_sync_share_one_rollback(agent_case, sqlite_session):
    import json

    from sqlalchemy import select

    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_binding import AgentBindingService

    case = agent_case
    selection = _selection(case)
    graph_before = case.workflow.graph
    service = AgentBindingService(sqlite_session)
    data = service.prepare_node(
        actor=case.actor,
        workflow=case.workflow,
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
    assert (
        sqlite_session.scalar(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == case.workflow.id)
        ).current_snapshot_id
        == selection.snapshot_id
    )
    workflow_id = case.workflow.id
    sqlite_session.rollback()
    from models.workflow import Workflow

    assert sqlite_session.get(Workflow, workflow_id).graph == graph_before
    assert (
        sqlite_session.scalar(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == workflow_id)
        )
        is None
    )


def test_changed_start_snapshot_stops_before_native_sync(agent_case, sqlite_session):
    from models.agent import AgentConfigSnapshot
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_binding import AgentBindingService, AgentSnapshotChanged

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
def test_prepare_uses_native_input_and_output_validators(agent_case, sqlite_session, job):
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_binding import AgentBindingService

    with pytest.raises(ValueError):
        AgentBindingService(sqlite_session).prepare_node(
            actor=agent_case.actor,
            workflow=agent_case.workflow,
            node_id="review",
            selection=_selection(agent_case),
            node_job=WorkflowNodeJobConfig.model_validate(job),
        )


def test_current_membership_revocation_blocks_apply(agent_case, sqlite_session):
    from sqlalchemy import delete

    from models.account import TenantAccountJoin
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_binding import AgentBindingService

    sqlite_session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == agent_case.actor.account_id))
    with pytest.raises(BuilderExecutionPolicyError, match="agent_access_denied"):
        AgentBindingService(sqlite_session).prepare_node(
            actor=agent_case.actor,
            workflow=agent_case.workflow,
            node_id="review",
            selection=_selection(agent_case),
            node_job=WorkflowNodeJobConfig(),
        )


@pytest.mark.parametrize("conversation_id", [None, "new-test-conversation"])
def test_fresh_native_resolution_reconfirms_but_paused_keeps_snapshot(
    agent_case, sqlite_session, monkeypatch, conversation_id
):
    from contextlib import contextmanager

    from core.workflow.nodes.agent_v2 import binding_resolver
    from models.agent import (
        AgentConfigRevision,
        AgentConfigRevisionOperation,
        AgentConfigSnapshot,
        WorkflowAgentBindingType,
        WorkflowAgentNodeBinding,
    )
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_binding import AgentSnapshotChanged

    case = agent_case
    old_id = case.snapshot.id
    binding = WorkflowAgentNodeBinding(
        tenant_id=case.actor.tenant_id,
        app_id=case.workflow.app_id,
        workflow_id=case.workflow.id,
        workflow_version="draft",
        node_id="review",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id=case.agent.id,
        current_snapshot_id=old_id,
        node_job_config=WorkflowNodeJobConfig(),
    )
    sqlite_session.add(binding)
    replacement = AgentConfigSnapshot(
        tenant_id=case.actor.tenant_id, agent_id=case.agent.id, version=2, config_snapshot=case.snapshot.config_snapshot
    )
    sqlite_session.add(replacement)
    sqlite_session.flush()
    case.agent.active_config_snapshot_id = replacement.id
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

    @contextmanager
    def session_context():
        yield sqlite_session

    monkeypatch.setattr(binding_resolver.session_factory, "create_session", session_context)
    args = {
        "tenant_id": case.actor.tenant_id,
        "app_id": case.workflow.app_id,
        "workflow_id": case.workflow.id,
        "node_id": "review",
        "builder_actor": case.actor,
        "selected_agent_id": case.agent.id,
        "selected_snapshot_id": old_id,
        "conversation_id": conversation_id,
    }
    with pytest.raises(AgentSnapshotChanged):
        binding_resolver.WorkflowAgentBindingResolver().resolve(**args)
    ordinary_args = {key: value for key, value in args.items() if not key.startswith(("builder_", "selected_"))}
    assert binding_resolver.WorkflowAgentBindingResolver().resolve(**ordinary_args).snapshot.id == replacement.id
    pinned = binding_resolver.WorkflowAgentBindingResolver().resolve(**args, binding_id=binding.id, snapshot_id=old_id)
    assert pinned.snapshot.id == old_id


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ("published", "agent_snapshot_changed"),
        ("binding", "agent_binding_owner_mismatch"),
        ("membership", "agent_access_denied"),
        ("preview", "agent_access_denied"),
    ],
)
def test_confirmed_ordinary_agent_rechecks_selection_before_backend(
    agent_case, sqlite_session, monkeypatch, change, reason
):
    """The actual ordinary node must refuse changed authority before allocation or dispatch."""
    from contextlib import contextmanager

    from configs import dify_config
    from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
    from core.rbac import RBACPermission
    from core.workflow.nodes.agent_v2 import binding_resolver
    from graphon.entities import GraphInitParams
    from graphon.enums import WorkflowNodeExecutionStatus
    from models.account import TenantAccountJoin
    from models.agent import AgentConfigSnapshot, WorkflowAgentBindingType, WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.agent import access_service
    from services.enterprise.rbac_service import RBACService
    from tests.builder_agent_fixtures import add_agent
    from tests.unit_tests.core.workflow.nodes.agent_v2.test_agent_node import _node

    case = agent_case
    selected_id, selected_snapshot_id = case.agent.id, case.snapshot.id
    binding = WorkflowAgentNodeBinding(
        tenant_id=case.actor.tenant_id,
        app_id=case.workflow.app_id,
        workflow_id=case.workflow.id,
        workflow_version="draft",
        node_id="agent-node",
        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
        agent_id=selected_id,
        current_snapshot_id=selected_snapshot_id,
        node_job_config=WorkflowNodeJobConfig(),
    )
    sqlite_session.add(binding)
    if change == "published":
        replacement = AgentConfigSnapshot(
            tenant_id=case.actor.tenant_id,
            agent_id=selected_id,
            version=2,
            config_snapshot=case.snapshot.config_snapshot,
        )
        sqlite_session.add(replacement)
        sqlite_session.flush()
        case.agent.active_config_snapshot_id = replacement.id
        from models.agent import AgentConfigRevision, AgentConfigRevisionOperation

        sqlite_session.add(
            AgentConfigRevision(
                tenant_id=case.actor.tenant_id,
                agent_id=selected_id,
                current_snapshot_id=replacement.id,
                revision=2,
                operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
            )
        )
    elif change == "binding":
        other, snapshot = add_agent(sqlite_session, tenant_id=case.actor.tenant_id, name="Unselected")
        binding.agent_id, binding.current_snapshot_id = other.id, snapshot.id
    elif change == "membership":
        membership = sqlite_session.query(TenantAccountJoin).filter_by(account_id=case.actor.account_id).one()
        sqlite_session.delete(membership)
    sqlite_session.commit()
    if change == "preview":
        monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
        monkeypatch.setattr(
            access_service,
            "resolve_current_agent_access_filter",
            lambda **_kwargs: access_service.AgentAccessFilter.unrestricted(),
        )
        monkeypatch.setattr(
            RBACService.CheckAccess,
            "check",
            lambda *_args, **kwargs: kwargs["scene"] != RBACPermission.AGENT_PREVIEW,
        )

    @contextmanager
    def session_context():
        yield sqlite_session

    monkeypatch.setattr(binding_resolver.session_factory, "create_session", session_context)
    graph = {
        "nodes": [
            {
                "id": "agent-node",
                "data": {
                    "type": "agent",
                    "version": "2",
                    "agent_node_kind": "dify_agent",
                    "agent_binding": {
                        "binding_type": "roster_agent",
                        "agent_id": selected_id,
                        "current_snapshot_id": selected_snapshot_id,
                    },
                },
            }
        ]
    }
    context = DifyRunContext(
        tenant_id=case.actor.tenant_id,
        app_id=case.workflow.app_id,
        user_id=case.actor.account_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        builder_tool_credential_bindings={},
    )
    node = _node(
        graph_init_params=GraphInitParams(
            workflow_id=case.workflow.id,
            graph_config=graph,
            run_context={DIFY_RUN_CONTEXT_KEY: context},
            call_depth=0,
        )
    )
    node._binding_resolver = binding_resolver.WorkflowAgentBindingResolver()

    events = list(node._run())

    result = events[-1].node_run_result
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == reason
    assert node._agent_backend_client.request is None
    assert node._session_store.resolved_scopes == []


def test_sync_cannot_skip_native_selection_admission(agent_case, sqlite_session):
    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_binding import AgentBindingService

    with pytest.raises(BuilderExecutionPolicyError, match="agent_binding_not_prepared"):
        AgentBindingService(sqlite_session).sync_prepared_bindings(
            actor=agent_case.actor, workflow=agent_case.workflow, selections={"review": _selection(agent_case)}
        )


def test_translation_rejects_invalid_native_declared_output_type():
    from services.dify_builder.agent.graph_translate import to_intents

    data = {
        "type": "agent",
        "version": "2",
        "title": "Review",
        "agent_node_kind": "dify_agent",
        "agent_declared_outputs": [{"name": "summary", "type": "invented-type"}],
    }
    with pytest.raises(ValueError):
        to_intents({"nodes": [{"id": "review", "data": data}], "edges": []})


def test_full_native_node_job_is_persisted_in_existing_binding_owner(agent_case, sqlite_session):
    import json

    from sqlalchemy import select

    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_binding import AgentBindingService

    service = AgentBindingService(sqlite_session)
    selection = _selection(agent_case)
    job = WorkflowNodeJobConfig.model_validate(
        {
            "mode": "let_agent_figure_it_out",
            "human_contacts": [{"contact_id": "contact-1", "tenant_id": agent_case.actor.tenant_id, "channel": "chat"}],
        }
    )
    data = service.prepare_node(
        actor=agent_case.actor, workflow=agent_case.workflow, node_id="review", selection=selection, node_job=job
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
    assert binding.node_job_config_dict["mode"] == "let_agent_figure_it_out"
    assert binding.node_job_config_dict["human_contacts"][0]["contact_id"] == "contact-1"


def test_native_authorization_rpc_precedes_draft_transaction(agent_case, sqlite_session, monkeypatch):
    from configs import dify_config
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.agent import access_service
    from services.dify_builder.native_testing.agent_binding import AgentBindingService
    from services.enterprise.rbac_service import RBACService

    app_id, agent_id = agent_case.workflow.app_id, agent_case.agent.id
    sqlite_session.rollback()
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    checked = []

    def remote_check(*_args, **_kwargs):
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
        node_id="review",
        selection=_selection(agent_case),
        node_job=WorkflowNodeJobConfig(),
    )
    assert checked == ["RPC", "RPC"]


@pytest.mark.parametrize("omission", ["additional", "empty", "advanced_existing", "removed_existing"])
def test_sync_requires_complete_graph_and_existing_binding_coverage(agent_case, sqlite_session, omission):
    import json

    from models.agent import (
        AgentConfigRevision,
        AgentConfigRevisionOperation,
        AgentConfigSnapshot,
        WorkflowAgentBindingType,
        WorkflowAgentNodeBinding,
    )
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.agent_binding import AgentBindingService, native_node_data
    from tests.builder_agent_fixtures import add_agent

    case = agent_case
    selection = _selection(case)
    service = AgentBindingService(sqlite_session)
    data = service.prepare_node(
        actor=case.actor,
        workflow=case.workflow,
        node_id="review",
        selection=selection,
        node_job=WorkflowNodeJobConfig(),
    )
    graph = case.workflow.graph_dict
    graph["nodes"].append({"id": "review", "data": data})
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
        assert [(binding.node_id, binding.current_snapshot_id) for binding in bindings] == [
            ("unprepared", other_snapshot.id)
        ]
    else:
        assert bindings == []


def test_complete_prepared_multi_agent_graph_syncs_all_owned_bindings(agent_case, sqlite_session):
    import json

    from sqlalchemy import select

    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_binding import AgentBindingService

    service = AgentBindingService(sqlite_session)
    selection = _selection(agent_case)
    graph = agent_case.workflow.graph_dict
    for node_id in ("first", "second"):
        data = service.prepare_node(
            actor=agent_case.actor,
            workflow=agent_case.workflow,
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
