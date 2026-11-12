from clients.agent_backend import (
    AgentBackendAgentMessageDeltaInternalEvent,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunFailedInternalEvent,
    AgentBackendStreamInternalEvent,
)
from core.evaluation.agent.agent_v2_trace_collector import (
    AgentV2TraceCollector,
    _arguments,
    _render_output,
    _string_or_none,
)
from core.evaluation.entities.evaluation_entity import (
    AgentToolDefinition,
    EvaluationDatasetInput,
    NodeInfo,
)


def test_collects_agent_v2_tool_trace_and_final_output() -> None:
    collector = AgentV2TraceCollector(
        [
            AgentToolDefinition(
                tool_ref="core:builtin/weather/current",
                name="weather",
                display_name="Weather",
                description="Get current weather.",
                input_schema={"type": "object", "required": ["city"]},
            )
        ]
    )
    collector.consume(
        AgentBackendAgentMessageDeltaInternalEvent(
            run_id="backend-run-1",
            source_event_id="1-0",
            delta="I will check the weather.",
        )
    )
    collector.consume(
        AgentBackendStreamInternalEvent(
            run_id="backend-run-1",
            source_event_id="2-0",
            data={
                "event_kind": "function_tool_call",
                "index": 0,
                "part": {
                    "part_kind": "tool-call",
                    "tool_name": "weather",
                    "tool_call_id": "call-1",
                    "args": {"city": "Shanghai"},
                },
            },
        )
    )
    collector.consume(
        AgentBackendStreamInternalEvent(
            run_id="backend-run-1",
            source_event_id="3-0",
            data={
                "event_kind": "function_tool_result",
                "part": {
                    "part_kind": "tool-return",
                    "tool_name": "weather",
                    "tool_call_id": "call-1",
                    "content": {"temperature": 25},
                },
            },
        )
    )

    item = collector.build_item(
        dataset_item=EvaluationDatasetInput(
            index=7,
            inputs={"query": "What is the weather?"},
            success_criteria=["Report the current temperature."],
        ),
        node_info=NodeInfo(node_id="agent-1", type="agent", title="Weather Agent"),
        output={"text": "It is 25 degrees."},
    )

    assert item.index == 7
    assert item.inputs == {"task": "What is the weather?"}
    assert item.output == "It is 25 degrees."
    assert item.success_criteria == ["Report the current temperature."]
    assert len(item.tool_calls) == 1
    assert item.tool_calls[0].model_dump() == {
        "name": "weather",
        "call_id": "call-1",
        "tool_ref": "core:builtin/weather/current",
        "arguments": {"city": "Shanghai"},
        "output": {"temperature": 25},
    }
    assert item.trajectory is not None
    assert [step.step_type for step in item.trajectory.steps] == [
        "agent_message",
        "tool_call",
        "tool_result",
        "final_output",
    ]


def test_ignores_replayed_source_event() -> None:
    collector = AgentV2TraceCollector([])
    event = AgentBackendAgentMessageDeltaInternalEvent(
        run_id="backend-run-1",
        source_event_id="1-0",
        delta="hello",
    )
    collector.consume(event)
    collector.consume(event)

    item = collector.build_item(
        dataset_item=EvaluationDatasetInput(index=1, inputs={"query": "hi"}),
        node_info=NodeInfo(node_id="agent-1", type="agent", title="Agent"),
        output="done",
    )

    assert item.trajectory is not None
    assert item.trajectory.steps[0].content == "hello"
    assert len(item.trajectory.steps) == 2


def test_reassembles_incremental_tool_name_before_resolving_snapshot() -> None:
    collector = AgentV2TraceCollector(
        [
            AgentToolDefinition(
                tool_ref="core:builtin/weather/current",
                name="weather",
                display_name="Weather",
                input_schema={"type": "object"},
            )
        ]
    )
    for event_id, name_delta in (("1-0", "wea"), ("2-0", "ther")):
        collector.consume(
            AgentBackendStreamInternalEvent(
                run_id="backend-run-1",
                source_event_id=event_id,
                data={
                    "event_kind": "part_delta",
                    "index": 0,
                    "delta": {
                        "part_delta_kind": "tool_call",
                        "tool_call_id": "call-1",
                        "tool_name_delta": name_delta,
                    },
                },
            )
        )

    item = collector.build_item(
        dataset_item=EvaluationDatasetInput(index=1, inputs={"query": "weather"}),
        node_info=NodeInfo(node_id="agent-1", type="agent", title="Agent"),
        output="done",
    )

    assert item.tool_calls[0].name == "weather"
    assert item.tool_calls[0].tool_ref == "core:builtin/weather/current"
    assert item.trajectory is not None
    assert item.trajectory.warnings == []


def test_collects_incremental_arguments_and_thinking_before_tool_result() -> None:
    collector = AgentV2TraceCollector(
        [AgentToolDefinition(tool_ref="core:weather", name="weather", display_name="Weather", input_schema={})]
    )
    collector.consume(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "part_delta",
                "delta": {"part_delta_kind": "thinking", "content_delta": "Need weather."},
            },
        )
    )
    for fragment in ('{"city":', '"Paris"}'):
        collector.consume(
            AgentBackendStreamInternalEvent(
                run_id="run-1",
                data={
                    "event_kind": "part_delta",
                    "index": 0,
                    "delta": {
                        "part_delta_kind": "tool_call",
                        "tool_call_id": "call-1",
                        "tool_name_delta": "weather" if fragment.startswith("{") else "",
                        "args_delta": fragment,
                    },
                },
            )
        )
    collector.consume(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={
                "event_kind": "function_tool_result",
                "content": "sunny",
                "tool_call_id": "call-1",
                "tool_name": "weather",
            },
        )
    )

    trace = collector.build_trace_snapshot(output={"text": "It is sunny."})

    assert trace.tool_calls[0].arguments == {"city": "Paris"}
    assert trace.tool_calls[0].tool_ref == "core:weather"
    assert trace.tool_calls[0].output == "sunny"
    assert [step.step_type for step in trace.trajectory.steps] == [
        "agent_message",
        "tool_call",
        "tool_result",
        "final_output",
    ]
    assert trace.trajectory.warnings == []


def test_orphan_tool_result_and_terminal_errors_are_retained() -> None:
    collector = AgentV2TraceCollector([])
    collector.consume(AgentBackendStreamInternalEvent(run_id="run-1", data="invalid stream data"))
    collector.consume(
        AgentBackendStreamInternalEvent(run_id="run-1", data={"event_kind": "part_delta", "delta": "invalid"})
    )
    collector.consume(AgentBackendStreamInternalEvent(run_id="run-1", data={"event_kind": "part_start", "part": None}))
    collector.consume(
        AgentBackendStreamInternalEvent(
            run_id="run-1",
            data={"event_kind": "output_tool_result", "part": {"tool_name": "unknown", "result": {"ok": True}}},
        )
    )
    collector.consume(AgentBackendRunFailedInternalEvent(run_id="run-1", error="backend failed"))
    collector.consume(AgentBackendRunCancelledInternalEvent(run_id="run-1", reason="user cancelled"))

    trace = collector.build_trace_snapshot(output={"answer": "partial"})

    assert trace.tool_calls == []
    assert trace.trajectory.warnings == ["A tool result could not be matched to a preceding tool call."]
    assert [step.step_type for step in trace.trajectory.steps] == [
        "tool_result",
        "error",
        "error",
        "final_output",
    ]
    assert trace.trajectory.steps[0].content == {"ok": True}
    assert trace.trajectory.steps[1].error == "backend failed"
    assert trace.trajectory.steps[2].error == "user cancelled"
    assert trace.trajectory.steps[3].content == '{"answer": "partial"}'


def test_trace_helpers_reject_unusable_names_and_arguments() -> None:
    assert _string_or_none("  weather  ") == "weather"
    assert _string_or_none("NULL") is None
    assert _string_or_none(42) is None
    assert _arguments({"city": "Paris"}) == {"city": "Paris"}
    assert _arguments('{"city": "Paris"}') == {"city": "Paris"}
    assert _arguments("not json") is None
    assert _arguments("[1, 2]") is None
    assert _render_output(None) == ""
    assert _render_output("done") == "done"
    assert _render_output({"text": "done"}) == "done"
    assert _render_output(["done"]) == '["done"]'
