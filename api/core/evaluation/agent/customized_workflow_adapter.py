"""Expose a stable Agent target contract to customized evaluation workflows."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, Final

from core.evaluation.entities.evaluation_entity import AgentEvaluationItem
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult

AGENT_CUSTOM_EVALUATOR_NODE_ID: Final = "agent"
AGENT_CUSTOM_EVALUATOR_OUTPUT_TYPES: Final[Mapping[str, str]] = {
    "query": "string",
    "output": "string",
    "expected_output": "string",
    "tool_calls_json": "string",
    "expected_tool_calls_json": "string",
    "success_criteria_json": "string",
    "available_tools_json": "string",
    "trajectory_json": "string",
}
AGENT_CUSTOM_EVALUATOR_DATASET_COLUMNS: Final[Mapping[str, str]] = {
    "expected_output": "expected_output",
    "success_criteria_json": "success_criteria",
    "expected_tool_calls_json": "expected_tool_calls",
}


def build_agent_custom_evaluator_node_result(item: AgentEvaluationItem) -> NodeRunResult:
    """Adapt one successful Agent run to the normal customized-evaluator input model."""

    return NodeRunResult(
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        inputs=item.inputs,
        outputs={
            "query": str(item.inputs.get("task", "")),
            "output": item.output,
            "expected_output": item.expected_output or "",
            "tool_calls_json": _json_dump([call.model_dump(mode="json") for call in item.tool_calls]),
            "expected_tool_calls_json": _json_dump(
                [call.model_dump(mode="json") for call in item.expected_tool_calls or []]
            ),
            "success_criteria_json": _json_dump(item.success_criteria or []),
            "available_tools_json": _json_dump([tool.model_dump(mode="json") for tool in item.available_tools or []]),
            "trajectory_json": _json_dump(
                item.trajectory.model_dump(mode="json") if item.trajectory is not None else None
            ),
        },
    )


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


__all__ = [
    "AGENT_CUSTOM_EVALUATOR_DATASET_COLUMNS",
    "AGENT_CUSTOM_EVALUATOR_NODE_ID",
    "AGENT_CUSTOM_EVALUATOR_OUTPUT_TYPES",
    "build_agent_custom_evaluator_node_result",
]
