"""Databricks experiment traces: the SDK's V3 trace API and trace artifact, sent through the egress."""

from collections.abc import Mapping
from typing import Any, NoReturn, override
from urllib.parse import quote, urlsplit

from dify_trace_sdk.egress import Egress
from dify_trace_sdk.errors import ExportOutcomeUnknownError, ExportRejectedError
from dify_trace_sdk.exporting import json_value, nanos, send_export_request
from dify_trace_sdk.model import SpanStatus, Trace
from google.protobuf.json_format import ParseDict, ParseError
from google.protobuf.message import Message
from mlflow.entities import TraceInfo, TraceLocation, TraceState
from mlflow.protos.databricks_artifacts_pb2 import (
    ArtifactCredentialType,
    DatabricksMlflowArtifactsService,
    GetCredentialsForTraceDataUpload,
)
from mlflow.store.tracking.rest_store import RestStore
from mlflow.tracing.constant import (
    TRACE_REQUEST_RESPONSE_PREVIEW_MAX_LENGTH_DBX,
    CostKey,
    TokenUsageKey,
    TraceMetadataKey,
    TraceTagKey,
)
from mlflow.utils.rest_utils import extract_api_info_for_service

from dify_trace_mlflow._spans import token_usage, usd_cost

_DESTINATION = "Databricks"
_SIGNED_URL_CREDENTIALS = {
    ArtifactCredentialType.AWS_PRESIGNED_URL,
    ArtifactCredentialType.GCP_SIGNED_URL,
    ArtifactCredentialType.AZURE_SAS_URI,
}


def _no_sdk_transport() -> NoReturn:
    raise ExportRejectedError("The MLflow SDK must not open its own Databricks connection")


class DatabricksStore(RestStore):
    """The SDK's V3 ``start_trace`` with its request sent through the egress.

    Only ``start_trace``, a POST, is used. The SDK never receives host
    credentials, so any request that bypassed ``_call_endpoint`` would fail
    instead of resolving credentials from the process. The SDK's retry timeout
    is ignored: each call is one request, and the trace pipeline owns retries.
    """

    def __init__(self, egress: Egress, host: str, headers: Mapping[str, str]) -> None:
        super().__init__(_no_sdk_transport)
        self._egress = egress
        self._host = host
        self._headers = headers

    @override
    def _call_endpoint(
        self,
        api: Any,
        json_body: str | None = None,
        endpoint: str | None = None,
        retry_timeout_seconds: int | None = None,
        response_proto: Message | None = None,
    ) -> Message:
        methods = self._V3_METHOD_TO_INFO if api in self._V3_APIS else self._METHOD_TO_INFO
        default_endpoint, method = methods[api]
        response = send_export_request(
            self._egress,
            method,
            self._host + (endpoint or default_endpoint),
            destination=_DESTINATION,
            headers={"Content-Type": "application/json", "Accept": "application/json", **self._headers},
            content=None if json_body is None else json_body.encode(),
            sensitive_url=False,
        )
        try:
            body = response.json()
            if not isinstance(body, dict):
                raise ValueError("acknowledgment is not an object")
            return ParseDict(
                body, response_proto if response_proto is not None else api.Response(), ignore_unknown_fields=True
            )
        except (ParseError, TypeError, ValueError):
            raise ExportOutcomeUnknownError("Databricks returned an unreadable trace acknowledgment") from None


def _preview(value: object) -> str | None:
    return None if value is None else json_value(value)[:TRACE_REQUEST_RESPONSE_PREVIEW_MAX_LENGTH_DBX]


def trace_info(trace: Trace, experiment_id: str, trace_id: str) -> TraceInfo:
    """The trace-level record of a standalone trace: session, user, totals, previews, and name.

    Raises:
        ValueError: The root's inputs or outputs cannot be encoded as JSON.
    """
    root = trace.root
    metadata: dict[str, str] = {}
    if trace.session_id is not None:
        metadata[TraceMetadataKey.TRACE_SESSION] = trace.session_id
    if trace.user_id is not None:
        metadata[TraceMetadataKey.TRACE_USER] = trace.user_id
    usages = [usage for span in trace.spans if (usage := token_usage(span)) is not None]
    if usages:
        keys = (TokenUsageKey.INPUT_TOKENS, TokenUsageKey.OUTPUT_TOKENS, TokenUsageKey.TOTAL_TOKENS)
        metadata[TraceMetadataKey.TOKEN_USAGE] = json_value({key: sum(usage[key] for usage in usages) for key in keys})
    costs = [cost for span in trace.spans if (cost := usd_cost(span)) is not None]
    if costs:
        metadata[TraceMetadataKey.COST] = json_value({CostKey.TOTAL_COST: sum(costs)})
    return TraceInfo(
        trace_id=trace_id,
        trace_location=TraceLocation.from_experiment_id(experiment_id),
        request_time=nanos(root.start_time) // 1_000_000,
        execution_duration=(nanos(root.end_time) - nanos(root.start_time)) // 1_000_000,
        state=TraceState.ERROR if root.status is SpanStatus.ERROR else TraceState.OK,
        request_preview=_preview(root.inputs),
        response_preview=_preview(root.outputs),
        client_request_id=trace.trace_id,
        trace_metadata=metadata,
        tags={TraceTagKey.TRACE_NAME: root.name},
    )


def _upload(egress: Egress, method: str, url: str, headers: Mapping[str, str], content: bytes | None) -> None:
    # Signed URLs embed a storage credential and receive no Databricks token.
    send_export_request(
        egress, method, url, destination=_DESTINATION, headers=headers, content=content, sensitive_url=True
    )


def upload_trace_data(egress: Egress, host: str, headers: Mapping[str, str], trace_id: str, payload: bytes) -> None:
    """Store the spans as the trace's artifact through a signed cloud storage URL.

    Raises:
        TraceProviderError: Any failure; the caller decides the outcome.
    """
    path, method = extract_api_info_for_service(DatabricksMlflowArtifactsService, "/api/2.0")[
        GetCredentialsForTraceDataUpload
    ]
    response = send_export_request(
        egress,
        method,
        host + path.replace("{request_id}", quote(trace_id, safe="")),
        destination=_DESTINATION,
        headers={"Accept": "application/json", **headers},
        content=None,
        sensitive_url=False,
    )
    try:
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError("credentials are not an object")
        credential = ParseDict(
            body, GetCredentialsForTraceDataUpload.Response(), ignore_unknown_fields=True
        ).credential_info
    except (ParseError, TypeError, ValueError):
        raise ExportOutcomeUnknownError("Databricks returned unreadable artifact credentials") from None
    signed_url = credential.signed_uri
    parsed = urlsplit(signed_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ExportRejectedError("Invalid Databricks artifact upload destination")
    upload_headers = {header.name: header.value for header in credential.headers}
    # An unknown type is dropped while parsing and would read as the enum's first value.
    credential_type = credential.type if credential.HasField("type") else None
    if credential_type == ArtifactCredentialType.AZURE_ADLS_GEN2_SAS_URI:
        # The whole artifact fits one append; flushing commits it.
        separator = "&" if parsed.query else "?"
        adls_headers = {key: value for key, value in upload_headers.items() if key.lower() != "x-ms-blob-type"}
        _upload(egress, "PUT", f"{signed_url}{separator}resource=file", adls_headers, None)
        _upload(egress, "PATCH", f"{signed_url}{separator}action=append&position=0&flush=true", adls_headers, payload)
    elif credential_type in _SIGNED_URL_CREDENTIALS:
        if credential_type == ArtifactCredentialType.AZURE_SAS_URI:
            upload_headers["x-ms-blob-type"] = "BlockBlob"
        _upload(egress, "PUT", signed_url, upload_headers, payload)
    else:
        raise ExportRejectedError("Unsupported Databricks artifact credential type")
