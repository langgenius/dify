"""Finite content projection for explicitly authorized External trace targets.

Projection never loads a file or follows a URL. Persisted admitted input and
validated output remain distinct from remote operation parameters and metadata.
"""

import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from itertools import islice
from urllib.parse import parse_qsl, urlsplit

from pydantic import JsonValue, TypeAdapter

from .contracts import ExternalAuthType
from .io_contracts import JsonObject
from .traceability import (
    TRACE_KEY_MAX_CHARS,
    TraceLimits,
    is_protected_trace_field,
    redact_trace_data,
    redact_trace_key,
)

_HTTP_URL = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
_DATA_URL = re.compile(r"(?<![A-Za-z0-9_])data:[^,\s<>\"']*,[^\s<>\"']*", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class ExternalTraceContentSource:
    """Owned frozen values; None means unavailable evidence, never empty content."""

    parts: tuple[JsonObject, ...] | None = field(repr=False)
    outputs: JsonObject | None = field(repr=False)
    auth_type: ExternalAuthType | None


@dataclass(frozen=True, slots=True)
class ExternalTraceContentProjection:
    """Projected content plus factual budget suppression, without retaining raw values."""

    value: JsonValue
    budget_exceeded: bool


def admitted_trace_parts(value: object) -> tuple[JsonObject, ...] | None:
    """Validate the stored admitted-parts profile without resolving file references.

    Preconditions: value is read from the fenced Invocation snapshot.
    Postconditions: only text or exact internal file-reference records succeed;
    absent, malformed or wire-shaped content remains unavailable.
    """
    if not isinstance(value, (list, tuple)):
        return None
    result: list[JsonObject] = []
    for item in value:
        if not isinstance(item, dict):
            return None
        text, reference = item.get("text"), item.get("fileRef")
        if set(item) == {"text"} and isinstance(text, str):
            result.append({"text": text})
        elif set(item) == {"fileRef"} and isinstance(reference, dict):
            identifier, kind = reference.get("file_id"), reference.get("kind")
            if (
                set(reference) != {"file_id", "kind"}
                or not isinstance(identifier, str)
                or not identifier
                or not isinstance(kind, str)
                or kind not in {"upload", "tool", "datasource"}
            ):
                return None
            result.append({"fileRef": {"file_id": identifier, "kind": kind}})
        else:
            return None
    return tuple(result)


def root_trace_inputs(source: ExternalTraceContentSource) -> JsonObject | None:
    """Project resolved text and ordered internal references from this Invocation.

    Preconditions: source.parts passed admitted_trace_parts. Postconditions:
    no current variable, file content, storage key or reusable URL is consulted.
    """
    if source.parts is None:
        return None
    texts = [part.get("text") for part in source.parts]
    result: JsonObject = {"agent_task": "".join(text for text in texts if isinstance(text, str))}
    references = [part["fileRef"] for part in source.parts if "fileRef" in part]
    if references:
        result["file_refs"] = references
    return result


def operation_trace_input(raw: Mapping[str, object], *, kind: str | None) -> object:
    """Select only specified request fields in supported Traceability dialects.

    Preconditions: raw is a persisted sanitized step. Postconditions: tool
    parameters or agent requests are selected without metadata fallback. The
    spec and Python sample define no operation output, so none is inferred.
    """
    field_name = "parameters" if kind == "tool" else "requests" if kind == "agent" else None
    if field_name is None:
        return None
    if "step_action" in raw:
        action = raw["step_action"]
        invocation = (
            action.get("tool_invocation" if kind == "tool" else "agent_invocation")
            if isinstance(action, dict)
            else None
        )
        return invocation.get(field_name) if isinstance(invocation, dict) else None
    # This is the same explicit Python-sample dialect recognized by ingestion.
    if any(key in raw for key in ("name", "parameters", "requests", "step_type", "error")):
        return raw.get(field_name)
    return None


def _signed_url(match: re.Match[str]) -> str:
    """Apply the credential-URL policy and Dify preview rule to a complete URL."""
    value = match.group(0)
    try:
        if any(key.lower() == "sign" for key, _ in parse_qsl(urlsplit(value).query)):
            return "[redacted URL]"
        scheme, separator, rest = value.partition("://")
        normalized = scheme.lower() + separator + rest
        checked = redact_trace_data(normalized, limits=TraceLimits(max_string_chars=len(normalized)))
        return value if checked == normalized else "[redacted URL]"
    except ValueError:
        return "[redacted URL]"


def _scrub_text(value: str, secrets: Sequence[str]) -> str:
    """Remove text authority and known secrets before key or value truncation.

    Preconditions: text came from a JSON value within the admitted byte budget.
    Postconditions: keys and values share URI handling without interpreting
    opaque keys as nested JSON or changing ordinary URL spelling.
    """
    result = _DATA_URL.sub("[redacted file]", _HTTP_URL.sub(_signed_url, value))
    for secret in secrets:
        result = result.replace(secret, "[redacted]") if secret else result
    return result


def _without_file_authority(value: object, *, limits: TraceLimits, secrets: Sequence[str], depth: int = 0) -> JsonValue:
    """Strip file authority and secrets before bounding each admitted JSON value.

    Redacted object keys may collide; the later value wins only in this export
    projection. The stored business output is never modified.
    """
    if depth > limits.max_depth:
        return "[truncated]"
    if isinstance(value, Mapping):
        if value.get("dify_model_identity") == "__dify__file__":
            # Trusted file values are summaries, never download capabilities.
            summary = {
                key: item
                for key, item in value.items()
                if key in {"filename", "mime_type", "type"}
                and isinstance(item, str)
                or key == "size"
                and type(item) is int
                and item >= 0
            }
            return _without_file_authority(summary, limits=limits, secrets=secrets, depth=depth + 1)
        return {
            _safe_key(str(key), secrets): "[redacted]"
            if is_protected_trace_field(str(key))
            else _without_file_authority(item, limits=limits, secrets=secrets, depth=depth + 1)
            for key, item in islice(value.items(), limits.max_array_items)
        }
    if isinstance(value, (list, tuple)):
        return [
            _without_file_authority(item, limits=limits, secrets=secrets, depth=depth + 1)
            for item in value[: limits.max_array_items]
        ]
    if isinstance(value, str):
        if value.lstrip().startswith(("{", "[")) and len(value) <= limits.max_string_chars:
            try:
                nested = json.loads(value)
            except (ValueError, RecursionError):
                nested = None
            if isinstance(nested, (dict, list)):
                return json.dumps(
                    redact_trace_data(
                        _without_file_authority(nested, limits=limits, secrets=secrets, depth=depth + 1),
                        limits=limits,
                        secrets=secrets,
                    ),
                    ensure_ascii=False,
                )
        scrubbed = _scrub_text(value, secrets)
        return scrubbed[: limits.max_string_chars] + ("[truncated]" if len(scrubbed) > limits.max_string_chars else "")
    if isinstance(value, float) and not math.isfinite(value):
        return "[invalid number]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return "[unsupported value]"


def _safe_key(key: str, secrets: Sequence[str]) -> str:
    """Scrub opaque keys, conservatively de-identifying old truncation bounds.

    Exact-bound retained keys may have lost the end of a credential under older
    ingestion. Their original identity is unavailable, so export only a marker.
    """
    if len(key) == TRACE_KEY_MAX_CHARS:
        return "[redacted key]"
    return redact_trace_key(_scrub_text(key, ()), secrets=secrets)


def safe_trace_content(value: object, *, limits: TraceLimits, secrets: Sequence[str]) -> JsonValue:
    """Return bounded JSON without credentials, file bodies or signed preview URLs.

    Preconditions: a frozen target permits capture and pinned credential facts
    are available. Postconditions: valid zero, false and empty JSON values remain
    present; only explicit None is absent. This function performs no I/O.
    """
    return project_trace_content(value, limits=limits, secrets=secrets).value


def project_trace_content(
    value: object, *, limits: TraceLimits, secrets: Sequence[str]
) -> ExternalTraceContentProjection:
    """Project authorized JSON while retaining the finite reason for budget loss.

    Preconditions: the same frozen permission/redaction requirements as
    safe_trace_content hold. Postconditions: no raw values are added to status
    evidence; invalid/absent content is distinct from a byte-budget rejection.
    """
    try:
        if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode()) > limits.max_bytes:
            return ExternalTraceContentProjection(None, True)
    except (TypeError, ValueError, RecursionError):
        return ExternalTraceContentProjection(None, False)
    stripped = _without_file_authority(value, limits=limits, secrets=secrets)
    result = TypeAdapter(JsonValue).validate_python(redact_trace_data(stripped, limits=limits, secrets=secrets))
    if len(json.dumps(result, ensure_ascii=False, allow_nan=False).encode()) > limits.max_bytes:
        return ExternalTraceContentProjection(None, True)
    return ExternalTraceContentProjection(result, False)
