import threading
from collections.abc import Generator

import pytest

from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.workflow.active_workflow_tasks import (
    active_workflow_task,
    get_active_workflow_task_count,
    reset_active_workflow_tasks,
)


@pytest.fixture(autouse=True)
def reset_active_tasks() -> None:
    reset_active_workflow_tasks()
    yield
    reset_active_workflow_tasks()


def test_active_workflow_task_tracks_count_during_context() -> None:
    assert get_active_workflow_task_count() == 0

    with active_workflow_task("task-a"):
        assert get_active_workflow_task_count() == 1

    assert get_active_workflow_task_count() == 0


def test_active_workflow_task_rejects_duplicate_task_id() -> None:
    with active_workflow_task("task-a"):
        with pytest.raises(ValueError, match="already active"):
            with active_workflow_task("task-a"):
                pass


def test_managed_stream_waits_for_active_worker_cleanup() -> None:
    worker_started = threading.Event()
    release_worker = threading.Event()
    stream_exhausted = threading.Event()
    consumer_finished = threading.Event()
    consumer_errors: list[BaseException] = []

    def run_worker() -> None:
        with active_workflow_task("task-a"):
            worker_started.set()
            release_worker.wait()

    def response_stream() -> Generator[dict[str, str], None, None]:
        yield {"event": "workflow_finished"}
        stream_exhausted.set()

    worker_thread = threading.Thread(target=run_worker)
    worker_thread.start()
    assert worker_started.wait(timeout=2)

    managed_stream = BaseAppGenerator._wrap_stream_with_worker_thread_join(response_stream(), worker_thread)
    assert next(managed_stream) == {"event": "workflow_finished"}

    def finish_stream() -> None:
        try:
            list(managed_stream)
        except BaseException as exc:
            consumer_errors.append(exc)
        finally:
            consumer_finished.set()

    consumer_thread = threading.Thread(target=finish_stream)
    consumer_thread.start()
    try:
        assert stream_exhausted.wait(timeout=2)
        assert not consumer_finished.is_set()
        assert get_active_workflow_task_count() == 1
    finally:
        release_worker.set()
        consumer_thread.join(timeout=2)
        worker_thread.join(timeout=2)

    assert not consumer_thread.is_alive()
    assert not worker_thread.is_alive()
    assert consumer_errors == []
    assert get_active_workflow_task_count() == 0
