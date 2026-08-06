"""In-process registry for workflow execution segments owned by this worker."""

import threading
import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from uuid import uuid4


@dataclass(frozen=True, slots=True)
class ActiveWorkflowTask:
    """One workflow segment currently executing in this worker process.

    ``registration_id`` distinguishes a resumed segment that reuses the same
    task and run IDs from an older segment observed by a shutdown watchdog.
    """

    task_id: str
    workflow_run_id: str | None
    registration_id: str


_active_tasks: dict[str, ActiveWorkflowTask] = {}
_active_task_ids_lock = threading.RLock()
_active_task_ids_changed = threading.Condition(_active_task_ids_lock)


@contextmanager
def active_workflow_task(task_id: str, *, workflow_run_id: str | None = None) -> Generator[None]:
    """Register an execution segment for the duration of a workflow run."""
    if not task_id:
        raise ValueError("task_id must not be empty")
    if workflow_run_id is not None and not workflow_run_id:
        raise ValueError("workflow_run_id must not be empty")

    registration = ActiveWorkflowTask(
        task_id=task_id,
        workflow_run_id=workflow_run_id,
        registration_id=str(uuid4()),
    )

    with _active_task_ids_changed:
        if task_id in _active_tasks:
            raise ValueError(f"Workflow task already active for task_id={task_id}")
        _active_tasks[task_id] = registration
        _active_task_ids_changed.notify_all()

    try:
        yield
    finally:
        with _active_task_ids_changed:
            if _active_tasks.get(task_id) == registration:
                del _active_tasks[task_id]
                _active_task_ids_changed.notify_all()


def get_active_workflow_task_count() -> int:
    """Return the number of active workflow application task IDs in this process."""
    with _active_task_ids_lock:
        return len(_active_tasks)


def get_active_workflow_tasks() -> tuple[ActiveWorkflowTask, ...]:
    """Return a stable snapshot of workflow segments owned by this worker."""
    with _active_task_ids_lock:
        return tuple(_active_tasks.values())


def retain_active_workflow_tasks(
    registrations: tuple[ActiveWorkflowTask, ...],
) -> tuple[ActiveWorkflowTask, ...]:
    """Keep only registrations that still refer to the same active segment."""
    with _active_task_ids_lock:
        return tuple(
            registration for registration in registrations if _active_tasks.get(registration.task_id) == registration
        )


def wait_for_active_workflow_tasks(timeout: float) -> tuple[ActiveWorkflowTask, ...]:
    """Wait for the registry to empty and return registrations left at timeout."""
    if timeout < 0:
        raise ValueError("timeout must be non-negative")

    deadline = time.monotonic() + timeout
    with _active_task_ids_changed:
        while _active_tasks:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return tuple(_active_tasks.values())
            _active_task_ids_changed.wait(timeout=remaining)
        return ()


def reset_active_workflow_tasks() -> None:
    """Clear active workflow application task IDs for worker initialization and tests."""
    with _active_task_ids_changed:
        _active_tasks.clear()
        _active_task_ids_changed.notify_all()
