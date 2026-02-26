from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

from core.workflow.enums import NodeType
from core.workflow.graph_engine.layers.debug_logging import DebugLoggingLayer
from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
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
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.node_events import NodeRunResult
from core.workflow.runtime import GraphRuntimeState, ReadOnlyGraphRuntimeStateWrapper, VariablePool


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _make_result(
    *,
    inputs: dict[str, object] | None = None,
    outputs: dict[str, object] | None = None,
    process_data: dict[str, object] | None = None,
    error: str = "",
) -> NodeRunResult:
    return NodeRunResult(
        inputs=inputs or {},
        outputs=outputs or {},
        process_data=process_data or {},
        error=error,
    )


def test_truncate_and_format_dict_support_empty_and_long_values() -> None:
    layer = DebugLoggingLayer(max_value_length=5)

    assert layer._truncate_value("123456") == "12345... (truncated)"
    assert layer._format_dict({}) == "{}"
    assert "a: 12345... (truncated)" in layer._format_dict({"a": "123456"})


def test_on_graph_start_logs_banner_lines() -> None:
    layer = DebugLoggingLayer()
    layer.logger = MagicMock()

    layer.on_graph_start()

    assert layer.logger.info.call_count >= 4


def test_on_event_covers_graph_node_iteration_and_loop_event_branches() -> None:
    layer = DebugLoggingLayer(
        include_inputs=True,
        include_outputs=True,
        include_process_data=True,
        max_value_length=10,
    )
    layer.logger = MagicMock()

    events = [
        GraphRunStartedEvent(),
        GraphRunSucceededEvent(outputs={"final": "value"}),
        GraphRunPartialSucceededEvent(exceptions_count=2, outputs={"partial": "ok"}),
        GraphRunFailedEvent(error="failed", exceptions_count=1),
        GraphRunAbortedEvent(reason="abort", outputs={"partial": "value"}),
        NodeRunRetryEvent(
            id="exec-retry",
            node_id="node-retry",
            node_type=NodeType.CODE,
            node_title="Retry Node",
            start_at=_utc_now(),
            error="first failure",
            retry_index=2,
        ),
        NodeRunStartedEvent(
            id="exec-start",
            node_id="node-start",
            node_type=NodeType.CODE,
            node_title="Start Node",
            start_at=_utc_now(),
            node_run_result=_make_result(inputs={"input": "value"}),
        ),
        NodeRunSucceededEvent(
            id="exec-succeeded",
            node_id="node-succeeded",
            node_type=NodeType.CODE,
            start_at=_utc_now(),
            node_run_result=_make_result(outputs={"output": "value"}, process_data={"trace": "data"}),
        ),
        NodeRunFailedEvent(
            id="exec-failed",
            node_id="node-failed",
            node_type=NodeType.CODE,
            start_at=_utc_now(),
            error="boom",
            node_run_result=_make_result(error="failure-details"),
        ),
        NodeRunExceptionEvent(
            id="exec-exception",
            node_id="node-exception",
            node_type=NodeType.CODE,
            start_at=_utc_now(),
            error="handled-error",
        ),
        NodeRunStreamChunkEvent(
            id="exec-stream",
            node_id="node-stream",
            node_type=NodeType.ANSWER,
            selector=["node-stream", "answer"],
            chunk="stream chunk value",
            is_final=True,
        ),
        NodeRunIterationStartedEvent(
            id="exec-iter-start",
            node_id="node-iter",
            node_type=NodeType.ITERATION,
            node_title="Iteration Node",
            start_at=_utc_now(),
        ),
        NodeRunIterationNextEvent(
            id="exec-iter-next",
            node_id="node-iter",
            node_type=NodeType.ITERATION,
            node_title="Iteration Node",
            index=1,
        ),
        NodeRunIterationSucceededEvent(
            id="exec-iter-succeeded",
            node_id="node-iter",
            node_type=NodeType.ITERATION,
            node_title="Iteration Node",
            start_at=_utc_now(),
            outputs={"iter_output": "ok"},
        ),
        NodeRunIterationFailedEvent(
            id="exec-iter-failed",
            node_id="node-iter",
            node_type=NodeType.ITERATION,
            node_title="Iteration Node",
            start_at=_utc_now(),
            error="iter-error",
        ),
        NodeRunLoopStartedEvent(
            id="exec-loop-start",
            node_id="node-loop",
            node_type=NodeType.LOOP,
            node_title="Loop Node",
            start_at=_utc_now(),
        ),
        NodeRunLoopNextEvent(
            id="exec-loop-next",
            node_id="node-loop",
            node_type=NodeType.LOOP,
            node_title="Loop Node",
            index=1,
        ),
        NodeRunLoopSucceededEvent(
            id="exec-loop-succeeded",
            node_id="node-loop",
            node_type=NodeType.LOOP,
            node_title="Loop Node",
            start_at=_utc_now(),
            outputs={"loop_output": "ok"},
        ),
        NodeRunLoopFailedEvent(
            id="exec-loop-failed",
            node_id="node-loop",
            node_type=NodeType.LOOP,
            node_title="Loop Node",
            start_at=_utc_now(),
            error="loop-error",
        ),
        GraphEngineEvent(),
    ]

    for event in events:
        layer.on_event(event)

    assert layer.node_count == 1
    assert layer.success_count == 1
    assert layer.failure_count == 1
    assert layer.retry_count == 1
    assert layer.logger.info.call_count > 0
    assert layer.logger.warning.call_count > 0
    assert layer.logger.error.call_count > 0
    assert layer.logger.debug.call_count > 0


def test_on_graph_end_logs_success_summary_and_final_outputs() -> None:
    layer = DebugLoggingLayer(include_outputs=True)
    layer.logger = MagicMock()
    runtime_state = GraphRuntimeState(variable_pool=VariablePool.empty(), start_at=0.0)
    runtime_state.set_output("answer", "done")
    layer.initialize(ReadOnlyGraphRuntimeStateWrapper(runtime_state), command_channel=MagicMock())

    layer.on_graph_end(error=None)

    assert layer.logger.info.call_count > 0
    assert any(call.args and call.args[0] == "Execution Statistics:" for call in layer.logger.info.call_args_list)


def test_on_graph_end_logs_failure_when_error_is_present() -> None:
    layer = DebugLoggingLayer(include_outputs=False)
    layer.logger = MagicMock()

    layer.on_graph_end(error=RuntimeError("boom"))

    assert any("GRAPH EXECUTION FAILED" in str(call.args[0]) for call in layer.logger.error.call_args_list)
