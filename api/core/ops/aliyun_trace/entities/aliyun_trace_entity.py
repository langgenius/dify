from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import Event
from opentelemetry.trace import SpanKind, Status, StatusCode
from pydantic import BaseModel, Field


@dataclass
class TraceMetadata:
    """Metadata for trace operations, containing common attributes for all spans in a trace."""

    trace_id: int
    workflow_span_id: int
    session_id: str
    user_id: str
    links: list[trace_api.Link]


class SpanData(BaseModel):
    """Data model for span information in Aliyun trace system."""

    model_config = {"arbitrary_types_allowed": True}

    trace_id: int = Field(..., description="The unique identifier for the trace.")
    parent_span_id: int | None = Field(None, description="The ID of the parent span, if any.")
    span_id: int = Field(..., description="The unique identifier for this span.")
    name: str = Field(..., description="The name of the span.")
    attributes: dict[str, Any] = Field(default_factory=dict, description="Attributes associated with the span.")
    events: Sequence[Event] = Field(default_factory=list, description="Events recorded in the span.")
    links: Sequence[trace_api.Link] = Field(default_factory=list, description="Links to other spans.")
    status: Status = Field(default=Status(StatusCode.UNSET), description="The status of the span.")
    start_time: int | None = Field(..., description="The start time of the span in nanoseconds.")
    end_time: int | None = Field(..., description="The end time of the span in nanoseconds.")
    span_kind: SpanKind = Field(default=SpanKind.INTERNAL, description="The OpenTelemetry SpanKind for this span.")
