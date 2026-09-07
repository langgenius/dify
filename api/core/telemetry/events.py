from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, NotRequired, Protocol, TypedDict, runtime_checkable

from core.ops.entities.trace_entity import TraceTaskName
from enterprise.telemetry.contracts import SignalType, TelemetryCase

# ---------------------------------------------------------------------------
# Context shapes
# ---------------------------------------------------------------------------


class TraceContext(TypedDict):
    """Common ``context`` shape for TRACE-routed cases."""

    tenant_id: str | None
    user_id: NotRequired[str | None]
    app_id: NotRequired[str | None]


class MetricLogContext(TypedDict):
    """Common ``context`` shape for METRIC_LOG-routed cases."""

    tenant_id: str | None


# ---------------------------------------------------------------------------
# Payload shapes
# ---------------------------------------------------------------------------


class NodeExecutionPayload(TypedDict):
    """``payload`` shape for ``TelemetryCase.NODE_EXECUTION`` and ``DRAFT_NODE_EXECUTION``."""

    node_execution_data: dict[str, Any]


class AppCreatedPayload(TypedDict):
    """``payload`` shape for ``TelemetryCase.APP_CREATED``."""

    app_id: str | None
    mode: NotRequired[str | None]


class AppUpdatedPayload(TypedDict):
    """``payload`` shape for ``TelemetryCase.APP_UPDATED``."""

    app_id: str | None


class AppDeletedPayload(TypedDict):
    """``payload`` shape for ``TelemetryCase.APP_DELETED``."""

    app_id: str | None


class PromptGenerationPayload(TypedDict):
    """``payload`` shape for ``TelemetryCase.PROMPT_GENERATION``."""

    tenant_id: str
    app_id: NotRequired[str | None]
    operation_type: str
    instruction: str
    generated_output: str
    model_provider: str
    model_name: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency: float
    total_price: NotRequired[float | None]
    currency: NotRequired[str | None]
    timer: NotRequired[dict]
    error: NotRequired[str | None]


class FeedbackCreatedPayload(TypedDict):
    """``payload`` shape for ``TelemetryCase.FEEDBACK_CREATED``."""

    message_id: str
    app_id: str | None
    conversation_id: NotRequired[str | None]
    from_end_user_id: NotRequired[str | None]
    from_account_id: NotRequired[str | None]
    rating: NotRequired[str | None]
    from_source: NotRequired[str | None]
    content: NotRequired[str | None]


# ---------------------------------------------------------------------------
# Shared context dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TelemetryContext:
    tenant_id: str | None = None
    user_id: str | None = None
    app_id: str | None = None


# ---------------------------------------------------------------------------
# Event protocol — every concrete event must declare these routing fields
# so the gateway can dispatch without external mapping tables.
# ---------------------------------------------------------------------------


@runtime_checkable
class TelemetryEvent(Protocol):
    """Structural contract for all telemetry events.

    All attributes are declared as read-only ``@property`` so that
    frozen dataclasses satisfy the protocol (a bare attribute
    annotation would require writability).
    """

    @property
    def context(self) -> TelemetryContext: ...
    @property
    def payload(self) -> Mapping[str, Any]: ...
    @property
    def case(self) -> TelemetryCase: ...
    @property
    def signal_type(self) -> SignalType: ...
    @property
    def ce_eligible(self) -> bool: ...
    @property
    def trace_task_name(self) -> TraceTaskName | None: ...


# ---------------------------------------------------------------------------
# Concrete event classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DraftNodeExecutionTraceEvent:
    context: TelemetryContext
    payload: NodeExecutionPayload
    case: TelemetryCase = TelemetryCase.DRAFT_NODE_EXECUTION
    signal_type: SignalType = SignalType.TRACE
    ce_eligible: bool = False
    trace_task_name: TraceTaskName | None = TraceTaskName.DRAFT_NODE_EXECUTION_TRACE


@dataclass(frozen=True)
class PromptGenerationEvent:
    context: TelemetryContext
    payload: PromptGenerationPayload
    case: TelemetryCase = TelemetryCase.PROMPT_GENERATION
    signal_type: SignalType = SignalType.TRACE
    ce_eligible: bool = False
    trace_task_name: TraceTaskName | None = TraceTaskName.PROMPT_GENERATION_TRACE


@dataclass(frozen=True)
class AppCreatedEvent:
    context: TelemetryContext
    payload: AppCreatedPayload
    case: TelemetryCase = TelemetryCase.APP_CREATED
    signal_type: SignalType = SignalType.METRIC_LOG
    ce_eligible: bool = False
    trace_task_name: TraceTaskName | None = None


@dataclass(frozen=True)
class AppUpdatedEvent:
    context: TelemetryContext
    payload: AppUpdatedPayload
    case: TelemetryCase = TelemetryCase.APP_UPDATED
    signal_type: SignalType = SignalType.METRIC_LOG
    ce_eligible: bool = False
    trace_task_name: TraceTaskName | None = None


@dataclass(frozen=True)
class AppDeletedEvent:
    context: TelemetryContext
    payload: AppDeletedPayload
    case: TelemetryCase = TelemetryCase.APP_DELETED
    signal_type: SignalType = SignalType.METRIC_LOG
    ce_eligible: bool = False
    trace_task_name: TraceTaskName | None = None


@dataclass(frozen=True)
class FeedbackCreatedEvent:
    context: TelemetryContext
    payload: FeedbackCreatedPayload
    case: TelemetryCase = TelemetryCase.FEEDBACK_CREATED
    signal_type: SignalType = SignalType.METRIC_LOG
    ce_eligible: bool = False
    trace_task_name: TraceTaskName | None = None
