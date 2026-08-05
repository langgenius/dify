"""Normalize Pydantic AI events into provider-neutral Agent tracing events."""

from __future__ import annotations

from typing import Protocol

from dify_agent.protocol import PydanticAIStreamRunEvent  # type: ignore[import-untyped]
from pydantic_ai.messages import (
    PartDeltaEvent,
    PartStartEvent,
    TextPartDelta,
    ThinkingPartDelta,
    ToolCallEvent,
    ToolCallPart,
    ToolResultEvent,
    ToolReturnPart,
)

from core.ops.unified_trace.agent_events import AgentSemanticEvent, AgentSemanticEventKind, bound_trace_value


class AgentEventNormalizer(Protocol):
    """Stable boundary between a backend event source and semantic tracing."""

    def normalize(self, event: object) -> tuple[AgentSemanticEvent, ...]: ...


class PydanticAIAgentEventNormalizer:
    """Extract stable semantic data without leaking Pydantic AI types downstream."""

    def normalize(self, event: object) -> tuple[AgentSemanticEvent, ...]:
        if not isinstance(event, PydanticAIStreamRunEvent):
            return ()
        tool_call = _tool_call_part(event.data)
        if tool_call is not None:
            if not tool_call.tool_call_id:
                return ()
            return (
                AgentSemanticEvent(
                    kind=AgentSemanticEventKind.TOOL_CALL,
                    occurred_at=event.created_at,
                    payload={
                        "tool_call_id": tool_call.tool_call_id,
                        "tool_name": tool_call.tool_name,
                        "arguments": bound_trace_value(tool_call.args),
                    },
                ),
            )
        tool_result = _tool_result_part(event.data)
        if tool_result is not None:
            if not tool_result.tool_call_id:
                return ()
            return (
                AgentSemanticEvent(
                    kind=AgentSemanticEventKind.TOOL_RESULT,
                    occurred_at=event.created_at,
                    payload={
                        "tool_call_id": tool_result.tool_call_id,
                        "result": bound_trace_value(tool_result.content),
                    },
                ),
            )
        if not isinstance(event.data, PartDeltaEvent):
            return ()
        if not isinstance(event.data.delta, TextPartDelta | ThinkingPartDelta):
            return ()

        delta = event.data.delta.content_delta
        if not isinstance(delta, str) or not delta:
            return ()
        content_kind = "text" if isinstance(event.data.delta, TextPartDelta) else "thinking"
        return (
            AgentSemanticEvent(
                kind=AgentSemanticEventKind.LLM,
                occurred_at=event.created_at,
                payload={
                    "index": event.data.index,
                    "content_kind": content_kind,
                    "delta": bound_trace_value(delta),
                },
            ),
        )


def _tool_call_part(event: object) -> ToolCallPart | None:
    if isinstance(event, ToolCallEvent):
        return event.part
    if isinstance(event, PartStartEvent) and isinstance(event.part, ToolCallPart):
        return event.part
    return None


def _tool_result_part(event: object) -> ToolReturnPart | None:
    if isinstance(event, ToolResultEvent) and isinstance(event.part, ToolReturnPart):
        return event.part
    return None
