"""In-process scheduling for Dify Agent runs.

The scheduler is intentionally process-local: it persists a run record, starts an
``asyncio.Task`` for ``AgentRunRunner.run()``, and keeps only a transient active
task registry. Redis remains the durable source for status and event streams, but
there is no Redis job queue or cross-process handoff. If the process crashes,
currently active runs are lost until an external operator marks or retries them.
Create-run requests are accepted once the scheduler is not stopping and storage
can persist the run record. Request-shaped execution failures are left to
``AgentRunRunner`` so bad compositions, ``on_exit`` policies, prompts,
structured-output schemas, or session snapshots become asynchronous
``run_failed`` outcomes instead of synchronous HTTP rejections.
"""

import asyncio
import logging
from collections.abc import Callable
from typing import Protocol

import httpx

from agenton.compositor import LayerProviderInput
from dify_agent.protocol.schemas import CancelRunRequest, CancelRunResponse, CreateRunRequest
from dify_agent.runtime.compositor_factory import create_default_layer_providers
from dify_agent.runtime.event_sink import RunEventSink, emit_run_cancelled, emit_run_failed
from dify_agent.runtime.runner import AgentRunRunner
from dify_agent.server.schemas import RunRecord

logger = logging.getLogger(__name__)


class SchedulerStoppingError(RuntimeError):
    """Raised when a create-run request arrives after shutdown has started."""


class RunCancellationConflictError(RuntimeError):
    """Raised when a run exists but can no longer be cancelled by this scheduler."""


class RunStore(RunEventSink, Protocol):
    """Persistence boundary needed by the scheduler."""

    async def create_run(self) -> RunRecord:
        """Persist a new run record and return it with status ``running``."""
        ...

    async def get_run(self, run_id: str) -> RunRecord:
        """Return the latest persisted run record."""
        ...


class RunnableRun(Protocol):
    """Executable unit for one scheduled run."""

    async def run(self) -> None:
        """Run until terminal status/events have been written or cancellation occurs."""
        ...


type RunRunnerFactory = Callable[[RunRecord, CreateRunRequest], RunnableRun]


class RunScheduler:
    """Owns process-local run tasks and best-effort graceful shutdown.

    ``active_tasks`` is mutated only on the event loop that calls ``create_run``
    and ``shutdown``. The task registry is not durable; it exists so the lifespan
    hook can wait for in-flight work and mark cancelled runs failed before Redis is
    closed. A lock guards the stopping flag, run persistence, and task
    registration so shutdown cannot begin after a request is admitted.
    """

    store: RunStore
    shutdown_grace_seconds: float
    active_tasks: dict[str, asyncio.Task[None]]
    cancelled_run_ids: set[str]
    stopping: bool
    runner_factory: RunRunnerFactory
    layer_providers: tuple[LayerProviderInput, ...]
    plugin_daemon_http_client: httpx.AsyncClient
    dify_api_http_client: httpx.AsyncClient
    _lifecycle_lock: asyncio.Lock

    def __init__(
        self,
        *,
        store: RunStore,
        plugin_daemon_http_client: httpx.AsyncClient,
        dify_api_http_client: httpx.AsyncClient,
        shutdown_grace_seconds: float = 30,
        layer_providers: tuple[LayerProviderInput, ...] | None = None,
        runner_factory: RunRunnerFactory | None = None,
    ) -> None:
        self.store = store
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.active_tasks = {}
        self.cancelled_run_ids = set()
        self.stopping = False
        self.plugin_daemon_http_client = plugin_daemon_http_client
        self.dify_api_http_client = dify_api_http_client
        self.layer_providers = layer_providers if layer_providers is not None else create_default_layer_providers()
        self.runner_factory = runner_factory or self._default_runner_factory
        self._lifecycle_lock = asyncio.Lock()

    async def create_run(self, request: CreateRunRequest) -> RunRecord:
        """Persist and schedule one run in the current process.

        The returned record is already ``running``. The background task is removed
        from ``active_tasks`` when it finishes, regardless of success or failure.
        Request-shaped runtime failures are intentionally deferred to the runner so
        callers can observe them through the normal event/status stream.
        """
        async with self._lifecycle_lock:
            if self.stopping:
                raise SchedulerStoppingError("run scheduler is shutting down")
            record = await self.store.create_run()
            task = asyncio.create_task(self._run_record(record, request), name=f"dify-agent-run-{record.run_id}")
            self.active_tasks[record.run_id] = task
            task.add_done_callback(lambda _task, run_id=record.run_id: self._discard_active_run(run_id))
            return record

    async def cancel_run(self, run_id: str, request: CancelRunRequest) -> CancelRunResponse:
        """Cancel one active task and persist an idempotent cancelled terminal state."""
        async with self._lifecycle_lock:
            record = await self.store.get_run(run_id)
            if record.status == "cancelled":
                return CancelRunResponse(run_id=run_id, status="cancelled")
            if record.status != "running":
                raise RunCancellationConflictError(f"run already finished with status {record.status!r}")

            task = self.active_tasks.get(run_id)
            if task is None:
                raise RunCancellationConflictError("run is not active in this scheduler process")
            self.cancelled_run_ids.add(run_id)
            _ = task.cancel(request.message or request.reason)
            _ = await emit_run_cancelled(
                self.store,
                run_id=run_id,
                reason=request.reason,
                message=request.message,
            )
            await self.store.update_status(run_id, "cancelled", request.message or request.reason)

        # Some model/tool stacks can consume one CancelledError. Re-inject it
        # after the terminal state is durable without making the HTTP request
        # wait for arbitrary third-party cleanup.
        for _attempt in range(2):
            if task.done():
                break
            _ = task.cancel(request.message or request.reason)
            await asyncio.sleep(0)
        if task.done():
            self._discard_active_run(run_id)
        return CancelRunResponse(run_id=run_id, status="cancelled")

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

        pending_run_ids = [
            run_id
            for run_id, task in tasks_by_run_id.items()
            if task in pending and run_id not in self.cancelled_run_ids
        ]
        for task in pending:
            _ = task.cancel()
        _ = await asyncio.gather(*pending, return_exceptions=True)
        for run_id in pending_run_ids:
            await self._mark_cancelled_run_failed(run_id)

    async def _run_record(self, record: RunRecord, request: CreateRunRequest) -> None:
        """Execute a stored run and log failures already reflected in events."""
        try:
            await self.runner_factory(record, request).run()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("scheduled run failed", extra={"run_id": record.run_id})

    def _default_runner_factory(self, record: RunRecord, request: CreateRunRequest) -> RunnableRun:
        """Create the production runner for a stored run record."""
        return AgentRunRunner(
            sink=self.store,
            request=request,
            run_id=record.run_id,
            plugin_daemon_http_client=self.plugin_daemon_http_client,
            dify_api_http_client=self.dify_api_http_client,
            layer_providers=self.layer_providers,
            is_cancelled=lambda: record.run_id in self.cancelled_run_ids,
        )

    def _discard_active_run(self, run_id: str) -> None:
        _ = self.active_tasks.pop(run_id, None)
        self.cancelled_run_ids.discard(run_id)

    async def _mark_cancelled_run_failed(self, run_id: str) -> None:
        """Best-effort failure event/status for shutdown-cancelled runs."""
        message = "run cancelled during server shutdown"
        try:
            _ = await emit_run_failed(self.store, run_id=run_id, error=message, reason="shutdown")
            await self.store.update_status(run_id, "failed", message)
        except Exception:
            logger.exception("failed to mark cancelled run failed", extra={"run_id": run_id})


__all__ = ["RunCancellationConflictError", "RunScheduler", "SchedulerStoppingError"]
