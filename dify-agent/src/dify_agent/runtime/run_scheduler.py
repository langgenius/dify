"""In-process scheduling for Dify Agent runs.

The scheduler is intentionally process-local: it persists a run record, starts an
``asyncio.Task`` for ``AgentRunRunner.run()``, and keeps only a transient active
task registry. Redis remains the durable source for status and event streams, but
there is no Redis job queue or cross-process handoff. If the process crashes,
currently active runs are lost until an external operator marks or retries them.
Create-run validation enters a lightweight Agenton run before persistence so the
same transformed user prompts, optional structured output contract, and
top-level ``on_exit`` policy used by execution are checked without relying on
removed session/control APIs; Dify's default layers keep lifecycle hooks
side-effect free so this validation does not open plugin daemon clients.
"""

import asyncio
import logging
from collections.abc import Callable
from typing import Protocol

import httpx

from agenton.compositor import LayerProviderInput
from dify_agent.protocol.schemas import CreateRunRequest, normalize_composition
from dify_agent.runtime.agenton_validation import is_agenton_enter_validation_runtime_error
from dify_agent.runtime.compositor_factory import build_pydantic_ai_compositor, create_default_layer_providers
from dify_agent.runtime.event_sink import RunEventSink, emit_run_failed
from dify_agent.runtime.layer_exit_signals import apply_layer_exit_signals, validate_layer_exit_signals
from dify_agent.runtime.output_type import resolve_run_output_contract, validate_output_layer_composition
from dify_agent.runtime.runner import AgentRunRunner
from dify_agent.runtime.user_prompt_validation import EMPTY_USER_PROMPTS_ERROR, has_non_blank_user_prompt
from dify_agent.server.schemas import RunRecord

logger = logging.getLogger(__name__)


class SchedulerStoppingError(RuntimeError):
    """Raised when a create-run request arrives after shutdown has started."""


class RunRequestValidationError(ValueError):
    """Raised when a create-run request cannot produce an executable Agenton run."""


class RunStore(RunEventSink, Protocol):
    """Persistence boundary needed by the scheduler."""

    async def create_run(self) -> RunRecord:
        """Persist a new run record and return it with status ``running``."""
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
    closed. A lock guards the stopping flag, lightweight request validation, run
    persistence, and task registration so shutdown cannot begin after a request is
    admitted and no validation runs once stopping has been set.
    """

    store: RunStore
    shutdown_grace_seconds: float
    active_tasks: dict[str, asyncio.Task[None]]
    stopping: bool
    runner_factory: RunRunnerFactory
    layer_providers: tuple[LayerProviderInput, ...]
    plugin_daemon_http_client: httpx.AsyncClient
    _lifecycle_lock: asyncio.Lock

    def __init__(
        self,
        *,
        store: RunStore,
        plugin_daemon_http_client: httpx.AsyncClient,
        shutdown_grace_seconds: float = 30,
        layer_providers: tuple[LayerProviderInput, ...] | None = None,
        runner_factory: RunRunnerFactory | None = None,
    ) -> None:
        self.store = store
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.active_tasks = {}
        self.stopping = False
        self.plugin_daemon_http_client = plugin_daemon_http_client
        self.layer_providers = layer_providers if layer_providers is not None else create_default_layer_providers()
        self.runner_factory = runner_factory or self._default_runner_factory
        self._lifecycle_lock = asyncio.Lock()

    async def create_run(self, request: CreateRunRequest) -> RunRecord:
        """Validate, persist, and schedule one run in the current process.

        The returned record is already ``running``. The background task is removed
        from ``active_tasks`` when it finishes, regardless of success or failure.
        """
        async with self._lifecycle_lock:
            if self.stopping:
                raise SchedulerStoppingError("run scheduler is shutting down")
            await validate_run_request(request, layer_providers=self.layer_providers)
            record = await self.store.create_run()
            task = asyncio.create_task(self._run_record(record, request), name=f"dify-agent-run-{record.run_id}")
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
            layer_providers=self.layer_providers,
        )

    async def _mark_cancelled_run_failed(self, run_id: str) -> None:
        """Best-effort failure event/status for shutdown-cancelled runs."""
        message = "run cancelled during server shutdown"
        try:
            _ = await emit_run_failed(self.store, run_id=run_id, error=message, reason="shutdown")
            await self.store.update_status(run_id, "failed", message)
        except Exception:
            logger.exception("failed to mark cancelled run failed", extra={"run_id": run_id})


async def validate_run_request(
    request: CreateRunRequest,
    *,
    layer_providers: tuple[LayerProviderInput, ...] | None = None,
) -> None:
    """Validate create-run semantics that require an entered Agenton run.

    This boundary rejects unsupported output-layer graph shapes, unknown
    ``on_exit`` layer ids, effectively empty transformed user prompts, and known
    enter-time snapshot lifecycle errors before the scheduler persists a run
    record. It also exercises provider config validation, structured output
    contract construction, and snapshot hydration without touching external
    services because Dify plugin daemon clients are owned by the FastAPI
    lifespan, not Agenton lifecycle hooks.
    """
    resolved_layer_providers = layer_providers if layer_providers is not None else create_default_layer_providers()
    entered_run = False
    try:
        validate_output_layer_composition(request.composition)
        graph_config, layer_configs = normalize_composition(request.composition)
        compositor = build_pydantic_ai_compositor(
            graph_config,
            providers=resolved_layer_providers,
        )
        validate_layer_exit_signals(compositor, request.on_exit)
        async with compositor.enter(configs=layer_configs, session_snapshot=request.session_snapshot) as run:
            entered_run = True
            apply_layer_exit_signals(run, request.on_exit)
            if not has_non_blank_user_prompt(run.user_prompts):
                raise RunRequestValidationError(EMPTY_USER_PROMPTS_ERROR)
            _ = resolve_run_output_contract(run)
    except RunRequestValidationError:
        raise
    except RuntimeError as exc:
        if not entered_run and is_agenton_enter_validation_runtime_error(exc):
            raise RunRequestValidationError(str(exc)) from exc
        raise
    except (KeyError, TypeError, ValueError) as exc:
        raise RunRequestValidationError(str(exc)) from exc


__all__ = ["RunRequestValidationError", "RunScheduler", "SchedulerStoppingError", "validate_run_request"]
