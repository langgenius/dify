from datetime import datetime
from unittest.mock import Mock

from models.workflow_handoff import (
    WorkflowHandoffResumeRoute,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from services.workflow_handoff_activation_service import WorkflowHandoffActivationService

NOW = datetime(2026, 7, 28, 12, 0, 0)


def _ready_handoff() -> WorkflowRunHandoff:
    return WorkflowRunHandoff(
        workflow_run_id="run-1",
        generation=2,
        task_id="task-1",
        snapshot_object_key="snapshot.json",
        snapshot_schema_version="workflow-resumption-context/v1",
        snapshot_checksum="checksum",
        snapshot_size_bytes=5,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="old-worker",
        state=WorkflowHandoffState.READY,
    )


def test_activation_commits_ready_before_enqueue_and_marks_after_enqueue() -> None:
    repository = Mock()
    handoff = _ready_handoff()
    calls: list[str] = []

    def activate(**_: object) -> WorkflowRunHandoff:
        calls.append("activate")
        return handoff

    def enqueue(_: str, __: int) -> None:
        calls.append("enqueue")

    def mark(**_: object) -> bool:
        calls.append("mark")
        return True

    repository.activate_latest_prepared_by_task_id.side_effect = activate
    repository.mark_dispatched.side_effect = mark

    result = WorkflowHandoffActivationService(repository=repository, enqueue=enqueue).activate(
        task_id="task-1",
        now=NOW,
    )

    assert calls == ["activate", "enqueue", "mark"]
    assert result.activated
    assert result.enqueued
    assert result.dispatch_marked
    assert result.errors == 0
    repository.activate_latest_prepared_by_task_id.assert_called_once_with(
        task_id="task-1",
        activated_at=NOW,
    )


def test_activation_leaves_committed_ready_for_scanner_when_enqueue_fails() -> None:
    repository = Mock()
    handoff = _ready_handoff()
    repository.activate_latest_prepared_by_task_id.return_value = handoff
    enqueue = Mock(side_effect=RuntimeError("broker unavailable"))

    result = WorkflowHandoffActivationService(repository=repository, enqueue=enqueue).activate(
        task_id="task-1",
        now=NOW,
    )

    assert result.activated
    assert not result.enqueued
    assert not result.dispatch_marked
    assert result.errors == 1
    repository.mark_dispatched.assert_not_called()


def test_activation_tolerates_mark_failure_after_the_broker_owns_the_message() -> None:
    repository = Mock()
    handoff = _ready_handoff()
    repository.activate_latest_prepared_by_task_id.return_value = handoff
    repository.mark_dispatched.side_effect = RuntimeError("database unavailable")
    enqueue = Mock()

    result = WorkflowHandoffActivationService(repository=repository, enqueue=enqueue).activate(
        task_id="task-1",
        now=NOW,
    )

    assert result.activated
    assert result.enqueued
    assert not result.dispatch_marked
    assert result.errors == 1
    enqueue.assert_called_once_with(handoff.id, handoff.generation)


def test_activation_is_a_noop_when_there_is_no_prepared_row() -> None:
    repository = Mock()
    repository.activate_latest_prepared_by_task_id.return_value = None
    enqueue = Mock()

    result = WorkflowHandoffActivationService(repository=repository, enqueue=enqueue).activate(
        task_id="task-1",
        now=NOW,
    )

    assert not result.activated
    enqueue.assert_not_called()
    repository.mark_dispatched.assert_not_called()
