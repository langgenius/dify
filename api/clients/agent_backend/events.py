from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import Field, JsonValue

from clients.agent_backend.dto import (
    CONTRACT_VERSION,
    AgentBackendBaseModel,
    AgentExecutionContext,
    ResourceRef,
)
from clients.agent_backend.lifecycle import AgentLifecycleEvent, AgentLifecycleReason


class AgentBackendEventType(StrEnum):
    LIFECYCLE = "lifecycle"
    TEXT_DELTA = "text.delta"
    TEXT_COMPLETED = "text.completed"
    TOOL_CALL_STARTED = "tool_call.started"
    TOOL_CALL_DELTA = "tool_call.delta"
    TOOL_CALL_SUCCEEDED = "tool_call.succeeded"
    TOOL_CALL_FAILED = "tool_call.failed"
    FILE_CREATED = "file.created"
    OUTPUT_DELTA = "output.delta"
    OUTPUT_CREATED = "output.created"
    OUTPUT_VALIDATION_FAILED = "output.validation_failed"
    ERROR = "error"
    PAUSE_REQUESTED = "pause.requested"


class AgentBackendEventBase(AgentBackendBaseModel):
    event_id: str
    sequence: int
    created_at: int
    execution_context: AgentExecutionContext


class AgentLifecycleAckEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.LIFECYCLE] = AgentBackendEventType.LIFECYCLE
    lifecycle_event: AgentLifecycleEvent
    lifecycle_reason: AgentLifecycleReason
    message: str | None = None


class AgentTextDeltaEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.TEXT_DELTA] = AgentBackendEventType.TEXT_DELTA
    delta: str
    output_name: str = "text"


class AgentTextCompletedEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.TEXT_COMPLETED] = AgentBackendEventType.TEXT_COMPLETED
    text: str
    output_name: str = "text"


class AgentToolCallStartedEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.TOOL_CALL_STARTED] = AgentBackendEventType.TOOL_CALL_STARTED
    tool_call_id: str
    tool_name: str
    parent_id: str | None = None
    input: JsonValue | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class AgentToolCallDeltaEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.TOOL_CALL_DELTA] = AgentBackendEventType.TOOL_CALL_DELTA
    tool_call_id: str
    delta: str


class AgentToolCallSucceededEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.TOOL_CALL_SUCCEEDED] = AgentBackendEventType.TOOL_CALL_SUCCEEDED
    tool_call_id: str
    output: JsonValue | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class AgentToolCallFailedEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.TOOL_CALL_FAILED] = AgentBackendEventType.TOOL_CALL_FAILED
    tool_call_id: str
    error: str
    retryable: bool = False
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class AgentFileCreatedEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.FILE_CREATED] = AgentBackendEventType.FILE_CREATED
    file_ref: ResourceRef
    output_name: str | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class AgentOutputDeltaEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.OUTPUT_DELTA] = AgentBackendEventType.OUTPUT_DELTA
    output_name: str
    delta: JsonValue


class AgentOutputCreatedEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.OUTPUT_CREATED] = AgentBackendEventType.OUTPUT_CREATED
    output_name: str
    value: JsonValue
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class AgentOutputValidationFailedEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.OUTPUT_VALIDATION_FAILED] = AgentBackendEventType.OUTPUT_VALIDATION_FAILED
    output_name: str
    error: str
    retryable: bool = True
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class AgentErrorEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.ERROR] = AgentBackendEventType.ERROR
    category: str
    code: str
    message: str
    retryable: bool = False
    safe_details: dict[str, JsonValue] = Field(default_factory=dict)


class AgentPauseRequestedEvent(AgentBackendEventBase):
    type: Literal[AgentBackendEventType.PAUSE_REQUESTED] = AgentBackendEventType.PAUSE_REQUESTED
    reason: str
    message: str | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


type AgentBackendEvent = Annotated[
    AgentLifecycleAckEvent
    | AgentTextDeltaEvent
    | AgentTextCompletedEvent
    | AgentToolCallStartedEvent
    | AgentToolCallDeltaEvent
    | AgentToolCallSucceededEvent
    | AgentToolCallFailedEvent
    | AgentFileCreatedEvent
    | AgentOutputDeltaEvent
    | AgentOutputCreatedEvent
    | AgentOutputValidationFailedEvent
    | AgentErrorEvent
    | AgentPauseRequestedEvent,
    Field(discriminator="type"),
]


class AgentBackendEventEnvelope(AgentBackendBaseModel):
    contract_version: Literal["agent-backend.v1"] = CONTRACT_VERSION
    event_id: str
    sequence: int
    type: AgentBackendEventType
    created_at: int
    execution_context: AgentExecutionContext
    payload: dict[str, Any]
