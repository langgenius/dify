"""Pure diagnostic copies of real Graphon 0.7 events, never execution authority."""

from __future__ import annotations

import importlib
import importlib.util
import json
from copy import deepcopy
from datetime import UTC, datetime
from importlib.metadata import version
from types import SimpleNamespace
from typing import cast, override

import pytest

from graphon.engine.layer import ExecutionLimitsLayer, Layer
from graphon.engine_events import (
    EngineEvent,
    GraphEdgeSkippedEvent,
    GraphEdgeTakenEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunPauseRequestedEvent,
    NodeRunReasoningChunkEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.entities.pause_reason import HitlRequired, SchedulingPause
from graphon.entities.workflow_start_reason import WorkflowStartReason
from graphon.enums import WorkflowNodeExecutionMetadataKey as Metadata
from graphon.enums import WorkflowNodeExecutionStatus as Status
from graphon.node_events.base import NodeRunResult
from graphon.variables.segments import ArrayFileSegment
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from runtime_contracts.builder.native.runtime_contracts import (
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.http_binding import (
    build_native_http_profile,
    describe_http_resource,
)

SENTINEL = "PRIVATE_LITERAL_SENTINEL_7c91"
NOW = datetime(2026, 10, 16, tzinfo=UTC)


def owner():
    module = "services.dify_builder.native_testing.observation_privacy"
    assert importlib.util.find_spec(module) is not None, "pure native observation policy is missing"
    return importlib.import_module(module).NativeHttpObservationPolicy


def context():
    raw = {
        "type": "http-request",
        "version": "1",
        "title": SENTINEL,
        "method": "post",
        "url": f"https://example.com/{SENTINEL}?key={SENTINEL}",
        "authorization": {"type": "no-auth"},
        "headers": "",
        "params": f"key:{SENTINEL}",
        "body": {
            "type": "json",
            "data": [{"type": "text", "key": "", "value": json.dumps({SENTINEL: SENTINEL})}],
        },
    }
    graph = {
        "nodes": [
            {
                "id": "start",
                "data": {"type": "start", "variables": [], "title": SENTINEL},
            },
            {"id": "http", "data": raw},
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "outputs": [{"variable": SENTINEL, "value_selector": ["http", "body"]}],
                },
            },
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "http", "sourceHandle": "source"},
            {"id": "e2", "source": "http", "target": "end", "sourceHandle": "source"},
        ],
        "viewport": {"x": 1, "y": 2, "zoom": 1},
    }
    return ResolvedNativeTestContext(
        ref={
            "request_id": "request",
            "invocation_id": "invocation",
            "context_digest": "a" * 64,
        },
        tenant_id="tenant",
        actor_id="actor",
        app_id="app",
        workflow_id="workflow",
        graph=graph,
        inputs={SENTINEL: SENTINEL},
        graph_revision="b" * 64,
        input_revision=canonical_digest({SENTINEL: SENTINEL}),
        resource_manifest=(
            describe_http_resource(
                node_id="http",
                raw=raw,
                workflow_revision="b" * 64,
                app_id="app",
                workflow_id="workflow",
            ),
        ),
        generation=0,
        root_native_run_id="run",
        native_run_id="run",
        parent_invocation_id=None,
        call_depth=0,
        budget_ref="request",
        cancellation_ref="request",
        execution_mode="native",
    )


@pytest.fixture
def policy():
    assert version("graphon") == "0.8.0"
    return owner().qualify(context=context(), profile=build_native_http_profile())


def graph_data(ctx: ResolvedNativeTestContext) -> dict:
    """Mutable JSON fixture boundary; production revalidates before projection."""
    return cast(dict, ctx.graph)


def result():
    return NodeRunResult(
        status=Status.FAILED,
        inputs={SENTINEL: [True, None, 3, 1.5, SENTINEL]},
        process_data={
            "request": SENTINEL,
            "__dify_retry_history": [
                {
                    "retry_index": 1,
                    "inputs": {SENTINEL: SENTINEL},
                    "process_data": {"request": SENTINEL},
                    "outputs": {"body": SENTINEL},
                    "error": SENTINEL,
                    "elapsed_time": 0.25,
                    "execution_metadata": {SENTINEL: SENTINEL},
                    "created_at": 1,
                    "finished_at": 2,
                }
            ],
        },
        outputs={
            "body": SENTINEL,
            "headers": {SENTINEL: SENTINEL},
            "status_code": 503,
            "files": ArrayFileSegment(value=[]),
        },
        metadata={
            Metadata.ITERATION_ID: "iteration-occurrence",
            Metadata.ITERATION_INDEX: 2,
            Metadata.TOTAL_TOKENS: 4,
            Metadata.TOOL_INFO: {SENTINEL: SENTINEL},
        },
        error=SENTINEL,
        error_type="HTTPResponseCodeError",
        retry_index=1,
    )


def test_qualification_and_graph_copy_do_not_modify_protected_context():
    policy = owner().qualify(context=context(), profile=build_native_http_profile())
    original = context()
    before = original.model_dump(mode="json")
    view = policy.graph(original.graph)
    assert SENTINEL not in json.dumps(view)
    assert [node["id"] for node in view["nodes"]] == ["start", "http", "end"]
    assert [(edge["source"], edge["target"]) for edge in view["edges"]] == [
        ("start", "http"),
        ("http", "end"),
    ]
    assert view["nodes"][1]["data"]["type"] == "http-request"
    assert "redacted" in json.dumps(view)
    assert original.model_dump(mode="json") == before
    view["nodes"][1]["data"]["type"] = "changed"
    assert policy.graph(original.graph)["nodes"][1]["data"]["type"] == "http-request"


def test_real_result_echo_and_retry_history_are_redacted_with_independent_observers(
    policy,
):
    original = NodeRunFailedEvent(
        id="execution",
        node_id="http",
        node_type="http-request",
        container_id="iteration-occurrence",
        node_run_result=result(),
        error=SENTINEL,
        start_at=NOW,
        finished_at=NOW,
    )
    before = original.model_dump(mode="json")
    left, right = policy.event(original), policy.event(original)
    assert type(left) is NodeRunFailedEvent
    assert SENTINEL not in left.model_dump_json()
    assert left.id == "execution"
    assert left.node_id == "http"
    assert left.container_id == "iteration-occurrence"
    assert left.start_at == NOW
    assert left.finished_at == NOW
    assert left.node_run_result.status is Status.FAILED
    assert left.node_run_result.error_type == "HTTPResponseCodeError"
    assert left.node_run_result.retry_index == 1
    assert left.node_run_result.metadata[Metadata.ITERATION_INDEX] == 2
    assert left.node_run_result.metadata[Metadata.TOTAL_TOKENS] == 4
    attempt = left.node_run_result.process_data["__dify_retry_history"][0]
    assert (
        attempt["retry_index"],
        attempt["elapsed_time"],
        attempt["created_at"],
        attempt["finished_at"],
    ) == (1, 0.25, 1, 2)
    cast(dict, left.node_run_result.inputs)["redacted"] = False
    attempt["inputs"]["redacted"] = False
    assert right.node_run_result.inputs["redacted"] is True
    assert right.node_run_result.process_data["__dify_retry_history"][0]["inputs"]["redacted"] is True
    assert original.model_dump(mode="json") == before
    assert original.node_run_result.outputs["body"] == SENTINEL


@pytest.mark.parametrize(
    "event",
    [
        GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION),
        GraphRunSucceededEvent(outputs={SENTINEL: SENTINEL}),
        GraphRunPartialSucceededEvent(exceptions_count=2, outputs={SENTINEL: SENTINEL}),
        GraphRunFailedEvent(error=SENTINEL, exceptions_count=2),
        GraphRunAbortedEvent(reason=SENTINEL, outputs={SENTINEL: SENTINEL}),
        GraphRunPausedEvent(reasons=[SchedulingPause(message=SENTINEL)], outputs={SENTINEL: SENTINEL}),
        GraphEdgeTakenEvent(
            frame_id="root",
            edge_id="e1",
            source_node_id="start",
            target_node_id="http",
            source_handle="source",
        ),
        GraphEdgeSkippedEvent(
            frame_id="root",
            edge_id="e2",
            source_node_id="http",
            target_node_id="end",
            source_handle="source",
        ),
    ],
)
def test_graph_events_retain_types_counts_and_safe_correlations(policy, event):
    before = event.model_dump(mode="json")
    projected = policy.event(event)
    assert type(projected) is type(event)
    assert projected is not event
    assert SENTINEL not in projected.model_dump_json()
    if hasattr(event, "exceptions_count"):
        assert projected.exceptions_count == event.exceptions_count
    if isinstance(event, GraphRunStartedEvent):
        assert projected.reason is WorkflowStartReason.RESUMPTION
    if isinstance(event, GraphEdgeTakenEvent | GraphEdgeSkippedEvent):
        assert projected.edge_id == event.edge_id
        assert projected.source_node_id == event.source_node_id
    assert event.model_dump(mode="json") == before


@pytest.mark.parametrize(
    ("cls", "extra"),
    [
        (
            NodeRunStartedEvent,
            {"node_title": SENTINEL, "start_at": NOW, "extras": {SENTINEL: SENTINEL}},
        ),
        (NodeRunSucceededEvent, {"start_at": NOW, "finished_at": NOW}),
        (NodeRunExceptionEvent, {"start_at": NOW, "error": SENTINEL}),
        (
            NodeRunRetryEvent,
            {
                "node_title": SENTINEL,
                "start_at": NOW,
                "error": SENTINEL,
                "retry_index": 2,
            },
        ),
        (
            NodeRunStreamChunkEvent,
            {"selector": ["http", SENTINEL], "chunk": SENTINEL, "is_final": True},
        ),
        (
            NodeRunReasoningChunkEvent,
            {"selector": ["http", SENTINEL], "chunk": SENTINEL},
        ),
        (NodeRunPauseRequestedEvent, {"reason": SchedulingPause(message=SENTINEL)}),
    ],
)
def test_node_event_content_never_survives_projection(policy, cls, extra):
    event = cls(
        id="execution",
        node_id="http",
        node_type="http-request",
        node_run_result=result(),
        **extra,
    )
    projected = policy.event(event)
    assert type(projected) is cls
    assert SENTINEL not in projected.model_dump_json()
    assert projected.id == "execution"
    assert projected.node_type == "http-request"
    if "retry_index" in extra:
        assert projected.retry_index == 2
    if "is_final" in extra:
        assert projected.is_final is True


def container_context(kind):
    ctx = context()
    graph = deepcopy(graph_data(ctx))
    body = {"id": "body-start", "data": {"type": f"{kind}-start", "title": SENTINEL}}
    if kind == "iteration":
        data = {
            "type": kind,
            "start_node_id": "body-start",
            "iterator_selector": ["start", "items"],
            "output_selector": ["http", "body"],
        }
        body["data"]["iteration_id"] = "container"
    else:
        data = {
            "type": kind,
            "start_node_id": "body-start",
            "loop_count": 2,
            "break_conditions": [],
            "logical_operator": "and",
        }
        body["data"]["loop_id"] = "container"
        graph["nodes"].append({"id": "body-end", "data": {"type": "loop-end", "loop_id": "container"}})
    graph["nodes"].extend([{"id": "container", "data": data}, body])
    return ctx.model_copy(update={"graph": graph})


@pytest.mark.parametrize(
    ("kind", "classes"),
    [
        (
            "iteration",
            (
                NodeRunIterationStartedEvent,
                NodeRunIterationNextEvent,
                NodeRunIterationSucceededEvent,
                NodeRunIterationFailedEvent,
            ),
        ),
        (
            "loop",
            (
                NodeRunLoopStartedEvent,
                NodeRunLoopNextEvent,
                NodeRunLoopSucceededEvent,
                NodeRunLoopFailedEvent,
            ),
        ),
    ],
)
def test_real_container_events_keep_iteration_steps_and_independent_content(kind, classes):
    policy = owner().qualify(context=container_context(kind), profile=build_native_http_profile())
    for cls in classes:
        fields = {
            "id": "container-execution",
            "node_id": "container",
            "node_type": kind,
            "node_title": SENTINEL,
        }
        if "start_at" in cls.model_fields:
            fields.update(start_at=NOW, inputs={SENTINEL: SENTINEL}, metadata={SENTINEL: SENTINEL})
        if "outputs" in cls.model_fields:
            fields.update(outputs={SENTINEL: SENTINEL}, steps=2)
        if "index" in cls.model_fields:
            fields.update(index=1, **{f"pre_{kind}_output": {SENTINEL: SENTINEL}})
        if "error" in cls.model_fields:
            fields["error"] = SENTINEL
        original = cls(**fields)
        projected = policy.event(original)
        assert type(projected) is cls
        assert projected.id == "container-execution"
        assert SENTINEL not in projected.model_dump_json()
        if "steps" in fields:
            assert projected.steps == 2
        if "index" in fields:
            assert projected.index == 1


def test_values_preserve_typed_shape_only_and_none(policy):
    original = {SENTINEL: [True, None, 2, 1.25, SENTINEL]}
    projected = policy.values(original)
    assert projected["redacted"] is True
    assert projected["shape"]["type"] == "object"
    assert projected["shape"]["fields"] == 1
    assert projected["shape"]["values"][0]["type"] == "array"
    assert [item["type"] for item in projected["shape"]["values"][0]["items"]] == [
        "boolean",
        "null",
        "integer",
        "number",
        "string",
    ]
    assert SENTINEL not in json.dumps(projected)
    assert original == {SENTINEL: [True, None, 2, 1.25, SENTINEL]}
    assert policy.values(None) is None


class Hostile:
    def __str__(self):
        raise AssertionError("unclassified str was invoked")

    def __repr__(self):
        raise AssertionError("unclassified repr was invoked")


@pytest.mark.parametrize("value", [Hostile(), float("nan"), float("inf"), {1: SENTINEL}, b"private"])
def test_unsupported_values_refuse_without_rendering_contents(policy, value):
    with pytest.raises(BuilderExecutionPolicyError) as caught:
        policy.values({"payload": value})
    assert str(caught.value) == "Builder execution policy refused: native_observation_unsupported"
    assert caught.value.__cause__ is None


def test_deep_or_cyclic_values_refuse_safely(policy):
    cyclic = {}
    cyclic["self"] = cyclic
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        policy.values(cyclic)


def test_errors_never_render_exceptions_and_only_keep_finite_known_kinds(policy):
    class HostileError(Exception):
        @override
        def __str__(self):
            raise AssertionError("exception content was rendered")

    assert policy.error(HostileError(SENTINEL)) == "native_execution_error"
    assert policy.error(SENTINEL) == "native_execution_error"
    assert policy.error("HTTPResponseCodeError") == "HTTPResponseCodeError"
    assert policy.error(None) is None


@pytest.mark.parametrize(
    "mutation",
    [
        "manifest",
        "node",
        "revision",
        "owner",
        "duplicate",
        "mock",
        "child",
        "type",
        "file",
        "features",
    ],
)
def test_invalid_contexts_and_descriptor_drift_refuse_without_content(mutation):
    ctx = context()
    if mutation == "manifest":
        cast(dict, ctx.resource_manifest[0])["policy"]["cost_units"] = 99
    elif mutation == "node":
        graph_data(ctx)["nodes"][1]["data"]["url"] += "/changed"
    elif mutation == "revision":
        ctx = ctx.model_copy(update={"graph_revision": "c" * 64})
    elif mutation == "owner":
        ctx = ctx.model_copy(update={"app_id": "other"})
    elif mutation == "duplicate":
        graph_data(ctx)["nodes"].append(deepcopy(graph_data(ctx)["nodes"][1]))
    elif mutation == "mock":
        ctx = ctx.model_copy(update={"execution_mode": "mock"})
    elif mutation == "child":
        ctx = ctx.model_copy(update={"parent_invocation_id": "parent", "call_depth": 1})
    elif mutation == "type":
        graph_data(ctx)["nodes"][0]["data"]["type"] = "agent"
    elif mutation == "file":
        graph_data(ctx)["nodes"][0]["data"]["variables"] = [{"variable": "f", "label": "f", "type": "file"}]
    else:
        graph_data(ctx)["features"] = {"text_to_speech": {"enabled": True}}
    with pytest.raises(BuilderExecutionPolicyError) as caught:
        owner().qualify(context=ctx, profile=build_native_http_profile())
    assert SENTINEL not in str(caught.value)


def test_actual_server_profile_is_required_and_drift_refuses():
    profile = build_native_http_profile()
    profile.limits["calls"] = 99
    with pytest.raises(BuilderExecutionPolicyError):
        owner().qualify(context=context(), profile=profile)
    with pytest.raises(TypeError):
        owner().qualify(context=context())


def test_policy_snapshots_context_against_later_mutation():
    ctx = context()
    pinned = owner().qualify(context=ctx, profile=build_native_http_profile())
    graph_data(ctx)["nodes"][1]["data"]["url"] += "/changed"
    with pytest.raises(BuilderExecutionPolicyError):
        pinned.graph(ctx.graph)


def test_unknown_event_subclass_or_unowned_identity_refuses(policy):
    class NewEvent(EngineEvent):
        private: str = SENTINEL

    for event in (
        NewEvent(),
        EngineEvent(),
        NodeRunSucceededEvent(id="x", node_id="foreign", node_type="http-request", start_at=NOW),
    ):
        with pytest.raises(BuilderExecutionPolicyError) as caught:
            policy.event(event)
        assert SENTINEL not in str(caught.value)
    event = NodeRunSucceededEvent(id="x", node_id="http", node_type="http-request", start_at=NOW)
    event = event.model_copy(update={"node_type": "agent"})
    with pytest.raises(BuilderExecutionPolicyError):
        policy.event(event)


def test_human_input_is_not_reported_as_a_qualified_native_wait(policy):
    with pytest.raises(BuilderExecutionPolicyError):
        policy.event(
            GraphRunPausedEvent(reasons=[HitlRequired(session_id=SENTINEL, node_id="http", node_title=SENTINEL)])
        )


def test_only_explicit_native_execution_limits_layer_is_structurally_qualified(policy):
    policy.require_layers([])
    policy.require_layers([ExecutionLimitsLayer(max_steps=10, max_time=10)])

    class CustomLimits(ExecutionLimitsLayer):  # pyrefly: ignore[invalid-inheritance] - runtime subclass attack witness
        pass

    for layer in (
        Layer(),
        CustomLimits(max_steps=10, max_time=10),
        Hostile(),
    ):
        with pytest.raises(BuilderExecutionPolicyError) as caught:
            policy.require_layers([layer])
        assert SENTINEL not in str(caught.value)


def test_native_edge_identity_is_distinct_from_editor_identity_and_missing_editor_ids():
    ctx = context()
    for edge in graph_data(ctx)["edges"]:
        edge.pop("id")
    policy = owner().qualify(context=ctx, profile=build_native_http_profile())
    view = policy.graph(ctx.graph)
    assert [(edge["source"], edge["target"]) for edge in view["edges"]] == [
        ("start", "http"),
        ("http", "end"),
    ]
    # Graphon owns runtime edge IDs independently of editor IDs. Endpoint
    # correlation is structural evidence, never a dispatch/binding receipt.
    event = GraphEdgeTakenEvent(
        frame_id="root",
        edge_id="edge_0",
        source_node_id="start",
        target_node_id="http",
        source_handle="source",
    )
    assert policy.event(event).edge_id == "edge_0"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("node_id", []),
        ("node_run_result", Hostile()),
        ("start_at", Hostile()),
        ("node_type", Hostile()),
    ],
)
def test_unchecked_native_event_shapes_refuse_with_fixed_reason(policy, field, value):
    event = NodeRunSucceededEvent(id="execution", node_id="http", node_type="http-request", start_at=NOW)
    malformed = event.model_copy(update={field: value})
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        policy.event(malformed)


def test_original_runtime_outputs_and_variable_selection_survive_diagnostic_mutation(
    policy,
):
    from graphon.runtime import RuntimeState, VariablePool

    pool = VariablePool()
    pool.add(["http", "body"], SENTINEL)
    runtime = RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=0.0)
    runtime.set_output("answer", {"body": SENTINEL})
    native = NodeRunSucceededEvent(
        id="execution",
        node_id="http",
        node_type="http-request",
        start_at=NOW,
        node_run_result=NodeRunResult(status=Status.SUCCEEDED, outputs=runtime.outputs),
    )
    first = policy.event(native)
    second = policy.event(native)
    first.node_run_result.outputs["redacted"] = False
    assert runtime.outputs == {"answer": {"body": SENTINEL}}
    selected = pool.get(["http", "body"])
    assert selected is not None
    assert selected.value == SENTINEL
    assert native.node_run_result.outputs["answer"]["body"] == SENTINEL
    assert second.node_run_result.outputs["redacted"] is True


def test_unsupported_value_after_display_cutoff_is_still_refused(policy):
    payload = [SENTINEL] * 8 + [Hostile()]
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        policy.values({"payload": payload})


def test_large_private_content_projects_to_bounded_shape(policy):
    view = policy.values({SENTINEL: SENTINEL * 100_000})
    assert len(json.dumps(view)) < 200
    assert SENTINEL not in json.dumps(view)


def test_missing_nonempty_file_or_unknown_metadata_objects_do_not_pass(policy):
    native = NodeRunSucceededEvent(id="execution", node_id="http", node_type="http-request", start_at=NOW)
    for poisoned in (
        NodeRunResult().model_copy(update={"outputs": {"files": ArrayFileSegment.model_construct(value=[Hostile()])}}),
        NodeRunResult().model_copy(update={"metadata": {Metadata.TOOL_INFO: Hostile()}}),
    ):
        with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
            policy.event(native.model_copy(update={"node_run_result": poisoned}))


@pytest.mark.parametrize(
    "field",
    ["inputs", "outputs", "process_data", "error", "error_type", "edge_source_handle"],
)
def test_unchecked_result_field_types_refuse_before_native_validation(policy, field):
    original = NodeRunSucceededEvent(id="execution", node_id="http", node_type="http-request", start_at=NOW)
    bad = NodeRunResult().model_copy(update={field: None})
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        policy.event(original.model_copy(update={"node_run_result": bad}))


@pytest.mark.parametrize(
    ("event", "change"),
    [
        (
            NodeRunStartedEvent(
                id="execution",
                node_id="http",
                node_type="http-request",
                node_title="HTTP",
                start_at=NOW,
            ),
            {"node_title": Hostile()},
        ),
        (
            NodeRunStreamChunkEvent(
                id="execution",
                node_id="http",
                node_type="http-request",
                selector=["http", "body"],
                chunk="text",
            ),
            {"chunk": {SENTINEL: SENTINEL}},
        ),
        (
            NodeRunSucceededEvent(id="execution", node_id="http", node_type="http-request", start_at=NOW),
            {"start_at": None},
        ),
    ],
)
def test_unchecked_event_scalar_types_cannot_be_hidden_as_valid_evidence(policy, event, change):
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        policy.event(event.model_copy(update=change))


@pytest.mark.parametrize("target", ["profile", "context"])
def test_unchecked_context_and_profile_refuse_without_serialization_warnings(target, recwarn):
    ctx, profile = context(), build_native_http_profile()
    if target == "profile":
        profile = profile.model_copy(update={"limits": {"calls": SENTINEL}})
    else:
        ctx = ctx.model_copy(update={"generation": SENTINEL})
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        owner().qualify(context=ctx, profile=profile)
    assert not recwarn.list, "qualification serialized protected unchecked fields before refusing"


def test_qualification_never_renders_unknown_context_objects():
    calls = []

    class Unclassified:
        def __repr__(self):
            calls.append("repr")
            return SENTINEL

        def __str__(self):
            calls.append("str")
            return SENTINEL

    ctx = context().model_copy(update={"actor_id": Unclassified()})
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        owner().qualify(context=ctx, profile=build_native_http_profile())
    assert calls == []


@pytest.mark.parametrize("value", [16.0, True])
def test_unchecked_profile_limits_require_actual_strict_integer_counters(value):
    profile = build_native_http_profile().model_copy(
        update={"limits": {"calls": value, "dispatches": 16, "cost_units": 16}}
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        owner().qualify(context=context(), profile=profile)


@pytest.mark.parametrize(
    ("kind", "node_id", "node_type"),
    [
        ("iteration", "body-start", "iteration-start"),
        ("loop", "body-start", "loop-start"),
        ("loop", "body-end", "loop-end"),
    ],
)
def test_container_internal_node_identity_is_preserved(kind, node_id, node_type):
    policy = owner().qualify(context=container_context(kind), profile=build_native_http_profile())
    event = NodeRunStartedEvent(
        id="internal-execution",
        node_id=node_id,
        node_type=node_type,
        node_title=SENTINEL,
        start_at=NOW,
    )
    projected = policy.event(event)
    assert projected.node_id == node_id
    assert projected.id == "internal-execution"
    assert projected.node_type == node_type
    assert SENTINEL not in projected.model_dump_json()


def fix1_metadata():
    return {
        "iteration_id": "iteration-occurrence",
        "loop_id": "loop-occurrence",
        "parallel_id": "parallel-occurrence",
        "parent_parallel_id": "parent-parallel",
        "parallel_mode_run_id": "parallel-mode",
        "iteration_index": 2,
        "loop_index": 1,
        "total_tokens": 7,
        "tool_info": {SENTINEL: SENTINEL},
        SENTINEL: SENTINEL,
    }


def fix1_retry_event(metadata):
    from core.app.workflow.retry_history import WorkflowNodeRetryAttempt

    attempt = WorkflowNodeRetryAttempt(
        retry_index=1,
        inputs={SENTINEL: SENTINEL},
        process_data={"request": SENTINEL},
        outputs={"body": SENTINEL},
        error=SENTINEL,
        elapsed_time=0.25,
        execution_metadata=metadata,
        created_at=1,
        finished_at=2,
    )
    native_result = NodeRunResult(
        status=Status.FAILED,
        process_data={
            "request": SENTINEL,
            "__dify_retry_history": [attempt.model_dump(mode="json")],
        },
    )
    return NodeRunRetryEvent(
        id="retry-execution",
        node_id="http",
        node_type="http-request",
        node_title=SENTINEL,
        start_at=NOW,
        error=SENTINEL,
        retry_index=1,
        node_run_result=native_result,
    )


def test_fix1_retry_metadata_retains_native_correlation_counts_and_secrecy(policy):
    original = fix1_retry_event(fix1_metadata())
    before = original.model_dump(mode="json")
    left, right = policy.event(original), policy.event(original)
    left_metadata = left.node_run_result.process_data["__dify_retry_history"][0]["execution_metadata"]
    right_metadata = right.node_run_result.process_data["__dify_retry_history"][0]["execution_metadata"]
    assert left_metadata == {
        "iteration_id": "iteration-occurrence",
        "loop_id": "loop-occurrence",
        "parallel_id": "parallel-occurrence",
        "parent_parallel_id": "parent-parallel",
        "parallel_mode_run_id": "parallel-mode",
        "iteration_index": 2,
        "loop_index": 1,
        "total_tokens": 7,
    }
    assert SENTINEL not in left.model_dump_json()
    left_metadata["iteration_id"] = "changed"
    left_metadata["total_tokens"] = 99
    assert right_metadata["iteration_id"] == "iteration-occurrence"
    assert right_metadata["total_tokens"] == 7
    assert original.model_dump(mode="json") == before


@pytest.mark.parametrize(
    ("kind", "cls"),
    [
        ("iteration", NodeRunIterationStartedEvent),
        ("iteration", NodeRunIterationSucceededEvent),
        ("iteration", NodeRunIterationFailedEvent),
        ("loop", NodeRunLoopStartedEvent),
        ("loop", NodeRunLoopSucceededEvent),
        ("loop", NodeRunLoopFailedEvent),
    ],
)
def test_fix1_container_metadata_retains_native_length_correlation_and_independence(kind, cls):
    policy = owner().qualify(context=container_context(kind), profile=build_native_http_profile())
    metadata = fix1_metadata()
    metadata[f"{kind}_length"] = 3
    fields = {
        "id": "container-execution",
        "node_id": "container",
        "node_type": kind,
        "node_title": SENTINEL,
        "start_at": NOW,
        "metadata": metadata,
    }
    if "error" in cls.model_fields:
        fields["error"] = SENTINEL
    original = cls(**fields)
    before = original.model_dump(mode="json")
    left, right = policy.event(original), policy.event(original)
    assert left.metadata == {
        "iteration_id": "iteration-occurrence",
        "loop_id": "loop-occurrence",
        "parallel_id": "parallel-occurrence",
        "parent_parallel_id": "parent-parallel",
        "parallel_mode_run_id": "parallel-mode",
        "iteration_index": 2,
        "loop_index": 1,
        "total_tokens": 7,
        f"{kind}_length": 3,
    }
    assert SENTINEL not in left.model_dump_json()
    left.metadata[f"{kind}_length"] = 99
    left.metadata["loop_id"] = "changed"
    assert right.metadata[f"{kind}_length"] == 3
    assert right.metadata["loop_id"] == "loop-occurrence"
    assert original.model_dump(mode="json") == before


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("total_tokens", True),
        ("total_tokens", 1.5),
        ("iteration_index", -1),
        ("loop_index", 2**63),
        ("iteration_id", ""),
        ("loop_id", None),
        ("parallel_id", "x" * 513),
        ("parent_parallel_id", 3),
        ("parallel_mode_run_id", None),
    ],
)
def test_fix1_retry_safe_metadata_fields_reject_malformed_types_and_bounds(policy, key, value):
    metadata = fix1_metadata()
    metadata[key] = value
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        policy.event(fix1_retry_event(metadata))


@pytest.mark.parametrize("kind", ["iteration", "loop"])
@pytest.mark.parametrize("value", [True, SENTINEL, -1, 2**63, 1.5])
def test_fix1_container_lengths_reject_malformed_counters(kind, value):
    policy = owner().qualify(context=container_context(kind), profile=build_native_http_profile())
    cls = NodeRunIterationStartedEvent if kind == "iteration" else NodeRunLoopStartedEvent
    metadata = fix1_metadata()
    metadata[f"{kind}_length"] = value
    event = cls(
        id="container-execution",
        node_id="container",
        node_type=kind,
        node_title=SENTINEL,
        start_at=NOW,
        metadata=metadata,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        policy.event(event)


@pytest.mark.parametrize(("key", "value"), [("iteration_id", ""), ("loop_index", True)])
def test_fix1_container_approved_metadata_uses_same_finite_validation(key, value):
    policy = owner().qualify(context=container_context("iteration"), profile=build_native_http_profile())
    metadata = fix1_metadata()
    metadata.update(iteration_length=3)
    metadata[key] = value
    event = NodeRunIterationStartedEvent(
        id="container-execution",
        node_id="container",
        node_type="iteration",
        node_title=SENTINEL,
        start_at=NOW,
        metadata=metadata,
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_observation_unsupported"):
        policy.event(event)


@pytest.mark.parametrize("value", [0, 2**63 - 1])
def test_fix1_official_iteration_length_zero_and_finite_counter_boundary(value):
    policy = owner().qualify(context=container_context("iteration"), profile=build_native_http_profile())
    event = NodeRunIterationStartedEvent(
        id="container-execution",
        node_id="container",
        node_type="iteration",
        node_title=SENTINEL,
        start_at=NOW,
        metadata={"iteration_length": value, SENTINEL: SENTINEL},
    )
    projected = policy.event(event)
    assert projected.metadata == {"iteration_length": value}
    assert SENTINEL not in projected.model_dump_json()


@pytest.mark.parametrize("kind", ["loop", "iteration"])
def test_existing_scalar_control_schemas_accept_exact_empty_http_manifest(kind):
    """Structural qualification only; native factory still owns executability."""
    ctx = container_context(kind)
    graph = deepcopy(graph_data(ctx))
    graph["nodes"] = [n for n in graph["nodes"] if n["id"] != "http"]
    next(n for n in graph["nodes"] if n["id"] == "end")["data"]["outputs"] = []
    if kind == "iteration":
        next(n for n in graph["nodes"] if n["id"] == "container")["data"]["output_selector"] = ["body-start", "index"]
    graph["edges"] = [{"source": "start", "target": "container"}, {"source": "container", "target": "end"}]
    ctx = ctx.model_copy(update={"graph": graph, "resource_manifest": ()})
    policy = owner().qualify(context=ctx, profile=build_native_http_profile())
    assert SENTINEL not in json.dumps(policy.graph(ctx.graph))
    # Empty HTTP metadata cannot excuse a broken existing container association.
    next(n for n in graph["nodes"] if n["id"] == "container")["data"]["start_node_id"] = "missing"
    with pytest.raises(BuilderExecutionPolicyError):
        owner().qualify(context=ctx, profile=build_native_http_profile())


@pytest.mark.parametrize(
    "fault",
    [
        "manifest",
        "effect_kind",
        "start_file",
        "end_file",
        "no_start",
        "duplicate",
        "edge",
        "version",
        "mock",
        "child",
        "inputs",
        "hostile",
    ],
)
def test_empty_http_manifest_keeps_schema_owner_and_privacy_refusals(fault):
    ctx = context()
    graph = deepcopy(graph_data(ctx))
    graph.pop("viewport")
    graph["nodes"] = [n for n in graph["nodes"] if n["id"] != "http"]
    graph["nodes"][-1]["data"]["outputs"] = []
    graph["edges"] = [{"source": "start", "target": "end"}]
    ctx = ctx.model_copy(update={"graph": graph, "resource_manifest": ()})
    if fault == "manifest":
        ctx = ctx.model_copy(update={"resource_manifest": context().resource_manifest})
    elif fault == "effect_kind":
        graph["nodes"][-1]["data"]["type"] = "agent"
    elif fault == "start_file":
        graph["nodes"][0]["data"]["variables"] = [{"variable": "f", "label": "f", "type": "file"}]
    elif fault == "end_file":
        graph["nodes"][-1]["data"]["outputs"] = [
            {"variable": "f", "value_selector": ["start", "f"], "value_type": "file"}
        ]
    elif fault == "no_start":
        graph["nodes"] = graph["nodes"][1:]
    elif fault == "duplicate":
        graph["nodes"].append(deepcopy(graph["nodes"][0]))
    elif fault == "edge":
        graph["edges"][0]["target"] = "missing"
    elif fault == "version":
        graph["nodes"][0]["data"]["version"] = "2"
    elif fault == "mock":
        ctx = ctx.model_copy(update={"execution_mode": "mock"})
    elif fault == "child":
        ctx = ctx.model_copy(update={"parent_invocation_id": "parent", "call_depth": 1})
    elif fault == "inputs":
        ctx = ctx.model_copy(update={"input_revision": "f" * 64})
    else:
        ctx = ctx.model_copy(update={"inputs": {"private": Hostile()}})
    with pytest.raises(BuilderExecutionPolicyError) as caught:
        owner().qualify(context=ctx, profile=build_native_http_profile())
    assert SENTINEL not in str(caught.value)


@pytest.mark.parametrize("kind", ["code", "template-transform"])
def test_code_profile_redacts_source_template_values_and_retry_history(kind):
    from services.dify_builder.native_testing.sandbox.qualification import (
        describe_code_resource,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_code_qualification import (
        qualification,
        raw_code,
    )

    q, _ = qualification()
    ctx = context()
    graph = deepcopy(ctx.graph)
    raw = (
        raw_code(code=SENTINEL)
        if kind == "code"
        else {"type": kind, "title": SENTINEL, "variables": [], "template": SENTINEL}
    )
    nodes = cast(list[dict[str, object]], graph["nodes"])
    nodes[1]["data"] = raw
    descriptor = describe_code_resource(
        qualification=q,
        node_id="http",
        raw=raw,
        workflow_revision=ctx.graph_revision,
        app_id=ctx.app_id,
        workflow_id=ctx.workflow_id,
    )
    ctx = ctx.model_copy(update={"graph": graph, "resource_manifest": (descriptor,)})
    with pytest.raises(BuilderExecutionPolicyError):
        owner().qualify(context=ctx, profile=q.profile())
    policy = owner().qualify(context=ctx, profile=q.profile(), code_qualification=q)
    assert SENTINEL not in json.dumps(policy.graph(ctx.graph))
    event = NodeRunSucceededEvent(
        id="event",
        node_id="http",
        node_type=kind,
        node_version="1",
        node_title=SENTINEL,
        node_run_result=result(),
        start_at=NOW,
    )
    assert SENTINEL not in policy.event(event).model_dump_json()
    assert SENTINEL in event.model_dump_json()
    cast(SimpleNamespace, q.owner).validate = lambda **_kw: True
    with pytest.raises(BuilderExecutionPolicyError):
        owner().qualify(context=ctx, profile=q.profile(), code_qualification=q)
