"""Adapt public ``dify-agent`` run events into API-internal event semantics.

The adapter does not define a new cross-service event contract. It consumes
``dify_agent.protocol.RunEvent`` and produces small API-internal models that the
workflow Agent Node maps to Graphon/AppQueue events.
Agent-message deltas are exposed as annotations on ``PydanticAIStreamRunEvent``
so API code does not have to parse Pydantic AI stream-event internals to
preserve streaming. The terminal answer remains the ``run_succeeded`` output.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, cast

from dify_agent.protocol import (
    PydanticAIStreamRunEvent,
    RunCancelledEvent,
    RunEvent,
    RunFailedEvent,
    RunFailureType,
    RunStartedEvent,
    RunSucceededEvent,
)
from dify_agent.protocol.snapshot import SessionSnapshot
from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter

_EVENT_DATA_ADAPTER = TypeAdapter(object)


class AgentBackendInternalEventType(StrEnum):
    """API-only event labels used before Graphon/AppQueue integration."""

    RUN_STARTED = "run_started"
    STREAM_EVENT = "stream_event"
    AGENT_MESSAGE_DELTA = "agent_message_delta"
    RUN_SUCCEEDED = "run_succeeded"
    RUN_FAILED = "run_failed"
    RUN_CANCELLED = "run_cancelled"


class AgentBackendInternalEventBase(BaseModel):
    """Common fields preserved from public Dify Agent run events."""

    run_id: str
    source_event_id: str | None = None

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class AgentBackendRunStartedInternalEvent(AgentBackendInternalEventBase):
    """API-internal marker for a started Agent backend run."""

    type: Literal[AgentBackendInternalEventType.RUN_STARTED] = AgentBackendInternalEventType.RUN_STARTED


class AgentBackendStreamInternalEvent(AgentBackendInternalEventBase):
    """API-internal wrapper for one pydantic-ai stream event payload."""

    type: Literal[AgentBackendInternalEventType.STREAM_EVENT] = AgentBackendInternalEventType.STREAM_EVENT
    event_kind: str | None = None
    data: JsonValue


class AgentBackendAgentMessageDeltaInternalEvent(AgentBackendInternalEventBase):
    """API-internal agent-message delta emitted independently from raw stream events."""

    type: Literal[AgentBackendInternalEventType.AGENT_MESSAGE_DELTA] = AgentBackendInternalEventType.AGENT_MESSAGE_DELTA
    delta: str


class AgentBackendRunSucceededInternalEvent(AgentBackendInternalEventBase):
    """API-internal terminal success event carrying final output and session state."""

    type: Literal[AgentBackendInternalEventType.RUN_SUCCEEDED] = AgentBackendInternalEventType.RUN_SUCCEEDED
    output: JsonValue
    session_snapshot: SessionSnapshot
    usage: dict[str, JsonValue] | None = None


class AgentBackendRunFailedInternalEvent(AgentBackendInternalEventBase):
    """API-internal terminal failure event carrying the backend-safe error text."""

    type: Literal[AgentBackendInternalEventType.RUN_FAILED] = AgentBackendInternalEventType.RUN_FAILED
    error: str
    error_type: RunFailureType | None = None
    reason: str | None = None
    session_snapshot: SessionSnapshot | None = None
    usage: dict[str, JsonValue] | None = None


class AgentBackendRunCancelledInternalEvent(AgentBackendInternalEventBase):
    """API-internal terminal cancellation event."""

    type: Literal[AgentBackendInternalEventType.RUN_CANCELLED] = AgentBackendInternalEventType.RUN_CANCELLED
    reason: str | None = None
    message: str | None = None
    session_snapshot: SessionSnapshot | None = None
    usage: dict[str, JsonValue] | None = None


type AgentBackendInternalEvent = Annotated[
    AgentBackendRunStartedInternalEvent
    | AgentBackendStreamInternalEvent
    | AgentBackendAgentMessageDeltaInternalEvent
    | AgentBackendRunSucceededInternalEvent
    | AgentBackendRunFailedInternalEvent
    | AgentBackendRunCancelledInternalEvent,
    Field(discriminator="type"),
]


class AgentBackendRunEventAdapter:
    """Maps public ``dify-agent`` event variants to API-internal event variants."""

    def adapt(self, event: RunEvent) -> list[AgentBackendInternalEvent]:
        """Return zero or more API-internal events derived from one public run event."""
        match event:
            case RunStartedEvent():
                return [
                    AgentBackendRunStartedInternalEvent(
                        run_id=event.run_id,
                        source_event_id=event.id,
                    )
                ]
            case PydanticAIStreamRunEvent():
                if event.agent_message_delta:
                    return [
                        AgentBackendAgentMessageDeltaInternalEvent(
                            run_id=event.run_id,
                            source_event_id=event.id,
                            delta=event.agent_message_delta,
                        )
                    ]
                data = cast(JsonValue, _EVENT_DATA_ADAPTER.dump_python(event.data, mode="json"))
                event_kind = data.get("event_kind") if isinstance(data, dict) else None
                return [
                    AgentBackendStreamInternalEvent(
                        run_id=event.run_id,
                        source_event_id=event.id,
                        event_kind=event_kind if isinstance(event_kind, str) else None,
                        data=data,
                    )
                ]
            case RunSucceededEvent():
                return [
                    AgentBackendRunSucceededInternalEvent(
                        run_id=event.run_id,
                        source_event_id=event.id,
                        output=event.data.output,
                        session_snapshot=event.data.session_snapshot,
                        usage=_agent_run_usage(event.data.usage),
                    )
                ]
            case RunFailedEvent():
                return [
                    AgentBackendRunFailedInternalEvent(
                        run_id=event.run_id,
                        source_event_id=event.id,
                        error=event.data.error,
                        error_type=event.data.error_type,
                        reason=event.data.reason,
                        session_snapshot=event.data.session_snapshot,
                        usage=_agent_run_usage(event.data.usage),
                    )
                ]
            case RunCancelledEvent():
                return [
                    AgentBackendRunCancelledInternalEvent(
                        run_id=event.run_id,
                        source_event_id=event.id,
                        reason=event.data.reason,
                        message=event.data.message,
                        session_snapshot=event.data.session_snapshot,
                        usage=_agent_run_usage(event.data.usage),
                    )
                ]
        raise TypeError(f"unsupported agent backend run event: {type(event).__name__}")


def _agent_run_usage(usage: object | None) -> dict[str, JsonValue] | None:
    """Return JSON-safe usage metadata from optional Agent backend usage."""
    if usage is None:
        return None
    dumped = _EVENT_DATA_ADAPTER.dump_python(usage, mode="json")
    if not isinstance(dumped, dict):
        return None
    return cast(dict[str, JsonValue], dumped)
