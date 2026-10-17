"""MLflow SDK span serialization with per-export credentials and bounded HTTP.

OSS uses its OTLP experiment endpoint (MLflow >= 3.4). Databricks retains the
existing experiment destination through the SDK's V3 trace and artifact APIs;
its UC-only OTLP endpoint is not interchangeable with an experiment ID.
"""

import base64
from collections.abc import Mapping
from typing import Any, override
from urllib.parse import quote, urlsplit

from google.protobuf.json_format import ParseDict, ParseError
from mlflow.entities import Span, TraceData, TraceInfo, TraceLocation, TraceState
from mlflow.protos.databricks_artifacts_pb2 import (
    ArtifactCredentialType,
    DatabricksMlflowArtifactsService,
    GetCredentialsForTraceDataUpload,
)
from mlflow.store.tracking.rest_store import RestStore
from mlflow.tracing.constant import SpanAttributeKey, TraceMetadataKey, TraceTagKey
from mlflow.tracing.utils.otlp import MLFLOW_EXPERIMENT_ID_HEADER, OTLP_TRACES_PATH
from mlflow.utils.rest_utils import MlflowHostCreds, extract_api_info_for_service
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.trace import SpanContext, Status, StatusCode

from core.ops.unified_trace.entities import CanonicalSpanStatus, CanonicalTrace
from services.tracing.otlp_export import export_http
from services.tracing.provider_common import endpoint, json_value, nanos, request, required, token_usage, usd_cost
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportResult, TraceExportUncertainError


def _spans(trace: CanonicalTrace, experiment_id: str, request_id: str) -> list[Span]:
    result = []
    for span in trace.spans:
        attributes: dict[str, Any] = {
            **span.metadata,
            SpanAttributeKey.REQUEST_ID: request_id,
            SpanAttributeKey.EXPERIMENT_ID: experiment_id,
            SpanAttributeKey.SPAN_TYPE: span.kind.value.upper(),
            SpanAttributeKey.SESSION_ID: trace.session_id,
        }
        if span.inputs is not None:
            attributes[SpanAttributeKey.INPUTS] = span.inputs
        if span.outputs is not None:
            attributes[SpanAttributeKey.OUTPUTS] = span.outputs
        if usage := token_usage(span):
            attributes[SpanAttributeKey.CHAT_USAGE] = {f"{key}_tokens": value for key, value in usage.items()}
        if (cost := usd_cost(span)) is not None:
            attributes[SpanAttributeKey.LLM_COST] = {"total_cost": cost}
        if model := span.metadata.get("model_name") or span.metadata.get("model"):
            attributes[SpanAttributeKey.MODEL] = model
        context = SpanContext(trace_id=int(trace.trace_id, 16), span_id=int(span.id, 16), is_remote=False)
        parent = (
            SpanContext(trace_id=context.trace_id, span_id=int(span.parent_id, 16), is_remote=False)
            if span.parent_id
            else None
        )
        result.append(
            Span(
                ReadableSpan(
                    name=span.name,
                    context=context,
                    parent=parent,
                    start_time=nanos(span.start_time),
                    end_time=nanos(span.end_time) if span.end_time else None,
                    attributes={key: json_value(value) for key, value in attributes.items()},
                    status=Status(StatusCode.ERROR, span.error)
                    if span.status == CanonicalSpanStatus.ERROR
                    else Status(StatusCode.OK),
                    resource=Resource.get_empty(),
                )
            )
        )
    return result


def _auth(provider: str, config: Mapping[str, Any], host: str) -> dict[str, str]:
    if provider == "mlflow":
        if config.get("username") and config.get("password"):
            token = base64.b64encode(f"{config['username']}:{config['password']}".encode()).decode()
            return {"Authorization": f"Basic {token}"}
        return {}
    if config.get("client_id") and config.get("client_secret"):
        response = request(
            "POST",
            host + "/oidc/v1/token",
            provider,
            auth=(config["client_id"], config["client_secret"]),
            data={"grant_type": "client_credentials", "scope": "all-apis"},
        )
        token = response.json().get("access_token")
        if not isinstance(token, str) or not token:
            raise TraceExportRejectedError("Databricks OAuth token was not returned")
    else:
        token = required(config, "personal_access_token")
    return {"Authorization": f"Bearer {token}"}


class _Store(RestStore):
    """Reuse native V3 request/response schemas without process-wide SDK credentials."""

    def __init__(self, host: str, headers: dict[str, str]) -> None:
        super().__init__(lambda: MlflowHostCreds(host))
        self._host = host
        self._headers = headers

    @override
    def _call_endpoint(self, api, json_body=None, endpoint=None, retry_timeout_seconds=None, response_proto=None):
        methods = self._V3_METHOD_TO_INFO if api in self._V3_APIS else self._METHOD_TO_INFO
        default_endpoint, method = methods[api]
        response = request(
            method,
            self._host + (endpoint or default_endpoint),
            "databricks",
            headers={"Content-Type": "application/json", **self._headers},
            content=json_body,
        )
        try:
            return ParseDict(response.json(), response_proto if response_proto is not None else api.Response())
        except (ValueError, ParseError):
            raise TraceExportUncertainError("Databricks returned an unreadable trace acknowledgment") from None


def _upload_databricks(host: str, headers: dict[str, str], trace_id: str, payload: bytes) -> None:
    path, method = extract_api_info_for_service(DatabricksMlflowArtifactsService, "/api/2.0")[
        GetCredentialsForTraceDataUpload
    ]
    response = request(
        method, host + path.replace("{request_id}", quote(trace_id, safe="")), "databricks", headers=headers
    )
    credential = ParseDict(response.json(), GetCredentialsForTraceDataUpload.Response()).credential_info
    signed_url = credential.signed_uri
    parsed = urlsplit(signed_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise TraceExportRejectedError("Invalid Databricks artifact upload destination")
    upload_headers = {header.name: header.value for header in credential.headers}
    if credential.type == ArtifactCredentialType.AZURE_ADLS_GEN2_SAS_URI:
        # The bounded trace payload fits a single append. Flush commits that append.
        separator = "&" if parsed.query else "?"
        create_headers = {key: value for key, value in upload_headers.items() if key.lower() != "x-ms-blob-type"}
        request("PUT", signed_url + separator + "resource=file", "databricks", headers=create_headers)
        request(
            "PATCH",
            signed_url + separator + "action=append&position=0&flush=true",
            "databricks",
            headers=create_headers,
            content=payload,
        )
    elif credential.type in {
        ArtifactCredentialType.AWS_PRESIGNED_URL,
        ArtifactCredentialType.GCP_SIGNED_URL,
        ArtifactCredentialType.AZURE_SAS_URI,
    }:
        if credential.type == ArtifactCredentialType.AZURE_SAS_URI:
            upload_headers["x-ms-blob-type"] = "BlockBlob"
        request("PUT", signed_url, "databricks", headers=upload_headers, content=payload)
    else:
        raise TraceExportRejectedError("Unsupported Databricks artifact credential type")


def export_trace(provider: str, config: Mapping[str, Any], trace: CanonicalTrace) -> TraceExportResult:
    host = endpoint(required(config, "host" if provider == "databricks" else "tracking_uri"))
    experiment = str(config.get("experiment_id") or "0")
    if not experiment.isdigit():
        raise TraceExportRejectedError("MLflow experiment ID must be numeric")
    headers = _auth(provider, config, host)
    trace_id = "tr-" + trace.trace_id
    spans = _spans(trace, experiment, trace_id)
    if provider == "mlflow":
        payload = ExportTraceServiceRequest()
        scope = payload.resource_spans.add().scope_spans.add()
        scope.spans.extend(span.to_otel_proto() for span in spans)
        export_http(provider, host + OTLP_TRACES_PATH, {MLFLOW_EXPERIMENT_ID_HEADER: experiment, **headers}, payload)
        url = f"{host}/#/experiments/{experiment}/traces?selectedTraceId={quote(trace_id, safe='')}"
    else:
        root = next(span for span in trace.spans if span.id == trace.root_span_id)
        metadata = {TraceMetadataKey.TRACE_SESSION: trace.session_id}
        usages = [token_usage(span) for span in trace.spans]
        if any(usages):
            metadata[TraceMetadataKey.TOKEN_USAGE] = json_value(
                {f"{key}_tokens": sum(usage.get(key, 0) for usage in usages) for key in ("input", "output", "total")}
            )
        costs = [cost for span in trace.spans if (cost := usd_cost(span)) is not None]
        if costs:
            metadata[TraceMetadataKey.COST] = json_value({"total_cost": sum(costs)})
        info = TraceInfo(
            trace_id=trace_id,
            trace_location=TraceLocation.from_experiment_id(experiment),
            request_time=nanos(root.start_time) // 1_000_000,
            execution_duration=(nanos(root.end_time) - nanos(root.start_time)) // 1_000_000 if root.end_time else None,
            state=TraceState.ERROR if root.status == CanonicalSpanStatus.ERROR else TraceState.OK,
            request_preview=json_value(root.inputs)[:10000] if root.inputs is not None else None,
            response_preview=json_value(root.outputs)[:10000] if root.outputs is not None else None,
            trace_metadata=metadata,
            tags={TraceTagKey.TRACE_NAME: root.name},
            client_request_id=trace.trace_id,
        )
        stored = _Store(host, headers).start_trace(info)
        try:
            trace_id = stored.trace_id
            if not trace_id:
                raise TraceExportUncertainError("Databricks did not acknowledge a trace identifier")
            data = TraceData(spans=_spans(trace, experiment, trace_id))
            _upload_databricks(host, headers, trace_id, json_value(data.to_dict()).encode())
        except Exception:
            raise TraceExportUncertainError(
                "Databricks accepted trace metadata but artifact delivery is incomplete"
            ) from None
        # Databricks opens its trace detail panel with a different key from OSS MLflow.
        url = f"{host}/ml/experiments/{experiment}/traces?selectedEvaluationId={quote(trace_id, safe='')}"
    return TraceExportResult(trace_id=trace_id, trace_url=url)
