from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from clients.agent_backend import (
    AgentBackendInternalEvent,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunPausedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
)
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from graphon.variables.segments import ArrayFileSegment, FileSegment


class WorkflowAgentOutputAdapter:
    """Convert terminal Agent backend events into workflow node run results."""

    def __init__(self, *, tool_file_rebacker: Callable[..., File | None] | None = None) -> None:
        # Agent Files §4.6: resolve a bare ToolFile id into a graphon File whose
        # metadata comes from the ToolFile row (not the untrusted sandbox payload).
        # Injected so unit tests can stub it without DB access; None keeps the
        # legacy payload-only behaviour for non-file or rich-payload outputs.
        self._tool_file_rebacker = tool_file_rebacker

    def build_success_result(
        self,
        *,
        event: AgentBackendRunSucceededInternalEvent,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
        tenant_id: str | None = None,
    ) -> NodeRunResult:
        metadata = self._with_terminal_metadata(metadata, event, "succeeded")
        usage = self._usage_from_metadata(metadata)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs=self._normalize_outputs(event.output, tenant_id=tenant_id),
            metadata=self._build_node_metadata(metadata=metadata, usage=usage),
            llm_usage=usage or LLMUsage.empty_usage(),
        )

    def build_failure_result(
        self,
        *,
        event: (
            AgentBackendRunFailedInternalEvent
            | AgentBackendRunCancelledInternalEvent
            | AgentBackendRunPausedInternalEvent
        ),
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
    ) -> NodeRunResult:
        status = WorkflowNodeExecutionStatus.FAILED
        error = "Agent backend run failed."
        error_type = "agent_backend_run_failed"
        terminal_status = "failed"

        match event:
            case AgentBackendRunFailedInternalEvent():
                error = event.error
                error_type = event.reason or "agent_backend_run_failed"
                terminal_status = "failed"
            case AgentBackendRunCancelledInternalEvent():
                error = event.message or "Agent backend run was cancelled."
                error_type = "agent_backend_run_cancelled"
                terminal_status = "cancelled"
            case AgentBackendRunPausedInternalEvent():
                error = event.message or "Agent backend run paused, but workflow Agent Node pause is not supported yet."
                error_type = "agent_backend_paused_unsupported"
                terminal_status = "paused"

        metadata = self._with_terminal_metadata(metadata, event, terminal_status)
        usage = self._usage_from_metadata(metadata)
        return NodeRunResult(
            status=status,
            inputs=inputs,
            process_data=process_data,
            metadata=self._build_node_metadata(metadata=metadata, usage=usage),
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
    ) -> NodeRunResult:
        usage = self._usage_from_metadata(metadata)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.FAILED,
            inputs=inputs,
            process_data=process_data,
            metadata=self._build_node_metadata(metadata=metadata, usage=usage),
            llm_usage=usage or LLMUsage.empty_usage(),
            error="Agent backend stream ended before a terminal event.",
            error_type="agent_backend_stream_error",
        )

    def _normalize_outputs(self, output: Any, *, tenant_id: str | None) -> dict[str, Any]:
        if isinstance(output, dict):
            if self._is_file_payload(output):
                file = self._file_from_payload(output, tenant_id=tenant_id)
                if file is not None:
                    return {"file": FileSegment(value=file)}
            return {key: self._normalize_output_value(value, tenant_id=tenant_id) for key, value in output.items()}
        if isinstance(output, str):
            return {"text": output}
        return {"result": output}

    def _normalize_output_value(self, value: Any, *, tenant_id: str | None) -> Any:
        if isinstance(value, File | FileSegment | ArrayFileSegment):
            return value
        if isinstance(value, Mapping):
            if self._is_file_payload(value):
                file = self._file_from_payload(value, tenant_id=tenant_id)
                if file is not None:
                    return FileSegment(value=file)
                # A bare ref that did not resolve to a tenant file: treat as a plain object.
            return {key: self._normalize_output_value(item, tenant_id=tenant_id) for key, item in value.items()}
        if isinstance(value, list):
            if value and all(isinstance(item, Mapping) and self._is_file_payload(item) for item in value):
                files = [self._file_from_payload(item, tenant_id=tenant_id) for item in value]
                if all(file is not None for file in files):
                    return ArrayFileSegment(value=[file for file in files if file is not None])
            return [self._normalize_output_value(item, tenant_id=tenant_id) for item in value]
        return value

    # Keys a file-output ref may legitimately carry. A dict is treated as a file
    # ref only if it has an id/url AND every key is one of these — so a bare
    # ``{"id": "..."}`` (Agent Files §4.6 canonical) is recognized while ordinary
    # business objects that merely contain an ``id`` field are not.
    _FILE_FIELD_KEYS: frozenset[str] = frozenset(
        {
            "id",
            "file_id",
            "upload_file_id",
            "tool_file_id",
            "url",
            "remote_url",
            "filename",
            "name",
            "mime_type",
            "mimetype",
            "extension",
            "size",
            "type",
            "file_type",
        }
    )

    @classmethod
    def _is_file_payload(cls, value: Mapping[str, Any]) -> bool:
        has_ref = any(
            isinstance(value.get(key), str) and value.get(key)
            for key in ("id", "file_id", "upload_file_id", "tool_file_id", "url", "remote_url")
        )
        return has_ref and all(key in cls._FILE_FIELD_KEYS for key in value)

    @staticmethod
    def _is_rich_payload(value: Mapping[str, Any]) -> bool:
        """The payload carries its own metadata, so it can build a File without DB reback."""
        return any(value.get(key) for key in ("filename", "name", "mime_type", "mimetype", "url", "remote_url"))

    def _file_from_payload(self, value: Mapping[str, Any], *, tenant_id: str | None) -> File | None:
        # Canonical Agent output file is a ToolFile referenced by ``id`` (or the
        # ``tool_file_id`` alias). Reback its metadata authoritatively from the
        # ToolFile row instead of trusting the sandbox payload.
        tool_file_id = self._string_value(value.get("tool_file_id") or value.get("id"))
        remote_url = self._string_value(value.get("remote_url") or value.get("url"))
        upload_file_id = self._string_value(value.get("upload_file_id") or value.get("file_id"))

        if tool_file_id and self._tool_file_rebacker is not None and tenant_id:
            rebacked = self._tool_file_rebacker(tenant_id=tenant_id, tool_file_id=tool_file_id)
            if rebacked is not None:
                return rebacked

        # No authoritative reback: only build a File from the payload when it
        # actually carries file metadata; a bare unresolved id is not a file.
        if not self._is_rich_payload(value):
            return None

        filename = self._string_value(value.get("filename") or value.get("name"))
        mime_type = self._string_value(value.get("mime_type") or value.get("mimetype"))
        extension = self._extension_from_payload(value, filename)
        file_type = self._file_type_from_payload(value, mime_type)
        size = value.get("size")
        if not isinstance(size, int):
            size = -1

        if tool_file_id:
            transfer_method = FileTransferMethod.TOOL_FILE
            related_id = tool_file_id
        elif remote_url:
            transfer_method = FileTransferMethod.REMOTE_URL
            related_id = None
        else:
            transfer_method = FileTransferMethod.LOCAL_FILE
            related_id = upload_file_id

        return File(
            type=file_type,
            transfer_method=transfer_method,
            remote_url=remote_url if transfer_method == FileTransferMethod.REMOTE_URL else None,
            related_id=related_id,
            filename=filename,
            extension=extension,
            mime_type=mime_type,
            size=size,
        )

    @staticmethod
    def _string_value(value: Any) -> str | None:
        return value if isinstance(value, str) and value else None

    @classmethod
    def _extension_from_payload(cls, value: Mapping[str, Any], filename: str | None) -> str | None:
        extension = cls._string_value(value.get("extension"))
        if extension:
            return extension if extension.startswith(".") else f".{extension}"
        if filename and "." in filename:
            return f".{filename.rsplit('.', 1)[1]}"
        return None

    @staticmethod
    def _file_type_from_payload(value: Mapping[str, Any], mime_type: str | None) -> FileType:
        explicit_type = value.get("type") or value.get("file_type")
        if isinstance(explicit_type, str):
            try:
                return FileType(explicit_type)
            except ValueError:
                pass
        if mime_type:
            if mime_type.startswith("image/"):
                return FileType.IMAGE
            if mime_type.startswith("audio/"):
                return FileType.AUDIO
            if mime_type.startswith("video/"):
                return FileType.VIDEO
            return FileType.DOCUMENT
        return FileType.CUSTOM

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
    def _build_node_metadata(
        *,
        metadata: dict[str, Any],
        usage: LLMUsage | None,
    ) -> dict[WorkflowNodeExecutionMetadataKey, Any]:
        node_metadata: dict[WorkflowNodeExecutionMetadataKey, Any] = {
            WorkflowNodeExecutionMetadataKey.AGENT_LOG: metadata,
        }
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
        if isinstance(event, AgentBackendRunSucceededInternalEvent | AgentBackendRunPausedInternalEvent):
            session_snapshot = event.session_snapshot
        if session_snapshot is not None:
            agent_backend["session_snapshot"] = {
                "layer_count": len(session_snapshot.layers),
            }
        updated["agent_backend"] = agent_backend
        updated["terminal_event_type"] = AgentBackendInternalEventType(event.type).value
        return updated
