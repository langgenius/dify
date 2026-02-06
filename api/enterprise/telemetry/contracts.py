"""Telemetry gateway contracts and data structures.

This module defines the envelope format for telemetry events and the routing
configuration that determines how each event type is processed.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, field_validator


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


class CaseRoute(BaseModel):
    """Routing configuration for a telemetry case.

    Attributes:
        signal_type: The type of signal ("trace" or "metric_log").
        ce_eligible: Whether this case is eligible for customer engagement.
    """

    signal_type: Literal["trace", "metric_log"]
    ce_eligible: bool


class TelemetryEnvelope(BaseModel):
    """Envelope for telemetry events.

    Attributes:
        case: The telemetry case type.
        tenant_id: The tenant identifier.
        event_id: Unique event identifier for deduplication.
        payload: The main event payload.
        payload_fallback: Fallback payload (max 64KB).
        metadata: Optional metadata dictionary.
    """

    case: TelemetryCase
    tenant_id: str
    event_id: str
    payload: dict[str, Any]
    payload_fallback: bytes | None = None
    metadata: dict[str, Any] | None = None

    @field_validator("payload_fallback")
    @classmethod
    def validate_payload_fallback_size(cls, v: bytes | None) -> bytes | None:
        """Validate that payload_fallback does not exceed 64KB."""
        if v is not None and len(v) > 65536:  # 64 * 1024
            raise ValueError("payload_fallback must not exceed 64KB")
        return v

    class Config:
        """Pydantic configuration."""

        use_enum_values = False
