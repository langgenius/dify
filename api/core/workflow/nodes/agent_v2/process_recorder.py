from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from dify_agent.protocol import PydanticAIStreamRunEvent, RunEvent, RunSucceededEvent
from pydantic import TypeAdapter
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelResponsePart,
    NativeToolCallPart,
    NativeToolReturnPart,
    OutputToolCallEvent,
    OutputToolResultEvent,
    PartDeltaEvent,
    PartEndEvent,
    PartStartEvent,
    RetryPromptPart,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolCallPart,
    ToolCallPartDelta,
    ToolReturnPart,
)

_CONTENT_ADAPTER = TypeAdapter(object)


def _text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return _CONTENT_ADAPTER.dump_json(value).decode()


class WorkflowAgentProcessRecorder:
    def __init__(self, process_data: dict[str, Any], run_id: str) -> None:
        self._process_data = process_data
        self._run_id = run_id
        self._parts: dict[int, ModelResponsePart] = {}
        self._rows: dict[int, dict[str, Any]] = {}
        self._tools: dict[str, dict[str, Any]] = {}
        self._seen: set[str] = set()
        self._last_answer: dict[str, Any] | None = None

    def record(self, event: RunEvent) -> None:
        if event.id is not None:
            if event.id in self._seen:
                return
            self._seen.add(event.id)
        if isinstance(event, RunSucceededEvent):
            if "output" in event.data.model_fields_set and isinstance(event.data.output, str):
                self._trim_final_answer(event.data.output)
            return
        if not isinstance(event, PydanticAIStreamRunEvent):
            return
        data = event.data
        if isinstance(data, PartStartEvent):
            # A repeated start index denotes a new response; indexes can first arrive out of order.
            if data.index in self._parts:
                self._parts.clear()
                self._rows.clear()
            self._record_part(data.index, data.part, event.created_at)
        elif isinstance(data, PartEndEvent):
            self._record_part(data.index, data.part, event.created_at)
        elif isinstance(data, PartDeltaEvent):
            delta = data.delta
            if not isinstance(delta, TextPartDelta | ThinkingPartDelta | ToolCallPartDelta):
                return
            part = self._parts.get(data.index)
            if part is None:
                if isinstance(delta, TextPartDelta):
                    part = TextPart("")
                elif isinstance(delta, ThinkingPartDelta):
                    part = ThinkingPart("")
                else:
                    part = delta.as_part()
                    if part is not None:
                        self._record_part(data.index, part, event.created_at)
                    return
            self._record_part(data.index, delta.apply(part), event.created_at)
        elif isinstance(
            data, FunctionToolCallEvent | OutputToolCallEvent | FunctionToolResultEvent | OutputToolResultEvent
        ):
            self._record_tool(data.part, event.created_at)

    def _record_part(self, index: int, part: ModelResponsePart, created_at: datetime) -> None:
        if not isinstance(part, TextPart | ThinkingPart | ToolCallPart | NativeToolCallPart | NativeToolReturnPart):
            return
        previous_part = self._parts.get(index)
        self._parts[index] = part
        if isinstance(part, ToolCallPart | NativeToolCallPart | NativeToolReturnPart):
            if (
                isinstance(previous_part, ToolCallPart | NativeToolCallPart)
                and previous_part.tool_call_id != part.tool_call_id
            ):
                self._tools.pop(previous_part.tool_call_id, None)
            self._rows[index] = self._record_tool(part, created_at, row=self._rows.get(index))
            return
        row = self._rows.get(index)
        if row is None:
            row = self._new_step(created_at)
            self._rows[index] = row
        if isinstance(part, ThinkingPart):
            row["thought"] = part.content
            self._last_answer = None
        else:
            row["answer"] = part.content
            self._last_answer = row

    def _record_tool(
        self,
        part: ToolCallPart | NativeToolCallPart | ToolReturnPart | NativeToolReturnPart | RetryPromptPart,
        created_at: datetime,
        *,
        row: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        self._last_answer = None
        row = self._tools.get(part.tool_call_id, row)
        if row is None:
            row = self._new_step(created_at)
        self._tools[part.tool_call_id] = row
        row["tool"] = part.tool_name or ""
        if isinstance(part, ToolCallPart | NativeToolCallPart):
            row["tool_input"] = _text(part.args)
        else:
            row["observation"] = _text(part.content)
        return row

    def _new_step(self, created_at: datetime) -> dict[str, Any]:
        steps = self._process_data.setdefault("agent_thoughts", [])
        row = {
            "id": str(uuid4()),
            "chain_id": self._run_id,
            "position": len(steps) + 1,
            "created_at": int(created_at.timestamp()),
            "thought": "",
            "answer": "",
            "tool": "",
            "tool_labels": {},
            "tool_input": "",
            "observation": "",
            "files": [],
        }
        steps.append(row)
        return row

    def _trim_final_answer(self, answer: str) -> None:
        if self._last_answer is None or not answer:
            return
        rows = [self._rows[index] for index in sorted(self._parts) if isinstance(self._parts[index], TextPart)]
        if "\n\n".join(row["answer"] for row in rows) != answer:
            return
        answer_ids = {row["id"] for row in rows}
        steps = self._process_data["agent_thoughts"]
        steps[:] = [step for step in steps if step["id"] not in answer_ids]
        for position, step in enumerate(steps, start=1):
            step["position"] = position
