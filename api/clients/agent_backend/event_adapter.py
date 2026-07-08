"""Adapt public ``dify-agent`` run events into API-internal event semantics.

The adapter does not define a new cross-service event contract. It consumes
``dify_agent.protocol.RunEvent`` and produces small API-internal models that the
workflow Agent Node maps to Graphon/AppQueue events. Deferred external tool calls
remain Dify Agent ``run_succeeded`` payloads on the wire; API code turns them
into an internal event so workflow pause/session handling stays local to API.
Agent-message deltas are exposed as annotations on ``PydanticAIStreamRunEvent``
so API code does not have to parse Pydantic AI stream-event internals to
preserve streaming.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, cast

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import (
    DeferredToolCallPayload,
    PydanticAIStreamRunEvent,
    RunCancelledEvent,
    RunEvent,
    RunFailedEvent,
    RunStartedEvent,
    RunSucceededEvent,
)
from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter

_EVENT_DATA_ADAPTER = TypeAdapter(object)


class AgentBackendInternalEventType(StrEnum):
    """API-only event labels used before Graphon/AppQueue integration."""

    RUN_STARTED = "run_started"
    STREAM_EVENT = "stream_event"
    AGENT_MESSAGE_DELTA = "agent_message_delta"
    TERMINAL_OUTPUT_DELTA = "terminal_output_delta"
    DEFERRED_TOOL_CALL = "deferred_tool_call"
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


class AgentBackendTerminalOutputDeltaInternalEvent(AgentBackendInternalEventBase):
    """API-internal terminal output delta emitted independently from raw stream events."""

    type: Literal[AgentBackendInternalEventType.TERMINAL_OUTPUT_DELTA] = (
        AgentBackendInternalEventType.TERMINAL_OUTPUT_DELTA
    )
    delta: str


class AgentBackendRunSucceededInternalEvent(AgentBackendInternalEventBase):
    """API-internal terminal success event carrying final output and session state."""

    type: Literal[AgentBackendInternalEventType.RUN_SUCCEEDED] = AgentBackendInternalEventType.RUN_SUCCEEDED
    output: JsonValue
    session_snapshot: CompositorSessionSnapshot
    usage: dict[str, JsonValue] | None = None


class AgentBackendDeferredToolCallInternalEvent(AgentBackendInternalEventBase):
    """API-internal representation of a Dify Agent deferred external tool call."""

    type: Literal[AgentBackendInternalEventType.DEFERRED_TOOL_CALL] = AgentBackendInternalEventType.DEFERRED_TOOL_CALL
    deferred_tool_call: DeferredToolCallPayload
    message: str | None = None
    session_snapshot: CompositorSessionSnapshot
    usage: dict[str, JsonValue] | None = None


class AgentBackendRunFailedInternalEvent(AgentBackendInternalEventBase):
    """API-internal terminal failure event carrying the backend-safe error text."""

    type: Literal[AgentBackendInternalEventType.RUN_FAILED] = AgentBackendInternalEventType.RUN_FAILED
    error: str
    reason: str | None = None


class AgentBackendRunCancelledInternalEvent(AgentBackendInternalEventBase):
    """API-internal terminal cancellation event."""

    type: Literal[AgentBackendInternalEventType.RUN_CANCELLED] = AgentBackendInternalEventType.RUN_CANCELLED
    reason: str | None = None
    message: str | None = None


type AgentBackendInternalEvent = Annotated[
    AgentBackendRunStartedInternalEvent
    | AgentBackendStreamInternalEvent
    | AgentBackendAgentMessageDeltaInternalEvent
    | AgentBackendTerminalOutputDeltaInternalEvent
    | AgentBackendDeferredToolCallInternalEvent
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
                if event.terminal_output_delta:
                    return [
                        AgentBackendTerminalOutputDeltaInternalEvent(
                            run_id=event.run_id,
                            source_event_id=event.id,
                            delta=event.terminal_output_delta,
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
                if "deferred_tool_call" in event.data.model_fields_set:
                    if event.data.deferred_tool_call is None:
                        raise TypeError("run_succeeded deferred_tool_call branch is missing payload")
                    return [
                        AgentBackendDeferredToolCallInternalEvent(
                            run_id=event.run_id,
                            source_event_id=event.id,
                            deferred_tool_call=event.data.deferred_tool_call,
                            message=_deferred_tool_call_message(event.data.deferred_tool_call),
                            session_snapshot=event.data.session_snapshot,
                            usage=_agent_run_usage(event.data.usage),
                        )
                    ]
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
                        reason=event.data.reason,
                    )
                ]
            case RunCancelledEvent():
                return [
                    AgentBackendRunCancelledInternalEvent(
                        run_id=event.run_id,
                        source_event_id=event.id,
                        reason=event.data.reason,
                        message=event.data.message,
                    )
                ]
        raise TypeError(f"unsupported agent backend run event: {type(event).__name__}")


def _deferred_tool_call_message(payload: DeferredToolCallPayload) -> str:
    """Return a concise workflow pause message from deferred-tool arguments."""
    args = payload.args
    if isinstance(args, dict):
        question = args.get("question")
        if isinstance(question, str) and question.strip():
            return question

        title = args.get("title")
        if isinstance(title, str) and title.strip():
            return title

    return f"Agent backend requested external input via deferred tool '{payload.tool_name}'."


def _agent_run_usage(usage: object | None) -> dict[str, JsonValue] | None:
    """Return JSON-safe usage metadata from optional Agent backend usage."""
    if usage is None:
        return None
    dumped = _EVENT_DATA_ADAPTER.dump_python(usage, mode="json")
    if not isinstance(dumped, dict):
        return None
    return cast(dict[str, JsonValue], dumped)
