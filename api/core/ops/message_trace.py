"""Invocation-owned message spans and explicit submission to the application's queue."""

from __future__ import annotations

import json
import logging
import weakref
from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager
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
        attributes: Mapping[str, Any] | None = None,
    ):
        self.source = source
        self.trace_queue = trace_queue
        self.provider_settings = tuple(provider_settings)
        self.load_provider_settings = load_provider_settings
        self.attributes: dict[str, Any] = {}
        self._load_message_fields = load_message_fields
        self._record_message_result = record_message_result
        self._lock = Lock()
        self._spans: list[TraceSpan] = []
        self._truncated_span_ids: set[str] = set()
        self._attributes_truncated = False
        self._closed = False
        self._reserved_bytes = 0
        self._attribute_bytes = 0
        self._attribute_finalizer: weakref.finalize | None = None
        self._snapshot_bytes = 0
        self._omitted_spans = 0
        self._incomplete_reasons: list[str] = []
        self.update_attributes(attributes or {})

    @property
    def user_id(self) -> str | None:
        return self.source.actor_id

    @contextmanager
    def copy_fields(
        self, fields: Mapping[str, Any], *, on_truncate: Callable[[], None] | None = None
    ) -> Generator[dict[str, Any], None, None]:
        """Own a producer's snapshot until its invocation ends, even if the message closes first."""
        with self._lock:
            remaining = 7 * 1024 * 1024 - self._reserved_bytes - self._attribute_bytes - self._snapshot_bytes
            copied = copy_trace_fields(
                fields,
                max_bytes=max(32, remaining),
                on_truncate=on_truncate,
            )
            reserved = len(json.dumps(copied, ensure_ascii=False).encode())
            if reserved > remaining or not self.trace_queue.reserve_recording_bytes(self.source.tenant_id, reserved):
                reserved = 0
                copied = {"_trace_truncated": True}
                if on_truncate is not None:
                    on_truncate()
            self._snapshot_bytes += reserved
        try:
            yield copied
        finally:
            with self._lock:
                self._snapshot_bytes -= reserved
                if reserved:
                    self.trace_queue.release_recording_bytes(self.source.tenant_id, reserved)

    def update_attributes(self, attributes: Mapping[str, Any]) -> None:
        truncated: list[bool] = []
        with self._lock:
            if self._closed:
                return
            remaining = 7 * 1024 * 1024 - self._reserved_bytes - self._snapshot_bytes
            copied = copy_trace_fields(
                {**self.attributes, **attributes},
                max_bytes=max(32, remaining),
                on_truncate=lambda: truncated.append(True),
            )
            copied_bytes = len(json.dumps(copied, ensure_ascii=False).encode()) if copied else 0
            difference = copied_bytes - self._attribute_bytes
            if copied_bytes > remaining or (
                difference > 0 and not self.trace_queue.reserve_recording_bytes(self.source.tenant_id, difference)
            ):
                self._attributes_truncated = True
                return
            if difference < 0:
                self.trace_queue.release_recording_bytes(self.source.tenant_id, -difference)
            if self._attribute_finalizer is not None:
                self._attribute_finalizer.detach()
            self._attribute_bytes = copied_bytes
            self._attribute_finalizer = (
                weakref.finalize(self, self.trace_queue.release_recording_bytes, self.source.tenant_id, copied_bytes)
                if copied_bytes
                else None
            )
            self.attributes = copied
            self._attributes_truncated |= bool(truncated)

    def bind_message(
        self,
        message_id: str,
        conversation_id: str,
        *,
        external_trace_id: str | None = None,
        session_id: str | None = None,
        from_account_id: str | None = None,
        from_end_user_id: str | None = None,
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
            self.attributes.update(from_account_id=from_account_id, from_end_user_id=from_end_user_id)

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
        attributes: Mapping[str, Any] | None = None,
        workflow_trace_state: Mapping[str, Any] | None = None,
        resumed_without_state: bool = False,
    ):
        from core.ops.workflow_trace import WorkflowTraceRecorder

        with self._lock:
            source = TraceSource.model_validate(
                {**self.source.model_dump(), "operation_id": workflow_run_id, "workflow_run_id": workflow_run_id}
            )
            self.source = self.source.model_copy(update={"workflow_run_id": source.workflow_run_id})
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
            attributes={**self.attributes, **(attributes or {})},
            submit_completed_trace=self._submit_trace_with_message_parent,
            provider_settings=self.provider_settings,
            pause_state=workflow_trace_state,
            resumed_without_state=resumed_without_state,
            load_provider_settings=self.load_provider_settings,
            reserve_recording_bytes=self.trace_queue.reserve_recording_bytes,
            release_recording_bytes=self.trace_queue.release_recording_bytes,
            capture_truncated=self._attributes_truncated,
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
        workflow_id: str | None = None,
        node_execution_id: str | None = None,
        node_id: str | None = None,
        message_id: str | None = None,
        independent: bool = False,
        capture_truncated: bool = False,
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
                workflow_id=workflow_id,
                node_execution_id=node_execution_id,
                node_id=node_id,
                message_id=message_id,
                independent=independent,
                capture_truncated=capture_truncated,
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
        workflow_id: str | None = None,
        node_execution_id: str | None = None,
        node_id: str | None = None,
        message_id: str | None = None,
        independent: bool = False,
        capture_truncated: bool = False,
    ) -> None:
        """Record one actual operation without deferring model/ORM reads to a worker."""
        timer = timer or {}
        truncated: list[bool] = []
        with self._lock:
            separate = self._closed or independent or not self.source.message_id
            remaining = (
                7 * 1024 * 1024
                - self._attribute_bytes
                - self._snapshot_bytes
                - (0 if separate else self._reserved_bytes)
            )
            if not separate and (len(self._spans) >= 10000 or remaining <= 1024):
                self._omitted_spans += 1
                return
            content = copy_trace_fields(
                {
                    "inputs": inputs,
                    "outputs": outputs,
                    "error": error,
                    "attributes": {
                        **self.attributes,
                        "operation_type": "tool" if span_type == "tool" else span_name,
                        **(attributes or {}),
                    },
                    "usage": usage or {},
                },
                max_bytes=max(32, remaining - 1024),
                on_truncate=lambda: truncated.append(True),
            )
            capture_truncated |= bool(truncated) or self._attributes_truncated
            span = TraceSpan(
                span_id=make_span_id(self.source.tenant_id, self.source.operation_id, str(uuid4())),
                parent_span_id=make_span_id(self.source.tenant_id, self.source.operation_id, "message"),
                span_name=span_name,
                span_type=span_type,
                source_app_id=self.source.app_id,
                source_pipeline_id=self.source.pipeline_id,
                source_workflow_id=workflow_id,
                node_execution_id=node_execution_id,
                node_id=node_id,
                started_at=timer.get("start"),
                ended_at=timer.get("end"),
                inputs=content.get("inputs"),
                outputs=content.get("outputs"),
                status="error" if error else "ok",
                error=str(content["error"]) if content.get("error") else None,
                attributes=captured_attributes
                if isinstance(captured_attributes := content.get("attributes"), dict)
                else {},
                usage=captured_usage if isinstance(captured_usage := content.get("usage"), dict) else {},
            )
            span_bytes = len(span.model_dump_json().encode())
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
                if capture_truncated:
                    self._truncated_span_ids.add(span.span_id)
                return
        self._submit_operation(span, message_id=message_id, capture_truncated=capture_truncated)

    def _submit_operation(
        self,
        span: TraceSpan,
        *,
        message_id: str | None = None,
        capture_truncated: bool = False,
        already_reserved: bool = False,
    ) -> None:
        source = TraceSource.model_validate(
            {
                **self.source.model_dump(),
                "operation_id": str(uuid4()),
                "message_id": message_id or self.source.message_id,
            }
        )
        root = span.model_copy(update={"parent_span_id": None})
        reasons = ["value_size_limit"] if capture_truncated else []
        reserved = 0 if already_reserved else len(root.model_dump_json().encode())
        if reserved and not self.trace_queue.reserve_recording_bytes(source.tenant_id, reserved):
            reserved = 0
            reasons.append("recording_byte_limit")
            root = root.model_copy(
                update={
                    "inputs": "[recording byte limit]",
                    "outputs": "[recording byte limit]",
                    "error": None,
                    "attributes": {},
                    "usage": {},
                }
            )
        try:
            trace = CompletedTrace(
                source=source,
                trace_id=make_trace_id(source.tenant_id, source.operation_id),
                root_span_id=root.span_id,
                spans=(root,),
                complete=not reasons,
                truncation={"reasons": list(reasons)} if reasons else {},
            )
            self._submit_trace_with_message_parent(trace)
        finally:
            if reserved:
                self.trace_queue.release_recording_bytes(source.tenant_id, reserved)

    def _submit_trace_with_message_parent(
        self, completed_trace: CompletedTrace, provider_settings: Sequence[TraceProviderSettings] | None = None
    ) -> bool:
        """Attach message operations and Chatflow workflows to their exact destination's message root."""
        source = completed_trace.source
        if source.message_id is None:
            return self.submit_completed_trace(completed_trace, provider_settings)
        settings = self.provider_settings if provider_settings is None else provider_settings
        parent_source = TraceSource.model_validate({**source.model_dump(), "operation_id": source.message_id})
        parent_id = make_span_id(source.tenant_id, source.message_id, "message")
        parent_trace = CompletedTrace(
            source=parent_source,
            trace_id=make_trace_id(source.tenant_id, source.message_id),
            root_span_id=parent_id,
            spans=(TraceSpan(span_id=parent_id, span_name="message"),),
        )
        submitted = False
        for destination in settings:
            parent_export = QueuedTrace.from_trace(parent_trace, destination)
            trace = completed_trace.model_copy(
                update={"parent": ParentSpanReference(export_id=parent_export.export_id, span_id=parent_id)}
            )
            submitted = self.submit_completed_trace(trace, (destination,)) or submitted
        return submitted

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
            incomplete_reasons = list(self._incomplete_reasons)
            if self._attributes_truncated or self._truncated_span_ids:
                incomplete_reasons.append("value_size_limit")
            self._truncated_span_ids.clear()
        try:
            source = TraceSource.model_validate(
                {
                    **self.source.model_dump(),
                    "message_id": message_fields["message_id"],
                    "conversation_id": message_fields["conversation_id"],
                    "workflow_run_id": message_fields.get("workflow_run_id") or self.source.workflow_run_id,
                }
            )
            with self._lock:
                self.source = source
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
            root_copies = 2 if include_llm and message_fields.get("model_name") else 1
            content = copy_trace_fields(
                {
                    "inputs": message_fields.get("inputs"),
                    "outputs": message_fields.get("outputs"),
                    "error": message_fields.get("error"),
                    "usage": usage,
                    "attributes": {
                        **self.attributes,
                        **metadata,
                        "operation_type": "message",
                        "query": message_fields.get("query"),
                        "original_inputs": message_fields.get("original_inputs"),
                        "is_streaming_request": self.attributes.get(
                            "is_streaming_request", usage.get("time_to_first_token") is not None
                        ),
                        "model_provider": message_fields.get("model_provider"),
                        "model_name": message_fields.get("model_name"),
                        "files": message_fields.get("files", []),
                    },
                },
                # The message root and optional LLM span serialize the same content.
                max_bytes=max(
                    32,
                    (7 * 1024 * 1024 - reserved - self._attribute_bytes - self._snapshot_bytes) // root_copies - 1024,
                ),
                on_truncate=lambda: incomplete_reasons.append("value_size_limit"),
            )
            root = TraceSpan(
                span_id=root_id,
                span_name=span_name,
                span_type="operation",
                source_app_id=source.app_id,
                inputs=content.get("inputs"),
                outputs=content.get("outputs"),
                started_at=message_fields.get("started_at"),
                ended_at=message_fields.get("ended_at"),
                status="error" if message_fields.get("error") else "ok",
                error=str(content["error"]) if content.get("error") else None,
                usage=captured_usage if isinstance(captured_usage := content.get("usage"), dict) else {},
                attributes=captured_attributes
                if isinstance(captured_attributes := content.get("attributes"), dict)
                else {},
            )
            root_bytes = len(root.model_dump_json().encode()) * root_copies + 1024
            if self.trace_queue.reserve_recording_bytes(source.tenant_id, root_bytes):
                reserved += root_bytes
            else:
                incomplete_reasons.append("recording_byte_limit")
                root = root.model_copy(
                    update={
                        "inputs": "[recording byte limit]",
                        "outputs": "[recording byte limit]",
                        "error": None,
                        "attributes": {},
                        "usage": {},
                    }
                )
            spans = [root, *children]
            if root_copies == 2:
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
                    truncation={"omitted_spans": omitted, "reasons": list(dict.fromkeys(incomplete_reasons))}
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

    def close(self, *, submit_pending_operations: bool = False) -> None:
        """Release collection on consumer exit, optionally exporting operations without completing the message."""
        with self._lock:
            self._closed = True
            pending_operations, self._spans = self._spans, []
            reserved, self._reserved_bytes = self._reserved_bytes, 0
            truncated_span_ids, self._truncated_span_ids = self._truncated_span_ids, set()
        try:
            if submit_pending_operations:
                for span in pending_operations:
                    try:
                        self._submit_operation(
                            span,
                            capture_truncated=span.span_id in truncated_span_ids,
                            already_reserved=True,
                        )
                    except Exception:
                        logging.getLogger(__name__).warning(
                            "Cannot submit operation tenant_id=%s span_id=%s", self.source.tenant_id, span.span_id
                        )
        finally:
            self.trace_queue.release_recording_bytes(self.source.tenant_id, reserved)
