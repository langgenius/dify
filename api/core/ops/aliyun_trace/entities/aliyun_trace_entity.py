from collections.abc import Sequence
from typing import Optional

from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import Event, Status, StatusCode
from pydantic import BaseModel, Field


class SpanData(BaseModel):
    model_config = {"arbitrary_types_allowed": True}

    trace_id: int = Field(..., description="The unique identifier for the trace.")
    parent_span_id: Optional[int] = Field(None, description="The ID of the parent span, if any.")
    span_id: int = Field(..., description="The unique identifier for this span.")
    name: str = Field(..., description="The name of the span.")
    attributes: dict[str, str] = Field(default_factory=dict, description="Attributes associated with the span.")
    events: Sequence[Event] = Field(default_factory=list, description="Events recorded in the span.")
    links: Sequence[trace_api.Link] = Field(default_factory=list, description="Links to other spans.")
    status: Status = Field(default=Status(StatusCode.UNSET), description="The status of the span.")
    start_time: Optional[int] = Field(..., description="The start time of the span in nanoseconds.")
    end_time: Optional[int] = Field(..., description="The end time of the span in nanoseconds.")
