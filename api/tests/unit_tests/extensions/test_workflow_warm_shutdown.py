import logging
import subprocess
import sys
import textwrap
import threading
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.workflow.active_workflow_tasks import active_workflow_task, reset_active_workflow_tasks
from core.app.apps.workflow.command_channels import CelerySignalCommandChannel
from extensions import workflow_warm_shutdown
from graphon.graph_engine.entities.commands import AbortCommand, PauseCommand
from models.workflow import WorkflowRun
from models.workflow_handoff import WorkflowHandoffSnapshotGC, WorkflowHandoffState, WorkflowRunHandoff

NOW = datetime(2026, 7, 28, 12, 0, 0)


@pytest.fixture(autouse=True)
def reset_warm_shutdown_state() -> None:
    reset_active_workflow_tasks()
    workflow_warm_shutdown._celery_warm_shutdown_started.clear()
    workflow_warm_shutdown._workflow_drain_watchdog_started.clear()
    yield
    reset_active_workflow_tasks()
    workflow_warm_shutdown._celery_warm_shutdown_started.clear()
    workflow_warm_shutdown._workflow_drain_watchdog_started.clear()


def _create_warm_shutdown_command_channel(*, pause_on_shutdown: bool = False) -> CelerySignalCommandChannel:
    return CelerySignalCommandChannel(
        shutdown_state_getter=workflow_warm_shutdown.celery_warm_shutdown_started,
        pause_on_shutdown=pause_on_shutdown,
    )


def _workflow_run_session_maker(
    *,
    status: str = "running",
    error: str | None = None,
) -> tuple[sessionmaker[Session], str]:
    engine = sa.create_engine("sqlite:///:memory:")
    WorkflowRun.__table__.create(engine)
    WorkflowRunHandoff.__table__.create(engine)
    WorkflowHandoffSnapshotGC.__table__.create(engine)
    workflow_run_id = str(uuid4())
    with engine.begin() as connection:
        connection.execute(
            WorkflowRun.__table__.insert(),
            {
                "id": workflow_run_id,
                "tenant_id": str(uuid4()),
                "app_id": str(uuid4()),
                "workflow_id": str(uuid4()),
                "type": "workflow",
                "triggered_from": "app-run",
                "version": "1",
                "status": status,
                "error": error,
                "created_by_role": "account",
                "created_by": str(uuid4()),
            },
        )
    return sessionmaker(bind=engine, class_=Session, expire_on_commit=False), workflow_run_id


def test_worker_shutting_down_skips_non_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    mark_shutdown = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown, "mark_celery_warm_shutdown_started", mark_shutdown)

    workflow_warm_shutdown._on_worker_shutting_down(how="cold")

    mark_shutdown.assert_not_called()


def test_worker_shutting_down_marks_warm_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    begin_shutdown = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown, "begin_workflow_warm_shutdown", begin_shutdown)

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    begin_shutdown.assert_called_once_with(source="Celery worker")


def test_worker_shutting_down_starts_deadline_watchdog_when_handoff_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start_watchdog = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown.dify_config, "WORKFLOW_HANDOFF_ENABLED", True)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_count", lambda: 1)
    monkeypatch.setattr(workflow_warm_shutdown, "_start_workflow_drain_watchdog", start_watchdog)

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    start_watchdog.assert_called_once_with()


def test_worker_shutting_down_starts_deadline_watchdog_when_registry_is_initially_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start_watchdog = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown.dify_config, "WORKFLOW_HANDOFF_ENABLED", True)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_count", lambda: 0)
    monkeypatch.setattr(workflow_warm_shutdown, "_start_workflow_drain_watchdog", start_watchdog)

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    start_watchdog.assert_called_once_with()


def test_worker_shutting_down_does_not_start_deadline_watchdog_when_handoff_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    start_watchdog = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown.dify_config, "WORKFLOW_HANDOFF_ENABLED", False)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_count", lambda: 1)
    monkeypatch.setattr(workflow_warm_shutdown, "_start_workflow_drain_watchdog", start_watchdog)

    workflow_warm_shutdown._on_worker_shutting_down(how="warm")

    start_watchdog.assert_not_called()


def test_warm_shutdown_state_tracks_started_flag() -> None:
    assert workflow_warm_shutdown.celery_warm_shutdown_started() is False
    assert workflow_warm_shutdown.workflow_warm_shutdown_started() is False

    workflow_warm_shutdown.mark_celery_warm_shutdown_started()

    assert workflow_warm_shutdown.celery_warm_shutdown_started() is True
    assert workflow_warm_shutdown.workflow_warm_shutdown_started() is True


def test_setup_preserves_abort_fallback_when_handoff_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", MagicMock())
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", MagicMock())

    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()
    workflow_warm_shutdown.mark_celery_warm_shutdown_started()

    commands = _create_warm_shutdown_command_channel().fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], AbortCommand)
    assert commands[0].reason == workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_ABORT_REASON


def test_warm_shutdown_emits_maintenance_pause_when_handoff_is_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", MagicMock())
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", MagicMock())

    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()
    workflow_warm_shutdown.mark_celery_warm_shutdown_started()

    commands = _create_warm_shutdown_command_channel(pause_on_shutdown=True).fetch_commands()

    assert len(commands) == 1
    assert isinstance(commands[0], PauseCommand)
    assert commands[0].reason == workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON


def test_warm_shutdown_command_stays_available_for_late_channels(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", MagicMock())
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", MagicMock())

    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()
    workflow_warm_shutdown.mark_celery_warm_shutdown_started()

    first_channel = _create_warm_shutdown_command_channel()
    late_channel = _create_warm_shutdown_command_channel()

    assert len(first_channel.fetch_commands()) == 1
    assert len(late_channel.fetch_commands()) == 1


def test_worker_shutdown_logs_when_all_workflow_runs_ended(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger=workflow_warm_shutdown.logger.name)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_count", lambda: 0)

    workflow_warm_shutdown._on_worker_shutdown()

    assert "after all tracked workflow runs ended" in caplog.text


def test_worker_shutdown_logs_remaining_workflow_runs(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger=workflow_warm_shutdown.logger.name)
    monkeypatch.setattr(workflow_warm_shutdown, "get_active_workflow_task_count", lambda: 2)

    workflow_warm_shutdown._on_worker_shutdown()

    assert "with 2 workflow run(s) still active after warm shutdown wait" in caplog.text


def test_drain_watchdog_returns_without_exit_when_registry_drains() -> None:
    fail_closed = MagicMock()
    hard_exit = MagicMock()

    workflow_warm_shutdown._run_workflow_drain_watchdog(
        timeout_seconds=0,
        fail_closed=fail_closed,
        hard_exit=hard_exit,
    )

    fail_closed.assert_not_called()
    hard_exit.assert_not_called()


def test_gunicorn_gevent_signal_callback_defers_watchdog_thread_start() -> None:
    """Exercise the real monkey-patched Thread.start from a gevent hub callback."""
    script = textwrap.dedent(
        """
        from gevent import monkey

        monkey.patch_all()

        import gevent
        from gevent.event import Event

        from extensions import workflow_warm_shutdown

        callback_finished = Event()
        watchdog_ran = Event()
        callback_errors = []

        workflow_warm_shutdown.dify_config.WORKFLOW_HANDOFF_ENABLED = True
        workflow_warm_shutdown.get_active_workflow_task_count = lambda: 0
        workflow_warm_shutdown._run_workflow_drain_watchdog = lambda **_: watchdog_ran.set()

        def signal_callback():
            try:
                workflow_warm_shutdown.begin_workflow_warm_shutdown(source="Gunicorn API worker")
            except BaseException as error:
                callback_errors.append(error)
            finally:
                callback_finished.set()

        gevent.get_hub().loop.run_callback(signal_callback)
        with gevent.Timeout(2):
            callback_finished.wait()
            watchdog_ran.wait()

        if callback_errors:
            raise callback_errors[0]
        if not workflow_warm_shutdown.workflow_warm_shutdown_started():
            raise AssertionError("warm shutdown flag was not set synchronously")
        """
    )

    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).parents[3],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"


def test_drain_watchdog_marks_active_run_then_hard_exits() -> None:
    fail_closed = MagicMock(return_value=1)
    hard_exit = MagicMock()

    with active_workflow_task("task-a", workflow_run_id="run-a"):
        workflow_warm_shutdown._run_workflow_drain_watchdog(
            timeout_seconds=0,
            fail_closed=fail_closed,
            hard_exit=hard_exit,
        )

    registrations = fail_closed.call_args.args[0]
    assert len(registrations) == 1
    assert registrations[0].workflow_run_id == "run-a"
    hard_exit.assert_called_once_with(1)


def test_drain_watchdog_observes_workflow_registered_after_shutdown_started() -> None:
    deadline_wait_started = threading.Event()
    release_deadline_wait = threading.Event()
    fail_closed = MagicMock(return_value=1)
    hard_exit = MagicMock()

    def wait_for_deadline(timeout_seconds: float) -> None:
        assert timeout_seconds == 600
        deadline_wait_started.set()
        assert release_deadline_wait.wait(timeout=1)

    def run_watchdog() -> None:
        workflow_warm_shutdown._run_workflow_drain_watchdog(
            timeout_seconds=600,
            fail_closed=fail_closed,
            hard_exit=hard_exit,
            wait_for_deadline=wait_for_deadline,
        )

    watchdog = threading.Thread(target=run_watchdog)
    watchdog.start()
    assert deadline_wait_started.wait(timeout=1)

    with active_workflow_task("late-task", workflow_run_id="late-run"):
        release_deadline_wait.set()
        watchdog.join(timeout=1)

    assert not watchdog.is_alive()
    registrations = fail_closed.call_args.args[0]
    assert len(registrations) == 1
    assert registrations[0].workflow_run_id == "late-run"
    hard_exit.assert_called_once_with(1)


def test_drain_watchdog_hard_exits_when_recoverable_handoff_skips_status_update() -> None:
    hard_exit = MagicMock()

    with active_workflow_task("task-a", workflow_run_id="run-a"):
        workflow_warm_shutdown._run_workflow_drain_watchdog(
            timeout_seconds=0,
            fail_closed=MagicMock(return_value=0),
            hard_exit=hard_exit,
        )

    hard_exit.assert_called_once_with(1)


def test_drain_watchdog_hard_exits_when_status_update_fails() -> None:
    hard_exit = MagicMock()

    with active_workflow_task("task-a", workflow_run_id="run-a"):
        workflow_warm_shutdown._run_workflow_drain_watchdog(
            timeout_seconds=0,
            fail_closed=MagicMock(side_effect=RuntimeError("database unavailable")),
            hard_exit=hard_exit,
        )

    hard_exit.assert_called_once_with(1)


def test_drain_deadline_conditionally_marks_owned_running_run_stopped() -> None:
    session_maker, workflow_run_id = _workflow_run_session_maker()

    with active_workflow_task("task-a", workflow_run_id=workflow_run_id):
        registrations = workflow_warm_shutdown.get_active_workflow_tasks()
        updated_count = workflow_warm_shutdown._mark_timed_out_workflow_runs_stopped(
            registrations,
            now=NOW,
            session_maker=session_maker,
        )

    with session_maker() as session:
        workflow_run = session.get(WorkflowRun, workflow_run_id)
        assert workflow_run is not None
        assert updated_count == 1
        assert workflow_run.status.value == "stopped"
        assert workflow_run.error == workflow_warm_shutdown.WORKFLOW_WARM_SHUTDOWN_TIMEOUT_REASON
        assert workflow_run.finished_at == NOW


def test_drain_deadline_preserves_user_stop_terminal_state() -> None:
    session_maker, workflow_run_id = _workflow_run_session_maker(
        status="stopped",
        error="stopped by user",
    )

    with active_workflow_task("task-a", workflow_run_id=workflow_run_id):
        registrations = workflow_warm_shutdown.get_active_workflow_tasks()
        updated_count = workflow_warm_shutdown._mark_timed_out_workflow_runs_stopped(
            registrations,
            now=NOW,
            session_maker=session_maker,
        )

    with session_maker() as session:
        workflow_run = session.get(WorkflowRun, workflow_run_id)
        assert workflow_run is not None
        assert updated_count == 0
        assert workflow_run.status.value == "stopped"
        assert workflow_run.error == "stopped by user"
        assert workflow_run.finished_at is None


@pytest.mark.parametrize("handoff_state", [WorkflowHandoffState.READY, WorkflowHandoffState.CLAIMED])
def test_drain_deadline_does_not_stop_run_with_recoverable_handoff(
    handoff_state: WorkflowHandoffState,
) -> None:
    session_maker, workflow_run_id = _workflow_run_session_maker()
    handoff_values = {
        "workflow_run_id": workflow_run_id,
        "generation": 1,
        "task_id": "task-a",
        "snapshot_object_key": "workflow-run-handoffs/run/checkpoint.json",
        "snapshot_schema_version": "workflow-resumption-context/v1",
        "snapshot_checksum": "0123456789abcdef",
        "snapshot_size_bytes": 128,
        "resume_route": "workflow",
        "source_worker_id": "worker-old",
        "state": handoff_state.value,
    }
    if handoff_state == WorkflowHandoffState.CLAIMED:
        handoff_values.update(
            {
                "lease_owner": "worker-new",
                "lease_token": str(uuid4()),
                "lease_expires_at": NOW + timedelta(minutes=2),
            }
        )
    with session_maker.begin() as session:
        session.execute(WorkflowRunHandoff.__table__.insert(), handoff_values)

    with active_workflow_task("task-a", workflow_run_id=workflow_run_id):
        registrations = workflow_warm_shutdown.get_active_workflow_tasks()
        updated_count = workflow_warm_shutdown._mark_timed_out_workflow_runs_stopped(
            registrations,
            now=NOW,
            session_maker=session_maker,
        )

    with session_maker() as session:
        workflow_run = session.get(WorkflowRun, workflow_run_id)
        assert workflow_run is not None
        assert updated_count == 0
        assert workflow_run.status.value == "running"
        assert workflow_run.finished_at is None


def test_setup_connects_shutdown_handlers(monkeypatch: pytest.MonkeyPatch) -> None:
    connect_shutting_down = MagicMock()
    connect_shutdown = MagicMock()
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", connect_shutting_down)
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", connect_shutdown)

    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()

    connect_shutting_down.assert_called_once()
    connect_shutdown.assert_called_once()


def test_setup_preserves_warm_shutdown_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutting_down, "connect", MagicMock())
    monkeypatch.setattr(workflow_warm_shutdown.worker_shutdown, "connect", MagicMock())

    workflow_warm_shutdown.mark_celery_warm_shutdown_started()
    workflow_warm_shutdown.setup_workflow_warm_shutdown_handler()

    commands = _create_warm_shutdown_command_channel().fetch_commands()

    assert workflow_warm_shutdown.celery_warm_shutdown_started() is True
    assert len(commands) == 1
