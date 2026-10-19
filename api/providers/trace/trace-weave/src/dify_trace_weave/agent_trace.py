"""Completed Agent trees through Weave's typed call API and an isolated transport."""

from collections.abc import Mapping
from typing import Any, cast
from urllib.parse import quote
from uuid import UUID, uuid5

from weave.trace_server.trace_server_interface import (
    CallEndReq,
    CallStartReq,
    EndedCallSchemaForInsert,
    StartedCallSchemaForInsert,
    SummaryInsertMap,
)

from core.ops.unified_trace.entities import CanonicalTrace
from dify_trace_weave.transport import TraceServer, resolve_project
from services.tracing.provider_common import endpoint, required, token_usage, utc
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportResult, TraceExportUncertainError


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    api_key = required(config, "api_key")
    entity, project, ui_host = resolve_project(config, api_key)
    # Weave's concrete HTTP client leaves unrelated optional API methods as protocol stubs.
    server = TraceServer(  # pyrefly: ignore[bad-instantiation]
        endpoint(config.get("endpoint") or "https://trace.wandb.ai"), auth=("api", api_key)
    )
    project_id = f"{entity}/{project}"
    trace_uuid = UUID(hex=trace.trace_id)
    span_ids = {span.id: str(uuid5(trace_uuid, span.id)) for span in trace.spans}
    # Weave counts calls whose id equals turn_id as conversation turns.
    turn_id = span_ids[trace.root_span_id] if trace.session_id else None
    wrote = False
    try:
        for span in trace.spans:
            started = server.call_start(
                CallStartReq(
                    start=StartedCallSchemaForInsert(
                        project_id=project_id,
                        id=span_ids[span.id],
                        op_name=span.name,
                        display_name=span.name,
                        trace_id=str(trace_uuid),
                        parent_id=span_ids.get(span.parent_id) if span.parent_id else None,
                        thread_id=trace.session_id or None,
                        turn_id=turn_id,
                        started_at=utc(span.start_time),
                        attributes={**span.metadata, "dify.span_kind": span.kind.value, "dify.span_id": span.id},
                        inputs=span.inputs if isinstance(span.inputs, dict) else {"input": span.inputs},
                    )
                )
            )
            wrote = True
            if started.id != span_ids[span.id] or started.trace_id != str(trace_uuid):
                raise TraceExportUncertainError("Weave did not acknowledge the submitted identifiers")
        for span in reversed(trace.spans):
            usage = token_usage(span)
            summary: dict[str, Any] = {}
            if usage:
                model = str(span.metadata.get("model_name") or span.metadata.get("model") or "unknown")
                summary["usage"] = {
                    model: {
                        {"input": "prompt_tokens", "output": "completion_tokens", "total": "total_tokens"}[key]: value
                        for key, value in usage.items()
                    }
                    | {"requests": 1}
                }
            if span.end_time is None:
                raise TraceExportRejectedError("Weave requires completed spans")
            server.call_end(
                CallEndReq(
                    end=EndedCallSchemaForInsert(
                        project_id=project_id,
                        id=span_ids[span.id],
                        ended_at=utc(span.end_time),
                        output=span.outputs,
                        exception=span.error or ("Agent span failed" if span.status.value == "error" else None),
                        summary=cast(SummaryInsertMap, summary),
                    )
                )
            )
    except Exception:
        if wrote:
            raise TraceExportUncertainError("Weave trace was partially accepted") from None
        raise
    base = f"{ui_host}/{quote(entity, safe='')}/{quote(project, safe='')}/r/call/"
    urls = {span_id: base + call_id for span_id, call_id in span_ids.items()}
    return TraceExportResult(trace_id=str(trace_uuid), trace_url=urls[trace.root_span_id], span_urls=urls)
