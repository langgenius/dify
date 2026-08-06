"""Regression tests for Dify iteration container output collection."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

from core.workflow.graph_engine.dify_iteration_container_handler import DifyIterationContainerHandler
from graphon.graph_engine.frames import ExecutionFrame
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime.container_state import FrameRuntimeData, IterationFrameState, IterationRunState
from graphon.variables.segments import StringSegment


def test_segment_from_recorded_outputs_returns_child_event_value() -> None:
    handler = DifyIterationContainerHandler(frame_registry=MagicMock())
    handler._frame_node_outputs["child-frame"] = {
        "http": {"body": "response-text"},
    }

    segment = handler._segment_from_recorded_outputs(
        frame_id="child-frame",
        output_selector=["http", "body"],
    )

    assert isinstance(segment, StringSegment)
    assert segment.value == "response-text"


def test_segment_from_recorded_outputs_supports_nested_selector() -> None:
    handler = DifyIterationContainerHandler(frame_registry=MagicMock())
    handler._frame_node_outputs["child-frame"] = {
        "code": {"result": {"message": "nested-value"}},
    }

    segment = handler._segment_from_recorded_outputs(
        frame_id="child-frame",
        output_selector=["code", "result", "message"],
    )

    assert isinstance(segment, StringSegment)
    assert segment.value == "nested-value"


def test_backfill_iteration_output_writes_recorded_value_into_variable_pool() -> None:
    frame_registry = MagicMock()
    iteration_frame_state = IterationFrameState(
        frame_id="child-frame",
        parent_invocation_id="invocation-1",
        root_node_id="iteration_start",
        index=0,
        started_at=datetime.now(UTC),
        runtime_data=FrameRuntimeData(
            variable_pool="parent",
            outputs={},
            llm_usage=LLMUsage.empty_usage(),
            node_run_steps=0,
            graph_node_states={},
            graph_edge_states={},
        ),
    )
    root_runtime_state = SimpleNamespace(
        get_container_frame=lambda _frame_id: iteration_frame_state,
        get_container_run=lambda _invocation_id: IterationRunState(
            invocation_id="invocation-1",
            frame_id="parent-frame",
            node_id="iteration",
            started_at=datetime.now(UTC),
            root_node_id="iteration_start",
            items=(),
            output_selector=("http", "body"),
            error_handle_mode="continue-on-error",
            flatten_output=False,
            parallel_nums=1,
        ),
    )
    frame_registry.get.return_value = SimpleNamespace(graph_runtime_state=root_runtime_state)

    variable_pool = MagicMock()
    variable_pool.get.return_value = None

    handler = DifyIterationContainerHandler(frame_registry=frame_registry)
    handler._frame_node_outputs["child-frame"] = {
        "http": {"body": "ok"},
    }
    frame = cast(
        ExecutionFrame,
        SimpleNamespace(
            frame_id="child-frame",
            graph_runtime_state=SimpleNamespace(variable_pool=variable_pool),
        ),
    )

    handler._backfill_iteration_output_if_needed(frame)

    variable_pool.add.assert_called_once_with(("http", "body"), "ok")
