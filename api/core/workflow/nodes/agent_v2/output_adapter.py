from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from clients.agent_backend import (
    AgentBackendInternalEvent,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
)
from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.workflow.file_reference import is_canonical_file_reference
from core.workflow.nodes.agent.events import AgentLogEvent
from factories.file_factory.builders import build_from_mapping
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from graphon.variables.segments import ArrayFileSegment, FileSegment
from models.agent_config_entities import DeclaredOutputConfig, DeclaredOutputType


class ToolFileRebacker(Protocol):
    def __call__(self, *, tenant_id: str, tool_file_id: str) -> File | None: ...


class WorkflowAgentOutputAdapter:
    """Convert terminal Agent backend events into workflow node run results.

    Structured runs provide custom declarations so their declared ``FILE`` and
    ``ARRAY[FILE]`` fields can be converted into workflow file values without
    treating normal object fields as files. Plain runs provide a free-form
    string, which is mapped directly to the system ``text`` output. Older Agent
    backend builds may still return bare ToolFile ids (``{"id": "..."}``); when
    a ``ToolFileRebacker`` is provided, those ids are treated as a
    backwards-compatible fallback and hydrated from the server-side ToolFile
    row instead of trusted from the sandbox payload.
    """

    _tool_file_rebacker: ToolFileRebacker | None

    def __init__(self, *, tool_file_rebacker: ToolFileRebacker | None = None) -> None:
        self._tool_file_rebacker = tool_file_rebacker

    def build_success_result(
        self,
        *,
        event: AgentBackendRunSucceededInternalEvent,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
        declared_outputs: Sequence[DeclaredOutputConfig] | None = None,
        tenant_id: str | None = None,
        edge_source_handle: str = "source",
        agent_log: Sequence[AgentLogEvent] = (),
    ) -> NodeRunResult:
        """Build the successful node result from one backend terminal event.

        For structured runs, ``declared_outputs`` contains the custom-only
        declarations used to scope field and file normalization. Plain runs
        omit custom declarations, and a free-form string is mapped to the
        system ``text`` output. The caller validates and selects the successful
        ``edge_source_handle`` before invoking this adapter.

        Canonical persisted-file mappings (``local_file`` / ``tool_file`` /
        ``datasource_file``) also require ``metadata["tenant_id"]`` so the
        adapter can hydrate filename / extension / mime metadata through the
        server-side file factory before producing ``FileSegment`` values.
        """
        metadata = self._with_terminal_metadata(metadata, event, "succeeded")
        usage = self._usage_from_metadata(metadata)
        metadata_tenant_id = metadata.get("tenant_id")
        resolved_tenant_id = tenant_id or (metadata_tenant_id if isinstance(metadata_tenant_id, str) else None)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            edge_source_handle=edge_source_handle,
            inputs=inputs,
            process_data=process_data,
            outputs=self._normalize_outputs(
                event.output,
                declared_outputs=declared_outputs,
                tenant_id=resolved_tenant_id,
            ),
            metadata=self._build_node_metadata(metadata=metadata, usage=usage, agent_log=agent_log),
            llm_usage=usage or LLMUsage.empty_usage(),
        )

    def build_failure_result(
        self,
        *,
        event: (AgentBackendRunFailedInternalEvent | AgentBackendRunCancelledInternalEvent),
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
        agent_log: Sequence[AgentLogEvent] = (),
    ) -> NodeRunResult:
        status = WorkflowNodeExecutionStatus.FAILED
        error = "Agent backend run failed."
        error_type = "agent_backend_run_failed"
        terminal_status = "failed"

        match event:
            case AgentBackendRunFailedInternalEvent():
                error = event.error
                error_type = event.error_type or event.reason or "agent_backend_run_failed"
                terminal_status = "failed"
            case AgentBackendRunCancelledInternalEvent():
                error = event.message or "Agent backend run was cancelled."
                error_type = "agent_backend_run_cancelled"
                terminal_status = "cancelled"

        metadata = self._with_terminal_metadata(metadata, event, terminal_status)
        usage = self._usage_from_metadata(metadata)
        return NodeRunResult(
            status=status,
            inputs=inputs,
            process_data=process_data,
            metadata=self._build_node_metadata(metadata=metadata, usage=usage, agent_log=agent_log),
            llm_usage=usage or LLMUsage.empty_usage(),
            error=error,
            error_type=error_type,
        )

    def build_stream_exhausted_result(
        self,
        *,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
        agent_log: Sequence[AgentLogEvent] = (),
    ) -> NodeRunResult:
        usage = self._usage_from_metadata(metadata)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            inputs=inputs,
            process_data=process_data,
            metadata=self._build_node_metadata(metadata=metadata, usage=usage, agent_log=agent_log),
            llm_usage=usage or LLMUsage.empty_usage(),
            error="Agent backend stream ended before a terminal event.",
            error_type="agent_backend_stream_error",
        )

    def _normalize_outputs(
        self,
        output: Any,
        *,
        declared_outputs: Sequence[DeclaredOutputConfig] | None = None,
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        """Normalize backend output payloads into workflow-facing values.

        Field values remain untouched unless the declared output type says they
        should be interpreted as files. Non-remote canonical mappings depend on
        ``tenant_id`` so persisted file metadata can be reconstructed through the
        DB-backed file factory.
        """
        if isinstance(output, dict):
            declared_outputs_by_name = {declared.name: declared for declared in declared_outputs or ()}
            return {
                key: self._normalize_output_value(
                    value,
                    declared_output=declared_outputs_by_name.get(key),
                    tenant_id=tenant_id,
                )
                for key, value in output.items()
            }
        if isinstance(output, str):
            return {"text": output}
        return {"result": output}

    def _normalize_output_value(
        self,
        value: Any,
        *,
        declared_output: DeclaredOutputConfig | None = None,
        tenant_id: str | None = None,
    ) -> Any:
        if isinstance(value, File | FileSegment | ArrayFileSegment):
            return value
        legacy_tool_file_value = self._normalize_legacy_tool_file_value(value, tenant_id=tenant_id)
        if legacy_tool_file_value is not None:
            return legacy_tool_file_value
        if declared_output is not None:
            normalized_declared_value = self._normalize_declared_output_value(
                value,
                declared_output=declared_output,
                tenant_id=tenant_id,
            )
            if normalized_declared_value is not None:
                return normalized_declared_value
        return value

    def _normalize_declared_output_value(
        self,
        value: Any,
        *,
        declared_output: DeclaredOutputConfig,
        tenant_id: str | None = None,
    ) -> Any | None:
        if declared_output.type == DeclaredOutputType.FILE and isinstance(value, Mapping):
            return self._file_segment_from_payload(value, tenant_id=tenant_id)
        if (
            declared_output.type == DeclaredOutputType.ARRAY
            and declared_output.array_item is not None
            and declared_output.array_item.type == DeclaredOutputType.FILE
            and isinstance(value, list)
            and all(isinstance(item, Mapping) for item in value)
        ):
            return ArrayFileSegment(value=[self._file_from_payload(item, tenant_id=tenant_id) for item in value])
        return None

    def _normalize_legacy_tool_file_value(
        self,
        value: Any,
        *,
        tenant_id: str | None,
    ) -> FileSegment | ArrayFileSegment | None:
        if isinstance(value, Mapping):
            file = self._legacy_tool_file_from_payload(value, tenant_id=tenant_id)
            return FileSegment(value=file) if file is not None else None
        if isinstance(value, list) and value and all(isinstance(item, Mapping) for item in value):
            files = [self._legacy_tool_file_from_payload(item, tenant_id=tenant_id) for item in value]
            if all(file is not None for file in files):
                return ArrayFileSegment(value=[file for file in files if file is not None])
        return None

    def _legacy_tool_file_from_payload(self, value: Mapping[str, Any], *, tenant_id: str | None) -> File | None:
        if self._tool_file_rebacker is None or tenant_id is None or set(value) != {"id"}:
            return None
        tool_file_id = value.get("id")
        if not isinstance(tool_file_id, str) or not tool_file_id:
            return None
        return self._tool_file_rebacker(tenant_id=tenant_id, tool_file_id=tool_file_id)

    def _file_segment_from_payload(self, value: Mapping[str, Any], *, tenant_id: str | None) -> FileSegment:
        return FileSegment(value=self._file_from_payload(value, tenant_id=tenant_id))

    def _file_from_payload(self, value: Mapping[str, Any], *, tenant_id: str | None) -> File:
        transfer_method_raw = value.get("transfer_method")
        if not isinstance(transfer_method_raw, str):
            raise ValueError("file mapping missing transfer_method")
        transfer_method = FileTransferMethod.value_of(transfer_method_raw)

        expected_keys = (
            {"transfer_method", "url"}
            if transfer_method == FileTransferMethod.REMOTE_URL
            else {
                "transfer_method",
                "reference",
            }
        )
        if set(value) != expected_keys:
            raise ValueError(f"{transfer_method.value} file mapping must contain exactly {sorted(expected_keys)}")

        remote_url = self._string_value(value.get("url"))
        reference = self._string_value(value.get("reference"))

        if transfer_method == FileTransferMethod.REMOTE_URL:
            if remote_url is None:
                raise ValueError("remote_url file mapping missing url")
            return File(
                type=FileType.CUSTOM,
                transfer_method=transfer_method,
                remote_url=remote_url,
                reference=None,
                filename=None,
                extension=None,
                mime_type=None,
                size=-1,
            )
        elif reference is None:
            raise ValueError(f"{transfer_method.value} file mapping missing reference")
        elif not is_canonical_file_reference(reference):
            raise ValueError(f"{transfer_method.value} file mapping has invalid canonical reference")
        if tenant_id is None:
            raise ValueError("tenant_id is required to reconstruct persisted file mappings")

        return self._restore_file_from_canonical_mapping(
            mapping=value,
            tenant_id=tenant_id,
        )

    @staticmethod
    def _restore_file_from_canonical_mapping(*, mapping: Mapping[str, Any], tenant_id: str) -> File:
        return build_from_mapping(
            mapping=mapping,
            tenant_id=tenant_id,
            access_controller=DatabaseFileAccessController(),
        )

    @staticmethod
    def _string_value(value: Any) -> str | None:
        return value if isinstance(value, str) and value else None

    @staticmethod
    def _usage_from_metadata(metadata: Mapping[str, Any]) -> LLMUsage | None:
        agent_backend = metadata.get("agent_backend")
        if not isinstance(agent_backend, Mapping):
            return None
        usage = agent_backend.get("usage")
        if not isinstance(usage, Mapping):
            return None
        try:
            return LLMUsage.from_metadata(usage)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def build_node_execution_metadata(
        *,
        metadata: dict[str, Any],
        agent_log: Sequence[AgentLogEvent] = (),
    ) -> dict[str, Any]:
        """Shape one node execution's ``execution_metadata`` payload.

        ``metadata`` carries the Agent backend run statistics (``agent_backend``,
        ``attempt``, ``terminal_event_type``, …). They are flattened to the top
        level so ``agent_log`` keeps the array contract the legacy Agent node and
        the workflow tracing page already agree on.
        """
        return {
            **metadata,
            WorkflowNodeExecutionMetadataKey.AGENT_LOG: list(agent_log),
        }

    @staticmethod
    def _build_node_metadata(
        *,
        metadata: dict[str, Any],
        usage: LLMUsage | None,
        agent_log: Sequence[AgentLogEvent] = (),
    ) -> dict[WorkflowNodeExecutionMetadataKey, Any]:
        node_metadata: dict[WorkflowNodeExecutionMetadataKey, Any] = WorkflowAgentOutputAdapter.build_node_execution_metadata(
            metadata=metadata,
            agent_log=agent_log,
        )
        if usage is not None:
            node_metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] = usage.total_tokens
            node_metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] = usage.total_price
            node_metadata[WorkflowNodeExecutionMetadataKey.CURRENCY] = usage.currency
        return node_metadata

    @staticmethod
    def _with_terminal_metadata(
        metadata: dict[str, Any],
        event: AgentBackendInternalEvent,
        terminal_status: str,
    ) -> dict[str, Any]:
        updated = dict(metadata)
        agent_backend = dict(updated.get("agent_backend") or {})
        agent_backend.update(
            {
                "run_id": event.run_id,
                "terminal_event_id": event.source_event_id,
                "status": terminal_status,
            }
        )
        session_snapshot = None
        if isinstance(
            event,
            AgentBackendRunSucceededInternalEvent
            | AgentBackendRunFailedInternalEvent
            | AgentBackendRunCancelledInternalEvent,
        ):
            session_snapshot = event.session_snapshot
            if event.usage is not None:
                agent_backend["usage"] = dict(event.usage)
        if session_snapshot is not None:
            agent_backend["session_snapshot"] = {
                "layer_count": len(session_snapshot.layers),
            }
        updated["agent_backend"] = agent_backend
        updated["terminal_event_type"] = AgentBackendInternalEventType(event.type).value
        return updated


def _agent_log_text(value: object) -> str | None:
    """Return trimmed text, capped by the platform's workflow variable limit."""
    if not isinstance(value, str) or not value:
        return None
    limit = dify_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH
    if len(value) <= limit:
        return value
    return value[:limit] + "\n…[truncated]"


def _agent_log_json(value: object) -> str | None:
    """Return a valid JSON string, or ``None`` when the payload is unusable."""
    if value is None:
        return None
    if isinstance(value, str):
        # Streamed argument deltas arrive as raw fragments; keep the text only
        # when it already parses so callers never see a broken JSON string.
        try:
            json.loads(value)
        except (TypeError, ValueError):
            return None
        return _agent_log_text(value)
    try:
        return _agent_log_text(json.dumps(value, ensure_ascii=False))
    except (TypeError, ValueError):
        return None


class WorkflowAgentProcessProjection:
    """Project Agent backend stream events into workflow ``AgentLogEvent`` entries.

    Entries accumulate in memory while the Agent streams and are materialised as a
    flat list once the run reaches a terminal state. The shape is the legacy Agent
    node's ``AgentLogEvent`` contract, so the workflow tracing page and the Agent
    log drawer consume the same persisted data.

    Entry size is bounded by the platform's workflow variable truncation budget,
    and the oldest entries are evicted first because the tail of an Agent run is
    the part worth reading.
    """

    _THINKING_LABEL = "Thinking"
    _MESSAGE_LABEL = "Message"
    _TRUNCATION_NOTICE = "Agent process truncated"
    _TOOL_CALL_KINDS = frozenset({"function_tool_call", "output_tool_call"})
    _TOOL_RESULT_KINDS = frozenset({"function_tool_result", "output_tool_result"})
    _TOOL_PART_KINDS = frozenset({"tool-call", "builtin-tool-call"})
    _TOOL_RETURN_PART_KINDS = frozenset({"tool-return", "builtin-tool-return"})

    def __init__(self, *, node_id: str, node_execution_id: str) -> None:
        self._node_id = node_id
        self._node_execution_id = node_execution_id
        self._entries: list[AgentLogEvent] = []
        self._next_position = 1
        self._thinking_entry: AgentLogEvent | None = None
        self._message_entry: AgentLogEvent | None = None
        self._tool_entries: dict[str, AgentLogEvent] = {}
        self._bytes_used = 0

    def observe(self, event: AgentBackendStreamInternalEvent) -> None:
        """Map one Agent backend stream event onto the entry list (idempotent)."""
        data = event.data
        if not isinstance(data, Mapping):
            return
        # The adapter carries the kind on the event itself; `data` holds only the
        # payload (index, part, delta), so reading it from the payload matches nothing.
        event_kind = event.event_kind or data.get("event_kind")
        if event_kind == "part_delta":
            self._observe_part_delta(data)
        elif event_kind == "part_start":
            self._observe_part(data)
        elif event_kind in self._TOOL_CALL_KINDS:
            self._open_tool(_event_index(data), _tool_part(data))
        elif event_kind in self._TOOL_RESULT_KINDS:
            self._close_segments()
            part = _tool_part(data)
            entry = self._tool_entry_for(_event_index(data), part)
            if entry is None:
                entry = self._emit(label=part.get("tool_name") or "", data={})
            entry.data["observation"] = _agent_log_json(part.get("content"))
            self._refresh_byte_count()

    def observe_agent_message_delta(self, delta: str) -> None:
        """Record model text streamed as deltas beside the raw pydantic-ai events."""
        if not delta:
            return
        if self._message_entry is None:
            self._message_entry = self._emit(label=self._MESSAGE_LABEL, data={})
        self._append_text(self._message_entry, "answer", delta)

    def entries(self) -> list[AgentLogEvent]:
        """Close open segments and return the size-guarded entry list."""
        self._close_segments()
        self._guard_budget()
        return list(self._entries)

    def _observe_part_delta(self, data: Mapping[str, Any]) -> None:
        delta = data.get("delta")
        if not isinstance(delta, Mapping):
            return
        index = _event_index(data)
        delta_index = _event_index(delta)
        if delta_index >= 0:
            index = delta_index
        delta_kind = delta.get("part_delta_kind")
        if delta_kind == "thinking":
            chunk = delta.get("content_delta")
            if isinstance(chunk, str) and chunk:
                self._append_thinking(index, chunk)
        elif delta_kind == "tool_call":
            self._append_tool_input(index, delta)

    def _observe_part(self, data: Mapping[str, Any]) -> None:
        part = _tool_part(data)
        index = _event_index(data)
        part_kind = part.get("part_kind")
        if part_kind == "thinking":
            content = part.get("content")
            if isinstance(content, str) and content:
                self._append_thinking(index, content)
        elif part_kind in self._TOOL_PART_KINDS:
            self._open_tool(index, part)
        elif part_kind in self._TOOL_RETURN_PART_KINDS:
            self._close_segments()
            entry = self._tool_entry_for(index, part)
            if entry is None:
                entry = self._emit(label=part.get("tool_name") or "", data={})
            entry.data["observation"] = _agent_log_json(part.get("content"))
            self._refresh_byte_count()

    def _append_thinking(self, index: int, content_delta: str) -> None:
        if self._thinking_entry is None:
            self._message_entry = None
            self._thinking_entry = self._emit(label=self._THINKING_LABEL, data={})
        self._append_text(self._thinking_entry, "thought", content_delta)

    def _append_tool_input(self, index: int, delta: Mapping[str, Any]) -> None:
        """Buffer streamed argument fragments; see :meth:`_open_tool` for the merge."""
        entry = self._tool_entry_for(index, delta)
        if entry is None:
            return
        fragment = delta.get("args_delta")
        if not isinstance(fragment, str) or not fragment:
            return
        self._append_text(entry, "tool_input_delta", fragment)
        # The authoritative payload arrives with the part event; until then the
        # concatenated fragments are not guaranteed to be valid JSON.
        entry.data["tool_input"] = None

    def _open_tool(self, index: int, part: Mapping[str, Any]) -> None:
        self._close_segments()
        entry = self._tool_entry_for(index, part)
        if entry is None:
            return
        tool_name = part.get("tool_name")
        if isinstance(tool_name, str) and tool_name:
            entry.label = tool_name
        # A part event carries the authoritative argument payload, so it replaces any
        # fragment accumulated from streamed deltas.
        serialized = _agent_log_json(part.get("args"))
        if serialized is not None or not entry.data.get("tool_input_delta"):
            entry.data["tool_input"] = serialized
        self._refresh_byte_count()

    def _tool_entry_for(self, index: int, part: Mapping[str, Any]) -> AgentLogEvent | None:
        tool_call_id = part.get("tool_call_id")
        key = tool_call_id if isinstance(tool_call_id, str) and tool_call_id else f"index:{index}"
        entry = self._tool_entries.get(key)
        if entry is None:
            entry = self._emit(label=part.get("tool_name") or "", data={})
            self._tool_entries[key] = entry
        return entry

    def _close_segments(self) -> None:
        self._thinking_entry = None
        self._message_entry = None

    def _emit(self, *, label: str, data: Mapping[str, Any]) -> AgentLogEvent:
        entry = AgentLogEvent(
            message_id=f"{self._node_execution_id}-{self._next_position}",
            label=str(label or ""),
            node_execution_id=self._node_execution_id,
            parent_id=None,
            error=None,
            status="succeeded",
            data=dict(data),
            metadata={},
            node_id=self._node_id,
        )
        self._next_position += 1
        self._entries.append(entry)
        self._bytes_used += self._entry_bytes(entry)
        return entry

    def _append_text(self, entry: AgentLogEvent, key: str, delta: str) -> None:
        merged = f"{entry.data.get(key) or ''}{delta}"
        capped = _agent_log_text(merged)
        if capped is not merged:
            self._bytes_used -= self._text_bytes(entry.data.get(key))
            self._bytes_used += self._text_bytes(capped)
        entry.data[key] = capped

    def _guard_budget(self) -> None:
        """Evict oldest entries first, then reserve one notice entry."""
        budget = dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE
        notice = None
        while self._entries and self._bytes_used > budget:
            if len(self._entries) == 1:
                # A single unruly entry would still overflow the budget once kept
                # beside the notice, so drop it and announce the truncation.
                self._entries.pop()
                notice = self._notice_entry()
                break
            self._entries.pop(0)
            self._bytes_used = sum(self._entry_bytes(entry) for entry in self._entries)
        if notice is not None:
            self._entries.insert(0, notice)
            self._bytes_used = sum(self._entry_bytes(entry) for entry in self._entries)

    def _notice_entry(self) -> AgentLogEvent:
        return AgentLogEvent(
            message_id=f"{self._node_execution_id}-0",
            label=self._TRUNCATION_NOTICE,
            node_execution_id=self._node_execution_id,
            parent_id=None,
            error=None,
            status="succeeded",
            data={"truncated": True},
            metadata={},
            node_id=self._node_id,
        )

    def _refresh_byte_count(self) -> None:
        self._bytes_used = sum(self._entry_bytes(entry) for entry in self._entries)

    def _entry_bytes(self, entry: AgentLogEvent) -> int:
        return len(json.dumps(entry.data, ensure_ascii=False)) + self._text_bytes(entry.label)

    @staticmethod
    def _text_bytes(value: object) -> int:
        return len(value) if isinstance(value, str) else 0


def _event_index(data: Mapping[str, Any]) -> int:
    index = data.get("index")
    return index if isinstance(index, int) else -1


def _tool_part(data: Mapping[str, Any]) -> Mapping[str, Any]:
    for key in ("part", "result"):
        candidate = data.get(key)
        if isinstance(candidate, Mapping):
            return candidate
    return {}
