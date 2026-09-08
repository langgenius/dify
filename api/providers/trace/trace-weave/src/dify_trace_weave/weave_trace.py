"""Use Weave's Service API without wandb.login, weave.init or environment changes."""

from typing import Any
from urllib.parse import quote

from pydantic import JsonValue

from core.ops.provider_export import (
    TraceExportError,
    TraceProviderHttpClient,
    basic_auth,
    export_span_id,
    span_attributes,
)
from core.ops.trace_data import CompletedTrace, ExportedParentSpans
from dify_trace_weave.config import WeaveConfig


class WeaveTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        self.config = WeaveConfig.model_validate(provider_config)
        self.http = TraceProviderHttpClient(
            self.config.endpoint, {"Authorization": basic_auth("api", self.config.api_key)}
        )

    def _project_id(self) -> str:
        entity = self.config.entity
        if not entity:
            account = TraceProviderHttpClient(self.config.host or "https://api.wandb.ai", self.http.headers)
            account.deadline = self.http.deadline
            response = account.request("POST", "graphql", json={"query": "query { viewer { entity } }"}).json()
            entity = (response.get("data", {}).get("viewer") or {}).get("entity")
        if not entity:
            raise TraceExportError("weave_entity_unavailable")
        return f"{entity}/{self.config.project}"

    def verify_credentials(self) -> bool:
        self.http.request("POST", "calls/query_stats", json={"project_id": self._project_id()})
        return True

    def get_project_url(self) -> str:
        return f"{(self.config.host or 'https://wandb.ai').rstrip('/')}/{quote(self._project_id(), safe='/')}/weave"

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        project_id = self._project_id()
        trace_id = str(parent_span["trace_id"]) if parent_span else completed_trace.trace_id
        for span in completed_trace.spans:
            if span.started_at is None or span.ended_at is None:
                raise TraceExportError("weave_span_time_missing")
            self.http.request(
                "POST",
                "call/start",
                json={
                    "start": {
                        "project_id": project_id,
                        "id": export_span_id(completed_trace, span.span_id),
                        "op_name": span.span_name,
                        "trace_id": trace_id,
                        "parent_id": export_span_id(completed_trace, span.parent_span_id)
                        if span.parent_span_id
                        else (parent_span["span_id"] if parent_span else None),
                        "started_at": span.started_at.isoformat(),
                        "attributes": span_attributes(completed_trace, span),
                        "inputs": span.inputs if isinstance(span.inputs, dict) else {"input": span.inputs},
                        "wb_user_id": None,
                    }
                },
            )
            self.http.request(
                "POST",
                "call/end",
                json={
                    "end": {
                        "project_id": project_id,
                        "id": export_span_id(completed_trace, span.span_id),
                        "ended_at": span.ended_at.isoformat(),
                        "exception": span.error if span.status == "error" else None,
                        "output": span.outputs,
                        "summary": {
                            "usage": {str(span.attributes.get("model_name", "unknown")): span.usage},
                            "weave": {"latency_ms": (span.ended_at - span.started_at).total_seconds() * 1000},
                        },
                    }
                },
            )
        return ExportedParentSpans(
            spans={
                span.span_id: {"trace_id": trace_id, "span_id": export_span_id(completed_trace, span.span_id)}
                for span in completed_trace.spans
            }
        )
