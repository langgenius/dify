"""Explicit MLflow/Databricks REST requests; no tracking setters or environment credentials."""

import base64
import json
from typing import Any
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from uuid import UUID

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import InstrumentationScope
from opentelemetry.proto.trace.v1.trace_pb2 import ResourceSpans, ScopeSpans, Status
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient, otlp_span
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


def _normalize_messages(value: JsonValue) -> JsonValue:
    if isinstance(value, list):
        return [_normalize_messages(item) for item in value]
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


class MLflowTraceClient:
    def __init__(self, provider_name: str, provider_config: dict[str, Any]):
        self.provider_name = provider_name
        self.config = (DatabricksConfig if provider_name == "databricks" else MLflowConfig).model_validate(
            provider_config
        )
        if isinstance(self.config, DatabricksConfig):
            self.http = TraceProviderHttpClient(self.config.host)
        else:
            self.http = TraceProviderHttpClient(
                self.config.tracking_uri,
                {
                    **(
                        {"Authorization": basic_auth(self.config.username, self.config.password or "")}
                        if self.config.username
                        else {}
                    ),
                },
            )

    def _authenticate_databricks(self) -> None:
        if not isinstance(self.config, DatabricksConfig):
            return
        if self.config.client_id and self.config.client_secret:
            token = (
                self.http.request(
                    "POST",
                    "oidc/v1/token",
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
        inputs, outputs = _format_llm_io(span) if span.span_type == "llm" else (span.inputs, span.outputs)
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
                "mlflow.spanType": {"llm": "LLM", "tool": "TOOL", "retrieval": "RETRIEVER", "agent": "AGENT"}.get(
                    span.span_type, "CHAIN"
                ),
                "mlflow.spanInputs": inputs,
                "mlflow.spanOutputs": outputs,
                "user.id": completed_trace.source.actor_id,
                "session.id": completed_trace.source.session_id or completed_trace.source.conversation_id,
                "mlflow.chat.tokenUsage": {
                    "input_tokens": span.usage.get("prompt_tokens"),
                    "output_tokens": span.usage.get("completion_tokens"),
                    "total_tokens": span.usage.get("total_tokens"),
                },
            }
        )
        if span.span_type == "llm":
            attributes.update(
                {
                    "mlflow.llm.model": span.attributes.get("model_name"),
                    "mlflow.llm.provider": span.attributes.get("model_provider"),
                    "mlflow.message.format": "openai",
                }
            )
            costs: dict[str, JsonValue] = {
                target: float(str(cost))
                for source, target in (
                    ("prompt_price", "input_cost"),
                    ("completion_price", "output_cost"),
                    ("total_price", "total_cost"),
                )
                if (cost := span.usage.get(source, span.usage.get(target))) is not None
            }
            if costs:
                attributes["mlflow.llm.cost"] = costs
        return {key: json_text(value) for key, value in attributes.items() if value is not None}

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        trace_id = provider_uuid(completed_trace.trace_id)
        if parent_span is None and (external_id := completed_trace.source.external_trace_id):
            try:
                trace_id = _parse_trace_uuid(external_id)
            except ValueError:
                pass
        if self.provider_name == "databricks":
            self._authenticate_databricks()
            self._export_databricks(completed_trace, trace_id, parent_span)
        else:
            trace_id = _parse_trace_uuid(str(parent_span["trace_id"])) if parent_span else trace_id
            spans = []
            for span in completed_trace.spans:
                exported_span = otlp_span(
                    completed_trace,
                    span,
                    parent_span,
                    attributes={
                        key: json.loads(value)
                        for key, value in self._attributes(completed_trace, span, "tr-" + UUID(trace_id).hex).items()
                    },
                )
                exported_span.trace_id = UUID(trace_id).bytes
                if _span_failed(span):
                    exported_span.status.code = Status.STATUS_CODE_ERROR
                spans.append(exported_span)
            client = OtlpTraceClient(
                self.http.endpoint + "/v1/traces",
                {
                    **self.http.headers,
                    "x-mlflow-experiment-id": self.config.experiment_id,
                },
                {"service.name": "dify"},
                self.get_project_url(),
            )
            client.http.deadline = self.http.deadline
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
        return ExportedParentSpans(
            spans={
                span.span_id: {"trace_id": trace_id, "span_id": export_span_id(completed_trace, span.span_id)}
                for span in completed_trace.spans
            }
        )

    def _export_databricks(
        self, completed_trace: CompletedTrace, trace_id: str, parent_span: dict[str, JsonValue] | None
    ) -> None:
        root = completed_trace.spans[0]
        if root.started_at is None or root.ended_at is None:
            raise TraceExportError("databricks_trace_time_missing")
        request_id = "tr-" + UUID(trace_id).hex
        # An experiment trace owns one immutable artifact. Late operations get a
        # linked trace: appending by rewriting the parent's artifact loses siblings.
        metadata = {
            "dify.tenant_id": completed_trace.source.tenant_id,
            "dify.app_id": completed_trace.source.app_id or "",
            "dify.operation_id": completed_trace.source.operation_id,
        }
        if completed_trace.source.actor_id is not None:
            metadata["mlflow.trace.user"] = completed_trace.source.actor_id
        if session_id := completed_trace.source.session_id or completed_trace.source.conversation_id:
            metadata["mlflow.trace.session"] = session_id
        links = []
        if parent_span:
            linked_trace_id = "tr-" + UUID(_parse_trace_uuid(str(parent_span["trace_id"]))).hex
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
        trace_info = {
            "trace_id": request_id,
            "client_request_id": completed_trace.source.external_trace_id or completed_trace.source.operation_id,
            "trace_location": {
                "type": "MLFLOW_EXPERIMENT",
                "mlflow_experiment": {"experiment_id": self.config.experiment_id},
            },
            "request_time": root.started_at.isoformat(),
            "execution_duration": f"{(root.ended_at - root.started_at).total_seconds():.6f}s",
            "state": "ERROR" if _span_failed(root) else "OK",
            "request_preview": json_text(root.inputs)[:10000],
            "response_preview": json_text(root.outputs)[:10000],
            "trace_metadata": metadata,
            "tags": {"mlflow.traceName": root.span_name},
        }
        try:
            self.http.request("POST", "api/3.0/mlflow/traces", json={"trace": {"trace_info": trace_info}})
        except TraceExportError as error:
            if str(error) != "provider_http_409":
                raise
            # A previous attempt may have created the metadata before its upload
            # failed. Verify identity before reusing this deterministic record.
            existing = self.http.request("GET", f"api/3.0/mlflow/traces/{request_id}").json()["trace"]["trace_info"]
            if (
                existing.get("client_request_id") != trace_info["client_request_id"]
                or existing.get("trace_metadata", {}).get("dify.operation_id") != completed_trace.source.operation_id
                or existing.get("trace_metadata", {}).get("dify.tenant_id") != completed_trace.source.tenant_id
                or existing.get("trace_metadata", {}).get("dify.app_id") != completed_trace.source.app_id
                or existing.get("trace_location", {}).get("mlflow_experiment", {}).get("experiment_id")
                != self.config.experiment_id
            ):
                raise TraceExportError("databricks_trace_identity_mismatch") from error
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
                        "attributes": {entry.key: entry.value.string_value for entry in event.attributes},
                    }
                    for event in otlp_span(completed_trace, span).events
                ],
                "status": {
                    "code": "STATUS_CODE_ERROR" if _span_failed(span) else "STATUS_CODE_OK",
                    "message": span.error or "",
                },
            }
            for span in completed_trace.spans
        ]
        upload = self.http.request("GET", f"api/3.0/mlflow/traces/{request_id}/credentials-for-data-upload").json()[
            "credential_info"
        ]
        self._upload_spans(upload, json_text({"spans": spans}).encode())

    def _upload_spans(self, upload: dict[str, Any], trace_json: bytes) -> None:
        signed_url = str(upload["signed_uri"])
        if urlsplit(signed_url).scheme != "https":
            raise TraceExportError("databricks_upload_requires_https")
        # These URLs are returned by the authenticated provider, never by trace
        # content. Use only their own signed headers; do not forward the API key.
        headers = {entry["name"]: entry["value"] for entry in upload.get("headers", [])}
        client = TraceProviderHttpClient(signed_url, headers)
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
