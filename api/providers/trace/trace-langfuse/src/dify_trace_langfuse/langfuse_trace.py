"""Langfuse ingestion preserves compatibility with existing self-hosted installations."""

from datetime import UTC, datetime
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from pydantic import JsonValue

from core.ops.provider_export import (
    TraceExportError,
    TraceProviderHttpClient,
    basic_auth,
    export_span_id,
    span_attributes,
)
from core.ops.trace_data import CompletedTrace, ExportedParentSpans
from dify_trace_langfuse.config import LangfuseConfig


class LangfuseTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        self.config = LangfuseConfig.model_validate(provider_config)
        self.http = TraceProviderHttpClient(
            self.config.host,
            {
                "Authorization": basic_auth(self.config.public_key, self.config.secret_key),
            },
        )

    def verify_credentials(self) -> bool:
        self.http.request("GET", "api/public/projects")
        return True

    def get_project_url(self) -> str:
        projects = self.http.request("GET", "api/public/projects").json().get("data", [])
        return f"{self.config.host.rstrip('/')}/project/{projects[0]['id']}" if projects else self.config.host

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        root = completed_trace.spans[0]
        trace_id = str(parent_span["trace_id"]) if parent_span else completed_trace.trace_id
        event_time = (root.ended_at or root.started_at or datetime(1970, 1, 1, tzinfo=UTC)).isoformat()
        events = []
        if parent_span is None:
            events.append(
                {
                    "id": str(uuid5(NAMESPACE_URL, f"{trace_id}:trace-create")),
                    "type": "trace-create",
                    "timestamp": event_time,
                    "body": {
                        "id": trace_id,
                        "name": root.span_name,
                        "input": root.inputs,
                        "output": root.outputs,
                        "userId": completed_trace.source.actor_id,
                        "sessionId": completed_trace.source.session_id or completed_trace.source.conversation_id,
                        "metadata": span_attributes(completed_trace, root),
                    },
                }
            )
        for span in completed_trace.spans:
            observation = {
                "id": export_span_id(completed_trace, span.span_id),
                "traceId": trace_id,
                "name": span.span_name,
                "parentObservationId": export_span_id(completed_trace, span.parent_span_id)
                if span.parent_span_id
                else (parent_span["span_id"] if parent_span else None),
                "input": span.inputs,
                "output": span.outputs,
                "level": "ERROR" if span.status == "error" else "DEFAULT",
                "statusMessage": span.error,
                "metadata": span_attributes(completed_trace, span),
            }
            if span.started_at:
                observation["startTime"] = span.started_at.isoformat()
            if span.ended_at:
                observation["endTime"] = span.ended_at.isoformat()
            event_type = "generation-create" if span.span_type == "llm" else "span-create"
            if span.span_type == "llm":
                observation.update(
                    {
                        "model": span.attributes.get("model_name") or span.attributes.get("ls_model_name"),
                        "usage": {
                            key: span.usage[value]
                            for key, value in (
                                ("input", "prompt_tokens"),
                                ("output", "completion_tokens"),
                                ("total", "total_tokens"),
                            )
                            if span.usage.get(value) is not None
                        },
                        "usageDetails": {key: value for key, value in span.usage.items() if key.endswith("tokens")},
                    }
                )
                if (cost := span.usage.get("total_price", span.usage.get("total_cost"))) is not None:
                    observation["costDetails"] = {"total": float(str(cost))}
            events.append(
                {
                    "id": str(uuid5(NAMESPACE_URL, f"{trace_id}:{span.span_id}:{event_type}")),
                    "type": event_type,
                    "timestamp": event_time,
                    "body": observation,
                }
            )
        for offset in range(0, len(events), 20):
            accepted = self.http.request(
                "POST", "api/public/ingestion", json={"batch": events[offset : offset + 20]}
            ).json()
            if failures := accepted.get("errors"):
                raise TraceExportError(
                    "langfuse_ingestion_rejected",
                    retryable=any(int(failure.get("status", 400)) in {429, 500, 502, 503, 504} for failure in failures),
                )
        return ExportedParentSpans(
            spans={
                span.span_id: {"trace_id": trace_id, "span_id": export_span_id(completed_trace, span.span_id)}
                for span in completed_trace.spans
            }
        )
