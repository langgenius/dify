from datetime import UTC, datetime, timedelta

from core.ops.unified_trace.agent_collector import AgentSemanticTraceCollector
from core.ops.unified_trace.agent_events import AgentSemanticEvent, AgentSemanticEventKind

START = datetime(2026, 7, 29, tzinfo=UTC)


def test_collector_creates_sibling_llm_and_tool_operations() -> None:
    collector = AgentSemanticTraceCollector(run_id="run-1", role="initial", start_time=START)
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.LLM,
            occurred_at=START,
            payload={"delta": "thinking"},
        )
    )
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.TOOL_CALL,
            occurred_at=START,
            payload={"tool_call_id": "call-1", "tool_name": "weather", "arguments": {"city": "Paris"}},
        )
    )
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.TOOL_RESULT,
            occurred_at=START + timedelta(seconds=1),
            payload={"tool_call_id": "call-1", "result": "sunny"},
        )
    )

    fragment = collector.finish(output="done", end_time=START + timedelta(seconds=2))

    assert [operation.kind for operation in fragment.operations] == ["llm", "tool"]
    assert fragment.operations[1].inputs == {"city": "Paris"}
    assert fragment.operations[1].outputs == "sunny"
    assert fragment.operations[1].metadata["tool_call_id"] == "call-1"


def test_collector_merges_consecutive_llm_deltas_into_one_turn() -> None:
    collector = AgentSemanticTraceCollector(run_id="run-1", role="initial", start_time=START)
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.LLM,
            occurred_at=START,
            payload={"index": 0, "content_kind": "text", "delta": "hello "},
        )
    )
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.LLM,
            occurred_at=START + timedelta(milliseconds=10),
            payload={"index": 0, "content_kind": "text", "delta": "world"},
        )
    )

    fragment = collector.finish(output="done", end_time=START + timedelta(seconds=1))

    assert len(fragment.operations) == 1
    assert fragment.operations[0].outputs == {"text": "hello world"}
    assert fragment.operations[0].start_time == START
    assert fragment.operations[0].end_time == START + timedelta(milliseconds=10)


def test_collector_starts_a_new_llm_turn_after_tool_execution() -> None:
    collector = AgentSemanticTraceCollector(run_id="run-1", role="initial", start_time=START)
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.LLM,
            occurred_at=START,
            payload={"index": 0, "content_kind": "thinking", "delta": "check time"},
        )
    )
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.TOOL_CALL,
            occurred_at=START + timedelta(milliseconds=10),
            payload={"tool_call_id": "call-1", "tool_name": "current_time", "arguments": {}},
        )
    )
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.TOOL_RESULT,
            occurred_at=START + timedelta(milliseconds=20),
            payload={"tool_call_id": "call-1", "result": "12:00"},
        )
    )
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.LLM,
            occurred_at=START + timedelta(milliseconds=30),
            payload={"index": 0, "content_kind": "text", "delta": "It is noon."},
        )
    )

    fragment = collector.finish(output="done", end_time=START + timedelta(seconds=1))

    assert [operation.kind for operation in fragment.operations] == ["llm", "tool", "llm"]
    assert fragment.operations[0].outputs == {"thinking": "check time"}
    assert fragment.operations[1].outputs == "12:00"
    assert fragment.operations[1].error is None
    assert fragment.operations[2].outputs == {"text": "It is noon."}


def test_collector_marks_fragment_partial_when_event_is_invalid() -> None:
    collector = AgentSemanticTraceCollector(run_id="run-1", role="resume", start_time=START)

    collector.consume(object())  # type: ignore[arg-type]

    fragment = collector.finish(end_time=START)

    assert fragment.complete is False
    assert fragment.warning_codes == ("agent_event_dropped",)
    assert fragment.dropped_event_count == 1


def test_collector_marks_configured_workflow_tool_provider_type() -> None:
    collector = AgentSemanticTraceCollector(
        run_id="run-1",
        role="initial",
        start_time=START,
        workflow_tool_names={"weather"},
    )
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.TOOL_CALL,
            occurred_at=START,
            payload={"tool_call_id": "call-1", "tool_name": "weather", "arguments": {}},
        )
    )
    collector.consume(
        AgentSemanticEvent(
            kind=AgentSemanticEventKind.TOOL_RESULT,
            occurred_at=START + timedelta(seconds=1),
            payload={"tool_call_id": "call-1", "result": "sunny"},
        )
    )

    operation = collector.finish(output="done").operations[0]

    assert operation.metadata["provider_type"] == "workflow"
