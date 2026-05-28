"""Per-output runtime type checker for Workflow Agent Node v2.

Stage 4 §5: after Agent backend returns ``run_succeeded.data.output`` (a JSON
object that already passed the ``dify.output`` layer's JSON Schema validation
inside pydantic-ai), the API side runs a *second* pass that:

1. Locates each declared output by name in the backend payload.
2. Asserts the value's shape against the declared ``DeclaredOutputType``
   (including array items and file ref objects).
3. For file outputs, verifies the referenced ``file_id`` resolves to a file
   owned by the current tenant (PRD §5.3 file output reference safety).

The checker is intentionally pure: it takes data in and returns a structured
outcome out. ``FileTenantValidator`` is injected as a Protocol so unit tests
can stub tenant resolution without DB access.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

from models.agent_config_entities import (
    DeclaredArrayItem,
    DeclaredOutputConfig,
    DeclaredOutputType,
)


class OutputTypeCheckStatus(StrEnum):
    """Lifecycle status of a single declared output after type check."""

    READY = "ready"
    NOT_PRODUCED = "not_produced"
    TYPE_CHECK_FAILED = "type_check_failed"


@dataclass(frozen=True, slots=True)
class OutputTypeCheckResult:
    """Outcome of type-checking one declared output.

    ``value`` carries the raw payload value as it appeared in the backend
    response. For ``TYPE_CHECK_FAILED`` results the value is preserved so the
    Failure Orchestrator can decide whether to surface it (e.g. for debug
    metadata) — it is **not** safe to feed into downstream nodes.
    """

    name: str
    declared_type: DeclaredOutputType
    status: OutputTypeCheckStatus
    value: Any
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class OutputTypeCheckOutcome:
    """Aggregate per-output type-check results for one Agent backend run."""

    results: tuple[OutputTypeCheckResult, ...]

    @property
    def failures(self) -> tuple[OutputTypeCheckResult, ...]:
        return tuple(r for r in self.results if r.status == OutputTypeCheckStatus.TYPE_CHECK_FAILED)

    @property
    def has_failures(self) -> bool:
        return bool(self.failures)

    def by_name(self) -> dict[str, OutputTypeCheckResult]:
        return {r.name: r for r in self.results}


class FileTenantValidator(Protocol):
    """Verify a file ref resolves to a file owned by the given tenant."""

    def is_owned_by_tenant(self, *, file_id: str, tenant_id: str) -> bool: ...


# Recognized aliases the Agent backend (or pydantic-ai) may produce for the
# canonical file id field. The canonical spec form is ``file_id`` (§5.2).
_FILE_ID_KEYS: tuple[str, ...] = ("file_id", "upload_file_id", "tool_file_id")


class PerOutputTypeChecker:
    """Validate that each declared output is present and shaped correctly.

    The checker handles array items recursively and is opinionated about file
    refs: only dicts with at least one recognized id key plus a tenant-scope
    match pass. Stage 4 §5.2 + §5.3.
    """

    def __init__(self, file_validator: FileTenantValidator) -> None:
        self._file_validator = file_validator

    def check(
        self,
        *,
        declared_outputs: list[DeclaredOutputConfig],
        raw_output: Mapping[str, Any] | Any,
        tenant_id: str,
    ) -> OutputTypeCheckOutcome:
        """Run type check for every declared output.

        ``raw_output`` should be ``run_succeeded.data.output``. The backend
        always returns a dict because the ``dify.output`` layer wraps every
        schema in a top-level object; if it isn't a dict (e.g. backend
        misbehaving) every required output is flagged as ``TYPE_CHECK_FAILED``.
        """
        results: list[OutputTypeCheckResult] = []
        payload = raw_output if isinstance(raw_output, Mapping) else None

        for declared in declared_outputs:
            if payload is None:
                results.append(
                    OutputTypeCheckResult(
                        name=declared.name,
                        declared_type=declared.type,
                        status=OutputTypeCheckStatus.TYPE_CHECK_FAILED,
                        value=raw_output,
                        reason="Backend output is not a JSON object.",
                    )
                )
                continue
            if declared.name not in payload:
                if declared.required:
                    results.append(
                        OutputTypeCheckResult(
                            name=declared.name,
                            declared_type=declared.type,
                            status=OutputTypeCheckStatus.TYPE_CHECK_FAILED,
                            value=None,
                            reason=f"Required output {declared.name!r} is missing from backend payload.",
                        )
                    )
                else:
                    results.append(
                        OutputTypeCheckResult(
                            name=declared.name,
                            declared_type=declared.type,
                            status=OutputTypeCheckStatus.NOT_PRODUCED,
                            value=None,
                        )
                    )
                continue

            value = payload[declared.name]
            failure_reason = self._validate_value(
                declared_type=declared.type,
                value=value,
                tenant_id=tenant_id,
                array_item=declared.array_item,
            )
            if failure_reason is None:
                results.append(
                    OutputTypeCheckResult(
                        name=declared.name,
                        declared_type=declared.type,
                        status=OutputTypeCheckStatus.READY,
                        value=value,
                    )
                )
            else:
                results.append(
                    OutputTypeCheckResult(
                        name=declared.name,
                        declared_type=declared.type,
                        status=OutputTypeCheckStatus.TYPE_CHECK_FAILED,
                        value=value,
                        reason=failure_reason,
                    )
                )

        return OutputTypeCheckOutcome(results=tuple(results))

    def _validate_value(
        self,
        *,
        declared_type: DeclaredOutputType,
        value: Any,
        tenant_id: str,
        array_item: DeclaredArrayItem | None,
    ) -> str | None:
        """Return ``None`` on success, or a human-readable failure reason."""
        if declared_type == DeclaredOutputType.STRING:
            if not isinstance(value, str):
                return f"expected string, got {type(value).__name__}"
            return None
        if declared_type == DeclaredOutputType.NUMBER:
            # ``bool`` is a subclass of int in Python; PRD treats numbers as
            # strictly numeric so we reject bools here.
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                return f"expected number, got {type(value).__name__}"
            return None
        if declared_type == DeclaredOutputType.BOOLEAN:
            if not isinstance(value, bool):
                return f"expected boolean, got {type(value).__name__}"
            return None
        if declared_type == DeclaredOutputType.OBJECT:
            if not isinstance(value, Mapping):
                return f"expected object, got {type(value).__name__}"
            return None
        if declared_type == DeclaredOutputType.ARRAY:
            if not isinstance(value, list):
                return f"expected array, got {type(value).__name__}"
            if array_item is None:
                # Defensive: the model validator should have populated this; if
                # absent, accept any items rather than crash.
                return None
            for index, item in enumerate(value):
                item_reason = self._validate_value(
                    declared_type=array_item.type,
                    value=item,
                    tenant_id=tenant_id,
                    array_item=None,
                )
                if item_reason is not None:
                    return f"items[{index}]: {item_reason}"
            return None
        if declared_type == DeclaredOutputType.FILE:
            return self._validate_file_value(value=value, tenant_id=tenant_id)

        # Defensive: future DeclaredOutputType members reach this branch and
        # should fail loudly so we never silently accept unknown shapes.
        return f"unsupported declared_type={declared_type!r}"

    def _validate_file_value(self, *, value: Any, tenant_id: str) -> str | None:
        if not isinstance(value, Mapping):
            return f"expected file ref object, got {type(value).__name__}"
        file_id = self._extract_file_id(value)
        if file_id is None:
            return "file ref missing a recognized file_id field"
        if not self._file_validator.is_owned_by_tenant(file_id=file_id, tenant_id=tenant_id):
            return f"file_id {file_id!r} is not accessible to tenant {tenant_id!r}"
        return None

    @staticmethod
    def _extract_file_id(value: Mapping[str, Any]) -> str | None:
        for key in _FILE_ID_KEYS:
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate:
                return candidate
        return None
