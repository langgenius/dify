"""Evaluation runner and trace normalizer for legacy Agent nodes."""

import json
from collections.abc import Mapping
from typing import Any

from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolCall,
    DefaultMetric,
    EvaluationDatasetInput,
    EvaluationItemResult,
    NodeInfo,
)
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from graphon.node_events import NodeRunResult

_TOOL_CALL_LABEL_PREFIX = "CALL "
_TASK_INPUT_KEYS = ("instruction", "query", "prompt", "question", "input")


class AgentEvaluationRunner(BaseEvaluationRunner):
    """Normalize legacy Agent execution logs and evaluate their tool calls."""

    def evaluate_metrics(
        self,
        node_run_result_list: list[NodeRunResult],
        default_metric: DefaultMetric,
        model_provider: str,
        model_name: str,
        tenant_id: str,
        dataset_items: list[EvaluationDatasetInput] | None = None,
        node_info: NodeInfo | None = None,
        context_list: list[list[str] | None] | None = None,
    ) -> list[EvaluationItemResult]:
        if not node_run_result_list:
            return []

        items = self._merge_results_into_items(node_run_result_list, dataset_items, node_info)
        return self.evaluation_instance.evaluate_agent(
            items,
            [default_metric.metric],
            model_provider,
            model_name,
            tenant_id,
        )

    @staticmethod
    def _merge_results_into_items(
        node_results: list[NodeRunResult],
        dataset_items: list[EvaluationDatasetInput] | None = None,
        node_info: NodeInfo | None = None,
    ) -> list[AgentEvaluationItem]:
        items: list[AgentEvaluationItem] = []
        for position, node_result in enumerate(node_results):
            dataset_item = dataset_items[position] if dataset_items and position < len(dataset_items) else None
            items.append(
                AgentEvaluationItem(
                    index=position,
                    inputs={
                        "task": _extract_agent_task_input(
                            node_result.inputs,
                            dataset_item.inputs if dataset_item is not None else None,
                        )
                    },
                    output=_extract_agent_output(node_result.outputs),
                    tool_calls=_extract_agent_tool_calls(node_result.outputs),
                    expected_tool_calls=(
                        dataset_item.get_expected_tool_calls_for_node(node_info.title if node_info else None)
                        if dataset_item is not None
                        else None
                    ),
                )
            )
        return items


def _extract_agent_task_input(
    node_inputs: Mapping[str, Any],
    dataset_inputs: Mapping[str, Any] | None,
) -> str:
    """Extract the user-visible task without serializing model/tool configuration."""
    task_parts: list[str] = []
    for key in _TASK_INPUT_KEYS:
        value = node_inputs.get(key)
        rendered = _render_value(value)
        if rendered:
            task_parts.append(f"{key}: {rendered}")
    if task_parts:
        return "\n".join(task_parts)
    return _format_dataset_inputs(dataset_inputs or {})


def _format_dataset_inputs(inputs: Mapping[str, Any]) -> str:
    if not inputs:
        return ""
    if len(inputs) == 1:
        return _render_value(next(iter(inputs.values())))
    return json.dumps(dict(inputs), ensure_ascii=False, sort_keys=True, default=str)


def _render_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (Mapping, list, tuple)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    return str(value)


def _extract_agent_output(outputs: Mapping[str, Any]) -> str:
    for key in ("text", "answer"):
        if key in outputs and outputs[key] is not None:
            return _render_value(outputs[key])

    fallback = {key: value for key, value in outputs.items() if key not in {"json", "usage", "files"}}
    return json.dumps(fallback, ensure_ascii=False, sort_keys=True, default=str) if fallback else ""


def _extract_agent_tool_calls(outputs: Mapping[str, Any]) -> list[AgentToolCall]:
    """Normalize ReAct and Function Calling log payloads emitted by legacy Agent."""
    raw_entries = outputs.get("json")
    if not isinstance(raw_entries, list):
        return []

    tool_calls: list[AgentToolCall] = []
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, Mapping):
            continue
        data = raw_entry.get("data")
        if not isinstance(data, Mapping):
            continue

        nested_output = data.get("output")
        nested_call = nested_output if isinstance(nested_output, Mapping) else {}
        label = str(raw_entry.get("label") or "")
        name = str(
            data.get("tool_name")
            or data.get("tool_call_name")
            or nested_call.get("tool_call_name")
            or nested_call.get("tool_name")
            or _tool_name_from_label(label)
            or ""
        ).strip()
        if not name:
            continue
        if not label.startswith(_TOOL_CALL_LABEL_PREFIX) and not any(
            key in data or key in nested_call for key in ("tool_name", "tool_call_name")
        ):
            continue

        raw_arguments = data.get("tool_call_args")
        if raw_arguments is None:
            raw_arguments = data.get("tool_call_input")
        if raw_arguments is None:
            raw_arguments = nested_call.get("tool_call_args")
        if raw_arguments is None:
            raw_arguments = nested_call.get("tool_call_input")
        if raw_arguments is None:
            raw_arguments = nested_call.get("input_parameters")

        if nested_call:
            tool_output = nested_call.get("tool_response", nested_call.get("output"))
        else:
            tool_output = data.get("tool_response", nested_output)

        tool_calls.append(
            AgentToolCall(
                name=name,
                arguments=_normalize_tool_arguments(raw_arguments),
                output=tool_output,
            )
        )
    return tool_calls


def _tool_name_from_label(label: str) -> str:
    if label.startswith(_TOOL_CALL_LABEL_PREFIX):
        return label.removeprefix(_TOOL_CALL_LABEL_PREFIX).strip()
    return ""


def _normalize_tool_arguments(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {"value": value}
        if isinstance(parsed, Mapping):
            return dict(parsed)
        return {"value": parsed}
    if value is None:
        return {}
    return {"value": value}
