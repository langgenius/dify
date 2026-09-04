"""Opt-in DIFY-2966 transport soak against a deployed E2B Agent Backend.

The formal profile intentionally keeps its 32-way concurrency gate fixed. The
``DIFY_AGENT_TEST_SOAK_*`` numeric overrides exist only for harness development;
the JSONL ledger labels every non-default run as ``formal_gate=false``.

E2B 2.38's public async API supports metadata-filtered pagination and a static
kill-by-id operation, which lets the final reconciliation stay scoped to the
run marker created by this test:
https://github.com/e2b-dev/E2B/blob/%40e2b/python-sdk%402.38.0/packages/python-sdk/e2b/sandbox_async/sandbox_api.py
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from types import TracebackType
from typing import IO, Self, cast

import pytest

from dify_agent.client import Client, DifyAgentHTTPError
from dify_agent.protocol import CreateExecutionBindingRequest, DestroyExecutionBindingRequest

pytestmark = pytest.mark.integration

_FORMAL_CONCURRENCY = 32
_FORMAL_BURST_ROUNDS = 10
_FORMAL_IDLE_BINDINGS = 32
_FORMAL_IDLE_INTERVAL_SECONDS = 600.0
_FORMAL_IDLE_ROUNDS = 12
_DEFAULT_REQUEST_TIMEOUT_SECONDS = 180.0
_DEFAULT_RECONCILE_TIMEOUT_SECONDS = 60.0
_RECONCILE_POLL_SECONDS = 2.0
_RECONCILE_FINAL_PROOF_RESERVE_SECONDS = 10.0
_RECONCILE_STABLE_EMPTY_SECONDS = 3.0
_RECONCILE_FINAL_SCAN_INTERVAL_SECONDS = 0.5
_RECONCILE_RETRY_BACKOFF_SECONDS = 0.1
_TENANT_ID = "dify-2966-transport-soak"
# Binding file reads intentionally reject symlinks via O_NOFOLLOW. `/etc/os-release`
# is a symlink in the E2B image, while `/etc/hostname` is a small regular file.
_READ_PROBE_PATH = "/etc/hostname"
_RUN_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,47}\Z")
_REDACTED = "[REDACTED]"
_SECRET_KEY_PARTS = ("api_key", "authorization", "password", "secret", "token")


@dataclass(frozen=True, slots=True)
class _SoakSettings:
    service_url: str
    service_token: str
    e2b_api_key: str
    run_id: str
    artifact: Path
    concurrency: int
    burst_rounds: int
    idle_bindings: int
    idle_interval_seconds: float
    idle_rounds: int
    request_timeout_seconds: float
    reconcile_timeout_seconds: float

    @property
    def binding_prefix(self) -> str:
        return f"dify-2966-{self.run_id}-"

    @property
    def formal_gate(self) -> bool:
        return (
            self.concurrency == _FORMAL_CONCURRENCY
            and self.burst_rounds == _FORMAL_BURST_ROUNDS
            and self.idle_bindings == _FORMAL_IDLE_BINDINGS
            and self.idle_interval_seconds == _FORMAL_IDLE_INTERVAL_SECONDS
            and self.idle_rounds == _FORMAL_IDLE_ROUNDS
            and self.request_timeout_seconds == _DEFAULT_REQUEST_TIMEOUT_SECONDS
            and self.reconcile_timeout_seconds == _DEFAULT_RECONCILE_TIMEOUT_SECONDS
        )


@dataclass(frozen=True, slots=True)
class _Binding:
    binding_id: str
    binding_ref: str
    workspace_ref: str


@dataclass(frozen=True, slots=True)
class _OwnedSandbox:
    sandbox_id: str
    binding_id: str
    workspace_id: str
    state: str


_ListOwnedSandboxes = Callable[[_SoakSettings], Awaitable[list[_OwnedSandbox]]]
_KillOwnedSandbox = Callable[[_SoakSettings, str], Awaitable[bool]]
_Sleep = Callable[[float], Awaitable[None]]
_Monotonic = Callable[[], float]


class _JsonlLedger:
    """Flush one sanitized JSON object per line to an exclusive artifact."""

    _handle: IO[str]
    _secrets: tuple[str, ...]

    def __init__(self, path: Path, *, secrets: Sequence[str]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._handle = path.open("x", encoding="utf-8")
        self._secrets = tuple(secret for secret in secrets if secret)

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc_value, traceback
        self._handle.close()

    def record(self, event: str, **fields: object) -> None:
        payload = {
            "timestamp": datetime.now(UTC).isoformat(),
            "event": event,
            **fields,
        }
        sanitized = _sanitize_for_ledger(payload, secrets=self._secrets)
        _ = self._handle.write(json.dumps(sanitized, separators=(",", ":"), sort_keys=True) + "\n")
        self._handle.flush()


def _sanitize_for_ledger(value: object, *, secrets: Sequence[str], key: str | None = None) -> object:
    if key is not None and any(part in key.lower() for part in _SECRET_KEY_PARTS):
        return _REDACTED
    if isinstance(value, Mapping):
        mapping = cast(Mapping[object, object], value)
        return {
            str(item_key): _sanitize_for_ledger(item, secrets=secrets, key=str(item_key))
            for item_key, item in mapping.items()
        }
    if isinstance(value, list | tuple):
        sequence = cast(Sequence[object], value)
        return [_sanitize_for_ledger(item, secrets=secrets) for item in sequence]
    if isinstance(value, str):
        sanitized = value
        for secret in secrets:
            if sanitized == secret:
                return _REDACTED
            sanitized = sanitized.replace(secret, _REDACTED)
        return sanitized
    if value is None or isinstance(value, bool | int | float):
        return value
    return str(value)


def _load_settings(env: Mapping[str, str]) -> _SoakSettings:
    if env.get("DIFY_AGENT_TEST_SOAK_ENABLED", "").strip() != "1":
        pytest.skip("set DIFY_AGENT_TEST_SOAK_ENABLED=1 to run the DIFY-2966 staging soak")

    required_names = (
        "DIFY_AGENT_TEST_SERVICE_URL",
        "DIFY_AGENT_TEST_SERVICE_API_TOKEN",
        "DIFY_AGENT_TEST_E2B_API_KEY",
        "DIFY_AGENT_TEST_SOAK_RUN_ID",
        "DIFY_AGENT_TEST_SOAK_ARTIFACT",
    )
    missing = [name for name in required_names if not env.get(name, "").strip()]
    if missing:
        pytest.skip(f"set {', '.join(missing)} to run the DIFY-2966 staging soak")

    run_id = env["DIFY_AGENT_TEST_SOAK_RUN_ID"].strip()
    if _RUN_ID_PATTERN.fullmatch(run_id) is None:
        raise ValueError("DIFY_AGENT_TEST_SOAK_RUN_ID must be 1-48 ASCII letters, digits, dots, underscores, or dashes")

    return _SoakSettings(
        service_url=env["DIFY_AGENT_TEST_SERVICE_URL"].strip(),
        service_token=env["DIFY_AGENT_TEST_SERVICE_API_TOKEN"].strip(),
        e2b_api_key=env["DIFY_AGENT_TEST_E2B_API_KEY"].strip(),
        run_id=run_id,
        artifact=Path(env["DIFY_AGENT_TEST_SOAK_ARTIFACT"].strip()).expanduser(),
        concurrency=_positive_int(env, "DIFY_AGENT_TEST_SOAK_CONCURRENCY", _FORMAL_CONCURRENCY),
        burst_rounds=_positive_int(env, "DIFY_AGENT_TEST_SOAK_BURST_ROUNDS", _FORMAL_BURST_ROUNDS),
        idle_bindings=_positive_int(env, "DIFY_AGENT_TEST_SOAK_IDLE_BINDINGS", _FORMAL_IDLE_BINDINGS),
        idle_interval_seconds=_nonnegative_float(
            env,
            "DIFY_AGENT_TEST_SOAK_IDLE_INTERVAL_SECONDS",
            _FORMAL_IDLE_INTERVAL_SECONDS,
        ),
        idle_rounds=_positive_int(env, "DIFY_AGENT_TEST_SOAK_IDLE_ROUNDS", _FORMAL_IDLE_ROUNDS),
        request_timeout_seconds=_positive_float(
            env,
            "DIFY_AGENT_TEST_SOAK_REQUEST_TIMEOUT_SECONDS",
            _DEFAULT_REQUEST_TIMEOUT_SECONDS,
        ),
        reconcile_timeout_seconds=_positive_float(
            env,
            "DIFY_AGENT_TEST_SOAK_RECONCILE_TIMEOUT_SECONDS",
            _DEFAULT_RECONCILE_TIMEOUT_SECONDS,
        ),
    )


def _positive_int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    value = int(raw) if raw else default
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _positive_float(env: Mapping[str, str], name: str, default: float) -> float:
    value = _nonnegative_float(env, name, default)
    if value == 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


def _nonnegative_float(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name, "").strip()
    value = float(raw) if raw else default
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{name} must be finite and nonnegative")
    return value


def _client(settings: _SoakSettings) -> Client:
    # One Client per concurrent lifecycle produces independent HTTP connections
    # so a multi-worker deployment is not accidentally exercised through only
    # one persistent downstream connection.
    return Client(
        base_url=settings.service_url,
        timeout=settings.request_timeout_seconds,
        headers={"Authorization": f"Bearer {settings.service_token}"},
    )


def _http_status(exc: BaseException) -> int | None:
    return exc.status_code if isinstance(exc, DifyAgentHTTPError) else None


def _record_operation_failure(
    ledger: _JsonlLedger,
    *,
    operation: str,
    started_at: float,
    exc: BaseException,
    binding: _Binding | None = None,
    binding_id: str | None = None,
    cleanup_result: str | None = None,
) -> None:
    ledger.record(
        "operation_end",
        operation=operation,
        outcome="failed",
        binding_id=binding.binding_id if binding is not None else binding_id,
        binding_ref=binding.binding_ref if binding is not None else None,
        workspace_ref=binding.workspace_ref if binding is not None else None,
        http_status=_http_status(exc),
        latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
        exception_type=type(exc).__name__,
        cleanup_result=cleanup_result,
    )


async def _create_binding(settings: _SoakSettings, ledger: _JsonlLedger, binding_id: str) -> _Binding:
    started_at = time.perf_counter()
    ledger.record("operation_start", operation="create", binding_id=binding_id)
    try:
        async with _client(settings) as client:
            allocation = await client.create_execution_binding(
                CreateExecutionBindingRequest(
                    tenant_id=_TENANT_ID,
                    agent_id=settings.binding_prefix,
                    binding_id=binding_id,
                    workspace_id=binding_id,
                    existing_workspace_ref=None,
                    home_snapshot_ref=None,
                )
            )
    except BaseException as exc:
        _record_operation_failure(ledger, operation="create", started_at=started_at, exc=exc, binding_id=binding_id)
        raise

    binding = _Binding(
        binding_id=binding_id,
        binding_ref=allocation.binding_ref,
        workspace_ref=allocation.workspace_ref,
    )
    ledger.record(
        "operation_end",
        operation="create",
        outcome="succeeded",
        binding_id=binding.binding_id,
        binding_ref=binding.binding_ref,
        workspace_ref=binding.workspace_ref,
        http_status=201,
        latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
        exception_type=None,
        cleanup_result=None,
    )
    return binding


async def _probe_binding(settings: _SoakSettings, ledger: _JsonlLedger, binding: _Binding) -> None:
    async with _client(settings) as client:
        started_at = time.perf_counter()
        ledger.record(
            "operation_start",
            operation="list",
            binding_id=binding.binding_id,
            binding_ref=binding.binding_ref,
            workspace_ref=binding.workspace_ref,
        )
        try:
            listing = await client.list_binding_files(binding.binding_ref, ".")
            assert listing.path == "."
        except BaseException as exc:
            _record_operation_failure(ledger, operation="list", started_at=started_at, exc=exc, binding=binding)
            raise
        ledger.record(
            "operation_end",
            operation="list",
            outcome="succeeded",
            binding_id=binding.binding_id,
            binding_ref=binding.binding_ref,
            workspace_ref=binding.workspace_ref,
            http_status=200,
            latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
            exception_type=None,
            cleanup_result=None,
        )

        started_at = time.perf_counter()
        ledger.record(
            "operation_start",
            operation="read",
            binding_id=binding.binding_id,
            binding_ref=binding.binding_ref,
            workspace_ref=binding.workspace_ref,
        )
        try:
            preview = await client.read_binding_file(binding.binding_ref, _READ_PROBE_PATH)
            assert preview.path == _READ_PROBE_PATH
            assert not preview.binary
            assert preview.text
        except BaseException as exc:
            _record_operation_failure(ledger, operation="read", started_at=started_at, exc=exc, binding=binding)
            raise
        ledger.record(
            "operation_end",
            operation="read",
            outcome="succeeded",
            binding_id=binding.binding_id,
            binding_ref=binding.binding_ref,
            workspace_ref=binding.workspace_ref,
            http_status=200,
            latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
            exception_type=None,
            cleanup_result=None,
        )


async def _destroy_binding(
    settings: _SoakSettings,
    ledger: _JsonlLedger,
    binding: _Binding,
    *,
    cleanup: bool,
) -> None:
    operation = "cleanup_destroy" if cleanup else "destroy"
    started_at = time.perf_counter()
    ledger.record(
        "operation_start",
        operation=operation,
        binding_id=binding.binding_id,
        binding_ref=binding.binding_ref,
        workspace_ref=binding.workspace_ref,
    )
    try:
        async with _client(settings) as client:
            await client.destroy_execution_binding(
                DestroyExecutionBindingRequest(
                    binding_ref=binding.binding_ref,
                    workspace_ref=binding.workspace_ref,
                    destroy_workspace=True,
                )
            )
    except BaseException as exc:
        _record_operation_failure(
            ledger,
            operation=operation,
            started_at=started_at,
            exc=exc,
            binding=binding,
            cleanup_result="failed" if cleanup else None,
        )
        raise
    ledger.record(
        "operation_end",
        operation=operation,
        outcome="succeeded",
        binding_id=binding.binding_id,
        binding_ref=binding.binding_ref,
        workspace_ref=binding.workspace_ref,
        http_status=204,
        latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
        exception_type=None,
        cleanup_result="destroyed" if cleanup else None,
    )


def _raise_task_failures(results: Sequence[object], *, message: str) -> None:
    failures: list[Exception] = []
    for result in results:
        if not isinstance(result, BaseException):
            continue
        if not isinstance(result, Exception):
            raise result
        failures.append(result)
    if failures:
        raise ExceptionGroup(message, failures)


async def _gather_checked(awaitables: Sequence[Awaitable[None]], *, message: str) -> None:
    results = await asyncio.gather(*awaitables, return_exceptions=True)
    _raise_task_failures(results, message=message)


async def _run_burst(
    settings: _SoakSettings,
    ledger: _JsonlLedger,
    known: dict[str, _Binding],
    destroyed: set[str],
) -> None:
    for round_number in range(settings.burst_rounds):
        ledger.record("stage_start", stage="burst_round", round=round_number, count=settings.concurrency)

        async def run_one(sequence: int) -> None:
            binding_id = f"{settings.binding_prefix}burst-{round_number:02d}-{sequence:04d}"
            binding = await _create_binding(settings, ledger, binding_id)
            known[binding.binding_ref] = binding
            await _probe_binding(settings, ledger, binding)
            await _destroy_binding(settings, ledger, binding, cleanup=False)
            destroyed.add(binding.binding_ref)

        try:
            await _gather_checked(
                [run_one(sequence) for sequence in range(settings.concurrency)],
                message=f"burst round {round_number} failed",
            )
        except BaseException as exc:
            ledger.record(
                "stage_end",
                stage="burst_round",
                round=round_number,
                count=settings.concurrency,
                outcome="failed",
                exception_type=type(exc).__name__,
            )
            raise
        ledger.record(
            "stage_end",
            stage="burst_round",
            round=round_number,
            count=settings.concurrency,
            outcome="succeeded",
            exception_type=None,
        )


async def _run_idle(
    settings: _SoakSettings,
    ledger: _JsonlLedger,
    known: dict[str, _Binding],
    destroyed: set[str],
) -> None:
    bindings_by_sequence: dict[int, _Binding] = {}
    ledger.record("stage_start", stage="idle_create", count=settings.idle_bindings)

    async def create_one(sequence: int) -> None:
        binding_id = f"{settings.binding_prefix}idle-{sequence:04d}"
        binding = await _create_binding(settings, ledger, binding_id)
        bindings_by_sequence[sequence] = binding
        known[binding.binding_ref] = binding

    bindings: list[_Binding] = []
    try:
        await _gather_checked(
            [create_one(sequence) for sequence in range(settings.idle_bindings)],
            message="idle binding creation failed; do not reduce the configured capacity gate",
        )
        bindings = [bindings_by_sequence[index] for index in range(settings.idle_bindings)]
        await _require_exact_idle_inventory(settings, ledger, bindings, stage="idle_create_state")
    except BaseException as exc:
        ledger.record(
            "stage_end",
            stage="idle_create",
            count=settings.idle_bindings,
            outcome="failed",
            exception_type=type(exc).__name__,
        )
        raise
    ledger.record(
        "stage_end",
        stage="idle_create",
        count=settings.idle_bindings,
        outcome="succeeded",
        exception_type=None,
    )

    for round_number in range(settings.idle_rounds):
        ledger.record(
            "stage_start",
            stage="idle_wait",
            round=round_number,
            duration_seconds=settings.idle_interval_seconds,
        )
        await asyncio.sleep(settings.idle_interval_seconds)
        ledger.record(
            "stage_end",
            stage="idle_wait",
            round=round_number,
            duration_seconds=settings.idle_interval_seconds,
            outcome="succeeded",
        )

        ledger.record("stage_start", stage="idle_probe", round=round_number, count=len(bindings))
        try:
            await _gather_checked(
                [_probe_binding(settings, ledger, binding) for binding in bindings],
                message=f"idle probe round {round_number} failed",
            )
            await _require_exact_idle_inventory(
                settings,
                ledger,
                bindings,
                stage=f"idle_probe_{round_number:02d}_state",
            )
        except BaseException as exc:
            ledger.record(
                "stage_end",
                stage="idle_probe",
                round=round_number,
                count=len(bindings),
                outcome="failed",
                exception_type=type(exc).__name__,
            )
            raise
        ledger.record(
            "stage_end",
            stage="idle_probe",
            round=round_number,
            count=len(bindings),
            outcome="succeeded",
            exception_type=None,
        )

    ledger.record("stage_start", stage="idle_destroy", count=len(bindings))

    async def destroy_one(binding: _Binding) -> None:
        await _destroy_binding(settings, ledger, binding, cleanup=False)
        destroyed.add(binding.binding_ref)

    try:
        await _gather_checked(
            [destroy_one(binding) for binding in bindings],
            message="idle binding destruction failed",
        )
    except BaseException as exc:
        ledger.record(
            "stage_end",
            stage="idle_destroy",
            count=len(bindings),
            outcome="failed",
            exception_type=type(exc).__name__,
        )
        raise
    ledger.record(
        "stage_end",
        stage="idle_destroy",
        count=len(bindings),
        outcome="succeeded",
        exception_type=None,
    )


async def _cleanup_known_bindings(
    settings: _SoakSettings,
    ledger: _JsonlLedger,
    known: Mapping[str, _Binding],
    destroyed: set[str],
) -> list[Exception]:
    pending = [binding for binding in known.values() if binding.binding_ref not in destroyed]
    if not pending:
        return []
    results = await asyncio.gather(
        *[_destroy_binding(settings, ledger, binding, cleanup=True) for binding in pending],
        return_exceptions=True,
    )
    errors: list[Exception] = []
    for binding, result in zip(pending, results, strict=True):
        if isinstance(result, BaseException):
            if not isinstance(result, Exception):
                raise result
            errors.append(result)
        else:
            destroyed.add(binding.binding_ref)
    return errors


async def _list_owned_e2b_sandboxes(settings: _SoakSettings) -> list[_OwnedSandbox]:
    from e2b import AsyncSandbox, SandboxInfo, SandboxQuery

    paginator = AsyncSandbox.list(
        query=SandboxQuery(
            metadata={
                "dify.agent_id": settings.binding_prefix,
                "dify.tenant_id": _TENANT_ID,
            }
        ),
        limit=100,
        api_key=settings.e2b_api_key,
    )
    candidates: list[SandboxInfo] = []
    while paginator.has_next:
        candidates.extend(await paginator.next_items())

    owned: list[_OwnedSandbox] = []
    for candidate in candidates:
        metadata = candidate.metadata
        binding_id = metadata.get("dify.binding_id", "")
        workspace_id = metadata.get("dify.workspace_id", "")
        if not binding_id.startswith(settings.binding_prefix) or not workspace_id.startswith(settings.binding_prefix):
            continue
        state = candidate.state.value
        owned.append(
            _OwnedSandbox(
                sandbox_id=candidate.sandbox_id,
                binding_id=binding_id,
                workspace_id=workspace_id,
                state=str(state),
            )
        )
    return sorted(owned, key=lambda sandbox: sandbox.sandbox_id)


def _inventory_identity(sandboxes: Sequence[_OwnedSandbox]) -> list[tuple[str, str, str, str]]:
    return sorted(
        (sandbox.sandbox_id, sandbox.binding_id, sandbox.workspace_id, sandbox.state) for sandbox in sandboxes
    )


def _expected_idle_identity(bindings: Sequence[_Binding]) -> list[tuple[str, str, str, str]]:
    return sorted((binding.binding_ref, binding.binding_id, binding.binding_id, "paused") for binding in bindings)


def _record_inventory(
    ledger: _JsonlLedger,
    *,
    stage: str,
    sandboxes: Sequence[_OwnedSandbox],
    attempt: int | None = None,
) -> None:
    ledger.record("e2b_inventory", stage=stage, attempt=attempt, count=len(sandboxes))
    for sandbox in sandboxes:
        ledger.record(
            "e2b_inventory_item",
            stage=stage,
            attempt=attempt,
            sandbox_id=sandbox.sandbox_id,
            binding_id=sandbox.binding_id,
            workspace_id=sandbox.workspace_id,
            state=sandbox.state,
        )


async def _list_owned_inventory_attempt(
    settings: _SoakSettings,
    ledger: _JsonlLedger,
    *,
    list_owned: _ListOwnedSandboxes,
    stage: str,
    attempt: int,
    timeout_seconds: float,
) -> tuple[list[_OwnedSandbox] | None, Exception | None]:
    started_at = time.perf_counter()
    ledger.record(
        "operation_start",
        operation="e2b_inventory_list",
        stage=stage,
        attempt=attempt,
    )
    try:
        inventory = await asyncio.wait_for(list_owned(settings), timeout=timeout_seconds)
    except Exception as exc:
        ledger.record(
            "operation_end",
            operation="e2b_inventory_list",
            stage=stage,
            attempt=attempt,
            outcome="failed",
            latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
            exception_type=type(exc).__name__,
            cleanup_result=None,
        )
        return None, exc
    ledger.record(
        "operation_end",
        operation="e2b_inventory_list",
        stage=stage,
        attempt=attempt,
        outcome="succeeded",
        latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
        exception_type=None,
        cleanup_result=None,
    )
    return inventory, None


async def _require_exact_idle_inventory(
    settings: _SoakSettings,
    ledger: _JsonlLedger,
    bindings: Sequence[_Binding],
    *,
    stage: str = "idle_identity",
    list_owned: _ListOwnedSandboxes = _list_owned_e2b_sandboxes,
    sleep: _Sleep = asyncio.sleep,
    monotonic: _Monotonic = time.monotonic,
) -> None:
    """Require the exact run-owned Bindings to be visibly paused before continuing."""
    if any(binding.binding_ref != binding.workspace_ref for binding in bindings):
        ledger.record(
            "e2b_identity_check",
            stage=stage,
            outcome="failed",
            expected_count=len(bindings),
            actual_count=None,
            exception_type="BackendIdentityMismatch",
        )
        raise AssertionError("E2B idle bindings must return identical Binding and Workspace refs")

    expected = _expected_idle_identity(bindings)
    deadline = monotonic() + settings.reconcile_timeout_seconds
    attempt = 0
    last_list_error: Exception | None = None
    last_observed_count: int | None = None
    while True:
        remaining_seconds = deadline - monotonic()
        if remaining_seconds <= 0:
            if last_list_error is not None:
                raise AssertionError(
                    "E2B idle inventory could not be proven before the reconcile deadline"
                ) from last_list_error
            ledger.record(
                "e2b_identity_check",
                stage=stage,
                attempt=attempt,
                outcome="failed",
                expected_count=len(expected),
                actual_count=last_observed_count,
                exception_type="BackendIdentityMismatch",
            )
            raise AssertionError(
                f"E2B idle inventory mismatch: expected {len(expected)} exact, observed {last_observed_count}"
            )
        attempt += 1
        actual_sandboxes, list_error = await _list_owned_inventory_attempt(
            settings,
            ledger,
            list_owned=list_owned,
            stage=stage,
            attempt=attempt,
            timeout_seconds=remaining_seconds,
        )
        if list_error is not None:
            last_list_error = list_error
            remaining_seconds = deadline - monotonic()
            if remaining_seconds <= 0:
                raise AssertionError(
                    "E2B idle inventory could not be proven before the reconcile deadline"
                ) from last_list_error
            await sleep(min(_RECONCILE_RETRY_BACKOFF_SECONDS, remaining_seconds))
            continue
        assert actual_sandboxes is not None
        last_list_error = None
        actual = _inventory_identity(actual_sandboxes)
        last_observed_count = len(actual)
        _record_inventory(ledger, stage=stage, sandboxes=actual_sandboxes, attempt=attempt)
        if actual == expected:
            ledger.record(
                "e2b_identity_check",
                stage=stage,
                attempt=attempt,
                outcome="succeeded",
                expected_count=len(expected),
                actual_count=len(actual),
                exception_type=None,
            )
            return
        if monotonic() >= deadline:
            ledger.record(
                "e2b_identity_check",
                stage=stage,
                attempt=attempt,
                outcome="failed",
                expected_count=len(expected),
                actual_count=len(actual),
                exception_type="BackendIdentityMismatch",
            )
            raise AssertionError(
                f"E2B idle inventory mismatch: expected {len(expected)} exact allocations, observed {len(actual)}"
            )
        await sleep(min(_RECONCILE_POLL_SECONDS, max(0.0, deadline - monotonic())))


async def _kill_owned_e2b_sandbox(settings: _SoakSettings, sandbox_id: str) -> bool:
    from e2b import AsyncSandbox

    return await AsyncSandbox.kill(sandbox_id, api_key=settings.e2b_api_key)


async def _reconcile_owned_e2b_sandboxes(
    settings: _SoakSettings,
    ledger: _JsonlLedger,
    *,
    list_owned: _ListOwnedSandboxes = _list_owned_e2b_sandboxes,
    kill_owned: _KillOwnedSandbox = _kill_owned_e2b_sandbox,
    sleep: _Sleep = asyncio.sleep,
    monotonic: _Monotonic = time.monotonic,
) -> None:
    deadline = monotonic() + settings.reconcile_timeout_seconds
    final_proof_reserve = min(
        _RECONCILE_FINAL_PROOF_RESERVE_SECONDS,
        settings.reconcile_timeout_seconds / 2,
    )
    scan_deadline = deadline - final_proof_reserve
    attempt = 0
    last_list_error: Exception | None = None
    last_inventory: list[_OwnedSandbox] | None = None

    async def kill_one(sandbox: _OwnedSandbox, *, attempt: int) -> None:
        started_at = time.perf_counter()
        ledger.record(
            "operation_start",
            operation="e2b_direct_kill",
            attempt=attempt,
            sandbox_id=sandbox.sandbox_id,
            binding_id=sandbox.binding_id,
            workspace_id=sandbox.workspace_id,
        )
        try:
            killed = await kill_owned(settings, sandbox.sandbox_id)
        except Exception as exc:
            ledger.record(
                "operation_end",
                operation="e2b_direct_kill",
                attempt=attempt,
                outcome="failed",
                sandbox_id=sandbox.sandbox_id,
                binding_id=sandbox.binding_id,
                workspace_id=sandbox.workspace_id,
                latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
                exception_type=type(exc).__name__,
                cleanup_result="failed",
            )
            return
        except asyncio.CancelledError:
            ledger.record(
                "operation_end",
                operation="e2b_direct_kill",
                attempt=attempt,
                outcome="failed",
                sandbox_id=sandbox.sandbox_id,
                binding_id=sandbox.binding_id,
                workspace_id=sandbox.workspace_id,
                latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
                exception_type="CancelledError",
                cleanup_result="cancelled",
            )
            raise
        ledger.record(
            "operation_end",
            operation="e2b_direct_kill",
            attempt=attempt,
            outcome="succeeded",
            sandbox_id=sandbox.sandbox_id,
            binding_id=sandbox.binding_id,
            workspace_id=sandbox.workspace_id,
            latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
            exception_type=None,
            cleanup_result="killed" if killed else "already_absent",
        )

    async def kill_batch(
        sandboxes: Sequence[_OwnedSandbox],
        *,
        attempt: int,
        timeout_seconds: float,
    ) -> None:
        started_at = time.perf_counter()
        ledger.record(
            "operation_start",
            operation="e2b_direct_kill_batch",
            attempt=attempt,
            count=len(sandboxes),
        )
        try:
            _ = await asyncio.wait_for(
                asyncio.gather(*[kill_one(sandbox, attempt=attempt) for sandbox in sandboxes]),
                timeout=timeout_seconds,
            )
        except TimeoutError:
            ledger.record(
                "operation_end",
                operation="e2b_direct_kill_batch",
                attempt=attempt,
                outcome="failed",
                count=len(sandboxes),
                latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
                exception_type="TimeoutError",
                cleanup_result="deadline_exhausted",
            )
            return
        ledger.record(
            "operation_end",
            operation="e2b_direct_kill_batch",
            attempt=attempt,
            outcome="completed",
            count=len(sandboxes),
            latency_ms=round((time.perf_counter() - started_at) * 1000, 3),
            exception_type=None,
            cleanup_result="attempted",
        )

    while monotonic() < scan_deadline:
        remaining_seconds = scan_deadline - monotonic()
        if remaining_seconds <= 0:
            break
        attempt += 1
        current, list_error = await _list_owned_inventory_attempt(
            settings,
            ledger,
            list_owned=list_owned,
            stage="direct_cleanup_scan",
            attempt=attempt,
            timeout_seconds=remaining_seconds,
        )
        if list_error is not None:
            last_list_error = list_error
        else:
            assert current is not None
            last_list_error = None
            last_inventory = current
            _record_inventory(ledger, stage="direct_cleanup_scan", sandboxes=current, attempt=attempt)
            kill_remaining = scan_deadline - monotonic()
            if current and kill_remaining > 0:
                await kill_batch(current, attempt=attempt, timeout_seconds=kill_remaining)

        remaining_seconds = scan_deadline - monotonic()
        if remaining_seconds <= 0:
            break
        await sleep(min(_RECONCILE_POLL_SECONDS, remaining_seconds))

    final_inventory: list[_OwnedSandbox] | None = None
    stable_empty_since: float | None = None
    while monotonic() < deadline:
        remaining_seconds = deadline - monotonic()
        if remaining_seconds <= 0:
            break
        attempt += 1
        current, list_error = await _list_owned_inventory_attempt(
            settings,
            ledger,
            list_owned=list_owned,
            stage="direct_cleanup_final_scan",
            attempt=attempt,
            timeout_seconds=min(_RECONCILE_POLL_SECONDS, remaining_seconds),
        )
        if list_error is not None:
            last_list_error = list_error
            stable_empty_since = None
        else:
            assert current is not None
            last_list_error = None
            last_inventory = current
            _record_inventory(ledger, stage="direct_cleanup_final_scan", sandboxes=current, attempt=attempt)
            if current:
                stable_empty_since = None
                kill_remaining = deadline - monotonic()
                if kill_remaining > 0:
                    await kill_batch(
                        current,
                        attempt=attempt,
                        timeout_seconds=min(_RECONCILE_POLL_SECONDS, kill_remaining),
                    )
            else:
                observed_at = monotonic()
                if stable_empty_since is None:
                    stable_empty_since = observed_at
                stable_empty_seconds = observed_at - stable_empty_since
                if stable_empty_seconds >= _RECONCILE_STABLE_EMPTY_SECONDS:
                    ledger.record(
                        "e2b_stable_empty",
                        stage="direct_cleanup_final_scan",
                        attempt=attempt,
                        outcome="succeeded",
                        duration_seconds=stable_empty_seconds,
                    )
                    final_inventory = current
                    break

        remaining_seconds = deadline - monotonic()
        if remaining_seconds <= 0:
            break
        await sleep(min(_RECONCILE_FINAL_SCAN_INTERVAL_SECONDS, remaining_seconds))

    if final_inventory is None:
        if last_list_error is not None:
            raise AssertionError("final E2B inventory proof failed before the reconcile deadline") from last_list_error
        remaining_count = len(last_inventory) if last_inventory is not None else 0
        if remaining_count:
            raise AssertionError(
                f"final E2B inventory proof was not empty before the reconcile deadline ({remaining_count} observed)"
            )
        raise AssertionError(
            f"final E2B inventory did not remain empty for {_RECONCILE_STABLE_EMPTY_SECONDS:g}s before the deadline"
        )

    _record_inventory(
        ledger,
        stage="direct_cleanup_deadline",
        sandboxes=final_inventory,
        attempt=attempt,
    )
    _record_inventory(ledger, stage="after_direct_cleanup", sandboxes=final_inventory, attempt=attempt)
    assert not final_inventory, f"{len(final_inventory)} run-owned E2B sandboxes remain after cleanup"


def _raise_collected_errors(primary: BaseException | None, cleanup_errors: Sequence[Exception]) -> None:
    if primary is not None and not isinstance(primary, Exception):
        raise primary
    errors = ([primary] if isinstance(primary, Exception) else []) + list(cleanup_errors)
    if len(errors) == 1:
        raise errors[0]
    if errors:
        raise ExceptionGroup("DIFY-2966 soak and cleanup failures", errors)


@pytest.mark.anyio
async def test_e2b_transport_soak() -> None:
    settings = _load_settings(os.environ)
    primary_error: BaseException | None = None
    cleanup_errors: list[Exception] = []
    known: dict[str, _Binding] = {}
    destroyed: set[str] = set()
    cleanup_authorized = False

    with _JsonlLedger(
        settings.artifact,
        secrets=(settings.service_token, settings.e2b_api_key),
    ) as ledger:
        ledger.record(
            "run_start",
            run_id=settings.run_id,
            binding_prefix=settings.binding_prefix,
            formal_gate=settings.formal_gate,
            concurrency=settings.concurrency,
            burst_rounds=settings.burst_rounds,
            idle_bindings=settings.idle_bindings,
            idle_interval_seconds=settings.idle_interval_seconds,
            idle_rounds=settings.idle_rounds,
        )

        initial = await _list_owned_e2b_sandboxes(settings)
        _record_inventory(ledger, stage="preflight", sandboxes=initial)
        assert not initial, "DIFY_AGENT_TEST_SOAK_RUN_ID is already in use; choose a new run id"
        cleanup_authorized = True

        try:
            await _run_burst(settings, ledger, known, destroyed)
            await _run_idle(settings, ledger, known, destroyed)
        except BaseException as exc:
            primary_error = exc
        finally:
            if cleanup_authorized:
                try:
                    cleanup_errors.extend(await _cleanup_known_bindings(settings, ledger, known, destroyed))
                except BaseException as exc:
                    if not isinstance(exc, Exception):
                        raise
                    cleanup_errors.append(exc)
                try:
                    await _reconcile_owned_e2b_sandboxes(settings, ledger)
                except BaseException as exc:
                    if not isinstance(exc, Exception):
                        raise
                    cleanup_errors.append(exc)

        outcome = "succeeded" if primary_error is None and not cleanup_errors else "failed"
        ledger.record(
            "run_end",
            run_id=settings.run_id,
            formal_gate=settings.formal_gate,
            outcome=outcome,
            exception_type=type(primary_error).__name__ if primary_error is not None else None,
            cleanup_error_types=[type(error).__name__ for error in cleanup_errors],
        )

    _raise_collected_errors(primary_error, cleanup_errors)


def test_soak_requires_explicit_enable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DIFY_AGENT_TEST_SOAK_ENABLED", raising=False)
    with pytest.raises(pytest.skip.Exception, match="DIFY_AGENT_TEST_SOAK_ENABLED=1"):
        _ = _load_settings(os.environ)


def test_soak_missing_credentials_skip_without_echoing_values(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "DIFY_AGENT_TEST_SERVICE_URL",
        "DIFY_AGENT_TEST_E2B_API_KEY",
        "DIFY_AGENT_TEST_SOAK_RUN_ID",
        "DIFY_AGENT_TEST_SOAK_ARTIFACT",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DIFY_AGENT_TEST_SOAK_ENABLED", "1")
    monkeypatch.setenv("DIFY_AGENT_TEST_SERVICE_API_TOKEN", "service-secret-value")
    with pytest.raises(pytest.skip.Exception) as raised:
        _ = _load_settings(os.environ)
    assert "service-secret-value" not in str(raised.value)


def test_ledger_redacts_secret_fields_and_values(tmp_path: Path) -> None:
    service_token = "service-secret-value"
    e2b_key = "e2b-secret-value"
    artifact = tmp_path / "ledger.jsonl"

    with _JsonlLedger(artifact, secrets=(service_token, e2b_key)) as ledger:
        ledger.record(
            "probe",
            authorization=service_token,
            nested={"api_key": e2b_key, "message": f"failed near {service_token}"},
        )

    raw = artifact.read_text(encoding="utf-8")
    payload = cast(dict[str, object], json.loads(raw))
    assert service_token not in raw
    assert e2b_key not in raw
    assert payload["authorization"] == _REDACTED
    nested = cast(dict[str, object], payload["nested"])
    assert nested["api_key"] == _REDACTED
    assert nested["message"] == f"failed near {_REDACTED}"


def test_formal_gate_includes_request_and_reconcile_timeouts(tmp_path: Path) -> None:
    settings = _SoakSettings(
        service_url="https://agent.invalid",
        service_token="service-secret-value",
        e2b_api_key="e2b-secret-value",
        run_id="formal",
        artifact=tmp_path / "formal.jsonl",
        concurrency=_FORMAL_CONCURRENCY,
        burst_rounds=_FORMAL_BURST_ROUNDS,
        idle_bindings=_FORMAL_IDLE_BINDINGS,
        idle_interval_seconds=_FORMAL_IDLE_INTERVAL_SECONDS,
        idle_rounds=_FORMAL_IDLE_ROUNDS,
        request_timeout_seconds=_DEFAULT_REQUEST_TIMEOUT_SECONDS,
        reconcile_timeout_seconds=_DEFAULT_RECONCILE_TIMEOUT_SECONDS,
    )

    assert settings.formal_gate
    assert not replace(settings, request_timeout_seconds=1).formal_gate
    assert not replace(settings, reconcile_timeout_seconds=1).formal_gate


def test_reconcile_timeout_override_must_be_positive(tmp_path: Path) -> None:
    env = {
        "DIFY_AGENT_TEST_SOAK_ENABLED": "1",
        "DIFY_AGENT_TEST_SERVICE_URL": "https://agent.invalid",
        "DIFY_AGENT_TEST_SERVICE_API_TOKEN": "service-secret-value",
        "DIFY_AGENT_TEST_E2B_API_KEY": "e2b-secret-value",
        "DIFY_AGENT_TEST_SOAK_RUN_ID": "positive-timeout",
        "DIFY_AGENT_TEST_SOAK_ARTIFACT": str(tmp_path / "positive-timeout.jsonl"),
        "DIFY_AGENT_TEST_SOAK_RECONCILE_TIMEOUT_SECONDS": "0",
    }

    with pytest.raises(ValueError, match="must be greater than zero"):
        _ = _load_settings(env)


def _test_settings(tmp_path: Path, *, name: str, reconcile_timeout_seconds: float = 60.0) -> _SoakSettings:
    return _SoakSettings(
        service_url="https://agent.invalid",
        service_token="service-secret-value",
        e2b_api_key="e2b-secret-value",
        run_id=name,
        artifact=tmp_path / f"{name}.jsonl",
        concurrency=1,
        burst_rounds=1,
        idle_bindings=1,
        idle_interval_seconds=0,
        idle_rounds=1,
        request_timeout_seconds=1,
        reconcile_timeout_seconds=reconcile_timeout_seconds,
    )


class _FakeClock:
    now: float

    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.now += seconds


@pytest.mark.anyio
@pytest.mark.parametrize("mismatch", ["workspace", "state"])
async def test_idle_inventory_requires_exact_paused_identity(tmp_path: Path, mismatch: str) -> None:
    settings = _test_settings(tmp_path, name="identity", reconcile_timeout_seconds=0.1)
    clock = _FakeClock()
    binding = _Binding(
        binding_id=f"{settings.binding_prefix}idle-0000",
        binding_ref="sandbox-1",
        workspace_ref="sandbox-1",
    )
    mismatched = _OwnedSandbox(
        sandbox_id=binding.binding_ref,
        binding_id=binding.binding_id,
        workspace_id=(f"{settings.binding_prefix}wrong-workspace" if mismatch == "workspace" else binding.binding_id),
        state="running" if mismatch == "state" else "paused",
    )

    async def list_owned(_settings: _SoakSettings) -> list[_OwnedSandbox]:
        return [mismatched]

    with _JsonlLedger(settings.artifact, secrets=(settings.service_token, settings.e2b_api_key)) as ledger:
        with pytest.raises(AssertionError, match="inventory mismatch"):
            await _require_exact_idle_inventory(
                settings,
                ledger,
                [binding],
                list_owned=list_owned,
                sleep=clock.sleep,
                monotonic=clock.monotonic,
            )


@pytest.mark.anyio
async def test_reconcile_catches_sandbox_with_delayed_visibility(tmp_path: Path) -> None:
    settings = _test_settings(tmp_path, name="delayed", reconcile_timeout_seconds=8)
    clock = _FakeClock()
    sandbox = _OwnedSandbox(
        sandbox_id="sandbox-delayed",
        binding_id=f"{settings.binding_prefix}idle-0000",
        workspace_id=f"{settings.binding_prefix}idle-0000",
        state="paused",
    )
    inventories: list[list[_OwnedSandbox]] = [[], [sandbox], [], []]
    list_attempt = 0
    killed: list[str] = []

    async def list_owned(_settings: _SoakSettings) -> list[_OwnedSandbox]:
        nonlocal list_attempt
        inventory = inventories[list_attempt] if list_attempt < len(inventories) else []
        list_attempt += 1
        return inventory

    async def kill_owned(_settings: _SoakSettings, sandbox_id: str) -> bool:
        killed.append(sandbox_id)
        return True

    with _JsonlLedger(settings.artifact, secrets=(settings.service_token, settings.e2b_api_key)) as ledger:
        await _reconcile_owned_e2b_sandboxes(
            settings,
            ledger,
            list_owned=list_owned,
            kill_owned=kill_owned,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
        )

    assert killed == [sandbox.sandbox_id]
    assert clock.monotonic() >= 7
    assert clock.monotonic() < settings.reconcile_timeout_seconds


@pytest.mark.anyio
async def test_reconcile_retries_first_list_failure_then_cleans_visible_sandbox(tmp_path: Path) -> None:
    settings = _test_settings(tmp_path, name="retry-list", reconcile_timeout_seconds=8)
    clock = _FakeClock()
    sandbox = _OwnedSandbox(
        sandbox_id="sandbox-after-list-error",
        binding_id=f"{settings.binding_prefix}idle-0000",
        workspace_id=f"{settings.binding_prefix}idle-0000",
        state="paused",
    )
    list_attempts = 0
    killed: list[str] = []

    async def list_owned(_settings: _SoakSettings) -> list[_OwnedSandbox]:
        nonlocal list_attempts
        list_attempts += 1
        if list_attempts == 1:
            raise RuntimeError(f"temporary list failure near {settings.e2b_api_key}")
        if list_attempts == 2:
            return [sandbox]
        return []

    async def kill_owned(_settings: _SoakSettings, sandbox_id: str) -> bool:
        killed.append(sandbox_id)
        return True

    with _JsonlLedger(settings.artifact, secrets=(settings.service_token, settings.e2b_api_key)) as ledger:
        await _reconcile_owned_e2b_sandboxes(
            settings,
            ledger,
            list_owned=list_owned,
            kill_owned=kill_owned,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
        )

    raw = settings.artifact.read_text(encoding="utf-8")
    events = [cast(dict[str, object], json.loads(line)) for line in raw.splitlines()]
    list_outcomes = [
        event["outcome"]
        for event in events
        if event.get("event") == "operation_end" and event.get("operation") == "e2b_inventory_list"
    ]
    assert killed == [sandbox.sandbox_id]
    assert list_outcomes[0] == "failed"
    assert "succeeded" in list_outcomes[1:]
    assert settings.e2b_api_key not in raw


@pytest.mark.anyio
async def test_reconcile_retries_first_kill_failure_and_keeps_ledger_secret_safe(tmp_path: Path) -> None:
    settings = _test_settings(tmp_path, name="retry-kill", reconcile_timeout_seconds=10)
    clock = _FakeClock()
    sandbox = _OwnedSandbox(
        sandbox_id="sandbox-retry",
        binding_id=f"{settings.binding_prefix}idle-0000",
        workspace_id=f"{settings.binding_prefix}idle-0000",
        state="paused",
    )
    present = True
    kill_attempts = 0

    async def list_owned(_settings: _SoakSettings) -> list[_OwnedSandbox]:
        return [sandbox] if present else []

    async def kill_owned(_settings: _SoakSettings, sandbox_id: str) -> bool:
        nonlocal kill_attempts, present
        assert sandbox_id == sandbox.sandbox_id
        kill_attempts += 1
        if kill_attempts == 1:
            raise RuntimeError(f"temporary failure near {settings.e2b_api_key}")
        present = False
        return True

    with _JsonlLedger(settings.artifact, secrets=(settings.service_token, settings.e2b_api_key)) as ledger:
        await _reconcile_owned_e2b_sandboxes(
            settings,
            ledger,
            list_owned=list_owned,
            kill_owned=kill_owned,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
        )

    raw = settings.artifact.read_text(encoding="utf-8")
    events = [cast(dict[str, object], json.loads(line)) for line in raw.splitlines()]
    kill_outcomes = [
        event["outcome"]
        for event in events
        if event.get("event") == "operation_end" and event.get("operation") == "e2b_direct_kill"
    ]
    assert kill_attempts == 2
    assert kill_outcomes == ["failed", "succeeded"]
    assert clock.monotonic() >= 8
    assert clock.monotonic() < settings.reconcile_timeout_seconds
    assert settings.service_token not in raw
    assert settings.e2b_api_key not in raw


@pytest.mark.anyio
async def test_reconcile_recovers_when_first_final_list_is_slow_and_times_out(tmp_path: Path) -> None:
    settings = _test_settings(tmp_path, name="slow-final-list", reconcile_timeout_seconds=20)
    clock = _FakeClock()
    slow_final_injected = False

    async def list_owned(_settings: _SoakSettings) -> list[_OwnedSandbox]:
        nonlocal slow_final_injected
        if clock.monotonic() >= 10 and not slow_final_injected:
            slow_final_injected = True
            await clock.sleep(_RECONCILE_POLL_SECONDS)
            raise TimeoutError("simulated slow final inventory list")
        return []

    async def kill_owned(_settings: _SoakSettings, _sandbox_id: str) -> bool:
        raise AssertionError("kill must not run for stable empty inventory")

    with _JsonlLedger(settings.artifact, secrets=(settings.service_token, settings.e2b_api_key)) as ledger:
        await _reconcile_owned_e2b_sandboxes(
            settings,
            ledger,
            list_owned=list_owned,
            kill_owned=kill_owned,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
        )

    raw = settings.artifact.read_text(encoding="utf-8")
    events = [cast(dict[str, object], json.loads(line)) for line in raw.splitlines()]
    final_list_outcomes = [
        event["outcome"]
        for event in events
        if event.get("event") == "operation_end"
        and event.get("operation") == "e2b_inventory_list"
        and event.get("stage") == "direct_cleanup_final_scan"
    ]
    assert slow_final_injected
    assert final_list_outcomes[0] == "failed"
    assert "succeeded" in final_list_outcomes[1:]
    assert clock.monotonic() >= 15
    assert clock.monotonic() < settings.reconcile_timeout_seconds


@pytest.mark.anyio
async def test_reconcile_bounds_never_returning_inventory_list(tmp_path: Path) -> None:
    settings = _test_settings(tmp_path, name="list-deadline", reconcile_timeout_seconds=0.04)

    async def list_owned(_settings: _SoakSettings) -> list[_OwnedSandbox]:
        _ = await asyncio.Event().wait()
        raise AssertionError("unreachable")

    async def kill_owned(_settings: _SoakSettings, _sandbox_id: str) -> bool:
        raise AssertionError("kill must not run without inventory ownership")

    with _JsonlLedger(settings.artifact, secrets=(settings.service_token, settings.e2b_api_key)) as ledger:
        with pytest.raises(AssertionError, match="final E2B inventory proof failed"):
            await _reconcile_owned_e2b_sandboxes(
                settings,
                ledger,
                list_owned=list_owned,
                kill_owned=kill_owned,
            )


@pytest.mark.anyio
async def test_reconcile_bounds_never_returning_kill_batch(tmp_path: Path) -> None:
    settings = _test_settings(tmp_path, name="kill-deadline", reconcile_timeout_seconds=0.04)
    sandbox = _OwnedSandbox(
        sandbox_id="sandbox-never-killed",
        binding_id=f"{settings.binding_prefix}idle-0000",
        workspace_id=f"{settings.binding_prefix}idle-0000",
        state="paused",
    )

    async def list_owned(_settings: _SoakSettings) -> list[_OwnedSandbox]:
        return [sandbox]

    async def kill_owned(_settings: _SoakSettings, _sandbox_id: str) -> bool:
        _ = await asyncio.Event().wait()
        raise AssertionError("unreachable")

    with _JsonlLedger(settings.artifact, secrets=(settings.service_token, settings.e2b_api_key)) as ledger:
        with pytest.raises(AssertionError, match="was not empty"):
            await _reconcile_owned_e2b_sandboxes(
                settings,
                ledger,
                list_owned=list_owned,
                kill_owned=kill_owned,
            )
