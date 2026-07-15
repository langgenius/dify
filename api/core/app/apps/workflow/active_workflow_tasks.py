"""In-process registry for workflow application task IDs."""

import threading
from collections.abc import Iterator
from contextlib import contextmanager

_active_task_ids: set[str] = set()
_active_task_ids_lock = threading.RLock()


@contextmanager
def active_workflow_task(task_id: str) -> Iterator[None]:
    """Register a workflow application task ID for the duration of a workflow run."""
    if not task_id:
        raise ValueError("task_id must not be empty")

    with _active_task_ids_lock:
        if task_id in _active_task_ids:
            raise ValueError(f"Workflow task already active for task_id={task_id}")
        _active_task_ids.add(task_id)

    try:
        yield
    finally:
        with _active_task_ids_lock:
            _active_task_ids.discard(task_id)


def get_active_workflow_task_count() -> int:
    """Return the number of active workflow application task IDs in this process."""
    with _active_task_ids_lock:
        return len(_active_task_ids)


def reset_active_workflow_tasks() -> None:
    """Clear active workflow application task IDs for worker initialization and tests."""
    with _active_task_ids_lock:
        _active_task_ids.clear()
