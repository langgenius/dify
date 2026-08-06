"""Provider-neutral Agent tracing contracts and bounded capture helpers.

Deferred from unified tracing v1: not registered in any v1 producer path
(see ADR-0001 "Out of scope (v1)"). Retained for re-adoption in a future
contract revision.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TRACE_VALUE_LIMIT = 16 * 1024
TRACE_COLLECTION_LIMIT = 100
REDACTED_VALUE = "[REDACTED]"
_SENSITIVE_KEY_PARTS = (
    "authorization",
    "credential",
    "secret",
    "token",
    "api_key",
    "password",
    "signature",
    "environment",
)
_JWE_PATTERN = re.compile(r"^[^.\s]+\.[^.\s]+\.[^.\s]+$")


@dataclass(frozen=True)
class AgentTraceCollectionGate:
    """One-way collection decision, isolated from Agent execution failures."""

    enabled: bool

    @classmethod
    def for_app(cls, app_id: str) -> AgentTraceCollectionGate:
        try:
            from core.ops.ops_trace_manager import OpsTraceManager

            return cls(enabled=OpsTraceManager.get_ops_trace_instance(app_id) is not None)
        except Exception:
            return cls(enabled=False)


class AgentSemanticEventKind(StrEnum):
    RUN_STARTED = "run_started"
    LLM = "llm"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    RUN_FINISHED = "run_finished"


class AgentSemanticEvent(BaseModel):
    kind: AgentSemanticEventKind
    occurred_at: datetime
    payload: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid", frozen=True)


class AgentTraceOperation(BaseModel):
    id: str
    kind: Literal["llm", "tool"]
    name: str
    start_time: datetime
    end_time: datetime | None = None
    inputs: Any = None
    outputs: Any = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None

    model_config = ConfigDict(extra="forbid", frozen=True)


class AgentRunTraceFragment(BaseModel):
    run_id: str
    role: Literal["initial", "resume", "retry"]
    start_time: datetime
    end_time: datetime | None = None
    operations: tuple[AgentTraceOperation, ...] = ()
    output: Any = None
    error: str | None = None
    complete: bool = True
    warning_codes: tuple[str, ...] = ()
    dropped_event_count: int = 0

    model_config = ConfigDict(extra="forbid", frozen=True)


def bound_trace_value(value: Any) -> Any:
    """Return a bounded, JSON-safe tracing value without sensitive runtime data."""
    if isinstance(value, str):
        if _JWE_PATTERN.fullmatch(value):
            return REDACTED_VALUE
        if len(value) > TRACE_VALUE_LIMIT:
            return {"value": value[:TRACE_VALUE_LIMIT], "truncated": True}
        return value
    if isinstance(value, dict):
        bounded_mapping = {
            str(key): REDACTED_VALUE if _is_sensitive_key(key) else bound_trace_value(item)
            for key, item in list(value.items())[:TRACE_COLLECTION_LIMIT]
        }
        if len(value) > TRACE_COLLECTION_LIMIT:
            return {"value": bounded_mapping, "truncated": True}
        return bounded_mapping
    if isinstance(value, list | tuple):
        bounded_items = [bound_trace_value(item) for item in value[:TRACE_COLLECTION_LIMIT]]
        if len(value) > TRACE_COLLECTION_LIMIT:
            return {"value": bounded_items, "truncated": True}
        return bounded_items
    return value


def _is_sensitive_key(key: object) -> bool:
    normalized = str(key).lower()
    return any(part in normalized for part in _SENSITIVE_KEY_PARTS)
