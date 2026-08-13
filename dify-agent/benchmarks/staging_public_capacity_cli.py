"""Run one explicitly confirmed public Staging replica-scaling stage."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import sys
import time
from types import FrameType

from pydantic import SecretStr

from benchmarks.staging_e2b_observer import (
    E2BObserverSample,
    E2B_API_KEY_ENV,
    StagingE2BLocalObserver,
    StagingE2BLocalObserverOptions,
    capacity_e2b_observation_for_window,
)
from benchmarks.staging_public_capacity_locust import (
    StagingPublicCapacityRequest,
    run_staging_public_capacity_point,
)
from benchmarks.staging_public_capacity_results import (
    build_staging_public_capacity_skipped_point,
    detect_suspected_boundaries,
    finalize_staging_public_capacity_point,
    finalize_staging_public_capacity_stage,
    staging_public_capacity_stage_matrix,
)
from benchmarks.staging_public_capacity_schemas import (
    STAGING_PUBLIC_CAPACITY_CONCURRENCY,
    STAGING_PUBLIC_CAPACITY_SCENARIOS,
    StagingPublicCapacityConcurrency,
    StagingPublicCapacityExecution,
    StagingPublicCapacityLoadResult,
    StagingPublicCapacityPhysicalCleanupEvidence,
    StagingPublicCapacityPoint,
    StagingPublicCapacityReplicaCount,
    StagingPublicCapacitySetupResult,
)
from benchmarks.staging_public_artifact_safety import (
    PublicArtifactSafetyError,
    validate_public_artifact_payload,
    validate_public_artifact_text,
)
from benchmarks.staging_public_cli import (
    DEFAULT_CONFIG_EXPECTED_SHA256,
    DEFAULT_STAGING_PUBLIC_BASE_URL,
    DETERMINISTIC_PLUGIN_VERSION,
    STAGING_PUBLIC_CONFIRMATION,
    TARGET_COMMIT,
    _git_identity,
    _plugin_package_version,
    _sha256,
)
from benchmarks.staging_public_deployment import collect_staging_backend_deployment_evidence
from benchmarks.staging_public_physical_cleanup import (
    StagingVendorRemainingSample,
    recover_unjournaled_staging_public_allocations,
    reconcile_staging_public_resources,
    validate_private_e2b_target_manifest,
)
from benchmarks.staging_public_protocol import (
    StagingPublicProtocolSettings,
    probe_staging_public_edge,
)
from benchmarks.staging_public_results import build_staging_public_environment
from benchmarks.staging_public_schemas import (
    StagingPublicEdgeProbeEvidence,
    StagingPublicScenarioId,
)


_RUN_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,120}$")
_SETUP_TIMEOUT_SECONDS = 300.0
_WARMUP_SECONDS = 15.0
_MEASUREMENT_SECONDS = 60.0
_DRAIN_TIMEOUT_SECONDS = 180.0
_PHYSICAL_CLEANUP_TIMEOUT_SECONDS = 300.0
_COOLDOWN_SECONDS = 30.0
# One block may legitimately consume setup + warmup drain + measurement drain
# + parent-side physical cleanup. Keep the count-only observer alive for the
# whole fail-closed lifecycle rather than expiring near the cleanup boundary.
_OBSERVER_DURATION_SECONDS = 1_800
_PREFLIGHT_ATTEMPTS = 10
_DEFAULT_PRIVATE_RECOVERY_ROOT = Path(__file__).with_name("private-recovery")


def main() -> int:
    api_key: str | None = None
    e2b_api_key: str | None = None
    private_values: tuple[str, ...] = ()
    artifact_dir: Path | None = None
    try:
        args = _parse_args()
        _require_confirmation()
        api_key = os.environ.get("BENCH_STAGING_API_KEY")
        if not api_key:
            raise RuntimeError("BENCH_STAGING_API_KEY must be provided through the environment")
        e2b_api_key = os.environ.get(E2B_API_KEY_ENV)
        if not e2b_api_key:
            raise RuntimeError(f"{E2B_API_KEY_ENV} must be provided through the environment")
        private_values = (
            api_key,
            e2b_api_key,
            args.benchmark_tenant_id,
            args.benchmark_agent_id,
        )
        run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        if not _RUN_ID_RE.fullmatch(run_id):
            raise ValueError("run id must contain only benchmark-safe identity characters")

        stage_artifact_dir = (
            args.results_root / f"{run_id}-staging-public-scaling-r{args.backend_replicas}"
        )
        artifact_dir = stage_artifact_dir
        stage_artifact_dir.mkdir(parents=True, exist_ok=False)
        blocks_dir = stage_artifact_dir / "blocks"
        blocks_dir.mkdir()
        _require_disjoint_private_recovery_root(
            private_recovery_root=args.private_recovery_root,
            public_artifact_dir=stage_artifact_dir,
        )

        plugin_version = _validate_plugin_package(args.plugin_package)
        settings = StagingPublicProtocolSettings(
            service_api_base_url=args.service_api_base_url,
            api_key=SecretStr(api_key),
            config_expected_sha256=args.config_expected_sha256,
        )
        harness_commit_before, harness_dirty_before = _git_identity()
        if harness_dirty_before:
            raise RuntimeError("public scaling requires a clean dify-agent Harness checkout")
        selected_matrix = _selected_stage_matrix(
            args.backend_replicas,
            scenario_filter=args.scenario,
            concurrency_filter=args.concurrency,
        )
        deployment_before = collect_staging_backend_deployment_evidence(
            expected_replicas=args.backend_replicas,
            kube_context=args.kube_context,
            namespace=args.namespace,
        )
        _write_json(
            stage_artifact_dir / "deployment-before.json",
            deployment_before.model_dump(mode="json"),
            forbidden_values=private_values,
        )
        # This read-only OPTIONS probe is deliberately independent of load.
        # It catches an edge rollout even when warmup establishes a boundary
        # and therefore no measurement transaction is admitted.
        edge_probe_before = _capture_public_edge_probe(settings.service_api_base_url)

        blocks: list[StagingPublicCapacityPoint] = []
        executions: list[StagingPublicCapacityExecution] = []
        stop_all_reason: str | None = (
            None
            if edge_probe_before is not None
            else "public edge x-version preflight did not pass"
        )
        basic_boundary_reason: str | None = None
        execution_count = 0
        for scenario_id, concurrency in selected_matrix:
            if stop_all_reason is not None:
                blocks.append(
                    _skipped_point(
                        scenario_id,
                        concurrency,
                        args.backend_replicas,
                        stop_all_reason,
                    )
                )
                continue
            if scenario_id == "basic" and basic_boundary_reason is not None:
                blocks.append(
                    _skipped_point(
                        scenario_id,
                        concurrency,
                        args.backend_replicas,
                        basic_boundary_reason,
                    )
                )
                continue
            if not deployment_before.valid:
                stop_all_reason = "replica-stage deployment preflight did not pass"
                blocks.append(
                    _skipped_point(
                        scenario_id,
                        concurrency,
                        args.backend_replicas,
                        stop_all_reason,
                    )
                )
                continue

            if execution_count:
                time.sleep(_COOLDOWN_SECONDS)
            execution_count += 1
            execution = _execute_block(
                run_id=run_id,
                settings=settings,
                scenario_id=scenario_id,
                concurrency=concurrency,
                backend_replicas=args.backend_replicas,
                api_key=api_key,
                blocks_dir=blocks_dir,
                kube_context=args.kube_context,
                namespace=args.namespace,
                e2b_api_key=e2b_api_key,
                benchmark_tenant_id=args.benchmark_tenant_id,
                benchmark_agent_id=args.benchmark_agent_id,
                private_recovery_root=args.private_recovery_root,
            )
            executions.append(execution)
            point = finalize_staging_public_capacity_point(execution)
            blocks.append(point)
            if point.status == "invalid":
                stop_all_reason = (
                    f"stopped after {scenario_id} c{concurrency} because correctness, environment, "
                    "or physical cleanup evidence was invalid"
                )
            elif point.status == "e2b_inventory_limited":
                stop_all_reason = (
                    f"stopped after {scenario_id} c{concurrency} because E2B Sandbox inventory "
                    "prevented setup"
                )
            elif scenario_id == "basic":
                candidate = next(
                    (
                        item
                        for item in detect_suspected_boundaries(blocks)
                        if item.backend_replicas == args.backend_replicas
                    ),
                    None,
                )
                if candidate is not None:
                    basic_boundary_reason = (
                        f"higher Basic points skipped after the first suspected boundary at "
                        f"c{candidate.higher_concurrency}"
                    )
                elif point.status == "e2b_limited":
                    basic_boundary_reason = (
                        f"higher Basic points skipped because c{concurrency} was E2B-limited and "
                        "cannot measure Agent replica scaling"
                    )

        # Probe before Kubernetes postflight so a rollout after the last
        # request cannot hide behind otherwise stable Deployment evidence.
        edge_probe_after = _capture_public_edge_probe(settings.service_api_base_url)
        try:
            deployment_after = collect_staging_backend_deployment_evidence(
                expected_replicas=args.backend_replicas,
                kube_context=args.kube_context,
                namespace=args.namespace,
            )
        except (OSError, RuntimeError, ValueError):
            deployment_after = deployment_before.model_copy(
                update={
                    "valid": False,
                    "errors": [*deployment_before.errors, "replica-stage deployment postflight failed"],
                }
            )
        harness_commit_after, harness_dirty_after = _git_identity()
        if harness_dirty_after or harness_commit_after != harness_commit_before:
            deployment_after = deployment_after.model_copy(
                update={
                    "valid": False,
                    "errors": [
                        *deployment_after.errors,
                        "public scaling Harness changed during the replica stage",
                    ],
                }
            )
        _write_json(
            stage_artifact_dir / "deployment-after.json",
            deployment_after.model_dump(mode="json"),
            forbidden_values=private_values,
        )
        environment = build_staging_public_environment(
            invocation_id=run_id,
            service_api_base_url=settings.service_api_base_url,
            harness_commit=harness_commit_before,
            harness_dirty=harness_dirty_before,
            target_commit=TARGET_COMMIT,
            scenario_manifest_sha256=_public_scaling_manifest_sha256(),
            deterministic_plugin_version=plugin_version,
            deterministic_plugin_package_sha256=_sha256(args.plugin_package),
            config_expected_sha256=settings.config_expected_sha256,
            e2b_observer_mode="local",
            benchmark_scope_fingerprint=_benchmark_scope_fingerprint(
                api_key=api_key,
                tenant_id=args.benchmark_tenant_id,
                agent_id=args.benchmark_agent_id,
            ),
            edge_version=edge_probe_before.edge_version if edge_probe_before else None,
            edge_server=edge_probe_before.edge_server if edge_probe_before else None,
            edge_version_before=edge_probe_before.edge_version if edge_probe_before else None,
            edge_version_after=edge_probe_after.edge_version if edge_probe_after else None,
            edge_server_before=edge_probe_before.edge_server if edge_probe_before else None,
            edge_server_after=edge_probe_after.edge_server if edge_probe_after else None,
        )
        _validate_public_artifact_directory(
            stage_artifact_dir,
            forbidden_values=private_values,
        )
        _result, no_invalid = finalize_staging_public_capacity_stage(
            artifact_dir=stage_artifact_dir,
            environment=environment,
            backend_replicas=args.backend_replicas,
            deployment_before=deployment_before.model_dump(mode="json"),
            deployment_after=deployment_after.model_dump(mode="json"),
            blocks=blocks,
            forbidden_values=private_values,
        )
        _validate_public_artifact_directory(
            stage_artifact_dir,
            forbidden_values=private_values,
        )
        print(stage_artifact_dir)
        return 0 if no_invalid else 1
    except PublicArtifactSafetyError as exc:
        message = exc.safe_message
        print(f"staging public scaling stage failed: {message}", file=sys.stderr)
        if artifact_dir is not None:
            _purge_public_artifact_directory(artifact_dir)
            _write_failure_diagnostic(artifact_dir, message, code=exc.code)
            print(f"staging public scaling diagnostics: {artifact_dir}", file=sys.stderr)
        return 2
    except (OSError, RuntimeError, ValueError) as exc:
        message = _redact(str(exc), api_key)
        code = "stage_failed"
        try:
            validate_public_artifact_text(
                message,
                forbidden_values=private_values,
            )
        except PublicArtifactSafetyError as safety_exc:
            code = safety_exc.code
            message = safety_exc.safe_message
        if artifact_dir is not None:
            try:
                _validate_public_artifact_directory(
                    artifact_dir,
                    forbidden_values=private_values,
                )
            except PublicArtifactSafetyError as safety_exc:
                _purge_public_artifact_directory(artifact_dir)
                code = safety_exc.code
                message = safety_exc.safe_message
            except OSError:
                _purge_public_artifact_directory(artifact_dir)
                code = "invalid_public_artifact"
                message = "public artifacts could not be safety validated"
            _write_failure_diagnostic(artifact_dir, message, code=code)
        print(f"staging public scaling stage failed: {message}", file=sys.stderr)
        if artifact_dir is not None:
            print(f"staging public scaling diagnostics: {artifact_dir}", file=sys.stderr)
        return 2


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-replicas", type=int, required=True, choices=(1, 2, 4))
    parser.add_argument("--service-api-base-url", default=DEFAULT_STAGING_PUBLIC_BASE_URL)
    parser.add_argument(
        "--config-expected-sha256",
        default=os.environ.get("BENCH_CONFIG_EXPECTED_SHA256", DEFAULT_CONFIG_EXPECTED_SHA256),
    )
    parser.add_argument("--run-id")
    parser.add_argument("--scenario", choices=STAGING_PUBLIC_CAPACITY_SCENARIOS)
    parser.add_argument("--concurrency", type=int, choices=STAGING_PUBLIC_CAPACITY_CONCURRENCY)
    parser.add_argument(
        "--plugin-package",
        type=Path,
        default=Path(__file__).with_name("build") / "staging" / "dify-agent-benchmark-model-0.1.2.difypkg",
    )
    parser.add_argument("--results-root", type=Path, default=Path(__file__).with_name("results"))
    parser.add_argument(
        "--private-recovery-root",
        type=Path,
        default=_DEFAULT_PRIVATE_RECOVERY_ROOT,
        help="private 0700 root for block journals retained after interrupted or failed cleanup",
    )
    parser.add_argument("--kube-context", default="staging-main")
    parser.add_argument("--namespace", default="dify-staging")
    parser.add_argument("--benchmark-tenant-id", required=True)
    parser.add_argument("--benchmark-agent-id", required=True)
    return parser.parse_args()


def _execute_block(
    *,
    run_id: str,
    settings: StagingPublicProtocolSettings,
    scenario_id: StagingPublicScenarioId,
    concurrency: StagingPublicCapacityConcurrency,
    backend_replicas: StagingPublicCapacityReplicaCount,
    api_key: str,
    blocks_dir: Path,
    kube_context: str,
    namespace: str,
    e2b_api_key: str,
    benchmark_tenant_id: str,
    benchmark_agent_id: str,
    private_recovery_root: Path,
) -> StagingPublicCapacityExecution:
    invocation_id = _block_invocation_id(run_id, scenario_id, concurrency)
    block_dir = blocks_dir / f"{scenario_id}-c{concurrency}-b1"
    block_dir.mkdir()
    recovery_handle, private_dir = _create_private_recovery_directory(private_recovery_root)
    allocation_journal = private_dir / "allocation-journal.jsonl"
    allocation_recovery_manifest = private_dir / "allocation-recovery.json"
    database_manifest = private_dir / "database-targets.json"
    final_e2b_manifest = private_dir / "e2b-final-targets.jsonl"
    execution: StagingPublicCapacityExecution | None = None
    physical_cleanup_complete = False
    observer_cleanup_complete = False
    observer = StagingE2BLocalObserver(
        StagingE2BLocalObserverOptions(
            api_key=SecretStr(e2b_api_key),
            tenant_id=SecretStr(benchmark_tenant_id),
            agent_id=SecretStr(benchmark_agent_id),
            duration_seconds=_OBSERVER_DURATION_SECONDS,
            runtime_dir=private_dir / "e2b-observer-runtime",
        )
    )
    try:
        observer.start()
        preflight = _wait_for_empty_e2b_inventory(observer, block_dir / "e2b-preflight.jsonl")
        if preflight.running != 0 or preflight.paused != 0:
            raise RuntimeError("old Benchmark E2B inventory was not zero before the block")

        execution = run_staging_public_capacity_point(
            StagingPublicCapacityRequest(
                invocation_id=invocation_id,
                settings=settings,
                scenario_id=scenario_id,
                requested_concurrency=concurrency,
                expected_backend_replicas=backend_replicas,
                private_manifest_output=allocation_journal,
                setup_timeout_seconds=_SETUP_TIMEOUT_SECONDS,
                warmup_seconds=_WARMUP_SECONDS,
                measurement_seconds=_MEASUREMENT_SECONDS,
                drain_timeout_seconds=_DRAIN_TIMEOUT_SECONDS,
            )
        )
        allocation_recovery = recover_unjournaled_staging_public_allocations(
            allocation_journal_path=allocation_journal,
            private_manifest_path=allocation_recovery_manifest,
            invocation_id=invocation_id,
            requested_concurrency=concurrency,
            benchmark_tenant_id=benchmark_tenant_id,
            benchmark_agent_id=benchmark_agent_id,
            kube_context=kube_context,
            namespace=namespace,
        )
        expected_allocations = allocation_recovery.allocated_count
        if expected_allocations - allocation_recovery.recovered_count != execution.setup.allocated_users:
            raise RuntimeError("parent allocation recovery did not match the worker allocation count")
        if allocation_recovery.recovered_count:
            execution = execution.model_copy(
                update={
                    "load": execution.load.model_copy(
                        update={
                            "fatal_errors": [
                                *execution.load.fatal_errors,
                                "parent recovered an admitted cold request without an SSE allocation identity",
                            ]
                        }
                    )
                }
            )

        def reconcile_e2b_manifest(captured_database_manifest: Path) -> None:
            last_error: RuntimeError | None = None
            for attempt in range(_PREFLIGHT_ATTEMPTS):
                candidate = private_dir / f"e2b-targets-{attempt}.jsonl"
                observer.collect_snapshot(destination=candidate)
                try:
                    validate_private_e2b_target_manifest(
                        database_manifest_path=captured_database_manifest,
                        e2b_manifest_path=candidate,
                        expected_targets=expected_allocations,
                    )
                    return
                except RuntimeError as exc:
                    last_error = exc
                    if attempt + 1 < _PREFLIGHT_ATTEMPTS:
                        time.sleep(1)
            raise last_error or RuntimeError("E2B target manifest could not be reconciled")

        def sample_vendor_remaining() -> StagingVendorRemainingSample:
            sample = observer.collect_latest_public_count_sample()
            if sample.target_remaining is None:
                raise RuntimeError("E2B observer target count was unavailable during cleanup")
            return StagingVendorRemainingSample(
                timestamp=sample.timestamp,
                target_remaining=sample.target_remaining,
            )

        cleanup = reconcile_staging_public_resources(
            allocation_journal_path=allocation_journal,
            private_manifest_path=database_manifest,
            invocation_id=invocation_id,
            requested_concurrency=concurrency,
            expected_allocations=expected_allocations,
            service_api_base_url=settings.service_api_base_url,
            service_api_key=settings.api_key,
            kube_context=kube_context,
            namespace=namespace,
            cleanup_timeout_seconds=_PHYSICAL_CLEANUP_TIMEOUT_SECONDS,
            before_delete=reconcile_e2b_manifest,
            vendor_remaining_probe=sample_vendor_remaining,
        )
        observer_artifacts = observer.stop_and_collect(
            public_output_dir=block_dir / "e2b",
            private_manifest_path=final_e2b_manifest,
        )
        if observer_artifacts.summary.target_count != expected_allocations:
            raise RuntimeError("E2B observer target count did not match allocated Conversations")
        e2b_observation = None
        if execution.load.measurement_started_at is not None and execution.load.measurement_ended_at is not None:
            samples = _read_e2b_samples(observer_artifacts.public_samples_path)
            e2b_observation = capacity_e2b_observation_for_window(
                samples,
                measurement_started_at=execution.load.measurement_started_at,
                measurement_ended_at=execution.load.measurement_ended_at,
            )
        elif (
            execution.scenario_id in {"shell", "config"}
            and execution.load.warmup_started_at is not None
            and execution.load.warmup_ended_at is not None
        ):
            # A Runtime limit can surface before the formal window opens. Use
            # only the independently sampled warmup window for attribution;
            # the request error itself remains diagnostic, not proof of E2B.
            samples = _read_e2b_samples(observer_artifacts.public_samples_path)
            e2b_observation = capacity_e2b_observation_for_window(
                samples,
                measurement_started_at=execution.load.warmup_started_at,
                measurement_ended_at=execution.load.warmup_ended_at,
            )
        joint = cleanup.joint
        physical = StagingPublicCapacityPhysicalCleanupEvidence(
            checked=True,
            target_conversations=expected_allocations,
            target_sandboxes=expected_allocations,
            db_workspaces_remaining=joint.workspaces_remaining,
            db_bindings_remaining=joint.bindings_remaining,
            vendor_sandboxes_remaining=joint.vendor_sandboxes_remaining,
            consecutive_zero_checks=joint.consecutive_zero_checks,
            interval_seconds=joint.interval_seconds,
            complete=joint.complete,
            errors=list(joint.errors),
        )
        physical_cleanup_complete = physical.complete
        execution = execution.model_copy(
            update={
                "backend_replicas": backend_replicas,
                "cleanup": list(cleanup.cleanup),
                "e2b_observation": e2b_observation,
                "physical_cleanup": physical,
            }
        )
    except (OSError, RuntimeError, ValueError, KeyboardInterrupt) as exc:
        safe_error = (
            "replica-scaling block was interrupted"
            if isinstance(exc, KeyboardInterrupt)
            else _redact(str(exc), api_key)
        )
        if execution is None:
            execution = _failed_execution(
                scenario_id,
                concurrency,
                backend_replicas,
                safe_error,
            )
        else:
            execution = execution.model_copy(
                update={
                    "backend_replicas": backend_replicas,
                    "load": execution.load.model_copy(
                        update={"fatal_errors": [*execution.load.fatal_errors, safe_error]}
                    ),
                    "physical_cleanup": execution.physical_cleanup.model_copy(
                        update={
                            "complete": False,
                            "errors": [*execution.physical_cleanup.errors, safe_error],
                        }
                    ),
                }
            )
    finally:
        try:
            observer.close()
            observer_cleanup_complete = True
        except (OSError, RuntimeError, ValueError, KeyboardInterrupt) as exc:
            safe_error = (
                "E2B observer cleanup was interrupted"
                if isinstance(exc, KeyboardInterrupt)
                else _redact(f"E2B observer cleanup failed: {type(exc).__name__}", api_key)
            )
            if execution is None:
                execution = _failed_execution(scenario_id, concurrency, backend_replicas, safe_error)
            else:
                execution = execution.model_copy(
                    update={
                        "load": execution.load.model_copy(
                            update={"fatal_errors": [*execution.load.fatal_errors, safe_error]}
                        ),
                        "physical_cleanup": execution.physical_cleanup.model_copy(
                            update={"errors": [*execution.physical_cleanup.errors, safe_error]}
                        ),
                    }
                )
    if execution is None:
        execution = _failed_execution(
            scenario_id,
            concurrency,
            backend_replicas,
            "replica-scaling block ended without an execution result",
        )
    if physical_cleanup_complete and observer_cleanup_complete:
        shutil.rmtree(private_dir)
    else:
        _write_json(
            block_dir / "recovery.json",
            {
                "schema_version": 1,
                "status": "manual_cleanup_required",
                "handle": recovery_handle,
            },
            forbidden_values=(
                api_key,
                benchmark_tenant_id,
                benchmark_agent_id,
                e2b_api_key,
            ),
        )
    _write_json(
        block_dir / "execution.json",
        execution.model_dump(mode="json"),
        forbidden_values=(
            api_key,
            benchmark_tenant_id,
            benchmark_agent_id,
            e2b_api_key,
        ),
    )
    return execution


def _require_disjoint_private_recovery_root(
    *, private_recovery_root: Path, public_artifact_dir: Path
) -> None:
    private = private_recovery_root.expanduser().resolve()
    public = public_artifact_dir.resolve()
    if private == public or private in public.parents or public in private.parents:
        raise ValueError("private recovery root must be disjoint from public artifacts")


def _create_private_recovery_directory(root: Path) -> tuple[str, Path]:
    candidate_root = root.expanduser().absolute()
    candidate_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if candidate_root.is_symlink() or not candidate_root.is_dir():
        raise RuntimeError("private recovery root must be a real directory")
    resolved_root = candidate_root.resolve()
    os.chmod(resolved_root, 0o700)
    handle = "recovery-" + secrets.token_hex(12)
    private_dir = resolved_root / handle
    private_dir.mkdir(mode=0o700)
    return handle, private_dir


def _wait_for_empty_e2b_inventory(
    observer: StagingE2BLocalObserver,
    destination: Path,
) -> E2BObserverSample:
    last_error: RuntimeError | None = None
    for _ in range(_PREFLIGHT_ATTEMPTS):
        try:
            return observer.collect_public_count_snapshot(destination=destination)
        except RuntimeError as exc:
            last_error = exc
            if destination.exists():
                raise
            time.sleep(1)
    raise last_error or RuntimeError("E2B inventory preflight did not produce a count sample")


def _read_e2b_samples(path: Path) -> tuple[E2BObserverSample, ...]:
    try:
        samples = tuple(
            E2BObserverSample.model_validate_json(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        )
    except (OSError, ValueError) as exc:
        raise RuntimeError("E2B observer measurement samples were invalid") from exc
    if not samples:
        raise RuntimeError("E2B observer measurement samples were empty")
    return samples


def _require_confirmation() -> None:
    if os.environ.get("BENCH_CONFIRM_STAGING_RUN") != STAGING_PUBLIC_CONFIRMATION:
        raise RuntimeError(
            "public Staging scaling requires BENCH_CONFIRM_STAGING_RUN=RUN_STAGING_BENCHMARK"
        )


def _validate_plugin_package(path: Path) -> str:
    if not path.is_file():
        raise RuntimeError(f"deterministic plugin package was not found: {path}")
    version = _plugin_package_version(path)
    if version != DETERMINISTIC_PLUGIN_VERSION:
        raise RuntimeError(
            "deterministic plugin package version did not match the public scaling contract: "
            f"expected {DETERMINISTIC_PLUGIN_VERSION}, found {version}"
        )
    return version


def _stage_execution_order(
    backend_replicas: StagingPublicCapacityReplicaCount,
) -> tuple[tuple[StagingPublicScenarioId, int], ...]:
    if backend_replicas == 1:
        return (
            ("basic", 1),
            ("shell", 1),
            ("config", 1),
            *(("basic", value) for value in STAGING_PUBLIC_CAPACITY_CONCURRENCY if value != 1),
            ("shell", 10),
            ("shell", 20),
            ("config", 10),
            ("config", 20),
        )
    return (
        ("basic", 1),
        ("shell", 10),
        ("config", 10),
        *(("basic", value) for value in STAGING_PUBLIC_CAPACITY_CONCURRENCY if value != 1),
    )


def _selected_stage_matrix(
    backend_replicas: StagingPublicCapacityReplicaCount,
    *,
    scenario_filter: StagingPublicScenarioId | None,
    concurrency_filter: int | None,
) -> list[tuple[StagingPublicScenarioId, StagingPublicCapacityConcurrency]]:
    expected = set(staging_public_capacity_stage_matrix(backend_replicas))
    return [
        (scenario_id, concurrency)
        for scenario_id, concurrency in _stage_execution_order(backend_replicas)
        if (scenario_id, concurrency) in expected
        and (scenario_filter is None or scenario_id == scenario_filter)
        and (concurrency_filter is None or concurrency == concurrency_filter)
    ]


def _block_invocation_id(
    run_id: str,
    scenario_id: StagingPublicScenarioId,
    concurrency: StagingPublicCapacityConcurrency,
) -> str:
    suffix = f".{scenario_id}.c{concurrency}"
    candidate = run_id + suffix
    if len(candidate) <= 120:
        return candidate
    digest = hashlib.sha256(run_id.encode()).hexdigest()[:12]
    prefix_length = 120 - len(suffix) - len(digest) - 1
    return f"{run_id[:prefix_length]}-{digest}{suffix}"


def _failed_execution(
    scenario_id: StagingPublicScenarioId,
    concurrency: StagingPublicCapacityConcurrency,
    backend_replicas: StagingPublicCapacityReplicaCount,
    error: str,
) -> StagingPublicCapacityExecution:
    return StagingPublicCapacityExecution(
        scenario_id=scenario_id,
        requested_concurrency=concurrency,
        backend_replicas=backend_replicas,
        setup=StagingPublicCapacitySetupResult(errors=[error]),
        observations=[],
        cleanup=[],
        load=StagingPublicCapacityLoadResult(requested_users=concurrency, fatal_errors=[error]),
        physical_cleanup=StagingPublicCapacityPhysicalCleanupEvidence(errors=[error]),
    )


def _skipped_point(
    scenario_id: StagingPublicScenarioId,
    concurrency: StagingPublicCapacityConcurrency,
    backend_replicas: StagingPublicCapacityReplicaCount,
    reason: str,
) -> StagingPublicCapacityPoint:
    return build_staging_public_capacity_skipped_point(
        scenario_id=scenario_id,
        requested_concurrency=concurrency,
        block_index=1,
        backend_replicas=backend_replicas,
        reason=reason,
    )


def _public_scaling_manifest_sha256() -> str:
    payload = json.dumps(
        {
            "mode": "staging-public-e2e-scaling",
            "replica_matrices": {
                str(replicas): staging_public_capacity_stage_matrix(replicas)
                for replicas in (1, 2, 4)
            },
            "scenario_version": 1,
            "setup_spawn_rate_users_per_second": 1,
            "warmup_seconds": _WARMUP_SECONDS,
            "measurement_seconds": _MEASUREMENT_SECONDS,
            "drain_timeout_seconds": _DRAIN_TIMEOUT_SECONDS,
            "cooldown_seconds": _COOLDOWN_SECONDS,
            "measurement": "closed_loop_sustained",
            "blocks_per_point": 1,
            "cleanup": "parent_db_and_e2b_reconciled",
            "setup": {"basic": ["basic"], "shell": ["basic"], "config": ["basic", "shell"]},
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def _benchmark_scope_fingerprint(*, api_key: str, tenant_id: str, agent_id: str) -> str:
    """Return a non-reversible same-scope comparison token for Stage aggregation."""

    key = hashlib.sha256(api_key.encode()).digest()
    payload = json.dumps(
        {"agent_id": agent_id, "tenant_id": tenant_id},
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    return "hmac-sha256:" + hmac.new(key, payload, hashlib.sha256).hexdigest()


def _capture_public_edge_probe(
    service_api_base_url: str,
) -> StagingPublicEdgeProbeEvidence | None:
    """Return sanitized read-only edge evidence, failing closed via ``None``."""

    try:
        return probe_staging_public_edge(service_api_base_url)
    except (OSError, RuntimeError, ValueError):
        return None


def _write_json(
    path: Path,
    payload: object,
    *,
    forbidden_values: tuple[str, ...] = (),
) -> None:
    validate_public_artifact_payload(payload, forbidden_values=forbidden_values)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str), encoding="utf-8")


def _write_failure_diagnostic(artifact_dir: Path, message: str, *, code: str) -> None:
    try:
        _write_json(
            artifact_dir / "stage-diagnostics.json",
            {
                "schema_version": 1,
                "status": "failed",
                "error": {"code": code, "message": message},
            },
        )
    except OSError:
        pass


def _validate_public_artifact_directory(
    artifact_dir: Path,
    *,
    forbidden_values: tuple[str, ...],
) -> None:
    for path in artifact_dir.rglob("*"):
        if path.is_symlink():
            raise PublicArtifactSafetyError(
                code="unsafe_artifact_link",
                safe_message="public artifact directory contained a symbolic link",
            )
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if path.suffix == ".json":
            try:
                payload = json.loads(text)
            except ValueError as exc:
                raise PublicArtifactSafetyError(
                    code="invalid_public_artifact",
                    safe_message="public JSON artifact could not be safety validated",
                ) from exc
            validate_public_artifact_payload(payload, forbidden_values=forbidden_values)
        elif path.suffix == ".jsonl":
            for line in text.splitlines():
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                except ValueError as exc:
                    raise PublicArtifactSafetyError(
                        code="invalid_public_artifact",
                        safe_message="public JSONL artifact could not be safety validated",
                    ) from exc
                validate_public_artifact_payload(payload, forbidden_values=forbidden_values)
        else:
            validate_public_artifact_text(text, forbidden_values=forbidden_values)


def _purge_public_artifact_directory(artifact_dir: Path) -> None:
    if artifact_dir.exists():
        shutil.rmtree(artifact_dir)
    artifact_dir.mkdir(parents=True, exist_ok=False)


def _redact(message: str, api_key: str | None) -> str:
    redacted = message.replace(api_key, "[REDACTED]") if api_key else message
    return redacted[:2_000]


def _sigterm_as_keyboard_interrupt(_signal_number: int, _frame: FrameType | None) -> None:
    """Interrupt the isolated worker wait without bypassing its journal handoff."""

    raise KeyboardInterrupt


def _run_cli() -> int:
    """Install process-entrypoint signal handling without mutating callers of ``main``."""

    previous = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, _sigterm_as_keyboard_interrupt)
    try:
        return main()
    except KeyboardInterrupt:
        # An interrupt received outside the isolated worker wait has no safe
        # block-local continuation. Keep the message static and private-value
        # free; interrupts received during the wait are consumed by the facade
        # and proceed through the normal physical cleanup gate instead.
        print("staging public scaling stage interrupted before safe cleanup completed", file=sys.stderr)
        return 130
    finally:
        signal.signal(signal.SIGTERM, previous)


if __name__ == "__main__":
    raise SystemExit(_run_cli())


__all__ = ["main"]
