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

from runtime_contracts.builder.native.observation import parse_native_model_failure

DiagnosticCallback = Callable[[dict[str, Any]], None]
_current: ContextVar[tuple[DiagnosticCallback | None, str]] = ContextVar("builder_diagnostics", default=(None, ""))
_MESSAGES = {
    "native_preparation_failed": (
        "preparation",
        "Native test preparation failed before workflow execution started. "
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
    "repair_not_proposed": (
        "repair",
        "The model proposed no repair. Review the explanation before deciding how to continue.",
    ),
    "repair_not_applicable": (
        "repair",
        "The proposed repair contains no applicable changes. Review the current draft before continuing.",
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
    "native_model_invocation_failed": (
        "native",
        "Native Agent model invocation failed. The existing Run outcome remains authoritative; "
        "review the failure before deciding whether to run again.",
    ),
    "native_outcome_unknown": (
        "native",
        "Native execution outcome is unknown. Reconcile the existing Run before deciding whether to run again.",
    ),
    "diagnostics_truncated": ("truncation", "Additional diagnostic observations were omitted at the Trace limit."),
}


# Paths are schema vocabulary, never arbitrary user dictionary keys or numeric
# values. Unknown fields stay unknown, including custom Code output names.
_VALIDATION_PATH_FIELDS = frozenset(
    [
        "type",
        "title",
        "plan",
        "gap",
        "input_summary",
        "output_summary",
        "code",
        "code_language",
        "outputs",
        "variables",
        "variable",
        "value",
        "value_type",
        "variable_selector",
        "cases",
        "conditions",
        "comparison_operator",
        "logical_operator",
        "case_id",
        "id",
        "authorization",
        "config",
        "headers",
        "body",
        "data",
        "method",
        "url",
        "params",
        "timeout",
        "connect",
        "read",
        "write",
        "retry_config",
        "delivery_methods",
        "inputs",
        "user_actions",
        "form_content",
        "enabled",
        "default",
        "selector",
        "classes",
        "metadata_filtering_conditions",
        "prompt_template",
        "model",
        "provider",
        "name",
        "api_key",
        "query",
        "memory",
        "context",
        "vision",
        "max_tokens",
        "temperature",
        "options",
        "required",
        "label",
    ]
) | {"*", "unknown"}
_VALIDATION_REASONS = {
    "plan": frozenset(
        {"missing", "type", "empty", "step_count", "blank", "step_length", "overview_length", "total_length", "unknown"}
    ),
    "operation": frozenset(
        {
            "unknown_operation",
            "missing_argument",
            "invalid_argument",
            "redacted_value",
            "invalid_path",
            "node_not_found",
            "invalid_branch_handle",
            "unsupported_node_type",
            "operation_invalid",
        }
    ),
    "native_config": frozenset(
        {
            "missing",
            "literal_error",
            "string_type",
            "int_type",
            "int_parsing",
            "float_type",
            "float_parsing",
            "bool_type",
            "bool_parsing",
            "list_type",
            "dict_type",
            "model_type",
            "enum",
            "value_error",
            "union_tag_invalid",
            "union_tag_not_found",
            "extra_forbidden",
            "finite_number",
            "greater_than",
            "greater_than_equal",
            "less_than",
            "less_than_equal",
            "too_short",
            "too_long",
            "uuid_parsing",
            "native_validation_error",
            "native_validation_exception",
        }
    ),
    "semantic": frozenset({"semantic_guard", "native_http_condition"}),
}
_VALIDATION_OPS = frozenset({"set_node_config", "create_node", "delete_node", "connect", "insert_between"})


def validation_detail(record: Mapping[str, Any]) -> dict[str, Any]:
    """Project a source observation to bounded schema vocabulary only.

    Accept source metadata or stored records; return no proposal values, ids,
    exception text or arbitrary field names. Unknown classifications remain
    explicit unknown within their source stage. This never grants authority.
    """
    stage = record.get("stage")
    if not isinstance(stage, str) or stage not in _VALIDATION_REASONS:
        return {}
    reason = record.get("reason_code")
    fallback = {
        "plan": "unknown",
        "operation": "operation_invalid",
        "native_config": "native_validation_error",
        "semantic": "semantic_guard",
    }
    safe: dict[str, Any] = {
        "stage": stage,
        "reason_code": reason if isinstance(reason, str) and reason in _VALIDATION_REASONS[stage] else fallback[stage],
    }
    if stage == "plan":
        for key in ("observed_count", "limit_count"):
            count = record.get(key)
            if type(count) is int and 0 <= count <= 1_000_000_000:
                safe[key] = count
    op = record.get("op")
    if isinstance(op, str) and op in _VALIDATION_OPS:
        safe["op"] = op
    # Node position identifies the actual validator target without persisting an
    # arbitrary graph/model-authored id that might itself contain a secret.
    index = record.get("node_index")
    if type(index) is int and 0 <= index <= 1_000_000:
        safe["node_index"] = index
    path = record.get("path")
    if isinstance(path, (list, tuple)):
        safe["path"] = [
            part
            if isinstance(part, str) and part in _VALIDATION_PATH_FIELDS
            else "*"
            if type(part) is int or (isinstance(part, str) and part.isdecimal())
            else "unknown"
            for part in path[:8]
        ]
        if len(path) > 8 or record.get("path_truncated") is True:
            safe["path_truncated"] = True
    return safe


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
    if code == "native_model_invocation_failed":
        stage, category = record.get("native_stage"), record.get("native_category")
        if stage is None and category is None:
            return result  # Exact historical generic failure; no reconstructed cause.
        if not isinstance(stage, str) or not isinstance(category, str):
            return {}
        diagnostic = parse_native_model_failure(
            f"NativeAgentModelDispatchFailed: Native Agent model invocation failed. [stage={stage}; reason={category}]"
        )
        if diagnostic is None:
            return {}
        result["native_stage"] = diagnostic.stage
        result["native_category"] = diagnostic.category
        return result
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
        "permission_denied",
        "credential_unavailable",
        "authorization_lookup_failed",
        "rate_limit",
        "service_unavailable",
        "unknown",
    }:
        result["reason"] = reason
    if code == "provider_invocation_failed":
        # Null explicitly means unavailable, including historical observations.
        status = record.get("http_status")
        result["http_status"] = status if type(status) is int and 100 <= status <= 599 else None
    details = record.get("validation_details")
    if code in {"validation_refused", "response_schema_invalid"} and isinstance(details, (list, tuple)):
        result["validation_details"] = [
            safe for detail in details[:16] if isinstance(detail, Mapping) and (safe := validation_detail(detail))
        ]
        count = record.get("validation_detail_count")
        result["validation_detail_count"] = (
            max(len(details), count) if type(count) is int and 0 <= count <= 1_000_000_000 else len(details)
        )
        result["validation_details_truncated"] = result["validation_detail_count"] > len(result["validation_details"])
    codes = record.get("validation_codes")
    allowed = {
        "UNRESOLVED_REFERENCE",
        "INVALID_BRANCH_HANDLE",
        "INVALID_NODE_CONFIG",
        "INVALID_GRAPH",
        "UNSUPPORTED_NODE_TYPE",
        "RESOURCE_SELECTION_REQUIRED",
        "RESOURCE_PLAN_ID_MISSING",
        "RESOURCE_CATALOGUE_UNAVAILABLE",
        "RESOURCE_CATALOGUE_CHANGED",
        "RESOURCE_NOT_IN_CATALOGUE",
        "RESOURCE_CONFIGURATION_INCOMPATIBLE",
    }
    if isinstance(codes, list):
        result["validation_codes"] = [code for code in codes[:16] if isinstance(code, str) and code in allowed]
    return result


FailureReason = Literal[
    "connection_refused",
    "timeout",
    "authentication",
    "permission_denied",
    "credential_unavailable",
    "authorization_lookup_failed",
    "rate_limit",
    "service_unavailable",
    "unknown",
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
    """Classify explicit causes for observation only, with bounded cycle handling."""
    seen: set[int] = set()
    current: BaseException | None = error
    for _ in range(8):
        if current is None or id(current) in seen:
            break
        seen.add(id(current))
        reason = _failure_reason(current)
        if reason != "unknown":
            return reason
        # Implicit context may be an unrelated failure being handled. Only
        # an explicit cause carries the original provider failure attribution.
        current = current.__cause__
    return "unknown"


def failure_http_status(error: Exception | None) -> int | None:
    """Read an observed provider status from at most eight explicit causes.

    Accept typed HTTP responses or the existing validated daemon 502 envelope.
    Return None when unavailable; never inspect arbitrary exception text,
    implicit context, requests, headers or bodies, or grant retry authority.
    """
    from httpx import HTTPStatusError

    from core.plugin.impl.exc import PluginInvokeError
    from core.plugin.impl.model import _metadata_gateway_unavailable

    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen and len(seen) < 8:
        seen.add(id(current))
        if isinstance(current, HTTPStatusError):
            status = current.response.status_code
            return status if type(status) is int and 100 <= status <= 599 else None
        if isinstance(current, PluginInvokeError) and _metadata_gateway_unavailable(current):
            return 502
        current = current.__cause__
    return None


def _failure_reason(error: BaseException) -> FailureReason:
    """Accept a provider/setup exception and return only an observational code.

    Typed status and bounded daemon envelopes carry classification, never
    request-outcome or replay authority; unknown metadata stays unknown.
    """
    from httpx import HTTPStatusError

    from core.plugin.impl.exc import PluginInvokeError
    from core.plugin.impl.model import _metadata_gateway_unavailable
    from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
    from services.tools.draft_tool_setup import DraftToolSetupError

    if isinstance(error, DraftToolSetupError) and error.setup_failure is not None:
        return error.setup_failure.reason
    if isinstance(error, PluginInvokeError) and _metadata_gateway_unavailable(error):
        return "service_unavailable"
    if isinstance(error, Exception) and plugin_activation_unavailable(error):
        return "service_unavailable"
    if isinstance(error, ConnectionRefusedError):
        return "connection_refused"
    if isinstance(error, TimeoutError):
        return "timeout"
    if isinstance(error, InvokeAuthorizationError):
        return "authentication"
    if isinstance(error, PermissionError):
        return "permission_denied"
    if isinstance(error, HTTPStatusError):
        if error.response.status_code == 401:
            return "authentication"
        if error.response.status_code == 403:
            return "permission_denied"
        if error.response.status_code == 429:
            return "rate_limit"
        if 500 <= error.response.status_code <= 599:
            return "service_unavailable"
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
    validation_details: Sequence[Mapping[str, Any]] | None = None,
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
            "http_status": failure_http_status(error) if code == "provider_invocation_failed" else None,
            "validation_codes": [validation_code] if validation_code else None,
            "validation_details": validation_details,
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
            try:
                provider = instance.provider
            except AttributeError:
                provider = None
            try:
                model = instance.model_name
            except AttributeError:
                model = None
            metadata = {"provider": provider, "model": model}
            if callback is not None:
                callback(project({**record, **metadata}))

        with scope(correlated if callback is not None else None, method.__name__.replace("_", "-")):
            result = method(self, *args, **kwargs)
            if callback is not None and method.__name__ == "build_nodes":
                try:
                    records = result.diagnostics
                except AttributeError:
                    records = ()
                generation(records)
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


def merge_current(history: Sequence[dict[str, Any]], current: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Retain the current read-only observation once within the existing Trace cap."""
    records: dict[str, dict[str, Any]] = {}
    truncated = False
    for record in (*history, *current):
        if record.get("code") == "diagnostics_truncated":
            truncated = True
            continue
        records.pop(record["id"], None)
        records[record["id"]] = record
    values = list(records.values())
    if truncated or len(values) > 32:
        return [project({"code": "diagnostics_truncated"}), *values[-32:]]
    return values
