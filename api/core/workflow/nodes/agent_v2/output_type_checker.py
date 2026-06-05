"""Per-output runtime type checker for Workflow Agent Node v2.

Stage 4 §5: after Agent backend returns ``run_succeeded.data.output`` (a JSON
object that already passed the ``dify.output`` layer's JSON Schema validation
inside pydantic-ai), the API side runs a *second* pass that:

1. Locates each declared output by name in the backend payload.
2. Asserts the value's shape against the declared ``DeclaredOutputType``
   (including array items and file ref objects).
3. For file outputs, validates the canonical file mapping contract and verifies
   any referenced file record resolves to a file owned by the current tenant
   (PRD §5.3 file output reference safety).

The checker is intentionally pure: it takes data in and returns a structured
outcome out. ``FileTenantValidator`` is injected as a Protocol so unit tests
can stub tenant resolution without DB access.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

from core.workflow.file_reference import is_canonical_file_reference, parse_file_reference
from graphon.file import FileTransferMethod
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
    """Verify one canonical file mapping resolves to an accessible tenant file."""

    def is_accessible_file_mapping(
        self,
        *,
        file_id: str,
        tenant_id: str,
        transfer_method: FileTransferMethod,
    ) -> bool: ...


class PerOutputTypeChecker:
    """Validate that each declared output is present and shaped correctly.

    The checker handles array items recursively and is opinionated about file
    refs: only canonical file mappings are accepted for Agent v2 output files.
    Stage 4 §5.2 + §5.3.
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
            return f"expected canonical file mapping object, got {type(value).__name__}"

        transfer_method_raw = value.get("transfer_method")
        if not isinstance(transfer_method_raw, str):
            return "file mapping missing transfer_method"

        try:
            transfer_method = FileTransferMethod.value_of(transfer_method_raw)
        except ValueError:
            return f"unsupported file transfer_method {transfer_method_raw!r}"

        expected_keys = {"transfer_method", "url"} if transfer_method == FileTransferMethod.REMOTE_URL else {
            "transfer_method",
            "reference",
        }
        actual_keys = set(value)
        if actual_keys != expected_keys:
            unexpected_keys = sorted(actual_keys - expected_keys)
            missing_keys = sorted(expected_keys - actual_keys)
            details: list[str] = []
            if missing_keys:
                details.append(f"missing {', '.join(missing_keys)}")
            if unexpected_keys:
                details.append(f"unexpected {', '.join(unexpected_keys)}")
            return f"{transfer_method.value} file mapping must contain exactly {sorted(expected_keys)} ({'; '.join(details)})"

        if transfer_method == FileTransferMethod.REMOTE_URL:
            url = value.get("url")
            if not isinstance(url, str) or not url:
                return "remote_url file mapping missing url"
            return None

        reference = value.get("reference")
        if not isinstance(reference, str) or not reference:
            return f"{transfer_method.value} file mapping missing reference"
        if not is_canonical_file_reference(reference):
            return f"{transfer_method.value} file mapping has invalid canonical reference"

        parsed_reference = parse_file_reference(reference)
        if parsed_reference is None:
            return f"{transfer_method.value} file mapping has invalid canonical reference"
        file_id = parsed_reference.record_id
        if not self._file_validator.is_accessible_file_mapping(
            file_id=file_id,
            tenant_id=tenant_id,
            transfer_method=transfer_method,
        ):
            return f"file reference {reference!r} is not accessible to tenant {tenant_id!r}"
        return None
