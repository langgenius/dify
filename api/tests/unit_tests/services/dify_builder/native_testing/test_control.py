"""Dify control conversion; native engine coverage uses synthetic I/O only."""

from __future__ import annotations

import warnings
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from threading import Barrier, Event, Thread, current_thread
from types import TracebackType
from typing import Literal, TypedDict, cast, override

import pytest
from pydantic import ValidationError

from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine.layer.base import Layer
from graphon.engine_events.base import EngineEvent
from graphon.engine_events.graph import GraphRunAbortedEvent, GraphRunPausedEvent, GraphRunSucceededEvent
from graphon.engine_events.node import NodeRunPauseRequestedEvent, NodeRunStartedEvent
from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from graphon.entities.pause_reason import SchedulingPause
from graphon.enums import NodeExecutionType
from graphon.graph.graph import Graph
from graphon.nodes.base.node import Node
from graphon.nodes.code.code_node import CodeNode
from graphon.nodes.code.limits import CodeNodeLimits
from graphon.nodes.container_effects import IterationFrameRequest
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.iteration.iteration_node import IterationNode
from graphon.nodes.iteration.iteration_start_node import IterationStartNode
from graphon.nodes.start.start_node import StartNode
from graphon.nodes.template_transform.template_transform_node import TemplateTransformNode
from graphon.runtime import InitParams, RuntimeState
from graphon.runtime.variable_pool import VariablePool
from graphon.template_rendering import Jinja2TemplateRenderer, TemplateRenderError
from runtime_contracts.builder.native.contracts import (
    ApprovalWait,
    DispatchPermit,
    EffectDecision,
    NativeTestContextRef,
    PolicyStop,
    RecordedResult,
    WaitReason,
)
from services.dify_builder.native_testing import control as native_control
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
    runtime: RuntimeState
    owner: BoundaryOwnerState
    sink: Sink
    effects: Effects
    marked: bool = True
    children: list[RuntimeState] = field(default_factory=list)
    run_context: Mapping[str, object] = field(default_factory=dict)

    def with_runtime_state(self, runtime_state: RuntimeState) -> Factory:
        self.children.append(runtime_state)
        return Factory(
            self.config,
            runtime_state,
            self.owner,
            self.sink,
            self.effects,
            self.marked,
            self.children,
            self.run_context,
        )

    def with_graph_config(self, graph_config: Mapping[str, object]) -> Factory:
        from dataclasses import replace

        return replace(self, config=cast(RawGraphConfig, graph_config))

    def validate_node(self, node_config: NodeConfigDict) -> NodeExecutionType:
        raw = node_config["data"].model_dump(mode="python", exclude_unset=True)
        original = next(cls for cls in ORIGINALS if cls.node_type == raw["type"])
        original.validate_node_data(raw)
        return original.execution_type

    def create_node(self, node_config: NodeConfigDict) -> Node[BaseNodeData]:
        raw_data = node_config["data"].model_dump(mode="python", exclude_unset=True)
        original = next(cls for cls in ORIGINALS if cls.node_type == raw_data["type"])
        cls = native_control.marked_native_node_class(original, marked=self.marked)
        kwargs: dict[str, object] = {
            "node_id": node_config["id"],
            "data": cls.validate_node_data(raw_data),
            "init_params": InitParams(
                workflow_id=self.runtime.graph_execution.workflow_id,
                graph_config=self.config,
                run_context=self.run_context,
                call_depth=0,
            ),
            "runtime_state": self.runtime,
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
    runtime: RuntimeState | None = None,
    ownership: Observations | None = None,
) -> tuple[Engine, Factory]:
    module = native_control
    owner = (
        module.BoundaryOwnerState(ref=ref)
        if ownership is None
        else module.BoundaryOwnerState(ref=ref, ownership=ownership)
    )
    sink = Sink(owner=owner, mode=mode)
    effects = Effects(
        owner=owner, decision=decision or ApprovalWait(pending_operation_id="private-pending"), decision_ref=ref
    )
    if runtime is None:
        pool = VariablePool()
        pool.add(("start", "items"), ["a", "b"])
        runtime = RuntimeState(workflow_id="control-unit", variable_pool=pool, start_at=0)
    config = config or basic(policy)
    factory = Factory(config, runtime, owner, sink, effects)
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    native = Engine(
        graph=graph,
        runtime_state=runtime,
        command_channel=InMemoryChannel(),
        workers=2,
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
    aggregate = native.runtime_state.graph_execution
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
    aggregate = native.runtime_state.graph_execution
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
    assert "secret" not in str(native.runtime_state.graph_execution.error)
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
    events: list[EngineEvent] = []
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
        assert str(native.runtime_state.graph_execution.error) == "ordinary business failure"
    else:
        assert factory.effects.dispatches == 1
        assert "NodeRunExceptionEvent" in names
        assert names[-1] == "GraphRunPartialSucceededEvent"
        if policy["error_strategy"] == "default-value":
            assert native.runtime_state.outputs == {"answer": "fallback"}
    assert not native.runtime_state.graph_execution.paused


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
    # Both occurrences reach their control boundary before either worker emits
    # a pause; Graphon 0.8 can defer a sibling that has not started yet.
    arrived = Barrier(2)

    def before_accept(_record: NativeControlRecord) -> None:
        arrived.wait(timeout=3)

    first.sink.before_accept = before_accept
    assert isinstance(list(native.run())[-1], GraphRunPausedEvent)
    assert first.children
    assert first.effects.dispatches == 0
    assert len(first.owner.records) == 2
    assert len({record.native_execution_id for record in first.owner.records}) == 2
    restored = RuntimeState.from_snapshot(native.runtime_state.dumps())
    # Fresh component owner stands for separately admitted composition, not a
    # durable generation claim; this test does not implement admission/replay.
    resumed, second = make_native(config=config, runtime=restored, decision=permit())
    assert isinstance(list(resumed.run())[-1], GraphRunSucceededEvent)
    assert second.children
    assert second.effects.dispatches == 2
    assert resumed.runtime_state.outputs == {"items": ["a!", "b!"]}


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
    # Exercise two reached boundaries: Graphon can defer an unstarted sibling
    # as soon as the first worker requests a pause.
    arrived = Barrier(2)

    def before_accept(_record: NativeControlRecord) -> None:
        arrived.wait(timeout=3)

    factory.sink.before_accept = before_accept
    events = list(native.run())
    assert isinstance(events[-1], GraphRunPausedEvent)
    assert factory.owner.status == "WAIT_RECORDED"
    waits = [record.control for record in factory.owner.records if isinstance(record.control, NativeApprovalWait)]
    assert {control.pending_operation_id for control in waits} == {"pending-one", "pending-two"}
    assert {control.wait_reason for control in waits} == {"configuration", "interaction"}
    assert len({record.native_execution_id for record in factory.owner.records}) == 2
    assert len([event for event in events if isinstance(event, NodeRunPauseRequestedEvent)]) == 2
    assert factory.effects.dispatches == 0


class PauseObserved(Layer):
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
    def on_event(self, event: EngineEvent) -> None:
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
    native.add_layer(PauseObserved(observed))
    events = list(native.run())
    assert observed.is_set()
    assert factory.owner.status == ("UNKNOWN_NONRESUMABLE" if callback_fails else "STOP_RECORDED")
    assert len(factory.owner.records) == 2
    assert factory.effects.dispatches == 0
    assert not factory.owner.dispatch_admissible
    # Graphon 0.8 gives abort priority over an earlier pause. The host also
    # retains STOP ownership, so this cannot become resumable waiting.
    aggregate = native.runtime_state.graph_execution
    assert aggregate.paused
    assert aggregate.aborted
    assert aggregate.error is not None
    assert isinstance(events[-1], GraphRunAbortedEvent)


@dataclass(eq=False)
class ObservedNode(AbstractContextManager[None]):
    """Witness exact native instance and callback lifetime, never host completion."""

    observations: Observations
    node: Node[BaseNodeData]
    phase: Literal["run", "resume_container"]
    thread: Thread = field(default_factory=current_thread)
    execution_id: str = field(init=False)
    runtime: RuntimeState = field(init=False)
    exception: BaseException | None = None

    def __enter__(self) -> None:
        self.execution_id = self.node.execution_id
        self.runtime = self.node.runtime_state
        if self.observations.enter_error is not None:
            raise self.observations.enter_error
        self.observations.active.append(self)
        self.observations.entered.append(self)

    def __exit__(
        self, exc_type: type[BaseException] | None, exc_value: BaseException | None, traceback: TracebackType | None
    ) -> bool:
        self.exception = exc_value
        try:
            if self.observations.before_exit is not None:
                self.observations.before_exit(self)
            if self.observations.exit_error is not None:
                raise self.observations.exit_error
        finally:
            self.observations.active.remove(self)
            self.observations.exited.append(self)
        return self.observations.suppress


@dataclass
class Observations:
    active: list[ObservedNode] = field(default_factory=list)
    entered: list[ObservedNode] = field(default_factory=list)
    exited: list[ObservedNode] = field(default_factory=list)
    enter_error: BaseException | None = None
    exit_error: BaseException | None = None
    factory_error: BaseException | None = None
    suppress: bool = False
    before_exit: Callable[[ObservedNode], None] | None = None

    def node_scope(
        self, *, node: Node[BaseNodeData], phase: Literal["run", "resume_container"]
    ) -> AbstractContextManager[None]:
        if self.factory_error is not None:
            raise self.factory_error
        return ObservedNode(self, node, phase)


def bound_guard(factory: Factory) -> Node[BaseNodeData]:
    direct = factory.create_node(NodeConfigDictAdapter.validate_python(factory.config["nodes"][1]))
    direct.bind_execution_id("native-observed-execution")
    return direct


def test_node_observation_is_lazy_bound_and_finally_safe_on_close() -> None:
    observations = Observations()
    _, factory = make_native(decision=permit(), ownership=observations)
    direct = bound_guard(factory)
    stream = direct.run()
    assert observations.entered == []
    assert isinstance(next(stream), NodeRunStartedEvent)
    (observed,) = observations.active
    assert observed.node is direct
    assert observed.runtime is factory.runtime
    assert observed.thread is current_thread()
    assert observed.execution_id == "native-observed-execution"
    assert observed.phase == "run"
    assert factory.effects.dispatches == 0
    stream.close()
    assert observations.active == []
    assert observations.exited == [observed]
    assert isinstance(observed.exception, GeneratorExit)
    assert factory.owner.status == "OPEN"


def test_unbound_node_never_enters_observation() -> None:
    observations = Observations()
    _, factory = make_native(ownership=observations)
    unbound = factory.create_node(NodeConfigDictAdapter.validate_python(basic()["nodes"][1]))
    assert list(unbound.run()) == []
    assert observations.entered == []
    assert factory.owner.status == "UNKNOWN_NONRESUMABLE"


@pytest.mark.parametrize(
    "decision", [permit(), ApprovalWait(pending_operation_id="pending"), PolicyStop(reason_code="stop")]
)
def test_actual_native_worker_observation_covers_sink_and_finishes(decision: EffectDecision) -> None:
    observations = Observations()
    native, factory = make_native(decision=decision, ownership=observations)
    callbacks: list[ObservedNode] = []

    def inspect_sink(record: NativeControlRecord) -> None:
        observed = next(item for item in observations.active if item.node.id == record.node_id)
        assert observed.thread is current_thread()
        assert observed.execution_id == record.native_execution_id
        assert observed.node is native.graph.nodes[record.node_id]
        callbacks.append(observed)

    factory.sink.before_accept = inspect_sink
    events = list(native.run())
    assert observations.active == []
    assert sorted(map(id, observations.entered)) == sorted(map(id, observations.exited))
    guard = next(item for item in observations.entered if item.node.id == "guard")
    assert guard.node is native.graph.nodes["guard"]
    assert guard.runtime is factory.runtime
    assert guard.thread is not current_thread()
    assert guard.phase == "run"
    if isinstance(decision, DispatchPermit):
        assert isinstance(events[-1], GraphRunSucceededEvent)
        assert factory.effects.dispatches == 1
        assert callbacks == []
    else:
        assert callbacks == [guard]
        assert factory.effects.dispatches == 0
        assert isinstance(
            events[-1], GraphRunPausedEvent if isinstance(decision, ApprovalWait) else GraphRunAbortedEvent
        )


def test_blocked_sink_callback_remains_owned_until_actual_release() -> None:
    observations = Observations()
    native, factory = make_native(ownership=observations)
    entered, release = Event(), Event()
    seen: list[ObservedNode] = []

    def block_sink(record: NativeControlRecord) -> None:
        observed = next(item for item in observations.active if item.node.id == record.node_id)
        assert observed.thread is current_thread()
        seen.append(observed)
        entered.set()
        assert release.wait(5)
        assert observed in observations.active

    factory.sink.before_accept = block_sink
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(lambda: list(native.run()))
        try:
            assert entered.wait(3)
            assert seen[0] in observations.active
            assert seen[0] not in observations.exited
            assert not future.done()
            assert factory.owner.status == "CONTROL_PENDING"
        finally:
            release.set()
        assert isinstance(future.result(timeout=5)[-1], GraphRunPausedEvent)
    assert observations.active == []
    assert seen[0] in observations.exited


@pytest.mark.parametrize(
    "foreign", [SystemExit("delegate-canary"), KeyboardInterrupt("delegate-canary"), BaseException("delegate-canary")]
)
@pytest.mark.parametrize("exit_fails", [False, True])
def test_observer_cannot_suppress_or_replace_foreign_delegate_exception(
    foreign: BaseException, exit_fails: bool
) -> None:
    observations = Observations(suppress=True, exit_error=SystemExit("observer-canary") if exit_fails else None)
    _, factory = make_native(ownership=observations)
    factory.effects.foreign = foreign
    with pytest.raises(type(foreign)) as caught:
        list(bound_guard(factory).run())
    assert caught.value is foreign
    assert observations.active == []
    assert observations.exited[0].exception is foreign
    assert factory.sink.records == []
    assert factory.owner.status == ("UNKNOWN_NONRESUMABLE" if exit_fails else "OPEN")
    if exit_fails:
        assert "canary" not in str(factory.runtime.graph_execution.error)


@pytest.mark.parametrize("stage", ["factory", "enter", "exit"])
@pytest.mark.parametrize("error", [RuntimeError("observer-canary"), SystemExit("observer-canary")])
def test_observer_failure_is_private_sticky_unknown_and_aborts(stage: str, error: BaseException) -> None:
    observations = Observations()
    setattr(observations, f"{stage}_error", error)
    _, factory = make_native(decision=permit(), ownership=observations)
    events = list(bound_guard(factory).run())
    assert factory.owner.status == "UNKNOWN_NONRESUMABLE"
    assert not factory.owner.dispatch_admissible
    assert factory.runtime.graph_execution.aborted
    assert "canary" not in str(factory.runtime.graph_execution.error)
    assert factory.owner.reason_code == "native_control_observation_failed"
    assert factory.sink.records == []
    if stage != "exit":
        assert events == []
        assert factory.effects.dispatches == 0
    else:
        assert factory.effects.dispatches == 1
    assert observations.active == []
    # A later fixed diagnostic must never reopen or overwrite the first failure.
    unbound = factory.create_node(NodeConfigDictAdapter.validate_python(basic()["nodes"][1]))
    assert list(unbound.run()) == []
    assert factory.owner.reason_code == "native_control_observation_failed"


def test_observer_exit_failure_after_emitted_pause_never_leaves_resumable_owner() -> None:
    observations = Observations(exit_error=RuntimeError("observer-canary"))
    _, factory = make_native(ownership=observations)
    stream = bound_guard(factory).run()
    assert isinstance(next(stream), NodeRunStartedEvent)
    assert isinstance(next(stream), NodeRunPauseRequestedEvent)
    assert factory.owner.status == "WAIT_RECORDED"
    assert len(observations.active) == 1
    stream.close()
    assert observations.active == []
    assert factory.owner.status == "UNKNOWN_NONRESUMABLE"
    assert factory.runtime.graph_execution.aborted
    assert "canary" not in str(factory.runtime.graph_execution.error)


@pytest.mark.parametrize("exit_fails", [False, True])
def test_observed_ordinary_native_failure_remains_failed_and_never_waits(exit_fails: bool) -> None:
    observations = Observations(exit_error=RuntimeError("observer-canary") if exit_fails else None)
    _, factory = make_native(decision=permit(), config=basic(template="business-failure"), ownership=observations)
    events = list(bound_guard(factory).run())
    assert type(events[-1]).__name__ == "NodeRunFailedEvent"
    assert factory.owner.status == ("UNKNOWN_NONRESUMABLE" if exit_fails else "OPEN")
    assert factory.sink.records == []
    assert observations.active == []
    assert observations.exited[0].exception is None
    if exit_fails:
        assert factory.runtime.graph_execution.aborted
        assert "canary" not in str(factory.runtime.graph_execution.error)


def observed_iteration_config() -> RawGraphConfig:
    return {
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


def test_actual_restored_iteration_observes_resume_and_child_runtime_instances() -> None:
    config = observed_iteration_config()
    first_observations = Observations()
    native, first = make_native(config=config, ownership=first_observations)
    assert isinstance(list(native.run())[-1], GraphRunPausedEvent)
    assert first_observations.active == []
    restored = RuntimeState.from_snapshot(native.runtime_state.dumps())
    observations = Observations()
    resumed, second = make_native(config=config, runtime=restored, decision=permit(), ownership=observations)
    assert isinstance(list(resumed.run())[-1], GraphRunSucceededEvent)
    assert resumed.runtime_state.outputs == {"items": ["a!", "b!"]}
    resumes = [item for item in observations.entered if item.phase == "resume_container"]
    assert resumes
    assert all(item.node is resumed.graph.nodes["container"] for item in resumes)
    assert all(item.runtime is restored for item in resumes)
    assert all(item.thread is not current_thread() for item in resumes)
    children = [item for item in observations.entered if item.node.id == "guard"]
    assert len(children) == 2
    assert all(any(item.runtime is runtime for runtime in second.children) for item in children)
    assert len({item.execution_id for item in children}) == 2
    assert second.owner.ref is first.owner.ref
    assert observations.active == []
    assert sorted(map(id, observations.entered)) == sorted(map(id, observations.exited))


def test_resume_container_is_lazy_and_owned_through_blocked_exit_callback() -> None:
    observations = Observations()
    _, factory = make_native(config=observed_iteration_config(), ownership=observations)
    container = bound_guard(factory)
    events = list(container.run())
    frame = next(event for event in events if isinstance(event, IterationFrameRequest))
    started_at = next(event.start_at for event in events if isinstance(event, NodeRunStartedEvent))
    entered, release = Event(), Event()
    blocked: list[ObservedNode] = []

    def block_exit(observed: ObservedNode) -> None:
        if observed.phase == "resume_container":
            assert observed.thread is current_thread()
            blocked.append(observed)
            entered.set()
            assert release.wait(5)
            assert observed in observations.active

    observations.before_exit = block_exit
    stream = container.resume_container(result=frame, started_at=started_at)
    assert len(observations.entered) == 1
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(lambda: list(stream))
        try:
            assert entered.wait(3)
            assert blocked[0].node is container
            assert blocked[0].runtime is factory.runtime
            assert blocked[0].execution_id == "native-observed-execution"
            assert blocked[0] in observations.active
            assert blocked[0] not in observations.exited
            assert not future.done()
        finally:
            release.set()
        assert any(event is frame for event in future.result(timeout=5))
    assert observations.active == []
    assert blocked[0] in observations.exited


@pytest.mark.parametrize("stage", ["enter", "exit"])
def test_resume_container_observer_failure_aborts_without_resumable_acceptance(stage: str) -> None:
    observations = Observations()
    _, factory = make_native(config=observed_iteration_config(), ownership=observations)
    container = bound_guard(factory)
    initial = list(container.run())
    frame = next(event for event in initial if isinstance(event, IterationFrameRequest))
    started_at = next(event.start_at for event in initial if isinstance(event, NodeRunStartedEvent))
    setattr(observations, f"{stage}_error", KeyboardInterrupt("observer-resume-canary"))
    events = list(container.resume_container(result=frame, started_at=started_at))
    if stage == "enter":
        assert events == []
    else:
        assert any(event is frame for event in events)
    assert factory.owner.status == "UNKNOWN_NONRESUMABLE"
    assert factory.runtime.graph_execution.aborted
    assert factory.sink.records == []
    assert "canary" not in str(factory.runtime.graph_execution.error)
    assert observations.active == []


def test_unmarked_native_node_keeps_ordinary_behavior_without_observation() -> None:
    observations = Observations()
    _, original = make_native(decision=permit(), ownership=observations)
    factory = Factory(original.config, original.runtime, original.owner, original.sink, original.effects, marked=False)
    direct = bound_guard(factory)
    assert type(direct) is TemplateTransformNode
    assert type(list(direct.run())[-1]).__name__ == "NodeRunSucceededEvent"
    assert original.effects.dispatches == 1
    assert original.owner.status == "OPEN"
    assert observations.entered == []


def test_blocked_native_renderer_callback_remains_owned_until_actual_release(monkeypatch: pytest.MonkeyPatch) -> None:
    observations = Observations()
    native, factory = make_native(decision=permit(), ownership=observations)
    original_render = factory.effects.render
    entered, release = Event(), Event()
    seen: list[ObservedNode] = []

    def block_render(template: str, variables: Mapping[str, object], node_id: str) -> str:
        observed = next(item for item in observations.active if item.node.id == node_id)
        assert observed.thread is current_thread()
        assert observed.node is native.graph.nodes[node_id]
        assert observed.runtime is factory.runtime
        seen.append(observed)
        entered.set()
        assert release.wait(5)
        assert observed in observations.active
        return original_render(template, variables, node_id)

    # Only the existing synthetic I/O collaborator is instrumented. The actual
    # Graphon node, run delegate and worker scheduling remain unchanged.
    monkeypatch.setattr(factory.effects, "render", block_render)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(lambda: list(native.run()))
        try:
            assert entered.wait(3)
            assert seen[0] in observations.active
            assert seen[0] not in observations.exited
            assert not future.done()
            assert factory.effects.dispatches == 0
        finally:
            release.set()
        assert isinstance(future.result(timeout=5)[-1], GraphRunSucceededEvent)
    assert factory.effects.dispatches == 1
    assert observations.active == []
    assert seen[0] in observations.exited
