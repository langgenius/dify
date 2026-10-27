"""Helpers for implementing ``TraceProvider.send``."""

import json
from collections.abc import Mapping
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit

from dify_trace_sdk.egress import Egress, EgressResponse
from dify_trace_sdk.errors import (
    EgressBlockedError,
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    TraceProviderError,
)

EXPORT_TIMEOUT_SECONDS = 30.0


def json_value(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, default=str, allow_nan=False)


def nanos(value: datetime) -> int:
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return int(aware.timestamp() * 1_000_000_000)


def export_endpoint(value: str) -> str:
    """Validate a configured base URL for export and drop its trailing slash."""
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ExportRejectedError("Invalid tracing endpoint")
    if parsed.query or parsed.fragment:
        raise ExportRejectedError("Tracing endpoint must not contain query parameters or a fragment")
    return urlunsplit(parsed).rstrip("/")


def classify_egress_error(error: EgressError, destination: str) -> TraceProviderError:
    """The pipeline's reading of a transport failure; raise it ``from None`` so no request detail is chained."""
    if isinstance(error, EgressBlockedError):
        return ExportRejectedError(f"{destination} endpoint is not allowed by the egress policy")
    if error.request_sent:
        return ExportOutcomeUnknownError(f"{destination} ingestion outcome is unknown after transport failure")
    return ExportRetryableError(f"{destination} is unreachable")


def raise_for_export_status(status_code: int, destination: str) -> None:
    if 200 <= status_code < 300:
        return
    # 501: the destination does not implement this ingestion API, so sending again cannot help.
    if status_code in {408, 425, 429} or (status_code >= 500 and status_code != 501):
        raise ExportRetryableError(f"{destination} ingestion temporarily unavailable (HTTP {status_code})")
    raise ExportRejectedError(f"{destination} ingestion rejected (HTTP {status_code})")


def send_export_request(
    egress: Egress,
    method: str,
    url: str,
    *,
    destination: str,
    headers: Mapping[str, str],
    content: bytes | None,
    sensitive_url: bool,
) -> EgressResponse:
    """Send one export request and classify every failure for the pipeline."""
    try:
        response = egress.request(
            method,
            url,
            headers=headers,
            content=content,
            timeout=EXPORT_TIMEOUT_SECONDS,
            sensitive_url=sensitive_url,
        )
    except EgressError as error:
        raise classify_egress_error(error, destination) from None
    raise_for_export_status(response.status_code, destination)
    return response
