"""Dify control conversion; native engine coverage uses synthetic I/O only."""

from __future__ import annotations

import warnings
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from threading import Event
from typing import TypedDict, cast, override

import pytest
from pydantic import ValidationError

from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from graphon.entities.graph_init_params import GraphInitParams
from graphon.entities.pause_reason import SchedulingPause
from graphon.graph.graph import Graph
from graphon.graph_engine.command_channels.in_memory_channel import InMemoryChannel
from graphon.graph_engine.config import GraphEngineConfig
from graphon.graph_engine.graph_engine import GraphEngine
from graphon.graph_engine.layers.base import GraphEngineLayer
from graphon.graph_events.base import GraphEngineEvent
from graphon.graph_events.graph import GraphRunAbortedEvent, GraphRunPausedEvent, GraphRunSucceededEvent
from graphon.graph_events.node import NodeRunPauseRequestedEvent, NodeRunStartedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.code.code_node import CodeNode
from graphon.nodes.code.limits import CodeNodeLimits
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.iteration.iteration_node import IterationNode
from graphon.nodes.iteration.iteration_start_node import IterationStartNode
from graphon.nodes.start.start_node import StartNode
from graphon.nodes.template_transform.template_transform_node import TemplateTransformNode
from graphon.runtime.graph_runtime_state import GraphRuntimeState
from graphon.runtime.variable_pool import VariablePool
from graphon.template_rendering import Jinja2TemplateRenderer, TemplateRenderError
from services.dify_builder.native_testing import control as native_control
from services.dify_builder.native_testing.contracts import (
    ApprovalWait,
    DispatchPermit,
    EffectDecision,
    NativeTestContextRef,
    PolicyStop,
    RecordedResult,
    WaitReason,
)
from services.dify_builder.native_testing.control import (
    BoundaryOwnerState,
    NativeApprovalWait,
    NativeControlAccepted,
    NativeControlRecord,
    NativeControlRefused,
    NativePolicyStop,
)

REF = NativeTestContextRef(request_id="request", invocation_id="invocation", context_digest="a" * 64)


@pytest.mark.parametrize(
    "decision",
    [
        DispatchPermit(
            permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
        ),
        RecordedResult(operation_id="operation", result_ref="private-result"),
    ],
)
def test_authorized_decisions_preserve_object_identity(decision: DispatchPermit | RecordedResult) -> None:
    assert native_control.NativeControlBridge.resolve(ref=REF, decision=decision) is decision


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_wait_crosses_ordinary_exception_conversion_with_exact_context(reason: WaitReason) -> None:
    module = native_control
    decision = ApprovalWait(pending_operation_id="private-pending", wait_reason=reason)
    with pytest.raises(module.NativeApprovalWait) as caught:
        module.NativeControlBridge.resolve(ref=REF, decision=decision)
    control = caught.value
    assert isinstance(control, BaseException)
    assert not isinstance(control, Exception)
    assert control.ref is REF
    assert control.pending_operation_id == "private-pending"
    assert control.wait_reason == reason
    assert "private-pending" not in str(control)
    assert "invocation" not in str(control)


def test_stop_preserves_typed_reason_without_disclosing_it_in_diagnostics() -> None:
    module = native_control
    with pytest.raises(module.NativePolicyStop) as caught:
        module.NativeControlBridge.resolve(ref=REF, decision=PolicyStop(reason_code="outcome_unknown"))
    assert caught.value.ref is REF
    assert caught.value.reason_code == "outcome_unknown"
    assert not isinstance(caught.value, Exception)
    assert "outcome_unknown" not in str(caught.value)


@pytest.mark.parametrize(
    "decision",
    [
        None,
        {"kind": "dispatch", "permit_id": "forged"},
        ApprovalWait.model_construct(pending_operation_id="pending", wait_reason="unsupported"),
        PolicyStop.model_construct(reason_code="secret exception text"),
        RecordedResult.model_construct(operation_id="operation", result_ref=""),
    ],
)
def test_malformed_decision_is_private_stop_before_any_dispatch(decision: object) -> None:
    module = native_control
    with pytest.raises(module.NativePolicyStop) as caught:
        module.NativeControlBridge.resolve(ref=REF, decision=cast(EffectDecision, decision))
    assert caught.value.reason_code == "native_control_invalid_decision"
    assert "secret" not in str(caught.value)


def test_malformed_decision_never_logs_serializer_input_values() -> None:
    module = native_control
    malformed = DispatchPermit.model_construct(
        permit_id={"secret": "token"}, attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
    )
    with warnings.catch_warnings(record=True) as logged:
        warnings.simplefilter("always")
        with pytest.raises(module.NativePolicyStop):
            module.NativeControlBridge.resolve(ref=REF, decision=malformed)
    assert logged == []


def test_malformed_owner_ref_is_rejected_without_warnings_or_canary_in_exception() -> None:
    malformed = NativeTestContextRef.model_construct(
        request_id={"secret": "nw3_owner_ref_canary"}, invocation_id="invocation", context_digest="a" * 64
    )
    with warnings.catch_warnings(record=True) as logged:
        warnings.simplefilter("always")
        with pytest.raises(ValidationError) as caught:
            BoundaryOwnerState(ref=malformed)
    assert "nw3_owner_ref_canary" not in str(caught.value)
    assert logged == []


# These are the real native classes used by the public Graph.init factory below.
# Loading precedes opt-in subclass creation, preserving the existing mappings.
ORIGINALS = (StartNode, EndNode, TemplateTransformNode, CodeNode, IterationNode, IterationStartNode)
POLICIES = [
    {"retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 0}},
    {"error_strategy": "default-value", "default_value": [{"key": "output", "type": "string", "value": "fallback"}]},
    {"error_strategy": "fail-branch"},
]


@dataclass
class Sink:
    """Synthetic acceptance collaborator; no persistence or checkpoint claim."""

    owner: BoundaryOwnerState
    mode: str = "accept"
    records: list[NativeControlRecord] = field(default_factory=list)
    before_accept: Callable[[NativeControlRecord], None] | None = None

    def record_control(self, *, record: NativeControlRecord) -> NativeControlAccepted | NativeControlRefused:
        module = native_control
        assert not self.owner.dispatch_admissible
        assert record in self.owner.records
        self.records.append(record)
        if self.mode == "refuse":
            return module.NativeControlRefused()
        if self.mode == "exception":
            raise RuntimeError("secret callback configuration")
        if self.mode == "base-exception":
            raise SystemExit("secret callback configuration")
        if self.mode == "malformed":
            return cast(NativeControlAccepted | NativeControlRefused, True)
        if self.before_accept is not None:
            self.before_accept(record)
        return module.NativeControlAccepted(record=record)


@dataclass
class Effects:
    """Synthetic Code/Jinja I/O boundary; native nodes and engine stay real."""

    owner: BoundaryOwnerState
    decision: EffectDecision
    dispatches: int = 0
    foreign: BaseException | None = None
    decision_ref: NativeTestContextRef = REF
    decisions_by_node: dict[str, EffectDecision] = field(default_factory=dict)

    def render(self, template: str, variables: Mapping[str, object], node_id: str) -> str:
        if self.foreign is not None:
            raise self.foreign
        decision = self.decisions_by_node.get(node_id, self.decision)
        native_control.NativeControlBridge.resolve(ref=self.decision_ref, decision=decision)
        assert self.owner.dispatch_admissible, "trusted dispatch owner must be consulted before I/O"
        self.dispatches += 1
        if template == "business-failure":
            raise TemplateRenderError("ordinary business failure")
        return str(variables.get("item", "ok")) + "!"


class Renderer(Jinja2TemplateRenderer):
    def __init__(self, effects: Effects, node_id: str) -> None:
        self.effects = effects
        self.node_id = node_id

    @override
    def render_template(self, template: str, variables: Mapping[str, object]) -> str:
        return self.effects.render(template, variables, self.node_id)


class CodeExecutor:
    def __init__(self, effects: Effects, node_id: str) -> None:
        self.effects = effects
        self.node_id = node_id

    def execute(self, *, language: str, code: str, inputs: Mapping[str, object]) -> dict[str, str]:
        assert language == "python3"
        return {"output": self.effects.render(code, inputs, self.node_id)}

    def is_execution_error(self, error: BaseException) -> bool:
        return isinstance(error, TemplateRenderError)


class RawNodeConfig(TypedDict):
    id: str
    data: dict[str, object]


class RawGraphConfig(TypedDict):
    nodes: list[RawNodeConfig]
    edges: list[dict[str, str]]


@dataclass(frozen=True)
class Factory:
    config: RawGraphConfig
    runtime: GraphRuntimeState
    owner: BoundaryOwnerState
    sink: Sink
    effects: Effects
    marked: bool = True
    children: list[GraphRuntimeState] = field(default_factory=list)

    def with_runtime_state(self, graph_runtime_state: GraphRuntimeState) -> Factory:
        self.children.append(graph_runtime_state)
        return Factory(
            self.config, graph_runtime_state, self.owner, self.sink, self.effects, self.marked, self.children
        )

    def create_node(self, node_config: NodeConfigDict) -> Node[BaseNodeData]:
        original = next(cls for cls in ORIGINALS if cls.node_type == node_config["data"]["type"])
        cls = native_control.marked_native_node_class(original, marked=self.marked)
        kwargs: dict[str, object] = {
            "node_id": node_config["id"],
            "data": cls.validate_node_data(node_config["data"]),
            "graph_init_params": GraphInitParams(
                workflow_id="control-unit", graph_config=self.config, run_context={}, call_depth=0
            ),
            "graph_runtime_state": self.runtime,
        }
        if original is TemplateTransformNode:
            kwargs["jinja2_template_renderer"] = Renderer(self.effects, node_config["id"])
        if original is CodeNode:
            kwargs["code_executor"] = CodeExecutor(self.effects, node_config["id"])
            kwargs["code_limits"] = CodeNodeLimits(
                max_string_length=1000,
                max_number=1000,
                min_number=-1000,
                max_precision=10,
                max_depth=10,
                max_number_array_length=100,
                max_string_array_length=100,
                max_object_array_length=100,
            )
        if self.marked:
            kwargs.update(native_control_owner=self.owner, native_control_sink=self.sink)
        return cast(Callable[..., Node[BaseNodeData]], cls)(**kwargs)


def node(node_id: str, kind: str, **data: object) -> RawNodeConfig:
    return {"id": node_id, "data": {"type": kind, **data}}


def basic(policy: dict[str, object] | None = None, template: str = "ok") -> RawGraphConfig:
    policy = policy or {}
    if "retry_config" in policy:
        guard = node(
            "guard",
            "code",
            code=template,
            code_language="python3",
            variables=[],
            outputs={"output": {"type": "string"}},
            **policy,
        )
    else:
        guard = node("guard", "template-transform", template=template, variables=[], **policy)
    return {
        "nodes": [
            node("start", "start", variables=[]),
            guard,
            node("end", "end", outputs=[{"variable": "answer", "value_selector": ["guard", "output"]}]),
        ],
        "edges": [{"source": "start", "target": "guard"}, {"source": "guard", "target": "end"}],
    }


def make_native(
    *,
    decision: EffectDecision | None = None,
    policy: dict[str, object] | None = None,
    mode: str = "accept",
    ref: NativeTestContextRef = REF,
    config: RawGraphConfig | None = None,
    runtime: GraphRuntimeState | None = None,
) -> tuple[GraphEngine, Factory]:
    module = native_control
    owner = module.BoundaryOwnerState(ref=ref)
    sink = Sink(owner=owner, mode=mode)
    effects = Effects(
        owner=owner, decision=decision or ApprovalWait(pending_operation_id="private-pending"), decision_ref=ref
    )
    if runtime is None:
        pool = VariablePool()
        pool.add(("start", "items"), ["a", "b"])
        runtime = GraphRuntimeState(variable_pool=pool, start_at=0)
    config = config or basic(policy)
    factory = Factory(config, runtime, owner, sink, effects)
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    native = GraphEngine(
        workflow_id="control-unit",
        graph=graph,
        graph_runtime_state=runtime,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(min_workers=2, max_workers=2),
    )
    return native, factory


def permit() -> DispatchPermit:
    return DispatchPermit(
        permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
    )


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
@pytest.mark.parametrize("policy", POLICIES)
def test_native_wait_bypasses_retry_default_and_failure_branch(reason: WaitReason, policy: dict[str, object]) -> None:
    native, factory = make_native(
        decision=ApprovalWait(pending_operation_id="private-pending", wait_reason=reason), policy=policy
    )
    events = list(native.run())
    names = [type(event).__name__ for event in events]
    assert isinstance(events[-1], GraphRunPausedEvent)
    assert not {"NodeRunFailedEvent", "NodeRunRetryEvent", "NodeRunExceptionEvent"}.intersection(names)
    assert factory.effects.dispatches == 0
    assert factory.owner.status == "WAIT_RECORDED"
    (record,) = factory.sink.records
    assert isinstance(record.control, NativeApprovalWait)
    assert record.control.ref is REF
    assert record.control.wait_reason == reason
    assert record.native_execution_id == next(
        event.id for event in events if isinstance(event, NodeRunStartedEvent) and event.node_id == "guard"
    )
    (carrier,) = [event for event in events if isinstance(event, NodeRunPauseRequestedEvent)]
    assert carrier.id == record.native_execution_id
    assert isinstance(carrier.reason, SchedulingPause)
    assert carrier.reason.message == record.carrier_ref
    assert "private-pending" not in carrier.model_dump_json()
    aggregate = native.graph_runtime_state.graph_execution
    assert aggregate.paused
    assert not aggregate.aborted
    assert aggregate.error is None


@pytest.mark.parametrize("policy", POLICIES)
def test_stop_records_owner_then_aborts_without_native_failure_policy(policy: dict[str, object]) -> None:
    native, factory = make_native(decision=PolicyStop(reason_code="outcome_unknown"), policy=policy)
    events = list(native.run())
    assert isinstance(events[-1], GraphRunAbortedEvent)
    assert not {
        "NodeRunPauseRequestedEvent",
        "NodeRunFailedEvent",
        "NodeRunRetryEvent",
        "NodeRunExceptionEvent",
    }.intersection(type(event).__name__ for event in events)
    assert factory.owner.status == "STOP_RECORDED"
    stop = factory.sink.records[0].control
    assert isinstance(stop, NativePolicyStop)
    assert stop.reason_code == "outcome_unknown"
    assert not factory.owner.dispatch_admissible
    assert factory.effects.dispatches == 0
    aggregate = native.graph_runtime_state.graph_execution
    assert aggregate.aborted
    assert not aggregate.paused


@pytest.mark.parametrize("mode", ["refuse", "exception", "base-exception", "malformed"])
@pytest.mark.parametrize("policy", POLICIES)
def test_sink_refusal_or_failure_is_nonresumable_abort_without_fallback(mode: str, policy: dict[str, object]) -> None:
    native, factory = make_native(mode=mode, policy=policy)
    events = list(native.run())
    assert isinstance(events[-1], GraphRunAbortedEvent)
    assert factory.owner.status == "UNKNOWN_NONRESUMABLE"
    assert not factory.owner.dispatch_admissible
    assert factory.effects.dispatches == 0
    assert not {
        "NodeRunPauseRequestedEvent",
        "NodeRunFailedEvent",
        "NodeRunRetryEvent",
        "NodeRunExceptionEvent",
    }.intersection(type(event).__name__ for event in events)
    assert "secret" not in str(native.graph_runtime_state.graph_execution.error)
    assert factory.owner.reason_code is not None
    assert "secret" not in factory.owner.reason_code


def test_mismatched_control_ref_is_nonresumable_before_sink_or_dispatch() -> None:
    native, factory = make_native()
    factory.effects.decision_ref = REF.model_copy(update={"invocation_id": "foreign-invocation"})
    events = list(native.run())
    assert isinstance(events[-1], GraphRunAbortedEvent)
    assert factory.owner.reason_code == "native_control_ref_mismatch"
    assert factory.sink.records == []
    assert factory.effects.dispatches == 0


def test_missing_native_execution_id_is_rejected_before_node_or_sink() -> None:
    _, factory = make_native()
    unbound = factory.create_node(NodeConfigDictAdapter.validate_python(basic()["nodes"][1]))
    assert list(unbound.run()) == []
    assert factory.owner.status == "UNKNOWN_NONRESUMABLE"
    assert factory.owner.reason_code == "native_control_execution_id_missing"
    assert factory.sink.records == []
    assert factory.effects.dispatches == 0


@pytest.mark.parametrize("foreign", [SystemExit("foreign"), KeyboardInterrupt("foreign"), BaseException("foreign")])
def test_foreign_native_base_exception_propagates_by_exact_identity(foreign: BaseException) -> None:
    _, factory = make_native()
    factory.effects.foreign = foreign
    direct = factory.create_node(NodeConfigDictAdapter.validate_python(basic()["nodes"][1]))
    direct.bind_execution_id("native-bound-execution")
    with pytest.raises(type(foreign)) as caught:
        list(direct.run())
    assert caught.value is foreign
    assert factory.owner.status == "OPEN"
    assert factory.sink.records == []


@pytest.mark.parametrize("policy", POLICIES)
def test_ordinary_business_failure_keeps_native_retry_and_default_semantics(policy: dict[str, object]) -> None:
    native, factory = make_native(decision=permit(), policy=policy, config=basic(policy, "business-failure"))
    events: list[GraphEngineEvent] = []
    if "retry_config" in policy:
        with pytest.raises(RuntimeError, match="^ordinary business failure$"):
            events.extend(native.run())
    else:
        events.extend(native.run())
    names = [type(event).__name__ for event in events]
    assert "NodeRunPauseRequestedEvent" not in names
    assert factory.owner.status == "OPEN"
    if "retry_config" in policy:
        assert factory.effects.dispatches == 3
        assert names.count("NodeRunRetryEvent") == 2
        assert "NodeRunFailedEvent" in names
        assert str(native.graph_runtime_state.graph_execution.error) == "ordinary business failure"
    else:
        assert factory.effects.dispatches == 1
        assert "NodeRunExceptionEvent" in names
        assert names[-1] == "GraphRunPartialSucceededEvent"
        if policy["error_strategy"] == "default-value":
            assert native.graph_runtime_state.outputs == {"answer": "fallback"}
    assert not native.graph_runtime_state.graph_execution.paused


def test_marked_class_cache_preserves_all_current_mappings_without_instance_context() -> None:
    module = native_control
    before = {key: dict(value) for key, value in Node.get_node_type_classes_mapping().items()}
    initial_version = Node.get_registry_version()
    first = module.marked_native_node_class(TemplateTransformNode, marked=True)
    after_first_version = Node.get_registry_version()
    assert module.marked_native_node_class(TemplateTransformNode, marked=True) is first
    assert Node.get_registry_version() == after_first_version
    assert after_first_version in (initial_version, initial_version + 1)
    for original in ORIGINALS:
        assert module.marked_native_node_class(original, marked=False) is original
        assert issubclass(module.marked_native_node_class(original, marked=True), original)
    assert before == {key: dict(value) for key, value in Node.get_node_type_classes_mapping().items()}
    assert module.marked_native_node_class(TemplateTransformNode, marked=True) is first


def test_opt_in_rejects_non_boolean_marker_and_missing_trusted_sink() -> None:
    module = native_control
    with pytest.raises(ValueError, match="native_control_concrete_class_required"):
        module.marked_native_node_class(TemplateTransformNode, marked=cast(bool, "client supplied truthy text"))
    _, factory = make_native()
    cls = module.marked_native_node_class(TemplateTransformNode, marked=True)
    with pytest.raises(TypeError, match="native_control_sink"):
        cast(Callable[..., Node[BaseNodeData]], cls)(native_control_owner=factory.owner)


def test_independent_simultaneous_contexts_share_classes_but_never_host_ownership() -> None:
    other = REF.model_copy(update={"request_id": "other", "invocation_id": "other-invocation"})
    first, first_factory = make_native()
    second, second_factory = make_native(ref=other)
    assert type(first.graph.nodes["guard"]) is type(second.graph.nodes["guard"])
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda engine: list(engine.run()), [first, second]))
    assert all(isinstance(events[-1], GraphRunPausedEvent) for events in results)
    assert first_factory.owner.records[0].control.ref is REF
    assert second_factory.owner.records[0].control.ref is other
    assert first_factory.owner.records[0].carrier_ref != second_factory.owner.records[0].carrier_ref


def test_actual_iteration_child_restore_and_container_resume_forward_native_algorithm() -> None:
    config = {
        "nodes": [
            node("start", "start", variables=[]),
            node(
                "container",
                "iteration",
                iterator_selector=["start", "items"],
                output_selector=["guard", "output"],
                start_node_id="body-start",
                is_parallel=True,
                parallel_nums=2,
                error_handle_mode="terminated",
                flatten_output=True,
            ),
            node("body-start", "iteration-start", iteration_id="container"),
            node(
                "guard",
                "template-transform",
                iteration_id="container",
                template="ok",
                variables=[{"variable": "item", "value_selector": ["container", "item"]}],
            ),
            node("end", "end", outputs=[{"variable": "items", "value_selector": ["container", "output"]}]),
        ],
        "edges": [
            {"source": "start", "target": "container"},
            {"source": "body-start", "target": "guard"},
            {"source": "container", "target": "end"},
        ],
    }
    native, first = make_native(config=config)
    assert isinstance(list(native.run())[-1], GraphRunPausedEvent)
    assert first.children
    assert first.effects.dispatches == 0
    assert len(first.owner.records) == 2
    assert len({record.native_execution_id for record in first.owner.records}) == 2
    restored = GraphRuntimeState.from_snapshot(native.graph_runtime_state.dumps())
    # Fresh component owner stands for separately admitted composition, not a
    # durable generation claim; this test does not implement admission/replay.
    resumed, second = make_native(config=config, runtime=restored, decision=permit())
    assert isinstance(list(resumed.run())[-1], GraphRunSucceededEvent)
    assert second.children
    assert second.effects.dispatches == 2
    assert resumed.graph_runtime_state.outputs == {"items": ["a!", "b!"]}


def parallel_config() -> RawGraphConfig:
    return {
        "nodes": [
            node("start", "start", variables=[]),
            node("one", "template-transform", template="ok", variables=[]),
            node("two", "template-transform", template="ok", variables=[]),
        ],
        "edges": [{"source": "start", "target": "one"}, {"source": "start", "target": "two"}],
    }


def test_actual_parallel_waits_retain_both_distinct_pending_ids_and_native_bindings() -> None:
    native, factory = make_native(config=parallel_config())
    factory.effects.decisions_by_node = {
        "one": ApprovalWait(pending_operation_id="pending-one", wait_reason="configuration"),
        "two": ApprovalWait(pending_operation_id="pending-two", wait_reason="interaction"),
    }
    events = list(native.run())
    assert isinstance(events[-1], GraphRunPausedEvent)
    assert factory.owner.status == "WAIT_RECORDED"
    waits = [record.control for record in factory.owner.records if isinstance(record.control, NativeApprovalWait)]
    assert {control.pending_operation_id for control in waits} == {"pending-one", "pending-two"}
    assert {control.wait_reason for control in waits} == {"configuration", "interaction"}
    assert len({record.native_execution_id for record in factory.owner.records}) == 2
    assert len([event for event in events if isinstance(event, NodeRunPauseRequestedEvent)]) == 2
    assert factory.effects.dispatches == 0


class PauseObserved(GraphEngineLayer):
    def __init__(self, observed: Event) -> None:
        super().__init__()
        self.observed = observed

    @override
    def on_graph_start(self) -> None:
        pass

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        pass

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        if isinstance(event, NodeRunPauseRequestedEvent):
            self.observed.set()


@pytest.mark.parametrize("callback_fails", [False, True])
def test_actual_parallel_stop_or_unknown_has_priority_after_native_pause_is_observed(callback_fails: bool) -> None:
    module = native_control
    observed = Event()
    native, factory = make_native(config=parallel_config())
    factory.effects.decisions_by_node = {
        "one": ApprovalWait(pending_operation_id="pending-one", wait_reason="approval"),
        "two": PolicyStop(reason_code="outcome_unknown"),
    }

    def wait_for_pause(record: NativeControlRecord) -> None:
        if isinstance(record.control, module.NativePolicyStop):
            assert observed.wait(3), "native public pause event must precede stop acceptance"
            if callback_fails:
                raise SystemExit("secret callback failure after pause")

    factory.sink.before_accept = wait_for_pause
    native.layer(PauseObserved(observed))
    events = list(native.run())
    assert observed.is_set()
    assert factory.owner.status == ("UNKNOWN_NONRESUMABLE" if callback_fails else "STOP_RECORDED")
    assert len(factory.owner.records) == 2
    assert factory.effects.dispatches == 0
    assert not factory.owner.dispatch_admissible
    # Official 0.7 native pause priority is deliberately retained as evidence;
    # host STOP ownership forbids treating this as resumable waiting.
    aggregate = native.graph_runtime_state.graph_execution
    assert aggregate.paused
    assert aggregate.aborted
    assert aggregate.error is not None
    assert isinstance(events[-1], GraphRunPausedEvent)
