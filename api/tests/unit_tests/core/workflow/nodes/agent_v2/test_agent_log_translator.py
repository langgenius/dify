from pydantic import TypeAdapter
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    NativeToolCallPart,
    NativeToolReturnPart,
    PartDeltaEvent,
    PartEndEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ToolCallPart,
)

from core.workflow.nodes.agent.events import AgentLogEvent
from core.workflow.nodes.agent_v2.agent_log_translator import AgentBackendLogTranslator

_EVENT_DATA_ADAPTER = TypeAdapter(object)


def _translator() -> AgentBackendLogTranslator:
    return AgentBackendLogTranslator(node_id="agent-node", node_execution_id="execution-1", run_id="run-1")


def _translate(translator: AgentBackendLogTranslator, event: object) -> list[AgentLogEvent]:
    """Feed a pydantic-ai event through the same JSON round-trip the SSE stream uses."""
    data = _EVENT_DATA_ADAPTER.dump_python(event, mode="json")
    return translator.translate(data, event_kind=data.get("event_kind"))


def test_builtin_tool_parts_become_matching_start_and_success_logs() -> None:
    translator = _translator()

    started = _translate(
        translator,
        PartEndEvent(
            index=0,
            part=NativeToolCallPart(tool_name="web_search", args={"q": "dify"}, tool_call_id="b1"),
        ),
    )
    finished = _translate(
        translator,
        PartEndEvent(
            index=0,
            part=NativeToolReturnPart(tool_name="web_search", content={"results": 3}, tool_call_id="b1"),
        ),
    )

    assert [log.status for log in started + finished] == ["start", "success"]
    assert started[0].message_id == finished[0].message_id
    assert started[0].metadata["kind"] == "builtin_tool"
    assert finished[0].data["observation"] == {"results": 3}
    assert finished[0].metadata["elapsed_time"] >= 0


def test_answer_and_reasoning_deltas_do_not_produce_logs() -> None:
    translator = _translator()

    assert _translate(translator, PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="hi"))) == []
    assert _translate(translator, PartEndEvent(index=0, part=TextPart(content="hi"))) == []
    assert _translate(translator, PartEndEvent(index=0, part=ThinkingPart(content="   "))) == []


def test_each_reasoning_part_gets_its_own_log_id() -> None:
    translator = _translator()

    first = _translate(translator, PartEndEvent(index=0, part=ThinkingPart(content="step one")))
    second = _translate(translator, PartEndEvent(index=0, part=ThinkingPart(content="step two")))

    assert first[0].message_id != second[0].message_id
    assert [log.data["thought"] for log in first + second] == ["step one", "step two"]


def test_log_ids_are_stable_per_run_and_tool_call() -> None:
    call = FunctionToolCallEvent(part=ToolCallPart(tool_name="t", args={}, tool_call_id="c1"))

    same_run = _translate(_translator(), call)[0].message_id
    other_run = _translate(
        AgentBackendLogTranslator(node_id="agent-node", node_execution_id="execution-1", run_id="run-2"),
        call,
    )[0].message_id

    assert _translate(_translator(), call)[0].message_id == same_run
    assert other_run != same_run


def test_unknown_and_malformed_payloads_are_ignored() -> None:
    translator = _translator()

    assert translator.translate("not-a-mapping", event_kind="function_tool_call") == []
    assert translator.translate({"part": {"tool_name": "t"}}, event_kind=None) == []
    assert translator.translate({"event_kind": "final_result"}, event_kind="final_result") == []
    # A tool call without a name carries nothing worth showing.
    assert translator.translate({"part": {"tool_call_id": "c1"}}, event_kind="function_tool_call") == []
