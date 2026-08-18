from __future__ import annotations

from dataclasses import dataclass
from typing import Any, NotRequired, TypedDict

from core.ops.entities.trace_entity import TraceTaskName
from enterprise.telemetry.contracts import TelemetryCase


class TraceContext(TypedDict):
    """Common ``context`` shape for TRACE-routed cases."""

    tenant_id: str | None
    user_id: NotRequired[str | None]
    app_id: NotRequired[str | None]


class MetricLogContext(TypedDict):
    """Common ``context`` shape for METRIC_LOG-routed cases."""

    tenant_id: str | None


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


@dataclass(frozen=True)
class TelemetryContext:
    tenant_id: str | None = None
    user_id: str | None = None
    app_id: str | None = None


@dataclass(frozen=True)
class DraftNodeExecutionTraceEvent:
    context: TelemetryContext
    payload: NodeExecutionPayload
    name: TraceTaskName = TraceTaskName.DRAFT_NODE_EXECUTION_TRACE


@dataclass(frozen=True)
class AppCreatedEvent:
    context: TelemetryContext
    payload: AppCreatedPayload
    case: TelemetryCase = TelemetryCase.APP_CREATED


@dataclass(frozen=True)
class AppUpdatedEvent:
    context: TelemetryContext
    payload: AppUpdatedPayload
    case: TelemetryCase = TelemetryCase.APP_UPDATED


@dataclass(frozen=True)
class AppDeletedEvent:
    context: TelemetryContext
    payload: AppDeletedPayload
    case: TelemetryCase = TelemetryCase.APP_DELETED


@dataclass(frozen=True)
class PromptGenerationEvent:
    context: TelemetryContext
    payload: PromptGenerationPayload
    case: TelemetryCase = TelemetryCase.PROMPT_GENERATION


@dataclass(frozen=True)
class FeedbackCreatedEvent:
    context: TelemetryContext
    payload: FeedbackCreatedPayload
    case: TelemetryCase = TelemetryCase.FEEDBACK_CREATED


type TelemetryEvent = (
    DraftNodeExecutionTraceEvent
    | PromptGenerationEvent
    | AppCreatedEvent
    | AppUpdatedEvent
    | AppDeletedEvent
    | FeedbackCreatedEvent
)
