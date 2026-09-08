"""Create LangSmith runs synchronously, with explicit IDs and ancestor order."""

from typing import Any
from urllib.parse import quote

from pydantic import JsonValue

from core.ops.provider_export import TraceExportError, TraceProviderHttpClient, export_span_id, span_attributes
from core.ops.trace_data import CompletedTrace, ExportedParentSpans
from dify_trace_langsmith.config import LangSmithConfig


class LangSmithTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        self.config = LangSmithConfig.model_validate(provider_config)
        self.http = TraceProviderHttpClient(self.config.endpoint, {"x-api-key": self.config.api_key})

    def verify_credentials(self) -> bool:
        self.http.request("GET", "sessions", params={"name": self.config.project, "limit": 1})
        return True

    def get_project_url(self) -> str:
        sessions = self.http.request("GET", "sessions", params={"name": self.config.project, "limit": 1}).json()
        if sessions and isinstance(sessions, list) and sessions[0].get("id"):
            tenant_id = quote(str(sessions[0].get("tenant_id", "")), safe="")
            project_id = quote(str(sessions[0]["id"]), safe="")
            return f"https://smith.langchain.com/o/{tenant_id}/projects/p/{project_id}"
        return "https://smith.langchain.com/"

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        receipts: dict[str, dict[str, JsonValue]] = {}
        trace_id = (
            str(parent_span["trace_id"])
            if parent_span
            else export_span_id(completed_trace, completed_trace.root_span_id)
        )
        for span in completed_trace.spans:
            parent = receipts.get(span.parent_span_id or "") or parent_span
            if span.started_at is None:
                raise TraceExportError("langsmith_span_start_missing")
            span_id = export_span_id(completed_trace, span.span_id)
            own_order = span.started_at.strftime("%Y%m%dT%H%M%S%fZ") + span_id
            if parent is not None and not parent.get("dotted_order"):
                raise TraceExportError("langsmith_parent_order_missing")
            dotted_order = f"{parent['dotted_order']}.{own_order}" if parent else own_order
            run = {
                "id": span_id,
                "trace_id": trace_id,
                "name": span.span_name,
                "run_type": {"llm": "llm", "tool": "tool", "retrieval": "retriever"}.get(span.span_type, "chain"),
                "start_time": span.started_at.isoformat(),
                "end_time": span.ended_at.isoformat() if span.ended_at else None,
                "inputs": span.inputs if isinstance(span.inputs, dict) else {"input": span.inputs},
                "outputs": span.outputs if isinstance(span.outputs, dict) else {"output": span.outputs},
                "error": span.error if span.status == "error" else None,
                "parent_run_id": parent["span_id"] if parent else None,
                "dotted_order": dotted_order,
                "session_name": self.config.project,
                "extra": {"metadata": span_attributes(completed_trace, span)},
                "tags": ["dify", span.span_type],
            }
            # /runs/batch upserts client-assigned run IDs; retrying retains IDs and ancestor order.
            self.http.request("POST", "runs/batch", json={"post": [run]})
            receipts[span.span_id] = {"trace_id": trace_id, "span_id": span_id, "dotted_order": dotted_order}
        return ExportedParentSpans(spans=receipts)
