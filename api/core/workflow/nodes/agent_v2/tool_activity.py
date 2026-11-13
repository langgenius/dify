"""Project Agent v2 backend stream events into ephemeral tool activity snapshots.

The projector is pure and in-memory: it consumes adapted
``AgentBackendStreamInternalEvent`` payloads for one node execution and returns
JSON-safe ``WorkflowAgentToolActivity`` snapshots that the node re-emits as
``agent_log`` events. It never persists state, never inspects stream payloads
beyond the allowlisted tool fields, and treats ``output_tool_*`` events as
structured output rather than user-visible tool activity.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from clients.agent_backend import AgentBackendStreamInternalEvent

_TOOL_FIELD_LIMIT = 16 * 1024

_UNFINISHED_TOOL_ERROR = "Tool call did not return a result."

ActivityStatus = Literal["started", "running", "succeeded", "failed", "cancelled"]
FinishStatus = Literal["succeeded", "failed", "cancelled"]

_EARLY_TOOL_NAMES = frozenset({"shell_run", "shell_wait", "shell_input", "shell_interrupt"})


class WorkflowAgentToolActivityData(BaseModel):
    """Allowlisted tool fields carried inside the ``agent_log`` data payload."""

    model_config = ConfigDict(frozen=True)

    tool_call_id: str
    tool_name: str
    tool_input: str
    tool_output: str
    node_title: str


class WorkflowAgentToolActivity(BaseModel):
    """One immutable tool-activity snapshot for the chat UI.

    ``id`` is ``<backend run_id>:<tool_call_id>`` so parallel same-named calls
    and retry attempts never collapse into one entry.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    node_id: str
    node_execution_id: str
    label: str
    status: ActivityStatus
    error: str | None = None
    data: WorkflowAgentToolActivityData
    metadata: dict[str, str] = Field(
        default_factory=lambda: {"agent_node_version": "2", "kind": "tool"},
    )


class _ToolStreamPart(BaseModel):
    """Allowlisted boundary view of one pydantic-ai tool stream part."""

    model_config = ConfigDict(extra="ignore")

    part_kind: str | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None
    args: JsonValue = None
    content: JsonValue = None
    outcome: str | None = None


@dataclass
class _ToolCallState:
    """Mutable per-call state; snapshots are emitted as new models."""

    tool_call_id: str
    tool_name: str
    tool_input: str
    tool_output: str = ""
    status: ActivityStatus = "started"
    error: str | None = None


def _bounded_text(value: JsonValue | None) -> str:
    """Return a bounded display string for one JSON-safe tool field.

    Strings pass through; structured values are compactly JSON-serialized.
    The result never exceeds ``_TOOL_FIELD_LIMIT`` characters.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value[:_TOOL_FIELD_LIMIT]
    try:
        serialized = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        serialized = str(value)
    return serialized[:_TOOL_FIELD_LIMIT]


def _first_stream_part(candidates: list[Mapping[str, JsonValue]]) -> _ToolStreamPart | None:
    """Return the first candidate mapping that validates as a tool stream part."""
    for candidate in candidates:
        try:
            return _ToolStreamPart.model_validate(candidate)
        except ValidationError:
            pass
    return None


class WorkflowAgentToolActivityProjector:
    """Project one Agent v2 backend run's tool lifecycle into activity snapshots.

    Precondition: ``handle`` receives only ``STREAM_EVENT`` internal events
    adapted from public ``dify-agent`` run events for a single backend run.
    Postcondition: every returned snapshot is JSON-safe, carries the
    ``agent_node_version=2``/``kind=tool`` metadata marker, and preserves the
    invariant that a tool call emits at most one ``started`` preview and one
    ``running`` transition before reaching a terminal status at most once.
    ``finish`` closes calls still in ``started`` or ``running`` state;
    terminal calls are never regressed.
    """

    def __init__(self, *, node_id: str, node_execution_id: str, node_title: str) -> None:
        self._node_id = node_id
        self._node_execution_id = node_execution_id
        self._node_title = node_title
        self._calls: dict[tuple[str, str], _ToolCallState] = {}

    def handle(self, event: AgentBackendStreamInternalEvent) -> list[WorkflowAgentToolActivity]:
        """Return activity snapshots produced by one stream event.

        Unrelated event kinds, malformed payloads, missing tool-call ids, and
        duplicate terminal transitions return an empty list. ``output_tool_*``
        events are intentionally ignored: structured output is not a real
        user-facing tool call.
        """
        if event.event_kind not in {"function_tool_call", "function_tool_result", "part_start"}:
            return []
        part = self._stream_part(event.data, result_event=event.event_kind == "function_tool_result")
        if part is None:
            return []
        if event.event_kind == "function_tool_call" and part.part_kind == "tool-call":
            return self._run_call(event.run_id, part)
        if event.event_kind == "part_start" and part.part_kind == "builtin-tool-call":
            return self._run_call(event.run_id, part)
        if event.event_kind == "part_start" and part.part_kind == "tool-call":
            return self._start_call(event.run_id, part)
        if event.event_kind == "function_tool_result":
            return self._finish_call(event.run_id, part, retry_is_failure=True)
        if event.event_kind == "part_start" and part.part_kind == "builtin-tool-return":
            return self._finish_call(event.run_id, part, retry_is_failure=False)
        return []

    def finish(
        self,
        status: FinishStatus,
        error: str | None = None,
    ) -> list[WorkflowAgentToolActivity]:
        """Close every still-active call when the backend run terminates.

        ``cancelled`` runs close calls as ``cancelled``; ``failed`` and
        ``succeeded`` runs close leftovers as ``failed`` because an unfinished
        tool must never be presented as successful. The returned snapshots
        preserve start order.
        """
        bounded_error = _bounded_text(error) or None
        activities: list[WorkflowAgentToolActivity] = []
        for (run_id, _tool_call_id), state in self._calls.items():
            if state.status in {"started", "running"}:
                if status == "cancelled":
                    state.status = "cancelled"
                    state.error = bounded_error
                else:
                    state.status = "failed"
                    state.error = bounded_error or _UNFINISHED_TOOL_ERROR
                activities.append(self._snapshot(run_id, state))
        return activities

    @staticmethod
    def _stream_part(data: JsonValue, *, result_event: bool) -> _ToolStreamPart | None:
        """Validate allowlisted part fields from the supported payload shapes.

        Call/start events only accept ``data.part``. Result events additionally
        accept ``data.result`` and top-level tool fields, matching the roster
        runner's result parsing; payloads without a declared ``part_kind`` are
        inferred as ``tool-return`` while unknown declared kinds stay rejected
        downstream.
        """
        if not isinstance(data, Mapping):
            return None
        candidates: list[Mapping[str, JsonValue]] = []
        part = data.get("part")
        if isinstance(part, Mapping):
            candidates.append(part)
        if result_event:
            result = data.get("result")
            if isinstance(result, Mapping):
                candidates.append(result)
            if any(key in data for key in ("tool_call_id", "tool_name", "content")):
                candidates.append(data)
        parsed = _first_stream_part(candidates)
        if parsed is not None and result_event and not parsed.part_kind:
            parsed.part_kind = "tool-return"
        return parsed

    def _start_call(self, run_id: str, part: _ToolStreamPart) -> list[WorkflowAgentToolActivity]:
        """Emit an early ``started`` preview for known shell tool calls only.

        Ordinary ``tool-call`` part starts may carry partially streamed
        arguments and fire for every tool, including structured-output
        preambles, so only the shell tool names get an early preview; other
        calls first appear at ``function_tool_call`` in ``running`` state with
        complete arguments. A second start for the same
        ``(run_id, tool_call_id)`` — including one arriving after promotion or
        a terminal result — is ignored so state never regresses.
        """
        if not part.tool_call_id or not part.tool_name:
            return []
        if part.tool_name not in _EARLY_TOOL_NAMES:
            return []
        key = (run_id, part.tool_call_id)
        if key in self._calls:
            return []
        state = _ToolCallState(
            tool_call_id=part.tool_call_id,
            tool_name=part.tool_name,
            tool_input=_bounded_text(part.args),
        )
        self._calls[key] = state
        return [self._snapshot(run_id, state)]

    def _run_call(self, run_id: str, part: _ToolStreamPart) -> list[WorkflowAgentToolActivity]:
        """Mark a tool call ``running`` with its complete arguments.

        ``function_tool_call`` and ``builtin-tool-call`` events mean the tool
        is actually executing. A call first seen here is created in
        ``running`` state; a call already previewed as ``started`` is promoted
        and its partial arguments replaced by the complete ones. Duplicate
        running starts and starts after a terminal result return no snapshot.
        """
        if not part.tool_call_id or not part.tool_name:
            return []
        key = (run_id, part.tool_call_id)
        state = self._calls.get(key)
        if state is None:
            state = _ToolCallState(
                tool_call_id=part.tool_call_id,
                tool_name=part.tool_name,
                tool_input=_bounded_text(part.args),
                status="running",
            )
            self._calls[key] = state
            return [self._snapshot(run_id, state)]
        if state.status != "started":
            return []
        state.tool_name = part.tool_name
        state.tool_input = _bounded_text(part.args)
        state.status = "running"
        return [self._snapshot(run_id, state)]

    def _finish_call(
        self,
        run_id: str,
        part: _ToolStreamPart,
        *,
        retry_is_failure: bool,
    ) -> list[WorkflowAgentToolActivity]:
        """Complete an active call, or emit one completed snapshot when unmatched.

        ``retry-prompt`` results mark the call ``failed`` because the model
        rejected the arguments and will issue a new call. ``tool-return``
        results map ``outcome == "failure"`` to ``failed`` and everything else
        to ``succeeded``. A result for an unknown call still produces one
        terminal snapshot so late-arriving results are not silently dropped —
        unless it carries no ``tool_name``, which the UI could not display;
        subsequent duplicates are ignored through the stored terminal state.
        """
        if not part.tool_call_id:
            return []
        is_retry = part.part_kind == "retry-prompt"
        is_return = part.part_kind in {"tool-return", "builtin-tool-return"}
        if not is_retry and not is_return:
            return []
        if is_retry and not retry_is_failure:
            return []
        key = (run_id, part.tool_call_id)
        state = self._calls.get(key)
        if state is None:
            if not part.tool_name:
                return []
            state = _ToolCallState(
                tool_call_id=part.tool_call_id,
                tool_name=part.tool_name,
                tool_input="",
            )
            self._calls[key] = state
        if state.status not in {"started", "running"}:
            return []
        if state.tool_name == "" and part.tool_name:
            state.tool_name = part.tool_name
        if is_retry:
            state.status = "failed"
            state.error = _bounded_text(part.content) or None
        else:
            output = _bounded_text(part.content)
            state.tool_output = output
            if part.outcome == "failure":
                state.status = "failed"
                state.error = output or None
            else:
                state.status = "succeeded"
        return [self._snapshot(run_id, state)]

    def _snapshot(self, run_id: str, state: _ToolCallState) -> WorkflowAgentToolActivity:
        return WorkflowAgentToolActivity(
            id=f"{run_id}:{state.tool_call_id}",
            node_id=self._node_id,
            node_execution_id=self._node_execution_id,
            label=state.tool_name,
            status=state.status,
            error=state.error,
            data=WorkflowAgentToolActivityData(
                tool_call_id=state.tool_call_id,
                tool_name=state.tool_name,
                tool_input=state.tool_input,
                tool_output=state.tool_output,
                node_title=self._node_title,
            ),
        )
