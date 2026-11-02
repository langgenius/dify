"""Phoenix and Arize destinations: OTLP spans with OpenInference attributes.

Phoenix ingests OTLP/HTTP at ``{endpoint}/v1/traces``; Arize ingests OTLP/gRPC.
Spans keep the trace's OpenTelemetry IDs, so a unit whose root has an external
parent joins the tree that was exported separately.
"""

import re
from typing import override
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import grpc  # type: ignore[import-untyped]
from dify_trace_sdk.errors import EgressError, ExportRejectedError, VerificationError
from dify_trace_sdk.exporting import export_endpoint, json_value
from dify_trace_sdk.model import Span, SpanKind, Trace
from dify_trace_sdk.otlp import encode_trace, export_otlp_grpc, post_otlp, read_otlp_ack
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import TraceServiceStub

from dify_trace_arize_phoenix import _arize_project
from dify_trace_arize_phoenix.config import DEFAULT_PROJECT, ArizeConfig, PhoenixConfig

SERVICE_NAME = "dify-application"
JSON_MIME_TYPE = "application/json"
PHOENIX_VERIFY_TIMEOUT_SECONDS = 30.0
ARIZE_VERIFY_TIMEOUT_SECONDS = 5.0
MAX_VERIFY_RESPONSE_BYTES = 1024 * 1024
_CAPABILITIES = ProviderCapabilities(native_cost=False, trace_url=False, span_url=False)
_MALFORMED_ESCAPE = re.compile(r"%(?![0-9a-f]{2})|%(?:2f|5c)", re.IGNORECASE)
"""A ``%`` that starts no escape, or an escaped ``/`` or ``\\``."""
_PROBE_FAILURES = {
    grpc.StatusCode.UNAUTHENTICATED: "authentication_failed",
    grpc.StatusCode.PERMISSION_DENIED: "permission_denied",
}


def _span_attributes(trace: Trace, span: Span) -> dict[str, object]:
    attributes: dict[str, object] = {
        "openinference.span.kind": span.kind.value.upper(),
        "input.value": json_value(span.inputs),
        "input.mime_type": JSON_MIME_TYPE,
        "output.value": json_value(span.outputs),
        "output.mime_type": JSON_MIME_TYPE,
        "metadata": json_value(span.attributes),
        "session.id": trace.session_id,
        "user.id": trace.user_id,
        "dify.span.id": span.span_id,
    }
    # Only model calls report usage: a wrapper's usage repeats its children's.
    if span.kind is SpanKind.LLM:
        attributes["llm.model_name"] = span.model_name
        attributes["llm.provider"] = span.model_provider
        if span.usage is not None:
            attributes["llm.token_count.prompt"] = span.usage.prompt_tokens
            attributes["llm.token_count.completion"] = span.usage.completion_tokens
            attributes["llm.token_count.total"] = span.usage.total_tokens
    elif span.kind is SpanKind.TOOL:
        attributes["tool.name"] = span.name
        attributes["tool.parameters"] = json_value(span.inputs)
    return attributes


def _export_request(project: str, trace: Trace) -> ExportTraceServiceRequest:
    return encode_trace(
        trace,
        resource={"service.name": SERVICE_NAME, "openinference.project.name": project, "model_id": project},
        attributes=lambda span: _span_attributes(trace, span),
    )


def _is_credential(value: str) -> bool:
    """Non-empty printable ASCII without whitespace or the ``*`` of a masked secret.

    Real keys never contain these. gRPC refuses non-ASCII metadata with an
    error that echoes the value, so it must never see one.
    """
    return bool(value) and "*" not in value and all("!" <= char <= "~" for char in value)


def _phoenix_base_url(value: str) -> str | None:
    """Normalize a Phoenix base URL, or return ``None`` when it cannot be one.

    The path prefix stays (Phoenix Cloud spaces and reverse proxies need it),
    but nothing that changes what an appended path names: no query, fragment,
    backslash, escaped separator, empty or dot segment, or the ``/v1/traces``
    suffix of the ingestion URL.
    """
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        path = parsed.path.rstrip("/")
        decoded_path = unquote(path, errors="strict")
        if (
            parsed.scheme not in {"http", "https"}
            or not host
            or parsed.username is not None
            or parsed.password is not None
            or any(char in value for char in "?#\\")
            or any(ord(char) <= 32 or ord(char) == 127 for char in value)
            or parsed.netloc.endswith(":")
            or port == 0
            or "%" in host
            or _MALFORMED_ESCAPE.search(path)
            or any(char in decoded_path for char in "\\?#%")
            or any(ord(char) < 32 or ord(char) == 127 for char in decoded_path)
            or "//" in parsed.path
            or any(segment in {".", ".."} for segment in decoded_path.split("/"))
            or decoded_path.endswith("/v1/traces")
        ):
            return None
        host = host.encode("idna").decode("ascii").lower()
    except (UnicodeError, ValueError):
        return None
    authority = f"[{host}]" if ":" in host else host
    return urlunsplit((parsed.scheme, authority if port is None else f"{authority}:{port}", path, "", ""))


def _phoenix_project(value: str) -> str | None:
    # The project redirect looks names up through GraphQL, so REST's stricter identifier rules do not apply.
    project = value.strip() or DEFAULT_PROJECT
    if project in {".", ".."} or any(ord(char) < 32 or ord(char) == 127 for char in project):
        return None
    return project


def _is_project_page(body: object) -> bool:
    """Whether ``body`` is a page of Phoenix's ``GET /v1/projects``; a proxy or login page is not."""
    if not isinstance(body, dict) or not isinstance(body.get("data"), list) or "next_cursor" not in body:
        return False
    if body["next_cursor"] is not None and not isinstance(body["next_cursor"], str):
        return False
    return all(
        isinstance(row, dict)
        and isinstance(row.get("id"), str)
        and bool(row["id"])
        and isinstance(row.get("name"), str)
        and bool(row["name"])
        and (row.get("description") is None or isinstance(row["description"], str))
        for row in body["data"]
    )


class PhoenixProvider(TraceProvider[PhoenixConfig]):
    id = "phoenix"
    config_model = PhoenixConfig
    capabilities = _CAPABILITIES

    @override
    def verify(self, config: PhoenixConfig) -> PhoenixConfig:
        """Read one page of the project list and return the normalized endpoint and project.

        This proves read access only, which a keyless self-hosted server grants
        to anyone. It creates nothing and does not prove ingestion access.
        """
        endpoint = _phoenix_base_url(config.endpoint)
        if endpoint is None:
            raise VerificationError("invalid_endpoint")
        project = _phoenix_project(config.project)
        if project is None:
            raise VerificationError("invalid_project")
        headers = {"Accept": JSON_MIME_TYPE}
        if config.api_key:
            if not _is_credential(config.api_key):
                raise VerificationError("invalid_api_key")
            headers["Authorization"] = f"Bearer {config.api_key}"
        try:
            response = self.egress.request(
                "GET",
                f"{endpoint}/v1/projects?limit=1",
                headers=headers,
                content=None,
                timeout=PHOENIX_VERIFY_TIMEOUT_SECONDS,
                sensitive_url=False,
            )
        except EgressError:
            raise VerificationError("connection_failed") from None
        if response.status_code == 401:
            raise VerificationError("authentication_failed")
        if response.status_code == 403:
            raise VerificationError("permission_denied")
        if response.status_code != 200:
            raise VerificationError("endpoint_unavailable")
        try:
            body = response.json() if len(response.content) <= MAX_VERIFY_RESPONSE_BYTES else None
        except (ValueError, RecursionError):
            body = None
        if not _is_project_page(body):
            raise VerificationError("malformed_response")
        return config.model_copy(update={"endpoint": endpoint, "project": project})

    @override
    def project_url(self, config: PhoenixConfig) -> str | None:
        endpoint, project = _phoenix_base_url(config.endpoint), _phoenix_project(config.project)
        if endpoint is None or project is None:
            return None
        return f"{endpoint}/redirects/projects/{quote(project, safe='')}"

    @override
    def send(self, config: PhoenixConfig, trace: Trace) -> SendResult:
        endpoint = export_endpoint(config.endpoint)
        headers: dict[str, str] = {}
        if config.api_key:
            if not _is_credential(config.api_key):
                raise ExportRejectedError("Phoenix API key is not a valid header value")
            headers = {"api_key": config.api_key, "authorization": f"Bearer {config.api_key}"}
        response = post_otlp(
            self.egress,
            f"{endpoint}/v1/traces",
            _export_request(config.project, trace),
            destination="Phoenix",
            headers=headers,
            sensitive_url=False,
        )
        read_otlp_ack(response, "Phoenix")
        return SendResult(trace_id=trace.trace_id, trace_url=None, span_urls={})


def _arize_metadata(config: ArizeConfig) -> dict[str, str]:
    return {"api_key": config.api_key, "space_id": config.space_id, "authorization": f"Bearer {config.api_key}"}


def _has_valid_credentials(config: ArizeConfig) -> bool:
    return _is_credential(config.api_key) and _is_credential(config.space_id)


def _has_valid_port(url: str) -> bool:
    try:
        return urlsplit(url).port != 0
    except ValueError:
        return False


class ArizeProvider(TraceProvider[ArizeConfig]):
    id = "arize"
    config_model = ArizeConfig
    capabilities = _CAPABILITIES

    @override
    def verify(self, config: ArizeConfig) -> ArizeConfig:
        """Require the collector to acknowledge an export, then look up the project link.

        The export carries a resource and no spans, so it creates nothing. It
        proves ingestion access only; the link lookup may fail without failing
        verification, because a key may ingest without read access.
        """
        if not _has_valid_credentials(config) or not _has_valid_port(config.endpoint):
            raise VerificationError("invalid_configuration")
        probe = ExportTraceServiceRequest()
        resource = probe.resource_spans.add().resource
        for key in ("model_id", "openinference.project.name"):
            resource.attributes.add(key=key).value.string_value = config.project
        try:
            channel = self.egress.grpc_channel(config.endpoint)
        except EgressError:
            raise VerificationError("connection_failed") from None
        try:
            result = TraceServiceStub(channel).Export(
                probe, metadata=tuple(_arize_metadata(config).items()), timeout=ARIZE_VERIFY_TIMEOUT_SECONDS
            )
        except grpc.RpcError as error:
            raise VerificationError(_PROBE_FAILURES.get(error.code(), "connection_failed")) from None
        finally:
            channel.close()
        if result.partial_success.rejected_spans or result.partial_success.error_message:
            raise VerificationError("unexpected_response")
        destination = _arize_project.resolve_destination(self.egress, config)
        return config.model_copy(update={"arize_project_destination": destination})

    @override
    def project_url(self, config: ArizeConfig) -> str | None:
        return _arize_project.project_url(config)

    @override
    def send(self, config: ArizeConfig, trace: Trace) -> SendResult:
        if not _has_valid_credentials(config):
            raise ExportRejectedError("Arize credentials are not valid gRPC metadata")
        export_otlp_grpc(
            self.egress,
            config.endpoint,
            _export_request(config.project, trace),
            destination="Arize",
            metadata=_arize_metadata(config),
        )
        return SendResult(trace_id=trace.trace_id, trace_url=None, span_urls={})
