"""Telemetry facade.

Thin public API for emitting telemetry events.  All routing logic
lives in ``core.telemetry.gateway`` which is shared by both CE and EE.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from core.ops.entities.trace_entity import TraceTaskName
from core.telemetry.events import (
    AppCreatedEvent,
    AppDeletedEvent,
    AppUpdatedEvent,
    DraftNodeExecutionTraceEvent,
    FeedbackCreatedEvent,
    MetricLogContext,
    PromptGenerationEvent,
    PromptGenerationPayload,
    TelemetryContext,
    TelemetryEvent,
    TraceContext,
)
from core.telemetry.gateway import emit

if TYPE_CHECKING:
    from core.ops.ops_trace_manager import TraceQueueManager


__all__ = [
    "AppCreatedEvent",
    "AppDeletedEvent",
    "AppUpdatedEvent",
    "DraftNodeExecutionTraceEvent",
    "FeedbackCreatedEvent",
    "MetricLogContext",
    "PromptGenerationEvent",
    "PromptGenerationPayload",
    "TelemetryContext",
    "TelemetryEvent",
    "TraceContext",
    "TraceQueueManager",
    "TraceTaskName",
    "emit",
]
