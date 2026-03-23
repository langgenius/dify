from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from copy import deepcopy
from operator import itemgetter
from typing import Any

from core.file import FILE_MODEL_IDENTITY, File
from core.variables.segments import ArrayFileSegment, FileSegment, Segment
from core.workflow.entities.tool_entities import ToolResultStatus
from core.workflow.enums import WorkflowNodeExecutionMetadataKey
from core.workflow.graph_events import ChunkType, NodeRunStreamChunkEvent


class WorkflowResultReplayBuilder:
    """Build a persisted replay payload for workflow result rendering."""

    def __init__(self) -> None:
        self._text = ""
        self._items: list[dict[str, Any]] = []
        self._active_thought_index: int | None = None
        self._active_tool_key: str | None = None
        self._tool_indexes: dict[str, int] = {}

    def add_stream_chunk(self, event: NodeRunStreamChunkEvent) -> None:
        if _is_empty_terminal_stream_event(event):
            return

        if event.chunk_type == ChunkType.TEXT:
            self._append_text(event.chunk)
            return

        if event.chunk_type == ChunkType.THOUGHT_START:
            self._close_open_text_item()
            self._active_thought_index = len(self._items)
            self._items.append({
                "type": "thought",
                "thought_output": event.chunk or "",
                "thought_completed": False,
            })
            return

        if event.chunk_type == ChunkType.THOUGHT:
            thought_index = self._ensure_active_thought()
            self._items[thought_index]["thought_output"] += event.chunk or ""
            return

        if event.chunk_type == ChunkType.THOUGHT_END:
            thought_index = self._ensure_active_thought()
            self._items[thought_index]["thought_output"] += event.chunk or ""
            self._items[thought_index]["thought_completed"] = True
            self._active_thought_index = None
            return

        if event.chunk_type == ChunkType.TOOL_CALL:
            self._close_open_text_item()
            tool_call = event.tool_call
            tool_key = (tool_call.id if tool_call else None) or f"tool-{len(self._items)}"
            tool_index = self._tool_indexes.get(tool_key)

            if tool_index is None:
                self._items.append({
                    "type": "tool",
                    "tool_name": tool_call.name if tool_call else None,
                    "tool_arguments": tool_call.arguments if tool_call else None,
                    "tool_icon": tool_call.icon if tool_call else None,
                    "tool_icon_dark": tool_call.icon_dark if tool_call else None,
                })
                tool_index = len(self._items) - 1
                self._tool_indexes[tool_key] = tool_index
            else:
                payload = self._items[tool_index]
                if tool_call:
                    if tool_call.name:
                        payload["tool_name"] = tool_call.name
                    if tool_call.arguments is not None:
                        payload["tool_arguments"] = tool_call.arguments
                    if tool_call.icon is not None:
                        payload["tool_icon"] = tool_call.icon
                    if tool_call.icon_dark is not None:
                        payload["tool_icon_dark"] = tool_call.icon_dark

            self._active_tool_key = tool_key
            return

        if event.chunk_type == ChunkType.TOOL_RESULT:
            tool_result = event.tool_result
            tool_key = (tool_result.id if tool_result else None) or self._active_tool_key or f"tool-{len(self._items)}"
            tool_index = self._tool_indexes.get(tool_key)

            if tool_index is None:
                self._items.append({
                    "type": "tool",
                    "tool_name": tool_result.name if tool_result else None,
                })
                tool_index = len(self._items) - 1
                self._tool_indexes[tool_key] = tool_index

            payload = self._items[tool_index]
            if tool_result:
                if tool_result.name:
                    payload["tool_name"] = tool_result.name
                if tool_result.output is not None:
                    payload["tool_output"] = tool_result.output
                if tool_result.files:
                    payload["tool_files"] = [_normalize_file_like(file) for file in tool_result.files]
                if tool_result.elapsed_time is not None:
                    payload["tool_duration"] = tool_result.elapsed_time
                if tool_result.icon is not None:
                    payload["tool_icon"] = tool_result.icon
                if tool_result.icon_dark is not None:
                    payload["tool_icon_dark"] = tool_result.icon_dark
                if tool_result.status == ToolResultStatus.ERROR:
                    payload["tool_error"] = tool_result.output or "error"
                elif "tool_error" in payload:
                    payload.pop("tool_error", None)

            self._active_tool_key = tool_key

    def _append_text(self, chunk: str) -> None:
        self._text += chunk or ""

        if self._items and self._items[-1].get("type") == "text" and not self._items[-1].get("text_completed", False):
            self._items[-1]["text"] += chunk or ""
            return

        self._items.append({
            "type": "text",
            "text": chunk or "",
            "text_completed": False,
        })

    def _close_open_text_item(self) -> None:
        if self._items and self._items[-1].get("type") == "text":
            self._items[-1]["text_completed"] = True

    def _ensure_active_thought(self) -> int:
        if self._active_thought_index is not None:
            return self._active_thought_index

        self._close_open_text_item()
        self._items.append({
            "type": "thought",
            "thought_output": "",
            "thought_completed": False,
        })
        self._active_thought_index = len(self._items) - 1
        return self._active_thought_index

    def build(self, outputs: Mapping[str, Any] | None = None) -> dict[str, Any] | None:
        replay_text = self._text or _get_single_output_text(outputs)
        items = deepcopy(self._items)

        if not items:
            generation = _get_single_generation_output(outputs)
            if generation:
                generation_text, generation_items = _build_generation_items_from_payload(generation)
                replay_text = replay_text or generation_text
                items = generation_items

        for item in items:
            if item.get("type") == "text":
                item["text_completed"] = True
            if item.get("type") == "thought":
                item["thought_completed"] = True

        files = _group_files_by_output_var(outputs)

        if not replay_text and not items and not files:
            return None

        return {
            "text": replay_text,
            "llm_generation_items": items,
            "files": files,
        }


def build_result_replay_from_node_executions(
    outputs: Mapping[str, Any] | None,
    node_executions: Iterable[Any],
) -> dict[str, Any] | None:
    preferred_text = _get_single_output_text(outputs)
    generation = _get_single_generation_output(outputs)
    if not preferred_text and generation:
        preferred_text = generation.get("content") if isinstance(generation.get("content"), str) else ""

    files = _group_files_by_output_var(outputs)
    candidates: list[tuple[int, int, str, Sequence[Mapping[str, Any]]]] = []

    for node_execution in node_executions:
        metadata = getattr(node_execution, "metadata", None) or {}
        if not isinstance(metadata, Mapping):
            continue

        llm_trace = metadata.get(WorkflowNodeExecutionMetadataKey.LLM_TRACE) or metadata.get(
            WorkflowNodeExecutionMetadataKey.LLM_TRACE.value
        )
        if not isinstance(llm_trace, Sequence):
            continue

        node_outputs = getattr(node_execution, "outputs", None) or {}
        if not isinstance(node_outputs, Mapping):
            continue

        node_generation = (
            _get_single_generation_output({"generation": node_outputs.get("generation")})
            if node_outputs.get("generation")
            else None
        )
        node_text = node_outputs.get("text")
        if not isinstance(node_text, str) and node_generation:
            node_text = node_generation.get("content")

        if not isinstance(node_text, str):
            node_text = ""

        score = 0
        if preferred_text and node_text:
            if preferred_text == node_text:
                score = 3
            elif preferred_text in node_text or node_text in preferred_text:
                score = 2
        elif node_text:
            score = 1

        candidates.append((score, int(getattr(node_execution, "index", 0) or 0), node_text, llm_trace))

    if not candidates:
        return None

    candidates.sort(key=itemgetter(0, 1), reverse=True)

    for _, _, node_text, llm_trace in candidates:
        replay = _build_result_replay_from_llm_trace(
            llm_trace=llm_trace,
            preferred_text=preferred_text or node_text,
            files=files,
        )
        if replay:
            return replay

    return None


def _get_single_output_text(outputs: Mapping[str, Any] | None) -> str:
    if not outputs or len(outputs) != 1:
        return ""

    value = next(iter(outputs.values()))
    return value if isinstance(value, str) else ""


def _get_single_generation_output(outputs: Mapping[str, Any] | None) -> Mapping[str, Any] | None:
    if not outputs or len(outputs) != 1:
        return None

    value = next(iter(outputs.values()))
    return value if isinstance(value, Mapping) else None


def _build_generation_items_from_payload(generation: Mapping[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    result_text = generation.get("content") if isinstance(generation.get("content"), str) else ""
    reasoning_content = (
        generation.get("reasoning_content") if isinstance(generation.get("reasoning_content"), list) else []
    )
    tool_calls = generation.get("tool_calls") if isinstance(generation.get("tool_calls"), list) else []
    sequence = generation.get("sequence") if isinstance(generation.get("sequence"), list) else []
    items: list[dict[str, Any]] = []

    def append_tool(tool_call: Mapping[str, Any], index: int) -> None:
        tool_output = tool_call.get("result") if "result" in tool_call else tool_call.get("output")
        payload: dict[str, Any] = {
            "type": "tool",
            "tool_name": tool_call.get("name"),
            "tool_arguments": tool_call.get("arguments"),
            "tool_output": tool_output,
            "tool_duration": tool_call.get("elapsed_time") or tool_call.get("time_cost"),
        }
        if tool_call.get("icon") is not None or tool_call.get("tool_icon") is not None:
            payload["tool_icon"] = tool_call.get("icon") or tool_call.get("tool_icon")
        if tool_call.get("icon_dark") is not None or tool_call.get("tool_icon_dark") is not None:
            payload["tool_icon_dark"] = tool_call.get("icon_dark") or tool_call.get("tool_icon_dark")
        if isinstance(tool_call.get("files"), list):
            payload["tool_files"] = [_normalize_file_like(file) for file in tool_call.get("files", [])]
        elif isinstance(tool_call.get("tool_files"), list):
            payload["tool_files"] = [_normalize_file_like(file) for file in tool_call.get("tool_files", [])]

        if tool_call.get("status") == "error":
            payload["tool_error"] = tool_call.get("error") or stringify_copy_value(tool_output) or "error"

        items.append(payload)

    for segment in sequence:
        if not isinstance(segment, Mapping):
            continue

        if segment.get("type") == "content":
            start = segment.get("start", 0)
            end = segment.get("end", start)
            if isinstance(start, int) and isinstance(end, int):
                text = result_text[start:end]
                if text.strip():
                    items.append({"type": "text", "text": text, "text_completed": True})
        elif segment.get("type") == "reasoning":
            index = segment.get("index")
            if isinstance(index, int) and index < len(reasoning_content) and isinstance(reasoning_content[index], str):
                items.append({
                    "type": "thought",
                    "thought_output": reasoning_content[index],
                    "thought_completed": True,
                })
        elif segment.get("type") == "tool_call":
            index = segment.get("index")
            if isinstance(index, int) and index < len(tool_calls) and isinstance(tool_calls[index], Mapping):
                append_tool(tool_calls[index], index)

    if not items and (reasoning_content or tool_calls or result_text):
        synthetic_count = max(len(reasoning_content), len(tool_calls))
        for index in range(synthetic_count):
            if (
                index < len(reasoning_content)
                and isinstance(reasoning_content[index], str)
                and reasoning_content[index]
            ):
                items.append({
                    "type": "thought",
                    "thought_output": reasoning_content[index],
                    "thought_completed": True,
                })

            if index < len(tool_calls) and isinstance(tool_calls[index], Mapping):
                append_tool(tool_calls[index], index)

        if result_text:
            items.append({"type": "text", "text": result_text, "text_completed": True})

    return result_text, items


def _build_result_replay_from_llm_trace(
    *,
    llm_trace: Sequence[Mapping[str, Any]],
    preferred_text: str,
    files: list[dict[str, Any]],
) -> dict[str, Any] | None:
    items: list[dict[str, Any]] = []
    tool_indexes: dict[str, int] = {}

    for segment in llm_trace:
        if not isinstance(segment, Mapping):
            continue

        segment_type = segment.get("type")
        output = segment.get("output") if isinstance(segment.get("output"), Mapping) else {}

        if segment_type == "model":
            reasoning = output.get("reasoning")
            if isinstance(reasoning, str) and reasoning:
                items.append({
                    "type": "thought",
                    "thought_output": reasoning,
                    "thought_completed": True,
                })

            text = output.get("text")
            if isinstance(text, str) and text:
                items.append({
                    "type": "text",
                    "text": text,
                    "text_completed": True,
                })

            tool_calls = output.get("tool_calls")
            if isinstance(tool_calls, list):
                for tool_call in tool_calls:
                    if not isinstance(tool_call, Mapping):
                        continue

                    tool_id = str(tool_call.get("id") or f"tool-{len(tool_indexes)}")
                    items.append({
                        "type": "tool",
                        "tool_name": tool_call.get("name"),
                        "tool_arguments": tool_call.get("arguments"),
                    })
                    tool_indexes[tool_id] = len(items) - 1

        elif segment_type == "tool":
            tool_id = str(output.get("id") or f"tool-{len(tool_indexes)}")
            tool_index = tool_indexes.get(tool_id)
            if tool_index is None:
                items.append({
                    "type": "tool",
                    "tool_name": output.get("name"),
                })
                tool_index = len(items) - 1
                tool_indexes[tool_id] = tool_index

            payload = items[tool_index]
            payload["tool_name"] = output.get("name") or payload.get("tool_name")
            payload["tool_arguments"] = output.get("arguments") or payload.get("tool_arguments")
            payload["tool_output"] = output.get("output")
            payload["tool_duration"] = segment.get("duration")
            if segment.get("icon") is not None:
                payload["tool_icon"] = segment.get("icon")
            if segment.get("icon_dark") is not None:
                payload["tool_icon_dark"] = segment.get("icon_dark")
            if isinstance(output.get("files"), list):
                payload["tool_files"] = [_normalize_file_like(file) for file in output.get("files", [])]
            if segment.get("status") == "error":
                payload["tool_error"] = segment.get("error") or stringify_copy_value(output.get("output")) or "error"

    if not items and not preferred_text and not files:
        return None

    combined_text = "".join(
        item.get("text", "")
        for item in items
        if item.get("type") == "text" and isinstance(item.get("text"), str)
    )
    if (
        preferred_text
        and preferred_text != combined_text
        and preferred_text not in combined_text
        and combined_text not in preferred_text
    ):
        items.append({
            "type": "text",
            "text": preferred_text,
            "text_completed": True,
        })

    return {
        "text": preferred_text or combined_text,
        "llm_generation_items": items,
        "files": files,
    }


def _is_empty_terminal_stream_event(event: NodeRunStreamChunkEvent) -> bool:
    if not event.is_final:
        return False

    if event.chunk_type == ChunkType.TEXT:
        return not event.chunk

    if event.chunk_type in {ChunkType.THOUGHT, ChunkType.THOUGHT_START, ChunkType.THOUGHT_END}:
        return not event.chunk

    if event.chunk_type == ChunkType.TOOL_CALL:
        tool_call = event.tool_call
        if not tool_call:
            return True
        return not tool_call.id and not tool_call.name and not tool_call.arguments and not event.chunk

    if event.chunk_type == ChunkType.TOOL_RESULT:
        tool_result = event.tool_result
        if not tool_result:
            return True
        return (
            not tool_result.id
            and not tool_result.name
            and not tool_result.output
            and not tool_result.files
            and not event.chunk
        )

    return False


def _group_files_by_output_var(outputs: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    if not outputs:
        return []

    result: list[dict[str, Any]] = []
    for key, value in outputs.items():
        files = _fetch_files_from_variable_value(value)
        if files:
            result.append({
                "var_name": key,
                "files": list(files),
            })

    return result


def _fetch_files_from_variable_value(
    value: dict[str, Any] | list[Any] | Segment | File | None,
) -> Sequence[Mapping[str, Any]]:
    if not value:
        return []

    files: list[Mapping[str, Any]] = []
    if isinstance(value, FileSegment):
        files.append(value.value.to_dict())
    elif isinstance(value, ArrayFileSegment):
        files.extend([item.to_dict() for item in value.value])
    elif isinstance(value, File):
        files.append(value.to_dict())
    elif isinstance(value, list):
        for item in value:
            file = _get_file_var_from_value(item)
            if file:
                files.append(file)
    elif isinstance(value, dict):
        file = _get_file_var_from_value(value)
        if file:
            files.append(file)

    return files


def _get_file_var_from_value(value: Any) -> Mapping[str, Any] | None:
    if not value:
        return None

    if isinstance(value, dict) and value.get("dify_model_identity") == FILE_MODEL_IDENTITY:
        return value
    if isinstance(value, File):
        return value.to_dict()

    return None


def _normalize_file_like(value: Any) -> Any:
    if isinstance(value, File):
        return value.to_dict()

    if isinstance(value, Mapping):
        return dict(value)

    return value


def stringify_copy_value(value: Any) -> str:
    if isinstance(value, str):
        return value

    if value is None:
        return ""

    try:
        return str(value) if not isinstance(value, (Mapping, list)) else json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)
