"""Trusted reload must finish before any marked run reaches native setup."""

from unittest.mock import Mock

import pytest

from services.dify_builder.execution_contracts import BuilderExecutionPolicyError
from services.dify_builder.native_testing.contracts import NativeTestContextRef
from services.dify_builder.native_testing.runtime_contracts import NativeStatePort, ResolvedNativeTestContext
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_contracts import CONTEXT, REF_DATA


def binding():
    from services.dify_builder.native_testing.context_binding import NativeContextUnavailable, resolve_native_context

    return NativeContextUnavailable, resolve_native_context


def test_required_scope_never_falls_back_to_ordinary():
    error, resolve = binding()
    state = Mock(spec=NativeStatePort)
    with pytest.raises(error, match="^native_context_missing$"):
        resolve(required=True, ref=None, state=state)
    state.load_context.assert_not_called()


def test_unmarked_ordinary_run_does_not_load_native_state():
    _, resolve = binding()
    state = Mock(spec=NativeStatePort)
    assert resolve(required=False, ref=None, state=state) is None
    state.load_context.assert_not_called()


def test_unknown_policy_never_reaches_owner():
    error, resolve = binding()
    state = Mock(spec=NativeStatePort)
    ref = NativeTestContextRef.model_construct(**{**REF_DATA, "policy_version": "unknown"})
    with pytest.raises(error, match="^native_context_version$"):
        resolve(required=True, ref=ref, state=state)
    state.load_context.assert_not_called()


@pytest.mark.parametrize("reason", ["native_owner_mismatch", "native_context_mismatch", "native_access_denied"])
def test_owner_rejection_is_sanitized(reason):
    error, resolve = binding()
    state = Mock(spec=NativeStatePort)
    state.load_context.side_effect = BuilderExecutionPolicyError(reason)
    with pytest.raises(error, match="^native_context_unavailable$"):
        resolve(required=True, ref=NativeTestContextRef(**REF_DATA), state=state)


def test_loaded_ref_must_exactly_match_requested_ref():
    error, resolve = binding()
    state = Mock(spec=NativeStatePort)
    state.load_context.return_value = ResolvedNativeTestContext(**CONTEXT).model_copy(
        update={"ref": NativeTestContextRef(**{**REF_DATA, "context_digest": "b" * 64})}
    )
    with pytest.raises(error, match="^native_context_mismatch$"):
        resolve(required=True, ref=NativeTestContextRef(**REF_DATA), state=state)


def test_reload_preserves_typed_inputs_and_isolates_mutable_snapshot():
    _, resolve = binding()
    context = ResolvedNativeTestContext(
        **{**CONTEXT, "inputs": {"bool": True, "array": [1, None], "file": {"ref": "f"}}}
    )
    state = Mock(spec=NativeStatePort)
    state.load_context.return_value = context
    actual = resolve(required=True, ref=context.ref, state=state)
    assert actual.inputs == context.inputs
    actual.inputs["array"].append(2)
    assert context.inputs["array"] == [1, None]


def test_marker_roundtrip_does_not_extend_legacy_policy_union():
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom

    ref = NativeTestContextRef(**REF_DATA)
    context = DifyRunContext(
        native_test_required=True,
        native_test_ref=ref,
        tenant_id="t",
        app_id="a",
        user_id="u",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    restored = DifyRunContext.model_validate_json(context.model_dump_json())
    assert restored.native_test_required is True
    assert restored.native_test_ref == ref
    assert restored.builder_execution is None


from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414


def compile_owned(owned):
    from services.dify_builder.native_testing.context_binding import NativeAdmissionCompiler, NativeRuntimeProfile

    factory, actor, app, workflow, sid, tid = owned
    metadata = Mock(return_value=())
    compiler = NativeAdmissionCompiler(session_factory=factory, resources=metadata)
    profile = NativeRuntimeProfile(
        profile_id="qualification-1", implementation_revision="native-v1", limits={"calls": 10}
    )
    result = compiler.compile(
        actor=actor,
        session_id=sid,
        test_input_id=tid,
        expected_version=1,
        mode="native",
        request_id="request-1",
        invocation_id="invocation-1",
        native_run_id="run-1",
        profile=profile,
    )
    return compiler, result


def test_compiler_reads_actual_owner_snapshot_and_finalizes_digest(owned):
    from services.dify_builder.execution_contracts import canonical_digest
    from services.dify_builder.native_testing.repository import native_workflow_revision

    _, result = compile_owned(owned)
    factory, actor, app, workflow, sid, tid = owned
    assert result.context.ref.context_digest == canonical_digest(result.request_context)
    assert result.context.graph == workflow.graph_dict
    assert result.context.graph_revision == native_workflow_revision(workflow)
    assert result.context.budget_ref == result.context.ref.request_id
    assert result.context.native_run_id == "run-1"
    assert result.request_context["session_id"] == sid
    assert result.request_context["test_input_id"] == tid
    assert "bindings" not in result.request_context


@pytest.mark.parametrize("change", ["graph", "inputs", "session", "owner"])
def test_compiled_admission_recheck_rejects_local_changes_without_writing(owned, change):
    from models.dify_builder import DifyBuilderSession, DifyBuilderTestInput
    from models.workflow import Workflow
    from services.dify_builder.native_testing.context_binding import NativeContextUnavailable

    compiler, compiled = compile_owned(owned)
    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        if change == "graph":
            db.get(Workflow, workflow.id).graph = '{"nodes":[],"edges":[]}'
        elif change == "inputs":
            db.get(DifyBuilderTestInput, tid).inputs = {"new": True}
        elif change == "session":
            db.get(DifyBuilderSession, sid).version += 1
        else:
            db.get(DifyBuilderSession, sid).owner_account_id = "foreign"
    with factory.begin() as db, pytest.raises(NativeContextUnavailable):
        compiler.recheck_local(session=db, actor=actor, compilation=compiled)


from tests.unit_tests.services.dify_builder.test_native_agent_binding import agent_case as agent_case  # noqa: PLC0414


def test_native_graph_prepares_every_agent_with_one_binding_owner(agent_case, sqlite_session):
    from sqlalchemy import select

    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.dify_port import _prepare_native_agent_graph
    from services.dify_builder.native_testing.agent_binding import AgentBindingService, native_node_data
    from tests.unit_tests.services.dify_builder.test_native_agent_binding import _selection

    case = agent_case
    selection = _selection(case)
    graph = case.workflow.graph_dict
    graph["nodes"].append(
        {
            "id": "review",
            "data": native_node_data(
                agent_id=selection.agent_id,
                snapshot_id=selection.snapshot_id,
                node_job=WorkflowNodeJobConfig(),
            ),
        }
    )
    authorization = AgentBindingService.authorize(
        actor=case.actor, app_id=case.workflow.app_id, agent_ids=frozenset({selection.agent_id})
    )
    graph, binding = _prepare_native_agent_graph(
        session=sqlite_session,
        actor=case.actor,
        workflow=case.workflow,
        graph=graph,
        selections={"review": selection},
        authorization=authorization,
    )
    assert binding.session is sqlite_session
    binding.sync_prepared_bindings(actor=case.actor, workflow=case.workflow, selections={"review": selection})
    row = sqlite_session.scalar(select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "review"))
    assert row.current_snapshot_id == selection.snapshot_id
    assert graph["nodes"][-1]["data"]["agent_binding"]["agent_id"] == selection.agent_id


def test_native_graph_refuses_unselected_agent_before_sync(agent_case, sqlite_session):
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.dify_port import _prepare_native_agent_graph
    from services.dify_builder.native_testing.agent_binding import native_node_data

    case = agent_case
    graph = case.workflow.graph_dict
    graph["nodes"].append(
        {
            "id": "injected",
            "data": native_node_data(
                agent_id=case.agent.id,
                snapshot_id=case.snapshot.id,
                node_job=WorkflowNodeJobConfig(),
            ),
        }
    )
    with pytest.raises(BuilderExecutionPolicyError, match="agent_binding_not_prepared"):
        _prepare_native_agent_graph(
            session=sqlite_session,
            actor=case.actor,
            workflow=case.workflow,
            graph=graph,
            selections=None,
            authorization=None,
        )


def test_agent_selection_uses_exact_confirmed_opaque_identity():
    from services.dify_builder.dify_port import _confirmed_agent_selections

    graph = {
        "nodes": [
            {
                "id": "a",
                "data": {
                    "type": "agent",
                    "version": "2",
                    "agent_node_kind": "dify_agent",
                    "agent_binding": {
                        "binding_type": "roster_agent",
                        "agent_id": "agent",
                        "current_snapshot_id": "snapshot",
                    },
                },
            }
        ],
        "edges": [],
    }
    selected = _confirmed_agent_selections(graph, ["agent:agent:snapshot:" + "a" * 64])
    assert selected["a"].capability_digest == "a" * 64
    with pytest.raises(BuilderExecutionPolicyError, match="agent_binding_not_prepared"):
        _confirmed_agent_selections(graph, ["agent:agent:changed:" + "a" * 64])


def test_real_apply_persists_confirmed_agent_graph_and_binding_together(
    agent_case, sqlite_session_factory, monkeypatch
):
    from sqlalchemy import select

    from core.dify_builder.models import MutationIntent
    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder import dify_port
    from services.dify_builder.native_testing.agent_binding import native_node_data
    from tests.unit_tests.services.dify_builder.test_native_agent_binding import _selection

    case = agent_case
    selection = _selection(case)
    monkeypatch.setattr(dify_port, "_session_factory", lambda: sqlite_session_factory)
    from services.workflow_service import WorkflowService

    monkeypatch.setattr(dify_port, "WorkflowService", lambda: WorkflowService(session_maker=sqlite_session_factory))
    monkeypatch.setattr(dify_port, "notify_workflow_draft_changed", Mock())
    from events.app_event import app_draft_workflow_was_synced

    monkeypatch.setattr(app_draft_workflow_was_synced, "send", Mock())
    port = dify_port.WorkflowServiceDifyPort()
    _, revision = port.read_graph(case.workflow.app_id, case.actor)
    result = port.apply_repair(
        case.workflow.app_id,
        case.actor,
        [
            MutationIntent(
                op="create_node",
                args={
                    "node_id": "review",
                    "node_type": "agent",
                    "config": native_node_data(
                        agent_id=selection.agent_id,
                        snapshot_id=selection.snapshot_id,
                        node_job=WorkflowNodeJobConfig(),
                    ),
                },
            )
        ],
        expected_revision=revision,
        confirmed_resource_ids=[f"agent:{selection.agent_id}:{selection.snapshot_id}:{selection.capability_digest}"],
    )
    assert "review" in result.changed_nodes
    with sqlite_session_factory() as session:
        row = session.scalar(select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "review"))
        assert row.current_snapshot_id == selection.snapshot_id
        from models.workflow import Workflow

        graph = session.get(Workflow, case.workflow.id).graph_dict
        assert any(
            n["id"] == "review" and n["data"]["agent_binding"]["agent_id"] == selection.agent_id for n in graph["nodes"]
        )
