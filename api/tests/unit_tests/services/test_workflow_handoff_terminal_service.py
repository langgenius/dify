import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from graphon.enums import WorkflowExecutionStatus
from models.model import AppMode
from models.workflow_handoff import WorkflowHandoffResumeRoute
from repositories.workflow_handoff_repository import (
    WorkflowHandoffSnapshotDeleteOutcome,
    WorkflowHandoffTerminalEvent,
    WorkflowHandoffTerminalScope,
)
from services.workflow_handoff_terminal_service import WorkflowHandoffTerminalService

NOW = datetime(2026, 7, 28, 12, 0, 0)


def _terminal_event(route: WorkflowHandoffResumeRoute) -> WorkflowHandoffTerminalEvent:
    return WorkflowHandoffTerminalEvent(
        handoff_id="handoff-1",
        generation=2,
        task_id="task-1",
        resume_route=route,
        workflow_run_id="run-1",
        workflow_id="workflow-1",
        status=WorkflowExecutionStatus.STOPPED,
        outputs={"partial": True},
        error="resume attempts exhausted",
        elapsed_time=12.5,
        total_tokens=7,
        total_steps=3,
        created_at=NOW - timedelta(seconds=13),
        finished_at=NOW,
        exceptions_count=1,
        handoff_duration=2.5,
        message_id="message-1" if route == WorkflowHandoffResumeRoute.ADVANCED_CHAT else None,
    )


def _repository() -> Mock:
    repository = Mock()
    repository.list_failed_pending_terminal_compensation.return_value = []
    repository.list_pending_terminal_events.return_value = []
    repository.list_snapshot_gc_candidates.return_value = []
    repository.cleanup_expired_cancellations.return_value = 0
    return repository


def _terminal_scope(route: WorkflowHandoffResumeRoute) -> WorkflowHandoffTerminalScope:
    return WorkflowHandoffTerminalScope(
        workflow_run_id="run-1",
        task_id="task-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        resume_route=route,
    )


@pytest.mark.parametrize(
    ("route", "expected_mode"),
    [
        (WorkflowHandoffResumeRoute.WORKFLOW, AppMode.WORKFLOW),
        (WorkflowHandoffResumeRoute.SNIPPET, AppMode.WORKFLOW),
        (WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW, AppMode.WORKFLOW),
        (WorkflowHandoffResumeRoute.ADVANCED_CHAT, AppMode.ADVANCED_CHAT),
        (WorkflowHandoffResumeRoute.RAG_PIPELINE, AppMode.RAG_PIPELINE),
    ],
)
def test_scan_publishes_terminal_event_on_the_route_run_topic(
    route: WorkflowHandoffResumeRoute,
    expected_mode: AppMode,
) -> None:
    repository = _repository()
    repository.list_pending_terminal_events.return_value = [_terminal_event(route)]
    repository.mark_terminal_event_published.return_value = True
    publisher = Mock()
    service = WorkflowHandoffTerminalService(
        repository=repository,
        storage=Mock(),
        publisher=publisher,
    )

    result = service.scan(now=NOW, limit=10, retry_delay=timedelta(seconds=5))

    assert result.terminal_events_published == 1
    assert all(call.args[:2] == (expected_mode, "run-1") for call in publisher.call_args_list)
    payloads = [json.loads(call.args[2]) for call in publisher.call_args_list]
    if route == WorkflowHandoffResumeRoute.ADVANCED_CHAT:
        assert [payload["event"] for payload in payloads] == [
            "message_replace",
            "message_end",
            "workflow_finished",
        ]
        assert payloads[0] == {
            "event": "message_replace",
            "task_id": "task-1",
            "answer": "",
            "reason": "workflow_handoff_terminal",
        }
        assert payloads[1] == {
            "event": "message_end",
            "task_id": "task-1",
            "id": "message-1",
            "metadata": {},
            "files": [],
        }
    else:
        assert [payload["event"] for payload in payloads] == ["workflow_finished"]
    payload = payloads[-1]
    assert payload["event"] == "workflow_finished"
    assert payload["task_id"] == "task-1"
    assert payload["workflow_run_id"] == "run-1"
    assert payload["data"]["status"] == WorkflowExecutionStatus.STOPPED
    assert payload["data"]["outputs"] == {"partial": True}
    assert payload["data"]["handoff_duration"] == 2.5


def test_scan_compensates_failed_handoff_and_deletes_terminal_snapshot() -> None:
    repository = _repository()
    handoff = SimpleNamespace(id="handoff-1", generation=2)
    record = SimpleNamespace(snapshot_object_key="snapshots/checkpoint")
    repository.list_failed_pending_terminal_compensation.return_value = [handoff]
    repository.compensate_failed_terminal.return_value = True
    repository.list_snapshot_gc_candidates.return_value = [record]
    repository.delete_snapshot_if_unreferenced.side_effect = lambda **kwargs: (
        WorkflowHandoffSnapshotDeleteOutcome.DELETED
        if kwargs["delete_object"](kwargs["snapshot_object_key"])
        else WorkflowHandoffSnapshotDeleteOutcome.MISSING
    )
    repository.cleanup_expired_cancellations.return_value = 4
    storage = Mock()
    storage.exists.return_value = True
    service = WorkflowHandoffTerminalService(repository=repository, storage=storage)

    result = service.scan(now=NOW, limit=10, retry_delay=timedelta(seconds=5))

    assert result.terminal_compensated == 1
    assert result.snapshots_deleted == 1
    assert result.cancellations_deleted == 4
    storage.delete.assert_called_once_with("snapshots/checkpoint")
    repository.compensate_failed_terminal.assert_called_once_with(
        handoff_id="handoff-1",
        generation=2,
        compensated_at=NOW,
    )


def test_scan_marks_never_uploaded_snapshot_missing_and_retries_storage_errors() -> None:
    repository = _repository()
    missing = SimpleNamespace(snapshot_object_key="snapshots/never-uploaded")
    broken = SimpleNamespace(snapshot_object_key="snapshots/unavailable")
    repository.list_snapshot_gc_candidates.return_value = [missing, broken]
    storage = Mock()
    storage.exists.side_effect = [False, RuntimeError("object store unavailable")]

    def delete_if_unreferenced(**kwargs):
        existed = kwargs["delete_object"](kwargs["snapshot_object_key"])
        return WorkflowHandoffSnapshotDeleteOutcome.DELETED if existed else WorkflowHandoffSnapshotDeleteOutcome.MISSING

    repository.delete_snapshot_if_unreferenced.side_effect = delete_if_unreferenced
    service = WorkflowHandoffTerminalService(repository=repository, storage=storage)

    result = service.scan(now=NOW, limit=10, retry_delay=timedelta(seconds=5))

    assert result.snapshots_missing == 1
    assert result.snapshot_gc_errors == 1
    repository.record_snapshot_gc_failure.assert_called_once_with(
        snapshot_object_key="snapshots/unavailable",
        error="RuntimeError: object store unavailable",
        retry_at=NOW + timedelta(seconds=5),
    )


def test_scan_records_terminal_publication_failure_for_retry() -> None:
    repository = _repository()
    repository.list_pending_terminal_events.return_value = [_terminal_event(WorkflowHandoffResumeRoute.ADVANCED_CHAT)]
    publisher = Mock(side_effect=RuntimeError("redis unavailable"))
    service = WorkflowHandoffTerminalService(
        repository=repository,
        storage=Mock(),
        publisher=publisher,
    )

    result = service.scan(now=NOW, limit=10, retry_delay=timedelta(seconds=5))

    assert result.terminal_event_errors == 1
    repository.mark_terminal_event_published.assert_not_called()
    repository.record_terminal_processing_failure.assert_called_once_with(
        handoff_id="handoff-1",
        generation=2,
        error="RuntimeError: redis unavailable",
    )


def test_reconcile_resumed_failure_commits_before_publishing_and_marks_outbox() -> None:
    repository = _repository()
    event = _terminal_event(WorkflowHandoffResumeRoute.ADVANCED_CHAT)
    operation_order: list[str] = []
    repository.reconcile_resumed_terminal_failure.side_effect = lambda **_kwargs: (
        operation_order.append("database"),
        event,
    )[1]
    repository.mark_terminal_event_published.side_effect = lambda **_kwargs: (
        operation_order.append("marked"),
        True,
    )[1]
    publisher = Mock(side_effect=lambda *_args: operation_order.append("published"))
    service = WorkflowHandoffTerminalService(repository=repository, storage=Mock(), publisher=publisher)

    assert service.reconcile_resumed_failure(
        handoff_id="handoff-1",
        generation=2,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.ADVANCED_CHAT),
        error="queue exploded",
        failed_at=NOW,
        message_answer_delta=" delta",
        message_answer_replacement="partial",
    )

    assert operation_order == ["database", "published", "published", "published", "marked"]
    repository.reconcile_resumed_terminal_failure.assert_called_once_with(
        handoff_id="handoff-1",
        generation=2,
        scope=_terminal_scope(WorkflowHandoffResumeRoute.ADVANCED_CHAT),
        error="queue exploded",
        failed_at=NOW,
        message_answer_delta=" delta",
        message_answer_replacement="partial",
    )


def test_reconcile_resumed_failure_leaves_durable_outbox_pending_when_publish_fails() -> None:
    repository = _repository()
    repository.reconcile_resumed_terminal_failure.return_value = _terminal_event(WorkflowHandoffResumeRoute.WORKFLOW)
    publisher = Mock(side_effect=RuntimeError("redis unavailable"))
    service = WorkflowHandoffTerminalService(repository=repository, storage=Mock(), publisher=publisher)

    with pytest.raises(RuntimeError, match="redis unavailable"):
        service.reconcile_resumed_failure(
            handoff_id="handoff-1",
            generation=2,
            scope=_terminal_scope(WorkflowHandoffResumeRoute.WORKFLOW),
            error="queue exploded",
            failed_at=NOW,
        )

    repository.mark_terminal_event_published.assert_not_called()
    repository.record_terminal_processing_failure.assert_called_once_with(
        handoff_id="handoff-1",
        generation=2,
        error="RuntimeError: redis unavailable",
    )
