"""Opik trace/span REST writes with explicit workspace and deterministic IDs."""

from datetime import datetime
from typing import Any
from urllib.parse import quote, urlencode
from uuid import UUID

from pydantic import JsonValue

from core.helper.ssl_context import create_ssl_context
from core.ops.provider_export import TraceExportError, TraceProviderHttpClient, export_span_id, span_attributes
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan
from dify_trace_opik.config import OpikConfig


def _prepare_timed_spans(completed_trace: CompletedTrace) -> list[TraceSpan]:
    """Keep untimed details as marked instants at a captured endpoint, never export time."""
    spans: dict[str, TraceSpan] = {}
    for span in completed_trace.spans:
        if span.started_at is None or span.ended_at is None:
            parent = spans.get(span.parent_span_id or "")
            anchor = span.started_at or span.ended_at or (parent.started_at if parent else None)
            if anchor is None:
                raise TraceExportError("opik_span_time_missing")
            span = span.model_copy(
                update={
                    "started_at": anchor,
                    "ended_at": anchor,
                    "attributes": {
                        **span.attributes,
                        "dify.timing.estimated": True,
                        "dify.timing.source": "captured_endpoint",
                    },
                }
            )
        assert span.started_at is not None
        assert span.ended_at is not None
        if span.ended_at < span.started_at:
            raise TraceExportError("opik_span_time_invalid")
        spans[span.span_id] = span
    return list(spans.values())


def _make_opik_id(identifier: str, started_at: datetime | None) -> str:
    """Use Opik's UUID4-to-UUID7 layout while keeping every retry deterministic."""
    value = UUID(identifier)
    if value.version == 7:
        return str(value)
    if started_at is None:
        raise TraceExportError("opik_span_time_missing")
    encoded = bytearray(value.bytes)
    encoded[:6] = int(started_at.timestamp() * 1000).to_bytes(6, "big")
    encoded[6] = (encoded[6] & 0x0F) | 0x70
    encoded[8] = (encoded[8] & 0x3F) | 0x80
    return str(UUID(bytes=bytes(encoded)))


def _make_span_tags(completed_trace: CompletedTrace, span: TraceSpan) -> list[JsonValue]:
    tags = ["dify", span.span_type]
    operation_type = span.attributes.get("operation_type", span.span_type)
    if not isinstance(operation_type, str):
        operation_type = span.span_type
    mode = span.attributes.get("conversation_mode", span.attributes.get("app_mode"))
    if span.node_execution_id or span.attributes.get("node_execution_id") or span.span_type == "node":
        tags.append("node_execution")
    elif operation_type in {"message", "llm"}:
        tags.append(operation_type)
        if operation_type == "message" and completed_trace.source.workflow_run_id:
            tags.append("workflow")
        elif isinstance(mode, str) and mode:
            tags.append(mode)
    elif operation_type in {"moderation", "suggested_question", "dataset_retrieval", "generate_name"}:
        tags.append(operation_type)
    elif operation_type == "tool" or span.span_type == "tool":
        tags.append("tool")
        if isinstance(tool_name := span.attributes.get("tool_name", span.span_name), str) and tool_name:
            tags.append(tool_name)
    return list(dict.fromkeys(tags))


class OpikTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        self.config = OpikConfig.model_validate(provider_config)
        runtime_settings = (
            provider_config["_runtime_settings"]
            if "_runtime_settings" in provider_config
            else OpikConfig.load_runtime_settings(provider_config)
        )
        self.config = self.config.model_copy(
            update={
                key: runtime_settings[key] for key in ("api_key", "workspace", "project") if key in runtime_settings
            }
        )
        self.http = TraceProviderHttpClient(
            self.config.url,
            {
                **({"Authorization": self.config.api_key} if self.config.api_key else {}),
                "Comet-Workspace": self.config.workspace or "default",
            },
            ssl_context=create_ssl_context(
                runtime_settings.get("tls", {}), verify=runtime_settings.get("verify", True)
            ),
        )

    def verify_credentials(self) -> bool:
        self.http.request("GET", "v1/private/projects", params={"size": 1})
        return True

    def get_project_url(self) -> str:
        workspace = self.config.workspace or "default"
        if workspace == "default":
            try:
                workspace_details = self.http.request("GET", "v1/private/auth/workspace").json()
                if (
                    isinstance(workspace_details, dict)
                    and isinstance(workspace_name := workspace_details.get("workspace_name"), str)
                    and workspace_name
                ):
                    workspace = workspace_name
            except (TraceExportError, ValueError):
                # An unavailable default-workspace lookup must not prevent reading saved settings.
                pass
        return (
            self.config.url.removesuffix("api/").rstrip("/")
            + f"/{quote(workspace, safe='')}/redirect/projects?"
            + urlencode({"name": self.config.project or "Default Project"})
        )

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        spans = _prepare_timed_spans(completed_trace)
        root = spans[0]
        trace_seed = completed_trace.trace_id
        if external_id := completed_trace.source.external_trace_id:
            try:
                external_uuid = UUID(external_id)
                if external_uuid.int:
                    trace_seed = str(external_uuid)
            except ValueError:
                pass
        trace_id = str(parent_span["trace_id"]) if parent_span else _make_opik_id(trace_seed, root.started_at)
        if parent_span:
            try:
                if any(UUID(str(parent_span[key])).version != 7 for key in ("trace_id", "span_id")):
                    raise ValueError("Opik requires UUIDv7")
            except ValueError:
                raise TraceExportError("opik_parent_id_invalid") from None
        span_ids = {
            span.span_id: _make_opik_id(export_span_id(completed_trace, span.span_id), span.started_at)
            for span in spans
        }
        requests: list[tuple[str, dict[str, JsonValue]]] = []
        for span in spans:
            assert span.started_at is not None
            assert span.ended_at is not None
            values: dict[str, JsonValue] = {
                "name": span.span_name,
                "start_time": span.started_at.isoformat(),
                "end_time": span.ended_at.isoformat() if span.ended_at else None,
                "project_name": self.config.project or "Default Project",
                "input": span.inputs
                if isinstance(span.inputs, dict)
                else {"messages" if span.span_type == "llm" else "input": span.inputs},
                "output": span.outputs if isinstance(span.outputs, dict) else {"output": span.outputs},
                "metadata": {**span_attributes(completed_trace, span), "created_from": "dify"},
                "tags": _make_span_tags(completed_trace, span),
            }
            if span.error:
                values["error_info"] = {"message": span.error, "exception_type": span.status, "traceback": ""}
            if span.span_id == completed_trace.root_span_id and parent_span is None:
                requests.append(
                    (
                        "v1/private/traces",
                        {
                            **values,
                            "id": trace_id,
                            "tags": ["dify", "message", "workflow"]
                            if span.span_type == "workflow" and completed_trace.source.message_id
                            else values["tags"],
                            "thread_id": completed_trace.source.session_id or completed_trace.source.conversation_id,
                        },
                    )
                )
            values.update(
                {
                    "id": span_ids[span.span_id],
                    "trace_id": trace_id,
                    "parent_span_id": span_ids[span.parent_span_id]
                    if span.parent_span_id
                    else (parent_span["span_id"] if parent_span else None),
                    "type": span.span_type if span.span_type in {"llm", "tool"} else "general",
                    "model": span.attributes.get("model_name"),
                    "provider": span.attributes.get("model_provider"),
                    "usage": {key: value for key, value in span.usage.items() if key.endswith("tokens")}
                    if span.span_type == "llm"
                    else {},
                }
            )
            if (
                span.span_type == "llm"
                and (cost := span.usage.get("total_price", span.usage.get("total_cost"))) is not None
            ):
                values["total_estimated_cost"] = float(str(cost))
            requests.append(("v1/private/spans", values))
        for path, values in requests:
            self.http.request("POST", path, json=values)
        return ExportedParentSpans(
            spans={span_id: {"trace_id": trace_id, "span_id": exported_id} for span_id, exported_id in span_ids.items()}
        )
