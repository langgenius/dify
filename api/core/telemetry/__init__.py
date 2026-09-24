"""Telemetry facade.

Thin public API for emitting telemetry events.  All routing logic
lives in ``core.telemetry.gateway`` which is shared by both CE and EE.
"""

from __future__ import annotations

from core.ops.entities.trace_entity import TraceTaskName
from core.telemetry.events import (
    AppCreatedEvent,
    AppDeletedEvent,
    AppUpdatedEvent,
    DraftNodeExecutionTraceEvent,
    FeedbackCreatedEvent,
    PromptGenerationEvent,
    PromptGenerationPayload,
    TelemetryContext,
    TelemetryEvent,
)
from core.telemetry.gateway import emit

__all__ = [
    "AppCreatedEvent",
    "AppDeletedEvent",
    "AppUpdatedEvent",
    "DraftNodeExecutionTraceEvent",
    "FeedbackCreatedEvent",
    "PromptGenerationEvent",
    "PromptGenerationPayload",
    "TelemetryContext",
    "TelemetryEvent",
    "TraceTaskName",
    "emit",
]
