"""Pure, loss-aware interpretation of the optional A2A Traceability extension.

Remote IDs never establish ownership. Missing fields remain missing, raw data is
redacted before persistence, and an invalid observation cannot fail its business
task. This module does not use the private Dify AgentTraceBatch wire contract.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from enum import StrEnum
from itertools import islice
from typing import Any
from urllib.parse import parse_qsl, urlsplit

TRACEABILITY_URI = "https://github.com/a2aproject/a2a-samples/extensions/traceability/v1"
TRACEABILITY_METADATA_KEY = "github.com/a2aproject/a2a-samples/extensions/traceability/v1/traceability"
_SECRET_KEYS = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "api_key",
        "apikey",
        "secret",
        "secret_key",
        "password",
        "access_token",
        "refresh_token",
        "credentials",
        "token",
        "bearer",
    }
)
_FILE_BODY_KEYS = frozenset({"raw", "bytes", "base64"})
_URL_SECRET = re.compile(r"(?:token|secret|signature|credential|authorization|api.?key|^sig$)", re.IGNORECASE)
_HTTP_URL = re.compile(r"https?://[^\s<>\"']+")


class TraceState(StrEnum):
    NOT_REQUESTED = "not_requested"
    COLLECTING = "collecting"
    RECEIVED = "received"
    EMPTY = "empty"
    NOT_RETURNED = "not_returned"
    UNAVAILABLE = "unavailable"


class TracePayloadError(ValueError):
    """A safe error code; never includes untrusted payloads or credentials."""


@dataclass(frozen=True, slots=True)
class TraceLimits:
    max_steps: int = 4096
    max_bytes: int = 16 * 1024 * 1024
    max_depth: int = 12
    max_string_chars: int = 16000
    max_array_items: int = 256


@dataclass(frozen=True, slots=True)
class ReportedCallUsage:
    """Adapter-proven call-scoped usage; absence of proof is not zero usage."""

    total_tokens: int
    source_path: str
    adapter: str

    def __post_init__(self) -> None:
        if type(self.total_tokens) is not int or not 0 <= self.total_tokens <= 2**63 - 1:
            raise ValueError("invalid_call_usage")
        if not 0 < len(self.source_path) <= 512 or not 0 < len(self.adapter) <= 128:
            raise ValueError("call_usage_provenance_required")


@dataclass(frozen=True, slots=True)
class ExternalTraceStep:
    key: str
    payload_hash: str
    trace_path: tuple[str, ...]
    trace_id: str
    step_id: str
    parent_step_id: str | None
    resolved_parent_key: str | None
    kind: str | None
    name: str | None
    started_at: datetime | None
    ended_at: datetime | None
    status: str | None
    error: str | None
    total_tokens: int | None
    raw_data: Mapping[str, Any]

    @property
    def duration_seconds(self) -> float | None:
        if self.started_at is None or self.ended_at is None or self.ended_at < self.started_at:
            return None
        return (self.ended_at - self.started_at).total_seconds()


@dataclass(frozen=True, slots=True)
class NormalizedExternalTrace:
    source_id: str
    payload_hash: str
    dialect: str
    state: TraceState
    steps: tuple[ExternalTraceStep, ...]
    diagnostics: tuple[str, ...]
    raw_data: Mapping[str, Any]


def _redacted_url(match: re.Match[str]) -> str:
    value = match.group(0)
    try:
        parsed = urlsplit(value)
        secret = parsed.username is not None or parsed.password is not None
        secret = secret or any(_URL_SECRET.search(key) for key, _ in parse_qsl(parsed.query))
        return "[redacted URL]" if secret else value
    except ValueError:
        return "[redacted URL]"


def redact_trace_data(value: object, *, limits: TraceLimits, secrets: Sequence[str] = (), depth: int = 0) -> Any:
    """Return bounded JSON with credentials and reusable file bodies removed.

    Inputs are untrusted JSON and transient known secrets. No I/O occurs; the
    result, including content-enabled traces, never retains these secret values.
    """
    if depth > limits.max_depth:
        return "[truncated]"
    if isinstance(value, Mapping):
        return {
            str(key)[:256]: "[redacted]"
            if str(key).lower() in _SECRET_KEYS | _FILE_BODY_KEYS
            else redact_trace_data(item, limits=limits, secrets=secrets, depth=depth + 1)
            for key, item in islice(value.items(), limits.max_array_items)
        }
    if isinstance(value, (list, tuple)):
        return [
            redact_trace_data(item, limits=limits, secrets=secrets, depth=depth + 1)
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
                    redact_trace_data(nested, limits=limits, secrets=secrets, depth=depth + 1), ensure_ascii=False
                )
        result = _HTTP_URL.sub(_redacted_url, value)
        for secret in secrets:
            if secret:
                result = result.replace(secret, "[redacted]")
        return result[: limits.max_string_chars] + ("[truncated]" if len(result) > limits.max_string_chars else "")
    if isinstance(value, float) and not math.isfinite(value):
        return "[invalid number]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return "[unsupported value]"


def _text(value: object, *, maximum: int = 512) -> str | None:
    return value if isinstance(value, str) and 0 < len(value) <= maximum else None


def _identity(value: object, *, limits: TraceLimits, secrets: Sequence[str]) -> str | None:
    candidate = _text(value)
    if candidate is None or redact_trace_data(candidate, limits=limits, secrets=secrets) != candidate:
        return None
    return candidate


def _timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value)
        return result.astimezone(UTC) if result.tzinfo is not None else None
    except (ValueError, OverflowError):
        return None


def _tokens(value: object) -> int | None:
    # Protobuf JSON encodes int64 as a decimal string. Never coerce bool/float.
    candidate = (
        int(value) if isinstance(value, str) and len(value) <= 19 and value.isascii() and value.isdecimal() else value
    )
    return candidate if type(candidate) is int and 0 <= candidate <= 2**63 - 1 else None


def _step_key(path: tuple[str, ...], trace_id: str, step_id: str) -> str:
    return hashlib.sha256(json.dumps([path, trace_id, step_id], ensure_ascii=True).encode()).hexdigest()


def _call_kind(value: object) -> str | None:
    if type(value) is int:
        return {1: "agent", 2: "tool"}.get(value)
    return {"AGENT": "agent", "TOOL": "tool", "HOST": "host"}.get(str(value))


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _known_name(step: Mapping[str, Any]) -> str | None:
    action = _mapping(step.get("step_action"))
    tool = _mapping(action.get("tool_invocation"))
    agent = _mapping(action.get("agent_invocation"))
    return _text(tool.get("tool_name")) or _text(agent.get("agent_name")) or _text(step.get("name"))


def resolve_step_parents(steps: Sequence[ExternalTraceStep]) -> tuple[ExternalTraceStep, ...]:
    """Resolve only reported, present and acyclic parents within one trace path."""
    keys = {step.key for step in steps}
    parents = {
        step.key: _step_key(step.trace_path, step.trace_id, step.parent_step_id)
        for step in steps
        if step.parent_step_id
    }

    def acyclic(key: str, seen: frozenset[str]) -> bool:
        current = parents.get(key)
        visited = set(seen)
        while current is not None and current in keys and current not in visited:
            visited.add(current)
            current = parents.get(current)
        return current is None or current not in keys

    return tuple(
        replace(step, resolved_parent_key=parents[step.key])
        if step.key in parents and parents[step.key] in keys and acyclic(step.key, frozenset({step.key}))
        else step
        for step in steps
    )


class TraceabilityNormalizer:
    def __init__(self, limits: TraceLimits) -> None:
        self._limits = limits

    def normalize(self, payload: object, *, source_id: str, secrets: Sequence[str] = ()) -> NormalizedExternalTrace:
        """Normalize a single explicitly identified trace carrier without I/O.

        Preconditions: the caller associated the carrier with an owned Invocation.
        Postconditions: nullable fields and source identities are preserved;
        malformed trace data produces a diagnostic, never a business exception.
        """
        if len(source_id) > 512 or redact_trace_data(source_id, limits=self._limits, secrets=secrets) != source_id:
            source_id = f"redacted-carrier:{hashlib.sha256(source_id.encode()).hexdigest()}"
        try:
            encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
        except (ValueError, TypeError, RecursionError):
            return self._invalid(source_id, "invalid_trace_json")
        digest = hashlib.sha256(encoded).hexdigest()
        if len(encoded) > self._limits.max_bytes:
            return self._invalid(source_id, "trace_payload_limit", digest)
        data = _mapping(payload)
        trace_id = _identity(data.get("trace_id"), limits=self._limits, secrets=secrets)
        if trace_id is None or not isinstance(data.get("steps"), list):
            return self._invalid(source_id, "invalid_trace_envelope", digest)
        steps: dict[str, ExternalTraceStep] = {}
        diagnostics: list[str] = []
        dialects: set[str] = set()
        visited = 0

        def read_trace(trace: Mapping[str, Any], path: tuple[str, ...], depth: int) -> None:
            current_trace = _identity(trace.get("trace_id"), limits=self._limits, secrets=secrets)
            values = trace.get("steps")
            if depth > self._limits.max_depth:
                diagnostics.append("trace_depth_limit")
            elif current_trace is None or not isinstance(values, list):
                diagnostics.append("invalid_nested_trace")
            else:
                if len(values) > self._limits.max_steps:
                    diagnostics.append("trace_step_limit")
                for item in values[: self._limits.max_steps]:
                    read_step(_mapping(item), path, current_trace, depth)

        def read_step(step: Mapping[str, Any], path: tuple[str, ...], current_trace: str, depth: int) -> None:
            nonlocal visited
            visited += 1
            identifier = _identity(step.get("step_id"), limits=self._limits, secrets=secrets)
            declared_trace = _identity(step.get("trace_id"), limits=self._limits, secrets=secrets)
            if visited > self._limits.max_steps:
                if "trace_step_limit" not in diagnostics:
                    diagnostics.append("trace_step_limit")
            elif identifier is None:
                diagnostics.append("missing_step_identity")
            elif declared_trace is not None and declared_trace != current_trace:
                diagnostics.append("step_trace_mismatch")
            elif len(steps) >= self._limits.max_steps:
                diagnostics.append("trace_step_limit")
            else:
                sample_fields = {"name", "parameters", "requests", "step_type", "error"}
                dialect = (
                    "python_sample_v1"
                    if "step_action" not in step
                    and (bool(sample_fields.intersection(step)) or step.get("call_type") == "HOST")
                    else "spec_v1"
                )
                dialects.add(dialect)
                raw = redact_trace_data(step, limits=self._limits, secrets=secrets)
                key = _step_key(path, current_trace, identifier)
                error = _text(raw.get("error"), maximum=self._limits.max_string_chars)
                status = _text(raw.get("status"), maximum=64)
                normalized = ExternalTraceStep(
                    key=key,
                    payload_hash=hashlib.sha256(json.dumps(step, sort_keys=True).encode()).hexdigest(),
                    trace_path=path,
                    trace_id=current_trace,
                    step_id=identifier,
                    parent_step_id=_identity(step.get("parent_step_id"), limits=self._limits, secrets=secrets),
                    resolved_parent_key=None,
                    kind=_call_kind(step.get("call_type")),
                    name=_known_name(raw),
                    started_at=_timestamp(step.get("start_time")),
                    ended_at=_timestamp(step.get("end_time")),
                    status=status,
                    error=error,
                    total_tokens=_tokens(step.get("total_tokens")),
                    raw_data=raw,
                )
                previous = steps.get(key)
                if previous is None:
                    steps[key] = normalized
                elif previous != normalized:
                    diagnostics.append("step_identity_conflict")
                action = _mapping(step.get("step_action"))
                nested = _mapping(_mapping(action.get("agent_invocation")).get("response_trace"))
                if nested:
                    read_trace(nested, (*path, identifier), depth + 1)

        read_trace(data, (), 0)
        state = TraceState.RECEIVED if steps else TraceState.UNAVAILABLE if diagnostics else TraceState.EMPTY
        return NormalizedExternalTrace(
            source_id=source_id,
            payload_hash=digest,
            dialect="mixed_v1" if len(dialects) > 1 else next(iter(dialects), "spec_v1"),
            state=state,
            steps=resolve_step_parents(list(steps.values())),
            diagnostics=tuple(dict.fromkeys(diagnostics)),
            raw_data=redact_trace_data(data, limits=self._limits, secrets=secrets),
        )

    @staticmethod
    def _invalid(source_id: str, code: str, digest: str = "") -> NormalizedExternalTrace:
        return NormalizedExternalTrace(source_id, digest, "unknown", TraceState.UNAVAILABLE, (), (code,), {})


def extract_trace_payloads(response: Mapping[str, Any]) -> tuple[tuple[str, object], ...]:
    """Extract only the exact metadata extension key from known A2A carriers.

    Dedicated artifacts require the tested explicit extension URI and data-only
    ResponseTrace part shape. Names never classify artifacts. File bytes and
    arbitrary nested business data are not traversed.
    """
    found: list[tuple[str, object]] = []

    def read(carrier: Mapping[str, Any], fallback: str) -> None:
        metadata = _mapping(carrier.get("metadata"))
        identifier = _text(carrier.get("messageId")) or _text(carrier.get("artifactId")) or fallback
        if TRACEABILITY_METADATA_KEY in metadata:
            found.append((identifier, metadata[TRACEABILITY_METADATA_KEY]))

    read(response, "response")
    task = _mapping(response.get("task"))
    message = _mapping(response.get("message"))
    if message:
        read(message, "message")
    if task:
        read(task, "task")
    for owner in (response, task):
        artifacts = owner.get("artifacts")
        if isinstance(artifacts, list):
            for index, artifact in enumerate(artifacts):
                item = _mapping(artifact)
                read(item, f"artifact:{index}")
                parts, extensions = item.get("parts"), item.get("extensions")
                explicit = isinstance(extensions, list) and TRACEABILITY_URI in extensions
                data_only = (
                    isinstance(parts, list)
                    and bool(parts)
                    and all(
                        isinstance(part, Mapping)
                        and isinstance(part.get("data"), Mapping)
                        and set(part["data"]) == {"trace_id", "steps"}
                        for part in parts
                    )
                )
                if explicit and data_only:
                    identifier = _text(item.get("artifactId")) or f"artifact:{index}"
                    for part_index, part in enumerate(parts):
                        found.append((f"{identifier}:part:{part_index}", part["data"]))
        status = _mapping(owner.get("status"))
        status_message = _mapping(status.get("message"))
        if status_message:
            read(status_message, "status-message")
    return tuple(found)


def merge_step(previous: ExternalTraceStep, incoming: ExternalTraceStep) -> tuple[ExternalTraceStep, bool]:
    """Enrich missing values only; conflicting observations preserve the first.

    Preconditions: both records name the same owned step. A different original
    fingerprint cannot become a successful replay merely through redaction.
    Postconditions: old non-null values survive stale or contradictory snapshots.
    The returned boolean reports conflict and never affects business execution.
    """
    if previous.key != incoming.key:
        raise ValueError("step_identity_mismatch")
    if previous.payload_hash == incoming.payload_hash:
        return previous, False

    def merged(old: Any, new: Any) -> tuple[Any, bool]:
        if old is None:
            return new, False
        if new is None:
            return old, False
        if isinstance(old, Mapping) and isinstance(new, Mapping):
            pairs = {key: merged(old.get(key), new.get(key)) for key in old.keys() | new.keys()}
            return {key: value[0] for key, value in pairs.items()}, any(value[1] for value in pairs.values())
        same = type(old) is type(new) and old == new
        return old, not same

    raw, conflict = merged(previous.raw_data, incoming.raw_data)
    before = {
        "parent_step_id": previous.parent_step_id,
        "kind": previous.kind,
        "name": previous.name,
        "started_at": previous.started_at,
        "ended_at": previous.ended_at,
        "status": previous.status,
        "error": previous.error,
        "total_tokens": previous.total_tokens,
    }
    after = {
        "parent_step_id": incoming.parent_step_id,
        "kind": incoming.kind,
        "name": incoming.name,
        "started_at": incoming.started_at,
        "ended_at": incoming.ended_at,
        "status": incoming.status,
        "error": incoming.error,
        "total_tokens": incoming.total_tokens,
    }
    values: dict[str, Any] = {}
    for field in before:
        value, contradicted = merged(before[field], after[field])
        values[field] = value
        conflict = conflict or contradicted
    changed = raw != previous.raw_data or any(before[key] != value for key, value in values.items())
    # Only a validated missing->known enrichment changes the original fingerprint.
    conflict = conflict or not changed
    return (
        (previous, True)
        if conflict
        else (replace(previous, payload_hash=incoming.payload_hash, raw_data=raw, **values), False)
    )
