"""In-process registry for workflow GraphEngine task IDs.

Celery warm shutdown is delivered to the worker process while workflow runners
are still active. The stop command channel is keyed by the application task ID,
not by the Celery task ID, so workflow runners register their GraphEngine task
IDs here for shutdown-time aborts.
"""

import threading
from collections.abc import Iterator
from contextlib import contextmanager

_active_task_ids: set[str] = set()
_active_task_ids_lock = threading.RLock()


def register_active_workflow_task(task_id: str) -> None:
    """Register an active workflow application task ID in the current process."""
    with _active_task_ids_lock:
        _active_task_ids.add(task_id)


def unregister_active_workflow_task(task_id: str) -> None:
    """Remove a workflow application task ID from the current process registry."""
    with _active_task_ids_lock:
        _active_task_ids.discard(task_id)


def get_active_workflow_task_ids() -> tuple[str, ...]:
    """Return a stable snapshot of active workflow application task IDs."""
    with _active_task_ids_lock:
        return tuple(sorted(_active_task_ids))


@contextmanager
def active_workflow_task(task_id: str) -> Iterator[None]:
    """Register a workflow task ID for the duration of a GraphEngine run."""
    register_active_workflow_task(task_id)
    try:
        yield
    finally:
        unregister_active_workflow_task(task_id)
