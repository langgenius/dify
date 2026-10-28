"""Opik destination over its REST API.

Each trace unit becomes an Opik trace, created first, and its spans, created in
batches; the root span is both the trace and its top-level span. Opik requires
UUIDv7 identifiers, so they are derived from the Dify trace and span start
times: a redelivered unit keeps its identifiers, and a fragment joins the trace
of its message. The Opik SDK is never imported: importing it replaces the
process's Sentry client with Comet's.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import override
from urllib.parse import quote, urlencode, urlsplit
from uuid import NAMESPACE_URL, UUID, uuid5

from dify_trace_sdk.egress import EgressResponse
from dify_trace_sdk.errors import (
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    TraceProviderError,
    VerificationError,
)
from dify_trace_sdk.exporting import json_value, send_export_request
from dify_trace_sdk.model import Span, SpanKind, SpanStatus, Trace
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from pydantic import JsonValue

from dify_trace_opik.config import DEFAULT_PROJECT, OpikConfig

VERIFY_TIMEOUT_SECONDS = 30.0
MAX_SPANS_PER_BATCH = 1000
"""The Opik SDK's span batch size; larger units are sent in several batches."""
DEFAULT_WORKSPACE = "default"
"""Opik's name for the account's default workspace; only ``verify`` resolves it."""
_SPAN_TYPES: Mapping[SpanKind, str] = {SpanKind.LLM: "llm", SpanKind.TOOL: "tool"}
"""Opik has no chain, agent, or retriever spans; those are ``general``."""


@dataclass(frozen=True)
class _Settings:
    """The configuration as Opik receives it."""

    url: str
    """The API base URL, ending in ``/api/``."""
    workspace: str
    project: str


def _settings(config: OpikConfig) -> _Settings:
    """Check every value that reaches a URL or header before a credential is sent.

    Raises:
        VerificationError: A value cannot be sent safely; ``code`` names it.
    """
    return _Settings(
        url=_api_url(config.url),
        workspace=_workspace_name(config.workspace),
        project=_project_name(config.project),
    )


def _api_url(value: str) -> str:
    url = value.strip()
    try:
        parsed = urlsplit(url)
        _ = parsed.port  # raises ValueError for an invalid port
    except ValueError:
        raise VerificationError("invalid_endpoint") from None
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not url.endswith("/api/")
        or "\\" in url
        or any(ord(char) <= 32 or ord(char) == 127 for char in url)
    ):
        raise VerificationError("invalid_endpoint")
    return url


def _has_control_character(value: str) -> bool:
    return any(ord(char) < 32 or ord(char) == 127 for char in value)


def _workspace_name(value: str | None) -> str:
    """The workspace travels as a header value and as a console path segment."""
    name = (value.strip() if value else "") or DEFAULT_WORKSPACE
    if _has_control_character(name) or name in {".", ".."}:
        raise VerificationError("invalid_workspace")
    return name


def _project_name(value: str) -> str:
    name = value.strip() or DEFAULT_PROJECT
    if _has_control_character(name):
        raise VerificationError("invalid_project")
    return name


def _headers(api_key: str | None, workspace: str) -> dict[str, str]:
    headers = {"Comet-Workspace": workspace, "Accept": "application/json"}
    if api_key:
        headers["Authorization"] = api_key
    return headers


def _resolved_workspace(response: EgressResponse) -> str:
    try:
        body = response.json()
    except ValueError:
        raise VerificationError("malformed_response") from None
    name = body.get("workspace_name") if isinstance(body, dict) else None
    if not isinstance(name, str) or not name.strip():
        raise VerificationError("malformed_response")
    return _workspace_name(name)


def _opik_id(trace_id: str, key: str, started_at: datetime) -> str:
    """A UUIDv7 that is stable for a Dify trace, a key within it, and a start time.

    Identical to the legacy exporter's IDs: a uuid5 seed whose leading bits are
    replaced as ``opik.id_helpers.uuid4_to_uuid7`` does.
    """
    seed = uuid5(NAMESPACE_URL, f"dify:{trace_id}:{key}").bytes
    value = bytearray(int(started_at.timestamp() * 1000).to_bytes(6, "big") + seed[6:])
    value[6] = 0x70 | (seed[6] & 0x0F)
    value[8] = 0x80 | (seed[8] & 0x3F)
    return str(UUID(bytes=bytes(value)))


def _iso(value: datetime) -> str:
    """UTC with a ``Z`` suffix, as the Opik SDK sends it."""
    return value.isoformat().replace("+00:00", "Z")


def _content(value: JsonValue) -> JsonValue:
    """Opik takes an object, a list of objects, or a string as input and output."""
    if value is None or isinstance(value, dict | str):
        return value
    if isinstance(value, list) and all(isinstance(item, dict) for item in value):
        return value
    return json_value(value)


def _error_info(span: Span) -> dict[str, str] | None:
    if span.status is not SpanStatus.ERROR:
        return None
    return {"exception_type": "DifyExecutionError", "message": span.error or "Trace operation failed", "traceback": ""}


def _model_call_fields(span: Span) -> dict[str, object]:
    """Only model calls carry usage, cost, and latency; wrapper spans would count them twice."""
    fields: dict[str, object] = {"model": span.model_name, "provider": span.model_provider}
    if span.usage is not None:
        fields["usage"] = {
            "prompt_tokens": span.usage.prompt_tokens,
            "completion_tokens": span.usage.completion_tokens,
            "total_tokens": span.usage.total_tokens,
        }
    # Opik costs are in USD; without one, Opik may estimate it from the model and usage.
    if span.cost is not None and span.cost.currency.upper() == "USD":
        fields["total_estimated_cost"] = span.cost.amount
    if span.time_to_first_token is not None:
        fields["ttft"] = span.time_to_first_token * 1000
    return fields


def _without_none(body: Mapping[str, object]) -> dict[str, object]:
    return {key: value for key, value in body.items() if value is not None}


def _encode(body: Mapping[str, object]) -> bytes:
    return json_value(body).encode()


class OpikProvider(TraceProvider[OpikConfig]):
    id = "opik"
    config_model = OpikConfig
    capabilities = ProviderCapabilities(native_cost=True, trace_url=False, span_url=False)

    @override
    def verify(self, config: OpikConfig) -> OpikConfig:
        """Check workspace access with the endpoints of the Opik SDK's ``auth_check``.

        ``POST v1/private/auth`` answers No Content when the key may use the
        workspace; the default workspace is then resolved to its name. Neither
        request creates the project: Opik creates it on first ingestion.
        """
        settings = _settings(config)
        headers = _headers(config.api_key, settings.workspace)
        access = self._check(
            "POST", f"{settings.url}v1/private/auth", {**headers, "Content-Type": "application/json"}, b"{}"
        )
        if access.content.strip():
            # A 2xx page with content, such as a login form, is not Opik's auth endpoint.
            raise VerificationError("malformed_response")
        workspace = settings.workspace
        if workspace == DEFAULT_WORKSPACE:
            workspace = _resolved_workspace(
                self._check("GET", f"{settings.url}v1/private/auth/workspace", headers, None)
            )
        return config.model_copy(update={"url": settings.url, "workspace": workspace, "project": settings.project})

    @override
    def project_url(self, config: OpikConfig) -> str | None:
        try:
            settings = _settings(config)
        except VerificationError:
            return None
        console = settings.url.removesuffix("api/")
        if settings.workspace == DEFAULT_WORKSPACE:
            # Only verify can resolve the default workspace's name; link the console instead.
            return console
        query = urlencode({"name": settings.project})
        return f"{console}{quote(settings.workspace, safe='')}/redirect/projects?{query}"

    @override
    def send(self, config: OpikConfig, trace: Trace) -> SendResult:
        try:
            settings = _settings(config)
        except VerificationError as error:
            raise ExportRejectedError(f"Opik configuration is invalid ({error.code})") from None
        # A fragment names the root of its trace, so both units derive the same trace ID.
        trace_start = trace.trace_root.start_time if trace.trace_root is not None else trace.root.start_time
        trace_id = _opik_id(trace.trace_id, "trace", trace_start)
        try:
            requests = self._requests(trace, trace_id, settings)
        except ValueError:
            raise ExportRejectedError("Opik trace contains values that cannot be encoded as JSON") from None
        headers = {**_headers(config.api_key, settings.workspace), "Content-Type": "application/json"}
        accepted = False
        for url, content in requests:
            try:
                send_export_request(
                    self.egress,
                    "POST",
                    url,
                    destination="Opik",
                    headers=headers,
                    content=content,
                    sensitive_url=False,
                )
            except TraceProviderError as error:
                if accepted:
                    raise ExportOutcomeUnknownError(
                        f"Opik accepted part of the trace before a failure: {error}"
                    ) from None
                raise
            accepted = True
        return SendResult(trace_id=trace_id, trace_url=None, span_urls={})

    def _check(self, method: str, url: str, headers: Mapping[str, str], content: bytes | None) -> EgressResponse:
        try:
            response = self.egress.request(
                method,
                url,
                headers=headers,
                content=content,
                timeout=VERIFY_TIMEOUT_SECONDS,
                sensitive_url=False,
            )
        except EgressError:
            raise VerificationError("connection_failed") from None
        if response.status_code == 401:
            raise VerificationError("authentication_failed")
        if response.status_code == 403:
            raise VerificationError("permission_denied")
        if not 200 <= response.status_code < 300:
            raise VerificationError("endpoint_unavailable")
        return response

    def _requests(self, trace: Trace, trace_id: str, settings: _Settings) -> list[tuple[str, bytes]]:
        """Encode every request before the first is sent, so a bad value cannot leave a partial trace."""
        span_ids = {span.span_id: _opik_id(trace.trace_id, span.span_id, span.start_time) for span in trace.spans}
        if trace.parent is not None and trace.parent != trace.trace_root:
            # A parent below the trace root is a span another unit sent; its ID is derivable.
            span_ids[trace.parent.span_id] = _opik_id(trace.trace_id, trace.parent.span_id, trace.parent.start_time)
        spans = [self._span(trace, span, trace_id, span_ids, settings.project) for span in trace.spans]
        requests: list[tuple[str, bytes]] = []
        if trace.parent is None:
            created = self._trace(trace, trace_id, settings.project)
            requests.append((f"{settings.url}v1/private/traces", _encode(created)))
        for start in range(0, len(spans), MAX_SPANS_PER_BATCH):
            batch = {"spans": spans[start : start + MAX_SPANS_PER_BATCH]}
            requests.append((f"{settings.url}v1/private/spans/batch", _encode(batch)))
        return requests

    @staticmethod
    def _trace(trace: Trace, trace_id: str, project: str) -> dict[str, object]:
        root = trace.root
        return _without_none(
            {
                "id": trace_id,
                "project_name": project,
                "name": root.name,
                "start_time": _iso(root.start_time),
                "end_time": _iso(root.end_time),
                "input": _content(root.inputs),
                "output": _content(root.outputs),
                "metadata": {**root.attributes, "dify_trace_id": trace.trace_id, "user_id": trace.user_id},
                "error_info": _error_info(root),
                "thread_id": trace.session_id,
            }
        )

    @staticmethod
    def _span(trace: Trace, span: Span, trace_id: str, span_ids: Mapping[str, str], project: str) -> dict[str, object]:
        body: dict[str, object] = {
            "id": span_ids[span.span_id],
            "project_name": project,
            "trace_id": trace_id,
            # The unit's root is top-level, and so is a fragment's root that hangs from the trace root.
            "parent_span_id": span_ids.get(span.parent_span_id) if span.parent_span_id is not None else None,
            "name": span.name,
            "type": _SPAN_TYPES.get(span.kind, "general"),
            "start_time": _iso(span.start_time),
            "end_time": _iso(span.end_time),
            "input": _content(span.inputs),
            "output": _content(span.outputs),
            "metadata": {
                **span.attributes,
                "dify_span_kind": span.kind.value,
                "dify_span_id": span.span_id,
                "dify_trace_id": trace.trace_id,
                "session_id": trace.session_id,
            },
            "error_info": _error_info(span),
        }
        if span.kind is SpanKind.LLM:
            body.update(_model_call_fields(span))
        return _without_none(body)
