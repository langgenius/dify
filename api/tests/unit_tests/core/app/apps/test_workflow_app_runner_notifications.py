from unittest.mock import MagicMock

import pytest

from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.queue_entities import QueueWorkflowPausedEvent
from core.workflow.entities.pause_reason import HumanInputRequired
from core.workflow.graph_events.graph import GraphRunPausedEvent


class _DummyQueueManager:
    def __init__(self):
        self.published = []

    def publish(self, event, _from):
        self.published.append(event)


class _DummyRuntimeState:
    def get_paused_nodes(self):
        return ["node-1"]


class _DummyGraphEngine:
    def __init__(self):
        self.graph_runtime_state = _DummyRuntimeState()


class _DummyWorkflowEntry:
    def __init__(self):
        self.graph_engine = _DummyGraphEngine()


def test_handle_pause_event_enqueues_email_task(monkeypatch: pytest.MonkeyPatch):
    queue_manager = _DummyQueueManager()
    runner = WorkflowBasedAppRunner(queue_manager=queue_manager, app_id="app-id")
    workflow_entry = _DummyWorkflowEntry()

    reason = HumanInputRequired(
        form_id="form-123",
        form_content="content",
        inputs=[],
        actions=[],
        node_id="node-1",
        node_title="Review",
    )
    event = GraphRunPausedEvent(reasons=[reason], outputs={})

    email_task = MagicMock()
    monkeypatch.setattr("core.app.apps.workflow_app_runner.dispatch_human_input_email_task", email_task)

    runner._handle_event(workflow_entry, event)

    email_task.apply_async.assert_called_once()
    kwargs = email_task.apply_async.call_args.kwargs["kwargs"]
    assert kwargs["form_id"] == "form-123"
    assert kwargs["node_title"] == "Review"

    assert any(isinstance(evt, QueueWorkflowPausedEvent) for evt in queue_manager.published)
