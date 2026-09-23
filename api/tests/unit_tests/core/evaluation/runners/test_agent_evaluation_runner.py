from unittest.mock import MagicMock

from core.evaluation.entities.evaluation_entity import (
    AgentToolCall,
    DefaultMetric,
    EvaluationDatasetInput,
    NodeInfo,
)
from core.evaluation.runners.agent_evaluation_runner import AgentEvaluationRunner
from graphon.node_events import NodeRunResult


def test_agent_runner_normalizes_react_and_function_calling_logs() -> None:
    evaluation_instance = MagicMock()
    evaluation_instance.evaluate_agent.return_value = []
    runner = AgentEvaluationRunner(evaluation_instance)
    node_info = NodeInfo(node_id="agent-1", type="agent", title="Research Agent")

    runner.evaluate_metrics(
        node_run_result_list=[
            NodeRunResult(
                inputs={"query": "What time is it in Shanghai?", "tools": [{"name": "current_time"}]},
                outputs={
                    "text": "It is 18:00.",
                    "json": [
                        {
                            "id": "tool-1",
                            "label": "CALL current_time",
                            "data": {
                                "tool_name": "current_time",
                                "tool_call_args": {"timezone": "Asia/Shanghai"},
                                "output": "18:00",
                            },
                        },
                        {
                            "id": "tool-2",
                            "label": "CALL weather",
                            "data": {
                                "output": {
                                    "tool_call_name": "weather",
                                    "tool_call_input": '{"city": "Shanghai"}',
                                    "tool_response": "sunny",
                                }
                            },
                        },
                        {"data": []},
                    ],
                },
            )
        ],
        default_metric=DefaultMetric(metric="tool_call_accuracy", node_info_list=[node_info]),
        model_provider="provider",
        model_name="model",
        tenant_id="tenant-1",
        dataset_items=[
            EvaluationDatasetInput(
                index=7,
                inputs={"question": "fallback"},
                expected_tool_calls_by_node={
                    "agent-1": [AgentToolCall(name="current_time", arguments={"timezone": "Asia/Shanghai"})]
                },
            )
        ],
        node_info=node_info,
    )

    items = evaluation_instance.evaluate_agent.call_args.args[0]
    assert items[0].inputs == {"task": "query: What time is it in Shanghai?"}
    assert items[0].output == "It is 18:00."
    assert [call.model_dump() for call in items[0].tool_calls] == [
        {
            "name": "current_time",
            "arguments": {"timezone": "Asia/Shanghai"},
            "output": "18:00",
        },
        {
            "name": "weather",
            "arguments": {"city": "Shanghai"},
            "output": "sunny",
        },
    ]
    assert items[0].expected_tool_calls == [AgentToolCall(name="current_time", arguments={"timezone": "Asia/Shanghai"})]


def test_agent_runner_uses_dataset_input_when_node_has_no_user_task_field() -> None:
    evaluation_instance = MagicMock()
    evaluation_instance.evaluate_agent.return_value = []
    runner = AgentEvaluationRunner(evaluation_instance)

    runner.evaluate_metrics(
        node_run_result_list=[NodeRunResult(inputs={"model": {"name": "gpt"}}, outputs={"text": "done"})],
        default_metric=DefaultMetric(metric="argument_correctness", node_info_list=[]),
        model_provider="provider",
        model_name="model",
        tenant_id="tenant-1",
        dataset_items=[EvaluationDatasetInput(index=1, inputs={"city": "Paris", "units": "metric"})],
    )

    item = evaluation_instance.evaluate_agent.call_args.args[0][0]
    assert item.inputs == {"task": '{"city": "Paris", "units": "metric"}'}
    assert item.tool_calls == []
