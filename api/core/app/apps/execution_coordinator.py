from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from enum import Enum, auto

from configs import dify_config
from extensions.ext_redis import redis_client
from graphon.graph_engine.command_channels import RedisChannel
from graphon.graph_engine.manager import GraphEngineManager

logger = logging.getLogger(__name__)


class AppExecutionState(Enum):
    RUNNING = auto()
    PAUSED = auto()
    ABORTING = auto()
    TERMINAL = auto()


def app_task_command_channel_key(task_id: str) -> str:
    """Redis key of the GraphEngine command channel for one app task."""
    return f"workflow:{task_id}:commands"


def set_app_task_stop_flag(task_id: str) -> None:
    if not task_id:
        return

    redis_client.setex(f"generate_task_stopped:{task_id}", 600, 1)


def clear_app_task_cancellation_signals(task_id: str) -> None:
    """Discard cancellation signals left over from earlier attempts of one task.

    Both cancellation channels are keyed by task ID and outlive the attempt that
    armed them: the stop flag lives for 600 seconds and a queued ``AbortCommand``
    for an hour, and neither is consumed while no engine is running. A resumed
    workflow deliberately reuses the paused run's task ID, so without this reset
    it inherits those signals and aborts itself as soon as it starts. Call this
    only when starting a new attempt that is meant to run, never mid-execution.
    """
    if not task_id:
        return

    try:
        redis_client.delete(f"generate_task_stopped:{task_id}")
    except Exception:
        logger.exception("Failed to clear stop flag for app task %s", task_id)

    channel_key = app_task_command_channel_key(task_id)
    try:
        # fetch_commands() drains the queue and its pending marker together; the
        # explicit delete covers a queue whose marker was already consumed.
        discarded = RedisChannel(redis_client, channel_key).fetch_commands()
        redis_client.delete(channel_key)
        if discarded:
            logger.info(
                "Discarded %s stale GraphEngine command(s) for app task %s",
                len(discarded),
                task_id,
            )
    except Exception:
        logger.exception("Failed to clear pending GraphEngine commands for app task %s", task_id)


class AppExecutionCoordinator:
    """Own cancellation policy for one app execution attempt.

    A resumed workflow creates a new coordinator even when it reuses the stable
    task ID. Listener segments only report lifecycle observations here; they do
    not send cancellation commands themselves. Response detachment is not an
    execution cancellation signal: streaming workflow execution may continue in
    another process and publish durable events for a later subscriber.
    """

    def __init__(
        self,
        *,
        task_id: str,
        on_timeout: Callable[[str], None],
        timeout_seconds: int | float | None = None,
    ) -> None:
        self._task_id = task_id
        self._attempt_id = str(uuid.uuid4())
        self._on_timeout = on_timeout
        self._timeout_seconds = timeout_seconds if timeout_seconds is not None else dify_config.APP_MAX_EXECUTION_TIME
        self._state = AppExecutionState.RUNNING
        self._abort_sent = False
        self._watchdog_started = False
        self._watchdog: threading.Timer | None = None
        self._lock = threading.Lock()

    @property
    def attempt_id(self) -> str:
        return self._attempt_id

    @property
    def state(self) -> AppExecutionState:
        with self._lock:
            return self._state

    def start_watchdog(self) -> None:
        watchdog: threading.Timer | None = None
        run_immediately = False
        with self._lock:
            if self._watchdog_started or self._state is not AppExecutionState.RUNNING:
                return

            self._watchdog_started = True
            if self._timeout_seconds <= 0:
                run_immediately = True
            else:
                watchdog = threading.Timer(self._timeout_seconds, self._handle_timeout)
                watchdog.daemon = True
                self._watchdog = watchdog

        if run_immediately:
            self._handle_timeout()
        elif watchdog is not None:
            watchdog.start()

    def mark_paused(self) -> None:
        watchdog: threading.Timer | None = None
        with self._lock:
            if self._state is not AppExecutionState.RUNNING:
                return
            self._state = AppExecutionState.PAUSED
            watchdog = self._detach_watchdog_locked()

        if watchdog is not None:
            watchdog.cancel()

    def mark_terminal(self) -> None:
        watchdog: threading.Timer | None = None
        with self._lock:
            self._state = AppExecutionState.TERMINAL
            watchdog = self._detach_watchdog_locked()

        if watchdog is not None:
            watchdog.cancel()

    def listener_closed(self, *, segment_completed: bool) -> None:
        if segment_completed:
            return

        logger.info(
            "App response listener detached while execution continues task=%s attempt=%s",
            self._task_id,
            self._attempt_id,
        )

    def request_abort(self, reason: str) -> bool:
        watchdog: threading.Timer | None = None
        with self._lock:
            if self._state is not AppExecutionState.RUNNING or self._abort_sent:
                return False
            self._abort_sent = True
            self._state = AppExecutionState.ABORTING
            watchdog = self._detach_watchdog_locked()

        if watchdog is not None:
            watchdog.cancel()

        logger.info(
            "Aborting app execution task=%s attempt=%s reason=%s",
            self._task_id,
            self._attempt_id,
            reason,
        )
        self._abort_execution(reason)
        return True

    def _handle_timeout(self) -> None:
        reason = f"App execution exceeded {self._timeout_seconds} seconds"
        if not self.request_abort(reason):
            return

        try:
            self._on_timeout(reason)
        except Exception:
            logger.exception(
                "Failed to publish timeout for app execution task=%s attempt=%s",
                self._task_id,
                self._attempt_id,
            )

    def _abort_execution(self, reason: str) -> None:
        try:
            set_app_task_stop_flag(self._task_id)
        except Exception:
            logger.exception(
                "Failed to set stop flag for app execution task=%s attempt=%s",
                self._task_id,
                self._attempt_id,
            )

        try:
            GraphEngineManager(redis_client).send_stop_command(self._task_id, reason=reason)
        except Exception:
            logger.exception(
                "Failed to send stop command for app execution task=%s attempt=%s",
                self._task_id,
                self._attempt_id,
            )

    def _detach_watchdog_locked(self) -> threading.Timer | None:
        watchdog = self._watchdog
        self._watchdog = None
        return watchdog
