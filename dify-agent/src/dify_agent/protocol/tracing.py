"""JSON delivery contract between the Agent collector and the Dify inner API."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator


class AgentTraceEvent(BaseModel):
    name: str
    timestamp_ns: int = Field(ge=0)
    attributes: dict[str, JsonValue] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class AgentTraceSpan(BaseModel):
    trace_id: Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
    span_id: Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")]
    parent_span_id: Annotated[str, Field(pattern=r"^[0-9a-f]{16}$")] | None = None
    name: str
    start_time_ns: int = Field(ge=0)
    end_time_ns: int = Field(ge=0)
    attributes: dict[str, JsonValue] = Field(default_factory=dict)
    status: Literal["ok", "error"]
    status_message: str | None = None
    events: list[AgentTraceEvent] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_span(self) -> "AgentTraceSpan":
        for value in (self.trace_id, self.span_id, self.parent_span_id):
            if value is not None and int(value, 16) == 0:
                raise ValueError("OpenTelemetry ids must be nonzero")
        if self.end_time_ns < self.start_time_ns:
            raise ValueError("span end time must not precede start time")
        return self


class AgentTraceBatch(BaseModel):
    run_id: UUID
    invocation_id: UUID
    batch_id: UUID
    spans: list[AgentTraceSpan]
    final: bool = False

    model_config = ConfigDict(extra="forbid")


class AgentTraceBatchAcknowledgement(BaseModel):
    result: Literal["success"]
    batch_id: UUID
    accepted_spans: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid")


__all__ = ["AgentTraceBatch", "AgentTraceBatchAcknowledgement", "AgentTraceEvent", "AgentTraceSpan"]
