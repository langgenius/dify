"""In-process scheduling for Dify Agent runs.

The scheduler is intentionally process-local: it persists a run record, starts an
``asyncio.Task`` for ``AgentRunRunner.run()``, and keeps only a transient active
task registry. Redis remains the durable source for status and event streams, but
there is no Redis job queue or cross-process handoff. If the process crashes,
currently active runs are lost until an external operator marks or retries them.
"""

import asyncio
import logging
from collections.abc import Callable
from typing import Protocol

from dify_agent.runtime.compositor_factory import build_pydantic_ai_compositor
from dify_agent.runtime.event_sink import RunEventSink, emit_run_event
from dify_agent.runtime.runner import AgentRunRunner
from dify_agent.runtime.user_prompt_validation import EMPTY_USER_PROMPTS_ERROR, has_non_blank_user_prompt
from dify_agent.server.schemas import CreateRunRequest, RunRecord

logger = logging.getLogger(__name__)


class SchedulerStoppingError(RuntimeError):
    """Raised when a create-run request arrives after shutdown has started."""


class RunStore(RunEventSink, Protocol):
    """Persistence boundary needed by the scheduler."""

    async def create_run(self, request: CreateRunRequest) -> RunRecord:
        """Persist a new run record and return it with status ``running``."""
        ...


class RunnableRun(Protocol):
    """Executable unit for one scheduled run."""

    async def run(self) -> None:
        """Run until terminal status/events have been written or cancellation occurs."""
        ...


type RunRunnerFactory = Callable[[RunRecord], RunnableRun]


class RunScheduler:
    """Owns process-local run tasks and best-effort graceful shutdown.

    ``active_tasks`` is mutated only on the event loop that calls ``create_run``
    and ``shutdown``. The task registry is not durable; it exists so the lifespan
    hook can wait for in-flight work and mark cancelled runs failed before Redis is
    closed. A lock guards the stopping flag, run persistence, and task
    registration so shutdown cannot complete while a run is between record
    creation and active-task tracking.
    """

    store: RunStore
    shutdown_grace_seconds: float
    active_tasks: dict[str, asyncio.Task[None]]
    stopping: bool
    runner_factory: RunRunnerFactory
    _lifecycle_lock: asyncio.Lock

    def __init__(
        self,
        *,
        store: RunStore,
        shutdown_grace_seconds: float = 30,
        runner_factory: RunRunnerFactory | None = None,
    ) -> None:
        self.store = store
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.active_tasks = {}
        self.stopping = False
        self.runner_factory = runner_factory or self._default_runner_factory
        self._lifecycle_lock = asyncio.Lock()

    async def create_run(self, request: CreateRunRequest) -> RunRecord:
        """Validate, persist, and schedule one run in the current process.

        The returned record is already ``running``. The background task is removed
        from ``active_tasks`` when it finishes, regardless of success or failure.
        """
        compositor = build_pydantic_ai_compositor(request.compositor)
        if not has_non_blank_user_prompt(compositor.user_prompts):
            raise ValueError(EMPTY_USER_PROMPTS_ERROR)

        async with self._lifecycle_lock:
            if self.stopping:
                raise SchedulerStoppingError("run scheduler is shutting down")
            record = await self.store.create_run(request)
            task = asyncio.create_task(self._run_record(record), name=f"dify-agent-run-{record.run_id}")
            self.active_tasks[record.run_id] = task
            task.add_done_callback(lambda _task, run_id=record.run_id: self.active_tasks.pop(run_id, None))
            return record

    async def shutdown(self) -> None:
        """Stop accepting runs, wait briefly, then cancel and fail unfinished runs."""
        async with self._lifecycle_lock:
            self.stopping = True
            if not self.active_tasks:
                return
            tasks_by_run_id = dict(self.active_tasks)
        done, pending = await asyncio.wait(tasks_by_run_id.values(), timeout=self.shutdown_grace_seconds)
        del done
        if not pending:
            return

        pending_run_ids = [run_id for run_id, task in tasks_by_run_id.items() if task in pending]
        for task in pending:
            _ = task.cancel()
        _ = await asyncio.gather(*pending, return_exceptions=True)
        for run_id in pending_run_ids:
            await self._mark_cancelled_run_failed(run_id)

    async def _run_record(self, record: RunRecord) -> None:
        """Execute a stored run and log failures already reflected in events."""
        try:
            await self.runner_factory(record).run()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("scheduled run failed", extra={"run_id": record.run_id})

    def _default_runner_factory(self, record: RunRecord) -> RunnableRun:
        """Create the production runner for a stored run record."""
        return AgentRunRunner(sink=self.store, request=record.request, run_id=record.run_id)

    async def _mark_cancelled_run_failed(self, run_id: str) -> None:
        """Best-effort failure event/status for shutdown-cancelled runs."""
        message = "run cancelled during server shutdown"
        try:
            _ = await emit_run_event(
                self.store,
                run_id=run_id,
                type="run_failed",
                data={"error": message, "reason": "shutdown"},
            )
            await self.store.update_status(run_id, "failed", message)
        except Exception:
            logger.exception("failed to mark cancelled run failed", extra={"run_id": run_id})


__all__ = ["RunScheduler", "SchedulerStoppingError"]
