"""Telemetry gateway contracts and data structures.

This module defines the envelope format for telemetry events and the routing
configuration that determines how each event type is processed.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict


class TelemetryCase(StrEnum):
    """Enumeration of all known telemetry event cases."""

    WORKFLOW_RUN = "workflow_run"
    NODE_EXECUTION = "node_execution"
    DRAFT_NODE_EXECUTION = "draft_node_execution"
    MESSAGE_RUN = "message_run"
    TOOL_EXECUTION = "tool_execution"
    MODERATION_CHECK = "moderation_check"
    SUGGESTED_QUESTION = "suggested_question"
    DATASET_RETRIEVAL = "dataset_retrieval"
    GENERATE_NAME = "generate_name"
    PROMPT_GENERATION = "prompt_generation"
    APP_CREATED = "app_created"
    APP_UPDATED = "app_updated"
    APP_DELETED = "app_deleted"
    FEEDBACK_CREATED = "feedback_created"


class SignalType(StrEnum):
    """Signal routing type for telemetry cases.

    TRACE:
        Events routed through ``TraceQueueManager`` → ``ops_trace_task``.
        The Celery worker builds a typed ``TraceInfo``, then dispatches it
        to both third-party trace providers (Langfuse, LangSmith, …) and
        ``EnterpriseOtelTrace``.  The enterprise handler may emit
        structured logs, counters, **and** histograms in one pass, so
        "TRACE" here means "event that travels the trace pipeline", not
        strictly "distributed trace span".

    METRIC_LOG:
        Events routed through ``process_enterprise_telemetry`` Celery
        task → ``metric_handler``.  Used for lightweight signal-driven
        counters (app created/deleted, feedback) that don't need the
        full ``TraceInfo`` data model.
    """

    TRACE = "trace"
    METRIC_LOG = "metric_log"


class CaseRoute(BaseModel):
    """Routing configuration for a telemetry case.

    Attributes:
        signal_type: The type of signal (trace or metric_log).
        ce_eligible: Whether this case is eligible for community edition tracing.
    """

    signal_type: SignalType
    ce_eligible: bool


class TelemetryEnvelope(BaseModel):
    """Envelope for telemetry events.

    Attributes:
        case: The telemetry case type.
        tenant_id: The tenant identifier.
        event_id: Unique event identifier for deduplication.
        payload: The main event payload (inline for small payloads,
            empty when offloaded to storage via ``payload_ref``).
        metadata: Optional metadata dictionary.  When the gateway
            offloads a large payload to object storage, this contains
            ``{"payload_ref": "<storage_key>"}``.
    """

    model_config = ConfigDict(extra="forbid", use_enum_values=False)

    case: TelemetryCase
    tenant_id: str
    event_id: str
    payload: dict[str, Any]
    metadata: dict[str, Any] | None = None
