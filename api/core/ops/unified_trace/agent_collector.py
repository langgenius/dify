"""Fail-open collection of provider-neutral Agent trace fragments.

Deferred from unified tracing v1: no core producer path wires this collector
(see ADR-0001 "Out of scope (v1)"). Retained so a future contract revision can
re-adopt Agent execution sub-spans without re-deriving the design.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from core.ops.unified_trace.agent_events import (
    AgentRunTraceFragment,
    AgentSemanticEvent,
    AgentSemanticEventKind,
    AgentTraceOperation,
    bound_trace_value,
)


@dataclass
class _PendingLLMTurn:
    start_time: datetime
    end_time: datetime
    chunks_by_kind: dict[str, list[Any]] = field(default_factory=dict)

    def append(self, event: AgentSemanticEvent) -> None:
        content_kind = event.payload.get("content_kind", "text")
        if content_kind not in {"text", "thinking"}:
            raise ValueError("Agent LLM event has invalid content_kind")
        if "delta" not in event.payload:
            raise ValueError("Agent LLM event has no delta")
        self.chunks_by_kind.setdefault(content_kind, []).append(event.payload["delta"])
        self.end_time = event.occurred_at

    def outputs(self) -> dict[str, Any]:
        outputs: dict[str, Any] = {}
        for content_kind, chunks in self.chunks_by_kind.items():
            value: Any = "".join(chunks) if all(isinstance(chunk, str) for chunk in chunks) else chunks
            outputs[content_kind] = bound_trace_value(value)
        return outputs


class AgentSemanticTraceCollector:
    """Collect one Agent backend attempt without affecting its execution."""

    def __init__(
        self,
        *,
        run_id: str,
        role: Literal["initial", "resume", "retry"],
        start_time: datetime,
        workflow_tool_names: set[str] | None = None,
    ) -> None:
        self._run_id = run_id
        self._role = role
        self._start_time = start_time
        self._operations: list[AgentTraceOperation] = []
        self._pending_llm_turn: _PendingLLMTurn | None = None
        self._pending_tool_calls: dict[str, AgentSemanticEvent] = {}
        self._warning_codes: set[str] = set()
        self._dropped_event_count = 0
        self._workflow_tool_names = workflow_tool_names or set()

    def consume(self, event: object) -> None:
        try:
            if not isinstance(event, AgentSemanticEvent):
                raise TypeError("Agent semantic event is invalid")
            self._consume(event)
        except Exception:
            self._warning_codes.add("agent_event_dropped")
            self._dropped_event_count += 1

    def finish(
        self,
        *,
        output: Any = None,
        error: str | None = None,
        end_time: datetime | None = None,
    ) -> AgentRunTraceFragment:
        self._append_pending_llm_turn()
        self._append_unfinished_tool_calls()
        return AgentRunTraceFragment(
            run_id=self._run_id,
            role=self._role,
            start_time=self._start_time,
            end_time=end_time,
            operations=tuple(self._operations),
            output=output,
            error=error,
            complete=not self._warning_codes,
            warning_codes=tuple(sorted(self._warning_codes)),
            dropped_event_count=self._dropped_event_count,
        )

    def _consume(self, event: AgentSemanticEvent) -> None:
        if event.kind is AgentSemanticEventKind.LLM:
            if self._pending_llm_turn is None:
                self._pending_llm_turn = _PendingLLMTurn(
                    start_time=event.occurred_at,
                    end_time=event.occurred_at,
                )
            self._pending_llm_turn.append(event)
            return
        if event.kind is AgentSemanticEventKind.TOOL_CALL:
            self._append_pending_llm_turn()
            tool_call_id = _required_tool_call_id(event.payload)
            self._pending_tool_calls[tool_call_id] = event
            return
        if event.kind is AgentSemanticEventKind.TOOL_RESULT:
            self._append_pending_llm_turn()
            self._append_tool_result(event)

    def _append_pending_llm_turn(self) -> None:
        turn = self._pending_llm_turn
        if turn is None:
            return
        self._operations.append(
            AgentTraceOperation(
                id=f"{self._run_id}:llm:{len(self._operations)}",
                kind="llm",
                name="llm",
                start_time=turn.start_time,
                end_time=turn.end_time,
                outputs=turn.outputs(),
            )
        )
        self._pending_llm_turn = None

    def _append_tool_result(self, result: AgentSemanticEvent) -> None:
        tool_call_id = _required_tool_call_id(result.payload)
        call = self._pending_tool_calls.pop(tool_call_id, None)
        if call is None:
            raise ValueError("Agent tool result has no matching call")
        self._operations.append(
            _tool_operation(
                self._run_id,
                tool_call_id,
                call,
                result,
                workflow_tool_names=self._workflow_tool_names,
            )
        )

    def _append_unfinished_tool_calls(self) -> None:
        for tool_call_id, call in self._pending_tool_calls.items():
            self._operations.append(
                _tool_operation(
                    self._run_id,
                    tool_call_id,
                    call,
                    None,
                    workflow_tool_names=self._workflow_tool_names,
                )
            )
        self._pending_tool_calls.clear()


def _required_tool_call_id(payload: dict[str, Any]) -> str:
    value = payload.get("tool_call_id")
    if not isinstance(value, str) or not value:
        raise ValueError("Agent tool event has no tool_call_id")
    return value


def _tool_operation(
    run_id: str,
    tool_call_id: str,
    call: AgentSemanticEvent,
    result: AgentSemanticEvent | None,
    *,
    workflow_tool_names: set[str],
) -> AgentTraceOperation:
    tool_name = call.payload.get("tool_name")
    metadata: dict[str, Any] = {"tool_call_id": tool_call_id}
    if isinstance(tool_name, str) and tool_name in workflow_tool_names:
        metadata["provider_type"] = "workflow"
    return AgentTraceOperation(
        id=f"{run_id}:tool:{tool_call_id}",
        kind="tool",
        name=tool_name if isinstance(tool_name, str) and tool_name else "tool",
        start_time=call.occurred_at,
        end_time=result.occurred_at if result is not None else None,
        inputs=call.payload.get("arguments"),
        outputs=result.payload.get("result") if result is not None else None,
        metadata=metadata,
        error="tool result missing" if result is None else None,
    )
