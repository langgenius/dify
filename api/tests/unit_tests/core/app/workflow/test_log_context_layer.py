"""Tests for WorkflowLogContextLayer."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.workflow.layers.log_context import WorkflowLogContextLayer
from core.logging.context import (
    clear_workflow_log_context,
    get_node_id,
    set_workflow_log_context,
)


@pytest.fixture(autouse=True)
def _clean_context():
    """Ensure clean ContextVar state before and after each test."""
    clear_workflow_log_context()
    yield
    clear_workflow_log_context()


class TestWorkflowLogContextLayer:
    """Tests for WorkflowLogContextLayer lifecycle management.

    The layer only manages node_id.  app_id / workflow_id / error_source
    are managed by WorkflowEntry.run directly.
    """

    def test_on_graph_start_does_not_set_app_or_workflow_id(self):
        """app_id / workflow_id are set by WorkflowEntry.run, not the layer."""
        layer = WorkflowLogContextLayer()

        layer.on_graph_start()

        # Layer should not set app_id or workflow_id
        # (they remain whatever they were before)
        assert get_node_id() == ""

    def test_on_graph_start_refreshes_execution_context(self):
        execution_context = MagicMock()
        layer = WorkflowLogContextLayer(execution_context=execution_context)

        layer.on_graph_start()

        execution_context.refresh_context_vars.assert_called_once()

    def test_on_graph_start_without_execution_context_does_not_raise(self):
        layer = WorkflowLogContextLayer(execution_context=None)

        layer.on_graph_start()  # should not raise

    def test_on_node_run_start_sets_node_id(self):
        layer = WorkflowLogContextLayer()
        layer.on_graph_start()

        node = SimpleNamespace(id="node-abc")
        layer.on_node_run_start(node)

        assert get_node_id() == "node-abc"

    def test_on_node_run_end_clears_node_id(self):
        layer = WorkflowLogContextLayer()
        layer.on_graph_start()

        node = SimpleNamespace(id="node-abc")
        layer.on_node_run_start(node)
        assert get_node_id() == "node-abc"

        layer.on_node_run_end(node, error=None)
        assert get_node_id() == ""

    def test_on_graph_end_is_noop(self):
        """on_graph_end does not clear context — WorkflowEntry.run handles that."""
        set_workflow_log_context("app-001", "wf-002")
        layer = WorkflowLogContextLayer()
        layer.on_graph_start()

        node = SimpleNamespace(id="node-abc")
        layer.on_node_run_start(node)

        layer.on_graph_end(error=None)

        # Layer should not clear anything on_graph_end
        assert get_node_id() == "node-abc"

    def test_node_id_switches_between_nodes(self):
        layer = WorkflowLogContextLayer()
        layer.on_graph_start()

        node1 = SimpleNamespace(id="node-1")
        node2 = SimpleNamespace(id="node-2")

        layer.on_node_run_start(node1)
        assert get_node_id() == "node-1"

        layer.on_node_run_end(node1, error=None)
        assert get_node_id() == ""

        layer.on_node_run_start(node2)
        assert get_node_id() == "node-2"

        layer.on_node_run_end(node2, error=None)
        assert get_node_id() == ""

    def test_on_event_is_noop(self):
        layer = WorkflowLogContextLayer()
        # Should not raise
        layer.on_event(object())

    def test_full_lifecycle(self):
        """Simulate a full graph run with two nodes."""
        # app_id / workflow_id are set by WorkflowEntry.run, not the layer.
        set_workflow_log_context("app-100", "wf-200")

        layer = WorkflowLogContextLayer()

        # Graph start (refreshes execution context only)
        layer.on_graph_start()

        # Node 1
        node1 = SimpleNamespace(id="n1")
        layer.on_node_run_start(node1)
        assert get_node_id() == "n1"
        layer.on_node_run_end(node1, error=None)
        assert get_node_id() == ""

        # Node 2
        node2 = SimpleNamespace(id="n2")
        layer.on_node_run_start(node2)
        assert get_node_id() == "n2"
        layer.on_node_run_end(node2, error=None)
        assert get_node_id() == ""

        # Graph end — layer is a no-op; WorkflowEntry.run clears context
        layer.on_graph_end(error=None)
        assert get_node_id() == ""
