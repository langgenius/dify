"""Explicit MLflow/Databricks REST requests; no tracking setters or environment credentials."""

import base64
import json
from typing import Any
from urllib.parse import quote, urlencode, urlsplit, urlunsplit
from uuid import UUID

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import InstrumentationScope
from opentelemetry.proto.trace.v1.trace_pb2 import ResourceSpans, ScopeSpans
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient, otlp_attributes, otlp_span
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


class MLflowTraceClient:
    def __init__(self, provider_name: str, provider_config: dict[str, Any]):
        self.provider_name = provider_name
        self.config = (DatabricksConfig if provider_name == "databricks" else MLflowConfig).model_validate(
            provider_config
        )
        if isinstance(self.config, DatabricksConfig):
            self.http = TraceProviderHttpClient(self.config.host)
            token = self.config.personal_access_token
            if not token:
                if not self.config.client_id or not self.config.client_secret:
                    raise TraceExportError("databricks_credentials_missing")
                token = (
                    self.http.request(
                        "POST",
                        "oidc/v1/token",
                        headers={
                            "Authorization": basic_auth(self.config.client_id, self.config.client_secret),
                        },
                        data={"grant_type": "client_credentials", "scope": "all-apis"},
                    )
                    .json()
                    .get("access_token")
                )
            if not isinstance(token, str) or not token:
                raise TraceExportError("databricks_token_missing")
            self.http.headers["Authorization"] = f"Bearer {token}"
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

    def verify_credentials(self) -> bool:
        self.http.request("GET", "api/2.0/mlflow/experiments/get", params={"experiment_id": self.config.experiment_id})
        return True

    def get_project_url(self) -> str:
        return self.http.endpoint + f"/#/experiments/{quote(self.config.experiment_id, safe='')}"

    def _attributes(self, completed_trace: CompletedTrace, span: TraceSpan, trace_id: str) -> dict[str, str]:
        attributes = span_attributes(completed_trace, span)
        attributes.update(
            {
                "mlflow.traceRequestId": trace_id,
                "mlflow.spanType": {"llm": "LLM", "tool": "TOOL", "retrieval": "RETRIEVER", "agent": "AGENT"}.get(
                    span.span_type, "CHAIN"
                ),
                "mlflow.spanInputs": span.inputs,
                "mlflow.spanOutputs": span.outputs,
                "mlflow.chat.tokenUsage": {
                    "input_tokens": span.usage.get("prompt_tokens"),
                    "output_tokens": span.usage.get("completion_tokens"),
                    "total_tokens": span.usage.get("total_tokens"),
                },
            }
        )
        return {key: json_text(value) for key, value in attributes.items()}

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        trace_id = provider_uuid(completed_trace.trace_id)
        if self.provider_name == "databricks":
            self._export_databricks(completed_trace, trace_id, parent_span)
        else:
            trace_id = str(parent_span["trace_id"]) if parent_span else trace_id
            spans = []
            for span in completed_trace.spans:
                exported_span = otlp_span(completed_trace, span, parent_span)
                del exported_span.attributes[:]
                exported_span.attributes.extend(
                    otlp_attributes(
                        {
                            key: json.loads(value)
                            for key, value in self._attributes(
                                completed_trace, span, "tr-" + UUID(trace_id).hex
                            ).items()
                        }
                    )
                )
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
        }
        if parent_span:
            metadata.update(
                {
                    "dify.linked_trace_id": str(parent_span["trace_id"]),
                    "dify.linked_parent_span_id": str(parent_span["span_id"]),
                }
            )
        trace_info = {
            "trace_id": request_id,
            "client_request_id": completed_trace.source.operation_id,
            "trace_location": {
                "type": "MLFLOW_EXPERIMENT",
                "mlflow_experiment": {"experiment_id": self.config.experiment_id},
            },
            "request_time": root.started_at.isoformat(),
            "execution_duration": f"{(root.ended_at - root.started_at).total_seconds():.6f}s",
            "state": "ERROR" if root.status == "error" else "OK",
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
                existing.get("client_request_id") != completed_trace.source.operation_id
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
                "events": [
                    {
                        "name": event.name,
                        "time_unix_nano": event.time_unix_nano,
                        "attributes": {entry.key: entry.value.string_value for entry in event.attributes},
                    }
                    for event in otlp_span(completed_trace, span).events
                ],
                "status": {
                    "code": "STATUS_CODE_ERROR" if span.status == "error" else "STATUS_CODE_OK",
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
