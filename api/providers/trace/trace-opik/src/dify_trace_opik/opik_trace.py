"""Opik trace/span REST writes with explicit workspace and deterministic IDs."""

from typing import Any
from urllib.parse import quote

from pydantic import JsonValue

from core.ops.provider_export import TraceExportError, TraceProviderHttpClient, export_span_id, span_attributes
from core.ops.trace_data import CompletedTrace, ExportedParentSpans
from dify_trace_opik.config import OpikConfig


class OpikTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        self.config = OpikConfig.model_validate(provider_config)
        self.http = TraceProviderHttpClient(
            self.config.url,
            {
                **({"Authorization": self.config.api_key} if self.config.api_key else {}),
                **({"Comet-Workspace": self.config.workspace} if self.config.workspace else {}),
            },
        )

    def verify_credentials(self) -> bool:
        self.http.request("GET", "v1/private/projects", params={"size": 1})
        return True

    def get_project_url(self) -> str:
        return (
            self.config.url.removesuffix("api/").rstrip("/")
            + f"/{quote(self.config.workspace or 'default', safe='')}/projects"
        )

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        trace_id = str(parent_span["trace_id"]) if parent_span else completed_trace.trace_id
        for span in completed_trace.spans:
            if span.started_at is None:
                raise TraceExportError("opik_span_start_missing")
            values = {
                "name": span.span_name,
                "start_time": span.started_at.isoformat(),
                "end_time": span.ended_at.isoformat() if span.ended_at else None,
                "project_name": self.config.project or "Default Project",
                "input": span.inputs,
                "output": span.outputs,
                "metadata": span_attributes(completed_trace, span),
                "tags": ["dify", span.span_type],
            }
            if span.error:
                values["error_info"] = {"message": span.error, "exception_type": span.status, "traceback": ""}
            if span.span_id == completed_trace.root_span_id and parent_span is None:
                self.http.request(
                    "POST",
                    "v1/private/traces",
                    json={
                        **values,
                        "id": trace_id,
                        "thread_id": completed_trace.source.session_id or completed_trace.source.conversation_id,
                    },
                )
            values.update(
                {
                    "id": export_span_id(completed_trace, span.span_id),
                    "trace_id": trace_id,
                    "parent_span_id": export_span_id(completed_trace, span.parent_span_id)
                    if span.parent_span_id
                    else (parent_span["span_id"] if parent_span else None),
                    "type": span.span_type if span.span_type in {"llm", "tool"} else "general",
                    "model": span.attributes.get("model_name"),
                    "provider": span.attributes.get("model_provider"),
                    "usage": {key: value for key, value in span.usage.items() if key.endswith("tokens")},
                }
            )
            if (cost := span.usage.get("total_price", span.usage.get("total_cost"))) is not None:
                values["total_cost"] = float(str(cost))
            self.http.request("POST", "v1/private/spans", json=values)
        return ExportedParentSpans(
            spans={
                span.span_id: {"trace_id": trace_id, "span_id": export_span_id(completed_trace, span.span_id)}
                for span in completed_trace.spans
            }
        )
