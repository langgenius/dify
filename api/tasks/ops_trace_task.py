"""Export one tenant-owned immutable delivery with an SQL attempt token."""

import json
from datetime import timedelta
from hashlib import sha256
from typing import Any
from uuid import UUID

from flask import current_app

from core.ops.provider_export import TraceExportError
from core.ops.trace_data import CompletedTrace
from repositories.ops_trace_delivery_repository import OpsTraceDeliveryRepository


def export_trace_delivery(tenant_id: str, delivery_id: str) -> None:
    """Celery messages supply IDs only; the stored row supplies all routing."""
    tenant_id, delivery_id = str(UUID(tenant_id)), str(UUID(delivery_id))
    repository: OpsTraceDeliveryRepository = current_app.extensions["ops_trace_delivery_repository"]
    trace_storage = current_app.extensions["ops_trace_storage"]
    logger = current_app.logger
    delivery = repository.get_delivery(tenant_id, delivery_id)
    if delivery is None or delivery.status not in ("pending", "sending"):
        return
    parent_ready, parent_reference = repository.read_parent_reference(delivery)
    if not parent_ready:
        return
    delivery = repository.claim_delivery(tenant_id, delivery_id)
    if delivery is None:
        return
    try:
        from core.ops.provider_export import export_trace
        from core.ops.trace_source import load_trace_provider_config

        if delivery.updated_at - delivery.created_at > timedelta(days=1):
            raise ValueError("delivery_expired")
        if delivery.schema_version != 2 or not 0 < delivery.trace_size_bytes <= 8 * 1024 * 1024:
            raise ValueError("invalid_trace_schema")
        # Streaming avoids allocating an unbounded replacement object before checking its size.
        trace_parts = bytearray()
        for chunk in trace_storage.load_stream(delivery.trace_storage_key()):
            if len(trace_parts) + len(chunk) > delivery.trace_size_bytes:
                raise ValueError("invalid_trace_size")
            trace_parts.extend(chunk)
        if len(trace_parts) != delivery.trace_size_bytes or sha256(trace_parts).hexdigest() != delivery.trace_sha256:
            raise ValueError("invalid_trace_digest")
        completed_trace = CompletedTrace.model_validate_json(trace_parts)
        repository.validate_trace_owner(delivery, completed_trace)
        if completed_trace.parent is not None and parent_reference is None:
            missing_parent = completed_trace.parent.export_id
            spans = tuple(
                span.model_copy(
                    update={
                        "attributes": {
                            **span.attributes,
                            "dify.parent_export_id": missing_parent,
                            "dify.parent_status": delivery.error_code or "parent_unavailable",
                        }
                    }
                )
                if span.span_id == completed_trace.root_span_id
                else span
                for span in completed_trace.spans
            )
            completed_trace = completed_trace.model_copy(
                update={
                    "parent": None,
                    "spans": spans,
                    "links": (*completed_trace.links, missing_parent),
                }
            )
        provider_settings = repository.provider_settings(delivery)
        provider_config: dict[str, Any] = load_trace_provider_config(provider_settings)
        if not repository.extend_attempt_lease(delivery):
            return
        parent_spans = export_trace(completed_trace, provider_settings, provider_config, parent_reference)
        # Late operations attach to the original root; nested trees export together.
        root_reference = parent_spans.spans.get(completed_trace.root_span_id)
        parent_references = {completed_trace.root_span_id: root_reference} if root_reference is not None else {}
        receipt_error = None
        if len(json.dumps(parent_references).encode()) > 64 * 1024:
            parent_references, receipt_error = {}, "parent_reference_too_large"
        repository.finish_attempt(delivery, "succeeded", receipt_error, parent_references=parent_references)
    except Exception as error:
        from configs import dify_config

        # Exception strings can contain credentials or traced inputs; persist only bounded codes.
        retryable = (
            error.retryable
            if isinstance(error, TraceExportError)
            else not isinstance(error, (ValueError, TypeError, PermissionError, ImportError, NotImplementedError))
        )
        error_code = "export_failed" if retryable else "invalid_trace_or_configuration"
        if isinstance(error, ValueError) and str(error) in (
            "invalid_trace_schema",
            "invalid_trace_size",
            "invalid_trace_digest",
            "trace_owner_mismatch",
            "tenant_deleted",
            "source_owner_mismatch",
            "workflow_owner_mismatch",
            "workflow_run_owner_mismatch",
            "conversation_owner_mismatch",
            "message_owner_mismatch",
            "configuration_changed",
            "delivery_expired",
        ):
            error_code = str(error)
        if isinstance(error, PermissionError):
            error_code = "configuration_changed"
        maximum_attempts = dify_config.OPS_TRACE_MAX_ATTEMPTS
        retry = retryable and delivery.attempt_count < maximum_attempts
        delay = min(dify_config.OPS_TRACE_RETRY_DELAY_SECONDS * 2 ** min(delivery.attempt_count - 1, 6), 300)
        if isinstance(error, TraceExportError) and error.retry_after is not None:
            delay = min(max(delay, error.retry_after), 3600)
        status = "pending" if retry else "cancelled" if error_code == "configuration_changed" else "failed"
        repository.finish_attempt(delivery, status, error_code, retry_delay_seconds=delay)
        logger.warning(
            "OPS export failed tenant_id=%s delivery_id=%s retry=%s error_code=%s",
            tenant_id,
            delivery_id,
            retry,
            error_code,
        )
