"""Parent facade for one isolated sustained public Staging capacity block."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Literal, Protocol, cast
from urllib.parse import quote

from pydantic import SecretStr

from benchmarks.staging_public_locust import bounded_end_user, staging_public_worker_environment
from benchmarks.staging_public_schemas import StagingPublicScenarioId
from benchmarks.staging_public_capacity_schemas import (
    StagingPublicCapacityConcurrency,
    StagingPublicCapacityExecution,
    StagingPublicCapacityLoadResult,
    StagingPublicCapacityPointRequest,
    StagingPublicCapacityReplicaCount,
    StagingPublicCapacitySetupResult,
    StagingPublicCapacityUserCleanup,
)


class _ProtocolSettings(Protocol):
    service_api_base_url: str
    api_key: SecretStr
    config_expected_sha256: str


@dataclass(frozen=True, slots=True)
class StagingPublicCapacityRequest:
    invocation_id: str
    settings: _ProtocolSettings = field(repr=False)
    scenario_id: StagingPublicScenarioId
    requested_concurrency: StagingPublicCapacityConcurrency
    expected_backend_replicas: StagingPublicCapacityReplicaCount = 1
    private_manifest_output: Path | None = field(default=None, repr=False)
    block_index: int = 1
    phase: Literal["initial"] = "initial"
    setup_timeout_seconds: float = 300.0
    warmup_seconds: float = 15.0
    measurement_seconds: float = 60.0
    drain_timeout_seconds: float = 180.0

    def __post_init__(self) -> None:
        if not self.invocation_id or len(self.invocation_id) > 120:
            raise ValueError("invocation_id must contain 1 to 120 characters")
        if self.scenario_id not in {"basic", "shell", "config"}:
            raise ValueError("unsupported public capacity scenario")
        if (
            isinstance(self.requested_concurrency, bool)
            or not isinstance(self.requested_concurrency, int)
            or not 1 <= self.requested_concurrency <= 160
        ):
            raise ValueError("requested_concurrency must be an integer from 1 through 160")
        if isinstance(self.expected_backend_replicas, bool) or self.expected_backend_replicas not in {1, 2, 4}:
            raise ValueError("expected_backend_replicas must be 1, 2, or 4")
        if self.private_manifest_output is not None and self.private_manifest_output.exists():
            raise ValueError("private_manifest_output must not already exist")
        if self.block_index != 1:
            raise ValueError("single-block capacity scans require block_index=1")
        if (
            min(
                self.setup_timeout_seconds,
                self.warmup_seconds,
                self.measurement_seconds,
                self.drain_timeout_seconds,
            )
            <= 0
        ):
            raise ValueError("capacity durations must be positive")


def run_staging_public_capacity_point(request: StagingPublicCapacityRequest) -> StagingPublicCapacityExecution:
    api_key = request.settings.api_key.get_secret_value()
    if not api_key:
        raise ValueError("Service API key cannot be empty")
    wire_request = StagingPublicCapacityPointRequest(
        invocation_id=request.invocation_id,
        service_api_base_url=request.settings.service_api_base_url,
        config_expected_sha256=request.settings.config_expected_sha256,
        scenario_id=request.scenario_id,
        requested_concurrency=request.requested_concurrency,
        expected_backend_replicas=request.expected_backend_replicas,
        block_index=request.block_index,
        phase=request.phase,
        setup_timeout_seconds=request.setup_timeout_seconds,
        warmup_seconds=request.warmup_seconds,
        measurement_seconds=request.measurement_seconds,
        drain_timeout_seconds=request.drain_timeout_seconds,
    )
    with tempfile.TemporaryDirectory(prefix="dify-staging-public-capacity-") as temporary:
        root = Path(temporary)
        request_path = root / "request.json"
        result_path = root / "execution.json"
        journal_path = root / "allocation-journal.jsonl"
        request_path.write_text(wire_request.model_dump_json(), encoding="utf-8")
        timeout = (
            request.setup_timeout_seconds
            + request.warmup_seconds
            + request.measurement_seconds
            + request.drain_timeout_seconds * 3
            + request.requested_concurrency
            + 60
        )
        process_error: str | None = None
        process: subprocess.CompletedProcess[str] | None = None
        try:
            process = subprocess.run(  # noqa: S603 - fixed interpreter/module argv.
                [
                    sys.executable,
                    "-m",
                    "benchmarks.staging_public_capacity_worker",
                    "--request",
                    str(request_path),
                    "--result",
                    str(result_path),
                    "--journal",
                    str(journal_path),
                ],
                cwd=Path(__file__).resolve().parents[1],
                capture_output=True,
                text=True,
                check=False,
                env=staging_public_worker_environment(api_key),
                timeout=timeout,
            )
        except KeyboardInterrupt:
            # The Stage CLI converts SIGTERM into KeyboardInterrupt while it
            # waits for this isolated worker.  Treat that as a failed child
            # result so the journal can leave the temporary directory and the
            # outer DB/Vendor reconciler can still capture ownership before it
            # issues any Conversation DELETE.
            process_error = "isolated public capacity worker was interrupted"
        except subprocess.TimeoutExpired:
            process_error = "isolated public capacity worker exceeded its process timeout"

        execution: StagingPublicCapacityExecution | None = None
        if process_error is None and process is not None and process.returncode in {0, 1} and result_path.is_file():
            try:
                execution = StagingPublicCapacityExecution.model_validate_json(result_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                process_error = "isolated public capacity worker returned an invalid result"
            if execution is not None and not _execution_matches_request(execution, request):
                execution = None
                process_error = "isolated public capacity worker returned a mismatched result"
        elif process_error is None:
            process_error = (
                f"isolated public capacity worker failed with exit {process.returncode if process else 'unknown'}"
            )

        # A completed worker deliberately leaves Conversation cleanup to the
        # outer physical reconciler.  Emergency DELETE is reserved for a child
        # crash/timeout where that orchestrator cannot trust the child result.
        recovery = (
            _recover_journaled_conversations(
                request,
                journal_path,
                api_key,
                # A scaling Stage must capture DB/Vendor ownership before
                # DELETE. When the outer orchestrator requested the private
                # journal, preserve it and let that reconciler own cleanup even
                # after a child crash. Standalone callers retain best-effort
                # emergency DELETE semantics.
                delete_conversations=request.private_manifest_output is None,
            )
            if process_error is not None
            else _Recovery(cleanups={}, errors=[], allocated_count=0)
        )
        manifest_error = _persist_private_manifest(journal_path, request.private_manifest_output)
        execution = _merge_recovery(
            execution or _failed_execution(request, process_error or "isolated public capacity worker failed"),
            recovery,
            process_error=process_error,
            manifest_error=manifest_error,
        )
    if api_key in execution.model_dump_json():
        raise RuntimeError("isolated public capacity worker leaked its Service API key")
    return execution


@dataclass(frozen=True, slots=True)
class _Recovery:
    cleanups: dict[int, StagingPublicCapacityUserCleanup]
    errors: list[str]
    allocated_count: int


def _execution_matches_request(
    execution: StagingPublicCapacityExecution,
    request: StagingPublicCapacityRequest,
) -> bool:
    return (
        execution.scenario_id == request.scenario_id
        and execution.requested_concurrency == request.requested_concurrency
        and execution.load.requested_users == request.requested_concurrency
        and execution.block_index == request.block_index
        and execution.phase == request.phase
        and execution.backend_replicas is None
        and execution.e2b_observation is None
        and not execution.cleanup
        and not execution.physical_cleanup.checked
        and not execution.physical_cleanup.complete
    )


def _persist_private_manifest(source: Path, destination: Path | None) -> str | None:
    """Persist the private lifecycle journal outside public artifacts when requested."""

    if destination is None:
        return None
    if not source.is_file():
        return "private allocation manifest source was unavailable"
    try:
        payload = source.read_bytes()
        descriptor = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as manifest:
            manifest.write(payload)
            manifest.flush()
            os.fsync(manifest.fileno())
    except OSError:
        return "private allocation manifest could not be persisted"
    return None


def _recover_journaled_conversations(
    request: StagingPublicCapacityRequest,
    journal_path: Path,
    api_key: str,
    *,
    delete_conversations: bool = True,
) -> _Recovery:
    allocated: dict[int, str] = {}
    deleted: set[tuple[int, str]] = set()
    errors: list[str] = []
    if journal_path.is_file():
        for line in journal_path.read_text(encoding="utf-8").splitlines():
            try:
                entry = cast(dict[str, object], json.loads(line))
                worker_index = entry.get("worker_index")
                conversation_id = entry.get("conversation_id")
                event = entry.get("event")
                if (
                    not isinstance(worker_index, int)
                    or isinstance(worker_index, bool)
                    or not 0 <= worker_index < request.requested_concurrency
                    or not isinstance(conversation_id, str)
                    or not conversation_id
                    or len(conversation_id) > 255
                    or event not in {"allocated", "deleted"}
                ):
                    raise ValueError
                if event == "allocated":
                    allocated[worker_index] = conversation_id
                else:
                    deleted.add((worker_index, conversation_id))
            except (json.JSONDecodeError, UnicodeError, ValueError):
                if "allocation journal contained an invalid record" not in errors:
                    errors.append("allocation journal contained an invalid record")
    recovered: dict[int, StagingPublicCapacityUserCleanup] = {}
    if not delete_conversations:
        return _Recovery(
            cleanups=recovered,
            errors=errors,
            allocated_count=len(allocated),
        )
    for worker_index, conversation_id in allocated.items():
        if (worker_index, conversation_id) in deleted:
            continue
        cleanup = _delete_conversation(
            base_url=request.settings.service_api_base_url,
            api_key=api_key,
            end_user=bounded_end_user(f"{request.invocation_id}.b{request.block_index}.w{worker_index}"),
            conversation_id=conversation_id,
        ).model_copy(update={"worker_index": worker_index})
        recovered[worker_index] = cleanup
        if not cleanup.complete:
            errors.append(f"worker {worker_index} fallback conversation cleanup failed")
        elif not _append_deleted_journal_record(journal_path, worker_index, conversation_id):
            errors.append(f"worker {worker_index} fallback cleanup journal update failed")
    return _Recovery(
        cleanups=recovered,
        errors=errors,
        allocated_count=len(allocated),
    )


def _append_deleted_journal_record(journal_path: Path, worker_index: int, conversation_id: str) -> bool:
    value = json.dumps(
        {"event": "deleted", "worker_index": worker_index, "conversation_id": conversation_id},
        separators=(",", ":"),
        sort_keys=True,
    )
    try:
        descriptor = os.open(journal_path, os.O_APPEND | os.O_WRONLY)
        with os.fdopen(descriptor, "a", encoding="utf-8") as journal:
            journal.write(value + "\n")
            journal.flush()
            os.fsync(journal.fileno())
    except OSError:
        return False
    return True


def _delete_conversation(
    *, base_url: str, api_key: str, end_user: str, conversation_id: str
) -> StagingPublicCapacityUserCleanup:
    import httpx

    try:
        with httpx.Client(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            trust_env=False,
            timeout=httpx.Timeout(30.0),
        ) as client:
            response = client.request(
                "DELETE", f"conversations/{quote(conversation_id, safe='')}", json={"user": end_user}
            )
        complete = response.status_code in {204, 404}
        return StagingPublicCapacityUserCleanup(
            worker_index=0,
            attempted=True,
            http_status_code=response.status_code,
            conversation_deleted=response.status_code == 204,
            complete=complete,
            recovered_by_parent=True,
            error=None if complete else f"fallback DELETE returned HTTP {response.status_code}",
        )
    except Exception as exc:
        return StagingPublicCapacityUserCleanup(
            worker_index=0,
            attempted=True,
            complete=False,
            recovered_by_parent=True,
            error=f"fallback DELETE failed: {type(exc).__name__}",
        )


def _failed_execution(request: StagingPublicCapacityRequest, error: str) -> StagingPublicCapacityExecution:
    return StagingPublicCapacityExecution(
        scenario_id=request.scenario_id,
        requested_concurrency=request.requested_concurrency,
        block_index=request.block_index,
        phase=request.phase,
        setup=StagingPublicCapacitySetupResult(errors=[error]),
        warmup_samples=[],
        observations=[],
        cleanup=[],
        load=StagingPublicCapacityLoadResult(
            requested_users=request.requested_concurrency,
            timed_out="timeout" in error,
            fatal_errors=[error],
        ),
    )


def _merge_recovery(
    execution: StagingPublicCapacityExecution,
    recovery: _Recovery,
    *,
    process_error: str | None,
    manifest_error: str | None,
) -> StagingPublicCapacityExecution:
    cleanups = {item.worker_index: item for item in execution.cleanup}
    cleanups.update(recovery.cleanups)
    errors = list(execution.load.fatal_errors)
    if process_error and process_error not in errors:
        errors.append(process_error)
    if manifest_error and manifest_error not in errors:
        errors.append(manifest_error)
    errors.extend(item for item in recovery.errors if item not in errors)
    setup = execution.setup
    if recovery.allocated_count:
        setup = setup.model_copy(
            update={
                "attempted_users": max(setup.attempted_users, recovery.allocated_count),
                "allocated_users": max(setup.allocated_users, recovery.allocated_count),
            }
        )
    return execution.model_copy(
        update={
            "setup": setup,
            "cleanup": [cleanups[index] for index in sorted(cleanups)],
            "load": execution.load.model_copy(update={"fatal_errors": errors}),
        }
    )


__all__ = ["StagingPublicCapacityRequest", "run_staging_public_capacity_point"]
