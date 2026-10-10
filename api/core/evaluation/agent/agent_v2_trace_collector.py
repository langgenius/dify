"""Normalize one Agent V2 backend event stream for evaluation."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from clients.agent_backend import (
    AgentBackendAgentMessageDeltaInternalEvent,
    AgentBackendInternalEvent,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunFailedInternalEvent,
    AgentBackendStreamInternalEvent,
)
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentEvaluationTraceSnapshot,
    AgentToolCall,
    AgentToolDefinition,
    AgentTrajectory,
    AgentTrajectoryStep,
    EvaluationDatasetInput,
    NodeInfo,
)


@dataclass(slots=True)
class _ToolState:
    key: str
    call: AgentToolCall
    step: AgentTrajectoryStep
    index: int | None = None
    raw_arguments: str = ""
    observed: bool = False


class AgentV2TraceCollector:
    """Collect a replayable backend stream into the framework-neutral Agent DTO."""

    def __init__(self, available_tools: Sequence[AgentToolDefinition]) -> None:
        self._available_tools = list(available_tools)
        self._tools_by_name = {tool.name: tool for tool in available_tools}
        self._steps: list[AgentTrajectoryStep] = []
        self._tool_states: list[_ToolState] = []
        self._tools_by_call_id: dict[str, _ToolState] = {}
        self._tools_by_index: dict[int, _ToolState] = {}
        self._seen_event_ids: set[str] = set()
        self._current_message_step: AgentTrajectoryStep | None = None
        self._warnings: list[str] = []

    def consume(self, event: AgentBackendInternalEvent) -> None:
        """Consume one adapted event, ignoring replayed source event IDs."""
        if event.source_event_id and event.source_event_id in self._seen_event_ids:
            return
        if event.source_event_id:
            self._seen_event_ids.add(event.source_event_id)

        if isinstance(event, AgentBackendAgentMessageDeltaInternalEvent):
            self._append_agent_message(event.delta)
            return
        if isinstance(event, AgentBackendStreamInternalEvent):
            self._consume_stream_event(event)
            return
        if isinstance(event, AgentBackendRunFailedInternalEvent):
            self._append_error(event.error)
            return
        if isinstance(event, AgentBackendRunCancelledInternalEvent):
            self._append_error(event.message or event.reason or "Agent run was cancelled.")

    def build_item(
        self,
        *,
        dataset_item: EvaluationDatasetInput,
        node_info: NodeInfo,
        output: Any,
    ) -> AgentEvaluationItem:
        """Build the immutable evaluation input after the target reaches a terminal state."""
        rendered_output = _render_output(output)
        trace = self.build_trace_snapshot(output=output)
        return AgentEvaluationItem(
            index=dataset_item.index,
            inputs={"task": str(dataset_item.inputs.get("query", ""))},
            output=rendered_output,
            expected_output=dataset_item.get_expected_output_for_node(node_info.node_id, node_info.title),
            tool_calls=trace.tool_calls,
            expected_tool_calls=dataset_item.get_expected_tool_calls_for_node(node_info.node_id, node_info.title),
            success_criteria=dataset_item.get_success_criteria_for_node(node_info.node_id, node_info.title),
            available_tools=trace.available_tools,
            trajectory=trace.trajectory,
        )

    def build_trace_snapshot(self, *, output: Any) -> AgentEvaluationTraceSnapshot:
        """Finalize and return the credential-free trace persisted for evaluation."""

        rendered_output = _render_output(output)
        self._close_message_segment()
        self._steps.append(
            AgentTrajectoryStep(
                step_id=f"final-output-{len(self._steps) + 1}",
                sequence=len(self._steps),
                step_type="final_output",
                content=rendered_output,
                status="succeeded",
            )
        )
        warnings = list(self._warnings)
        warnings.extend(
            f"Runtime trace called tool '{state.call.name}' absent from the tool snapshot."
            for state in self._tool_states
            if state.call.name not in self._tools_by_name
        )
        return AgentEvaluationTraceSnapshot(
            tool_calls=[state.call for state in self._tool_states],
            available_tools=self._available_tools,
            trajectory=AgentTrajectory(source="agent_v2", steps=self._steps, warnings=warnings),
        )

    def _consume_stream_event(self, event: AgentBackendStreamInternalEvent) -> None:
        data = event.data
        if not isinstance(data, dict):
            return
        event_kind = data.get("event_kind")
        if event_kind == "part_delta":
            self._consume_part_delta(data)
        elif event_kind == "part_start" or event_kind in {"function_tool_call", "output_tool_call"}:
            self._consume_part(data.get("part"), _event_index(data))
        elif event_kind in {"function_tool_result", "output_tool_result"}:
            part = data.get("part") or data.get("result")
            if isinstance(part, dict):
                self._record_tool_result(part)
            elif data.get("content") is not None:
                self._record_tool_result(data)

    def _consume_part_delta(self, data: Mapping[str, Any]) -> None:
        delta = data.get("delta")
        if not isinstance(delta, dict):
            return
        delta_kind = delta.get("part_delta_kind")
        if delta_kind == "thinking":
            content = delta.get("content_delta")
            if isinstance(content, str):
                self._append_agent_message(content)
            return
        if delta_kind != "tool_call":
            return

        state = self._get_or_create_tool_state(
            index=_event_index(data),
            call_id=_string_or_none(delta.get("tool_call_id")),
            name=None,
        )
        name_delta = _string_or_none(delta.get("tool_name_delta"))
        if name_delta:
            current_name = "" if state.call.name == "unknown_tool" else state.call.name
            self._set_tool_name(state, f"{current_name}{name_delta}")
        args_delta = delta.get("args_delta")
        if isinstance(args_delta, Mapping):
            state.call.arguments.update(dict(args_delta))
            state.step.arguments = dict(state.call.arguments)
        elif isinstance(args_delta, str):
            state.raw_arguments += args_delta
            parsed = _arguments(state.raw_arguments)
            if parsed is not None:
                state.call.arguments = parsed
                state.step.arguments = parsed

    def _consume_part(self, raw_part: Any, index: int) -> None:
        if not isinstance(raw_part, dict):
            return
        part_kind = raw_part.get("part_kind")
        if part_kind == "thinking":
            content = raw_part.get("content")
            if isinstance(content, str):
                self._append_agent_message(content)
            return
        if part_kind in {"tool-return", "builtin-tool-return"}:
            self._record_tool_result(raw_part)
            return
        if part_kind in {"tool-call", "builtin-tool-call"} or raw_part.get("tool_name"):
            state = self._get_or_create_tool_state(
                index=index,
                call_id=_string_or_none(raw_part.get("tool_call_id")),
                name=_string_or_none(raw_part.get("tool_name")),
            )
            parsed = _arguments(raw_part.get("args"))
            if parsed is not None:
                state.call.arguments = parsed
                state.step.arguments = parsed
            return

    def _get_or_create_tool_state(self, *, index: int, call_id: str | None, name: str | None) -> _ToolState:
        self._close_message_segment()
        if call_id and call_id in self._tools_by_call_id:
            state = self._tools_by_call_id[call_id]
        elif index >= 0 and index in self._tools_by_index and not self._tools_by_index[index].observed:
            state = self._tools_by_index[index]
        else:
            key = call_id or f"stream-{len(self._tool_states) + 1}"
            resolved_name = name or "unknown_tool"
            tool_definition = self._tools_by_name.get(resolved_name)
            tool_ref = tool_definition.tool_ref if tool_definition else resolved_name
            call = AgentToolCall(name=resolved_name, call_id=call_id, tool_ref=tool_ref)
            step = AgentTrajectoryStep(
                step_id=f"tool-call-{key}",
                sequence=len(self._steps),
                step_type="tool_call",
                tool_call_id=call_id or key,
                tool_ref=tool_ref,
                tool_name=resolved_name,
                arguments={},
                status="unknown",
            )
            state = _ToolState(key=key, call=call, step=step, index=index if index >= 0 else None)
            self._tool_states.append(state)
            self._steps.append(step)

        if name:
            self._set_tool_name(state, name)
        if call_id:
            state.call.call_id = call_id
            state.step.tool_call_id = call_id
            self._tools_by_call_id[call_id] = state
        if index >= 0:
            self._tools_by_index[index] = state
        return state

    def _record_tool_result(self, part: Mapping[str, Any]) -> None:
        self._close_message_segment()
        call_id = _string_or_none(part.get("tool_call_id"))
        name = _string_or_none(part.get("tool_name"))
        state = self._find_open_tool(call_id=call_id, name=name)
        content = part.get("content")
        if content is None:
            content = part.get("result")
        if content is None:
            content = dict(part)

        if state is None:
            key = call_id or f"orphan-{len(self._steps) + 1}"
            tool_definition = self._tools_by_name.get(name or "")
            self._steps.append(
                AgentTrajectoryStep(
                    step_id=f"tool-result-{key}",
                    sequence=len(self._steps),
                    step_type="tool_result",
                    tool_call_id=call_id,
                    tool_ref=tool_definition.tool_ref if tool_definition else name,
                    tool_name=name,
                    content=content,
                    status="unknown",
                )
            )
            self._warnings.append("A tool result could not be matched to a preceding tool call.")
            return

        if name:
            self._set_tool_name(state, name)
        state.call.output = content
        state.observed = True
        state.step.status = "succeeded"
        if state.index is not None:
            self._tools_by_index.pop(state.index, None)
        if state.call.call_id:
            self._tools_by_call_id.pop(state.call.call_id, None)
        self._steps.append(
            AgentTrajectoryStep(
                step_id=f"tool-result-{state.key}",
                sequence=len(self._steps),
                step_type="tool_result",
                tool_call_id=state.call.call_id or state.key,
                tool_ref=state.call.tool_ref,
                tool_name=state.call.name,
                content=content,
                status="succeeded",
            )
        )

    def _set_tool_name(self, state: _ToolState, name: str) -> None:
        state.call.name = name
        state.step.tool_name = name
        tool_definition = self._tools_by_name.get(name)
        tool_ref = tool_definition.tool_ref if tool_definition else name
        state.call.tool_ref = tool_ref
        state.step.tool_ref = tool_ref

    def _find_open_tool(self, *, call_id: str | None, name: str | None) -> _ToolState | None:
        if call_id:
            return self._tools_by_call_id.get(call_id)
        if name:
            candidates = [state for state in self._tool_states if not state.observed and state.call.name == name]
            if len(candidates) == 1:
                return candidates[0]
        return None

    def _append_agent_message(self, content: str) -> None:
        if not content:
            return
        if self._current_message_step is None:
            self._current_message_step = AgentTrajectoryStep(
                step_id=f"agent-message-{len(self._steps) + 1}",
                sequence=len(self._steps),
                step_type="agent_message",
                content=content,
                status="succeeded",
            )
            self._steps.append(self._current_message_step)
            return
        self._current_message_step.content = f"{self._current_message_step.content or ''}{content}"

    def _append_error(self, error: str) -> None:
        self._close_message_segment()
        self._steps.append(
            AgentTrajectoryStep(
                step_id=f"error-{len(self._steps) + 1}",
                sequence=len(self._steps),
                step_type="error",
                content=error,
                status="failed",
                error=error,
            )
        )

    def _close_message_segment(self) -> None:
        self._current_message_step = None


def _event_index(data: Mapping[str, Any]) -> int:
    index = data.get("index")
    return index if isinstance(index, int) else -1


def _string_or_none(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized or normalized.lower() in {"none", "null"}:
        return None
    return normalized


def _arguments(value: Any) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        return dict(value)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return dict(parsed) if isinstance(parsed, Mapping) else None


def _render_output(output: Any) -> str:
    if output is None:
        return ""
    if isinstance(output, str):
        return output
    if isinstance(output, Mapping):
        text = output.get("text")
        if isinstance(text, str):
            return text
    return json.dumps(output, ensure_ascii=False, sort_keys=True, default=str)


__all__ = ["AgentV2TraceCollector"]
