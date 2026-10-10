"""Evaluation runner and trace normalizer for legacy Agent nodes."""

import json
from collections.abc import Mapping
from typing import Any, Literal

from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolCall,
    AgentToolDefinition,
    AgentTrajectory,
    AgentTrajectoryStep,
    DefaultMetric,
    EvaluationDatasetInput,
    EvaluationItemResult,
    NodeInfo,
)
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from graphon.enums import WorkflowNodeExecutionMetadataKey
from graphon.node_events import NodeRunResult
from graphon.nodes.llm.reasoning import split_reasoning

_TOOL_CALL_LABEL_PREFIX = "CALL "
_TASK_INPUT_KEYS = ("task", "instruction", "query", "prompt", "question", "input")


class AgentEvaluationRunner(BaseEvaluationRunner):
    """Normalize legacy Agent execution logs before running framework-independent judges."""

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
            final_output = _extract_agent_output(node_result.outputs)
            available_tools, tool_snapshot_warning = _extract_available_tools(node_result)
            tool_calls, trajectory = _extract_agent_trace(node_result.outputs, available_tools, final_output)
            if tool_snapshot_warning:
                trajectory.warnings.append(tool_snapshot_warning)
            items.append(
                AgentEvaluationItem(
                    index=position,
                    inputs={
                        "task": _extract_agent_task_input(
                            node_result.inputs,
                            dataset_item.inputs if dataset_item is not None else None,
                        )
                    },
                    output=final_output,
                    tool_calls=tool_calls,
                    expected_tool_calls=(
                        dataset_item.get_expected_tool_calls_for_node(
                            node_info.node_id if node_info else None,
                            node_info.title if node_info else None,
                        )
                        if dataset_item is not None
                        else None
                    ),
                    success_criteria=(
                        dataset_item.get_success_criteria_for_node(
                            node_info.node_id if node_info else None,
                            node_info.title if node_info else None,
                        )
                        if dataset_item is not None
                        else None
                    ),
                    available_tools=available_tools,
                    trajectory=trajectory,
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
            rendered_output = _render_value(outputs[key])
            clean_output, _reasoning = split_reasoning(rendered_output, "separated")
            return clean_output

    fallback = {key: value for key, value in outputs.items() if key not in {"json", "usage", "files"}}
    return json.dumps(fallback, ensure_ascii=False, sort_keys=True, default=str) if fallback else ""


def _extract_available_tools(
    node_result: NodeRunResult,
) -> tuple[list[AgentToolDefinition] | None, str | None]:
    """Read the credential-free runtime snapshot, with a legacy-input fallback."""
    tool_info = node_result.metadata.get(WorkflowNodeExecutionMetadataKey.TOOL_INFO)
    if isinstance(tool_info, Mapping) and "available_tools" in tool_info:
        raw_tools = tool_info.get("available_tools")
        if isinstance(raw_tools, list):
            return [AgentToolDefinition.model_validate(tool) for tool in raw_tools if isinstance(tool, Mapping)], None

    for parameter_name, parameter_value in node_result.inputs.items():
        if not isinstance(parameter_value, list):
            continue
        if parameter_name != "tools" and not any(
            isinstance(tool, Mapping) and (tool.get("tool_name") or tool.get("identity")) for tool in parameter_value
        ):
            continue
        fallback_tools = [
            tool
            for raw_tool in parameter_value
            if isinstance(raw_tool, Mapping)
            if (tool := _legacy_input_tool_definition(raw_tool)) is not None
        ]
        return fallback_tools, (
            "Runtime tool schemas were unavailable; tool selection can still be evaluated, "
            "but tool argument correctness may be unavailable."
        )
    return None, "The runtime did not capture an available-tool snapshot."


def _legacy_input_tool_definition(raw_tool: Mapping[str, Any]) -> AgentToolDefinition | None:
    raw_identity = raw_tool.get("identity")
    identity = raw_identity if isinstance(raw_identity, Mapping) else {}
    name = str(raw_tool.get("tool_name") or identity.get("name") or raw_tool.get("name") or "").strip()
    if not name:
        return None
    provider = str(raw_tool.get("provider_name") or identity.get("provider") or "").strip()
    raw_extra = raw_tool.get("extra")
    extra = raw_extra if isinstance(raw_extra, Mapping) else {}
    description = str(extra.get("description") or raw_tool.get("description") or "")
    display_name = _localized_text(identity.get("label")) or name
    return AgentToolDefinition(
        tool_ref=f"{provider}/{name}" if provider else name,
        name=name,
        display_name=display_name,
        description=description,
        input_schema={},
        schema_available=False,
    )


def _localized_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if not isinstance(value, Mapping):
        return ""
    return str(value.get("en_US") or value.get("zh_Hans") or next(iter(value.values()), ""))


def _extract_agent_trace(
    outputs: Mapping[str, Any],
    available_tools: list[AgentToolDefinition] | None,
    final_output: str,
) -> tuple[list[AgentToolCall], AgentTrajectory]:
    """Normalize observable legacy ReAct/Function Calling logs into the shared trace DTO."""
    raw_entries = outputs.get("json")
    if not isinstance(raw_entries, list):
        raw_entries = []

    tool_by_name = {tool.name: tool for tool in available_tools or []}
    tool_calls: list[AgentToolCall] = []
    steps: list[AgentTrajectoryStep] = []
    sequence = 0
    for entry_position, raw_entry in enumerate(raw_entries, start=1):
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
        is_tool_call = bool(name) and (
            label.startswith(_TOOL_CALL_LABEL_PREFIX)
            or any(key in data or key in nested_call for key in ("tool_name", "tool_call_name"))
        )
        if not is_tool_call:
            error = str(raw_entry.get("error") or "").strip()
            if error:
                steps.append(
                    AgentTrajectoryStep(
                        step_id=str(raw_entry.get("id") or f"legacy-error-{entry_position}"),
                        parent_step_id=_optional_string(raw_entry.get("parent_id")),
                        sequence=sequence,
                        step_type="error",
                        content=_observable_log_content(data),
                        status="failed",
                        error=error,
                    )
                )
                sequence += 1
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

        raw_call_id = (
            data.get("tool_call_id")
            or nested_call.get("tool_call_id")
            or raw_entry.get("id")
            or f"legacy-call-{entry_position}"
        )
        call_id = str(raw_call_id)
        log_id = str(raw_entry.get("id") or call_id)
        status = _normalize_step_status(raw_entry.get("status"), raw_entry.get("error"))
        error = _optional_string(raw_entry.get("error"))
        tool = tool_by_name.get(name)
        tool_ref = tool.tool_ref if tool else name
        arguments = _normalize_tool_arguments(raw_arguments)
        tool_calls.append(
            AgentToolCall(
                name=name,
                call_id=call_id,
                tool_ref=tool_ref,
                arguments=arguments,
                output=tool_output,
            )
        )

        call_step_id = f"{log_id}:call"
        steps.append(
            AgentTrajectoryStep(
                step_id=call_step_id,
                parent_step_id=_optional_string(raw_entry.get("parent_id")),
                sequence=sequence,
                step_type="tool_call",
                tool_call_id=call_id,
                tool_ref=tool_ref,
                tool_name=name,
                arguments=arguments,
                status=status,
                error=error,
            )
        )
        sequence += 1
        if tool_output is not None or error:
            steps.append(
                AgentTrajectoryStep(
                    step_id=f"{log_id}:result",
                    parent_step_id=call_step_id,
                    sequence=sequence,
                    step_type="tool_result",
                    tool_call_id=call_id,
                    tool_ref=tool_ref,
                    tool_name=name,
                    content=tool_output,
                    status=status,
                    error=error,
                )
            )
            sequence += 1

    steps.append(
        AgentTrajectoryStep(
            step_id="final-output",
            sequence=sequence,
            step_type="final_output",
            content=final_output,
            status="succeeded" if final_output else "unknown",
        )
    )
    return tool_calls, AgentTrajectory(source="legacy", steps=steps)


def _normalize_step_status(
    raw_status: Any,
    raw_error: Any,
) -> Literal["succeeded", "failed", "unknown"]:
    if raw_error:
        return "failed"
    normalized = str(raw_status or "").strip().lower()
    if normalized in {"success", "succeeded", "completed"}:
        return "succeeded"
    if normalized in {"error", "failed", "failure", "cancelled"}:
        return "failed"
    return "unknown"


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    rendered = str(value).strip()
    return rendered or None


def _observable_log_content(data: Mapping[str, Any]) -> Any | None:
    for key in ("observation", "tool_response", "message", "output"):
        if key in data:
            return data[key]
    return None


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
