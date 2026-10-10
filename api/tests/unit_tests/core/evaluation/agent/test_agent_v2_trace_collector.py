from clients.agent_backend import (
    AgentBackendAgentMessageDeltaInternalEvent,
    AgentBackendStreamInternalEvent,
)
from core.evaluation.agent.agent_v2_trace_collector import AgentV2TraceCollector
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
