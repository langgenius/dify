from __future__ import annotations

from collections.abc import Mapping
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

    def build_success_result(
        self,
        *,
        event: AgentBackendRunSucceededInternalEvent,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
    ) -> NodeRunResult:
        metadata = self._with_terminal_metadata(metadata, event, "succeeded")
        usage = self._usage_from_metadata(metadata)
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs=self._normalize_outputs(event.output),
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

    @classmethod
    def _normalize_outputs(cls, output: Any) -> dict[str, Any]:
        if isinstance(output, dict):
            if cls._is_file_payload(output):
                return {"file": cls._file_segment_from_payload(output)}
            return {key: cls._normalize_output_value(value) for key, value in output.items()}
        if isinstance(output, str):
            return {"text": output}
        return {"result": output}

    @classmethod
    def _normalize_output_value(cls, value: Any) -> Any:
        if isinstance(value, File | FileSegment | ArrayFileSegment):
            return value
        if isinstance(value, Mapping):
            if cls._is_file_payload(value):
                return cls._file_segment_from_payload(value)
            return {key: cls._normalize_output_value(item) for key, item in value.items()}
        if isinstance(value, list):
            if value and all(isinstance(item, Mapping) and cls._is_file_payload(item) for item in value):
                return ArrayFileSegment(value=[cls._file_from_payload(item) for item in value])
            return [cls._normalize_output_value(item) for item in value]
        return value

    @staticmethod
    def _is_file_payload(value: Mapping[str, Any]) -> bool:
        return any(value.get(key) for key in ("file_id", "upload_file_id", "tool_file_id", "url", "remote_url")) and (
            "filename" in value or "mime_type" in value or "url" in value or "remote_url" in value
        )

    @classmethod
    def _file_segment_from_payload(cls, value: Mapping[str, Any]) -> FileSegment:
        return FileSegment(value=cls._file_from_payload(value))

    @classmethod
    def _file_from_payload(cls, value: Mapping[str, Any]) -> File:
        remote_url = cls._string_value(value.get("remote_url") or value.get("url"))
        upload_file_id = cls._string_value(value.get("upload_file_id") or value.get("file_id"))
        tool_file_id = cls._string_value(value.get("tool_file_id"))
        filename = cls._string_value(value.get("filename") or value.get("name"))
        mime_type = cls._string_value(value.get("mime_type") or value.get("mimetype"))
        extension = cls._extension_from_payload(value, filename)
        file_type = cls._file_type_from_payload(value, mime_type)
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
