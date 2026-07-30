from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from enum import Enum, auto

from configs import dify_config
from extensions.ext_redis import redis_client
from graphon.graph_engine.manager import GraphEngineManager

logger = logging.getLogger(__name__)


class AppExecutionState(Enum):
    RUNNING = auto()
    PAUSED = auto()
    ABORTING = auto()
    TERMINAL = auto()


def set_app_task_stop_flag(task_id: str) -> None:
    if not task_id:
        return

    redis_client.setex(f"generate_task_stopped:{task_id}", 600, 1)


class AppExecutionCoordinator:
    """Own cancellation policy for one app execution attempt.

    A resumed workflow creates a new coordinator even when it reuses the stable
    task ID. Listener segments only report lifecycle observations here; they do
    not send cancellation commands themselves.
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

        self.request_abort("Client response stream closed before app execution completed")

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
