"""Actual native pause/restore scheduling with explicit C02/C03 in-memory ports.

No SQL claim, durable approval, encrypted checkpoint or LocalDev acceptance.
The concrete Dify factory, host, native HTTP adapter, journal, Graphon and SSRF
transport are real. Only authority/storage ports and physical HTTP send are test
boundaries. Removing the restored task must fail the physical-call assertion.
"""

from copy import deepcopy
from datetime import UTC, datetime
from threading import Thread, current_thread
from time import monotonic

import httpx
import pytest

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import GraphRunPausedEvent, GraphRunSucceededEvent, NodeRunStartedEvent
from graphon.graph import Graph
from graphon.runtime import VariablePool
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import ApprovalWait, CheckpointRef, PolicyStop, operation_digest
from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
from services.dify_builder.native_testing.context_runtime import NativeGraphRuntimeState, native_observation_scope
from services.dify_builder.native_testing.host_execution import NativeHostLaunch
from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime, NativeHostLifetimeRegistry
from services.dify_builder.native_testing.http_binding import (
    NativeHttpBindingProducer,
    build_native_http_profile,
    describe_http_resource,
    native_http_config,
)
from services.dify_builder.native_testing.lifecycle import NativeDispatchRef, NativeTestLifecycleService
from services.dify_builder.native_testing.observation_adapters import NativeObservationGuard
from services.dify_builder.native_testing.observation_privacy import NativeHttpObservationPolicy
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from services.dify_builder.native_testing.private_reads import PrivateReadOwner
from services.dify_builder.native_testing.repository import OwnedNativeTest
from services.dify_builder.native_testing.runtime import (
    DifyNativeResumeSettlement,
    DifyNativeRuntime,
    build_delivery_bridge,
)
from services.workflow_runtime.entry import WorkflowEntry
from services.workflow_runtime.node_factory import DifyGraphInitContext, DifyNodeFactory
from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import REF, Authorization, State
from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import (
    DurablePorts,
    NoCheckpointLifecycle,
    bind_generation,
)
from tests.unit_tests.services.dify_builder.native_testing.test_http_adapter import (
    protected_application_logs as protected_application_logs,  # noqa: PLC0414 - real logging fixture
)
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import context
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_bridge import _api


class SchedulingState(State):
    """C03 stand-in retains exact typed inputs/results across host generations."""

    def store_node_inputs(self, *, ref, generation, native_execution_id, inputs):
        assert ref == REF
        assert generation == self.context.generation
        result_ref = "inputs-" + native_execution_id
        if result_ref in self.values and self.values[result_ref] != inputs:
            raise BuilderExecutionPolicyError("native_payload_conflict")
        self.values[result_ref] = deepcopy(inputs)
        return result_ref

    def store_result(self, *, ref, key, result):
        assert ref == REF
        result_ref = "result-" + operation_digest(key)
        self.values[result_ref] = deepcopy(result)
        return result_ref

    def read_checkpoint(self, *, ref, checkpoint):
        assert ref == REF
        assert checkpoint == CheckpointRef(checkpoint_id="checkpoint", payload_digest="b" * 64)
        return self.payload


class SchedulingAuthorization:
    """C02 stand-in approves exact waiting intents, never a new occurrence."""

    def __init__(self, events):
        self.events = events
        self.ledgers = {}
        self.waiting = {}
        self.approved = set()

    def before_call(self, *, ref, intent):
        key = operation_digest(intent.key)
        ledger = self.ledgers.setdefault(key, Authorization(self.events))
        if key not in self.approved:
            self.waiting[key] = intent
            return ApprovalWait(pending_operation_id="pending-" + key)
        if self.waiting[key] != intent:
            return PolicyStop(reason_code="native_intent_conflict")
        return ledger.before_call(ref=ref, intent=intent)

    def claim_dispatch(self, *, ref, intent, permit):
        self.ledgers[operation_digest(intent.key)].claim_dispatch(ref=ref, intent=intent, permit=permit)

    def record_outcome(self, *, permit, outcome, result_ref):
        ledger = next(item for item in self.ledgers.values() if item.permits.get(0) is permit)
        return ledger.record_outcome(permit=permit, outcome=outcome, result_ref=result_ref)


class SchedulingHostCase:
    """Objects for one real Graphon scheduling generation and its host ports."""

    runtime: NativeGraphRuntimeState
    entry: WorkflowEntry
    journal: NodeOperationJournal

    def __init__(
        self,
        *,
        state,
        host: NativeHostLaunch,
        lifetime: NativeHostLifetime,
        registry: NativeHostLifetimeRegistry,
        ports: DurablePorts,
    ):
        self.state, self.host, self.lifetime = state, host, lifetime
        self.registry, self.ports = registry, ports


def scheduling_owner(state):
    context = state.context
    return OwnedNativeTest(
        ref=context.ref,
        tenant_id=context.tenant_id,
        actor_id=context.actor_id,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=context.generation,
        task_approved=True,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state="active",
    )


def make_host(state, authorization, monkeypatch, *, snapshot=None):
    journal = NodeOperationJournal(state=state, authorization=authorization)
    if snapshot is not None:
        state.payload = snapshot
        journal.restore(ref=REF, checkpoint=CheckpointRef(checkpoint_id="checkpoint", payload_digest="b" * 64))
    dispatch_id = "dispatch-" + str(state.context.generation)
    lifetime = NativeHostLifetime(context=state.context, dispatch_id=dispatch_id)
    registry = NativeHostLifetimeRegistry()
    registry.activate(lifetime=lifetime)
    ports = DurablePorts()
    timeout = native_http_config().default_timeout()
    host = NativeHostLaunch(
        context=state.context,
        dispatch_id=dispatch_id,
        lifetime=lifetime,
        journal=journal,
        checkpoints=NativeCheckpointBridge(state=state, lifecycle=NoCheckpointLifecycle()),
        fence_pending=ports.fence_pending,
        stop_sealer=ports,
        authorization=authorization,
        http_baseline=(timeout.connect, timeout.read, timeout.write),
    )
    case = SchedulingHostCase(state=state, host=host, lifetime=lifetime, registry=registry, ports=ports)
    _, _, response_filter, _, _ = bind_generation(case, monkeypatch)
    guard = NativeObservationGuard(
        policy=NativeHttpObservationPolicy.qualify(context=state.context, profile=build_native_http_profile()),
        on_failure=host.mark_unknown,
    )
    from services.dify_builder.native_testing import observation_owner

    monkeypatch.setattr(observation_owner, "create_http_observation_guard", lambda **_kwargs: guard)
    assert host.bind_observation() is guard
    with native_observation_scope(guard=guard):
        runtime = (
            NativeGraphRuntimeState(
                workflow_id=state.context.workflow_id, variable_pool=VariablePool(), start_at=monotonic()
            )
            if snapshot is None
            else NativeGraphRuntimeState.from_snapshot(snapshot.graph_runtime_state_json)
        )
        runtime.variable_pool.add(("start", "items"), ["one", "two"])
        api = _api()
        monkeypatch.setattr(api.loader, "load", lambda **_: scheduling_owner(state))
        lifecycle = NativeTestLifecycleService(
            api.loader, state_store=state, resume_settlement=DifyNativeResumeSettlement()
        )
        delivery_runtime = DifyNativeRuntime(
            delivery=NativeDispatchRef(REF, state.context.generation, dispatch_id),
            lifecycle=lifecycle,
            registry=registry,
        )
        delivery_runtime.host = host
        delivery_runtime.authorization = authorization
        delivery_runtime._journal = journal
        bridge = build_delivery_bridge(runtime=delivery_runtime)
        run_context = DifyRunContext(
            tenant_id=state.context.tenant_id,
            app_id=state.context.app_id,
            user_id=state.context.actor_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            native_test_required=True,
            native_test_ref=REF,
        )
        factory = DifyNodeFactory.from_graph_init_context(
            graph_init_context=DifyGraphInitContext(
                workflow_id=state.context.workflow_id,
                graph_config=state.context.graph,
                run_context={"_dify": run_context},
                call_depth=0,
            ),
            runtime_state=runtime,
            native_runtime=bridge,
        )
        graph = Graph.init(graph_config=state.context.graph, node_factory=factory, root_node_id="start")
        commands = host.wrap_commands(channel=InMemoryChannel())
        entry = WorkflowEntry(
            graph_config=state.context.graph,
            graph=graph,
            call_depth=0,
            graph_runtime_state=runtime,
            command_channel=commands,
            response_stream_filter=response_filter,
            native_host=host,
        )
        host.bind_engine(entry=entry, runtime_state=runtime, response_filter=response_filter, commands=commands)
    case.runtime, case.entry, case.journal = runtime, entry, journal
    return case


def run_host(case):
    events, errors = [], []

    def worker():
        try:
            events.extend(case.entry.run())
        except BaseException as error:
            errors.append(type(error).__name__)
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    thread = Thread(target=worker)
    case.host.start_worker(worker=thread)
    thread.join(10)
    assert not thread.is_alive()
    assert errors == []
    case.host.request_close(reason="exhausted")
    assert case.lifetime.settle() == "settled"
    return events


@pytest.mark.parametrize("kind", ["root", "loop", "iteration"])
def test_actual_http_pause_restore_dispatches_same_waiting_intent_once(monkeypatch, kind):
    events = []
    state, authorization = SchedulingState(events), SchedulingAuthorization(events)
    state.context = context()
    if kind != "root":
        graph = deepcopy(state.context.graph)
        http = next(node for node in graph["nodes"] if node["id"] == "http")
        http["data"][kind + "_id"] = "container"
        graph["nodes"] = [
            graph["nodes"][0],
            {
                "id": "container",
                "data": {
                    "type": kind,
                    "start_node_id": "body-start",
                    **(
                        {
                            "iterator_selector": ["start", "items"],
                            "output_selector": ["http", "body"],
                            "is_parallel": True,
                            "parallel_nums": 2,
                            "flatten_output": True,
                        }
                        if kind == "iteration"
                        else {"loop_count": 1, "break_conditions": [], "logical_operator": "and"}
                    ),
                },
            },
            {"id": "body-start", "data": {"type": kind + "-start", kind + "_id": "container"}},
            http,
            {"id": "end", "data": {"type": "end", "outputs": []}},
        ]
        graph["edges"] = [
            {"source": "start", "target": "container"},
            {"source": "body-start", "target": "http"},
            {"source": "container", "target": "end"},
        ]
        state.context = state.context.model_copy(
            update={
                "graph": graph,
                "resource_manifest": (
                    describe_http_resource(
                        node_id="http",
                        raw=http["data"],
                        workflow_revision=state.context.graph_revision,
                        app_id=state.context.app_id,
                        workflow_id=state.context.workflow_id,
                    ),
                ),
            }
        )
    sends = []

    def send(client, request, **kwargs):
        del client, kwargs
        sends.append(request)
        return httpx.Response(
            200, content=b"restored-response", headers={"content-type": "text/plain"}, request=request
        )

    monkeypatch.setattr(httpx.Client, "send", send)
    monkeypatch.setattr(
        "services.dify_builder.native_testing.http_binding.validate_private_read",
        lambda *_: PrivateReadOwner(
            tenant_id=state.context.tenant_id,
            actor_id=state.context.actor_id,
            app_id=state.context.app_id,
            workflow_id=state.context.workflow_id,
            parent_invocation_id=None,
            context_object_id="context",
            generation=state.context.generation,
            graph_revision=state.context.graph_revision,
            root_revision_matches=True,
            input_revision=None,
            expires_at=datetime(2030, 1, 1, tzinfo=UTC),
            cancelled=False,
            active=True,
            request_state="running",
        ),
    )
    monkeypatch.setattr(NativeHttpBindingProducer, "_install", lambda *_, **__: None)
    first = make_host(state, authorization, monkeypatch)
    initial = run_host(first)
    assert isinstance(initial[-1], GraphRunPausedEvent)
    assert sends == []
    payload = first.host.snapshot_wait()
    # A caller-supplied pending ID cannot replace the exact observed boundary.
    with pytest.raises(ValueError, match="native_host_checkpoint_mismatch"):
        first.host.commit_wait(payload=payload, pending_operation_ids=("forged-pending",))
    assert sends == []
    saved = {item.occurrence_path: item for item in payload.node_journals}
    expected_calls = 2 if kind == "iteration" else 1
    assert len(saved) == expected_calls
    original_executions = {
        event.id for event in initial if isinstance(event, NodeRunStartedEvent) and event.node_id == "http"
    }
    assert set(saved) == {(execution,) for execution in original_executions}
    assert all(
        item.cursor == 1 and item.operation_keys[0].cursor == 0 and item.result_refs == () for item in saved.values()
    )
    for item in saved.values():
        # The next integer is not the waiting occurrence's approved cursor.
        forged_cursor = item.operation_keys[0].model_copy(update={"cursor": 1})
        with pytest.raises(BuilderExecutionPolicyError, match="native_journal_sequence_conflict"):
            first.journal.resolve_cursor(ref=REF, key=forged_cursor)
    authorization.approved.update(authorization.waiting)
    state.context = state.context.model_copy(update={"generation": 1})
    resumed = make_host(state, authorization, monkeypatch, snapshot=payload)
    actual = run_host(resumed)
    assert isinstance(actual[-1], GraphRunSucceededEvent)
    assert len(sends) == expected_calls
    assert {
        event.id for event in actual if isinstance(event, NodeRunStartedEvent) and event.node_id == "http"
    } == original_executions
    for restored in resumed.journal.snapshot(ref=REF):
        prior = saved[restored.occurrence_path]
        assert restored.intents == prior.intents
        assert restored.operation_keys == prior.operation_keys
        assert restored.cursor == 1
        assert len(restored.result_refs) == 1
    if kind == "root":
        assert resumed.runtime.variable_pool.get(("http", "body")).value == "restored-response"
    if kind == "iteration":
        assert resumed.runtime.variable_pool.get(("container", "output")).value == [
            "restored-response",
            "restored-response",
        ]
