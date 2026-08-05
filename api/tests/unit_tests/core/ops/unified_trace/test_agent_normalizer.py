from datetime import UTC, datetime

from dify_agent.protocol import PydanticAIStreamRunEvent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartStartEvent,
    TextPartDelta,
    ToolCallPart,
    ToolReturnPart,
)

from core.ops.unified_trace.agent_events import REDACTED_VALUE, AgentSemanticEventKind
from core.ops.unified_trace.agent_normalizer import PydanticAIAgentEventNormalizer


def test_normalizer_emits_llm_event_for_text_delta() -> None:
    event = PydanticAIStreamRunEvent(
        id="event-1",
        run_id="run-1",
        created_at=datetime(2026, 7, 29, tzinfo=UTC),
        data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="hello")),
    )

    events = PydanticAIAgentEventNormalizer().normalize(event)

    assert len(events) == 1
    assert events[0].kind is AgentSemanticEventKind.LLM
    assert events[0].payload == {"index": 0, "content_kind": "text", "delta": "hello"}


def test_normalizer_emits_tool_call_for_tool_part() -> None:
    event = PydanticAIStreamRunEvent(
        id="event-1",
        run_id="run-1",
        created_at=datetime(2026, 7, 29, tzinfo=UTC),
        data=PartStartEvent(
            index=1,
            part=ToolCallPart(tool_name="weather", args={"city": "Paris"}, tool_call_id="call-1"),
        ),
    )

    events = PydanticAIAgentEventNormalizer().normalize(event)

    assert events[0].kind is AgentSemanticEventKind.TOOL_CALL
    assert events[0].payload == {
        "tool_call_id": "call-1",
        "tool_name": "weather",
        "arguments": {"city": "Paris"},
    }


def test_normalizer_emits_tool_events_from_function_tool_lifecycle() -> None:
    created_at = datetime(2026, 7, 29, tzinfo=UTC)
    call = PydanticAIStreamRunEvent(
        id="event-1",
        run_id="run-1",
        created_at=created_at,
        data=FunctionToolCallEvent(
            part=ToolCallPart(tool_name="weather", args={"city": "Paris"}, tool_call_id="call-1")
        ),
    )
    result = PydanticAIStreamRunEvent(
        id="event-2",
        run_id="run-1",
        created_at=created_at,
        data=FunctionToolResultEvent(part=ToolReturnPart(tool_name="weather", content="sunny", tool_call_id="call-1")),
    )

    normalized_call = PydanticAIAgentEventNormalizer().normalize(call)
    normalized_result = PydanticAIAgentEventNormalizer().normalize(result)

    assert normalized_call[0].kind is AgentSemanticEventKind.TOOL_CALL
    assert normalized_call[0].payload["tool_call_id"] == "call-1"
    assert normalized_result[0].kind is AgentSemanticEventKind.TOOL_RESULT
    assert normalized_result[0].payload == {"tool_call_id": "call-1", "result": "sunny"}


def test_normalizer_redacts_sensitive_text_delta() -> None:
    event = PydanticAIStreamRunEvent(
        id="event-1",
        run_id="run-1",
        created_at=datetime(2026, 7, 29, tzinfo=UTC),
        data=PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="header.payload.signature")),
    )

    events = PydanticAIAgentEventNormalizer().normalize(event)

    assert events[0].payload["delta"] == REDACTED_VALUE
