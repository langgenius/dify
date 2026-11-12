"""Consumer-owned durable execution contracts for external A2A agents.

Each business send has its own Invocation. Queue delivery, polling, cancellation
and graph resumption never create another business send. Repository operations
own short transactions and reconstruct the complete owner chain; no ORM values,
secrets or sessions cross these ports. All application timestamps are UTC.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Literal, Protocol

from .io_contracts import JsonObject, OutputField
from .protocol import ConnectionSpec, GatewayReceipt, SendRequest


class RuntimeError(ValueError):
    """Safe use-case failure; code carries no HTTP status or framework object."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ContextBusyError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("context_busy", "The previous external task has no confirmed terminal result.")


class RuntimeConflictError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("runtime_conflict", "External execution changed concurrently.")


class SubmissionState(StrEnum):
    PREPARED = "prepared"
    SEND_STARTED = "send_started"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    UNKNOWN = "submission_unknown"


class LocalState(StrEnum):
    WAITING = "waiting"
    RETRY_PENDING = "retry_pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    ENDED = "ended"
    STOPPED = "stopped"


class CancelState(StrEnum):
    NONE = "none"
    REQUESTED = "requested"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    UNSUPPORTED = "unsupported"
    UNCONFIRMED = "unconfirmed"


class TimeoutPolicy(StrEnum):
    END_WAITING = "end_waiting"
    REQUEST_CANCELLATION = "request_cancellation"
    CANCEL_AND_RETRY = "cancel_and_retry"


class CommandKind(StrEnum):
    DISPATCH = "dispatch"
    POLL = "poll"
    CANCEL = "cancel"
    DEADLINE = "deadline"
    RETRY = "retry"
    WAKE = "wake"


@dataclass(frozen=True, slots=True, kw_only=True)
class RuntimeScope:
    """Admitted caller; app_id is absent only for workspace Overview tests."""

    tenant_id: str
    initiator_id: str
    app_id: str | None
    origin: Literal["production", "node_debug", "workflow_debug", "overview_test"]
    actor_role: Literal["account", "end_user"] = "account"


@dataclass(frozen=True, slots=True, kw_only=True)
class ExecutionIdentity:
    """Stable caller identity. Container frames must never collapse into node_id."""

    execution_id: str
    node_id: str
    frame_id: str
    workflow_run_id: str | None = None
    conversation_id: str | None = None
    binding_epoch: str = ""
    workflow_revision: str = ""


@dataclass(frozen=True, slots=True, kw_only=True)
class WaitPolicy:
    """Validated node policy; None wait_seconds disables only the node deadline."""

    wait_seconds: int | None = 600
    on_timeout: TimeoutPolicy = TimeoutPolicy.END_WAITING
    additional_retries: int = 1
    retry_interval_seconds: int = 5

    def __post_init__(self) -> None:
        if self.wait_seconds is not None and not 60 <= self.wait_seconds <= 3600:
            raise ValueError("External wait limit must be 60..3600 seconds or disabled.")
        if not 0 <= self.additional_retries <= 2:
            raise ValueError("External business retries must be 0..2.")
        if not 1 <= self.retry_interval_seconds <= 60:
            raise ValueError("External retry interval must be 1..60 seconds.")


@dataclass(frozen=True, slots=True, kw_only=True)
class RuntimeSettings:
    """Composition-root supplied limits; stricter deployment budgets may clamp them."""

    logical_budget_seconds: int = 3600
    io_timeout_seconds: float = 30
    sse_window_seconds: float = 30
    poll_interval_seconds: int = 5
    cancellation_window_seconds: int = 30
    tracking_seconds: int = 86400
    background_initial_interval_seconds: int = 60
    background_max_interval_seconds: int = 300
    background_max_queries: int = 300
    workspace_query_concurrency: int = 20
    endpoint_query_concurrency: int = 5
    command_lease_seconds: int = 120
    admission_enabled: bool = True


@dataclass(frozen=True, slots=True, kw_only=True)
class ContextKey:
    """Complete production context scope; frame_scope is empty for ordinary nodes."""

    tenant_id: str
    app_id: str
    conversation_id: str
    node_id: str
    binding_epoch: str
    agent_id: str
    connection_revision_id: str
    frame_scope: str = ""


@dataclass(frozen=True, slots=True, kw_only=True)
class ContextSlot:
    key: ContextKey
    context_id: str | None
    reservation_invocation_id: str | None
    unresolved: bool = False
    version: int = 0


@dataclass(frozen=True, slots=True, kw_only=True)
class InvocationDraft:
    """Frozen node input; connection is deliberately unresolved until permit acquisition."""

    invocation_id: str
    agent_id: str
    identity: ExecutionIdentity
    message_id: str
    # Persist text and trusted internal FileRef markers, never wire raw/base64.
    parts: tuple[JsonObject, ...]
    policy: WaitPolicy = field(default_factory=WaitPolicy)
    declared_outputs: tuple[OutputField, ...] = ()
    logical_deadline: datetime | None = None
    test_generation: int | None = None
    job: JsonObject = field(default_factory=dict)
    sequence: int = 0
    retry_of: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class Invocation:
    """Durable execution snapshot. None IDs mean unavailable, never fabricated.

    outputs is the complete validated set. terminal_receipt is a migration
    sentinel that must remain None: normalization consumes temporary validated
    wire content before persistence, and the repository rejects raw receipts.
    """

    id: str
    scope: RuntimeScope
    agent_id: str
    identity: ExecutionIdentity
    message_id: str
    parts: tuple[JsonObject, ...]
    policy: WaitPolicy
    declared_outputs: tuple[OutputField, ...]
    started_at: datetime
    logical_deadline: datetime
    caller_execution_id: str | None = None
    connection_revision_id: str | None = None
    remote_task_id: str | None = None
    remote_context_id: str | None = None
    carried_context_id: str | None = None
    remote_state: str = "unknown"
    submission_state: SubmissionState = SubmissionState.PREPARED
    local_state: LocalState = LocalState.WAITING
    cancel_state: CancelState = CancelState.NONE
    dispatched_at: datetime | None = None
    ended_at: datetime | None = None
    local_wait_ended_at: datetime | None = None
    wait_deadline: datetime | None = None
    cancellation_deadline: datetime | None = None
    cancel_trigger: Literal["timeout", "user"] | None = None
    tracking_deadline: datetime | None = None
    outputs: JsonObject | None = None
    terminal_receipt: GatewayReceipt | None = None
    error_code: str | None = None
    error_message: str | None = None
    sequence: int = 0
    retry_of: str | None = None
    background_queries: int = 0
    queries_blocked: bool = False
    observation_error_code: str | None = None
    asset_snapshot: JsonObject = field(default_factory=dict)
    version: int = 0
    test_generation: int | None = None
    tracing_enabled: bool = False
    deleted: bool = False
    job: JsonObject = field(default_factory=dict)


@dataclass(frozen=True, slots=True, kw_only=True)
class CommandDraft:
    kind: CommandKind
    not_before: datetime
    dedupe_key: str
    background: bool = False


@dataclass(frozen=True, slots=True, kw_only=True)
class LeasedCommand:
    id: str
    invocation_id: str
    scope: RuntimeScope
    kind: CommandKind
    fence: int
    lease_expires_at: datetime
    background: bool = False


@dataclass(frozen=True, slots=True, kw_only=True)
class RuntimeResult:
    """Graph bridge result; waiting carries an invocation reference, never an HTTP stream."""

    invocation_id: str
    state: LocalState
    outputs: JsonObject | None
    error_code: str | None
    error_message: str | None
    metadata: JsonObject


class InvocationStore(Protocol):
    """Repository port; each write is one scoped transaction with CAS/unique constraints."""

    def create(self, scope: RuntimeScope, draft: InvocationDraft, *, now: datetime) -> Invocation:
        """Atomically create intent + dispatch/deadline Commands, or return the same execution/sequence.

        Check complete tenant/app/caller ownership. A reused identity with different
        frozen input raises RuntimeConflictError. logical_deadline must be durable.
        """
        ...

    def get(self, scope: RuntimeScope, invocation_id: str) -> Invocation:
        """Read the owned Invocation or fail closed; no current binding reinterpretation."""
        ...

    def for_execution(self, scope: RuntimeScope, identity: ExecutionIdentity) -> Invocation | None:
        """Return highest sequence for this exact execution/frame, not only graph node_id."""
        ...

    def execution_stopped(self, scope: RuntimeScope, identity: ExecutionIdentity) -> bool:
        """Rebuild the owning run's stop/terminal fence before asynchronous work."""
        ...

    def acquire_dispatch(self, scope: RuntimeScope, invocation_id: str, *, now: datetime) -> Invocation | None:
        """Atomically admit one PREPARED invocation and commit SEND_STARTED before I/O.

        Lock/CAS current asset head: enabled production/debug, not deleted, latest
        revision, valid caller and budget. Overview tests may use disabled assets.
        Reserve the complete ContextKey inside the same transaction; busy raises
        ContextBusyError. Pin carried ctx, revision, tracing and wait deadline.
        A non-PREPARED invocation returns None, never another dispatch permit.
        """
        ...

    def begin_send(self, scope: RuntimeScope, invocation: Invocation, *, now: datetime) -> Invocation | None:
        """Fence the actual single POST after authorized bytes are prepared.

        Recheck caller stop, immutable permit and deadlines. Only the winning CAS
        sets dispatched_at/started_at for Calls and Duration; failed input
        preparation does not count. Losing the CAS never sends.
        """
        ...

    def save(
        self,
        scope: RuntimeScope,
        previous: Invocation,
        updated: Invocation,
        *,
        commands: tuple[CommandDraft, ...] = (),
    ) -> bool:
        """CAS expected version, save snapshot and deduplicated Commands in one transaction.

        Keep context reservation/generation fences consistent with terminal state.
        False means a concurrent transition won; caller reloads, never repeats I/O.
        Tombstones reject content/materialization but allow cleanup transitions.
        """
        ...

    def create_retry(
        self, scope: RuntimeScope, previous: Invocation, draft: InvocationDraft, *, now: datetime
    ) -> Invocation:
        """Atomically create one next sequence only for confirmed Canceled and remaining budget.

        Unique execution+sequence and retry_of prevent duplicate wake from creating
        two business tasks. New dispatch resolves latest connection at its permit.
        """
        ...

    def lease_command(
        self, scope: RuntimeScope, command_id: str, *, now: datetime, lease_seconds: int
    ) -> LeasedCommand | None:
        """Claim a due command with a new fence; at most one query per Invocation.

        Enforce workspace/endpoint query limits and active-before-background policy.
        Expired dispatch leases never make SEND_STARTED replayable.
        """
        ...

    def complete_command(self, command: LeasedCommand) -> None:
        """Complete only matching fence; stale workers cannot complete a newer lease."""
        ...

    def reconcile(self, scope: RuntimeScope, *, now: datetime) -> int:
        """Reject pre-POST preparation or mark post-boundary acceptance unknown; never resend."""
        ...


class RuntimeConnectionReader(Protocol):
    def read(self, scope: RuntimeScope, agent_id: str, revision_id: str) -> ConnectionSpec:
        """Resolve pinned immutable connection after transaction close; no secret in records."""
        ...


class ContextStore(Protocol):
    def get(self, key: ContextKey) -> ContextSlot | None:
        """Read complete scoped slot; missing Invocation body does not erase reservation."""
        ...

    def reserve(self, key: ContextKey, invocation_id: str) -> ContextSlot:
        """Unique/CAS reservation, including first call; same owner id is idempotent."""
        ...

    def settle(
        self,
        key: ContextKey,
        invocation_id: str,
        *,
        context_id: str | None,
        remote_terminal: bool,
        unresolved: bool,
    ) -> bool:
        """CAS reservation and full generation; absence of new ctx preserves known ctx.

        Only valid direct Message/authoritative terminal/pre-dispatch rejection
        releases ownership. Unknown/tracking expiry cannot free the slot.
        """
        ...


class OutputNormalizer(Protocol):
    def normalize(self, invocation: Invocation, receipt: GatewayReceipt) -> JsonObject:
        """Materialize required files and return one complete validated declared output set."""
        ...


class ReceiptObserver(Protocol):
    def observe(self, invocation: Invocation, receipt: GatewayReceipt) -> None:
        """Observe correlated temporary wire data independently of business validation.

        The adapter owns trace ingestion, redaction and delivery. Failure must
        never change the business result. Wire file bodies are not retained.
        """
        ...


class WorkflowWakePort(Protocol):
    def wake(self, scope: RuntimeScope, invocation: Invocation) -> bool:
        """Keep a durable Wake until the exact caller or run is durably terminal.

        Publishing a resume is not consumption. False retains the intent for an
        early checkpoint, lost publication or active resume. Stopped/expired
        callers never revive. A claimed active graph is never replayed from an
        old checkpoint; an orphaned resume fails safely at the persistent budget.
        """
        ...


class RuntimeIdFactory(Protocol):
    def new_id(self) -> str: ...


class RuntimeClock(Protocol):
    def now(self) -> datetime:
        """Return UTC wall time; injected so I/O completion/deadline races are testable."""
        ...


class RequestPartsBuilder(Protocol):
    def build(self, invocation: Invocation) -> SendRequest:
        """Authorize references and construct ephemeral raw Parts for one admitted send.

        File bytes never enter durable Invocation/Command records. File or mode
        failures happen before the business POST and cannot trigger resubmission.
        """
        ...


def send_request(invocation: Invocation) -> SendRequest:
    """Build a business request only from an admitted frozen Invocation."""
    if invocation.submission_state is not SubmissionState.SEND_STARTED:
        raise RuntimeError("dispatch_not_admitted", "External dispatch has no permit.")
    return SendRequest(
        message_id=invocation.message_id,
        parts=invocation.parts,
        context_id=invocation.carried_context_id,
    )
