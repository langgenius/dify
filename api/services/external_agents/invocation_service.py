"""Bounded external Invocation orchestration through consumer-owned ports.

Workers execute one leased command and return. Durable Commands carry every
future poll/deadline/wake; no sleep, open stream or transaction survives a wait.
Business sends require a newly committed dispatch permit and are never replayed.
"""

import logging
from dataclasses import replace
from datetime import datetime, timedelta
from hashlib import sha256

from .invocation_agg import ExternalInvocationAgg, InvocationTransition, remote_state
from .io_contracts import ExternalIOError
from .protocol import TRACEABILITY_URI, ConnectionSpec, GatewayError, GatewayPort, GatewayReceipt
from .runtime_contracts import (
    CancelState,
    CommandDraft,
    CommandKind,
    Invocation,
    InvocationDraft,
    InvocationStore,
    LeasedCommand,
    LocalState,
    OutputNormalizer,
    ReceiptObserver,
    RequestPartsBuilder,
    RuntimeClock,
    RuntimeConflictError,
    RuntimeConnectionReader,
    RuntimeError,
    RuntimeIdFactory,
    RuntimeResult,
    RuntimeScope,
    RuntimeSettings,
    SubmissionState,
    TimeoutPolicy,
    WorkflowWakePort,
)

_DENIED_READ = frozenset({"authentication_failed", "permission_denied", "credential_unavailable", "invalid_credential"})
_NO_CANCEL = frozenset({"cancellation_unsupported", "operation_unsupported", "cancel_unsupported"})
logger = logging.getLogger(__name__)


class ExternalInvocationService:
    """Execute admitted business use cases; adapters supply storage, time and I/O."""

    def __init__(
        self,
        *,
        store: InvocationStore,
        connections: RuntimeConnectionReader,
        gateway: GatewayPort,
        inputs: RequestPartsBuilder,
        outputs: OutputNormalizer,
        observer: ReceiptObserver,
        wake: WorkflowWakePort,
        clock: RuntimeClock,
        ids: RuntimeIdFactory,
        settings: RuntimeSettings,
    ) -> None:
        self._store = store
        self._connections = connections
        self._gateway = gateway
        self._inputs = inputs
        self._outputs = outputs
        self._observer = observer
        self._wake = wake
        self._clock = clock
        self._ids = ids
        self._settings = settings

    def start(self, scope: RuntimeScope, draft: InvocationDraft) -> Invocation:
        """Persist one owned execution intent; duplicate identity cannot create another Send."""
        if not self._settings.admission_enabled:
            raise RuntimeError("external_agents_disabled", "External agents are disabled on this deployment.")
        return self._store.create(scope, draft, now=self._clock.now())

    def result(self, scope: RuntimeScope, invocation_id: str) -> RuntimeResult:
        """Read fixed state without consuming it; graph checkpoint owns progress confirmation."""
        value = self._store.get(scope, invocation_id)
        if scope.origin == "overview_test" and (
            value.deleted
            or (
                value.local_wait_ended_at is not None
                and self._clock.now() >= value.local_wait_ended_at + timedelta(seconds=self._settings.tracking_seconds)
            )
        ):
            raise RuntimeError("test_expired", "The temporary test result has expired.")
        return RuntimeResult(
            invocation_id=value.id,
            state=value.local_state,
            outputs=value.outputs,
            error_code=value.error_code,
            error_message=value.error_message,
            metadata={
                "invocation_id": value.id,
                "agent_id": value.agent_id,
                "test_generation": value.test_generation,
                "external_task_id": value.remote_task_id,
                "external_task_status": value.remote_state,
                "submission_state": value.submission_state.value,
                "cancellation_state": value.cancel_state.value,
                "connection_revision_id": value.connection_revision_id,
                "sequence": value.sequence,
                "asset_snapshot": value.asset_snapshot,
            },
        )

    def logical_result(self, scope: RuntimeScope, anchor_invocation_id: str) -> RuntimeResult:
        """Resolve an owned test's retry chain without retargeting other tests.

        The resource anchor is a persisted Invocation, not the page's selected
        Agent. Exact Invocation reads/cancellation keep their existing meaning.
        """
        anchor = self._store.get(scope, anchor_invocation_id)
        latest = self._store.for_execution(scope, anchor.identity) or anchor
        if (
            latest.agent_id != anchor.agent_id
            or latest.test_generation != anchor.test_generation
            or latest.identity != anchor.identity
        ):
            raise RuntimeConflictError()
        result = self.result(scope, latest.id)
        return replace(result, metadata={**result.metadata, "anchor_invocation_id": anchor_invocation_id})

    def cancel(self, scope: RuntimeScope, invocation_id: str) -> Invocation:
        """Request cancellation of this exact Invocation, never the page's current selection."""
        value = self._store.get(scope, invocation_id)
        return self._cancel_exact(value, attempts=3)

    def _cancel_exact(self, value: Invocation, *, attempts: int) -> Invocation:
        """Give explicit Cancel priority over a pending timeout retry, with no HTTP replay."""
        now = self._clock.now()
        agg = ExternalInvocationAgg(value, self._settings)
        if value.local_state == LocalState.RETRY_PENDING:
            transition = agg.stop(now)
        elif value.local_state != LocalState.WAITING:
            return value
        elif value.remote_task_id is None:
            transition = agg.stop(now)
        elif value.cancel_state == CancelState.REQUESTED:
            if value.cancel_trigger == "user":
                return value
            transition = InvocationTransition(replace(value, version=value.version + 1, cancel_trigger="user"))
        else:
            deadline = min(now + timedelta(seconds=self._settings.cancellation_window_seconds), value.logical_deadline)
            transition = InvocationTransition(
                replace(
                    value,
                    version=value.version + 1,
                    cancel_state=CancelState.REQUESTED,
                    cancel_trigger="user",
                    cancellation_deadline=deadline,
                ),
                (agg.command(CommandKind.CANCEL, now), agg.command(CommandKind.DEADLINE, deadline)),
            )
        result = self._commit(value, transition)
        needs_priority = result.local_state == LocalState.RETRY_PENDING or (
            result.local_state == LocalState.WAITING
            and not (result.cancel_state == CancelState.REQUESTED and result.cancel_trigger == "user")
        )
        if needs_priority:
            if attempts <= 1:
                raise RuntimeConflictError()
            return self._cancel_exact(result, attempts=attempts - 1)
        return result

    def stop(self, scope: RuntimeScope, invocation_id: str) -> Invocation:
        """Finalize local stop durably; no remote response may revive the caller afterwards."""
        value = self._store.get(scope, invocation_id)
        return self._commit(value, ExternalInvocationAgg(value, self._settings).stop(self._clock.now()))

    def reconcile(self, scope: RuntimeScope, *, now: datetime | None = None) -> int:
        """Reject orphaned preparation or mark entered Send unknown, without replaying I/O."""
        return self._store.reconcile(scope, now=self._clock.now() if now is None else now)

    def run_command(self, scope: RuntimeScope, command_id: str) -> None:
        """Lease and perform one bounded command; repeated delivery cannot resend business work.

        The command repository enforces owner scope, query concurrency and fences.
        On an uncertain post-send crash, reconciliation records Unknown instead
        of restoring dispatch eligibility.
        """
        command = self._store.lease_command(
            scope, command_id, now=self._clock.now(), lease_seconds=self._settings.command_lease_seconds
        )
        if command is None:
            return
        completed = True
        try:
            value = self._store.get(scope, command.invocation_id)
            if value.deleted:
                return
            if value.local_state in {LocalState.WAITING, LocalState.RETRY_PENDING} and self._store.execution_stopped(
                scope, value.identity
            ):
                value = self._commit(value, ExternalInvocationAgg(value, self._settings).stop(self._clock.now()))
                if not command.background and command.kind != CommandKind.WAKE:
                    return
            if command.kind == CommandKind.WAKE:
                self._run_wake(value)
            elif command.kind == CommandKind.DISPATCH:
                self._dispatch(value)
            elif command.kind == CommandKind.RETRY:
                self._retry(value)
            else:
                self._run_observation_command(value, command)
        except BaseException:
            completed = False
            raise
        finally:
            if completed:
                self._store.complete_command(command)

    def _commit(self, previous: Invocation, transition: InvocationTransition) -> Invocation:
        if transition.invocation is previous and not transition.commands:
            return previous
        if self._store.save(previous.scope, previous, transition.invocation, commands=transition.commands):
            return transition.invocation
        # Losing CAS never causes a repeat of the I/O that produced this result.
        return self._store.get(previous.scope, previous.id)

    def _run_wake(self, value: Invocation) -> None:
        if not self._wake.wake(value.scope, value):
            now = self._clock.now()
            agg = ExternalInvocationAgg(value, self._settings)
            self._commit(
                value,
                InvocationTransition(
                    replace(value, version=value.version + 1),
                    (agg.command(CommandKind.WAKE, now + timedelta(seconds=self._settings.poll_interval_seconds)),),
                ),
            )

    def _dispatch(self, queued: Invocation) -> None:
        if not self._settings.admission_enabled:
            if queued.submission_state == SubmissionState.PREPARED:
                self._commit(
                    queued,
                    ExternalInvocationAgg(queued, self._settings).submission_failed(
                        self._clock.now(),
                        code="external_agents_disabled",
                        message="New external dispatch is disabled.",
                        unknown=False,
                    ),
                )
            return
        try:
            value = self._store.acquire_dispatch(queued.scope, queued.id, now=self._clock.now())
        except RuntimeError as error:
            if error.code == "execution_not_persisted" and self._clock.now() < queued.logical_deadline:
                agg = ExternalInvocationAgg(queued, self._settings)
                self._commit(
                    queued,
                    InvocationTransition(
                        replace(queued, version=queued.version + 1),
                        (agg.command(CommandKind.DISPATCH, self._clock.now() + timedelta(seconds=1)),),
                    ),
                )
                return
            self._commit(
                queued,
                ExternalInvocationAgg(queued, self._settings).submission_failed(
                    self._clock.now(), code=error.code, message=str(error), unknown=False
                ),
            )
            return
        if value is None:
            return
        agg = ExternalInvocationAgg(value, self._settings)
        try:
            # Constructing raw Parts is temporary. Only references were persisted.
            request = self._inputs.build(value)
            connection = self._connection(value)
            timeout = self._io_timeout(value, self._clock.now())
            admitted = self._store.begin_send(value.scope, value, now=self._clock.now())
            if admitted is None:
                return
            value = admitted
            agg = ExternalInvocationAgg(value, self._settings)
        except (ExternalIOError, RuntimeError, GatewayError) as error:
            self._commit(
                value,
                agg.submission_failed(self._clock.now(), code=error.code, message=str(error), unknown=False),
            )
            return
        try:
            receipt = self._gateway.send(
                connection,
                request,
                streaming=bool(value.job.get("streaming", False)),
                timeout_seconds=min(timeout, self._settings.sse_window_seconds),
            )
        except GatewayError as error:
            if error.known_receipt is not None:
                self._observe(value, error.known_receipt)
            else:
                self._commit(
                    value,
                    agg.submission_failed(
                        self._clock.now(), code=error.code, message=str(error), unknown=error.submission_unknown
                    ),
                )
            return
        self._observe(value, receipt)

    def _connection(self, value: Invocation) -> ConnectionSpec:
        if value.connection_revision_id is None:
            raise RuntimeError("dispatch_not_admitted", "The Invocation has no frozen connection.")
        connection = self._connections.read(value.scope, value.agent_id, value.connection_revision_id)
        if value.tracing_enabled:
            connection = replace(
                connection, enabled_extensions=tuple(dict.fromkeys((*connection.enabled_extensions, TRACEABILITY_URI)))
            )
        return connection

    def _io_timeout(self, value: Invocation, now: datetime, *, background: bool = False) -> float:
        if background:
            deadline = value.tracking_deadline
            if deadline is None:
                raise RuntimeError("deadline_exceeded", "External background tracking is unavailable.")
        else:
            deadline = value.logical_deadline
            if value.cancel_state == CancelState.REQUESTED and value.cancellation_deadline is not None:
                deadline = min(deadline, value.cancellation_deadline)
            elif value.wait_deadline is not None:
                deadline = min(deadline, value.wait_deadline)
        if deadline is None or deadline <= now:
            raise RuntimeError("deadline_exceeded", "The external I/O budget was exhausted.")
        return min(self._settings.io_timeout_seconds, (deadline - now).total_seconds())

    def _run_observation_command(self, value: Invocation, command: LeasedCommand) -> None:
        now = self._clock.now()
        if command.kind == CommandKind.DEADLINE:
            self._commit(value, ExternalInvocationAgg(value, self._settings).expire(now))
            return
        if value.queries_blocked:
            return
        if command.background:
            if (
                value.tracking_deadline is None
                or now >= value.tracking_deadline
                or value.background_queries >= self._settings.background_max_queries
                or remote_state(value.remote_state) in {"completed", "canceled", "failed", "rejected"}
            ):
                return
        else:
            expired = ExternalInvocationAgg(value, self._settings).expire(now)
            if expired.invocation is not value:
                self._commit(value, expired)
                return
            if value.local_state != LocalState.WAITING:
                return
        task_id = value.remote_task_id
        if task_id is None:
            return
        if command.background:
            counted = replace(value, version=value.version + 1, background_queries=value.background_queries + 1)
            if not self._store.save(value.scope, value, counted):
                return
            value = counted
        try:
            connection = self._connection(value)
            timeout = self._io_timeout(value, self._clock.now(), background=command.background)
            receipt = (
                self._gateway.cancel_task(connection, task_id, timeout_seconds=timeout)
                if command.kind == CommandKind.CANCEL
                else self._gateway.get_task(connection, task_id, timeout_seconds=timeout)
            )
        except GatewayError as error:
            self._read_failed(value, command, error)
            return
        except RuntimeError as error:
            transition = ExternalInvocationAgg(value, self._settings).expire(self._clock.now())
            if transition.invocation is value:
                transition = ExternalInvocationAgg(value, self._settings).observation_failed(
                    self._clock.now(),
                    code=error.code,
                    message=str(error),
                )
            self._commit(value, transition)
            return
        self._observe(value, receipt, background=command.background)

    def _observe(self, value: Invocation, receipt: GatewayReceipt, *, background: bool = False) -> None:
        if value.local_state in {LocalState.WAITING, LocalState.RETRY_PENDING} and self._store.execution_stopped(
            value.scope, value.identity
        ):
            value = self._commit(value, ExternalInvocationAgg(value, self._settings).stop(self._clock.now()))
        agg = ExternalInvocationAgg(value, self._settings)
        now = self._clock.now()
        try:
            agg.validate_observation(receipt)
        except RuntimeError as error:
            self._commit(value, agg.observation_failed(now, code=error.code, message=str(error)))
            return
        try:
            self._observer.observe(value, receipt)
        except Exception:
            logger.warning("External receipt observation failed: invocation_id=%s", value.id)
        completed = receipt.kind == "message" or remote_state(receipt.state) == "completed"
        outputs = None
        output_error = None
        can_publish = (
            value.local_state == LocalState.WAITING
            and now < value.logical_deadline
            and not (
                value.policy.on_timeout == TimeoutPolicy.END_WAITING
                and value.wait_deadline is not None
                and now >= value.wait_deadline
            )
            and not (value.cancellation_deadline is not None and now >= value.cancellation_deadline)
        )
        if completed and can_publish:
            try:
                outputs = self._outputs.normalize(value, receipt)
            except (ExternalIOError, RuntimeError) as error:
                output_error = (error.code, str(error))
        self._persist_observation(value, receipt, outputs=outputs, output_error=output_error, background=background)

    def _persist_observation(
        self,
        value: Invocation,
        receipt: GatewayReceipt,
        *,
        outputs,
        output_error: tuple[str, str] | None,
        background: bool,
        attempts: int = 3,
    ) -> None:
        """Merge a CAS race without repeating network or file I/O.

        Cancellation/deadline commands may have advanced the same Invocation
        while GetTask was running. Reapply this already validated observation to
        the latest record; a local terminal state can acquire remote history but
        cannot regain outputs or start another business dispatch.
        """
        if value.local_state in {LocalState.WAITING, LocalState.RETRY_PENDING} and self._store.execution_stopped(
            value.scope, value.identity
        ):
            value = self._commit(value, ExternalInvocationAgg(value, self._settings).stop(self._clock.now()))
        agg = ExternalInvocationAgg(value, self._settings)
        try:
            agg.validate_observation(receipt)
        except RuntimeError:
            return
        transition = (
            agg.output_failed(receipt, self._clock.now(), code=output_error[0], message=output_error[1])
            if output_error is not None and value.local_state == LocalState.WAITING
            else agg.receive(receipt, self._clock.now(), outputs=outputs)
        )
        if background and remote_state(receipt.state) not in {"completed", "canceled", "failed", "rejected"}:
            transition = replace(transition, commands=self._next_poll(value, background=True))
        elif any(command.kind == CommandKind.POLL and not command.background for command in transition.commands):
            transition = replace(
                transition,
                commands=(
                    *tuple(command for command in transition.commands if command.kind != CommandKind.POLL),
                    *self._next_poll(transition.invocation, background=False),
                ),
            )
        if transition.invocation is value and not transition.commands:
            return
        if (
            not self._store.save(value.scope, value, transition.invocation, commands=transition.commands)
            and attempts > 1
        ):
            latest = self._store.get(value.scope, value.id)
            if not latest.deleted:
                self._persist_observation(
                    latest,
                    receipt,
                    outputs=outputs,
                    output_error=output_error,
                    background=background,
                    attempts=attempts - 1,
                )

    def _delay(self, value: Invocation, *, background: bool, retry_after: float | None = None) -> float:
        base = (
            min(
                self._settings.background_initial_interval_seconds * 2 ** min(value.background_queries, 3),
                self._settings.background_max_interval_seconds,
            )
            if background
            else self._settings.poll_interval_seconds
        )
        jitter = int.from_bytes(sha256(f"{value.id}:{value.version}".encode()).digest()[:2]) / 65536
        delay = (
            min(float(base) + jitter, self._settings.background_max_interval_seconds) if background else base + jitter
        )
        return max(delay, retry_after or 0)

    def _next_poll(
        self, value: Invocation, *, background: bool, retry_after: float | None = None
    ) -> tuple[CommandDraft, ...]:
        now = self._clock.now()
        if value.queries_blocked:
            return ()
        if background and (
            value.tracking_deadline is None
            or now >= value.tracking_deadline
            or value.background_queries >= self._settings.background_max_queries
        ):
            return ()
        due = now + timedelta(seconds=self._delay(value, background=background, retry_after=retry_after))
        deadline = (
            value.tracking_deadline
            if background
            else (value.cancellation_deadline or value.wait_deadline or value.logical_deadline)
        )
        if deadline is not None and due >= deadline:
            return ()
        return (ExternalInvocationAgg(value, self._settings).command(CommandKind.POLL, due, background=background),)

    def _read_failed(self, value: Invocation, command: LeasedCommand, error: GatewayError) -> None:
        agg = ExternalInvocationAgg(value, self._settings)
        if command.kind == CommandKind.CANCEL:
            if error.code not in _DENIED_READ | _NO_CANCEL | {"cancellation_rejected"}:
                # An uncertain cancellation response is not an authoritative
                # rejection. Spend only the original confirmation window on
                # GetTask; never issue another business Send or Cancel POST.
                expired = agg.expire(self._clock.now())
                transition = (
                    expired
                    if expired.invocation is not value
                    else InvocationTransition(
                        replace(value, version=value.version + 1, observation_error_code=error.code),
                        self._next_poll(value, background=False, retry_after=error.retry_after_seconds),
                    )
                )
                self._commit(value, transition)
                return
            transition = agg.cancellation_failed(
                self._clock.now(), code=error.code, message=str(error), unsupported=error.code in _NO_CANCEL
            )
            if error.code in _DENIED_READ:
                transition = replace(
                    transition,
                    invocation=replace(transition.invocation, queries_blocked=True, observation_error_code=error.code),
                    commands=tuple(item for item in transition.commands if item.kind != CommandKind.POLL),
                )
            self._commit(value, transition)
            return
        if error.code in _DENIED_READ or not error.retryable:
            if not command.background:
                transition = agg.observation_failed(self._clock.now(), code=error.code, message=str(error))
                transition = replace(
                    transition,
                    invocation=replace(transition.invocation, queries_blocked=True, observation_error_code=error.code),
                )
            else:
                transition = InvocationTransition(
                    replace(value, version=value.version + 1, queries_blocked=True, observation_error_code=error.code)
                )
            self._commit(value, transition)
            return
        self._commit(
            value,
            InvocationTransition(
                replace(value, version=value.version + 1),
                self._next_poll(value, background=command.background, retry_after=error.retry_after_seconds),
            ),
        )

    def _retry(self, value: Invocation) -> None:
        if not self._settings.admission_enabled:
            self._commit(value, ExternalInvocationAgg(value, self._settings).stop(self._clock.now()))
            return
        now = self._clock.now()
        if value.local_state != LocalState.RETRY_PENDING or value.cancel_state != CancelState.CONFIRMED:
            return
        if now >= value.logical_deadline:
            self._commit(value, ExternalInvocationAgg(value, self._settings).expire(now))
            return
        if value.sequence >= value.policy.additional_retries:
            raise RuntimeConflictError()
        draft = InvocationDraft(
            invocation_id=self._ids.new_id(),
            agent_id=value.agent_id,
            identity=value.identity,
            message_id=self._ids.new_id(),
            parts=value.parts,
            policy=value.policy,
            declared_outputs=value.declared_outputs,
            logical_deadline=value.logical_deadline,
            test_generation=value.test_generation,
            job=value.job,
            sequence=value.sequence + 1,
            retry_of=value.id,
        )
        self._store.create_retry(value.scope, value, draft, now=now)
