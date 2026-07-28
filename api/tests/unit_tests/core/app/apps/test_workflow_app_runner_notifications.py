from unittest.mock import MagicMock

import pytest

from core.app.apps.workflow.command_channels import WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON
from core.app.apps.workflow_app_runner import (
    WORKFLOW_HANDOFF_PERSISTENCE_FAILURE_STOP_REASON,
    WorkflowBasedAppRunner,
)
from core.app.entities.queue_entities import (
    QueueWorkflowMaintenancePausedEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
)
from core.app.layers.workflow_handoff_persist_layer import (
    WorkflowHandoffPersistenceError,
    WorkflowHandoffPersistenceLayer,
)
from core.app.layers.workflow_handoff_resume_layer import (
    WorkflowHandoffAcknowledgementError,
    WorkflowHandoffResumeAcknowledgementLayer,
)
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import HitlRequired, SchedulingPause
from graphon.graph_events import GraphRunPausedEvent, GraphRunStartedEvent


class _DummyQueueManager:
    def __init__(self):
        self.published = []

    def publish(self, event, _from):
        self.published.append(event)


class _DummyRuntimeState:
    variable_pool = object()

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

    graph_reason = HitlRequired(session_id="form-123", node_id="node-1", node_title="Review")
    event = GraphRunPausedEvent(reasons=[graph_reason], outputs={})

    email_task = MagicMock()
    enriched_reason = HumanInputRequired(
        form_id="form-123",
        form_content="content",
        inputs=[],
        actions=[],
        node_id="node-1",
        node_title="Review",
    )
    monkeypatch.setattr(
        "core.app.apps.workflow_app_runner.enrich_graph_pause_reasons",
        lambda **_: [enriched_reason],
    )
    monkeypatch.setattr("core.app.apps.workflow_app_runner.dispatch_human_input_email_task", email_task)

    runner._handle_event(workflow_entry, event)

    email_task.apply_async.assert_called_once()
    kwargs = email_task.apply_async.call_args.kwargs["kwargs"]
    assert kwargs["form_id"] == "form-123"
    assert kwargs["node_title"] == "Review"

    assert any(isinstance(evt, QueueWorkflowPausedEvent) for evt in queue_manager.published)


def test_handle_maintenance_pause_uses_internal_event_without_notifications(monkeypatch: pytest.MonkeyPatch):
    queue_manager = _DummyQueueManager()
    runner = WorkflowBasedAppRunner(queue_manager=queue_manager, app_id="app-id")
    workflow_entry = _DummyWorkflowEntry()
    event = GraphRunPausedEvent(
        reasons=[SchedulingPause(message=WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON)],
        outputs={"checkpoint": True},
    )

    email_task = MagicMock()
    enrich_reasons = MagicMock()
    monkeypatch.setattr("core.app.apps.workflow_app_runner.dispatch_human_input_email_task", email_task)
    monkeypatch.setattr("core.app.apps.workflow_app_runner.enrich_graph_pause_reasons", enrich_reasons)

    runner._handle_event(workflow_entry, event)

    assert len(queue_manager.published) == 1
    maintenance_event = queue_manager.published[0]
    assert isinstance(maintenance_event, QueueWorkflowMaintenancePausedEvent)
    assert maintenance_event.outputs == {"checkpoint": True}
    assert maintenance_event.paused_nodes == ["node-1"]
    email_task.apply_async.assert_not_called()
    enrich_reasons.assert_not_called()


def test_resumption_acknowledgements_run_before_started_event_is_published():
    queue_manager = _DummyQueueManager()
    first_layer = MagicMock(spec=WorkflowHandoffResumeAcknowledgementLayer)
    second_layer = MagicMock(spec=WorkflowHandoffResumeAcknowledgementLayer)
    first_layer.require_acknowledged.side_effect = lambda: (
        not queue_manager.published or pytest.fail("started event was published before acknowledgement")
    )
    second_layer.require_acknowledged.side_effect = lambda: (
        not queue_manager.published or pytest.fail("started event was published before acknowledgement")
    )
    runner = WorkflowBasedAppRunner(
        queue_manager=queue_manager,
        app_id="app-id",
        graph_engine_layers=(first_layer, second_layer),
    )

    runner._handle_event_with_handoff_contracts(
        _DummyWorkflowEntry(),
        GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION),
    )

    first_layer.require_acknowledged.assert_called_once_with()
    second_layer.require_acknowledged.assert_called_once_with()
    assert len(queue_manager.published) == 1
    assert isinstance(queue_manager.published[0], QueueWorkflowStartedEvent)


def test_failed_resumption_acknowledgement_prevents_started_event_publication():
    queue_manager = _DummyQueueManager()
    acknowledgement_layer = MagicMock(spec=WorkflowHandoffResumeAcknowledgementLayer)
    second_layer = MagicMock(spec=WorkflowHandoffResumeAcknowledgementLayer)
    acknowledgement_layer.require_acknowledged.side_effect = WorkflowHandoffAcknowledgementError("stale claim")
    runner = WorkflowBasedAppRunner(
        queue_manager=queue_manager,
        app_id="app-id",
        graph_engine_layers=(acknowledgement_layer, second_layer),
    )

    with pytest.raises(WorkflowHandoffAcknowledgementError, match="stale claim"):
        runner._handle_event_with_handoff_contracts(
            _DummyWorkflowEntry(),
            GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION),
        )

    second_layer.require_acknowledged.assert_called_once_with()
    assert queue_manager.published == []


def test_initial_start_does_not_require_handoff_acknowledgement():
    queue_manager = _DummyQueueManager()
    acknowledgement_layer = MagicMock(spec=WorkflowHandoffResumeAcknowledgementLayer)
    runner = WorkflowBasedAppRunner(
        queue_manager=queue_manager,
        app_id="app-id",
        graph_engine_layers=(acknowledgement_layer,),
    )

    runner._handle_event_with_handoff_contracts(
        _DummyWorkflowEntry(),
        GraphRunStartedEvent(reason=WorkflowStartReason.INITIAL),
    )

    acknowledgement_layer.require_acknowledged.assert_not_called()
    assert isinstance(queue_manager.published[0], QueueWorkflowStartedEvent)


def test_all_persistence_layers_are_checked_before_maintenance_sentinel():
    queue_manager = _DummyQueueManager()
    first_layer = MagicMock(spec=WorkflowHandoffPersistenceLayer)
    second_layer = MagicMock(spec=WorkflowHandoffPersistenceLayer)
    first_layer.require_persisted_handoff.side_effect = lambda: (
        not queue_manager.published or pytest.fail("maintenance sentinel was published before persistence check")
    )
    second_layer.require_persisted_handoff.side_effect = lambda: (
        not queue_manager.published or pytest.fail("maintenance sentinel was published before persistence check")
    )
    runner = WorkflowBasedAppRunner(
        queue_manager=queue_manager,
        app_id="app-id",
        graph_engine_layers=(first_layer, second_layer),
    )
    event = GraphRunPausedEvent(
        reasons=[SchedulingPause(message=WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON)],
        outputs={"checkpoint": True},
    )

    runner._handle_event_with_handoff_contracts(_DummyWorkflowEntry(), event)

    first_layer.require_persisted_handoff.assert_called_once_with()
    second_layer.require_persisted_handoff.assert_called_once_with()
    assert len(queue_manager.published) == 1
    assert isinstance(queue_manager.published[0], QueueWorkflowMaintenancePausedEvent)


def test_persistence_failure_stops_running_run_and_prevents_maintenance_sentinel(
    monkeypatch: pytest.MonkeyPatch,
):
    queue_manager = _DummyQueueManager()
    persistence_layer = MagicMock(spec=WorkflowHandoffPersistenceLayer)
    second_layer = MagicMock(spec=WorkflowHandoffPersistenceLayer)
    persistence_layer.require_persisted_handoff.side_effect = WorkflowHandoffPersistenceError("storage unavailable")
    runner = WorkflowBasedAppRunner(
        queue_manager=queue_manager,
        app_id="app-id",
        graph_engine_layers=(persistence_layer, second_layer),
    )
    mark_stopped = MagicMock(return_value=1)
    monkeypatch.setattr("core.app.apps.workflow_app_runner.get_system_text", lambda *_: "run-1")
    monkeypatch.setattr(
        "core.app.apps.workflow_app_runner.mark_workflow_runs_stopped_if_running_without_active_handoff",
        mark_stopped,
    )
    event = GraphRunPausedEvent(
        reasons=[SchedulingPause(message=WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON)],
        outputs={},
    )

    with pytest.raises(WorkflowHandoffPersistenceError, match="storage unavailable"):
        runner._handle_event_with_handoff_contracts(_DummyWorkflowEntry(), event)

    second_layer.require_persisted_handoff.assert_called_once_with()
    mark_stopped.assert_called_once_with(
        ("run-1",),
        reason=WORKFLOW_HANDOFF_PERSISTENCE_FAILURE_STOP_REASON,
    )
    assert queue_manager.published == []


def test_missing_persistence_layer_fails_closed_without_maintenance_sentinel(
    monkeypatch: pytest.MonkeyPatch,
):
    queue_manager = _DummyQueueManager()
    runner = WorkflowBasedAppRunner(queue_manager=queue_manager, app_id="app-id")
    mark_stopped = MagicMock(return_value=1)
    monkeypatch.setattr("core.app.apps.workflow_app_runner.get_system_text", lambda *_: "run-1")
    monkeypatch.setattr(
        "core.app.apps.workflow_app_runner.mark_workflow_runs_stopped_if_running_without_active_handoff",
        mark_stopped,
    )
    event = GraphRunPausedEvent(
        reasons=[SchedulingPause(message=WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON)],
        outputs={},
    )

    with pytest.raises(WorkflowHandoffPersistenceError, match="without a workflow handoff persistence layer"):
        runner._handle_event_with_handoff_contracts(_DummyWorkflowEntry(), event)

    mark_stopped.assert_called_once()
    assert queue_manager.published == []
