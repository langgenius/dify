import asyncio
import json
from collections.abc import AsyncIterable, AsyncIterator
from datetime import UTC, datetime
from typing import cast

from agenton.compositor import CompositorSessionSnapshot
from dify_agent.protocol import PydanticAIStreamRunEvent, RunSucceededEvent, RunSucceededEventData
from pydantic_ai import Agent
from pydantic_ai.messages import (
    AgentStreamEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    PartDeltaEvent,
    PartEndEvent,
    PartStartEvent,
    RetryPromptPart,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolCallPart,
    ToolCallPartDelta,
    ToolReturnPart,
)
from pydantic_ai.models.function import (
    AgentInfo,
    DeltaThinkingCalls,
    DeltaThinkingPart,
    DeltaToolCall,
    DeltaToolCalls,
    FunctionModel,
)

from core.workflow.nodes.agent_v2.process_recorder import WorkflowAgentProcessRecorder


def _event(data: AgentStreamEvent, *, event_id: str | None = None, run_id: str = "run-1") -> PydanticAIStreamRunEvent:
    event = PydanticAIStreamRunEvent(
        id=event_id, run_id=run_id, created_at=datetime(2026, 9, 28, tzinfo=UTC), data=data
    )
    return PydanticAIStreamRunEvent.model_validate_json(event.model_dump_json())


def test_replayed_deltas_and_complete_tool_events_do_not_duplicate_steps() -> None:
    process_data = {}
    recorder = WorkflowAgentProcessRecorder(process_data, "run-1")
    recorder.record(_event(PartStartEvent(index=0, part=ThinkingPart("Think "))))
    delta = _event(PartDeltaEvent(index=0, delta=ThinkingPartDelta(content_delta="carefully")), event_id="2-0")
    recorder.record(delta)
    recorder.record(delta)
    recorder.record(_event(PartEndEvent(index=0, part=ThinkingPart("Think carefully"))))
    part = ToolCallPart("lookup", {"query": "hello"}, tool_call_id="call-1")
    recorder.record(_event(PartStartEvent(index=1, part=part)))
    recorder.record(_event(PartEndEvent(index=1, part=part)))
    recorder.record(_event(FunctionToolCallEvent(part)))
    recorder.record(_event(FunctionToolResultEvent(ToolReturnPart("lookup", "", tool_call_id="call-1"))))
    steps = process_data["agent_thoughts"]
    assert len(steps) == 2
    assert steps[0]["thought"] == "Think carefully"
    assert steps[1]["tool"] == "lookup"
    assert steps[1]["observation"] == ""


def test_parallel_tool_calls_are_correlated_by_call_id_not_name_or_completion_order() -> None:
    process_data = {}
    recorder = WorkflowAgentProcessRecorder(process_data, "run-1")
    for index in range(2):
        recorder.record(
            _event(PartStartEvent(index=index, part=ToolCallPart("lookup", {}, tool_call_id=f"call-{index}")))
        )
        recorder.record(_event(PartDeltaEvent(index=index, delta=ToolCallPartDelta(args_delta={"index": index}))))
    recorder.record(_event(FunctionToolResultEvent(ToolReturnPart("lookup", False, tool_call_id="call-1"))))
    recorder.record(
        _event(FunctionToolResultEvent(RetryPromptPart("Please retry", tool_name="lookup", tool_call_id="call-0")))
    )
    steps = process_data["agent_thoughts"]
    assert [json.loads(step["tool_input"]) for step in steps] == [{"index": 0}, {"index": 1}]
    assert [step["observation"] for step in steps] == ["Please retry", "false"]


def test_retry_runs_preserve_previous_attempts_without_reusing_part_indexes() -> None:
    process_data: dict[str, object] = {"agent_id": "agent-1"}
    for run_id in ("run-1", "run-2"):
        recorder = WorkflowAgentProcessRecorder(process_data, run_id)
        recorder.record(_event(PartStartEvent(index=0, part=ThinkingPart(run_id)), run_id=run_id))
        recorder.record(
            _event(FunctionToolCallEvent(ToolCallPart("lookup", {}, tool_call_id="same-id")), run_id=run_id)
        )
    steps = cast("list[dict[str, object]]", process_data["agent_thoughts"])
    assert [step["chain_id"] for step in steps] == ["run-1", "run-1", "run-2", "run-2"]
    assert [step["position"] for step in steps] == [1, 2, 3, 4]
    assert len({step["id"] for step in steps}) == 4
    assert process_data["agent_id"] == "agent-1"


def test_actual_pydantic_ai_stream_is_preserved_without_duplicate_final_output() -> None:
    process_data = {}
    recorder = WorkflowAgentProcessRecorder(process_data, "run-1")

    async def model(
        messages: list[ModelMessage], _info: AgentInfo
    ) -> AsyncIterator[str | DeltaToolCalls | DeltaThinkingCalls]:
        if any(isinstance(part, ToolReturnPart) for message in messages for part in message.parts):
            yield {0: DeltaThinkingPart(content="Check tool result")}
            yield "Found result"
        else:
            yield {0: DeltaThinkingPart(content="Plan ")}
            yield {0: DeltaThinkingPart(content="lookup")}
            yield {1: DeltaToolCall(name="lookup", json_args='{"query":"hello"}', tool_call_id="lookup-1")}

    def lookup(query: str) -> str:
        return f"matched: {query}"

    async def collect(_ctx: object, events: AsyncIterable[AgentStreamEvent]) -> None:
        async for event in events:
            recorder.record(_event(event))

    async def run() -> str:
        agent = Agent(FunctionModel(stream_function=model), tools=[lookup])
        result = await agent.run("Find hello", event_stream_handler=collect)
        recorder.record(
            RunSucceededEvent(
                run_id="run-1",
                data=RunSucceededEventData(output=result.output, session_snapshot=CompositorSessionSnapshot(layers=[])),
            )
        )
        return result.output

    assert asyncio.run(run()) == "Found result"
    steps = process_data["agent_thoughts"]
    assert [step["thought"] for step in steps if step["thought"]] == ["Plan lookup", "Check tool result"]
    tool = next(step for step in steps if step["tool"])
    assert json.loads(tool["tool_input"]) == {"query": "hello"}
    assert tool["observation"] == "matched: hello"
    assert not any(step["answer"] == "Found result" for step in steps)


def test_tool_id_arriving_in_delta_updates_the_existing_call() -> None:
    process_data = {}
    recorder = WorkflowAgentProcessRecorder(process_data, "run-1")
    recorder.record(_event(PartStartEvent(index=0, part=ToolCallPart("lookup", "", tool_call_id="temporary"))))
    recorder.record(_event(PartDeltaEvent(index=0, delta=ToolCallPartDelta(args_delta="{}", tool_call_id="actual"))))
    recorder.record(_event(FunctionToolCallEvent(ToolCallPart("lookup", {}, tool_call_id="actual"))))
    recorder.record(_event(FunctionToolResultEvent(ToolReturnPart("lookup", "found", tool_call_id="actual"))))
    assert len(process_data["agent_thoughts"]) == 1
    assert process_data["agent_thoughts"][0]["observation"] == "found"


def test_late_index_zero_does_not_split_an_existing_text_part() -> None:
    process_data = {}
    recorder = WorkflowAgentProcessRecorder(process_data, "run-1")
    recorder.record(_event(PartStartEvent(index=1, part=TextPart("Working "))))
    recorder.record(_event(PartStartEvent(index=0, part=ToolCallPart("lookup", {}, tool_call_id="call-1"))))
    recorder.record(_event(PartDeltaEvent(index=1, delta=TextPartDelta(content_delta="now"))))
    recorder.record(_event(PartEndEvent(index=1, part=TextPart("Working now"))))
    assert [step["answer"] for step in process_data["agent_thoughts"] if step["answer"]] == ["Working now"]


def test_final_answer_with_multiple_text_parts_is_not_partially_trimmed() -> None:
    process_data = {}
    recorder = WorkflowAgentProcessRecorder(process_data, "run-1")
    recorder.record(_event(PartStartEvent(index=0, part=TextPart("AB"))))
    recorder.record(_event(PartStartEvent(index=1, part=ThinkingPart("double check"))))
    recorder.record(_event(PartStartEvent(index=2, part=TextPart("CA"))))
    recorder.record(
        RunSucceededEvent(
            run_id="run-1",
            data=RunSucceededEventData(output="AB\n\nCA", session_snapshot=CompositorSessionSnapshot(layers=[])),
        )
    )
    assert [step["answer"] for step in process_data["agent_thoughts"] if step["answer"]] == []
    assert process_data["agent_thoughts"][0]["thought"] == "double check"
    assert process_data["agent_thoughts"][0]["position"] == 1


def test_text_without_process_leaves_no_false_thinking_step() -> None:
    process_data = {}
    recorder = WorkflowAgentProcessRecorder(process_data, "run-1")
    recorder.record(_event(PartStartEvent(index=0, part=TextPart("Just the answer"))))
    recorder.record(
        RunSucceededEvent(
            run_id="run-1",
            data=RunSucceededEventData(output="Just the answer", session_snapshot=CompositorSessionSnapshot(layers=[])),
        )
    )
    assert process_data["agent_thoughts"] == []
