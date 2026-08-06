import threading
from collections.abc import Generator

import pytest

from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.workflow.active_workflow_tasks import (
    active_workflow_task,
    get_active_workflow_task_count,
    get_active_workflow_tasks,
    reset_active_workflow_tasks,
    retain_active_workflow_tasks,
    wait_for_active_workflow_tasks,
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


def test_active_workflow_task_tracks_run_and_registration_identity() -> None:
    with active_workflow_task("task-a", workflow_run_id="run-a"):
        registrations = get_active_workflow_tasks()

        assert len(registrations) == 1
        assert registrations[0].task_id == "task-a"
        assert registrations[0].workflow_run_id == "run-a"
        assert registrations[0].registration_id
        assert wait_for_active_workflow_tasks(0) == registrations


def test_retain_active_workflow_tasks_rejects_reused_task_registration() -> None:
    with active_workflow_task("task-a", workflow_run_id="run-a"):
        old_registration = get_active_workflow_tasks()

    with active_workflow_task("task-a", workflow_run_id="run-a"):
        assert retain_active_workflow_tasks(old_registration) == ()


def test_old_context_exit_does_not_unregister_reused_task_registration() -> None:
    old_context = active_workflow_task("task-a", workflow_run_id="run-a")
    new_context = active_workflow_task("task-a", workflow_run_id="run-a")
    old_context.__enter__()
    reset_active_workflow_tasks()
    new_context.__enter__()
    try:
        old_context.__exit__(None, None, None)

        registrations = get_active_workflow_tasks()
        assert len(registrations) == 1
        assert registrations[0].task_id == "task-a"
    finally:
        new_context.__exit__(None, None, None)


def test_active_workflow_task_rejects_empty_run_id() -> None:
    with pytest.raises(ValueError, match="workflow_run_id must not be empty"):
        with active_workflow_task("task-a", workflow_run_id=""):
            pass


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
