"""Capture and reconcile private Staging Conversation resource ownership.

The public API does not expose Workspace, Binding, or Sandbox identity.  This
module therefore captures an exact private manifest from the Staging database
*before* issuing Conversation DELETE, then returns count-only cleanup evidence.
Private identifiers are sent to an API Pod over stdin and are never placed in
kubectl argv, logs, or public benchmark artifacts.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime
import json
import os
from pathlib import Path
import stat
import subprocess
import time
from typing import Any, TypedDict, cast

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityUserCleanup
from benchmarks.staging_public_locust import bounded_end_user


CommandRunner = Callable[[Sequence[str], str | None], str]
ConversationDeleter = Callable[[str, str], int]
VendorRemainingProbe = Callable[[], "StagingVendorRemainingSample"]
StalledResourceReplayer = Callable[[tuple[str, ...]], None]

STALLED_CLEANUP_REPLAY_AFTER_SECONDS = 60


class StagingDatabaseCleanupEvidence(BaseModel):
    """Identifier-free database side of the physical cleanup gate."""

    target_conversations: int = Field(ge=0)
    target_workspaces: int = Field(ge=0)
    target_bindings: int = Field(ge=0)
    conversations_remaining: int = Field(ge=0)
    workspaces_remaining: int = Field(ge=0)
    bindings_remaining: int = Field(ge=0)
    consecutive_zero_checks: int = Field(ge=0)
    interval_seconds: float = Field(ge=0)
    complete: bool
    errors: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid", frozen=True)


class StagingJointCleanupEvidence(BaseModel):
    """Count-only DB and Vendor evidence captured in the same polling cycles."""

    conversations_remaining: int = Field(ge=0)
    workspaces_remaining: int = Field(ge=0)
    bindings_remaining: int = Field(ge=0)
    vendor_sandboxes_remaining: int = Field(ge=0)
    consecutive_zero_checks: int = Field(ge=0)
    interval_seconds: float = Field(ge=0)
    complete: bool
    errors: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid", frozen=True)


@dataclass(frozen=True, slots=True)
class StagingVendorRemainingSample:
    """One identifier-free Vendor target count sampled by the observer."""

    timestamp: datetime
    target_remaining: int

    def __post_init__(self) -> None:
        if self.timestamp.tzinfo is None or self.timestamp.utcoffset() is None:
            raise ValueError("Vendor cleanup sample timestamp must be timezone-aware")
        if self.target_remaining < 0:
            raise ValueError("Vendor cleanup target count must not be negative")


@dataclass(frozen=True, slots=True)
class StagingPhysicalCleanupResult:
    cleanup: tuple[StagingPublicCapacityUserCleanup, ...]
    database: StagingDatabaseCleanupEvidence
    joint: StagingJointCleanupEvidence
    private_manifest_path: Path


@dataclass(frozen=True, slots=True)
class StagingAllocationRecoveryResult:
    """Identifier-free outcome of the private pre-DELETE recovery probe."""

    allocated_count: int
    recovered_count: int
    private_manifest_path: Path


@dataclass(frozen=True, slots=True)
class _Allocation:
    worker_index: int
    conversation_id: str
    end_user: str


@dataclass(frozen=True, slots=True)
class _Target:
    worker_index: int
    conversation_id: str
    workspace_id: str
    binding_id: str
    backend_workspace_ref: str
    backend_binding_ref: str


class _RecoveryScope(TypedDict):
    worker_index: int
    end_user: str


def recover_unjournaled_staging_public_allocations(
    *,
    allocation_journal_path: Path,
    private_manifest_path: Path,
    invocation_id: str,
    requested_concurrency: int,
    benchmark_tenant_id: str,
    benchmark_agent_id: str,
    kube_context: str = "staging-main",
    namespace: str = "dify-staging",
    api_pod_selector: str = "app=dify-api",
    runner: CommandRunner | None = None,
) -> StagingAllocationRecoveryResult:
    """Recover cold POST allocations whose stream ended before its first SSE event.

    The probe is intentionally bounded by the exact deterministic EndUser scopes
    for this invocation, the dedicated tenant, and the benchmark Agent. It never
    scans or returns unrelated Conversations. Exact identifiers remain in the
    caller-provided 0600 recovery bundle and allocation journal only.
    """

    if requested_concurrency <= 0:
        raise ValueError("requested concurrency must be positive")
    if not benchmark_tenant_id.strip() or not benchmark_agent_id.strip():
        raise ValueError("benchmark tenant and Agent identities must not be empty")
    if private_manifest_path.exists():
        raise ValueError("private allocation recovery manifest must not already exist")

    existing, deleted = _read_allocation_journal(
        allocation_journal_path,
        requested_concurrency=requested_concurrency,
    )
    if deleted:
        raise RuntimeError("Conversation cleanup occurred before allocation recovery")

    scopes: tuple[_RecoveryScope, ...] = tuple(
        _RecoveryScope(
            worker_index=worker_index,
            end_user=bounded_end_user(f"{invocation_id}.b1.w{worker_index}"),
        )
        for worker_index in range(requested_concurrency)
    )
    invoke = runner or _run_command
    api_pod = _select_ready_api_pod(
        invoke,
        kube_context=kube_context,
        namespace=namespace,
        selector=api_pod_selector,
    )
    raw = _exec_private_probe(
        invoke,
        api_pod=api_pod,
        kube_context=kube_context,
        namespace=namespace,
        script=_RECOVER_ALLOCATIONS_SCRIPT,
        payload={
            "tenant_id": benchmark_tenant_id,
            "agent_id": benchmark_agent_id,
            "scopes": scopes,
        },
    )
    try:
        value = _parse_private_probe_json_object(raw)
    except RuntimeError as exc:
        _write_private_json(
            private_manifest_path,
            {
                "schema_version": 1,
                "status": "invalid_probe_response",
                "invocation_id": invocation_id,
                "requested_concurrency": requested_concurrency,
            },
        )
        raise RuntimeError("private allocation recovery returned an invalid response") from exc

    rows = cast(dict[object, object], value).get("allocations") if isinstance(value, dict) else None
    # Persist the scoped probe response before validation. If ownership is
    # ambiguous, operators retain the exact private evidence needed for manual
    # recovery while the public capacity point fails closed.
    _write_private_json(
        private_manifest_path,
        {
            "schema_version": 1,
            "status": "captured",
            "invocation_id": invocation_id,
            "requested_concurrency": requested_concurrency,
            "benchmark_tenant_id": benchmark_tenant_id,
            "benchmark_agent_id": benchmark_agent_id,
            "scopes": scopes,
            "allocations": rows,
        },
    )
    recovered = _validate_recovered_allocations(
        rows,
        scopes=scopes,
        existing=existing,
    )
    missing_from_journal = {
        worker_index: conversation_id
        for worker_index, conversation_id in recovered.items()
        if worker_index not in existing
    }
    if missing_from_journal:
        _append_allocation_records(allocation_journal_path, missing_from_journal)
    return StagingAllocationRecoveryResult(
        allocated_count=len(recovered),
        recovered_count=len(missing_from_journal),
        private_manifest_path=private_manifest_path,
    )


def reconcile_staging_public_resources(
    *,
    allocation_journal_path: Path,
    private_manifest_path: Path,
    invocation_id: str,
    requested_concurrency: int,
    expected_allocations: int | None = None,
    service_api_base_url: str,
    service_api_key: SecretStr,
    kube_context: str = "staging-main",
    namespace: str = "dify-staging",
    api_pod_selector: str = "app=dify-api",
    cleanup_timeout_seconds: float = 300,
    runner: CommandRunner | None = None,
    conversation_deleter: ConversationDeleter | None = None,
    before_delete: Callable[[Path], None] | None = None,
    vendor_remaining_probe: VendorRemainingProbe,
    benchmark_tenant_id: str | None = None,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> StagingPhysicalCleanupResult:
    """DELETE owned resources and require two joint DB/Vendor zero samples."""

    if requested_concurrency <= 0:
        raise ValueError("requested concurrency must be positive")
    if expected_allocations is None:
        expected_allocations = requested_concurrency
    if not 0 <= expected_allocations <= requested_concurrency:
        raise ValueError("expected allocations must be within the requested User count")
    if private_manifest_path.exists():
        raise ValueError("private cleanup manifest must not already exist")
    if cleanup_timeout_seconds < 20:
        raise ValueError("physical cleanup timeout must allow two zero checks")
    if benchmark_tenant_id is not None and not benchmark_tenant_id.strip():
        raise ValueError("benchmark tenant identity must not be empty")
    invoke = runner or _run_command
    allocations = _read_allocations(
        allocation_journal_path,
        invocation_id=invocation_id,
        requested_concurrency=requested_concurrency,
        expected_allocations=expected_allocations,
    )
    api_pod: str | None = None
    targets: tuple[_Target, ...] = ()
    if allocations:
        api_pod = _select_ready_api_pod(
            invoke,
            kube_context=kube_context,
            namespace=namespace,
            selector=api_pod_selector,
        )
        targets = _capture_targets(
            invoke,
            api_pod=api_pod,
            kube_context=kube_context,
            namespace=namespace,
            allocations=allocations,
        )
    _write_private_manifest(private_manifest_path, allocations, targets)
    before_delete_error: str | None = None
    if before_delete is not None:
        try:
            before_delete(private_manifest_path)
        except Exception:
            # At this point the exact DB ownership manifest is already safely
            # persisted. Preserve the failed Vendor reconciliation as invalid
            # evidence, but still DELETE every known Conversation so a
            # diagnostics failure cannot knowingly leak the whole block.
            before_delete_error = "pre-delete Vendor ownership reconciliation failed"

    key = service_api_key.get_secret_value()
    if not key:
        raise ValueError("Service API key must not be empty")
    delete = conversation_deleter or _http_deleter(service_api_base_url, key)
    cleanup: list[StagingPublicCapacityUserCleanup] = []
    next_delete_at = monotonic()
    for allocation in allocations:
        now = monotonic()
        if now < next_delete_at:
            sleep(next_delete_at - now)
        try:
            status_code = delete(allocation.conversation_id, allocation.end_user)
        except Exception as exc:
            cleanup.append(
                StagingPublicCapacityUserCleanup(
                    worker_index=allocation.worker_index,
                    attempted=True,
                    complete=False,
                    error=f"Conversation DELETE failed: {type(exc).__name__}",
                )
            )
        else:
            cleanup.append(
                StagingPublicCapacityUserCleanup(
                    worker_index=allocation.worker_index,
                    attempted=True,
                    http_status_code=status_code,
                    conversation_deleted=status_code == 204,
                    complete=status_code == 204,
                    error=None if status_code == 204 else f"Conversation DELETE returned HTTP {status_code}",
                )
            )
        next_delete_at = max(next_delete_at + 0.5, monotonic())

    stalled_resource_replayer: StalledResourceReplayer | None = None
    if targets and benchmark_tenant_id is not None:
        if api_pod is None:
            raise RuntimeError("database cleanup probe Pod was missing")

        def replay(workspace_ids: tuple[str, ...]) -> None:
            _replay_retired_workspace_collection(
                invoke,
                api_pod=api_pod,
                kube_context=kube_context,
                namespace=namespace,
                tenant_id=benchmark_tenant_id,
                workspace_ids=workspace_ids,
            )

        stalled_resource_replayer = replay

    database, joint = _wait_for_joint_zero(
        invoke,
        api_pod=api_pod,
        kube_context=kube_context,
        namespace=namespace,
        targets=targets,
        timeout_seconds=cleanup_timeout_seconds,
        vendor_remaining_probe=vendor_remaining_probe,
        stalled_resource_replayer=stalled_resource_replayer,
        monotonic=monotonic,
        sleep=sleep,
    )
    if before_delete_error is not None:
        database = database.model_copy(
            update={
                "complete": False,
                "errors": [*database.errors, before_delete_error],
            }
        )
        joint = joint.model_copy(
            update={
                "complete": False,
                "errors": [*joint.errors, before_delete_error],
            }
        )
    if len(cleanup) != len(allocations) or any(not item.complete for item in cleanup):
        database = database.model_copy(
            update={
                "complete": False,
                "errors": [*database.errors, "one or more Conversation DELETE operations were incomplete"],
            }
        )
        joint = joint.model_copy(
            update={
                "complete": False,
                "errors": [*joint.errors, "one or more Conversation DELETE operations were incomplete"],
            }
        )
    return StagingPhysicalCleanupResult(
        cleanup=tuple(cleanup),
        database=database,
        joint=joint,
        private_manifest_path=private_manifest_path,
    )


def validate_private_e2b_target_manifest(
    *,
    database_manifest_path: Path,
    e2b_manifest_path: Path,
    expected_targets: int,
) -> None:
    """Require the database and Vendor private manifests to describe the same targets."""

    if expected_targets < 0:
        raise ValueError("expected target count must not be negative")
    try:
        database_payload = json.loads(_read_private_text(database_manifest_path, "database cleanup manifest"))
        database_rows = database_payload["targets"]
        vendor_rows = [
            json.loads(line)
            for line in _read_private_text(e2b_manifest_path, "E2B target manifest").splitlines()
            if line.strip()
        ]
    except (KeyError, OSError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError("private cleanup target manifests could not be reconciled") from exc
    if not isinstance(database_rows, list) or len(database_rows) != expected_targets or len(vendor_rows) != expected_targets:
        raise RuntimeError("private cleanup target manifests did not cover every requested User")

    def db_identity(row: object) -> tuple[str, str, str]:
        if not isinstance(row, dict):
            raise RuntimeError("private cleanup target manifests were invalid")
        return (
            _required_string(row.get("backend_binding_ref")),
            _required_string(row.get("workspace_id")),
            _required_string(row.get("binding_id")),
        )

    def vendor_identity(row: object) -> tuple[str, str, str]:
        if not isinstance(row, dict):
            raise RuntimeError("private cleanup target manifests were invalid")
        return (
            _required_string(row.get("sandbox_id")),
            _required_string(row.get("workspace_id")),
            _required_string(row.get("binding_id")),
        )

    database_identities = [db_identity(row) for row in database_rows]
    vendor_identities = [vendor_identity(row) for row in vendor_rows]
    if (
        len(set(database_identities)) != expected_targets
        or len(set(vendor_identities)) != expected_targets
        or set(database_identities) != set(vendor_identities)
    ):
        raise RuntimeError("database and E2B target ownership did not match")


def _read_allocations(
    path: Path,
    *,
    invocation_id: str,
    requested_concurrency: int,
    expected_allocations: int,
) -> tuple[_Allocation, ...]:
    allocated, deleted = _read_allocation_journal(
        path,
        requested_concurrency=requested_concurrency,
    )
    if deleted:
        raise RuntimeError("Conversation cleanup occurred before private resource capture")
    if len(allocated) != expected_allocations or len(set(allocated.values())) != expected_allocations:
        raise RuntimeError("private allocation journal did not uniquely cover every allocated User")
    return tuple(
        _Allocation(
            worker_index=index,
            conversation_id=allocated[index],
            end_user=bounded_end_user(f"{invocation_id}.b1.w{index}"),
        )
        for index in sorted(allocated)
    )


def _read_allocation_journal(
    path: Path,
    *,
    requested_concurrency: int,
) -> tuple[dict[int, str], set[tuple[int, str]]]:
    allocated: dict[int, str] = {}
    deleted: set[tuple[int, str]] = set()
    for line in _read_private_text(path, "allocation journal").splitlines():
        try:
            entry = json.loads(line)
            worker_index = entry["worker_index"]
            conversation_id = entry["conversation_id"]
            event = entry["event"]
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("private allocation journal contained an invalid record") from exc
        if (
            isinstance(worker_index, bool)
            or not isinstance(worker_index, int)
            or not 0 <= worker_index < requested_concurrency
            or not isinstance(conversation_id, str)
            or not conversation_id
            or event not in {"allocated", "deleted"}
        ):
            raise RuntimeError("private allocation journal contained an invalid record")
        if event == "allocated":
            existing = allocated.get(worker_index)
            if existing is not None and existing != conversation_id:
                raise RuntimeError("one load User allocated more than one Conversation")
            allocated[worker_index] = conversation_id
        else:
            deleted.add((worker_index, conversation_id))
    if len(set(allocated.values())) != len(allocated):
        raise RuntimeError("private allocation journal did not uniquely identify allocated Users")
    return allocated, deleted


def _validate_recovered_allocations(
    rows: object,
    *,
    scopes: Sequence[_RecoveryScope],
    existing: dict[int, str],
) -> dict[int, str]:
    if not isinstance(rows, list):
        raise RuntimeError("private allocation recovery returned an invalid response")
    scope_by_end_user = {scope["end_user"]: scope["worker_index"] for scope in scopes}
    recovered: dict[int, str] = {}
    conversation_owners: dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError("private allocation recovery returned an invalid response")
        typed_row = cast(dict[object, object], row)
        end_user = typed_row.get("end_user")
        conversation_id = typed_row.get("conversation_id")
        if not isinstance(end_user, str) or not isinstance(conversation_id, str) or not conversation_id:
            raise RuntimeError("private allocation recovery returned an invalid response")
        worker_index = scope_by_end_user.get(end_user)
        if worker_index is None:
            raise RuntimeError("allocation recovery escaped the requested EndUser scope")
        if worker_index in recovered or conversation_id in conversation_owners:
            raise RuntimeError("allocation recovery found ambiguous Conversation ownership")
        recovered[worker_index] = conversation_id
        conversation_owners[conversation_id] = worker_index

    for worker_index, conversation_id in existing.items():
        if recovered.get(worker_index) != conversation_id:
            raise RuntimeError("allocation recovery did not match the existing journal")
    return recovered


def _append_allocation_records(path: Path, allocations: dict[int, str]) -> None:
    records = "".join(
        json.dumps(
            {
                "event": "allocated",
                "worker_index": worker_index,
                "conversation_id": allocations[worker_index],
            },
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
        for worker_index in sorted(allocations)
    )
    descriptor = -1
    try:
        flags = os.O_APPEND | os.O_WRONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags)
        opened_metadata = os.fstat(descriptor)
        if not stat.S_ISREG(opened_metadata.st_mode) or stat.S_IMODE(opened_metadata.st_mode) & 0o077:
            raise RuntimeError("private allocation journal was not a secure regular file")
        with os.fdopen(descriptor, "a", encoding="utf-8") as stream:
            descriptor = -1
            stream.write(records)
            stream.flush()
            os.fsync(stream.fileno())
    except RuntimeError:
        raise
    except OSError as exc:
        raise RuntimeError("recovered allocations could not be written to the private journal") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _select_ready_api_pod(
    runner: CommandRunner,
    *,
    kube_context: str,
    namespace: str,
    selector: str,
) -> str:
    raw = runner(
        (
            "kubectl",
            "--context",
            kube_context,
            "--namespace",
            namespace,
            "get",
            "pods",
            "-l",
            selector,
            "-o",
            "json",
        ),
        None,
    )
    payload = json.loads(raw)
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise RuntimeError("API Pod discovery returned an invalid response")
    ready: list[str] = []
    for item in items:
        metadata = item.get("metadata") if isinstance(item, dict) else None
        status = item.get("status") if isinstance(item, dict) else None
        conditions = status.get("conditions") if isinstance(status, dict) else None
        name = metadata.get("name") if isinstance(metadata, dict) else None
        if (
            isinstance(name, str)
            and isinstance(conditions, list)
            and any(
                isinstance(condition, dict)
                and condition.get("type") == "Ready"
                and condition.get("status") == "True"
                for condition in conditions
            )
        ):
            ready.append(name)
    if not ready:
        raise RuntimeError("no Ready Staging API Pod was available for cleanup reconciliation")
    return sorted(ready)[0]


def _capture_targets(
    runner: CommandRunner,
    *,
    api_pod: str,
    kube_context: str,
    namespace: str,
    allocations: Sequence[_Allocation],
) -> tuple[_Target, ...]:
    raw = _exec_private_probe(
        runner,
        api_pod=api_pod,
        kube_context=kube_context,
        namespace=namespace,
        script=_CAPTURE_TARGETS_SCRIPT,
        payload={"conversation_ids": [item.conversation_id for item in allocations]},
    )
    value = _parse_private_probe_json_object(raw)
    rows = value.get("targets") if isinstance(value, dict) else None
    if not isinstance(rows, list):
        raise RuntimeError("private resource capture returned an invalid response")
    allocation_by_conversation = {item.conversation_id: item for item in allocations}
    targets: list[_Target] = []
    for row in rows:
        if not isinstance(row, dict):
            raise RuntimeError("private resource capture returned an invalid response")
        conversation_id = _required_string(row.get("conversation_id"))
        workspace_id = _required_string(row.get("workspace_id"))
        binding_id = _required_string(row.get("binding_id"))
        backend_workspace_ref = _required_string(row.get("backend_workspace_ref"))
        backend_binding_ref = _required_string(row.get("backend_binding_ref"))
        allocation = allocation_by_conversation.get(conversation_id)
        if allocation is None or backend_workspace_ref != backend_binding_ref:
            raise RuntimeError("captured Agent resource ownership did not match the benchmark contract")
        targets.append(
            _Target(
                worker_index=allocation.worker_index,
                conversation_id=conversation_id,
                workspace_id=workspace_id,
                binding_id=binding_id,
                backend_workspace_ref=backend_workspace_ref,
                backend_binding_ref=backend_binding_ref,
            )
        )
    captured_conversations = {item.conversation_id for item in targets}
    if len(targets) != len(allocations) or captured_conversations != set(allocation_by_conversation):
        raise RuntimeError("not every benchmark Conversation had one Agent resource mapping")
    if len({item.workspace_id for item in targets}) != len(targets) or len(
        {item.binding_id for item in targets}
    ) != len(targets):
        raise RuntimeError("Agent Workspace or Binding identity was shared between load Users")
    return tuple(sorted(targets, key=lambda item: item.worker_index))


def _wait_for_joint_zero(
    runner: CommandRunner,
    *,
    api_pod: str | None,
    kube_context: str,
    namespace: str,
    targets: Sequence[_Target],
    timeout_seconds: float,
    vendor_remaining_probe: VendorRemainingProbe,
    stalled_resource_replayer: StalledResourceReplayer | None,
    monotonic: Callable[[], float],
    sleep: Callable[[float], None],
) -> tuple[StagingDatabaseCleanupEvidence, StagingJointCleanupEvidence]:
    started = monotonic()
    first_database_zero_at: float | None = None
    database_zero_checks = 0
    first_joint_zero_at: float | None = None
    first_joint_vendor_timestamp: datetime | None = None
    joint_zero_checks = 0
    latest = {"conversations": len(targets), "workspaces": len(targets), "bindings": len(targets)}
    latest_vendor = len(targets)
    database_errors: list[str] = []
    joint_errors: list[str] = []
    replay_attempted = False
    while monotonic() - started <= timeout_seconds:
        if targets:
            if api_pod is None:
                raise RuntimeError("database cleanup probe Pod was missing")
            raw = _exec_private_probe(
                runner,
                api_pod=api_pod,
                kube_context=kube_context,
                namespace=namespace,
                script=_COUNT_TARGETS_SCRIPT,
                payload={
                    "conversation_ids": [item.conversation_id for item in targets],
                    "workspace_ids": [item.workspace_id for item in targets],
                    "binding_ids": [item.binding_id for item in targets],
                },
            )
            value = _parse_private_probe_json_object(raw)
            if not isinstance(value, dict) or any(
                isinstance(value.get(key), bool) or not isinstance(value.get(key), int) or value[key] < 0
                for key in latest
            ):
                raise RuntimeError("database cleanup probe returned an invalid response")
            latest = {key: int(value[key]) for key in latest}
        vendor_sample = vendor_remaining_probe()
        latest_vendor = vendor_sample.target_remaining
        now = monotonic()
        database_zero = all(count == 0 for count in latest.values())
        if database_zero:
            if first_database_zero_at is None:
                first_database_zero_at = now
                database_zero_checks = 1
            elif now - first_database_zero_at >= 10:
                database_zero_checks = 2
        else:
            first_database_zero_at = None
            database_zero_checks = 0

        joint_zero = database_zero and latest_vendor == 0
        if joint_zero:
            if first_joint_zero_at is None:
                first_joint_zero_at = now
                first_joint_vendor_timestamp = vendor_sample.timestamp
                joint_zero_checks = 1
            elif (
                now - first_joint_zero_at >= 10
                and first_joint_vendor_timestamp is not None
                and (vendor_sample.timestamp - first_joint_vendor_timestamp).total_seconds() >= 10
            ):
                joint_zero_checks = 2
                break
        else:
            first_joint_zero_at = None
            first_joint_vendor_timestamp = None
            joint_zero_checks = 0
        if (
            not replay_attempted
            and stalled_resource_replayer is not None
            and now - started >= STALLED_CLEANUP_REPLAY_AFTER_SECONDS
            and latest["conversations"] == 0
            and latest_vendor == 0
            and (latest["workspaces"] > 0 or latest["bindings"] > 0)
        ):
            # The product collector intentionally treats individual destroy
            # failures as best-effort. Re-enqueue this immutable manifest once
            # after a sustained ledger-only stall; deleted targets are no-ops.
            stalled_resource_replayer(tuple(item.workspace_id for item in targets))
            replay_attempted = True
        sleep(5)
    if database_zero_checks < 2:
        database_errors.append("database Agent resources did not remain zero for two checks ten seconds apart")
    if joint_zero_checks < 2:
        joint_errors.append(
            "database Agent resources and Vendor Sandboxes did not jointly remain zero for two checks ten seconds apart"
        )
    database = StagingDatabaseCleanupEvidence(
        target_conversations=len(targets),
        target_workspaces=len(targets),
        target_bindings=len(targets),
        conversations_remaining=latest["conversations"],
        workspaces_remaining=latest["workspaces"],
        bindings_remaining=latest["bindings"],
        consecutive_zero_checks=database_zero_checks,
        interval_seconds=10 if database_zero_checks >= 2 else 0,
        complete=database_zero_checks >= 2 and all(count == 0 for count in latest.values()),
        errors=database_errors,
    )
    joint = StagingJointCleanupEvidence(
        conversations_remaining=latest["conversations"],
        workspaces_remaining=latest["workspaces"],
        bindings_remaining=latest["bindings"],
        vendor_sandboxes_remaining=latest_vendor,
        consecutive_zero_checks=joint_zero_checks,
        interval_seconds=10 if joint_zero_checks >= 2 else 0,
        complete=(
            joint_zero_checks >= 2
            and all(count == 0 for count in latest.values())
            and latest_vendor == 0
        ),
        errors=joint_errors,
    )
    return database, joint


def _replay_retired_workspace_collection(
    runner: CommandRunner,
    *,
    api_pod: str,
    kube_context: str,
    namespace: str,
    tenant_id: str,
    workspace_ids: tuple[str, ...],
) -> None:
    raw = _exec_private_probe(
        runner,
        api_pod=api_pod,
        kube_context=kube_context,
        namespace=namespace,
        script=_REPLAY_RETIRED_WORKSPACES_SCRIPT,
        payload={"tenant_id": tenant_id, "workspace_ids": workspace_ids},
    )
    value = _parse_private_probe_json_object(raw)
    if value != {"enqueued": True, "target_count": len(workspace_ids)}:
        raise RuntimeError("retired Agent Workspace replay returned an invalid response")


def _exec_private_probe(
    runner: CommandRunner,
    *,
    api_pod: str,
    kube_context: str,
    namespace: str,
    script: str,
    payload: dict[str, Any],
) -> str:
    return runner(
        (
            "kubectl",
            "--context",
            kube_context,
            "--namespace",
            namespace,
            "exec",
            "-i",
            api_pod,
            "--",
            "python",
            "-c",
            script,
        ),
        json.dumps(payload, separators=(",", ":"), sort_keys=True),
    )


def _parse_private_probe_json_object(raw: str) -> dict[str, Any]:
    """Read the final JSON object emitted by an API-Pod probe.

    Importing the API application can write framework or provider diagnostics to
    stdout before the probe's final ``print(json.dumps(...))``.  Those lines are
    not probe data.  Accepting only the final non-empty line keeps the wire
    contract strict while allowing the intentional final JSON result through.
    """

    if not isinstance(raw, str):
        raise RuntimeError("private probe returned an invalid response")
    last_line = next((line for line in reversed(raw.splitlines()) if line.strip()), None)
    if last_line is None:
        raise RuntimeError("private probe returned an invalid response")
    try:
        value = cast(object, json.loads(last_line))
    except json.JSONDecodeError as exc:
        raise RuntimeError("private probe returned an invalid response") from exc
    if not isinstance(value, dict):
        raise RuntimeError("private probe returned an invalid response")
    return cast(dict[str, Any], value)


def _write_private_manifest(
    path: Path,
    allocations: Sequence[_Allocation],
    targets: Sequence[_Target],
) -> None:
    _write_private_json(
        path,
        {
            "allocations": [asdict(item) for item in allocations],
            "targets": [asdict(item) for item in targets],
        },
    )


def _write_private_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            descriptor = -1
            json.dump(payload, stream, separators=(",", ":"), sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _read_private_text(path: Path, label: str) -> str:
    descriptor = -1
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise RuntimeError(f"private {label} was missing") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"private {label} was not a regular file")
    try:
        flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(path, flags)
        opened_metadata = os.fstat(descriptor)
        if not stat.S_ISREG(opened_metadata.st_mode):
            raise RuntimeError(f"private {label} was not a regular file")
        if stat.S_IMODE(opened_metadata.st_mode) & 0o077:
            raise RuntimeError(f"private {label} permissions were too broad")
        with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
            descriptor = -1
            return stream.read()
    except RuntimeError:
        raise
    except (OSError, UnicodeError) as exc:
        raise RuntimeError(f"private {label} could not be read") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _required_string(value: object) -> str:
    if not isinstance(value, str) or not value:
        raise RuntimeError("Conversation did not own a complete Agent resource mapping")
    return value


def _http_deleter(base_url: str, api_key: str) -> ConversationDeleter:
    def delete(conversation_id: str, end_user: str) -> int:
        with httpx.Client(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            trust_env=False,
            timeout=httpx.Timeout(30),
        ) as client:
            response = client.request(
                "DELETE",
                f"conversations/{conversation_id}",
                json={"user": end_user},
            )
            return response.status_code

    return delete


def _run_command(argv: Sequence[str], stdin: str | None) -> str:
    try:
        completed = subprocess.run(
            list(argv),
            input=stdin,
            text=True,
            capture_output=True,
            check=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Staging private probe timed out") from exc
    except subprocess.CalledProcessError as exc:
        # kubectl stdout/stderr can contain private probe payloads, Pod names,
        # or provider diagnostics. Preserve only the exit class for the public
        # failure path; the durable private recovery bundle remains available.
        raise RuntimeError("Staging private probe command failed") from exc
    return completed.stdout


_RECOVER_ALLOCATIONS_SCRIPT = r'''# dify-benchmark-recover-allocations
import json,sys
from app import app
from extensions.ext_database import db
from models import Agent,App,Conversation,EndUser
from models.enums import ConversationFromSource,EndUserType,InvokeFrom
from sqlalchemy import and_,select
p=json.load(sys.stdin); sessions=[r['end_user'] for r in p['scopes']]
with app.app_context(), db.session() as s:
 rows=s.execute(select(Conversation.id,EndUser.session_id).join(EndUser,EndUser.id==Conversation.from_end_user_id).join(App,App.id==Conversation.app_id).join(Agent,and_(Agent.id==p['agent_id'],Agent.tenant_id==p['tenant_id'],Agent.app_id==App.id)).where(App.tenant_id==p['tenant_id'],Conversation.is_deleted.is_(False),Conversation.from_source==ConversationFromSource.API,Conversation.invoke_from==InvokeFrom.SERVICE_API,EndUser.tenant_id==p['tenant_id'],EndUser.app_id==App.id,EndUser.type==EndUserType.SERVICE_API,EndUser.session_id.in_(sessions)).order_by(EndUser.session_id,Conversation.created_at,Conversation.id)).all()
print(json.dumps({'allocations':[{'conversation_id':r[0],'end_user':r[1]} for r in rows]},separators=(',',':')))
'''


_CAPTURE_TARGETS_SCRIPT = r'''# dify-benchmark-capture-targets
import json,sys
from app import app
from extensions.ext_database import db
from models import AgentWorkingResourceStatus,AgentWorkspace,AgentWorkspaceBinding,AgentWorkspaceOwnerType,App,Conversation
from sqlalchemy import and_,select
p=json.load(sys.stdin); ids=p['conversation_ids']
with app.app_context(), db.session() as s:
 rows=s.execute(select(Conversation.id,AgentWorkspace.id,AgentWorkspaceBinding.id,AgentWorkspace.backend_workspace_ref,AgentWorkspaceBinding.backend_binding_ref).join(AgentWorkspaceBinding,AgentWorkspaceBinding.id==Conversation.agent_workspace_binding_id).join(AgentWorkspace,and_(AgentWorkspace.id==AgentWorkspaceBinding.workspace_id,AgentWorkspace.tenant_id==AgentWorkspaceBinding.tenant_id,AgentWorkspace.app_id==AgentWorkspaceBinding.app_id)).join(App,App.id==Conversation.app_id).where(Conversation.id.in_(ids),Conversation.is_deleted.is_(False),AgentWorkspaceBinding.app_id==Conversation.app_id,AgentWorkspaceBinding.tenant_id==App.tenant_id,AgentWorkspaceBinding.status==AgentWorkingResourceStatus.ACTIVE,AgentWorkspace.owner_type==AgentWorkspaceOwnerType.CONVERSATION,AgentWorkspace.owner_id==Conversation.id,AgentWorkspace.owner_scope_key=='root',AgentWorkspace.status==AgentWorkingResourceStatus.ACTIVE)).all()
print(json.dumps({'targets':[{'conversation_id':r[0],'workspace_id':r[1],'binding_id':r[2],'backend_workspace_ref':r[3],'backend_binding_ref':r[4]} for r in rows]},separators=(',',':')))
'''

_COUNT_TARGETS_SCRIPT = r'''# dify-benchmark-count-targets
import json,sys
from app import app
from extensions.ext_database import db
from models import AgentWorkspace,AgentWorkspaceBinding,Conversation
from sqlalchemy import func,select
p=json.load(sys.stdin)
with app.app_context(), db.session() as s:
 out={'conversations':s.scalar(select(func.count()).select_from(Conversation).where(Conversation.id.in_(p['conversation_ids']))) or 0,'workspaces':s.scalar(select(func.count()).select_from(AgentWorkspace).where(AgentWorkspace.id.in_(p['workspace_ids']))) or 0,'bindings':s.scalar(select(func.count()).select_from(AgentWorkspaceBinding).where(AgentWorkspaceBinding.id.in_(p['binding_ids']))) or 0}
print(json.dumps(out,separators=(',',':')))
'''

_REPLAY_RETIRED_WORKSPACES_SCRIPT = r'''# dify-benchmark-replay-retired-workspaces
import json,sys
from app import celery
p=json.load(sys.stdin)
celery.send_task('tasks.collect_agent_resources_task.collect_agent_resources',kwargs={'tenant_id':p['tenant_id'],'workspace_ids':p['workspace_ids'],'binding_ids':[],'home_snapshot_ids':[]},queue='retention')
print(json.dumps({'enqueued':True,'target_count':len(p['workspace_ids'])},separators=(',',':')))
'''


__all__ = [
    "StagingAllocationRecoveryResult",
    "StagingDatabaseCleanupEvidence",
    "StagingPhysicalCleanupResult",
    "recover_unjournaled_staging_public_allocations",
    "reconcile_staging_public_resources",
    "validate_private_e2b_target_manifest",
]
