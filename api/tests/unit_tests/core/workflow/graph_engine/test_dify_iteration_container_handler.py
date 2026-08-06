"""Regression tests for Dify iteration container output collection."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from core.workflow.graph_engine.dify_iteration_container_handler import DifyIterationContainerHandler
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


def test_resolve_iteration_output_segment_prefers_recorded_outputs() -> None:
    handler = DifyIterationContainerHandler(frame_registry=MagicMock())
    handler._frame_node_outputs["child-frame"] = {
        "http": {"body": "ok"},
    }
    frame = SimpleNamespace(
        frame_id="child-frame",
        graph_runtime_state=SimpleNamespace(
            variable_pool=SimpleNamespace(get=lambda _selector: None),
        ),
    )

    segment = handler._resolve_iteration_output_segment(
        frame=frame,
        output_selector=["http", "body"],
    )

    assert isinstance(segment, StringSegment)
    assert segment.value == "ok"
