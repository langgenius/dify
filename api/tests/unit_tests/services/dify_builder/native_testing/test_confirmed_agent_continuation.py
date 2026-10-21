"""Ordinary Graphon checkpoint validation; no model, provider or business I/O."""

import importlib
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.dify_builder.models import Actor
from graphon.entities.pause_reason import SchedulingPause
from graphon.runtime import RuntimeState, VariablePool
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader
from tests.unit_tests.services.dify_builder.native_testing.test_observation_stream import entity as workflow_entity


def owner():
    return importlib.import_module("services.dify_builder.native_testing.confirmed_agent_continuation")


REF = NativeTestContextRef(request_id="request", invocation_id="invocation", context_digest="a" * 64)
RUN = str(uuid4())


@dataclass
class PausedAgentSnapshot:
    generate_entity: WorkflowAppGenerateEntity
    serialized_graph_runtime_state: str

    def get_generate_entity(self) -> WorkflowAppGenerateEntity:
        return self.generate_entity


def saved_state(*, paused=True, ref=REF, run_id=RUN):
    runtime = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    runtime.graph_execution.start()
    execution = runtime.graph_execution.get_or_create_node_execution(frame_id="root", node_id="agent")
    if paused:
        runtime.graph_execution.pause(SchedulingPause(message="Agent approval"))
    entity = workflow_entity()
    entity.builder_agent_execution = BuilderAgentExecutionContext(ref=ref, native_run_id=run_id)
    state = PausedAgentSnapshot(
        generate_entity=entity,
        serialized_graph_runtime_state=runtime.dumps(),
    )
    return state, execution.execution_id


def test_actual_graphon_pause_readback_retains_exact_execution_identity():
    saved, execution_id = saved_state()
    runtime = owner().validate_parent_snapshot(state=saved, ref=REF, native_run_id=RUN)
    assert runtime.graph_execution.paused
    assert {item.execution_id for item in runtime.graph_execution.node_executions.values()} == {execution_id}


@pytest.mark.parametrize("drift", ["running", "run", "ref", "unmarked"])
def test_parent_snapshot_refuses_unpaused_or_foreign_context(drift):
    saved, _ = saved_state(
        paused=drift != "running",
        run_id=str(uuid4()) if drift == "run" else RUN,
        ref=REF.model_copy(update={"request_id": "foreign"}) if drift == "ref" else REF,
    )
    if drift == "unmarked":
        saved.get_generate_entity().builder_agent_execution = None
    with pytest.raises(BuilderExecutionPolicyError):
        owner().validate_parent_snapshot(state=saved, ref=REF, native_run_id=RUN)


def test_pending_intent_requires_actual_saved_operation_and_parent_occurrence():
    from dify_agent.protocol.native_continuation import AgentPendingCall
    from dify_agent.protocol.native_testing import AgentEffectIntent, AgentOperationKey

    key = AgentOperationKey(invocation_id=REF.invocation_id, occurrence_path=(str(uuid4()),), cursor=3)
    intent = AgentEffectIntent(
        key=key,
        kind="tool",
        resource_ref="tool",
        implementation_revision="revision",
        account_ref="account",
        target={"resource": "one"},
        parameters={"value": 1},
        input_digest="b" * 64,
        capability_digest="c" * 64,
    )
    call = AgentPendingCall(
        call_id="call",
        tool_name="send",
        intent=intent,
        stage="tool",
        pending_operation_id="pending",
        wait_reason="approval",
        native_arguments={"value": 1},
    )
    saved_intent = owner().api_intent(call.intent)
    assert (
        owner().validate_pending_call(call=call, intent=saved_intent, execution_id=key.occurrence_path[0])
        == saved_intent
    )
    with pytest.raises(BuilderExecutionPolicyError):
        owner().validate_pending_call(
            call=call,
            intent=saved_intent.model_copy(update={"parameters": {"value": 2}}),
            execution_id=key.occurrence_path[0],
        )
    with pytest.raises(BuilderExecutionPolicyError):
        owner().validate_pending_call(call=call, intent=saved_intent, execution_id=str(uuid4()))


@pytest.mark.parametrize("drift", [None, "actor", "tenant", "app", "workflow", "resumed", "missing_pause", "running"])
def test_actual_sql_parent_pause_requires_complete_owned_run_chain(sqlite_session_factory, drift, monkeypatch):
    """Real SQL predicates; C02 loader is an explicit already-authorized port."""
    from models.dify_builder import DifyBuilderExecutionRequest
    from models.workflow import WorkflowPause, WorkflowRun

    ids = {name: str(uuid4()) for name in ("request", "tenant", "app", "workflow", "actor", "session", "input", "run")}
    ref = REF.model_copy(update={"request_id": ids["request"]})
    owned = OwnedNativeTest(
        ref=ref,
        tenant_id=ids["tenant"],
        actor_id=ids["actor"],
        app_id=ids["app"],
        workflow_id=ids["workflow"],
        session_id=ids["session"],
        test_input_id=ids["input"],
        bindings={},
        generation=0,
        task_approved=False,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state="running",
    )
    with sqlite_session_factory.begin() as sql:
        for table in (DifyBuilderExecutionRequest.__table__, WorkflowRun.__table__, WorkflowPause.__table__):
            table.create(sql.connection(), checkfirst=True)
        sql.add(
            DifyBuilderExecutionRequest(
                id=ids["request"],
                tenant_id=ids["tenant"],
                actor_id=ids["actor"],
                app_id=ids["app"],
                workflow_id=ids["workflow"],
                session_id=ids["session"],
                test_input_id=ids["input"],
                state="running",
                context={"profile": {"profile_id": "builder-agent-confirmed-v1"}, "native_run_id": ids["run"]},
                context_digest=ref.context_digest,
                observations=[],
            )
        )
        run_values = {
            "id": ids["run"],
            "tenant_id": ids["tenant"],
            "app_id": ids["app"],
            "workflow_id": ids["workflow"],
            "created_by": ids["actor"],
            "created_by_role": "account",
            "status": "paused",
            "type": "workflow",
            "triggered_from": "debugging",
            "version": "draft",
        }
        field = {"actor": "created_by", "tenant": "tenant_id", "app": "app_id", "workflow": "workflow_id"}.get(drift)
        if field:
            run_values[field] = str(uuid4())
        if drift == "running":
            run_values["status"] = "running"
        sql.add(WorkflowRun(**run_values))
        if drift != "missing_pause":
            sql.add(
                WorkflowPause(
                    workflow_id=ids["workflow"],
                    workflow_run_id=ids["run"],
                    state_object_key="pause",
                    resumed_at=datetime.now() if drift == "resumed" else None,
                )
            )
    loader = OwnedNativeTestLoader(
        sqlite_session_factory, actor=Actor(tenant_id=owned.tenant_id, account_id=owned.actor_id), resolver=object()
    )
    monkeypatch.setattr(loader, "_load", lambda *_, **__: (owned, None))
    continuation = owner().ConfirmedAgentContinuation(
        loader=loader,
        store=None,
        operations=None,
        backend=None,
        lifecycle=None,
    )
    with sqlite_session_factory() as sql:
        if drift is None:
            run, pause = continuation._parent_rows(sql, ref=ref)
            assert run.id == pause.workflow_run_id == ids["run"]
        else:
            with pytest.raises(BuilderExecutionPolicyError, match="native_parent_pause_uncommitted"):
                continuation._parent_rows(sql, ref=ref)
