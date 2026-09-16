"""Translate Agent backend stream events into workflow agent-log events.

The Dify Agent backend streams raw pydantic-ai events (tool calls, tool results,
reasoning parts) over SSE. The workflow/chatflow task pipeline already knows how
to publish ``agent_log`` SSE events: the legacy Agent node feeds it
``AgentLogEvent`` and the pipeline turns those into ``QueueAgentLogEvent`` and
finally ``agent_log``. This module maps the Agent V2 stream onto the same event
so an Agent V2 node reaches parity with the legacy node instead of being a black
box between ``node_started`` and ``node_finished``.
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Mapping
from typing import Any

from core.workflow.nodes.agent.events import AgentLogEvent

_LOG_ID_NAMESPACE = uuid.UUID("5f6f9f53-2e5f-4ff1-9d6f-2d9b0e0f3f61")

_STATUS_START = "start"
_STATUS_SUCCESS = "success"
_STATUS_ERROR = "error"

_TOOL_CALL_EVENT_KINDS = frozenset({"function_tool_call", "output_tool_call"})
_TOOL_RESULT_EVENT_KINDS = frozenset({"function_tool_result", "output_tool_result"})

_THINKING_PART_KIND = "thinking"
_BUILTIN_TOOL_CALL_PART_KIND = "builtin-tool-call"
_BUILTIN_TOOL_RETURN_PART_KIND = "builtin-tool-return"
_RETRY_PROMPT_PART_KIND = "retry-prompt"


class AgentBackendLogTranslator:
    """Turn one Agent backend run's stream events into ``AgentLogEvent``s.

    One instance tracks a single run so a tool result can be matched back to its
    call: both sides share a message id, which lets consumers update the log
    entry in place exactly like the legacy Agent node does.
    """

    def __init__(self, *, node_id: str, node_execution_id: str, run_id: str) -> None:
        self._node_id = node_id
        self._node_execution_id = node_execution_id
        self._run_id = run_id
        self._tool_call_started_at: dict[str, float] = {}
        self._sequence = 0

    def translate(self, data: Any, *, event_kind: str | None) -> list[AgentLogEvent]:
        """Map one raw stream event payload onto agent-log events.

        Unknown or purely incremental events (text/thinking deltas) produce no
        log entry: deltas already stream as answer chunks, and emitting one log
        per delta would flood the SSE stream.
        """
        if not isinstance(data, Mapping):
            return []
        kind = event_kind or data.get("event_kind")
        if not isinstance(kind, str):
            return []
        part = data.get("part")
        if not isinstance(part, Mapping):
            return []

        if kind in _TOOL_CALL_EVENT_KINDS:
            return self._tool_call_log(part)
        if kind in _TOOL_RESULT_EVENT_KINDS:
            return self._tool_result_log(part)
        if kind == "part_end":
            part_kind = part.get("part_kind")
            if part_kind == _THINKING_PART_KIND:
                return self._thinking_log(part)
            if part_kind == _BUILTIN_TOOL_CALL_PART_KIND:
                return self._tool_call_log(part, builtin=True)
            if part_kind == _BUILTIN_TOOL_RETURN_PART_KIND:
                return self._tool_result_log(part, builtin=True)
        return []

    def _tool_call_log(self, part: Mapping[str, Any], *, builtin: bool = False) -> list[AgentLogEvent]:
        tool_call_id = part.get("tool_call_id")
        tool_name = part.get("tool_name")
        if not isinstance(tool_name, str) or not tool_name:
            return []
        message_id = self._tool_message_id(tool_call_id)
        if isinstance(tool_call_id, str) and tool_call_id:
            self._tool_call_started_at[tool_call_id] = time.perf_counter()
        return [
            self._event(
                message_id=message_id,
                label=tool_name,
                status=_STATUS_START,
                data={
                    "tool_name": tool_name,
                    "tool_call_id": tool_call_id,
                    "tool_input": _decode_tool_args(part.get("args")),
                    "output": None,
                },
                metadata=self._tool_metadata(tool_name=tool_name, builtin=builtin),
            )
        ]

    def _tool_result_log(self, part: Mapping[str, Any], *, builtin: bool = False) -> list[AgentLogEvent]:
        tool_call_id = part.get("tool_call_id")
        tool_name = part.get("tool_name")
        failed = part.get("part_kind") == _RETRY_PROMPT_PART_KIND
        content = part.get("content")
        metadata = self._tool_metadata(tool_name=tool_name, builtin=builtin)
        elapsed = self._pop_elapsed(tool_call_id)
        if elapsed is not None:
            metadata["elapsed_time"] = elapsed
        return [
            self._event(
                message_id=self._tool_message_id(tool_call_id),
                label=tool_name if isinstance(tool_name, str) and tool_name else "tool",
                status=_STATUS_ERROR if failed else _STATUS_SUCCESS,
                error=_stringify(content) if failed else None,
                data={
                    "tool_name": tool_name,
                    "tool_call_id": tool_call_id,
                    "observation": content,
                    "output": content,
                },
                metadata=metadata,
            )
        ]

    def _thinking_log(self, part: Mapping[str, Any]) -> list[AgentLogEvent]:
        content = part.get("content")
        if not isinstance(content, str) or not content.strip():
            return []
        return [
            self._event(
                message_id=self._next_message_id("thinking"),
                label="thinking",
                status=_STATUS_SUCCESS,
                data={"thought": content},
                metadata={"kind": "reasoning"},
            )
        ]

    def _event(
        self,
        *,
        message_id: str,
        label: str,
        status: str,
        data: dict[str, Any],
        metadata: dict[str, Any],
        error: str | None = None,
    ) -> AgentLogEvent:
        return AgentLogEvent(
            message_id=message_id,
            label=label,
            node_execution_id=self._node_execution_id,
            parent_id=None,
            error=error,
            status=status,
            data=data,
            metadata=metadata,
            node_id=self._node_id,
        )

    def _tool_metadata(self, *, tool_name: Any, builtin: bool) -> dict[str, Any]:
        metadata: dict[str, Any] = {"kind": "builtin_tool" if builtin else "tool"}
        if isinstance(tool_name, str) and tool_name:
            metadata["tool_name"] = tool_name
        return metadata

    def _pop_elapsed(self, tool_call_id: Any) -> float | None:
        if not isinstance(tool_call_id, str):
            return None
        started_at = self._tool_call_started_at.pop(tool_call_id, None)
        if started_at is None:
            return None
        return time.perf_counter() - started_at

    def _tool_message_id(self, tool_call_id: Any) -> str:
        """Share one id between a tool call and its result so consumers update in place."""
        if isinstance(tool_call_id, str) and tool_call_id:
            return str(uuid.uuid5(_LOG_ID_NAMESPACE, f"{self._run_id}:tool:{tool_call_id}"))
        return self._next_message_id("tool")

    def _next_message_id(self, prefix: str) -> str:
        self._sequence += 1
        return str(uuid.uuid5(_LOG_ID_NAMESPACE, f"{self._run_id}:{prefix}:{self._sequence}"))


def _decode_tool_args(args: Any) -> Any:
    """Return tool arguments as structured data when the model streamed them as JSON text."""
    if isinstance(args, str):
        try:
            return json.loads(args)
        except ValueError:
            return args
    return args


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(value)
