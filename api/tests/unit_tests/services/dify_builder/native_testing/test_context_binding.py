"""Trusted reload must finish before any marked run reaches native setup."""

from collections.abc import Mapping
from datetime import datetime
from typing import cast

import pytest
import sqlalchemy.orm
from sqlalchemy import Select
from sqlalchemy.orm import ORMExecuteState, sessionmaker

from core.dify_builder.models import Actor
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import JsonValue, NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.agent_binding import AgentBindingAuthorization, AgentBindingSelection
from services.dify_builder.native_testing.context_binding import (
    NativeAdmissionCompilation,
    NativeAdmissionCompiler,
    NativeContextUnavailable,
    resolve_native_context,
)
from services.dify_builder.native_testing.http_binding import NativeHttpBindingResolver
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.builder_agent_fixtures import AgentCase
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_contracts import CONTEXT, REF_DATA
from tests.unit_tests.services.dify_builder.test_execution_policy_service import Owned
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414
from tests.unit_tests.services.dify_builder.test_native_agent_binding import agent_case as agent_case  # noqa: PLC0414


def stored_context_boundary(
    monkeypatch: pytest.MonkeyPatch,
    *,
    context: ResolvedNativeTestContext | None = None,
    failure: BaseException | None = None,
) -> tuple[NativeExecutionStateStore, list[NativeTestContextRef]]:
    """Actual state owner with only its protected-object read method replaced."""
    loader = OwnedNativeTestLoader(
        sessionmaker(), actor=Actor(tenant_id="tenant", account_id="actor"), resolver=NativeHttpBindingResolver()
    )
    state = NativeExecutionStateStore(loader)
    calls: list[NativeTestContextRef] = []

    def load_context(*, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        calls.append(ref)
        if failure is not None:
            raise failure
        assert context is not None, "refused marker reached protected context IO"
        return context

    monkeypatch.setattr(state, "load_context", load_context)
    return state, calls


def test_required_scope_never_falls_back_to_ordinary(monkeypatch: pytest.MonkeyPatch) -> None:
    error, resolve = NativeContextUnavailable, resolve_native_context
    state, calls = stored_context_boundary(monkeypatch)
    with pytest.raises(error, match="^native_context_missing$"):
        resolve(required=True, ref=None, state=state)
    assert calls == []


def test_unmarked_ordinary_run_does_not_load_native_state(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve = resolve_native_context
    state, calls = stored_context_boundary(monkeypatch)
    assert resolve(required=False, ref=None, state=state) is None
    assert calls == []


def test_unknown_policy_never_reaches_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    error, resolve = NativeContextUnavailable, resolve_native_context
    state, calls = stored_context_boundary(monkeypatch)
    ref = NativeTestContextRef.model_construct(**{**REF_DATA, "policy_version": "unknown"})
    with pytest.raises(error, match="^native_context_version$"):
        resolve(required=True, ref=ref, state=state)
    assert calls == []


@pytest.mark.parametrize("reason", ["native_owner_mismatch", "native_context_mismatch", "native_access_denied"])
def test_owner_rejection_is_sanitized(reason: str, monkeypatch: pytest.MonkeyPatch) -> None:
    error, resolve = NativeContextUnavailable, resolve_native_context
    state, _calls = stored_context_boundary(monkeypatch, failure=BuilderExecutionPolicyError(reason))
    with pytest.raises(error, match="^native_context_unavailable$"):
        resolve(required=True, ref=NativeTestContextRef.model_validate(REF_DATA), state=state)


def test_loaded_ref_must_exactly_match_requested_ref(monkeypatch: pytest.MonkeyPatch) -> None:
    error, resolve = NativeContextUnavailable, resolve_native_context
    changed_context = ResolvedNativeTestContext.model_validate(CONTEXT).model_copy(
        update={"ref": NativeTestContextRef.model_validate({**REF_DATA, "context_digest": "b" * 64})}
    )
    state, _calls = stored_context_boundary(monkeypatch, context=changed_context)
    with pytest.raises(error, match="^native_context_mismatch$"):
        resolve(required=True, ref=NativeTestContextRef.model_validate(REF_DATA), state=state)


def test_reload_preserves_typed_inputs_and_isolates_mutable_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve = resolve_native_context
    context = ResolvedNativeTestContext.model_validate(
        {**CONTEXT, "inputs": {"bool": True, "array": [1, None], "file": {"ref": "f"}}}
    )
    state, _calls = stored_context_boundary(monkeypatch, context=context)
    actual = resolve(required=True, ref=context.ref, state=state)
    assert actual is not None
    assert actual.inputs == context.inputs
    assert isinstance(actual.inputs, dict)
    array = actual.inputs["array"]
    assert isinstance(array, list)
    array.append(2)
    assert isinstance(context.inputs, dict)
    assert context.inputs["array"] == [1, None]


def test_marker_roundtrip_does_not_extend_legacy_policy_union() -> None:
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom

    ref = NativeTestContextRef.model_validate(REF_DATA)
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


def compile_owned(owned: Owned) -> tuple[NativeAdmissionCompiler, NativeAdmissionCompilation]:
    from services.dify_builder.native_testing.context_binding import NativeAdmissionCompiler, NativeRuntimeProfile

    factory, actor, app, workflow, sid, tid = owned

    def metadata(**_kwargs: object) -> tuple[()]:
        return ()

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


def test_compiler_reads_actual_owner_snapshot_and_finalizes_digest(owned: Owned) -> None:
    from runtime_contracts.builder.execution import canonical_digest
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
def test_compiled_admission_recheck_rejects_local_changes_without_writing(owned: Owned, change: str) -> None:
    from models.dify_builder import DifyBuilderSession, DifyBuilderTestInput
    from models.workflow import Workflow
    from services.dify_builder.native_testing.context_binding import NativeContextUnavailable

    compiler, compiled = compile_owned(owned)
    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        if change == "graph":
            saved_workflow = db.get(Workflow, workflow.id)
            assert saved_workflow is not None
            saved_workflow.graph = '{"nodes":[],"edges":[]}'
        elif change == "inputs":
            saved_input = db.get(DifyBuilderTestInput, tid)
            assert saved_input is not None
            saved_input.inputs = {"new": True}
        elif change == "session":
            saved_session = db.get(DifyBuilderSession, sid)
            assert saved_session is not None
            saved_session.version += 1
        else:
            saved_session = db.get(DifyBuilderSession, sid)
            assert saved_session is not None
            saved_session.owner_account_id = "foreign"
    with factory.begin() as db, pytest.raises(NativeContextUnavailable):
        compiler.recheck_local(session=db, actor=actor, compilation=compiled)


def test_native_graph_prepares_every_agent_with_one_binding_owner(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session
) -> None:
    from sqlalchemy import select

    from models.agent import WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.dify_port import _prepare_native_agent_graph
    from services.dify_builder.native_testing.agent_binding import AgentBindingService, native_node_data
    from tests.unit_tests.services.dify_builder.test_native_agent_binding import _selection

    case = agent_case
    selection = _selection(case)
    graph = dict(case.workflow.graph_dict)
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
    assert binding is not None
    assert binding.session is sqlite_session
    binding.sync_prepared_bindings(actor=case.actor, workflow=case.workflow, selections={"review": selection})
    row = sqlite_session.scalar(select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "review"))
    assert row is not None
    assert row.current_snapshot_id == selection.snapshot_id
    assert graph["nodes"][-1]["data"]["agent_binding"]["agent_id"] == selection.agent_id


def test_native_graph_refuses_unselected_agent_before_sync(
    agent_case: AgentCase, sqlite_session: sqlalchemy.orm.Session
) -> None:
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.dify_port import _prepare_native_agent_graph
    from services.dify_builder.native_testing.agent_binding import native_node_data

    case = agent_case
    graph = dict(case.workflow.graph_dict)
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
            selections=cast(Mapping[str, AgentBindingSelection], None),
            authorization=None,
        )


def test_agent_selection_uses_exact_confirmed_opaque_identity() -> None:
    from services.dify_builder.dify_port import _confirmed_agent_selections

    graph: dict[str, JsonValue] = {
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


def _apply_confirmed_agent_and_verify_binding(
    agent_case: AgentCase,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
    monkeypatch.setattr(dify_port, "notify_workflow_draft_changed", lambda *_args, **_kwargs: None)
    from events.app_event import app_draft_workflow_was_synced

    monkeypatch.setattr(app_draft_workflow_was_synced, "send", lambda *_args, **_kwargs: None)
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
        assert row is not None
        assert row.current_snapshot_id == selection.snapshot_id
        from models.workflow import Workflow

        saved_workflow = session.get(Workflow, case.workflow.id)
        assert saved_workflow is not None
        graph = dict(saved_workflow.graph_dict)
        assert any(
            n["id"] == "review" and n["data"]["agent_binding"]["agent_id"] == selection.agent_id for n in graph["nodes"]
        )


def test_real_apply_persists_confirmed_agent_graph_and_binding_together(
    agent_case: AgentCase,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _apply_confirmed_agent_and_verify_binding(agent_case, sqlite_session_factory, monkeypatch)


def test_agent_apply_undo_refusal_preserves_bindings_and_allows_next_apply(
    agent_case: AgentCase,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import select

    from core.dify_builder.models import Action, DifyBuilderContext, MutationIntent, Turn
    from models.agent import WorkflowAgentNodeBinding
    from models.workflow import Workflow
    from services.dify_builder import dify_port
    from services.dify_builder.application.handlers_build import handle_execution
    from tests.unit_tests.services.dify_builder.test_native_agent_binding import _selection

    before = dict(agent_case.workflow.graph_dict)
    _apply_confirmed_agent_and_verify_binding(agent_case, sqlite_session_factory, monkeypatch)
    port = dify_port.WorkflowServiceDifyPort()
    current, revision = port.read_graph(agent_case.workflow.app_id, agent_case.actor)
    fc = DifyBuilderContext(checkpoint_id="before-agent", last_snapshot_hash=revision)
    from core.dify_builder.models import Checkpoint, EntryMode, Session, Snapshot
    from core.dify_builder.state import PcState
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from services.dify_builder.application.runner import Env
    from services.dify_builder.repository import SqlDifyBuilderRepository

    repo = SqlDifyBuilderRepository(sqlite_session_factory)
    monkeypatch.setattr(
        repo,
        "get_checkpoint",
        lambda _identity: (Checkpoint(state=PcState.BUILD_EXECUTION), Snapshot(graph=dict(before))),
    )
    emitted: list[dict[str, object]] = []
    invalidated: list[tuple[object, ...]] = []
    monkeypatch.setattr(repo, "invalidate_conversation_items", lambda *args: invalidated.append(args))
    env = Env(
        dify=port,
        repo=repo,
        agent=LlmBuilderAgent(agent_case.actor.tenant_id),
        now=datetime.now,
        emit_canvas=emitted.append,
    )
    session = Session(
        app_id=agent_case.workflow.app_id,
        id="builder-session",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_EXECUTION,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_restore_unavailable$"):
        handle_execution(env, Turn(action=Action(kind="undo"), actor=agent_case.actor), session, fc)
    assert fc.checkpoint_id == "before-agent"
    assert fc.last_snapshot_hash == revision
    assert emitted == []
    assert invalidated == []
    assert port.read_graph(session.app_id, agent_case.actor) == (current, revision)

    selection = _selection(agent_case)
    port.apply_repair(
        session.app_id,
        agent_case.actor,
        [MutationIntent(op="set_node_config", args={"node_id": "review", "path": "agent_task", "value": "Updated"})],
        expected_revision=revision,
        confirmed_resource_ids=[f"agent:{selection.agent_id}:{selection.snapshot_id}:{selection.capability_digest}"],
    )
    with sqlite_session_factory() as sql:
        saved_workflow = sql.get(Workflow, agent_case.workflow.id)
        assert saved_workflow is not None
        graph = dict(saved_workflow.graph_dict)
        rows = sql.scalars(
            select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == agent_case.workflow.id)
        ).all()
        assert [row.node_id for row in rows] == ["review"]
        assert rows[0].current_snapshot_id == selection.snapshot_id
        assert next(n for n in graph["nodes"] if n["id"] == "review")["data"]["agent_task"] == "Updated"


@pytest.mark.parametrize("agent_state", ["target_only", "binding_only"])
def test_restore_refuses_native_agent_state_before_graph_sync(
    agent_case: AgentCase,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
    agent_state: str,
) -> None:
    import json

    from models.workflow import Workflow
    from services.dify_builder import dify_port

    before = dict(agent_case.workflow.graph_dict)
    _apply_confirmed_agent_and_verify_binding(agent_case, sqlite_session_factory, monkeypatch)
    port = dify_port.WorkflowServiceDifyPort()
    target, _ = port.read_graph(agent_case.workflow.app_id, agent_case.actor)
    with sqlite_session_factory() as sql:
        saved_workflow = sql.get(Workflow, agent_case.workflow.id)
        assert saved_workflow is not None
        saved_workflow.graph = json.dumps(before)
        if agent_state == "target_only":
            from sqlalchemy import delete

            from models.agent import WorkflowAgentNodeBinding

            sql.execute(
                delete(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == agent_case.workflow.id)
            )
        sql.commit()
    current, revision = port.read_graph(agent_case.workflow.app_id, agent_case.actor)
    sync_calls = []

    def sync(*args: object, **kwargs: object) -> None:
        sync_calls.append((args, kwargs))
        raise AssertionError("legacy graph sync")

    monkeypatch.setattr(dify_port, "_sync_graph_only", sync)
    with pytest.raises(BuilderExecutionPolicyError, match="native_restore_unavailable$"):
        port.restore_graph(
            agent_case.workflow.app_id,
            agent_case.actor,
            dict(target if agent_state == "target_only" else before),
            expected_revision=revision,
        )
    assert sync_calls == []
    assert port.read_graph(agent_case.workflow.app_id, agent_case.actor) == (current, revision)


@pytest.mark.parametrize("change", ["canvas", "execution", "features", "environment", "conversation"])
def test_confirmed_compiler_rechecks_canvas_basis_without_resolving_secret_values(
    owned: Owned, change: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json

    from models.workflow import Workflow
    from services.dify_builder.native_testing.context_binding import (
        NativeAdmissionCompiler,
        NativeContextUnavailable,
        NativeRuntimeProfile,
    )

    factory, actor, _app, workflow, sid, tid = owned

    def secret_read(_self: object) -> None:
        raise AssertionError("revision checks must never decrypt variables")

    monkeypatch.setattr(Workflow, "environment_variables", property(secret_read))
    monkeypatch.setattr(Workflow, "conversation_variables", property(secret_read))
    compiler = NativeAdmissionCompiler(session_factory=factory, resources=lambda **_kwargs: ())
    compiled = compiler.compile(
        actor=actor,
        session_id=sid,
        test_input_id=tid,
        expected_version=1,
        mode="native",
        request_id="request-canvas",
        invocation_id="root-canvas",
        native_run_id="run-canvas",
        profile=NativeRuntimeProfile(
            profile_id="builder-agent-confirmed-v1", implementation_revision="v1", limits={"calls": 4}
        ),
        revision_basis="confirmed-canvas-v1",
    )
    assert compiled.request_context["revision_basis"] == "confirmed-canvas-v1"
    with factory.begin() as session:
        current = session.get(Workflow, workflow.id)
        assert current is not None
        if change in {"canvas", "execution"}:
            graph = json.loads(current.graph)
            graph["viewport"] = {"x": 14, "y": 29, "zoom": 1}
            graph["nodes"][0]["positionAbsolute"] = {"x": 14, "y": 29}
            if change == "execution":
                graph["nodes"][0]["data"]["new_execution_input"] = True
            current.graph = json.dumps(graph, separators=(",", ":"))
        elif change == "features":
            current.features = '{"changed":true}'
        elif change == "environment":
            current._environment_variables = '[{"changed":"opaque-ciphertext"}]'
        else:
            current._conversation_variables = '[{"changed":"opaque-ciphertext"}]'
    with factory.begin() as session:
        if change == "canvas":
            compiler.recheck_local(session=session, actor=actor, compilation=compiled)
        else:
            with pytest.raises(NativeContextUnavailable, match="native_revision_drift"):
                compiler.recheck_local(session=session, actor=actor, compilation=compiled)


@pytest.mark.parametrize("scope", ["legacy", "child"])
def test_canvas_basis_never_reinterprets_old_context_or_child_workflow(owned: Owned, scope: str) -> None:
    import json

    from services.dify_builder.native_testing.repository import admitted_workflow_revision, native_workflow_revision

    _factory, _actor, _app, workflow, _sid, _tid = owned
    request_context = {"profile": {"profile_id": "builder-agent-confirmed-v1"}, "workflow_id": workflow.id}
    if scope == "child":
        request_context.update(revision_basis="confirmed-canvas-v1", workflow_id="other-root")
    original = admitted_workflow_revision(workflow, request_context)
    graph = json.loads(workflow.graph)
    graph["viewport"] = {"x": 7, "y": 8, "zoom": 1}
    workflow.graph = json.dumps(graph)
    assert admitted_workflow_revision(workflow, request_context) != original
    assert admitted_workflow_revision(workflow, request_context) == native_workflow_revision(workflow)


@pytest.mark.parametrize(
    ("profile", "basis"), [("isolated", "confirmed-canvas-v1"), ("builder-agent-confirmed-v1", "unknown")]
)
def test_canvas_basis_requires_exact_server_profile_and_supported_marker(
    owned: Owned, profile: str, basis: str
) -> None:
    from services.dify_builder.native_testing.repository import admitted_workflow_revision

    _factory, _actor, _app, workflow, _sid, _tid = owned
    with pytest.raises(BuilderExecutionPolicyError, match="native_revision_basis_unavailable"):
        admitted_workflow_revision(
            workflow, {"profile": {"profile_id": profile}, "revision_basis": basis, "workflow_id": workflow.id}
        )


def test_confirmed_snapshot_graph_still_refuses_executable_payload_tampering(owned: Owned) -> None:
    from copy import deepcopy

    from services.dify_builder.native_testing.repository import admitted_graph_matches

    _factory, _actor, _app, workflow, _sid, _tid = owned
    request_context = {
        "profile": {"profile_id": "builder-agent-confirmed-v1"},
        "revision_basis": "confirmed-canvas-v1",
        "workflow_id": workflow.id,
    }
    protected_graph = deepcopy(dict(workflow.graph_dict))
    protected_graph["nodes"][0]["data"]["new_execution_input"] = "injected"
    assert admitted_graph_matches(workflow, protected_graph, request_context) is False


def test_unrelated_end_edit_retains_owned_agent_without_new_resource_selection(
    agent_case: AgentCase,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json

    from sqlalchemy import select

    from core.dify_builder.models import MutationIntent
    from models.agent import WorkflowAgentNodeBinding
    from models.workflow import Workflow
    from services.dify_builder import dify_port

    _apply_confirmed_agent_and_verify_binding(agent_case, sqlite_session_factory, monkeypatch)
    with sqlite_session_factory() as sql:
        workflow = sql.get(Workflow, agent_case.workflow.id)
        assert workflow is not None
        graph = dict(workflow.graph_dict)
        next(node["data"] for node in graph["nodes"] if node["id"] == "review").update(
            {
                "title": "Existing reviewer",
                "desc": "Existing description",
                "error_strategy": "default-value",
                "default_value": [{"key": "text", "type": "string", "value": "fallback"}],
                "retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 100},
                "selected": True,
                "_ui_hint": "preserved",
            }
        )
        graph["nodes"].append(
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [{"variable": "proof", "value_selector": ["review", "text"]}],
                },
            }
        )
        graph["edges"].append({"source": "review", "target": "end"})
        workflow.graph = json.dumps(graph)
        row = sql.scalar(select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "review"))
        assert row is not None
        original = (row.id, row.current_snapshot_id, row.node_job_config_dict)
        sql.commit()
    port = dify_port.WorkflowServiceDifyPort()
    before, revision = port.read_graph(agent_case.workflow.app_id, agent_case.actor)
    result = port.apply_repair(
        agent_case.workflow.app_id,
        agent_case.actor,
        [
            MutationIntent(
                op="set_node_config",
                args={
                    "node_id": "end",
                    "path": "outputs",
                    "value": [{"variable": "asset_proof", "value_selector": ["review", "text"]}],
                },
            )
        ],
        expected_revision=revision,
        confirmed_resource_ids=[],
    )
    assert result.changed_nodes == ["end"]
    after, _ = port.read_graph(agent_case.workflow.app_id, agent_case.actor)
    assert next(n for n in after["nodes"] if n["id"] == "end")["data"]["outputs"][0]["variable"] == "asset_proof"
    assert next(n for n in after["nodes"] if n["id"] == "review") == next(
        n for n in before["nodes"] if n["id"] == "review"
    )
    with sqlite_session_factory() as sql:
        row = sql.scalar(select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "review"))
        assert row is not None
        assert (row.id, row.current_snapshot_id, row.node_job_config_dict) == original


@pytest.mark.parametrize("mutation", ["job", "copied-node", "binding-pin", "published-pointer", "revoked"])
def test_unselected_agent_retention_refuses_changed_job_copy_pin_publication_or_access(
    agent_case: AgentCase,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
    mutation: str,
) -> None:
    from sqlalchemy import select

    from core.dify_builder.models import MutationIntent
    from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
    from models.workflow import Workflow
    from services.agent import access_service
    from services.dify_builder import dify_port

    _apply_confirmed_agent_and_verify_binding(agent_case, sqlite_session_factory, monkeypatch)
    port = dify_port.WorkflowServiceDifyPort()
    before, revision = port.read_graph(agent_case.workflow.app_id, agent_case.actor)
    intents = [MutationIntent(op="set_node_config", args={"node_id": "start", "path": "title", "value": "Renamed"})]
    if mutation == "job":
        intents = [
            MutationIntent(
                op="set_node_config", args={"node_id": "review", "path": "agent_task", "value": "Changed task"}
            )
        ]
    elif mutation == "copied-node":
        copied = next(n["data"] for n in before["nodes"] if n["id"] == "review")
        intents = [
            MutationIntent(op="create_node", args={"node_id": "copied-review", "node_type": "agent", "config": copied})
        ]
    elif mutation == "revoked":
        monkeypatch.setattr(
            access_service,
            "resolve_current_agent_access_filter",
            lambda **_kwargs: access_service.AgentAccessFilter(accessible_agent_ids=set()),
        )
    elif mutation in {"binding-pin", "published-pointer"}:
        with sqlite_session_factory() as sql:
            if mutation == "binding-pin":
                saved_binding = sql.scalar(
                    select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "review")
                )
                assert saved_binding is not None
                saved_binding.current_snapshot_id = "forged-pin"
            else:
                agent = sql.get(Agent, agent_case.agent.id)
                assert agent is not None
                current = sql.get(AgentConfigSnapshot, agent.active_config_snapshot_id)
                assert current is not None
                replacement = AgentConfigSnapshot(
                    tenant_id=agent.tenant_id,
                    agent_id=agent.id,
                    version=2,
                    config_snapshot=current.config_snapshot_dict,
                )
                sql.add(replacement)
                sql.flush()
                agent.active_config_snapshot_id = replacement.id
            sql.commit()
    with pytest.raises(BuilderExecutionPolicyError):
        port.apply_repair(
            agent_case.workflow.app_id, agent_case.actor, intents, expected_revision=revision, confirmed_resource_ids=[]
        )
    with sqlite_session_factory() as sql:
        saved_workflow = sql.get(Workflow, agent_case.workflow.id)
        assert saved_workflow is not None
        assert saved_workflow.graph_dict == before


def test_retained_hidden_job_metadata_is_rechecked_under_draft_lock(
    agent_case: AgentCase,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import select

    from core.dify_builder.models import MutationIntent
    from models.agent import WorkflowAgentNodeBinding
    from services.dify_builder import dify_port
    from services.dify_builder.native_testing.agent_binding import AgentBindingService

    _apply_confirmed_agent_and_verify_binding(agent_case, sqlite_session_factory, monkeypatch)
    port = dify_port.WorkflowServiceDifyPort()
    before, revision = port.read_graph(agent_case.workflow.app_id, agent_case.actor)
    original_authorize = AgentBindingService.authorize

    def authorize_after_job_change(
        *, actor: Actor, app_id: str, agent_ids: frozenset[str]
    ) -> AgentBindingAuthorization:
        authorization = original_authorize(actor=actor, app_id=app_id, agent_ids=agent_ids)
        with sqlite_session_factory() as sql:
            row = sql.scalar(select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.node_id == "review"))
            assert row is not None
            job = row.node_job_config_dict
            job["metadata"] = {"agent_soul": {"external_change": True}}
            row.node_job_config = job
            sql.commit()
        return authorization

    monkeypatch.setattr(AgentBindingService, "authorize", authorize_after_job_change)
    with pytest.raises(BuilderExecutionPolicyError, match="agent_binding_not_prepared"):
        port.apply_repair(
            agent_case.workflow.app_id,
            agent_case.actor,
            [MutationIntent(op="set_node_config", args={"node_id": "start", "path": "title", "value": "Renamed"})],
            expected_revision=revision,
            confirmed_resource_ids=[],
        )
    assert port.read_graph(agent_case.workflow.app_id, agent_case.actor)[0] == before


def test_final_retained_binding_check_locks_and_refreshes_rows_before_sync(
    agent_case: AgentCase,
    sqlite_session_factory: sqlalchemy.orm.sessionmaker[sqlalchemy.orm.Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import event
    from sqlalchemy.dialects import postgresql

    from models.agent import WorkflowAgentNodeBinding
    from models.workflow import Workflow
    from services.dify_builder import dify_port
    from services.dify_builder.native_testing.agent_binding import AgentBindingService

    _apply_confirmed_agent_and_verify_binding(agent_case, sqlite_session_factory, monkeypatch)
    with sqlite_session_factory() as sql:
        workflow = sql.get(Workflow, agent_case.workflow.id)
        assert workflow is not None
        graph = dict(workflow.graph_dict)
        retained, stamps = dify_port._retained_native_agent_selections(
            session=sql, actor=agent_case.actor, workflow=workflow, graph=graph
        )
        authorization = AgentBindingService.authorize(
            actor=agent_case.actor,
            app_id=workflow.app_id,
            agent_ids=frozenset(selection.agent_id for selection in retained.values()),
        )
        statements = []

        def capture(state: ORMExecuteState) -> None:
            statement = state.statement
            assert isinstance(statement, Select)
            descriptions = statement.column_descriptions
            if descriptions and descriptions[0].get("entity") is WorkflowAgentNodeBinding:
                statements.append(statement)

        event.listen(sql, "do_orm_execute", capture)
        try:
            _graph, binding_service = dify_port._prepare_native_agent_graph(
                session=sql,
                actor=agent_case.actor,
                workflow=workflow,
                graph=graph,
                selections=retained,
                authorization=authorization,
                retained_binding_stamps=stamps,
            )
            assert binding_service is not None
            binding_service.sync_prepared_bindings(actor=agent_case.actor, workflow=workflow, selections=retained)
        finally:
            event.remove(sql, "do_orm_execute", capture)
        statement = statements[0]
        compiled = str(statement.compile(dialect=postgresql.dialect()))
        assert "FOR UPDATE" in compiled
        assert "ORDER BY workflow_agent_node_bindings.node_id" in compiled
        assert statement.get_execution_options()["populate_existing"] is True
