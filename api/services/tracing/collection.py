"""Contracts of Agent trace collection: run records, the ledger port, and its settings.

Agent apps and workflows with Agent nodes produce spans that the Dify Agent
runtime reports separately. A run freezes the app's destination and capture
policy when its execution starts, collects runtime batches in a ledger, and
is exported once its business terminal and every invocation are complete.

Each ledger operation runs in its own transaction. Concurrent writers are
coordinated by the unique source key of a run, by row locks taken for every
state transition, and by the export token that fences one export attempt.
"""

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal, Protocol

from dify_agent.protocol.tracing import AgentTraceBatch
from dify_trace_sdk.provider import SendResult

from core.workflow.nodes.agent_v2.discriminator import is_dify_agent_node_data
from services.tracing.provider_configs import TraceProviderSupport

type TraceSourceKind = Literal["message", "workflow", "node"]


def workflow_has_agent_v2(graph: object) -> bool:
    """Scope Agent trace collection to graphs containing the Dify Agent v2 node."""
    if isinstance(graph, str):
        try:
            graph = json.loads(graph)
        except ValueError:
            return False
    if not isinstance(graph, Mapping) or not isinstance(graph.get("nodes"), list):
        return False
    return any(
        isinstance(node, Mapping) and isinstance(node.get("data"), Mapping) and is_dify_agent_node_data(node["data"])
        for node in graph["nodes"]
    )


class TraceAppMode(StrEnum):
    """The app modes collection distinguishes; every other mode is ``OTHER``."""

    AGENT = "agent"
    ADVANCED_CHAT = "advanced-chat"
    WORKFLOW = "workflow"
    OTHER = "other"


class TraceRunState(StrEnum):
    NOT_COLLECTED = "not_collected"
    """The app did not trace when the execution started; nothing is collected or exported."""
    COLLECTING = "collecting"
    READY = "ready"
    """Released by a manual retry; exported once its collection is complete."""
    EXPORTING = "exporting"
    RETRYING = "retrying"
    ACCEPTED = "accepted"
    FAILED = "failed"
    UNCERTAIN = "uncertain"
    """The destination may have accepted the trace; only an acknowledged retry sends it again."""


# A closed run accepts no runtime batches and no other business terminal.
CLOSED_STATES = frozenset(
    {TraceRunState.ACCEPTED, TraceRunState.EXPORTING, TraceRunState.UNCERTAIN, TraceRunState.FAILED}
)


@dataclass(frozen=True, slots=True)
class TraceRun:
    id: str
    tenant_id: str
    app_id: str
    source_kind: TraceSourceKind
    source_id: str
    provider: str
    """``""`` when the run froze no destination."""
    config_revision: str
    """``""`` when the run froze no destination."""
    provider_config: Mapping[str, Any]
    """The frozen stored configuration, secrets still encrypted."""
    trace_id: str
    root_span_id: str
    session_id: str
    capture_content: bool
    capture_agent: bool
    state: TraceRunState
    outer_trace: Mapping[str, Any] | None
    """The captured business terminal; ``None`` until it is captured."""
    span_count: int
    attempts: int
    error_code: str | None
    """``None`` unless the run failed or its export outcome is uncertain."""
    trace_url: str | None
    """``None`` until the destination accepts the trace with a link."""
    provider_trace_id: str | None
    """``None`` until the destination accepts the trace."""
    span_urls: Mapping[str, str]
    accepted_at: datetime | None
    """``None`` until the destination accepts the trace."""


@dataclass(frozen=True, slots=True)
class TraceInvocation:
    id: str
    run_id: str
    agent_id: str
    parent_span_id: str
    span_id: str
    node_execution_id: str | None
    """``None`` for the invocation of an Agent app."""
    attempt: int
    finalized: bool
    finalized_at: datetime | None
    """``None`` until the runtime reports the invocation's final batch."""


@dataclass(frozen=True, slots=True)
class TraceBatch:
    invocation_id: str
    spans: Sequence[Mapping[str, Any]]


@dataclass(frozen=True, slots=True)
class TraceApp:
    id: str
    tenant_id: str
    mode: TraceAppMode
    workflow_id: str | None
    """``None`` for apps without a published workflow."""


@dataclass(frozen=True, slots=True)
class SourceMessage:
    id: str
    conversation_id: str
    workflow_run_id: str | None
    """``None`` until a chatflow run is linked to the message."""
    agent_stop_requested: bool
    """Whether the consumer asked to stop the Agent; it does not say whether the stop won."""


@dataclass(frozen=True, slots=True)
class SourceWorkflowRun:
    id: str
    workflow_id: str
    graph: str | None
    """The graph snapshot of the run; ``None`` when the backend does not store it."""
    status: str
    finished_at: datetime | None
    """``None`` while the run has not finished."""
    created_by: str


@dataclass(frozen=True, slots=True)
class SourceNodeExecution:
    id: str
    node_id: str
    workflow_id: str | None
    """``None`` when the backend does not store the workflow."""
    workflow_run_id: str | None
    """``None`` for a single-node preview."""
    title: str
    status: str
    error: str | None
    inputs: str | None
    outputs: str | None
    created_at: datetime
    elapsed_time: float


type TraceSource = SourceMessage | SourceWorkflowRun | SourceNodeExecution


@dataclass(frozen=True, slots=True)
class MessageProgress:
    """What recovery may infer about a message from its committed row."""

    message_id: str
    conversation_id: str
    agent_app: bool
    paused: bool
    explicit_error: bool
    """The message failed and recorded why."""
    answer_saved: bool
    """The final answer transaction committed, not just an early usage flush."""
    agent_stop_requested: bool
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class TraceRunStatus:
    """The delivery state of a source's frozen run.

    Every field after ``source_id`` is ``None`` when nothing was collected.
    """

    status: TraceRunState
    source_kind: TraceSourceKind
    source_id: str
    provider: str | None
    trace_id: str | None
    """The destination's trace ID once accepted, otherwise the run's own."""
    trace_url: str | None
    span_url: str | None
    """The link of the selected node's Agent span; ``None`` when no node is selected."""
    project_url: str | None
    """The frozen destination's project link; never resolved from the app's current configuration."""
    config_revision: str | None
    capture_content: bool | None
    capture_agent: bool | None
    span_count: int | None
    attempts: int | None
    error_code: str | None
    accepted_at: datetime | None
    capabilities: TraceProviderSupport | None
    """``None`` when the frozen provider is not installed here."""


@dataclass(frozen=True, slots=True)
class AgentTraceSettings:
    enabled: bool
    max_spans: int
    max_bytes: int
    collection_timeout_seconds: int
    export_lease_seconds: int
    max_export_attempts: int
    retention_days: int


type ScheduleTraceExport = Callable[[str], object]


class ApplicationTraceStore(Protocol):
    """The Agent trace ledger. Reads and writes are scoped by the tenant and app that own the run.

    Every operation raises TracingStoreUnavailableError when the database
    cannot be reached, and the TraceCollectionError subtypes it names.
    """

    def app(self, *, tenant_id: str, app_id: str) -> TraceApp | None: ...

    def app_workflow_graph(self, *, tenant_id: str, app_id: str, workflow_id: str) -> str | None:
        """The graph of the app's workflow definition; ``None`` when the definition does not exist."""
        ...

    def message(self, *, tenant_id: str, app_id: str, message_id: str) -> SourceMessage | None: ...

    def workflow_run(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> SourceWorkflowRun | None:
        """Read through the configured workflow run backend, outside any open transaction."""
        ...

    def node_execution(self, *, tenant_id: str, app_id: str, node_execution_id: str) -> SourceNodeExecution | None: ...

    def workflow_run_conversation_id(self, *, tenant_id: str, app_id: str, workflow_run_id: str) -> str | None:
        """The conversation of the chatflow message a run answers; ``None`` outside chatflows."""
        ...

    def message_progress(self, *, tenant_id: str, app_id: str, message_id: str) -> MessageProgress | None: ...

    def start(
        self,
        *,
        tenant_id: str,
        app_id: str,
        source_kind: TraceSourceKind,
        source_id: str,
        session_id: str,
        workflow_id: str | None,
    ) -> TraceRun | None:
        """Freeze the app's destination and capture policy for a source, once.

        A run collects only when the app's enabled provider has a stored
        configuration; otherwise it is frozen as not collected. The unique source
        key keeps the first frozen run when executions race. ``workflow_id`` lets
        a trusted workflow builder reserve a run before its source row is saved.
        ``None`` when the source or its owner does not exist.
        """
        ...

    def source_run(
        self, *, tenant_id: str, app_id: str, source_kind: TraceSourceKind, source_id: str
    ) -> TraceRun | None: ...

    def workflow_run_trace(self, *, tenant_id: str, workflow_run_id: str) -> TraceRun | None:
        """The run collected for a workflow run of any app in the workspace."""
        ...

    def record_initialization_failure(
        self, *, tenant_id: str, app_id: str, source_kind: TraceSourceKind, source_id: str
    ) -> TraceRun | None:
        """Close a source whose start snapshot is missing; ``None`` when the source does not exist."""
        ...

    def invocation(
        self, *, run_id: str, agent_id: str, node_execution_id: str | None, attempt: int, call_key: str
    ) -> TraceInvocation:
        """Create the invocation of a call key once, under the run's row lock.

        Raises:
            TraceCollectionConflictError: The run stopped collecting, or the call key names another invocation.
        """
        ...

    def ingest(self, batch: AgentTraceBatch, *, max_spans: int, max_bytes: int) -> tuple[int, str]:
        """Append a runtime batch under the run's row lock and return its span count and run ID.

        A batch ID replays only with the same payload hash; a final batch finalizes its invocation.

        Raises:
            TraceCollectionNotFoundError: The run, its owner, or the invocation does not exist.
            TraceCollectionConflictError: The batch conflicts with the ledger or the run stopped collecting.
            TraceCollectionLimitError: The batch exceeds the run's limits.
        """
        ...

    def terminal(self, run_id: str, trace: Mapping[str, Any], root_span_id: str) -> None:
        """Persist the business terminal once under the run's row lock; a different later terminal is ignored."""
        ...

    def get(self, run_id: str) -> TraceRun | None: ...

    def invocations(self, run_id: str) -> list[TraceInvocation]:
        """The run's invocations by attempt, then creation."""
        ...

    def collected(self, run_id: str) -> tuple[list[TraceInvocation], list[TraceBatch]]:
        """The run's invocations by attempt, then creation, and its batches by arrival."""
        ...

    def claim(self, run_id: str, *, collection_timeout: int, lease_seconds: int) -> tuple[TraceRun, str] | None:
        """Lease a complete run for one export attempt and return it with the attempt's token.

        A run is complete once its terminal is captured and every invocation is
        finalized; ``collection_timeout`` seconds after the terminal an incomplete
        run fails. An export whose last heartbeat is older than ``lease_seconds``
        becomes uncertain, and a run whose app is gone fails. The run's row lock
        serializes claims; the returned token fences the attempt.
        """
        ...

    def renew_export_lease(self, run_id: str, token: str) -> bool: ...

    def complete(
        self,
        run_id: str,
        token: str,
        *,
        state: TraceRunState,
        error_code: str | None,
        result: SendResult | None,
        retry_delay: int | None,
    ) -> None:
        """Record an export outcome under the run's row lock.

        An attempt whose token was replaced records nothing. An acceptance that
        arrives after its lease expired still records the destination's result.
        """
        ...

    def recovery_checked(self, run_id: str, *, error_code: str | None) -> None: ...

    def pending_ids(self, limit: int) -> list[str]: ...

    def retry(self, *, run_id: str, acknowledge_possible_duplicates: bool) -> None:
        """Release a failed or uncertain run for another export.

        Raises:
            TraceCollectionNotFoundError: Nothing was collected.
            TraceCollectionConflictError: The run is accepted, not retryable, or needs the duplicate acknowledgement.
        """
        ...

    def purge(self, *, retention_days: int, limit: int) -> int: ...
