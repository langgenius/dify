"""Bounded observations for Builder Trace; never execution or retry authority.

Only fixed classifications cross this boundary. Context variables scope nested
cognition calls without sharing callbacks between concurrent operations.
"""

import json
import re
from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager, suppress
from contextvars import ContextVar
from datetime import UTC, datetime
from functools import wraps
from typing import Any, Literal
from uuid import UUID, uuid4

DiagnosticCallback = Callable[[dict[str, Any]], None]
_current: ContextVar[tuple[DiagnosticCallback | None, str]] = ContextVar("builder_diagnostics", default=(None, ""))
_MESSAGES = {
    "native_preparation_failed": (
        "preparation",
        "Native test preparation failed before workflow worker dispatch. "
        "Check provider/plugin services and configuration before preparing a fresh test.",
    ),
    "provider_invocation_failed": (
        "provider",
        "The model invocation failed. Check provider/plugin availability and provider configuration.",
    ),
    "model_resolution_failed": (
        "model_resolution",
        "The selected model could not be resolved. Check model availability and configuration.",
    ),
    "empty_response": ("response", "The model returned no answer. Check provider health and model configuration."),
    "json_decode_failed": ("json", "The model answer was not a JSON object. Review model structured output support."),
    "response_schema_invalid": ("schema", "The model answer did not match the required response schema."),
    "inventory_unavailable": (
        "inventory",
        "A resource catalogue could not be read. Check resource service availability and workspace access.",
    ),
    "authorization_lookup_failed": (
        "inventory",
        "Tool authorization could not be verified. Check workspace credential access.",
    ),
    "deterministic_fallback": (
        "degraded",
        "Builder used its existing deterministic fallback; review the result before continuing.",
    ),
    "validation_refused": (
        "validation",
        "Builder validation refused the proposed change. Review the validation result before continuing.",
    ),
    "generation_failed": (
        "generation",
        "Graph generation failed. Check generator configuration and the preceding observations.",
    ),
    "generation_validation_failed": (
        "validation",
        "A graph generation attempt failed validation. Review node references and supported configuration.",
    ),
    "native_outcome_unknown": (
        "native",
        "Native execution outcome is unknown. Reconcile the existing Run before deciding whether to run again.",
    ),
    "diagnostics_truncated": ("truncation", "Additional diagnostic observations were omitted at the Trace limit."),
}


def project(record: Mapping[str, Any]) -> dict[str, Any]:
    """Ignore arbitrary text/extra fields, including legacy generator errors."""
    code = record.get("code")
    if not isinstance(code, str) or code not in _MESSAGES:
        return {}
    category, message = _MESSAGES[code]
    result: dict[str, Any] = {
        "version": 1,
        "id": str(uuid4()),
        "at": datetime.now(UTC).isoformat(),
        "code": code,
        "category": category,
        "severity": "warning",
        "message": message,
    }
    with suppress(ValueError, TypeError, AttributeError):
        result["id"] = str(UUID(str(record.get("id", result["id"]))))
    at = record.get("at")
    if isinstance(at, str) and len(at) <= 40:
        try:
            parsed_at = datetime.fromisoformat(at)
            if parsed_at.tzinfo is not None:
                result["at"] = parsed_at.isoformat()
        except ValueError:
            pass
    for key in ("span_id", "exception_type"):
        value = record.get(key)
        if isinstance(value, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,79}", value):
            result[key] = value
    for key in ("provider", "model"):
        value = record.get(key)
        if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./+-]{0,127}", value):
            result[key] = value
    node_id = record.get("node_id")
    if isinstance(node_id, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", node_id):
        result["node_id"] = node_id
    attempt = record.get("attempt")
    if type(attempt) is int and 0 <= attempt <= 10:
        result["attempt"] = attempt
    if type(record.get("fallback_used")) is bool:
        result["fallback_used"] = record["fallback_used"]
    reason = record.get("reason")
    if isinstance(reason, str) and reason in {
        "connection_refused",
        "timeout",
        "authentication",
        "rate_limit",
        "service_unavailable",
        "unknown",
    }:
        result["reason"] = reason
    codes = record.get("validation_codes")
    allowed = {
        "UNRESOLVED_REFERENCE",
        "INVALID_BRANCH_HANDLE",
        "INVALID_NODE_CONFIG",
        "INVALID_GRAPH",
        "UNSUPPORTED_NODE_TYPE",
        "RESOURCE_SELECTION_REQUIRED",
        "RESOURCE_CATALOGUE_UNAVAILABLE",
        "RESOURCE_CATALOGUE_CHANGED",
        "RESOURCE_NOT_IN_CATALOGUE",
        "RESOURCE_CONFIGURATION_INCOMPATIBLE",
    }
    if isinstance(codes, list):
        result["validation_codes"] = [code for code in codes[:16] if isinstance(code, str) and code in allowed]
    return result


FailureReason = Literal[
    "connection_refused", "timeout", "authentication", "rate_limit", "service_unavailable", "unknown"
]


def plugin_activation_unavailable(error: Exception) -> bool:
    """Read only the typed daemon activation envelope, never workflow error text.

    The connector body is checked for shape, but is never exposed or used to
    infer dispatch, node execution, credentials, or infrastructure permissions.
    """
    from core.plugin.entities.plugin_daemon import PluginDaemonInnerError

    if not isinstance(error, PluginDaemonInnerError) or error.code != -500:
        return False
    message = error.message
    if not isinstance(message, str) or len(message) > 16384:
        return False
    match = re.fullmatch(
        r"Failed to activate plugin before invocation: "
        r"unexpected response from serverless connector activation: status=5[0-9]{2} body=(.+)",
        message,
        re.DOTALL,
    )
    if match is None:
        return False
    try:
        body = json.loads(match.group(1))
    except (ValueError, TypeError, RecursionError):
        return False
    return isinstance(body, dict) and isinstance(body.get("error"), str) and bool(body["error"])


def failure_reason(error: Exception | None) -> FailureReason:
    if error is not None and plugin_activation_unavailable(error):
        return "service_unavailable"
    if isinstance(error, ConnectionRefusedError):
        return "connection_refused"
    if isinstance(error, TimeoutError):
        return "timeout"
    # Inspect only to classify; never copy provider bodies or URLs into Trace.
    text = str(error).lower() if error is not None else ""
    reasons: dict[FailureReason, tuple[str, ...]] = {
        "connection_refused": ("connection refused", "connectionrefused"),
        "timeout": ("timed out", "timeout"),
        "authentication": ("unauthorized", "authentication", "invalid api key"),
        "rate_limit": ("rate limit", "rate_limit"),
        "service_unavailable": ("service unavailable",),
    }
    for reason, markers in reasons.items():
        if any(marker in text for marker in markers):
            return reason
    return "unknown"


@contextmanager
def scope(callback: DiagnosticCallback | None, span: str) -> Generator[None]:
    token = _current.set((callback, span))
    try:
        yield
    finally:
        _current.reset(token)


def report(
    code: str,
    *,
    error: Exception | None = None,
    attempt: int | None = None,
    fallback_used: bool | None = None,
    validation_code: str | None = None,
    node_id: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> None:
    callback, span = _current.get()
    if callback is None:
        return
    record = project(
        {
            "code": code,
            "span_id": span,
            "exception_type": type(error).__name__ if error else None,
            "attempt": attempt,
            "fallback_used": fallback_used,
            "reason": failure_reason(error) if error else None,
            "validation_codes": [validation_code] if validation_code else None,
            "node_id": node_id,
            "provider": provider,
            "model": model,
        }
    )
    if record:
        # Optional observations must never alter a recoverable cognition outcome.
        with suppress(Exception):
            callback(record)


def cognition(method):
    """Scope an adapter method, including lazy resolution and inventory reads."""

    @wraps(method)
    def wrapped(self, *args, **kwargs):
        callback = self._diagnostic_callback

        def correlated(record):
            instance = self._model_instance
            metadata = {"provider": getattr(instance, "provider", None), "model": getattr(instance, "model_name", None)}
            if callback is not None:
                callback(project({**record, **metadata}))

        with scope(correlated if callback is not None else None, method.__name__.replace("_", "-")):
            result = method(self, *args, **kwargs)
            if callback is not None and method.__name__ == "build_nodes":
                generation(getattr(result, "diagnostics", ()))
            return result

    return wrapped


def generation(records: Sequence[Mapping[str, Any]]) -> None:
    for record in records:
        callback, span = _current.get()
        if callback is not None:
            safe = project(
                {
                    "code": "generation_validation_failed" if record.get("codes") else "generation_failed",
                    "exception_type": record.get("exception"),
                    "span_id": span,
                    "attempt": record.get("attempt"),
                    "validation_codes": record.get("codes"),
                }
            )
            with suppress(Exception):
                callback(safe)


def from_history(items: Sequence[Any], *, session_id: str, version: int) -> list[dict[str, Any]]:
    """Project a caller-bounded conversation tail, preserving owned correlation."""
    records: list[dict[str, Any]] = []
    for item in items:
        if item.kind != "assistant_turn":
            continue
        raw = item.payload.get("diagnostics")
        if not isinstance(raw, list):
            continue
        for record in raw[:33]:
            if not isinstance(record, Mapping):
                continue
            safe = project(record)
            if not safe:
                continue
            safe["session_id"] = session_id
            for key in ("command_id", "operation_id"):
                with suppress(ValueError, TypeError, AttributeError):
                    safe[key] = str(UUID(str(record.get(key))))
            at_version = record.get("at_version")
            if type(at_version) is int and 0 <= at_version <= version:
                safe["at_version"] = at_version
            stage = record.get("stage_id")
            if isinstance(stage, str) and re.fullmatch(r"[a-z][a-z0-9_.-]{0,79}", stage):
                safe["stage_id"] = stage
            records.append(safe)
    if len(records) > 32:
        return [project({"code": "diagnostics_truncated"}), *records[-32:]]
    return records
