"""Invocation-owned message spans and explicit submission to the application's queue."""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping, Sequence
from threading import Lock
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from core.ops.trace_data import (
    CompletedTrace,
    ParentSpanReference,
    QueuedTrace,
    TraceProviderSettings,
    TraceSource,
    TraceSpan,
    copy_trace_fields,
    copy_trace_value,
    make_span_id,
    make_trace_id,
)

if TYPE_CHECKING:
    from core.ops.trace_queue import TraceQueue


class MessageTraceRecorder:
    def __init__(
        self,
        source: TraceSource,
        trace_queue: TraceQueue,
        provider_settings: Sequence[TraceProviderSettings],
        *,
        load_message_fields: Callable[[str], Mapping[str, Any]] | None = None,
        record_message_result: Callable[[MessageTraceRecorder, Mapping[str, Any]], None] | None = None,
        load_provider_settings: Callable[[str, str], tuple[TraceProviderSettings, ...]] | None = None,
    ):
        self.source = source
        self.trace_queue = trace_queue
        self.provider_settings = tuple(provider_settings)
        self.load_provider_settings = load_provider_settings
        self._load_message_fields = load_message_fields
        self._record_message_result = record_message_result
        self._lock = Lock()
        self._spans: list[TraceSpan] = []
        self._closed = False
        self._reserved_bytes = 0
        self._omitted_spans = 0
        self._incomplete_reasons: list[str] = []

    @property
    def user_id(self) -> str | None:
        return self.source.actor_id

    def bind_message(
        self,
        message_id: str,
        conversation_id: str,
        *,
        external_trace_id: str | None = None,
        session_id: str | None = None,
    ) -> None:
        with self._lock:
            if self._spans or self._closed:
                return
            self.source = TraceSource.model_validate(
                {
                    **self.source.model_dump(),
                    "operation_id": message_id,
                    "message_id": message_id,
                    "conversation_id": conversation_id,
                    "external_trace_id": external_trace_id,
                    "session_id": session_id,
                }
            )

    def submit_completed_trace(
        self, completed_trace: CompletedTrace, provider_settings: Sequence[TraceProviderSettings] | None = None
    ) -> bool:
        settings = self.provider_settings if provider_settings is None else provider_settings
        submitted = False
        for destination in settings:
            try:
                submitted = (
                    self.trace_queue.submit_trace(QueuedTrace.from_trace(completed_trace, destination)) or submitted
                )
            except Exception:
                logging.getLogger(__name__).warning(
                    "Cannot submit trace tenant_id=%s operation_id=%s",
                    self.source.tenant_id,
                    completed_trace.source.operation_id,
                )
        return submitted

    def create_workflow_trace(
        self,
        *,
        workflow_id: str,
        workflow_version: str,
        workflow_run_id: str,
        inputs: Mapping[str, Any],
        workflow_trace_state: Mapping[str, Any] | None = None,
        resumed_without_state: bool = False,
    ):
        from core.ops.workflow_trace import WorkflowTraceRecorder

        source = TraceSource.model_validate(
            {**self.source.model_dump(), "operation_id": workflow_run_id, "workflow_run_id": workflow_run_id}
        )
        if workflow_trace_state is not None:
            self.provider_settings = tuple(
                TraceProviderSettings.model_validate(settings)
                for settings in workflow_trace_state.get("provider_settings", [])
            )
        return WorkflowTraceRecorder(
            source=source,
            workflow_id=workflow_id,
            workflow_version=workflow_version,
            inputs=inputs,
            submit_completed_trace=self.submit_completed_trace,
            provider_settings=self.provider_settings,
            pause_state=workflow_trace_state,
            resumed_without_state=resumed_without_state,
            load_provider_settings=self.load_provider_settings,
            reserve_recording_bytes=self.trace_queue.reserve_recording_bytes,
            release_recording_bytes=self.trace_queue.release_recording_bytes,
        )

    def record_operation(
        self,
        span_name: str,
        *,
        span_type: str = "operation",
        inputs: object = None,
        outputs: object = None,
        timer: Mapping[str, Any] | None = None,
        error: str | None = None,
        attributes: Mapping[str, Any] | None = None,
        usage: Mapping[str, Any] | None = None,
        message_id: str | None = None,
        independent: bool = False,
    ) -> None:
        try:
            self._record_operation(
                span_name,
                span_type=span_type,
                inputs=inputs,
                outputs=outputs,
                timer=timer,
                error=error,
                attributes=attributes,
                usage=usage,
                message_id=message_id,
                independent=independent,
            )
        except Exception:
            self.mark_incomplete("operation_capture_failed")
            logging.getLogger(__name__).warning(
                "Cannot record operation tenant_id=%s operation_id=%s", self.source.tenant_id, self.source.operation_id
            )

    def _record_operation(
        self,
        span_name: str,
        *,
        span_type: str = "operation",
        inputs: object = None,
        outputs: object = None,
        timer: Mapping[str, Any] | None = None,
        error: str | None = None,
        attributes: Mapping[str, Any] | None = None,
        usage: Mapping[str, Any] | None = None,
        message_id: str | None = None,
        independent: bool = False,
    ) -> None:
        """Record one actual operation without deferring model/ORM reads to a worker."""
        timer = timer or {}
        span = TraceSpan(
            span_id=make_span_id(self.source.tenant_id, self.source.operation_id, str(uuid4())),
            parent_span_id=make_span_id(self.source.tenant_id, self.source.operation_id, "message"),
            span_name=span_name,
            span_type=span_type,
            source_app_id=self.source.app_id,
            source_pipeline_id=self.source.pipeline_id,
            started_at=timer.get("start"),
            ended_at=timer.get("end"),
            inputs=copy_trace_value(inputs),
            outputs=copy_trace_value(outputs),
            status="error" if error else "ok",
            error=error,
            attributes=copy_trace_fields(
                {"operation_type": "tool" if span_type == "tool" else span_name, **(attributes or {})}
            ),
            usage=copy_trace_fields(usage or {}),
        )
        span_bytes = len(span.model_dump_json().encode())
        with self._lock:
            separate = self._closed or independent or not self.source.message_id
            if not separate:
                if (
                    len(self._spans) >= 10000
                    or self._reserved_bytes + span_bytes > 7 * 1024 * 1024
                    or not self.trace_queue.reserve_recording_bytes(self.source.tenant_id, span_bytes)
                ):
                    self._omitted_spans += 1
                    return
                self._reserved_bytes += span_bytes
                self._spans.append(span)
                return
        source = TraceSource.model_validate(
            {
                **self.source.model_dump(),
                "operation_id": str(uuid4()),
                "message_id": message_id or self.source.message_id,
            }
        )
        root = span.model_copy(update={"parent_span_id": None})
        trace = CompletedTrace(
            source=source,
            trace_id=make_trace_id(source.tenant_id, source.operation_id),
            root_span_id=root.span_id,
            spans=(root,),
        )
        for settings in self.provider_settings:
            submitted_trace = trace
            if source.message_id:
                parent_source = TraceSource.model_validate({**source.model_dump(), "operation_id": source.message_id})
                parent_id = make_span_id(source.tenant_id, source.message_id, "message")
                parent_trace = CompletedTrace(
                    source=parent_source,
                    trace_id=make_trace_id(source.tenant_id, source.message_id),
                    root_span_id=parent_id,
                    spans=(TraceSpan(span_id=parent_id, span_name="message"),),
                )
                parent_export = QueuedTrace.from_trace(parent_trace, settings)
                submitted_trace = trace.model_copy(
                    update={"parent": ParentSpanReference(export_id=parent_export.export_id, span_id=parent_id)}
                )
            self.submit_completed_trace(submitted_trace, (settings,))

    def record_saved_message(self, message_id: str) -> None:
        if self._load_message_fields is None:
            return
        try:
            fields = self._load_message_fields(message_id)
            if self._record_message_result is not None:
                self._record_message_result(self, fields)
            else:
                self.finish_message_trace(fields)
        except Exception:
            self.close()
            logging.getLogger(__name__).warning(
                "Cannot record message trace tenant_id=%s message_id=%s", self.source.tenant_id, message_id
            )

    def finish_message_trace(
        self, message_fields: Mapping[str, Any], *, span_name: str = "message", include_llm: bool = False
    ) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            children, self._spans = self._spans, []
            reserved, self._reserved_bytes = self._reserved_bytes, 0
            omitted = self._omitted_spans
            incomplete_reasons = tuple(self._incomplete_reasons)
        try:
            source = TraceSource.model_validate(
                {
                    **self.source.model_dump(),
                    "message_id": message_fields["message_id"],
                    "conversation_id": message_fields["conversation_id"],
                    "workflow_run_id": message_fields.get("workflow_run_id"),
                }
            )
            root_id = make_span_id(source.tenant_id, source.operation_id, "message")
            metadata = message_fields.get("metadata") or {}
            usage = dict(metadata.get("usage") or {})
            usage.update(
                {
                    "prompt_tokens": message_fields.get("prompt_tokens"),
                    "completion_tokens": message_fields.get("completion_tokens"),
                    "total_price": message_fields.get("total_price"),
                    "currency": message_fields.get("currency"),
                }
            )
            usage["total_tokens"] = (message_fields.get("prompt_tokens") or 0) + (
                message_fields.get("completion_tokens") or 0
            )
            root = TraceSpan(
                span_id=root_id,
                span_name=span_name,
                span_type="operation",
                source_app_id=source.app_id,
                inputs=copy_trace_value(message_fields.get("inputs")),
                outputs=copy_trace_value(message_fields.get("outputs")),
                started_at=message_fields.get("started_at"),
                ended_at=message_fields.get("ended_at"),
                status="error" if message_fields.get("error") else "ok",
                error=str(copy_trace_value(message_fields["error"], 8192)) if message_fields.get("error") else None,
                usage=copy_trace_fields(usage),
                attributes=copy_trace_fields(
                    {
                        **metadata,
                        "operation_type": "message",
                        "query": message_fields.get("query"),
                        "gen_ai_server_time_to_first_token": usage.get("time_to_first_token"),
                        "llm_streaming_time_to_generate": usage.get("time_to_generate"),
                        "is_streaming_request": usage.get("time_to_first_token") is not None,
                        "model_provider": message_fields.get("model_provider"),
                        "model_name": message_fields.get("model_name"),
                        "files": message_fields.get("files", []),
                    }
                ),
            )
            spans = [root, *children]
            if include_llm and message_fields.get("model_name"):
                spans.insert(
                    1,
                    root.model_copy(
                        update={
                            "span_id": make_span_id(source.tenant_id, source.operation_id, "llm"),
                            "parent_span_id": root_id,
                            "span_name": str(message_fields["model_name"]),
                            "span_type": "llm",
                            "attributes": {**root.attributes, "operation_type": "llm", "metrics_from_parent": True},
                        }
                    ),
                )
            self.submit_completed_trace(
                CompletedTrace(
                    source=source,
                    trace_id=make_trace_id(source.tenant_id, source.operation_id),
                    root_span_id=root_id,
                    spans=tuple(spans),
                    complete=not (omitted or incomplete_reasons),
                    truncation={"omitted_spans": omitted, "reasons": list(incomplete_reasons)}
                    if omitted or incomplete_reasons
                    else {},
                )
            )
        finally:
            self.trace_queue.release_recording_bytes(self.source.tenant_id, reserved)

    def mark_incomplete(self, reason: str) -> None:
        with self._lock:
            if not self._closed and reason not in self._incomplete_reasons:
                self._incomplete_reasons.append(reason)

    def close(self) -> None:
        """Release unfinished collection when its response consumer exits."""
        with self._lock:
            self._closed = True
            self._spans.clear()
            reserved, self._reserved_bytes = self._reserved_bytes, 0
        self.trace_queue.release_recording_bytes(self.source.tenant_id, reserved)
