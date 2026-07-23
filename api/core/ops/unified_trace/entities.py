"""Provider-independent trace entities emitted by the unified trace builder."""

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from core.helper.trace_id_helper import ParentTraceContext


class CanonicalSpanKind(StrEnum):
    CHAIN = "chain"
    LLM = "llm"
    RETRIEVER = "retriever"
    TOOL = "tool"
    AGENT = "agent"


class CanonicalSpanStatus(StrEnum):
    OK = "ok"
    ERROR = "error"


class CanonicalSpan(BaseModel):
    """One provider-neutral operation with an explicit parent."""

    id: str
    parent_id: str | None
    name: str
    kind: CanonicalSpanKind
    start_time: datetime
    end_time: datetime | None
    inputs: Any = None
    outputs: Any = None
    status: CanonicalSpanStatus
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    synthetic: bool = False
    can_parent_workflow: bool = False
    publishes_parent_context: bool = False

    model_config = ConfigDict(extra="forbid", frozen=True)


class CanonicalTrace(BaseModel):
    """A parent-before-child span tree ready for a provider adapter."""

    trace_id: str
    session_id: str
    root_span_id: str
    spans: tuple[CanonicalSpan, ...]
    external_parent: ParentTraceContext | None = None
    required_parent_context_id: str | None = None

    model_config = ConfigDict(extra="forbid", frozen=True)
