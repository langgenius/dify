"""In-process scheduling for Dify Agent runs.

The scheduler is intentionally process-local: it persists a run record, starts an
``asyncio.Task`` supervisor for the local runner and cancellation observer, and
keeps only a transient active task registry. Redis remains the durable source for
status and event streams, but there is no Redis job queue or cross-process
handoff. If the process crashes, currently active runs are lost until an external
operator marks or retries them.
Create-run requests are accepted once the scheduler is not stopping and storage
can persist the run record. Request-shaped execution failures are left to
``AgentRunRunner`` so bad compositions, prompts,
structured-output schemas, or session snapshots become asynchronous
``run_failed`` outcomes instead of synchronous HTTP rejections.
"""

import asyncio
import logging
from collections.abc import AsyncGenerator, Callable
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import Protocol, runtime_checkable

from dify_agent.adapters.native_testing.transport import (
    AgentRuntimeHTTPClient,
    AgentRuntimeTransportError,
    bind_runtime_identity,
)
from dify_agent.protocol.native_testing import (
    NATIVE_TEST_CAPABILITIES,
    AgentNativeTestRef,
    AgentRuntimeIdentity,
    AgentRuntimeIdentitySeed,
    ContinuationClaim,
    ContinueRunRequest,
    NativeTestCapabilities,
    NativeTestProtocolUnsupported,
    ReadAgentRuntimeIdentity,
    executable_request_digest,
    require_native_test_capabilities,
)
from dify_agent.protocol.run_recovery import LookupRunRequest, create_run_fingerprint
from dify_agent.protocol.schemas import (
    AgentRunUsage,
    CancelRunRequest,
    CancelRunResponse,
    CreateRunRequest,
    CreateRunResponse,
    RunStatus,
)
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.runtime.cancellation import RunCancellationIntent
from dify_agent.runtime.confirmed_continuation import ConfirmedNativeContinuationOwner
from dify_agent.runtime.context import Services
from dify_agent.runtime.event_coalescer import (
    DEFAULT_TEXT_DELTA_FLUSH_INTERVAL_SECONDS,
    DEFAULT_TEXT_DELTA_MAX_CHARS,
)
from dify_agent.runtime.event_sink import RunEventSink, RunFinalizationResult, emit_run_failed
from dify_agent.runtime.native_continuation import (
    AgentCheckpoint,
    NativeContinuationConflict,
    NativeContinuationOwner,
    NativePolicyStopped,
    PreparedContinuation,
    validate_deferred_results,
)
from dify_agent.runtime.observability import AgentObservability
from dify_agent.runtime.runner import DEFAULT_AGENT_RUN_TIMEOUT_SECONDS, AgentRunRunner
from dify_agent.server.schemas import RunCreateClaim, RunRecord

logger = logging.getLogger(__name__)


class SchedulerStoppingError(RuntimeError):
    """Raised when a create-run request arrives after shutdown has started."""


class RunCancellationConflictError(RuntimeError):
    """Raised when a run exists but a different terminal state already won."""


@runtime_checkable
class IdempotentRunStore(Protocol):
    """Existing keyed-create storage API needed for capability advertisement."""

    async def claim_run(
        self, *, selection: LookupRunRequest, identity: AgentRuntimeIdentitySeed | None = None
    ) -> RunCreateClaim: ...

    async def lookup_run(self, selection: LookupRunRequest) -> CreateRunResponse: ...


class RunStore(RunEventSink, Protocol):
    """Persistence boundary needed by the scheduler."""

    async def read_run_identity(self, *, run_id: str, selection: ReadAgentRuntimeIdentity) -> AgentRuntimeIdentity: ...

    async def stop_native_run(self, *, run_id: str, expected_generation: int, reason_code: str) -> None: ...
    async def get_checkpoint(self, run_id: str) -> AgentCheckpoint: ...
    async def get_run(self, run_id: str) -> RunRecord: ...
    async def claim_continuation(
        self, *, run_id: str, expected_generation: int, idempotency_key: str
    ) -> ContinuationClaim: ...
    async def start_continuation(self, claim: ContinuationClaim) -> bool: ...

    async def claim_run(
        self, *, selection: LookupRunRequest, identity: AgentRuntimeIdentitySeed | None = None
    ) -> RunCreateClaim:
        """Atomically admit one keyed create; an existing record never schedules."""
        ...

    async def create_run(self, *, identity: AgentRuntimeIdentitySeed | None = None) -> RunRecord:
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
        session_snapshot: SessionSnapshot | None = None,
        usage: AgentRunUsage | None = None,
    ) -> RunFinalizationResult:
        """Publish cancellation after the owner runner has exited."""
        ...


class RunnableRun(Protocol):
    """Executable unit for one scheduled run."""

    @property
    def terminal_session_snapshot(self) -> SessionSnapshot | None:
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
    stream_text_delta_coalescing_enabled: bool
    stream_text_delta_flush_interval_seconds: float
    stream_text_delta_max_chars: int
    active_tasks: dict[str, asyncio.Task[None]]
    stopping: bool
    runner_factory: RunRunnerFactory | None
    services: Services
    agent_observability: AgentObservability | None
    _lifecycle_lock: asyncio.Lock

    def __init__(
        self,
        *,
        store: RunStore,
        services: Services,
        shutdown_grace_seconds: float = 30,
        run_timeout_seconds: float = DEFAULT_AGENT_RUN_TIMEOUT_SECONDS,
        stream_text_delta_coalescing_enabled: bool = True,
        stream_text_delta_flush_interval_seconds: float = DEFAULT_TEXT_DELTA_FLUSH_INTERVAL_SECONDS,
        stream_text_delta_max_chars: int = DEFAULT_TEXT_DELTA_MAX_CHARS,
        runner_factory: RunRunnerFactory | None = None,
        agent_observability: AgentObservability | None = None,
        native_owner: NativeContinuationOwner | None = None,
    ) -> None:
        if (
            native_owner is not None
            and (services.inner_api_key or services.plugin_daemon_api_key)
            and not (
                isinstance(native_owner, ConfirmedNativeContinuationOwner)
                and native_owner.profile == "confirmed"
                and isinstance(services.confirmed_api_http_client, AgentRuntimeHTTPClient)
            )
        ):
            raise AgentRuntimeTransportError("native_legacy_authority_unqualified")
        self.native_owner = native_owner
        self.store = store
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.run_timeout_seconds = run_timeout_seconds
        self.stream_text_delta_coalescing_enabled = stream_text_delta_coalescing_enabled
        self.stream_text_delta_flush_interval_seconds = stream_text_delta_flush_interval_seconds
        self.stream_text_delta_max_chars = stream_text_delta_max_chars
        self.active_tasks = {}
        self._active_continuation_claims: dict[str, ContinuationClaim] = {}
        self.stopping = False
        self.services = services
        self.runner_factory = runner_factory
        self.agent_observability = agent_observability
        self._lifecycle_lock = asyncio.Lock()

    @property
    def native_capabilities(self) -> NativeTestCapabilities:
        capabilities = self.native_owner.capabilities if self.native_owner is not None else NATIVE_TEST_CAPABILITIES
        if (
            self.services.confirmed_api_http_client is not None
            and isinstance(self.store, IdempotentRunStore)
            and callable(self.store.claim_run)
            and callable(self.store.lookup_run)
        ):
            return capabilities.model_copy(update={"features": capabilities.features | {"create-idempotency-v1"}})
        return capabilities

    async def continue_run(self, run_id: str, request: ContinueRunRequest) -> ContinuationClaim:
        if self.native_owner is None:
            raise NativeTestProtocolUnsupported()
        async with self._lifecycle_lock:
            if self.stopping:
                raise SchedulerStoppingError("run scheduler is shutting down")
            checkpoint = await self.store.get_checkpoint(run_id)
            require_native_test_capabilities(self.native_capabilities, profile=checkpoint.native_test_profile)
            if checkpoint.ref != request.ref or checkpoint.generation != request.expected_generation:
                raise NativeContinuationConflict("checkpoint owner or generation mismatch")
            claim = await self.store.claim_continuation(
                run_id=run_id, expected_generation=request.expected_generation, idempotency_key=request.idempotency_key
            )
            if run_id in self.active_tasks:
                # The local task may be a continuation paused before its Redis
                # start CAS. It already owns this claim; waiting for that task
                # would hold admission/shutdown until the whole run finishes.
                if self._active_continuation_claims.get(run_id) == claim:
                    return claim
                record = await self.store.get_run(run_id)
                if record.native_dispatch_started:
                    return claim
                # Waiting is visible before the old supervisor finishes draining
                # its cancellation observer. Do not lose the newly accepted intent.
                await asyncio.shield(self.active_tasks[run_id])
            # Restore immutable config and resolve the API-owned decisions before scheduling.
            try:
                async with self._transport_scope(
                    run_id,
                    expected_generation=checkpoint.generation,
                    expected_digest=checkpoint.config_digest,
                    expected_ref=checkpoint.ref,
                ):
                    prepared = await self.native_owner.restore(checkpoint=checkpoint)
                if checkpoint.stage == "tool" and prepared.deferred_tool_results is not None:
                    validate_deferred_results(checkpoint, prepared.deferred_tool_results)
            except NativePolicyStopped as stop:
                await self.store.stop_native_run(
                    run_id=run_id, expected_generation=request.expected_generation, reason_code=stop.reason_code
                )
                raise
            if (
                prepared.request.execution_mode != "builder_test"
                or prepared.request.native_test_ref != checkpoint.ref
                or prepared.continuation.ref != checkpoint.ref
                or prepared.continuation.run_id != run_id
                or prepared.continuation.config_digest != checkpoint.config_digest
                or prepared.continuation.config_ref != checkpoint.config_ref
                or prepared.request.session_snapshot != checkpoint.session_snapshot
            ):
                raise NativeContinuationConflict("protected continuation identity mismatch")
            if checkpoint.stage == "tool":
                if prepared.deferred_tool_results is None:
                    raise NativeContinuationConflict("missing native deferred results")
            elif prepared.deferred_tool_results is not None:
                raise NativeContinuationConflict("stage wait cannot supply tool results")
            prepared.continuation.generation = claim.generation
            prepared.continuation.history = checkpoint.history
            prepared.continuation.session_snapshot = checkpoint.session_snapshot
            prepared.continuation.operation_cursor = checkpoint.operation_cursor
            prepared.continuation.result_refs = checkpoint.result_refs
            prepared.continuation.job_refs = checkpoint.job_refs
            record = await self.store.get_run(run_id)
            task = asyncio.create_task(
                self._run_continuation(record, claim, prepared), name=f"dify-agent-continue-{claim.claim_id}"
            )
            self.active_tasks[run_id] = task
            self._active_continuation_claims[run_id] = claim
            task.add_done_callback(lambda completed: self._discard_active_run(run_id, completed))
            return claim

    async def _run_continuation(
        self, record: RunRecord, claim: ContinuationClaim, prepared: PreparedContinuation
    ) -> None:
        # The CAS is inside the scheduled task: lost HTTP/enqueue acknowledgement
        # can recover this same claim. Once consumed, dispatch is never replayed.
        if await self.store.start_continuation(claim):
            await self._run_record(record, prepared.request, native_prepared=prepared)

    async def create_run(self, request: CreateRunRequest) -> RunRecord:
        """Persist and schedule one run in the current process.

        The returned record is already ``running``. The background task is removed
        from ``active_tasks`` when it finishes, regardless of success or failure.
        Request-shaped runtime failures are intentionally deferred to the runner so
        callers can observe them through the normal event/status stream.
        """
        if request.execution_mode == "builder_test":
            require_native_test_capabilities(self.native_capabilities, profile=request.native_test_profile)
            if self.native_owner is None:
                raise NativeTestProtocolUnsupported()
        async with self._lifecycle_lock:
            if self.stopping:
                raise SchedulerStoppingError("run scheduler is shutting down")
            identity = AgentRuntimeIdentitySeed(
                execution_mode=request.execution_mode,
                native_test_profile=request.native_test_profile,
                parent_node=request.native_parent_node,
                request_digest=executable_request_digest(request),
            )
            if request.idempotency_key is None:
                record = await self.store.create_run(identity=identity)
            else:
                claim = await self.store.claim_run(
                    selection=LookupRunRequest(
                        idempotency_key=request.idempotency_key,
                        request_digest=create_run_fingerprint(request),
                    ),
                    identity=identity,
                )
                record = claim.record
                if not claim.inserted:
                    # Retention proves acceptance, not worker liveness. Never
                    # replay even if the winner crashed before task registration.
                    return record
            prepared = None
            if request.execution_mode == "builder_test" and self.native_owner is not None:
                try:
                    async with self._transport_scope(
                        record.run_id,
                        request=request,
                        expected_generation=0,
                        expected_digest=executable_request_digest(request),
                    ):
                        continuation = await self.native_owner.prepare(run_id=record.run_id, request=request)
                    if continuation.ref != request.native_test_ref or continuation.run_id != record.run_id:
                        raise NativeContinuationConflict("prepared native identity mismatch")
                    prepared = PreparedContinuation(request=request, continuation=continuation)
                except NativePolicyStopped as stop:
                    await emit_run_failed(
                        self.store, run_id=record.run_id, error=stop.reason_code, reason=stop.reason_code
                    )
                    raise
                except Exception:
                    await emit_run_failed(
                        self.store,
                        run_id=record.run_id,
                        error="native preparation unavailable",
                        reason="native_preparation_unavailable",
                    )
                    raise
            task = asyncio.create_task(
                self._run_record(record, request, native_prepared=prepared), name=f"dify-agent-run-{record.run_id}"
            )
            self.active_tasks[record.run_id] = task
            task.add_done_callback(lambda completed, run_id=record.run_id: self._discard_active_run(run_id, completed))
            return record

    async def cancel_run(self, run_id: str, request: CancelRunRequest) -> CancelRunResponse:
        """Persist an idempotent cancellation without relying on local task ownership."""
        status = await self.store.request_cancellation(run_id, request)
        if status in {"succeeded", "failed"}:
            raise RunCancellationConflictError(f"run already finished with status {status!r}")
        if status == "waiting":
            # Native wrap_run resources have already exited before waiting became visible.
            intent = await self.store.get_cancellation_intent(run_id)
            if intent is not None:
                await self.store.finalize_cancellation(run_id, intent)
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

    @asynccontextmanager
    async def _transport_scope(
        self,
        run_id: str,
        *,
        expected_generation: int,
        request: CreateRunRequest | None = None,
        expected_digest: str | None = None,
        expected_ref: AgentNativeTestRef | None = None,
    ) -> AsyncGenerator[None, None]:
        # Generic clients belong to explicit legacy composition or unit doubles.
        # Production strict clients always require the existing durable owner.
        confirmed = isinstance(self.services.confirmed_api_http_client, AgentRuntimeHTTPClient) and (
            (request is not None and request.execution_mode == "builder_test") or expected_ref is not None
        )
        if not isinstance(self.services.dify_api_http_client, AgentRuntimeHTTPClient) and not confirmed:
            yield
            return
        try:
            record = await self.store.get_run(run_id)
            seed = record.runtime_identity
            if seed is None or seed.run_id != run_id:
                raise ValueError("missing persisted Run identity")
            identity = await self.store.read_run_identity(
                run_id=run_id,
                selection=ReadAgentRuntimeIdentity(parent_node=seed.parent_node, request_digest=seed.request_digest),
            )
            if (
                identity.run_id != run_id
                or identity.parent_node != seed.parent_node
                or identity.request_digest != seed.request_digest
                or identity.execution_mode != seed.execution_mode
                or identity.native_test_profile != seed.native_test_profile
                or identity.agent_generation != expected_generation
                or (expected_digest is not None and identity.request_digest != expected_digest)
                or (
                    expected_ref is not None
                    and (identity.parent_node is None or identity.parent_node.ref != expected_ref)
                )
                or (
                    request is not None
                    and (
                        request.execution_mode != identity.execution_mode
                        or request.native_test_profile != identity.native_test_profile
                        or request.native_parent_node != identity.parent_node
                    )
                )
            ):
                raise ValueError("persisted Run identity changed")
        except Exception:
            raise AgentRuntimeTransportError("agent_runtime_identity_unavailable") from None
        with bind_runtime_identity(identity):
            yield

    async def _run_record(
        self, record: RunRecord, request: CreateRunRequest, *, native_prepared: PreparedContinuation | None = None
    ) -> None:
        # Restore occurs at the old durable generation. This fresh read happens
        # after start_continuation has atomically advanced that generation.
        try:
            async with self._transport_scope(
                record.run_id,
                request=request,
                expected_generation=native_prepared.continuation.generation if native_prepared is not None else 0,
                expected_digest=(
                    native_prepared.continuation.config_digest
                    if native_prepared is not None
                    else executable_request_digest(request)
                ),
            ):
                await self._run_bound_record(record, request, native_prepared=native_prepared)
        except AgentRuntimeTransportError:
            await emit_run_failed(
                self.store,
                run_id=record.run_id,
                error="Run transport unavailable",
                reason="agent_runtime_transport_unavailable",
            )
            raise

    async def _run_bound_record(
        self, record: RunRecord, request: CreateRunRequest, *, native_prepared: PreparedContinuation | None = None
    ) -> None:
        """Supervise one local runner and its durable cancellation observer."""
        cancel_requested = asyncio.Event()
        runner = self._create_runner(
            record, request, is_cancelled=cancel_requested.is_set, native_prepared=native_prepared
        )
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
        native_prepared: PreparedContinuation | None = None,
    ) -> RunnableRun:
        """Create a runner while keeping injected test runners source-compatible."""
        if self.runner_factory is not None:
            return self.runner_factory(record, request)
        return self._default_runner_factory(record, request, is_cancelled=is_cancelled, native_prepared=native_prepared)

    def _default_runner_factory(
        self,
        record: RunRecord,
        request: CreateRunRequest,
        *,
        is_cancelled: Callable[[], bool],
        native_prepared: PreparedContinuation | None = None,
    ) -> RunnableRun:
        """Create the production runner for a stored run record."""
        services = self.services
        if request.execution_mode == "builder_test" and request.native_test_profile == "confirmed":
            if services.confirmed_api_http_client is None:
                raise AgentRuntimeTransportError("native_run_bound_transport_required")
            services = replace(
                services,
                dify_api_http_client=services.confirmed_api_http_client,
                inner_api_key="",
                plugin_daemon_api_key="",
            )
        return AgentRunRunner(
            native_continuation=native_prepared.continuation if native_prepared is not None else None,
            deferred_tool_results=native_prepared.deferred_tool_results if native_prepared is not None else None,
            native_capabilities=self.native_capabilities,
            sink=self.store,
            request=request,
            run_id=record.run_id,
            services=services,
            is_cancelled=is_cancelled,
            run_timeout_seconds=self.run_timeout_seconds,
            stream_text_delta_coalescing_enabled=self.stream_text_delta_coalescing_enabled,
            stream_text_delta_flush_interval_seconds=self.stream_text_delta_flush_interval_seconds,
            stream_text_delta_max_chars=self.stream_text_delta_max_chars,
            agent_observability=self.agent_observability,
        )

    def _discard_active_run(self, run_id: str, task: asyncio.Task[None]) -> None:
        # A previous generation's callback cannot discard its replacement.
        if self.active_tasks.get(run_id) is task:
            _ = self.active_tasks.pop(run_id, None)
            _ = self._active_continuation_claims.pop(run_id, None)

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
        session_snapshot: SessionSnapshot | None = None,
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
