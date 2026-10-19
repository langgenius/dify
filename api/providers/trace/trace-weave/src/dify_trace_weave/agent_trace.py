"""Completed Agent trees through Weave's typed call API and an isolated transport."""

from collections.abc import Mapping
from typing import Any, cast, override
from urllib.parse import quote
from uuid import UUID, uuid5

from pydantic import BaseModel
from weave.trace_server.trace_server_interface import (
    CallEndReq,
    CallStartReq,
    EndedCallSchemaForInsert,
    StartedCallSchemaForInsert,
    SummaryInsertMap,
)
from weave.trace_server_bindings.remote_http_trace_server import RemoteHTTPTraceServer

from core.ops.unified_trace.entities import CanonicalTrace
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.configuration import console_url
from services.tracing.provider_common import endpoint, request, required, token_usage, utc
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportResult, TraceExportUncertainError


class _TraceServer(RemoteHTTPTraceServer):
    """Use SDK request/response validation without SDK retries or global W&B login."""

    @override
    def _post_request_executor(self, url: str, req: BaseModel, stream: bool = False):
        return request(
            "POST",
            self.trace_server_url + url,
            "weave",
            auth=self._auth,
            content=req.model_dump_json(by_alias=True).encode(),
            headers={"Content-Type": "application/json"},
        )

    @override
    def _generic_request(self, url, req, req_model, res_model, method="POST", params=None):
        response = self._post_request_executor(url, req)
        try:
            return res_model.model_validate(response.json())
        except ValueError:
            raise TraceExportUncertainError("Weave returned an unreadable ingestion acknowledgment") from None


def _project(config: Mapping[str, Any], api_key: str) -> tuple[str, str, str]:
    project = required(config, "project")
    host = endpoint(config.get("host") or "https://api.wandb.ai")
    entity = config.get("entity")
    if not entity and "/" in project:
        entity, project = project.split("/", 1)
    if not entity:
        response = request(
            "POST",
            host + "/graphql",
            "weave",
            auth=("api", api_key),
            json={"query": "query DifyTraceEntity { viewer { entity } }"},
        )
        entity = (response.json().get("data") or {}).get("viewer", {}).get("entity")
    if not isinstance(entity, str) or not entity or "/" in entity or not project or "/" in project:
        raise TraceExportRejectedError("Weave project or entity could not be resolved")
    ui_host = console_url(WeaveConfig(api_key=api_key, entity=entity, project=project, host=host))
    return entity, project, ui_host


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    api_key = required(config, "api_key")
    entity, project, ui_host = _project(config, api_key)
    # Weave's concrete HTTP client leaves unrelated optional API methods as protocol stubs.
    server = _TraceServer(  # pyrefly: ignore[bad-instantiation]
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
