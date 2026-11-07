from pydantic import TypeAdapter
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    NativeToolCallPart,
    NativeToolReturnPart,
    PartDeltaEvent,
    PartEndEvent,
    RetryPromptPart,
    TextPartDelta,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_core import ValidationError

from core.workflow.nodes.agent.events import AgentLogEvent
from core.workflow.nodes.agent_v2.agent_node import _AgentBackendLogTranslator

_EVENT_DATA_ADAPTER = TypeAdapter(object)


def _translator(run_id: str = "run-1") -> _AgentBackendLogTranslator:
    return _AgentBackendLogTranslator(node_id="agent-node", node_execution_id="execution-1", run_id=run_id)


def _translate(translator: _AgentBackendLogTranslator, event: object) -> list[AgentLogEvent]:
    data = _EVENT_DATA_ADAPTER.dump_python(event, mode="json")
    return translator.translate(data, event_kind=data.get("event_kind"))


def test_function_tool_call_and_result_share_log_id_and_include_payloads() -> None:
    translator = _translator()

    started = _translate(
        translator,
        FunctionToolCallEvent(
            part=ToolCallPart(tool_name="get_weather", args='{"city":"Beijing"}', tool_call_id="call-1")
        ),
    )
    finished = _translate(
        translator,
        FunctionToolResultEvent(
            part=ToolReturnPart(tool_name="get_weather", content={"temperature": "25°C"}, tool_call_id="call-1")
        ),
    )

    assert len(started) == len(finished) == 1
    assert started[0].message_id == finished[0].message_id
    assert started[0].status == "start"
    assert started[0].data["tool_input"] == {"city": "Beijing"}
    assert finished[0].status == "success"
    assert finished[0].data["observation"] == {"temperature": "25°C"}
    assert finished[0].metadata["elapsed_time"] >= 0


def test_tool_call_without_id_preserves_raw_args_and_result_stays_unpaired() -> None:
    translator = _translator()
    started = translator.translate(
        {"part": {"tool_name": "custom", "args": "{invalid", "tool_call_id": None}},
        event_kind="function_tool_call",
    )
    finished = translator.translate(
        {"part": {"tool_name": "custom", "content": {"ok": True}, "tool_call_id": None}},
        event_kind="function_tool_result",
    )

    assert started[0].data["tool_input"] == "{invalid"
    assert started[0].data["tool_call_id"] is None
    assert finished[0].data["tool_call_id"] is None
    assert started[0].message_id != finished[0].message_id
    assert "elapsed_time" not in finished[0].metadata


def test_retry_prompt_is_reported_as_a_tool_error() -> None:
    failed = _translate(
        _translator(),
        FunctionToolResultEvent(
            part=RetryPromptPart(
                tool_name="get_weather",
                content="tool arguments were invalid",
                tool_call_id="call-1",
            )
        ),
    )
    assert failed[0].status == "error"
    assert failed[0].error == "tool arguments were invalid"


def test_retry_prompt_serializes_structured_error_content() -> None:
    validation_error = ValidationError.from_exception_data(
        "ToolArgs",
        [{"type": "missing", "loc": ("city",), "input": {}}],
    )
    failed = _translate(
        _translator(),
        FunctionToolResultEvent(
            part=RetryPromptPart(
                content=validation_error.errors(include_url=False, include_context=False),
                tool_name="get_weather",
                tool_call_id="call-1",
            )
        ),
    )

    assert failed[0].error is not None
    assert '"type": "missing"' in failed[0].error
    assert '"loc": ["city"]' in failed[0].error


def test_builtin_tool_parts_are_streamed_and_correlated() -> None:
    translator = _translator()
    started = _translate(
        translator,
        PartEndEvent(
            index=0,
            part=NativeToolCallPart(tool_name="web_search", args={"q": "dify"}, tool_call_id="builtin-1"),
        ),
    )
    finished = _translate(
        translator,
        PartEndEvent(
            index=0,
            part=NativeToolReturnPart(
                tool_name="web_search",
                content={"results": 3},
                tool_call_id="builtin-1",
            ),
        ),
    )

    assert started[0].message_id == finished[0].message_id
    assert started[0].metadata["kind"] == finished[0].metadata["kind"] == "builtin_tool"
    assert finished[0].data["observation"] == {"results": 3}


def test_only_completed_nonempty_thoughts_are_logged() -> None:
    translator = _translator()
    completed = _translate(translator, PartEndEvent(index=0, part=ThinkingPart(content="Check the result.")))

    assert len(completed) == 1
    assert completed[0].label == "thinking"
    assert completed[0].data["thought"] == "Check the result."
    assert completed[0].metadata == {"kind": "reasoning"}
    assert _translate(translator, PartEndEvent(index=0, part=ThinkingPart(content="   "))) == []
    assert _translate(translator, PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="partial"))) == []


def test_unknown_or_malformed_events_are_ignored() -> None:
    translator = _translator()

    assert translator.translate("invalid", event_kind="function_tool_call") == []
    assert translator.translate({"part": {"tool_name": "weather"}}, event_kind=None) == []
    assert translator.translate({"part": {"tool_name": "weather"}}, event_kind="unknown") == []
    assert translator.translate({"part": {"tool_call_id": "call-1"}}, event_kind="function_tool_call") == []
    assert translator.translate({"part": {"part_kind": "unknown"}}, event_kind="part_end") == []


def test_tool_result_without_a_name_uses_a_fallback_label() -> None:
    translated = _translator().translate(
        {"part": {"content": "result", "tool_call_id": "call-1"}},
        event_kind="function_tool_result",
    )

    assert translated[0].label == "tool"
    assert translated[0].metadata == {"kind": "tool"}


def test_log_ids_are_stable_per_tool_call_and_scoped_to_run() -> None:
    event = FunctionToolCallEvent(part=ToolCallPart(tool_name="t", args={}, tool_call_id="c1"))

    first = _translate(_translator(), event)[0].message_id
    same_run = _translate(_translator(), event)[0].message_id
    other_run = _translate(_translator("run-2"), event)[0].message_id

    assert first == same_run
    assert first != other_run
