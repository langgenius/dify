"""The provider-neutral trace tree.

This model is the lowest common denominator of every supported destination: a
tree of completed spans with timing, input and output, status, and LLM usage.
Identifiers use the OpenTelemetry formats (32 and 16 lowercase hex characters)
so OTLP destinations accept them directly and other destinations can derive
their native identifiers deterministically (see ``dify_trace_sdk.ids``).
"""

import math
import re
from datetime import UTC, datetime
from enum import StrEnum
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

_TRACE_ID = re.compile(r"[0-9a-f]{32}")
_SPAN_ID = re.compile(r"[0-9a-f]{16}")


def _aware_utc(value: datetime) -> datetime:
    """Dify persists naive UTC datetimes; never interpret them in the host timezone."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _check_id(value: str, pattern: re.Pattern[str], label: str) -> str:
    if not pattern.fullmatch(value) or int(value, 16) == 0:
        raise ValueError(f"{label} must be nonzero lowercase hex")
    return value


def _require_finite[T](value: T) -> T:
    """Strict JSON has no NaN or Infinity, so a span holding one could never be sent."""
    pending: list[object] = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError("JSON numbers must be finite")
        if isinstance(item, dict):
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)
    return value


class SpanKind(StrEnum):
    CHAIN = "chain"
    LLM = "llm"
    RETRIEVER = "retriever"
    TOOL = "tool"
    AGENT = "agent"


class SpanStatus(StrEnum):
    OK = "ok"
    ERROR = "error"


class TokenUsage(BaseModel):
    prompt_tokens: int = Field(ge=0)
    completion_tokens: int = Field(ge=0)
    total_tokens: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid", frozen=True)


class Cost(BaseModel):
    amount: float = Field(ge=0)
    currency: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator("amount")
    @classmethod
    def _finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("cost amount must be finite")
        return value


class Span(BaseModel):
    """One completed operation. A span without a parent is the root of its trace."""

    span_id: str
    parent_span_id: str | None
    name: str = Field(min_length=1)
    kind: SpanKind
    start_time: datetime
    end_time: datetime
    status: SpanStatus
    error: str | None = None
    inputs: JsonValue = None
    outputs: JsonValue = None
    model_name: str | None = None
    model_provider: str | None = None
    usage: TokenUsage | None = None
    cost: Cost | None = None
    time_to_first_token: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    attributes: dict[str, JsonValue] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator("span_id")
    @classmethod
    def _span_id(cls, value: str) -> str:
        return _check_id(value, _SPAN_ID, "span_id")

    @field_validator("inputs", "outputs", "attributes")
    @classmethod
    def _finite(cls, value: JsonValue) -> JsonValue:
        return _require_finite(value)

    @field_validator("parent_span_id")
    @classmethod
    def _parent_span_id(cls, value: str | None) -> str | None:
        return None if value is None else _check_id(value, _SPAN_ID, "parent_span_id")

    @field_validator("start_time", "end_time")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        return _aware_utc(value)

    @model_validator(mode="after")
    def _ordered(self) -> Self:
        if self.end_time < self.start_time:
            raise ValueError(f"span {self.span_id} ends before it starts")
        if self.parent_span_id == self.span_id:
            raise ValueError(f"span {self.span_id} cannot be its own parent")
        return self


class SpanRef(BaseModel):
    """A span of the same trace that was or will be sent separately."""

    span_id: str
    start_time: datetime

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator("span_id")
    @classmethod
    def _span_id(cls, value: str) -> str:
        return _check_id(value, _SPAN_ID, "span_id")

    @field_validator("start_time")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        return _aware_utc(value)


class Trace(BaseModel):
    """A parent-first span tree, delivered as one unit.

    ``parent`` is set when this tree joins a trace whose root was sent in
    another unit, e.g. a tool call under its message. ``parent`` is always the
    root span of that trace, and the first span of this unit points at it.
    """

    trace_id: str
    external_trace_id: str | None
    """The caller-supplied trace ID, kept verbatim for destinations that accept free-form IDs."""
    session_id: str | None
    user_id: str | None
    parent: SpanRef | None
    spans: tuple[Span, ...] = Field(min_length=1)

    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator("trace_id")
    @classmethod
    def _trace_id(cls, value: str) -> str:
        return _check_id(value, _TRACE_ID, "trace_id")

    @model_validator(mode="after")
    def _parent_first(self) -> Self:
        root = self.spans[0]
        expected_root_parent = self.parent.span_id if self.parent is not None else None
        if root.parent_span_id != expected_root_parent:
            raise ValueError("the first span must be the root of this unit")
        seen = {root.span_id}
        for span in self.spans[1:]:
            if span.span_id in seen:
                raise ValueError(f"duplicate span_id: {span.span_id}")
            if span.parent_span_id is None or span.parent_span_id not in seen:
                raise ValueError(f"span {span.span_id} must follow its parent")
            seen.add(span.span_id)
        if expected_root_parent in seen:
            raise ValueError("the external parent cannot be a span of this unit")
        return self

    @property
    def root(self) -> Span:
        return self.spans[0]
