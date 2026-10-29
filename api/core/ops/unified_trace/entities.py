"""Provider-independent trace entities emitted by the unified trace builder."""

from datetime import datetime
from enum import StrEnum
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
    links: tuple[str, ...] = ()

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

    @model_validator(mode="after")
    def validate_fragment(self) -> Self:
        if self.external_parent is not None and self.required_parent_context_id is not None:
            raise ValueError("canonical trace cannot require two external parent modes")

        seen: set[str] = set()
        root_seen = False
        for span in self.spans:
            if span.id in seen:
                raise ValueError(f"duplicate canonical span id: {span.id}")
            if span.id == self.root_span_id:
                root_seen = True
                if span.parent_id is not None:
                    raise ValueError("canonical trace root cannot have a local parent")
            elif span.parent_id is None or span.parent_id not in seen:
                raise ValueError(f"canonical span parent must appear first: {span.id}")
            seen.add(span.id)

        if not root_seen:
            raise ValueError("canonical trace root is missing")
        return self
