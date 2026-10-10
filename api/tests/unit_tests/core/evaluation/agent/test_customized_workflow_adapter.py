import json

from core.evaluation.agent.customized_workflow_adapter import (
    AGENT_CUSTOM_EVALUATOR_NODE_ID,
    AGENT_CUSTOM_EVALUATOR_OUTPUT_TYPES,
    build_agent_custom_evaluator_node_result,
)
from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolCall,
    AgentToolDefinition,
    AgentTrajectory,
    AgentTrajectoryStep,
)
from graphon.enums import WorkflowNodeExecutionStatus


def test_builds_stable_scalar_contract_for_agent_customized_evaluator() -> None:
    item = AgentEvaluationItem(
        index=7,
        inputs={"task": "Find the weather."},
        output="Sunny",
        expected_output="Use current weather data.",
        tool_calls=[
            AgentToolCall(
                name="weather",
                call_id="call-1",
                tool_ref="core:weather/current",
                arguments={"city": "Paris"},
                output={"condition": "sunny"},
            )
        ],
        expected_tool_calls=[AgentToolCall(name="weather", arguments={"city": "Paris"})],
        success_criteria=["Report the current conditions."],
        available_tools=[
            AgentToolDefinition(
                tool_ref="core:weather/current",
                name="weather",
                display_name="Weather",
                description="Get current weather.",
                input_schema={"type": "object", "required": ["city"]},
            )
        ],
        trajectory=AgentTrajectory(
            source="agent_v2",
            steps=[
                AgentTrajectoryStep(
                    step_id="final-output",
                    sequence=0,
                    step_type="final_output",
                    content="Sunny",
                    status="succeeded",
                )
            ],
        ),
    )

    result = build_agent_custom_evaluator_node_result(item)

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.inputs == {"task": "Find the weather."}
    assert set(result.outputs) == set(AGENT_CUSTOM_EVALUATOR_OUTPUT_TYPES)
    assert result.outputs["query"] == "Find the weather."
    assert result.outputs["output"] == "Sunny"
    assert result.outputs["expected_output"] == "Use current weather data."
    assert json.loads(result.outputs["tool_calls_json"])[0]["arguments"] == {"city": "Paris"}
    assert json.loads(result.outputs["expected_tool_calls_json"])[0]["name"] == "weather"
    assert json.loads(result.outputs["success_criteria_json"]) == ["Report the current conditions."]
    assert json.loads(result.outputs["available_tools_json"])[0]["tool_ref"] == "core:weather/current"
    assert json.loads(result.outputs["trajectory_json"])["source"] == "agent_v2"
    assert BaseEvaluationInstance._build_workflow_inputs(
        {
            "answer": "{{#agent.output#}}",
            "context": "Trace: {{#agent.trajectory_json#}}",
        },
        {AGENT_CUSTOM_EVALUATOR_NODE_ID: result},
    ) == {
        "answer": "Sunny",
        "context": f"Trace: {result.outputs['trajectory_json']}",
    }
