"""In-process scheduling for Dify Agent runs.

The scheduler is intentionally process-local: it persists a run record, starts an
``asyncio.Task`` supervisor for the local runner and cancellation observer, and
keeps only a transient active task registry. Redis remains the durable source for
status and event streams, but there is no Redis job queue or cross-process
handoff. If the process crashes, currently active runs are lost until an external
operator marks or retries them.
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

from agenton.compositor import CompositorSessionSnapshot, LayerProviderInput
from dify_agent.protocol.schemas import AgentRunUsage, CancelRunRequest, CancelRunResponse, CreateRunRequest, RunStatus
from dify_agent.runtime.cancellation import RunCancellationIntent
from dify_agent.runtime.compositor_factory import create_default_layer_providers
from dify_agent.runtime.event_sink import RunEventSink, RunFinalizationResult, emit_run_failed
from dify_agent.runtime.runner import DEFAULT_AGENT_RUN_TIMEOUT_SECONDS, AgentRunRunner
from dify_agent.server.schemas import RunRecord

logger = logging.getLogger(__name__)


class SchedulerStoppingError(RuntimeError):
    """Raised when a create-run request arrives after shutdown has started."""


class RunCancellationConflictError(RuntimeError):
    """Raised when a run exists but a different terminal state already won."""


class RunStore(RunEventSink, Protocol):
    """Persistence boundary needed by the scheduler."""

    async def create_run(self) -> RunRecord:
        """Persist a new run record and return it with status ``running``."""
        ...

    async def request_cancellation(self, run_id: str, request: CancelRunRequest) -> RunStatus:
        """Persist the first cancellation intent and return the current status."""
        ...

    async def get_cancellation_intent(self, run_id: str) -> RunCancellationIntent | None:
        """Return the accepted cancellation intent, if one exists."""
        ...

    async def wait_for_cancellation(self, run_id: str) -> RunCancellationIntent:
        """Wait for an accepted cancellation intent."""
        ...

    async def finalize_cancellation(
        self,
        run_id: str,
        intent: RunCancellationIntent,
        *,
        session_snapshot: CompositorSessionSnapshot | None = None,
        usage: AgentRunUsage | None = None,
    ) -> RunFinalizationResult:
        """Publish cancellation after the owner runner has exited."""
        ...


class RunnableRun(Protocol):
    """Executable unit for one scheduled run."""

    @property
    def terminal_session_snapshot(self) -> CompositorSessionSnapshot | None:
        """Return the post-exit snapshot for the current invocation, if available."""
        ...

    @property
    def terminal_usage(self) -> AgentRunUsage | None:
        """Return usage accumulated before this run exited, if available."""
        ...

    async def run(self) -> None:
        """Run until terminal status/events have been written or cancellation occurs."""
        ...


type RunRunnerFactory = Callable[[RunRecord, CreateRunRequest], RunnableRun]


class RunScheduler:
    """Owns process-local run tasks and best-effort graceful shutdown.

    ``active_tasks`` contains local supervisor tasks and is mutated only on the
    event loop that calls ``create_run`` and ``shutdown``. The task registry is not
    durable; it exists so the lifespan hook can wait for in-flight work and mark
    shutdown-cancelled runs failed before Redis is closed. It is not consulted
    when accepting cancellation requests. A lock guards the stopping flag, run
    persistence, and task registration so shutdown cannot begin after a request
    is admitted.
    """

    store: RunStore
    shutdown_grace_seconds: float
    run_timeout_seconds: float
    active_tasks: dict[str, asyncio.Task[None]]
    stopping: bool
    runner_factory: RunRunnerFactory | None
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
        run_timeout_seconds: float = DEFAULT_AGENT_RUN_TIMEOUT_SECONDS,
        layer_providers: tuple[LayerProviderInput, ...] | None = None,
        runner_factory: RunRunnerFactory | None = None,
    ) -> None:
        self.store = store
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.run_timeout_seconds = run_timeout_seconds
        self.active_tasks = {}
        self.stopping = False
        self.plugin_daemon_http_client = plugin_daemon_http_client
        self.dify_api_http_client = dify_api_http_client
        self.layer_providers = layer_providers if layer_providers is not None else create_default_layer_providers()
        self.runner_factory = runner_factory
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
        """Persist an idempotent cancellation without relying on local task ownership."""
        status = await self.store.request_cancellation(run_id, request)
        if status in {"succeeded", "failed"}:
            raise RunCancellationConflictError(f"run already finished with status {status!r}")
        return CancelRunResponse(run_id=run_id, status="cancelled")

    async def shutdown(self) -> None:
        """Stop accepting runs, wait briefly, then cancel and fail unfinished runs."""
        async with self._lifecycle_lock:
            self.stopping = True
            if not self.active_tasks:
                return
            tasks = tuple(self.active_tasks.values())
        _done, pending = await asyncio.wait(tasks, timeout=self.shutdown_grace_seconds)
        if not pending:
            return

        for task in pending:
            _ = task.cancel()
        _ = await asyncio.gather(*pending, return_exceptions=True)

    async def _run_record(self, record: RunRecord, request: CreateRunRequest) -> None:
        """Supervise one local runner and its durable cancellation observer."""
        cancel_requested = asyncio.Event()
        runner = self._create_runner(record, request, is_cancelled=cancel_requested.is_set)
        runner_task = asyncio.create_task(runner.run(), name=f"dify-agent-runner-{record.run_id}")
        observer_task = asyncio.create_task(
            self.store.wait_for_cancellation(record.run_id),
            name=f"dify-agent-cancellation-observer-{record.run_id}",
        )

        async def cancel_runner_and_wait() -> None:
            if not cancel_requested.is_set() and not runner_task.done():
                cancel_requested.set()
                _ = runner_task.cancel()
            _ = await asyncio.shield(asyncio.gather(runner_task, return_exceptions=True))

        try:
            _ = await asyncio.wait((runner_task, observer_task), return_when=asyncio.FIRST_COMPLETED)
            if observer_task.done():
                try:
                    intent = observer_task.result()
                except Exception as exc:
                    await cancel_runner_and_wait()
                    finalization = await emit_run_failed(
                        self.store,
                        run_id=record.run_id,
                        error=f"run cancellation observer failed: {exc}",
                        reason="cancellation_observer",
                        session_snapshot=runner.terminal_session_snapshot,
                        usage=runner.terminal_usage,
                    )
                    if not finalization.applied and finalization.status == "running":
                        intent = await self.store.get_cancellation_intent(record.run_id)
                        if intent is not None:
                            _ = await self.store.finalize_cancellation(
                                record.run_id,
                                intent,
                                session_snapshot=runner.terminal_session_snapshot,
                                usage=runner.terminal_usage,
                            )
                    raise

                await cancel_runner_and_wait()
                _ = await self.store.finalize_cancellation(
                    record.run_id,
                    intent,
                    session_snapshot=runner.terminal_session_snapshot,
                    usage=runner.terminal_usage,
                )
            else:
                runner_error: Exception | None = None
                try:
                    await runner_task
                except Exception as exc:
                    runner_error = exc

                intent = await self.store.get_cancellation_intent(record.run_id)
                if intent is not None:
                    _ = await self.store.finalize_cancellation(
                        record.run_id,
                        intent,
                        session_snapshot=runner.terminal_session_snapshot,
                        usage=runner.terminal_usage,
                    )
                if runner_error is not None:
                    raise runner_error
        except asyncio.CancelledError:
            await self._cancel_and_wait(observer_task)
            await cancel_runner_and_wait()
            intent = await self.store.get_cancellation_intent(record.run_id)
            if intent is not None:
                _ = await self.store.finalize_cancellation(
                    record.run_id,
                    intent,
                    session_snapshot=runner.terminal_session_snapshot,
                    usage=runner.terminal_usage,
                )
            else:
                finalization = await self._mark_cancelled_run_failed(
                    record.run_id,
                    session_snapshot=runner.terminal_session_snapshot,
                    usage=runner.terminal_usage,
                )
                if finalization is not None and not finalization.applied and finalization.status == "running":
                    intent = await self.store.get_cancellation_intent(record.run_id)
                    if intent is not None:
                        _ = await self.store.finalize_cancellation(
                            record.run_id,
                            intent,
                            session_snapshot=runner.terminal_session_snapshot,
                            usage=runner.terminal_usage,
                        )
            raise
        except Exception:
            logger.exception("scheduled run failed", extra={"run_id": record.run_id})
        finally:
            await self._cancel_and_wait(observer_task)
            if not runner_task.done():
                await cancel_runner_and_wait()

    def _create_runner(
        self,
        record: RunRecord,
        request: CreateRunRequest,
        *,
        is_cancelled: Callable[[], bool],
    ) -> RunnableRun:
        """Create a runner while keeping injected test runners source-compatible."""
        if self.runner_factory is not None:
            return self.runner_factory(record, request)
        return self._default_runner_factory(record, request, is_cancelled=is_cancelled)

    def _default_runner_factory(
        self,
        record: RunRecord,
        request: CreateRunRequest,
        *,
        is_cancelled: Callable[[], bool],
    ) -> RunnableRun:
        """Create the production runner for a stored run record."""
        return AgentRunRunner(
            sink=self.store,
            request=request,
            run_id=record.run_id,
            plugin_daemon_http_client=self.plugin_daemon_http_client,
            dify_api_http_client=self.dify_api_http_client,
            layer_providers=self.layer_providers,
            is_cancelled=is_cancelled,
            run_timeout_seconds=self.run_timeout_seconds,
        )

    def _discard_active_run(self, run_id: str) -> None:
        _ = self.active_tasks.pop(run_id, None)

    @staticmethod
    async def _cancel_and_wait(task: asyncio.Task[object]) -> None:
        """Cancel a child task once and await its complete exit."""
        if not task.done():
            _ = task.cancel()
        _ = await asyncio.gather(task, return_exceptions=True)

    async def _mark_cancelled_run_failed(
        self,
        run_id: str,
        *,
        session_snapshot: CompositorSessionSnapshot | None = None,
        usage: AgentRunUsage | None = None,
    ) -> RunFinalizationResult | None:
        """Best-effort failure event/status for shutdown-cancelled runs."""
        message = "run cancelled during server shutdown"
        try:
            return await emit_run_failed(
                self.store,
                run_id=run_id,
                error=message,
                reason="shutdown",
                session_snapshot=session_snapshot,
                usage=usage,
            )
        except Exception:
            logger.exception("failed to mark cancelled run failed", extra={"run_id": run_id})
            return None


__all__ = ["RunCancellationConflictError", "RunScheduler", "SchedulerStoppingError"]
