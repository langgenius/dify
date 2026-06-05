from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from clients.agent_backend import (
    AgentBackendInternalEvent,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunPausedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
)
from core.app.file_access import DatabaseFileAccessController
from factories.file_factory.builders import build_from_mapping
from core.workflow.file_reference import is_canonical_file_reference
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from graphon.variables.segments import ArrayFileSegment, FileSegment
from models.agent_config_entities import DeclaredOutputConfig, DeclaredOutputType


class WorkflowAgentOutputAdapter:
    """Convert terminal Agent backend events into workflow node run results.

    ``DifyAgentNode`` relies on this after the earlier per-output type-check pass:
    once the backend payload has been validated against declared ``FILE`` or
    ``ARRAY[FILE]`` outputs, this adapter can safely convert canonical file
    mappings into ``FileSegment`` values without reintroducing false positives
    for normal object outputs.
    """

    def build_success_result(
        self,
        *,
        event: AgentBackendRunSucceededInternalEvent,
        inputs: dict[str, Any],
        process_data: dict[str, Any],
        metadata: dict[str, Any],
        declared_outputs: Sequence[DeclaredOutputConfig] | None = None,
    ) -> NodeRunResult:
        """Build the successful node result from one backend terminal event.

        ``declared_outputs`` is optional for generic normalization, but callers
        should pass it from the earlier type-checking stage so canonical file
        mappings are normalized on the correct declared fields only.

        Canonical persisted-file mappings (``local_file`` / ``tool_file`` /
        ``datasource_file``) also require ``metadata["tenant_id"]`` so the
        adapter can hydrate filename / extension / mime metadata through the
        server-side file factory before producing ``FileSegment`` values.
        """
        metadata = self._with_terminal_metadata(metadata, event, "succeeded")
        usage = self._usage_from_metadata(metadata)
        tenant_id = metadata.get("tenant_id") if isinstance(metadata.get("tenant_id"), str) else None
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=inputs,
            process_data=process_data,
            outputs=self._normalize_outputs(event.output, declared_outputs=declared_outputs, tenant_id=tenant_id),
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
    def _normalize_outputs(
        cls,
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
                key: cls._normalize_output_value(
                    value,
                    declared_output=declared_outputs_by_name.get(key),
                    tenant_id=tenant_id,
                )
                for key, value in output.items()
            }
        if isinstance(output, str):
            return {"text": output}
        return {"result": output}

    @classmethod
    def _normalize_output_value(
        cls,
        value: Any,
        *,
        declared_output: DeclaredOutputConfig | None = None,
        tenant_id: str | None = None,
    ) -> Any:
        if isinstance(value, File | FileSegment | ArrayFileSegment):
            return value
        if declared_output is not None:
            normalized_declared_value = cls._normalize_declared_output_value(
                value,
                declared_output=declared_output,
                tenant_id=tenant_id,
            )
            if normalized_declared_value is not None:
                return normalized_declared_value
        return value

    @classmethod
    def _normalize_declared_output_value(
        cls,
        value: Any,
        *,
        declared_output: DeclaredOutputConfig,
        tenant_id: str | None = None,
    ) -> Any | None:
        if declared_output.type == DeclaredOutputType.FILE and isinstance(value, Mapping):
            return cls._file_segment_from_payload(value, tenant_id=tenant_id)
        if (
            declared_output.type == DeclaredOutputType.ARRAY
            and declared_output.array_item is not None
            and declared_output.array_item.type == DeclaredOutputType.FILE
            and isinstance(value, list)
            and all(isinstance(item, Mapping) for item in value)
        ):
            return ArrayFileSegment(value=[cls._file_from_payload(item, tenant_id=tenant_id) for item in value])
        return None

    @classmethod
    def _file_segment_from_payload(cls, value: Mapping[str, Any], *, tenant_id: str | None) -> FileSegment:
        return FileSegment(value=cls._file_from_payload(value, tenant_id=tenant_id))

    @classmethod
    def _file_from_payload(cls, value: Mapping[str, Any], *, tenant_id: str | None) -> File:
        transfer_method_raw = value.get("transfer_method")
        if not isinstance(transfer_method_raw, str):
            raise ValueError("file mapping missing transfer_method")
        transfer_method = FileTransferMethod.value_of(transfer_method_raw)

        expected_keys = {"transfer_method", "url"} if transfer_method == FileTransferMethod.REMOTE_URL else {
            "transfer_method",
            "reference",
        }
        if set(value) != expected_keys:
            raise ValueError(f"{transfer_method.value} file mapping must contain exactly {sorted(expected_keys)}")

        remote_url = cls._string_value(value.get("url"))
        reference = cls._string_value(value.get("reference"))

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

        return cls._restore_file_from_canonical_mapping(
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
