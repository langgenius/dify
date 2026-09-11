"""Synchronous provider exports with credentials and clients owned by one attempt."""

import base64
import json
from datetime import datetime
from ssl import SSLContext
from time import monotonic
from typing import TYPE_CHECKING, Any, cast
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, UUID, uuid5

import httpx
from pydantic import JsonValue

from core.helper import ssrf_proxy
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceProviderSettings, TraceSpan

if TYPE_CHECKING:
    from core.ops.trace_export_state import TraceExportState


class TraceExportError(Exception):
    """A provider rejected an export; messages never include credentials or trace content."""

    def __init__(self, reason: str, *, retryable: bool = False, retry_after: int | None = None):
        super().__init__(reason)
        self.retryable = retryable
        self.retry_after = retry_after


class TraceProviderHttpClient:
    """Request-local authentication, bounded export time and no SDK background queues."""

    def __init__(
        self,
        endpoint: str,
        headers: dict[str, str] | None = None,
        *,
        timeout: float = 100,
        ssl_context: SSLContext | None = None,
    ):
        parsed = urlsplit(endpoint)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Tracing requires an HTTP endpoint without embedded credentials")
        self.endpoint = endpoint.rstrip("/")
        self.headers = dict(headers or {})
        self.ssl_context = ssl_context
        self.deadline = monotonic() + timeout

    def request(self, method: str, path: str = "", **kwargs: Any) -> httpx.Response:
        remaining = self.deadline - monotonic()
        if remaining <= 0:
            raise TraceExportError("export_deadline_exceeded", retryable=True)
        headers = {**self.headers, **kwargs.pop("headers", {})}
        try:
            with (
                ssrf_proxy.create_http_client(ssl_context=self.ssl_context)
                if self.ssl_context is not None
                else ssrf_proxy.create_http_client()
            ) as http_client:
                response = ssrf_proxy.make_request(
                    method,
                    f"{self.endpoint}/{path.lstrip('/')}" if path else self.endpoint,
                    headers=headers,
                    max_retries=0,
                    timeout=min(30.0, remaining),
                    follow_redirects=False,
                    **kwargs,
                    http_client=http_client,
                )
        except httpx.RequestError:
            raise TraceExportError("provider_unreachable", retryable=True) from None
        if not 200 <= response.status_code < 300:
            retry_after = response.headers.get("retry-after", "")
            raise TraceExportError(
                f"provider_http_{response.status_code}",
                retryable=response.status_code in {408, 429} or response.status_code >= 500,
                retry_after=min(int(retry_after), 3600) if retry_after.isdecimal() else None,
            )
        return response


def basic_auth(username: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def provider_uuid(identifier: str) -> str:
    try:
        return str(UUID(identifier))
    except ValueError:
        return str(uuid5(NAMESPACE_URL, f"dify:ops:{identifier}"))


def export_span_id(completed_trace: CompletedTrace, span_id: str) -> str:
    """Separate app views of the same execution while keeping retries stable."""
    source = completed_trace.source
    return str(uuid5(NAMESPACE_URL, f"{source.tenant_id}/{source.operation_id}/{span_id}"))


def span_id_bytes(identifier: str) -> bytes:
    return UUID(provider_uuid(identifier)).bytes[:8]


def timestamp_ns(value: datetime | None) -> int:
    # Zero is the OTLP unknown timestamp; never replace missing execution time with export time.
    return int(value.timestamp() * 1_000_000_000) if value is not None else 0


def span_attributes(completed_trace: CompletedTrace, span: TraceSpan) -> dict[str, JsonValue]:
    """Return captured Dify data; each destination owns its semantic conventions."""
    attributes = dict(span.attributes)
    attributes.update(
        {
            "dify.tenant_id": completed_trace.source.tenant_id,
            "dify.app_id": span.source_app_id or completed_trace.source.app_id,
            "dify.pipeline_id": span.source_pipeline_id or completed_trace.source.pipeline_id,
            "dify.workflow.id": span.source_workflow_id,
            "dify.workflow.version": span.source_workflow_version,
            "dify.workflow.run_id": completed_trace.source.workflow_run_id,
            "dify.node.execution_id": span.node_execution_id,
            "dify.node.id": span.node_id,
            "dify.node.attempt": span.attempt,
            "dify.span.id": span.span_id,
            "dify.span.name": span.span_name,
            "dify.span.type": span.span_type,
            "dify.span.status": span.status,
            "dify.trace.complete": completed_trace.complete,
            "dify.trace.truncation": completed_trace.truncation,
            "dify.trace.links": cast(list[JsonValue], list(completed_trace.links)),
            "dify.external_trace_id": completed_trace.source.external_trace_id,
            "dify.session.id": completed_trace.source.session_id or completed_trace.source.conversation_id,
            "dify.user.id": completed_trace.source.actor_id,
            "dify.message.id": completed_trace.source.message_id,
            "dify.conversation.id": completed_trace.source.conversation_id,
            "dify.inputs": span.inputs,
            "dify.outputs": span.outputs,
            "dify.usage": span.usage,
            "dify.events": cast(list[JsonValue], list(span.events)),
        }
    )
    if span.error:
        attributes["error.message"] = span.error
    return {key: value for key, value in attributes.items() if value is not None}


def create_provider_client(provider_name: str, provider_config: dict[str, Any]) -> Any:
    """Import only the installed package selected by this export's validated route."""
    match provider_name:
        case "langfuse":
            from dify_trace_langfuse.langfuse_trace import LangfuseTraceClient

            return LangfuseTraceClient(provider_config)
        case "langsmith":
            from dify_trace_langsmith.langsmith_trace import LangSmithTraceClient

            return LangSmithTraceClient(provider_config)
        case "opik":
            from dify_trace_opik.opik_trace import OpikTraceClient

            return OpikTraceClient(provider_config)
        case "weave":
            from dify_trace_weave.weave_trace import WeaveTraceClient

            return WeaveTraceClient(provider_config)
        case "arize" | "phoenix":
            from dify_trace_arize_phoenix.arize_phoenix_trace import create_trace_client

            return create_trace_client(provider_name, provider_config)
        case "aliyun":
            from dify_trace_aliyun.aliyun_trace import create_trace_client as create_aliyun_trace_client

            return create_aliyun_trace_client(provider_config)
        case "tencent":
            from dify_trace_tencent.tencent_trace import create_trace_client as create_tencent_trace_client

            return create_tencent_trace_client(provider_config)
        case "mlflow" | "databricks":
            from dify_trace_mlflow.mlflow_trace import MLflowTraceClient

            return MLflowTraceClient(provider_name, provider_config)
        case "enterprise":
            from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient

            return EnterpriseTraceClient(provider_config)
        case _:
            raise ValueError("Unsupported tracing provider")


def export_trace(
    completed_trace: CompletedTrace,
    provider_settings: TraceProviderSettings,
    provider_config: dict[str, Any],
    parent_span: dict[str, JsonValue] | None = None,
    *,
    export_state: "TraceExportState | None" = None,
) -> ExportedParentSpans:
    if completed_trace.source.tenant_id != provider_settings.tenant_id:
        raise TraceExportError("trace_tenant_mismatch")
    if (
        provider_settings.destination_type == "app_provider"
        and completed_trace.source.app_id != provider_settings.app_id
    ):
        raise TraceExportError("trace_app_mismatch")
    receipt_owner = provider_settings.model_dump(mode="json")
    if parent_span is not None and any(parent_span.get(key) != value for key, value in receipt_owner.items()):
        raise TraceExportError("trace_parent_destination_mismatch")
    if export_state is not None:
        export_state.validate_owner(completed_trace, provider_settings)
    client = create_provider_client(provider_settings.provider_name, provider_config)
    client.export_state = export_state
    exported_parents = client.export_trace(completed_trace, parent_span)
    return ExportedParentSpans(
        spans={span_id: {**receipt, **receipt_owner} for span_id, receipt in exported_parents.spans.items()}
    )
