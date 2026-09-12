"""Operation-owned MLflow/Databricks HTTP clients with explicitly captured deployment TLS."""

import base64
import json
from collections.abc import Mapping
from functools import partial
from ssl import SSLContext
from time import monotonic
from typing import TYPE_CHECKING, Any, override
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from uuid import UUID

import httpx
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, InstrumentationScope, KeyValue
from opentelemetry.proto.trace.v1.trace_pb2 import ResourceSpans, ScopeSpans, Span, Status
from pydantic import JsonValue
from requests.auth import _basic_auth_str
from requests.structures import CaseInsensitiveDict
from requests.utils import get_auth_from_url

from core.helper.ssl_context import create_ssl_context
from core.ops.otlp_trace import (
    OtlpTraceClient,
    limit_span_attributes,
    limit_span_events,
    otlp_attributes,
    otlp_span,
    otlp_value,
)
from core.ops.provider_export import (
    TraceExportError,
    TraceProviderHttpClient,
    basic_auth,
    export_span_id,
    json_text,
    provider_uuid,
    span_attributes,
    span_id_bytes,
    timestamp_ns,
)
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig
from dify_trace_mlflow.deployment_auth import sign_aws_request
from dify_trace_mlflow.otlp_export import MLflowOtlpClient
from dify_trace_mlflow.request_auth import load_request_auth_provider, send_authenticated_request
from dify_trace_mlflow.request_headers import MLflowRequestHeaders

if TYPE_CHECKING:
    from core.ops.trace_export_state import TraceExportState


def _prepare_timed_spans(completed_trace: CompletedTrace) -> tuple[TraceSpan, ...]:
    """Anchor untimed details to captured times; MLflow treats OTLP zero as the Unix epoch."""
    spans: dict[str, TraceSpan] = {}
    for span in completed_trace.spans:
        if span.started_at is None or span.ended_at is None:
            parent = spans.get(span.parent_span_id or "")
            anchor = span.started_at or span.ended_at or (parent.started_at if parent else None)
            if anchor is None:
                raise TraceExportError("mlflow_span_time_missing")
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
            raise TraceExportError("mlflow_span_time_invalid")
        spans[span.span_id] = span
    return tuple(spans.values())


class MLflowHttpClient(TraceProviderHttpClient):
    def __init__(
        self,
        endpoint: str,
        headers: dict[str, str],
        *,
        ssl_context: SSLContext | None,
        aws_sigv4: dict[str, Any] | None,
        request_auth_provider: Any = None,
        request_headers: MLflowRequestHeaders | None = None,
        default_authorization: bool = False,
        netrc_auth: Mapping[str, list[str] | tuple[str, str]] | None = None,
        url_auth: tuple[str, str] | None = None,
        use_implicit_auth: bool = True,
        request_timeout: float = 120,
    ):
        parsed = urlsplit(endpoint)
        self.url_auth = get_auth_from_url(endpoint) if url_auth is None else url_auth
        self.netrc_auth = {host: (auth[0], auth[1]) for host, auth in (netrc_auth or {}).items()}
        self.use_implicit_auth = use_implicit_auth
        auth = self.netrc_auth.get(parsed.hostname or "", self.netrc_auth.get("default"))
        if not auth or not any(auth):
            auth = self.url_auth
        self.implicit_auth = auth if use_implicit_auth and any(auth) else None
        endpoint = urlunsplit(parsed._replace(netloc=parsed.netloc.rsplit("@", 1)[-1]))
        super().__init__(endpoint, headers, ssl_context=ssl_context, request_timeout=request_timeout)
        self.aws_sigv4 = dict(aws_sigv4) if aws_sigv4 is not None else None
        self.request_auth_provider = request_auth_provider
        self.request_headers = request_headers
        self.default_authorization = default_authorization

    @override
    def request(
        self, method: str, path: str = "", *, include_mlflow_headers: bool = True, **kwargs: Any
    ) -> httpx.Response:
        if not include_mlflow_headers:
            return super().request(method, path, **kwargs)
        headers = CaseInsensitiveDict(self.request_headers.resolve() if self.request_headers is not None else {})
        for key, value in self.headers.items():
            default_header = key.lower() == "x-mlflow-workspace" or (
                self.default_authorization and key.lower() == "authorization"
            )
            if not default_header or key not in headers:
                headers[key] = value
        headers.update(kwargs.get("headers", {}))
        for key in self.headers:
            # The base HTTP owner also merges its headers; keep each existing key's casing.
            headers[key] = headers.pop(key)
        kwargs["headers"] = dict(headers)
        if kwargs["headers"].get("Authorization") == "":
            raise TraceExportError("mlflow_credentials_missing")
        if self.aws_sigv4 is not None:
            kwargs["auth"] = partial(sign_aws_request, credentials=self.aws_sigv4)
        elif self.request_auth_provider is not None:
            return send_authenticated_request(
                self, self.request_auth_provider, method, path, fallback_auth=self.implicit_auth, **kwargs
            )
        elif self.implicit_auth:
            authenticated_headers = CaseInsensitiveDict(kwargs["headers"])
            authenticated_headers["Authorization"] = _basic_auth_str(*self.implicit_auth)
            kwargs["headers"] = dict(authenticated_headers)
        return super().request(method, path, **kwargs)


def _span_failed(span: TraceSpan) -> bool:
    return (
        span.status == "error"
        or (span.status == "handled_error" and span.span_type != "workflow")
        or (span.status == "cancelled" and bool(span.error))
    )


def _parse_trace_uuid(identifier: str) -> str:
    value = UUID(identifier.removeprefix("tr-"))
    if not value.int:
        raise ValueError("Trace ID cannot be zero")
    return str(value)


def _normalize_databricks_host(host: str) -> str:
    host = host.strip()
    parsed = urlsplit(host if "://" in host else "https://" + host)
    # Match the SDK's workspace host normalization, including saved bare hosts.
    return urlunsplit(parsed._replace(netloc=parsed.netloc.removesuffix(":443"), path=parsed.path.rstrip("/")))


def _normalize_messages(value: JsonValue) -> JsonValue:
    if isinstance(value, list):
        messages = [_normalize_messages(item) for item in value]
        tool_call_ids: list[str] = []
        for message in messages:
            if not isinstance(message, dict):
                continue
            if message.get("role") == "assistant" and isinstance(tool_calls := message.get("tool_calls"), list):
                tool_call_ids = [
                    call_id
                    for call in tool_calls
                    if isinstance(call, dict) and isinstance(call_id := call.get("id"), str) and call_id
                ]
            elif message.get("role") == "tool":
                if isinstance(call_id := message.get("tool_call_id"), str) and call_id:
                    if call_id in tool_call_ids:
                        tool_call_ids.remove(call_id)
                elif tool_call_ids:
                    message["tool_call_id"] = tool_call_ids.pop(0)
            elif message.get("role") in {"user", "system"}:
                tool_call_ids = []
        return messages
    if not isinstance(value, dict):
        return value
    message = dict(value)
    if "role" in message:
        if message["role"] == "human":
            message["role"] = "user"
        elif message["role"] == "ai":
            message["role"] = "assistant"
        if "text" in message and "content" not in message:
            message["content"] = message.pop("text")
    if "messages" in message:
        message["messages"] = _normalize_messages(message["messages"])
    return message


def _format_llm_io(span: TraceSpan) -> tuple[JsonValue, JsonValue]:
    inputs: JsonValue = _normalize_messages(span.inputs)
    if isinstance(inputs, list):
        inputs = {"messages": inputs}
    elif isinstance(inputs, str):
        inputs = {"messages": [{"role": "user", "content": inputs}]}
    elif isinstance(inputs, dict) and "role" in inputs:
        inputs = {"messages": [inputs]}
    outputs: JsonValue = _normalize_messages(span.outputs)
    if isinstance(outputs, (str, list)):
        outputs = {"choices": [{"index": 0, "message": {"role": "assistant", "content": outputs}}]}
    elif isinstance(outputs, dict) and "choices" not in outputs:
        if "text" in outputs:
            message: dict[str, JsonValue] = {"role": "assistant", "content": outputs["text"]}
            if "tool_calls" in outputs:
                message["tool_calls"] = outputs["tool_calls"]
            outputs = {
                "choices": [
                    {
                        "index": 0,
                        "message": message,
                        "finish_reason": outputs.get("finish_reason"),
                    }
                ]
            }
        elif "role" in outputs:
            outputs = {"choices": [{"index": 0, "message": outputs}]}
    return inputs, outputs


def _native_span_type(span: TraceSpan) -> str:
    operation_type = span.attributes.get("operation_type")
    if operation_type == "message":
        return "LLM"
    if operation_type == "suggested_question":
        return "TOOL"
    if operation_type == "generate_name":
        return "CHAIN"
    if span.node_execution_id and isinstance(node_type := span.attributes.get("node_type"), str):
        return {
            "llm": "LLM",
            "question-classifier": "LLM",
            "knowledge-retrieval": "RETRIEVER",
            "tool": "TOOL",
            "code": "TOOL",
            "http-request": "TOOL",
            "agent": "AGENT",
        }.get(node_type, "CHAIN")
    return {"llm": "LLM", "tool": "TOOL", "retrieval": "RETRIEVER", "agent": "AGENT"}.get(span.span_type, "CHAIN")


def _native_usage(completed_trace: CompletedTrace, span: TraceSpan) -> dict[str, JsonValue]:
    if _native_span_type(span) != "LLM":
        return {}
    root = completed_trace.spans[0]
    if root.attributes.get("operation_type") != "message":
        return span.usage
    if span.span_id == root.span_id:
        # Chatflow model calls are exported with the separately recorded workflow.
        return {} if completed_trace.source.workflow_run_id else span.usage
    if not span.attributes.get("metrics_from_parent") or completed_trace.source.workflow_run_id:
        return span.usage
    usage = dict(span.usage)
    # Saved message totals own the synthetic or legacy agent round usage. Keep
    # detailed costs only when the parent has no captured cost to aggregate.
    if any(isinstance(root.usage.get(key), int) for key in ("prompt_tokens", "completion_tokens", "total_tokens")):
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            usage.pop(key, None)
    cost_fields = ("prompt_price", "completion_price", "total_price", "input_cost", "output_cost", "total_cost")
    if any(root.usage.get(key) is not None for key in cost_fields):
        for key in cost_fields:
            usage.pop(key, None)
    return usage


def _read_span_attribute(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except ValueError:
        # Native MLflow returns the original JSON string when a length limit cuts it short.
        return value


def _read_event_attribute(value: AnyValue) -> JsonValue:
    match value.WhichOneof("value"):
        case "array_value":
            return [_read_event_attribute(item) for item in value.array_value.values]
        case "kvlist_value":
            return {item.key: _read_event_attribute(item.value) for item in value.kvlist_value.values}
        case "int_value":
            return value.int_value
        case "double_value":
            return value.double_value
        case "bool_value":
            return value.bool_value
        case _:
            return value.string_value


class MLflowTraceClient:
    def __init__(self, provider_name: str, provider_config: dict[str, Any]):
        self.provider_name = provider_name
        self.config = (DatabricksConfig if provider_name == "databricks" else MLflowConfig).model_validate(
            provider_config
        )
        runtime_settings = (
            provider_config["_runtime_settings"]
            if "_runtime_settings" in provider_config
            else self.config.load_runtime_settings(provider_config)
        )
        self.sampling_ratio = float(runtime_settings.get("sampling_ratio", 1.0))
        self.disabled = bool(runtime_settings.get("disabled", False))
        self.span_attribute_limits = dict(runtime_settings.get("span_attribute_limits", {}))
        self.event_limits = dict(runtime_settings.get("event_limits", {}))
        self._aws_sigv4 = dict(runtime_settings["aws_sigv4"]) if runtime_settings.get("aws_sigv4") else None
        self._request_auth_provider = load_request_auth_provider(runtime_settings.get("request_auth_provider"))
        self._request_headers = MLflowRequestHeaders(runtime_settings.get("request_headers", {}))
        self.export_state: TraceExportState | None = None
        if isinstance(self.config, DatabricksConfig):
            self._databricks_tls_settings = runtime_settings
            endpoint = _normalize_databricks_host(self.config.host)
            if urlsplit(endpoint).username or urlsplit(endpoint).password:
                raise ValueError("Databricks requires a host without embedded credentials")
            verify = runtime_settings.get("verify", True)
            self.http = MLflowHttpClient(
                endpoint,
                runtime_settings.get("headers", {}),
                ssl_context=create_ssl_context(runtime_settings.get("tls", {}) if verify else {}, verify=verify)
                if urlsplit(endpoint).scheme == "https"
                else create_ssl_context({}),
                aws_sigv4=None,
                request_headers=self._request_headers,
                use_implicit_auth=False,
                request_timeout=runtime_settings.get("request_timeout", 60),
            )
        else:
            self._artifact_tls = dict(runtime_settings.get("tls", {}))
            self._artifact_verify = runtime_settings.get("verify", True)
            self._artifact_tls_read_failed = runtime_settings.get("artifact_tls_read_failed", False)
            headers = {
                **runtime_settings.get("headers", {}),
                **(
                    {"Authorization": basic_auth(self.config.username, self.config.password)}
                    if self.config.username and self.config.password
                    else {}
                ),
            }
            if headers.get("Authorization") == "" and not self._request_headers.providers:
                raise TraceExportError("mlflow_credentials_missing")
            http_tracking = urlsplit(self.config.tracking_uri).scheme == "http"
            self.http = MLflowHttpClient(
                self.config.tracking_uri,
                headers,
                ssl_context=create_ssl_context(
                    {} if http_tracking else runtime_settings.get("tls", {}),
                    verify=True if http_tracking else runtime_settings.get("verify", True),
                ),
                aws_sigv4=self._aws_sigv4,
                request_auth_provider=self._request_auth_provider,
                request_headers=self._request_headers,
                default_authorization=runtime_settings.get("default_authorization", False)
                and not (self.config.username and self.config.password),
                netrc_auth=runtime_settings.get("netrc_auth"),
                use_implicit_auth=runtime_settings.get("use_implicit_auth", True),
                request_timeout=runtime_settings.get("request_timeout", 120),
            )
        otlp_settings = runtime_settings.get("otlp", {})
        self.otlp = MLflowOtlpClient(otlp_settings, self.get_project_url()) if otlp_settings else None
        self.dual_export = bool(otlp_settings.get("dual_export"))

    def _authenticate_databricks(self) -> None:
        if not isinstance(self.config, DatabricksConfig):
            return
        if self.config.client_id and self.config.client_secret:
            token = (
                self.http.request(
                    "POST",
                    "oidc/v1/token",
                    include_mlflow_headers=False,
                    headers={"Authorization": basic_auth(self.config.client_id, self.config.client_secret)},
                    data={"grant_type": "client_credentials", "scope": "all-apis"},
                )
                .json()
                .get("access_token")
            )
        elif self.config.personal_access_token:
            token = self.config.personal_access_token
        else:
            raise TraceExportError("databricks_credentials_missing")
        if not isinstance(token, str) or not token:
            raise TraceExportError("databricks_token_missing")
        self.http.headers["Authorization"] = f"Bearer {token}"

    def verify_credentials(self) -> bool:
        self._authenticate_databricks()
        self.http.request("GET", "api/2.0/mlflow/experiments/get", params={"experiment_id": self.config.experiment_id})
        return True

    def get_project_url(self) -> str:
        path_prefix = "ml" if isinstance(self.config, DatabricksConfig) else "#"
        return self.http.endpoint + f"/{path_prefix}/experiments/{quote(self.config.experiment_id, safe='')}/traces"

    def _attributes(self, completed_trace: CompletedTrace, span: TraceSpan, trace_id: str) -> dict[str, str]:
        attributes = span_attributes(completed_trace, span)
        native_span_type = _native_span_type(span)
        inputs, outputs = _format_llm_io(span) if native_span_type == "LLM" else (span.inputs, span.outputs)
        if span.node_execution_id and span.attributes.get("node_type") == "http-request":
            inputs = span.attributes.get("process_data") or inputs
        if span.span_type == "retrieval" and isinstance(outputs, dict):
            documents = outputs.get("result", outputs.get("documents"))
            if isinstance(documents, list):
                outputs = [
                    {
                        "page_content": document.get("page_content", document.get("content", "")),
                        "metadata": document.get("metadata", {}),
                    }
                    if isinstance(document, dict)
                    else document
                    for document in documents
                ]
        attributes.update(
            {
                "mlflow.traceRequestId": trace_id,
                "mlflow.spanType": native_span_type,
                "mlflow.spanInputs": inputs,
                "mlflow.spanOutputs": outputs,
                "user.id": completed_trace.source.actor_id,
                "session.id": completed_trace.source.session_id or completed_trace.source.conversation_id,
            }
        )
        if native_span_type == "LLM":
            usage = _native_usage(completed_trace, span)
            attributes.update(
                {
                    "mlflow.llm.model": span.attributes.get("model_name"),
                    "mlflow.llm.provider": span.attributes.get("model_provider"),
                    "mlflow.message.format": "openai",
                }
            )
            token_usage = {
                target: usage[source]
                for source, target in (
                    ("prompt_tokens", "input_tokens"),
                    ("completion_tokens", "output_tokens"),
                    ("total_tokens", "total_tokens"),
                )
                if usage.get(source) is not None
            }
            if token_usage:
                attributes["mlflow.chat.tokenUsage"] = token_usage
            costs: dict[str, JsonValue] = {
                target: float(str(cost))
                for source, target in (
                    ("prompt_price", "input_cost"),
                    ("completion_price", "output_cost"),
                    ("total_price", "total_cost"),
                )
                if (cost := usage.get(source, usage.get(target))) is not None
            }
            if costs:
                attributes["mlflow.llm.cost"] = costs
        if not self.span_attribute_limits:
            return {key: json_text(value) for key, value in attributes.items() if value is not None}
        # LiveSpan JSON-encodes values before the SDK applies SpanLimits. Preserve
        # its separators and bound that string once, before either wire projection.
        serialized = {
            key: json.dumps(value, ensure_ascii=False) for key, value in attributes.items() if value is not None
        }
        bounded = limit_span_attributes(Span(attributes=otlp_attributes(serialized)), **self.span_attribute_limits)
        return {attribute.key: attribute.value.string_value for attribute in bounded.attributes}

    def _build_otlp_span(
        self, completed_trace: CompletedTrace, span: TraceSpan, parent_span: dict[str, JsonValue] | None = None
    ) -> Span:
        exported_span = otlp_span(completed_trace, span, parent_span, attributes={})
        if _span_failed(span):
            exported_span.status.code = Status.STATUS_CODE_ERROR
            error = span.error
            event_name = "error"
            if span.node_execution_id:
                node_status = span.attributes.get("node_status") or (
                    "exception" if span.status == "handled_error" else "failed"
                )
                error = f"Node failed with status: {node_status}"
                event_name = "exception"
            elif span.span_type == "workflow":
                event_name = "exception"
            elif span.attributes.get("operation_type") not in {"message", "tool", "suggested_question"} and (
                span.span_type != "tool"
            ):
                error = None
            if error:
                exported_span.events.append(
                    Span.Event(
                        name=event_name,
                        time_unix_nano=timestamp_ns(span.ended_at),
                        attributes=otlp_attributes(
                            {
                                "exception.message": error,
                                "exception.type": "Error",
                                "exception.stacktrace": error,
                            }
                        ),
                    )
                )
        limit_span_events(exported_span, **self.event_limits)
        # Native MLflow omits OpenTelemetry's dropped counters in both serializations.
        exported_span.dropped_events_count = 0
        for event in exported_span.events:
            event.dropped_attributes_count = 0
        return exported_span

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        trace_id = provider_uuid(completed_trace.trace_id)
        if parent_span is None and (external_id := completed_trace.source.external_trace_id):
            try:
                trace_id = _parse_trace_uuid(external_id)
            except ValueError:
                pass
        disabled = self.disabled or (parent_span is not None and parent_span.get("disabled") is True)
        sampled = not disabled and (
            parent_span.get("sampled", True) is not False
            if parent_span is not None
            # Match the SDK's TraceIdRatioBased lower-64-bit comparison, including its rounding.
            else (UUID(trace_id).int & ((1 << 64) - 1)) < round(self.sampling_ratio * (1 << 64))
        )
        if not sampled:
            return ExportedParentSpans(
                spans={
                    span.span_id: {
                        "trace_id": str(parent_span["trace_id"]) if parent_span else trace_id,
                        "span_id": export_span_id(completed_trace, span.span_id),
                        "sampled": False,
                        **({"disabled": True} if disabled else {}),
                    }
                    for span in completed_trace.spans
                }
            )
        completed_trace = completed_trace.model_copy(update={"spans": _prepare_timed_spans(completed_trace)})
        if self.otlp is None:
            return self._export_native_trace(completed_trace, trace_id, parent_span)
        collector_parent = (
            {**parent_span, "trace_id": parent_span.get("otlp_trace_id", parent_span["trace_id"])}
            if parent_span
            else None
        )
        otlp_trace_id = _parse_trace_uuid(str(collector_parent["trace_id"])) if collector_parent else trace_id
        native_receipt = (
            self.export_state.completed_signal_receipt("mlflow_native")
            if self.dual_export and self.export_state
            else None
        )
        failures: list[Exception] = []
        if not (self.export_state and self.export_state.has_completed_signal("mlflow_otlp")):
            try:
                self._send_collector_trace(
                    completed_trace,
                    otlp_trace_id,
                    collector_parent,
                    reserve_native_time=self.dual_export and native_receipt is None,
                )
            except Exception as error:
                failures.append(error)
            else:
                if self.export_state:
                    self.export_state.complete_signal("mlflow_otlp")
        receipts = ExportedParentSpans(
            spans={
                span.span_id: {
                    "trace_id": otlp_trace_id,
                    "span_id": export_span_id(completed_trace, span.span_id),
                    "sampled": True,
                }
                for span in completed_trace.spans
            }
        )
        if self.dual_export:
            if native_receipt is not None:
                receipts = ExportedParentSpans(
                    spans={
                        span.span_id: {**native_receipt, "span_id": export_span_id(completed_trace, span.span_id)}
                        for span in completed_trace.spans
                    }
                )
            else:
                # Native processors are independent: a collector failure must not suppress native delivery.
                try:
                    receipts = self._export_native_trace(completed_trace, trace_id, parent_span)
                except Exception as error:
                    failures.append(error)
                else:
                    if self.export_state:
                        self.export_state.complete_signal("mlflow_native", receipts.spans[completed_trace.root_span_id])
            for receipt in receipts.spans.values():
                receipt["otlp_trace_id"] = otlp_trace_id
        if failures:
            # Retry unfinished transient failures even when the other destination permanently rejected this trace.
            raise next(
                (failure for failure in failures if isinstance(failure, TraceExportError) and failure.retryable),
                failures[0],
            )
        return receipts

    def _send_collector_trace(
        self,
        completed_trace: CompletedTrace,
        trace_id: str,
        parent_span: dict[str, JsonValue] | None,
        *,
        reserve_native_time: bool,
    ) -> None:
        assert self.otlp is not None
        spans = []
        for span in completed_trace.spans:
            exported_span = self._build_otlp_span(completed_trace, span, parent_span)
            exported_span.trace_id = UUID(trace_id).bytes
            # Collector export retains LiveSpan's JSON strings. Tracking-server span logging consumes decoded values.
            exported_span.attributes.extend(
                otlp_attributes(self._attributes(completed_trace, span, "tr-" + UUID(trace_id).hex))
            )
            if self.otlp.settings.get("genai_semconv"):
                from dify_trace_mlflow.genai import translate_span_to_genai

                exported_span = translate_span_to_genai(exported_span)
            spans.append(exported_span)
        self.otlp.http.deadline = self.http.deadline
        if reserve_native_time:
            # A stalled collector must leave time for the independent native branch.
            # Once native work is checkpointed, collector retries receive the full attempt deadline.
            self.otlp.http.deadline -= max(0, self.http.deadline - monotonic()) / 2
        self.otlp.send_traces(
            ExportTraceServiceRequest(
                resource_spans=[
                    ResourceSpans(
                        resource=self.otlp.resource,
                        scope_spans=[ScopeSpans(scope=InstrumentationScope(name="mlflow"), spans=spans)],
                    )
                ]
            )
        )

    def _export_native_trace(
        self, completed_trace: CompletedTrace, trace_id: str, parent_span: dict[str, JsonValue] | None
    ) -> ExportedParentSpans:
        own_trace_id = trace_id
        native_trace_id: str | None = None
        artifact_trace = self.provider_name == "databricks" or bool(parent_span and parent_span.get("artifact_trace"))
        if artifact_trace:
            self._authenticate_databricks()
            native_trace_id = self._export_artifact_trace(completed_trace, trace_id, parent_span)
        else:
            assert isinstance(self.http, MLflowHttpClient)
            trace_id = _parse_trace_uuid(str(parent_span["trace_id"])) if parent_span else trace_id
            spans = []
            for span in completed_trace.spans:
                exported_span = self._build_otlp_span(completed_trace, span, parent_span)
                exported_span.attributes.extend(
                    KeyValue(key=key, value=otlp_value(_read_span_attribute(value)) if value else AnyValue())
                    for key, value in self._attributes(completed_trace, span, "tr-" + UUID(trace_id).hex).items()
                )
                exported_span.trace_id = UUID(trace_id).bytes
                spans.append(exported_span)
            client = OtlpTraceClient(
                self.http.endpoint + "/v1/traces",
                {
                    **self.http.headers,
                    "x-mlflow-experiment-id": self.config.experiment_id,
                },
                {"service.name": "dify"},
                self.get_project_url(),
                ssl_context=self.http.ssl_context,
            )
            client.http = MLflowHttpClient(
                client.http.endpoint,
                client.http.headers,
                ssl_context=self.http.ssl_context,
                aws_sigv4=self._aws_sigv4,
                request_auth_provider=self._request_auth_provider,
                request_headers=self._request_headers,
                default_authorization=self.http.default_authorization,
                netrc_auth=self.http.netrc_auth,
                url_auth=self.http.url_auth,
                use_implicit_auth=self.http.use_implicit_auth,
                request_timeout=self.http.request_timeout,
            )
            client.http.deadline = self.http.deadline
            try:
                if parent_span is None:
                    self._register_trace_metadata(completed_trace, trace_id)
                client.send_traces(
                    ExportTraceServiceRequest(
                        resource_spans=[
                            ResourceSpans(
                                resource=client.resource,
                                scope_spans=[ScopeSpans(scope=InstrumentationScope(name="dify.ops"), spans=spans)],
                            )
                        ]
                    )
                )
            except TraceExportError as error:
                if str(error) not in {"provider_http_404", "provider_http_501"}:
                    raise
                # FileStore and older servers accept complete traces through the
                # metadata/artifact APIs instead of OTLP span logging.
                artifact_trace = True
                trace_id = own_trace_id
                native_trace_id = self._export_artifact_trace(completed_trace, trace_id, parent_span)
        if native_trace_id is not None:
            trace_id = _parse_trace_uuid(native_trace_id)
        return ExportedParentSpans(
            spans={
                span.span_id: {
                    "trace_id": trace_id,
                    "span_id": export_span_id(completed_trace, span.span_id),
                    "sampled": True,
                    **({"artifact_trace": True} if artifact_trace else {}),
                    **({"native_trace_id": native_trace_id} if native_trace_id is not None else {}),
                }
                for span in completed_trace.spans
            }
        )

    def _build_trace_info(self, completed_trace: CompletedTrace, trace_id: str) -> dict[str, Any]:
        root = completed_trace.spans[0]
        if root.started_at is None or root.ended_at is None:
            raise TraceExportError(f"{self.provider_name}_trace_time_missing")
        request_id = "tr-" + UUID(trace_id).hex
        metadata = {
            "dify.tenant_id": completed_trace.source.tenant_id,
            "dify.app_id": completed_trace.source.app_id or "",
            "dify.operation_id": completed_trace.source.operation_id,
        }
        if completed_trace.source.actor_id is not None:
            metadata["mlflow.trace.user"] = completed_trace.source.actor_id
        if session_id := completed_trace.source.session_id or completed_trace.source.conversation_id:
            metadata["mlflow.trace.session"] = session_id
        request_preview = json_text(root.inputs)
        response_preview = json_text(root.outputs)
        if self.span_attribute_limits:
            # Native trace previews are copied from the root's bounded span attributes.
            attributes = self._attributes(completed_trace, root, request_id)
            request_preview = attributes.get("mlflow.spanInputs", "")
            response_preview = attributes.get("mlflow.spanOutputs", "")
        return {
            "trace_id": request_id,
            "client_request_id": completed_trace.source.external_trace_id or completed_trace.source.operation_id,
            "trace_location": {
                "type": "MLFLOW_EXPERIMENT",
                "mlflow_experiment": {"experiment_id": self.config.experiment_id},
            },
            "request_time": root.started_at.isoformat(),
            "execution_duration": f"{(root.ended_at - root.started_at).total_seconds():.6f}s",
            "state": "ERROR" if _span_failed(root) else "OK",
            "request_preview": request_preview[:10000],
            "response_preview": response_preview[:10000],
            "trace_metadata": metadata,
            "tags": {"mlflow.traceName": root.span_name},
        }

    def _register_trace_metadata(self, completed_trace: CompletedTrace, trace_id: str) -> None:
        trace_info = self._build_trace_info(completed_trace, trace_id)
        if self._read_existing_trace(trace_info) is not None:
            return
        # Register identity before OTLP so a metadata failure cannot retry spans
        # already accepted by MLflow. OTLP itself aggregates native token usage.
        try:
            self.http.request("POST", "api/3.0/mlflow/traces", json={"trace": {"trace_info": trace_info}})
        except TraceExportError as error:
            if str(error) != "provider_http_409" or self._read_existing_trace(trace_info) is None:
                raise

    def _export_artifact_trace(
        self, completed_trace: CompletedTrace, trace_id: str, parent_span: dict[str, JsonValue] | None
    ) -> str:
        trace_info = self._build_trace_info(completed_trace, trace_id)
        request_id: str = trace_info["trace_id"]
        metadata = trace_info["trace_metadata"]
        # An experiment trace owns one immutable artifact. Late operations get a
        # linked trace: appending by rewriting the parent's artifact loses siblings.
        token_usage = {
            target: sum(
                count
                for span in completed_trace.spans
                if isinstance(count := _native_usage(completed_trace, span).get(source), int)
            )
            for source, target in (
                ("prompt_tokens", "input_tokens"),
                ("completion_tokens", "output_tokens"),
                ("total_tokens", "total_tokens"),
            )
        }
        if self.span_attribute_limits:
            # Client-side usage aggregation also reads the bounded native span values.
            token_usage = {}
            for span in completed_trace.spans:
                attributes = self._attributes(completed_trace, span, request_id)
                if isinstance(usage := _read_span_attribute(attributes.get("mlflow.chat.tokenUsage")), dict):
                    for key in ("input_tokens", "output_tokens", "total_tokens"):
                        if isinstance(count := usage.get(key), int):
                            token_usage[key] = token_usage.get(key, 0) + count
        if any(token_usage.values()):
            metadata["mlflow.trace.tokenUsage"] = json_text(token_usage)
        links = []
        if parent_span:
            linked_trace_id = str(
                parent_span.get("native_trace_id") or "tr-" + UUID(_parse_trace_uuid(str(parent_span["trace_id"]))).hex
            )
            linked_span_id = span_id_bytes(str(parent_span["span_id"])).hex()
            metadata.update(
                {
                    "dify.linked_trace_id": linked_trace_id,
                    "dify.linked_parent_span_id": linked_span_id,
                }
            )
            links.append(
                {"trace_id": linked_trace_id, "span_id": linked_span_id, "attributes": {"dify.relationship": "parent"}}
            )
        # FileStore does not reliably return 409 for a repeated create. Read its
        # deterministic record first so an upload retry cannot overwrite metadata.
        saved_trace_info = self._read_existing_trace(trace_info) if self.provider_name == "mlflow" else None
        if saved_trace_info is None or (
            "mlflow.trace.tokenUsage" in metadata
            and "mlflow.trace.tokenUsage" not in saved_trace_info.get("trace_metadata", {})
        ):
            try:
                created = self.http.request("POST", "api/3.0/mlflow/traces", json={"trace": {"trace_info": trace_info}})
                saved_trace_info = created.json().get("trace", {}).get("trace_info", {})
            except TraceExportError as error:
                if self.provider_name == "mlflow" and str(error) == "provider_http_404":
                    # The SDK also falls back to V2 on servers without StartTraceV3.
                    saved_trace_info = self._create_trace_v2(completed_trace, trace_info)
                elif str(error) == "provider_http_409":
                    saved_trace_info = self._read_existing_trace(trace_info)
                    if saved_trace_info is None:
                        raise
                else:
                    raise
        request_id = saved_trace_info.get("trace_id", request_id)
        trace_id = _parse_trace_uuid(request_id)
        spans = [
            {
                "trace_id": base64.b64encode(UUID(trace_id).bytes).decode(),
                "span_id": base64.b64encode(span_id_bytes(export_span_id(completed_trace, span.span_id))).decode(),
                "parent_span_id": base64.b64encode(
                    span_id_bytes(export_span_id(completed_trace, span.parent_span_id))
                ).decode()
                if span.parent_span_id
                else None,
                "name": span.span_name,
                "start_time_unix_nano": timestamp_ns(span.started_at),
                "end_time_unix_nano": timestamp_ns(span.ended_at),
                "attributes": self._attributes(completed_trace, span, request_id),
                "links": links if span.span_id == completed_trace.root_span_id else [],
                "events": [
                    {
                        "name": event.name,
                        "time_unix_nano": event.time_unix_nano,
                        "attributes": {entry.key: _read_event_attribute(entry.value) for entry in event.attributes},
                    }
                    for event in self._build_otlp_span(completed_trace, span).events
                ],
                "status": {
                    "code": "STATUS_CODE_ERROR" if _span_failed(span) else "STATUS_CODE_OK",
                    "message": span.error or "",
                },
            }
            for span in completed_trace.spans
        ]
        trace_json = json_text({"spans": spans}).encode()
        if self.provider_name == "mlflow":
            self._upload_mlflow_artifact(saved_trace_info.get("tags", {}).get("mlflow.artifactLocation"), trace_json)
        else:
            upload = self.http.request("GET", f"api/3.0/mlflow/traces/{request_id}/credentials-for-data-upload").json()[
                "credential_info"
            ]
            self._upload_spans(upload, trace_json)
        return request_id

    def _create_trace_v2(self, completed_trace: CompletedTrace, trace_info: dict[str, Any]) -> dict[str, Any]:
        # V2 allocates a server ID. Find the operation before creating so a retry
        # after a lost response or artifact upload reuses the same native trace.
        tags = {**trace_info["tags"], "dify.trace_id": trace_info["trace_id"]}
        metadata = {**trace_info["trace_metadata"], "dify.client_request_id": trace_info["client_request_id"]}
        fields = {
            "request_metadata": [{"key": key, "value": value} for key, value in metadata.items()],
            "tags": [{"key": key, "value": value} for key, value in tags.items()],
        }
        result = self.http.request(
            "GET",
            "api/2.0/mlflow/traces",
            params={
                "experiment_ids": [self.config.experiment_id],
                "filter": f"tags.`dify.trace_id` = '{trace_info['trace_id']}'",
                "max_results": 2,
            },
        ).json()
        existing = result.get("traces", [])
        if len(existing) > 1 or result.get("next_page_token"):
            raise TraceExportError("mlflow_trace_identity_ambiguous")
        saved = (
            existing[0]
            if existing
            else self.http.request(
                "POST",
                "api/2.0/mlflow/traces",
                json={
                    "experiment_id": self.config.experiment_id,
                    "timestamp_ms": str(timestamp_ns(completed_trace.spans[0].started_at) // 1_000_000),
                    **fields,
                },
            ).json()["trace_info"]
        )
        saved_metadata = {entry["key"]: entry["value"] for entry in saved.get("request_metadata", [])}
        saved_tags = {entry["key"]: entry["value"] for entry in saved.get("tags", [])}
        if (
            saved.get("experiment_id") != self.config.experiment_id
            or saved_tags.get("dify.trace_id") != tags["dify.trace_id"]
            or any(
                saved_metadata.get(key) != metadata[key]
                for key in ("dify.tenant_id", "dify.app_id", "dify.operation_id", "dify.client_request_id")
            )
        ):
            raise TraceExportError("mlflow_trace_identity_mismatch")
        request_id = saved.get("request_id")
        try:
            if not isinstance(request_id, str):
                raise ValueError("Missing native trace ID")
            _parse_trace_uuid(request_id)
        except ValueError as error:
            raise TraceExportError("mlflow_trace_id_invalid") from error
        self.http.request(
            "PATCH",
            f"api/2.0/mlflow/traces/{quote(request_id, safe='')}",
            json={
                "request_id": request_id,
                "timestamp_ms": str(timestamp_ns(completed_trace.spans[0].ended_at) // 1_000_000),
                "status": trace_info["state"],
                **fields,
            },
        )
        return {"trace_id": request_id, "tags": saved_tags}

    def _read_existing_trace(self, trace_info: dict[str, Any]) -> dict[str, Any] | None:
        try:
            existing = self.http.request("GET", f"api/3.0/mlflow/traces/{trace_info['trace_id']}").json()["trace"][
                "trace_info"
            ]
        except TraceExportError as error:
            if str(error) == "provider_http_404":
                return None
            raise
        if (
            existing.get("client_request_id") != trace_info["client_request_id"]
            or any(
                existing.get("trace_metadata", {}).get(key) != trace_info["trace_metadata"][key]
                for key in ("dify.operation_id", "dify.tenant_id", "dify.app_id")
            )
            or existing.get("trace_location", {}).get("mlflow_experiment", {}).get("experiment_id")
            != self.config.experiment_id
        ):
            raise TraceExportError(f"{self.provider_name}_trace_identity_mismatch")
        return existing

    def _upload_mlflow_artifact(self, artifact_uri: str | None, trace_json: bytes) -> None:
        assert isinstance(self.config, MLflowConfig)
        assert isinstance(self.http, MLflowHttpClient)
        if not artifact_uri:
            raise TraceExportError("mlflow_artifact_location_missing")
        artifact = urlsplit(artifact_uri)
        tracking = urlsplit(self.config.tracking_uri)
        if artifact.scheme == "mlflow-artifacts":
            path = f"{tracking.path.rstrip('/')}/api/2.0/mlflow-artifacts/artifacts/{artifact.path.lstrip('/')}"
            artifact = artifact._replace(scheme=tracking.scheme, netloc=artifact.netloc or tracking.netloc, path=path)
        if artifact.scheme not in {"http", "https"}:
            # ponytail: HTTP-served artifacts only; direct stores need explicit destination credentials and bounds.
            raise TraceExportError("mlflow_artifact_requires_http")
        # MLflow's authenticated tracker authorizes this artifact destination.
        # Its HTTP artifact protocol uses the operation's MLflow credentials,
        # unlike Databricks signed uploads, which provide their own headers.
        same_origin = (
            artifact.scheme,
            artifact.hostname,
            artifact.port if artifact.port is not None else (443 if artifact.scheme == "https" else 80),
        ) == (
            tracking.scheme,
            tracking.hostname,
            tracking.port if tracking.port is not None else (443 if tracking.scheme == "https" else 80),
        )
        headers = (
            self.http.headers
            if same_origin
            else {
                key: value
                for key, value in self.http.headers.items()
                if key.lower() in {"authorization", "x-mlflow-workspace"}
            }
        )
        ssl_context = self.http.ssl_context if same_origin else None
        if not same_origin and artifact.scheme == "https":
            if self._artifact_tls_read_failed:
                raise ValueError("Cannot read TLS configuration")
            ssl_context = create_ssl_context(self._artifact_tls, verify=self._artifact_verify)
        client = MLflowHttpClient(
            urlunsplit(artifact._replace(path=artifact.path.rstrip("/") + "/traces.json")),
            headers,
            ssl_context=ssl_context,
            aws_sigv4=self._aws_sigv4,
            request_auth_provider=self._request_auth_provider,
            request_headers=self._request_headers,
            default_authorization=self.http.default_authorization,
            netrc_auth=self.http.netrc_auth,
            use_implicit_auth=self.http.use_implicit_auth,
            request_timeout=self.http.request_timeout,
        )
        client.deadline = self.http.deadline
        client.request("PUT", content=trace_json, headers={"Content-Type": "application/json"})

    def _upload_spans(self, upload: dict[str, Any], trace_json: bytes) -> None:
        signed_url = str(upload["signed_uri"])
        if urlsplit(signed_url).scheme != "https":
            raise TraceExportError("databricks_upload_requires_https")
        # These URLs are returned by the authenticated provider, never by trace
        # content. Use only their own signed headers; do not forward the API key.
        headers = {entry["name"]: entry["value"] for entry in upload.get("headers", [])}
        # Native signed uploads verify storage TLS independently of legacy workspace settings.
        ssl_context = self.http.ssl_context
        if urlsplit(self.http.endpoint).scheme == "http" or not self._databricks_tls_settings.get("verify", True):
            if self._databricks_tls_settings.get("tls_read_failed"):
                raise ValueError("Cannot read TLS configuration")
            ssl_context = create_ssl_context(self._databricks_tls_settings.get("tls", {}))
        # Native signed uploads have no per-request timeout; the export deadline
        # still bounds every storage request, independently of workspace settings.
        client = TraceProviderHttpClient(signed_url, headers, ssl_context=ssl_context, request_timeout=float("inf"))
        client.deadline = self.http.deadline
        if upload.get("type") in {"AZURE_ADLS_GEN2_SAS_URI", 4}:
            parsed = urlsplit(signed_url)

            def query_url(**parameters: Any) -> str:
                query = parsed.query + ("&" if parsed.query else "") + urlencode(parameters)
                return urlunsplit(parsed._replace(query=query))

            for method, parameters, content in (
                ("PUT", {"resource": "file"}, b""),
                ("PATCH", {"action": "append", "position": 0}, trace_json),
                ("PATCH", {"action": "flush", "position": len(trace_json)}, b""),
            ):
                client.endpoint = query_url(**parameters)
                client.request(method, content=content)
        else:
            if upload.get("type") in {"AZURE_SAS_URI", 1}:
                headers["x-ms-blob-type"] = "BlockBlob"
            client.request("PUT", content=trace_json, headers=headers)
