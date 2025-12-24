"""Tests for the EventManager."""

from __future__ import annotations

import logging

from core.workflow.graph_engine.event_management.event_manager import EventManager
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events import GraphEngineEvent


class _FaultyLayer(GraphEngineLayer):
    """Layer that raises from on_event to test error handling."""

    def on_graph_start(self) -> None:  # pragma: no cover - not used in tests
        pass

    def on_event(self, event: GraphEngineEvent) -> None:
        raise RuntimeError("boom")

    def on_graph_end(self, error: Exception | None) -> None:  # pragma: no cover - not used in tests
        pass


def test_event_manager_logs_layer_errors(caplog) -> None:
    """Ensure errors raised by layers are logged when collecting events."""

    event_manager = EventManager()
    event_manager.set_layers([_FaultyLayer()])

    with caplog.at_level(logging.ERROR):
        event_manager.collect(GraphEngineEvent())

    error_logs = [record for record in caplog.records if "Error in layer on_event" in record.getMessage()]
    assert error_logs, "Expected layer errors to be logged"

    log_record = error_logs[0]
    assert log_record.exc_info is not None
    assert isinstance(log_record.exc_info[1], RuntimeError)
