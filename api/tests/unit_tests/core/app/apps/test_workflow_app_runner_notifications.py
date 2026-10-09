from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.queue_entities import QueueWorkflowPausedEvent
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities.pause_reason import HitlRequired
from graphon.graph_events import GraphRunPausedEvent


class _DummyQueueManager:
    def __init__(self):
        self.published = []

    def publish(self, event, _from):
        self.published.append(event)


class _DummyRuntimeState:
    variable_pool = object()


class _DummyGraphEngine:
    def __init__(self):
        self.graph_runtime_state = _DummyRuntimeState()
        self.graph = SimpleNamespace(
            nodes={
                "node-1": SimpleNamespace(node_type="human-input", version=lambda: "1"),
            }
        )


class _DummyWorkflowEntry:
    def __init__(self):
        self.graph_engine = _DummyGraphEngine()


@pytest.mark.parametrize(("node_type", "node_version"), [("human-input", "1"), ("agent", "2")])
def test_handle_pause_event_enqueues_form_delivery_task(monkeypatch: pytest.MonkeyPatch, node_type, node_version):
    queue_manager = _DummyQueueManager()
    runner = WorkflowBasedAppRunner(queue_manager=queue_manager, app_id="app-id")
    workflow_entry = _DummyWorkflowEntry()
    workflow_entry.graph_engine.graph.nodes["node-1"] = SimpleNamespace(
        node_type=node_type, version=lambda: node_version
    )

    graph_reason = HitlRequired(session_id="form-123", node_id="node-1", node_title="Review")
    event = GraphRunPausedEvent(reasons=[graph_reason], outputs={})

    form_delivery_task = MagicMock()
    enriched_reason = HumanInputRequired(
        form_id="form-123",
        form_content="content",
        inputs=[],
        actions=[],
        node_id="node-1",
        node_title="Review",
    )
    monkeypatch.setattr(
        "core.app.apps.workflow_app_runner.resolve_human_input_v1_pause_reason",
        lambda **_: enriched_reason,
    )
    monkeypatch.setattr("core.app.apps.workflow_app_runner.dispatch_human_input_form_delivery_task", form_delivery_task)

    runner._handle_event(workflow_entry, event)

    form_delivery_task.apply_async.assert_called_once()
    kwargs = form_delivery_task.apply_async.call_args.kwargs["kwargs"]
    assert kwargs["form_id"] == "form-123"
    assert kwargs["node_title"] == "Review"

    assert any(isinstance(evt, QueueWorkflowPausedEvent) for evt in queue_manager.published)
