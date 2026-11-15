"""Shared serialization and HTTP boundaries for application trace adapters."""

import json
import math
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from core.ops.exceptions import RetryableTraceDispatchError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportUncertainError
from services.tracing.request_log_protection import protect_http_request_logs


def json_value(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, default=str, allow_nan=False)


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def nanos(value: datetime) -> int:
    return int(utc(value).timestamp() * 1_000_000_000)


def finished_at(span: CanonicalSpan) -> datetime:
    if span.end_time is None:
        raise TraceExportRejectedError("Application trace requires completed spans")
    return utc(span.end_time)


def endpoint(value: object) -> str:
    """Validate a destination without allowing credentials in HTTP authority."""
    if not isinstance(value, str):
        raise TraceExportRejectedError("Tracing endpoint is required")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise TraceExportRejectedError("Invalid tracing endpoint")
    if parsed.query or parsed.fragment:
        raise TraceExportRejectedError("Tracing endpoint must not contain query parameters or a fragment")
    return urlunsplit(parsed).rstrip("/")


def required(config: Mapping[str, Any], name: str) -> str:
    value = config.get(name)
    if not isinstance(value, str) or not value.strip():
        raise TraceExportRejectedError(f"Tracing configuration requires {name}")
    return value


def token_usage(span: CanonicalSpan) -> dict[str, int]:
    """Only model-call spans carry billable usage; wrappers retain metadata."""
    if span.kind is not CanonicalSpanKind.LLM:
        return {}
    result = {}
    for source, target in (("prompt_tokens", "input"), ("completion_tokens", "output"), ("total_tokens", "total")):
        value = span.metadata.get(source)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            result[target] = value
    return result


def usd_cost(span: CanonicalSpan) -> float | None:
    if span.kind is not CanonicalSpanKind.LLM or str(span.metadata.get("currency", "USD")).upper() != "USD":
        return None
    try:
        value = float(span.metadata["total_price"])
    except (KeyError, TypeError, ValueError):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def check_http_status(status: int, provider: str) -> None:
    if 200 <= status < 300:
        return
    if status in {408, 425, 429} or status >= 500:
        raise RetryableTraceDispatchError(f"{provider} ingestion temporarily unavailable (HTTP {status})")
    raise TraceExportRejectedError(f"{provider} ingestion rejected (HTTP {status})")


def request(method: str, url: str, provider: str, **kwargs: Any):
    """Use the configured SSRF boundary, with retries owned by the durable task."""
    import httpx
    from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, attach, detach, set_value

    from core.helper import ssrf_proxy

    token = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
    try:
        with protect_http_request_logs(provider == "aliyun"):
            if provider == "aliyun":
                response = _request_sensitive_aliyun(method, url, **kwargs)
            else:
                response = ssrf_proxy.make_request(
                    method, url, max_retries=0, timeout=30.0, follow_redirects=False, **kwargs
                )
    except httpx.TransportError:
        raise TraceExportUncertainError(f"{provider} ingestion outcome is unknown after transport failure") from None
    finally:
        detach(token)
    check_http_status(response.status_code, provider)
    return response


def _request_sensitive_aliyun(method: str, url: str, **kwargs: Any):
    """Discard private HTTP exception objects before raising a public failure."""
    import httpx

    from core.helper import ssrf_proxy

    response: httpx.Response | None = None
    failure: RuntimeError | None = None
    try:
        response = ssrf_proxy.make_request(method, url, max_retries=0, timeout=30.0, follow_redirects=False, **kwargs)
    except httpx.RequestError:
        failure = TraceExportUncertainError("aliyun ingestion outcome is unknown after transport failure")
    except Exception:
        failure = TraceExportRejectedError("aliyun HTTP request was rejected by the transport boundary")
    # Raise after leaving the original exception handler so neither its cause
    # nor implicit context retains a credential-bearing request or message.
    if failure is not None:
        raise failure from None
    if response is None:
        raise TraceExportUncertainError("aliyun HTTP transport returned no acknowledgment")
    return response
