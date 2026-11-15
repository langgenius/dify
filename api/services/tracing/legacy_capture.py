"""Admit legacy queued terminal records to the current managed-trace owner.

This compatibility adapter only receives a formally delivered old task. It does
not discover, scan or replay stored payloads. Current records are reconstructed
through the same tenant/App-scoped source used by the SDK pipeline; an uncertain
owner never grants permission to fall back to another provider send.
"""

from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any, Protocol

from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent, WorkflowRunCompleted
from pydantic import ValidationError

from machinery.legacy_tracing import LegacyTraceOwnershipUnavailableError
from services.tracing import records as trace_records
from services.tracing.delivery import EnterpriseTraceSink, TraceCollector, TraceRecordSource
from services.tracing.errors import (
    SourceNotFoundError,
    SourceNotReadyError,
    TraceCollectionError,
    TraceCollectorUnavailableError,
    TracingStoreUnavailableError,
)
from services.tracing.records import BaseTraceInfo

_AUXILIARY_RECORD_TYPES: dict[str, type[BaseTraceInfo]] = {
    "ModerationTraceInfo": trace_records.ModerationTraceInfo,
    "SuggestedQuestionTraceInfo": trace_records.SuggestedQuestionTraceInfo,
    "DatasetRetrievalTraceInfo": trace_records.DatasetRetrievalTraceInfo,
    "ToolTraceInfo": trace_records.ToolTraceInfo,
    "GenerateNameTraceInfo": trace_records.GenerateNameTraceInfo,
    "PromptGenerationTraceInfo": trace_records.PromptGenerationTraceInfo,
    "WorkflowNodeTraceInfo": trace_records.WorkflowNodeTraceInfo,
    "DraftNodeExecutionTrace": trace_records.DraftNodeExecutionTrace,
}


class LegacyTraceOwnerQuery(Protocol):
    def legacy_app_tenant(self, app_id: str) -> str | None:
        """Resolve the trusted queued App reference in one short read transaction.

        No payload content or destination is read. A missing App returns None;
        unavailable persistence raises the tracing slice's store error.
        """
        ...


class LegacyTraceCaptureService:
    def __init__(
        self,
        *,
        owners: LegacyTraceOwnerQuery,
        records: TraceRecordSource,
        enterprise_records: TraceRecordSource,
        enterprise_sink: EnterpriseTraceSink,
        collector: TraceCollector,
        now: Callable[[], datetime],
    ) -> None:
        self._owners, self._records, self._collector, self._now = owners, records, collector, now
        self._enterprise_records = enterprise_records
        self._enterprise_sink = enterprise_sink

    def capture(self, *, app_id: str, event_id: str, trace_info_type: str | None, info: Mapping[str, Any]) -> bool:
        """Only explicit False permits legacy export; unknown ownership raises."""
        tenant_id, current = self._prepare(
            app_id=app_id, event_id=event_id, trace_info_type=trace_info_type, info=info, records=self._records
        )
        try:
            captured = self._collector.capture_terminal(tenant_id=tenant_id, info=current)
        except (TraceCollectionError, TraceCollectorUnavailableError, TracingStoreUnavailableError) as error:
            raise LegacyTraceOwnershipUnavailableError("Legacy collector ownership is unavailable") from error
        if not isinstance(captured, bool):
            raise LegacyTraceOwnershipUnavailableError("Legacy trace ownership result is unknown")
        return captured

    def enterprise_record(
        self, *, app_id: str, event_id: str, trace_info_type: str | None, info: Mapping[str, Any]
    ) -> BaseTraceInfo:
        """Reconstruct a real current record through the EE-details source owner."""
        _, current = self._prepare(
            app_id=app_id,
            event_id=event_id,
            trace_info_type=trace_info_type,
            info=info,
            records=self._enterprise_records,
        )
        return current

    def emit_enterprise(
        self, *, app_id: str, event_id: str, trace_info_type: str | None, info: Mapping[str, Any]
    ) -> None:
        """Keep current record validation and concrete EE delivery in this owner.

        Source uncertainty cannot authorize a fallback send. Sink exceptions
        remain separate so the queued consumer never marks an unconfirmed EE
        export as dispatched.
        """
        try:
            current = self.enterprise_record(
                app_id=app_id, event_id=event_id, trace_info_type=trace_info_type, info=info
            )
        except Exception as error:
            raise LegacyTraceOwnershipUnavailableError("Legacy enterprise trace source is unavailable") from error
        if not isinstance(current, BaseTraceInfo):
            raise LegacyTraceOwnershipUnavailableError("Legacy enterprise trace record is invalid")
        self._enterprise_sink(current)

    def _prepare(
        self,
        *,
        app_id: str,
        event_id: str,
        trace_info_type: str | None,
        info: Mapping[str, Any],
        records: TraceRecordSource,
    ) -> tuple[str, BaseTraceInfo]:
        """Validate the queued owner and ask the current collector about its source.

        True means the managed collector owns the terminal record. False alone
        authorizes the old task to continue its original Native export path.
        Validation/source/store uncertainty raises, never returns False.
        """
        try:
            tenant_id = self._owners.legacy_app_tenant(app_id)
            if tenant_id is None:
                raise LegacyTraceOwnershipUnavailableError("Legacy trace App owner is unavailable")
            owner_app_id = None if app_id.startswith("tenant-") else app_id
            metadata = info.get("metadata", {})
            if not isinstance(metadata, Mapping):
                raise LegacyTraceOwnershipUnavailableError("Legacy trace metadata is invalid")
            if info.get("tenant_id", tenant_id) != tenant_id or metadata.get("tenant_id", tenant_id) != tenant_id:
                raise LegacyTraceOwnershipUnavailableError("Legacy trace tenant does not match its App")
            if metadata.get("app_id", owner_app_id) != owner_app_id:
                raise LegacyTraceOwnershipUnavailableError("Legacy trace App does not match its queued owner")
            correlation = TraceCorrelation.model_validate(
                {
                    "external_trace_id": info.get("trace_id"),
                    "session_id": metadata.get("trace_session_id"),
                    "parent_workflow_run_id": None,
                    "parent_node_execution_id": None,
                }
            )
            message_data = info.get("message_data")
            if message_data is not None and not isinstance(message_data, Mapping):
                raise LegacyTraceOwnershipUnavailableError("Legacy message facts are invalid")
            message_id = info.get("message_id") or (message_data.get("id") if message_data else None)
            if message_data and message_data.get("app_id", owner_app_id) != owner_app_id:
                raise LegacyTraceOwnershipUnavailableError("Legacy message belongs to another App")
            if trace_info_type == "WorkflowTraceInfo":
                payload = WorkflowRunCompleted.model_validate(
                    {
                        "workflow_run_id": info.get("workflow_run_id"),
                        "conversation_id": info.get("conversation_id"),
                        "total_tokens": info.get("total_tokens"),
                    }
                )
            else:
                payload = (
                    MessageCompleted.model_validate(
                        {"message_id": message_id, "conversation_id": info.get("conversation_id")}
                    )
                    if message_id
                    else None
                )
            current = None
            if payload is not None:
                current = records.assemble(
                    TraceEvent(
                        event_id=event_id,
                        tenant_id=tenant_id,
                        app_id=owner_app_id,
                        user_id=None,
                        occurred_at=self._now(),
                        correlation=correlation,
                        payload=payload,
                    )
                )
            if trace_info_type not in {"WorkflowTraceInfo", "MessageTraceInfo"}:
                # Auxiliary records only ask ownership. They must not finish a
                # parent message merely because an auxiliary operation ended.
                model = _AUXILIARY_RECORD_TYPES.get(trace_info_type or "")
                if model is None:
                    raise LegacyTraceOwnershipUnavailableError("Legacy trace type is not supported")
                current = model.model_validate(
                    {
                        **info,
                        "tenant_id": tenant_id,
                        "metadata": {**metadata, "app_id": owner_app_id, "tenant_id": tenant_id},
                        "message_data": current.message_data if current is not None else None,
                    }
                )
            if current is None:
                raise LegacyTraceOwnershipUnavailableError("Legacy terminal source is unavailable")
            marker = metadata.get("message_execution_state")
            if marker is not None:
                if not isinstance(marker, str) or marker not in {"succeeded", "failed", "cancelled"}:
                    raise LegacyTraceOwnershipUnavailableError("Legacy message terminal state is invalid")
                current = current.model_copy(
                    update={"metadata": {**current.metadata, "message_execution_state": marker}}
                )
            return tenant_id, current
        except (
            ValidationError,
            SourceNotFoundError,
            SourceNotReadyError,
            TraceCollectionError,
            TraceCollectorUnavailableError,
            TracingStoreUnavailableError,
        ) as error:
            raise LegacyTraceOwnershipUnavailableError("Legacy trace ownership could not be confirmed") from error
