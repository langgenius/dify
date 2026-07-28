from datetime import datetime, timedelta
from unittest.mock import Mock, call

from models.workflow_handoff import WorkflowHandoffResumeRoute, WorkflowRunHandoff
from services.workflow_handoff_dispatcher import WorkflowHandoffDispatcher


def _handoff(generation: int) -> WorkflowRunHandoff:
    return WorkflowRunHandoff(
        workflow_run_id="run-1",
        generation=generation,
        task_id="task-1",
        snapshot_object_key=f"snapshot-{generation}.json",
        snapshot_schema_version="workflow-resumption-context/v1",
        snapshot_checksum="checksum",
        snapshot_size_bytes=5,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="old-worker",
    )


def test_scan_enqueues_before_marking_durable_dispatch() -> None:
    repository = Mock()
    first = _handoff(1)
    second = _handoff(2)
    repository.fail_stale_prepared.return_value = 4
    repository.fail_stale_ready.return_value = 5
    repository.fail_exhausted.return_value = 3
    repository.list_due.return_value = [first, second]
    repository.mark_dispatched.return_value = True
    calls: list[tuple[str, str, int]] = []

    def enqueue(handoff_id: str, generation: int) -> None:
        calls.append(("enqueue", handoff_id, generation))

    def mark(*, handoff_id: str, generation: int, dispatched_at: datetime) -> bool:
        del dispatched_at
        calls.append(("mark", handoff_id, generation))
        return True

    repository.mark_dispatched.side_effect = mark
    now = datetime(2026, 7, 28, 12, 0, 0)
    result = WorkflowHandoffDispatcher(repository=repository, enqueue=enqueue).scan(
        now=now,
        redispatch_interval=timedelta(seconds=120),
        prepared_timeout=timedelta(seconds=600),
        max_attempts=20,
        limit=100,
    )

    assert calls == [
        ("enqueue", first.id, 1),
        ("mark", first.id, 1),
        ("enqueue", second.id, 2),
        ("mark", second.id, 2),
    ]
    assert result.exhausted_failed == 3
    assert result.stale_prepared_failed == 4
    assert result.stale_ready_failed == 5
    assert result.due == 2
    assert result.enqueued == 2
    assert result.dispatch_marked == 2
    assert result.errors == 0
    repository.list_due.assert_called_once_with(
        now=now,
        redispatch_interval=timedelta(seconds=120),
        max_attempts=20,
        limit=100,
    )
    repository.fail_stale_prepared.assert_called_once_with(
        now=now,
        stale_before=now - timedelta(seconds=600),
        error="workflow handoff drain barrier timed out before activation",
        limit=100,
    )
    repository.fail_stale_ready.assert_called_once_with(
        now=now,
        stale_before=now - timedelta(seconds=600),
        error="workflow handoff timed out before the first resume attempt",
        limit=100,
    )


def test_scan_leaves_failed_enqueue_due_and_tolerates_mark_failure() -> None:
    repository = Mock()
    first = _handoff(1)
    second = _handoff(2)
    repository.fail_stale_prepared.return_value = 0
    repository.fail_stale_ready.return_value = 0
    repository.fail_exhausted.return_value = 0
    repository.list_due.return_value = [first, second]
    repository.mark_dispatched.side_effect = RuntimeError("database unavailable")
    enqueue = Mock(side_effect=[RuntimeError("broker unavailable"), None])

    result = WorkflowHandoffDispatcher(repository=repository, enqueue=enqueue).scan(
        now=datetime(2026, 7, 28, 12, 0, 0),
        redispatch_interval=timedelta(seconds=120),
        prepared_timeout=timedelta(seconds=600),
        max_attempts=20,
        limit=100,
    )

    assert enqueue.call_args_list == [call(first.id, 1), call(second.id, 2)]
    repository.mark_dispatched.assert_called_once()
    assert result.enqueued == 1
    assert result.dispatch_marked == 0
    assert result.errors == 2


def test_scan_terminalizes_stale_never_claimed_ready_without_enqueuing_it() -> None:
    repository = Mock()
    repository.fail_stale_prepared.return_value = 0
    repository.fail_stale_ready.return_value = 1
    repository.fail_exhausted.return_value = 0
    due: list[WorkflowRunHandoff] = []
    repository.list_due.return_value = due
    enqueue = Mock()
    now = datetime(2026, 7, 28, 12, 0, 0)

    result = WorkflowHandoffDispatcher(repository=repository, enqueue=enqueue).scan(
        now=now,
        redispatch_interval=timedelta(seconds=120),
        prepared_timeout=timedelta(seconds=600),
        max_attempts=20,
        limit=100,
    )

    assert result.stale_ready_failed == 1
    assert result.due == 0
    assert result.enqueued == 0
    enqueue.assert_not_called()
    repository.fail_stale_ready.assert_called_once_with(
        now=now,
        stale_before=now - timedelta(seconds=600),
        error="workflow handoff timed out before the first resume attempt",
        limit=100,
    )
