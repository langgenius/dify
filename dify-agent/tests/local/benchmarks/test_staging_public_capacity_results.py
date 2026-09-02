from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

import pytest

from benchmarks.staging_public_artifact_safety import PublicArtifactSafetyError
from benchmarks.staging_public_capacity_results import (
    build_staging_public_capacity_skipped_point,
    detect_suspected_boundaries,
    finalize_staging_public_capacity,
    finalize_staging_public_capacity_point,
    finalize_staging_public_capacity_stage,
    staging_public_capacity_stage_matrix,
)
from benchmarks.staging_public_capacity_schemas import (
    StagingPublicCapacityConcurrency,
    StagingPublicCapacityE2BObservation,
    StagingPublicCapacityExecution,
    StagingPublicCapacityLoadResult,
    StagingPublicCapacityObservation,
    StagingPublicCapacityPhysicalCleanupEvidence,
    StagingPublicCapacityPoint,
    StagingPublicCapacityReplicaCount,
    StagingPublicCapacitySetupResult,
    StagingPublicCapacityUserCleanup,
)
from benchmarks.staging_public_results import build_staging_public_environment
from benchmarks.staging_public_deployment import (
    StagingBackendDeploymentEvidence,
    StagingBackendPodEvidence,
    StagingCollectorPreflightEvidence,
)
from benchmarks.staging_public_schemas import StagingPublicRunSample, StagingPublicScenarioId


def _sample(scenario: StagingPublicScenarioId, index: int, terminal_ms: float) -> StagingPublicRunSample:
    return StagingPublicRunSample(
        scenario_id=scenario,
        benchmark_run_id=f"run.{scenario}.{index}",
        admitted=True,
        http_status_code=200,
        response_headers_ms=terminal_ms / 4,
        time_to_first_sse_ms=terminal_ms / 3,
        time_to_first_answer_ms=terminal_ms / 2,
        terminal_e2e_ms=terminal_ms,
        event_count=2,
        answer_bytes=10,
        terminal_status="succeeded",
        deterministic_markers_valid=True,
        shell_evidence_valid=scenario == "shell",
        config_materialized_item_count=13 if scenario == "config" else 0,
        config_materialized_bytes=53_248 if scenario == "config" else 0,
        config_materialized_sha256="a" * 64 if scenario == "config" else None,
        config_sha_valid=scenario == "config",
        file_payload_bytes=16 * 1024 * 1024 if scenario == "file" else 0,
        file_payload_sha256=(
            "341aacac661ccb210720bedaa9ead5d668fe5ea41a73532fc147c71e34040df1" if scenario == "file" else None
        ),
        file_integrity_valid=scenario == "file",
        edge_version="v1",
    )


def _execution(
    scenario: StagingPublicScenarioId,
    concurrency: StagingPublicCapacityConcurrency,
    *,
    replicas: StagingPublicCapacityReplicaCount = 1,
    terminal_ms: float = 100,
    count: int = 60,
) -> StagingPublicCapacityExecution:
    observations = [
        StagingPublicCapacityObservation(
            worker_index=index % concurrency,
            turn_index=index // concurrency,
            admitted_offset_seconds=float(index % 60) + 0.01,
            terminal_offset_seconds=float(index % 60) + terminal_ms / 1000,
            completed_after_admission_window=False,
            sample=_sample(scenario, index + replicas * 10_000 + concurrency * 100, terminal_ms),
        )
        for index in range(count)
    ]
    started = datetime(2026, 8, 13, 1, 0, tzinfo=UTC)
    return StagingPublicCapacityExecution(
        scenario_id=scenario,
        requested_concurrency=concurrency,
        backend_replicas=replicas,
        setup=StagingPublicCapacitySetupResult(
            attempted_users=concurrency,
            allocated_users=concurrency,
            successful_users=concurrency,
            complete=True,
        ),
        observations=observations,
        cleanup=[
            StagingPublicCapacityUserCleanup(
                worker_index=index,
                attempted=True,
                http_status_code=204,
                conversation_deleted=True,
                complete=True,
            )
            for index in range(concurrency)
        ],
        load=StagingPublicCapacityLoadResult(
            requested_users=concurrency,
            spawned_users=concurrency,
            setup_ready_users=concurrency,
            warmup_attempted=concurrency,
            warmup_completed=concurrency,
            attempted=count,
            admitted=count,
            terminal=count,
            successful=count,
            observed_max_active=concurrency,
            active_integral_seconds=concurrency * 60,
            active_mean=float(concurrency),
            setup_duration_seconds=concurrency,
            warmup_duration_seconds=15,
            admission_duration_seconds=60,
            measurement_duration_seconds=60,
            drain_duration_seconds=2,
            drained_runs=1,
            measurement_started_at=started,
            measurement_ended_at=started + timedelta(seconds=60),
        ),
        e2b_observation=StagingPublicCapacityE2BObservation(
            running_max=min(concurrency, 19),
            paused_max=concurrency,
            observation_complete=True,
            sample_count=60,
            successful_sample_count=60,
        ),
        physical_cleanup=StagingPublicCapacityPhysicalCleanupEvidence(
            checked=True,
            target_conversations=concurrency,
            target_sandboxes=concurrency,
            target_tool_files=1 if scenario == "file" else 0,
            consecutive_zero_checks=2,
            interval_seconds=10,
            complete=True,
        ),
    )


def _point(
    scenario: StagingPublicScenarioId,
    concurrency: StagingPublicCapacityConcurrency,
    *,
    replicas: StagingPublicCapacityReplicaCount = 1,
    terminal_ms: float = 100,
    count: int = 60,
) -> StagingPublicCapacityPoint:
    return finalize_staging_public_capacity_point(
        _execution(
            scenario,
            concurrency,
            replicas=replicas,
            terminal_ms=terminal_ms,
            count=count,
        )
    )


def _environment():
    return build_staging_public_environment(
        invocation_id="capacity",
        service_api_base_url="https://api-staging.dify.dev/v1/",
        harness_commit="a" * 40,
        harness_dirty=False,
        target_commit="f" * 40,
        scenario_manifest_sha256="b" * 64,
        deterministic_plugin_version="0.1.4",
        deterministic_plugin_package_sha256="c" * 64,
        config_expected_sha256="d" * 64,
        e2b_observer_mode="local",
        benchmark_scope_fingerprint="hmac-sha256:" + "f" * 64,
        edge_version="v1",
        edge_version_before="v1",
        edge_version_after="v1",
    )


def _deployment(
    replicas: StagingPublicCapacityReplicaCount,
    *,
    file_cleanup_valid: bool = True,
) -> dict[str, object]:
    return StagingBackendDeploymentEvidence(
        captured_at="2026-08-13T00:00:00+00:00",
        kube_context="staging-main",
        namespace="dify-staging",
        deployment_name="dify-agent-backend",
        service_name="dify-agent-backend-svc",
        expected_replicas=replicas,
        desired_replicas=replicas,
        updated_replicas=replicas,
        ready_replicas=replicas,
        available_replicas=replicas,
        generation=3,
        observed_generation=3,
        ready_endpoints=replicas,
        argo_child_auto_sync_disabled=True,
        argo_parent_auto_sync_enabled=True,
        argo_parent_self_heal_enabled=True,
        effective_agent_config_fingerprint="d" * 64,
        collector_preflight=StagingCollectorPreflightEvidence(
            deployment_name="dify-dataset-worker",
            desired_replicas=1,
            updated_replicas=1,
            ready_replicas=1,
            available_replicas=1,
            selected_pods=1,
            ready_pods=1,
            restarted_containers=0,
            deployment_generation=11,
            deployment_observed_generation=11,
            pod_uid="collector-uid-0",
            pod_image="registry/api@sha256:collector",
            pod_image_id="registry/api@sha256:collector",
            retention_queue_configured=True,
            file_cleanup_valid=file_cleanup_valid,
            agent_backend_base_url_configured=True,
            agent_backend_health_reachable=False,
            agent_backend_openapi_reachable=True,
            valid=True,
        ),
        pods=[
            StagingBackendPodEvidence(
                name=f"agent-{index}",
                uid=f"uid-{index}",
                node_name=f"node-{index}",
                zone=f"zone-{index % 3}",
                ready=True,
                restart_count=0,
                image="agent@sha256:abc",
                image_id="agent@sha256:abc",
                cpu_request_millicores=2_000,
                cpu_limit_millicores=2_000,
                memory_request_mib=2_048,
                memory_limit_mib=2_048,
                declared_workers=2,
                observed_workers=2,
            )
            for index in range(replicas)
        ],
        valid=True,
    ).model_dump(mode="json")


def test_sustained_metrics_use_admission_window_plus_drain() -> None:
    point = _point("basic", 10)
    assert point.status == "valid_scaling"
    assert point.metrics.admission_runs_per_second == 1
    assert point.metrics.terminal_runs_per_second == 60 / 62
    assert point.metrics.active_mean == 10
    assert point.metrics.active_max == 10
    assert len(point.metrics.buckets) == 6
    assert point.metrics.buckets[0].attempted == 10
    assert point.metrics.early_terminal_p95_ms == 100
    assert point.metrics.late_terminal_p95_ms == 100
    assert point.metrics.terminal_p95_change_ratio == 0


def test_basic_operational_failure_is_suspected_saturation_at_any_level() -> None:
    execution = _execution("basic", 1)
    execution.load.timeout_requests = 1
    execution.load.timed_out = True
    assert finalize_staging_public_capacity_point(execution).status == "saturated"


def test_basic_warmup_operational_failure_is_boundary_without_measurement_tps() -> None:
    execution = _execution("basic", 10)
    execution.warmup_samples = [
        StagingPublicRunSample(
            scenario_id="basic",
            benchmark_run_id="warmup-timeout",
            admitted=True,
            error_type="timeout",
            error="request timed out",
        )
    ]
    execution.observations = []
    execution.load.warmup_attempted = 1
    execution.load.warmup_completed = 0
    execution.load.warmup_operational_failures = 1
    execution.load.warmup_peak_consecutive_operational_failures = 1
    execution.load.attempted = 0
    execution.load.admitted = 0
    execution.load.terminal = 0
    execution.load.successful = 0
    execution.load.observed_max_active = 0
    execution.load.active_integral_seconds = 0
    execution.load.active_mean = 0
    execution.load.admission_duration_seconds = 0
    execution.load.measurement_duration_seconds = 0
    execution.load.drain_duration_seconds = 0
    execution.load.drained_runs = 0
    execution.load.measurement_started_at = None
    execution.load.measurement_ended_at = None
    execution.e2b_observation = None

    point = finalize_staging_public_capacity_point(execution)

    assert point.status == "saturated"
    assert point.metrics.attempted == 0
    assert point.metrics.admission_runs_per_second is None
    assert point.metrics.terminal_runs_per_second is None
    candidate = detect_suspected_boundaries([_point("basic", 1), point])[0]
    assert candidate.lower_concurrency == 1
    assert candidate.higher_concurrency == 10


def test_basic_warmup_failure_never_measures_with_fewer_than_requested_users() -> None:
    execution = _execution("basic", 10)
    execution.observations = []
    execution.load.warmup_attempted = 1
    execution.load.warmup_completed = 0
    execution.load.warmup_operational_failures = 1
    execution.load.warmup_peak_consecutive_operational_failures = 1
    execution.load.attempted = 0
    execution.load.admitted = 0
    execution.load.terminal = 0
    execution.load.successful = 0
    execution.load.observed_max_active = 0
    execution.load.active_integral_seconds = 0
    execution.load.active_mean = 0
    execution.load.admission_duration_seconds = 0
    execution.load.measurement_duration_seconds = 0
    execution.load.drain_duration_seconds = 0
    execution.load.drained_runs = 0
    execution.load.measurement_started_at = None
    execution.load.measurement_ended_at = None
    execution.e2b_observation = None

    point = finalize_staging_public_capacity_point(execution)

    assert point.status == "saturated"
    assert point.metrics.terminal_runs_per_second is None
    assert point.metrics.admission_runs_per_second is None


def test_basic_warmup_correctness_failure_remains_invalid() -> None:
    execution = _execution("basic", 10)
    execution.warmup_samples = [
        StagingPublicRunSample(
            scenario_id="basic",
            benchmark_run_id="warmup-marker",
            admitted=True,
            terminal_status="failed",
            error_type="validation_error",
            error="marker mismatch",
        )
    ]
    execution.observations = []
    execution.load.warmup_attempted = 1
    execution.load.warmup_completed = 0
    execution.load.warmup_correctness_failures = 1
    execution.load.attempted = 0
    execution.load.admitted = 0
    execution.load.terminal = 0
    execution.load.successful = 0
    execution.load.observed_max_active = 0
    execution.load.active_integral_seconds = 0
    execution.load.active_mean = 0
    execution.load.admission_duration_seconds = 0
    execution.load.measurement_duration_seconds = 0
    execution.load.drain_duration_seconds = 0
    execution.load.drained_runs = 0
    execution.load.measurement_started_at = None
    execution.load.measurement_ended_at = None
    execution.e2b_observation = None

    point = finalize_staging_public_capacity_point(execution)

    assert point.status == "invalid"
    assert detect_suspected_boundaries([point]) == []


def test_runtime_limit_is_e2b_limited_not_agent_saturation() -> None:
    execution = _execution("config", 20)
    execution.e2b_observation = StagingPublicCapacityE2BObservation(
        running_max=20,
        paused_max=20,
        running_limit_consecutive_seconds=3,
        limit_reached=True,
        observation_complete=True,
        sample_count=60,
        successful_sample_count=60,
    )
    point = finalize_staging_public_capacity_point(execution)
    assert point.status == "e2b_limited"
    assert not any("95%" in error for error in point.errors)


def test_runtime_request_inventory_signal_without_observer_confirmation_is_invalid() -> None:
    execution = _execution("shell", 10)
    failed = execution.observations[0].sample
    failed.terminal_status = "failed"
    failed.deterministic_markers_valid = False
    failed.shell_evidence_valid = False
    failed.error_type = "e2b_inventory_limited"
    failed.error = "public SSE error (e2b_inventory_limited)"
    execution.load.successful -= 1

    point = finalize_staging_public_capacity_point(execution)

    assert point.status == "invalid"
    assert any("Sandbox inventory limit" in error for error in point.errors)


@pytest.mark.parametrize("observer_signal", ("running_limit", "vendor_throttle"))
@pytest.mark.parametrize("error_type", ("timeout", "throttle", "http_error", "sse_error"))
def test_runtime_warmup_limit_requires_independent_observer_confirmation(
    observer_signal: str,
    error_type: str,
) -> None:
    execution = _execution("shell", 10)
    execution.warmup_samples = [
        StagingPublicRunSample(
            scenario_id="shell",
            benchmark_run_id="runtime-warmup-limit",
            admitted=True,
            error_type=error_type,
            error=f"runtime warmup {error_type}",
        )
    ]
    execution.observations = []
    execution.load.warmup_attempted = 1
    execution.load.warmup_completed = 0
    execution.load.warmup_operational_failures = 1
    execution.load.warmup_e2b_limit_failures = 0
    execution.load.warmup_peak_consecutive_operational_failures = 1
    execution.load.attempted = 0
    execution.load.admitted = 0
    execution.load.terminal = 0
    execution.load.successful = 0
    execution.load.observed_max_active = 0
    execution.load.active_integral_seconds = 0
    execution.load.active_mean = 0
    execution.load.admission_duration_seconds = 0
    execution.load.measurement_duration_seconds = 0
    execution.load.drain_duration_seconds = 0
    execution.load.drained_runs = 0
    execution.load.measurement_started_at = None
    execution.load.measurement_ended_at = None
    execution.e2b_observation = StagingPublicCapacityE2BObservation(
        running_max=20 if observer_signal == "running_limit" else 19,
        paused_max=10,
        running_limit_consecutive_seconds=3 if observer_signal == "running_limit" else 0,
        limit_reached=observer_signal == "running_limit",
        vendor_throttle_observed=observer_signal == "vendor_throttle",
        observation_complete=observer_signal != "vendor_throttle",
        sample_count=15,
        successful_sample_count=14 if observer_signal == "vendor_throttle" else 15,
        error="incomplete_samples" if observer_signal == "vendor_throttle" else None,
    )

    point = finalize_staging_public_capacity_point(execution)

    assert point.status == "e2b_limited"
    assert point.metrics.terminal_runs_per_second is None


@pytest.mark.parametrize("error_type", ("timeout", "throttle", "http_error", "sse_error"))
def test_runtime_warmup_operational_failure_without_observer_confirmation_is_invalid(
    error_type: str,
) -> None:
    execution = _execution("shell", 10)
    execution.warmup_samples = [
        StagingPublicRunSample(
            scenario_id="shell",
            benchmark_run_id=f"runtime-warmup-{error_type}",
            admitted=True,
            error_type=error_type,
            error=f"runtime warmup {error_type}",
        )
    ]
    execution.observations = []
    execution.load.warmup_attempted = 1
    execution.load.warmup_completed = 0
    execution.load.warmup_operational_failures = 1
    execution.load.warmup_peak_consecutive_operational_failures = 1
    execution.load.attempted = 0
    execution.load.admitted = 0
    execution.load.terminal = 0
    execution.load.successful = 0
    execution.load.observed_max_active = 0
    execution.load.active_integral_seconds = 0
    execution.load.active_mean = 0
    execution.load.admission_duration_seconds = 0
    execution.load.measurement_duration_seconds = 0
    execution.load.drain_duration_seconds = 0
    execution.load.drained_runs = 0
    execution.load.measurement_started_at = None
    execution.load.measurement_ended_at = None
    execution.e2b_observation = StagingPublicCapacityE2BObservation(
        running_max=19,
        paused_max=10,
        observation_complete=True,
        sample_count=15,
        successful_sample_count=15,
    )

    point = finalize_staging_public_capacity_point(execution)

    assert point.status == "invalid"
    assert any("without an E2B limit signal" in error for error in point.errors)


def test_vendor_observer_throttle_is_e2b_limited_despite_the_throttled_sample_gap() -> None:
    execution = _execution("shell", 10)
    execution.e2b_observation = StagingPublicCapacityE2BObservation(
        running_max=19,
        paused_max=10,
        vendor_throttle_observed=True,
        observation_complete=False,
        sample_count=60,
        successful_sample_count=59,
        error="incomplete_samples",
    )
    point = finalize_staging_public_capacity_point(execution)
    assert point.status == "e2b_limited"
    assert any("Vendor" in error for error in point.errors)


def test_basic_e2b_limit_does_not_become_agent_suspected_boundary(tmp_path: Path) -> None:
    execution = _execution("basic", 20)
    execution.e2b_observation = StagingPublicCapacityE2BObservation(
        running_max=20,
        paused_max=20,
        running_limit_consecutive_seconds=3,
        limit_reached=True,
        observation_complete=True,
        sample_count=60,
        successful_sample_count=60,
    )
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=_environment(),
        backend_replicas=1,
        deployment_before=_deployment(1),
        deployment_after=_deployment(1),
        blocks=[_point("basic", 10), finalize_staging_public_capacity_point(execution)],
    )
    assert success
    assessment = result.assessments[0]
    assert assessment.e2b_limited
    assert assessment.suspected_boundary_lower is None
    assert assessment.suspected_boundary_upper is None
    assert detect_suspected_boundaries(result.blocks) == []


def test_setup_allocation_failure_is_inventory_limited_not_agent_boundary() -> None:
    execution = _execution("basic", 20)
    execution.setup.attempted_users = 4
    execution.setup.allocated_users = 3
    execution.setup.successful_users = 2
    execution.setup.complete = False
    execution.setup.e2b_inventory_limited = True
    execution.setup.errors = ["inventory unavailable"]
    execution.observations = []
    execution.cleanup = execution.cleanup[:3]
    execution.load.spawned_users = 0
    execution.load.setup_ready_users = 0
    execution.load.warmup_attempted = 0
    execution.load.warmup_completed = 0
    execution.load.attempted = 0
    execution.load.admitted = 0
    execution.load.terminal = 0
    execution.load.successful = 0
    execution.load.observed_max_active = 0
    execution.physical_cleanup.target_conversations = 3
    execution.physical_cleanup.target_sandboxes = 3
    point = finalize_staging_public_capacity_point(execution)
    assert point.status == "e2b_inventory_limited"
    assert detect_suspected_boundaries([point]) == []


def test_runtime_operational_failure_without_e2b_limit_is_invalid() -> None:
    execution = _execution("shell", 10)
    execution.load.timeout_requests = 1
    execution.load.timed_out = True
    point = finalize_staging_public_capacity_point(execution)
    assert point.status == "invalid"


def test_correctness_cleanup_or_missing_evidence_is_invalid() -> None:
    execution = _execution("config", 10)
    execution.observations[0].sample.config_sha_valid = False
    execution.cleanup[0].complete = False
    execution.physical_cleanup.target_sandboxes = 9
    execution.e2b_observation = None
    point = finalize_staging_public_capacity_point(execution)
    assert point.status == "invalid"
    assert any("cleanup" in error.lower() for error in point.errors)
    assert any("E2B count" in error for error in point.errors)


def test_physical_cleanup_requires_two_zero_checks_ten_seconds_apart() -> None:
    execution = _execution("basic", 10)
    execution.physical_cleanup.consecutive_zero_checks = 1
    execution.physical_cleanup.interval_seconds = 9.99
    assert finalize_staging_public_capacity_point(execution).status == "invalid"


def test_file_point_requires_captured_toolfile_and_storage_zero_evidence() -> None:
    execution = _execution("file", 1)
    assert finalize_staging_public_capacity_point(execution).status == "valid_scaling"

    execution.physical_cleanup.db_tool_files_remaining = 1
    execution.physical_cleanup.complete = False
    point = finalize_staging_public_capacity_point(execution)
    assert point.status == "invalid"
    assert any("ToolFile" in error for error in point.errors)

    execution = _execution("file", 1)
    execution.physical_cleanup.target_tool_files = 0
    assert finalize_staging_public_capacity_point(execution).status == "invalid"


def test_detects_first_dynamic_basic_boundary_only() -> None:
    c20 = _point("basic", 20, count=100, terminal_ms=100)
    c30 = _point("basic", 30, count=105, terminal_ms=130)
    c40 = _point("basic", 40, count=50, terminal_ms=200)
    runtime = _point("shell", 10)
    candidates = detect_suspected_boundaries([c20, c30, c40, runtime])
    assert len(candidates) == 1
    assert (candidates[0].lower_concurrency, candidates[0].higher_concurrency) == (20, 30)
    assert not candidates[0].e2b_limited


def test_scaling_requires_all_three_replica_boundaries_and_uses_twenty_percent_gain(
    tmp_path: Path,
) -> None:
    blocks: list[StagingPublicCapacityPoint] = []
    experiments: tuple[tuple[StagingPublicCapacityReplicaCount, int, int, int], ...] = (
        (1, 20, 30, 100),
        (2, 30, 40, 125),
        (4, 40, 60, 160),
    )
    for replicas, lower_c, higher_c, lower_count in experiments:
        blocks.append(_point("basic", lower_c, replicas=replicas, count=lower_count, terminal_ms=100))
        boundary = _execution("basic", higher_c, replicas=replicas, count=lower_count + 5, terminal_ms=130)
        boundary.load.timeout_requests = 1
        boundary.load.timed_out = True
        blocks.append(finalize_staging_public_capacity_point(boundary))
    result, success = finalize_staging_public_capacity(
        artifact_dir=tmp_path,
        environment=_environment(),
        blocks=blocks,
    )
    assert success
    assert result.schema_version == 7
    assert result.mode == "staging-public-e2e-scaling"
    assert result.confidence == "single_block_shared_traffic"
    assert result.conclusion == "directional_scaling_observed"
    basic = result.scaling_assessments[0]
    assert basic.replica_2_over_1_gain == 1.25
    assert basic.replica_4_over_2_gain == 1.28
    assert all(item.suspected_boundary_upper is not None for item in result.assessments)
    assert [item.validated_through for item in result.assessments] == [20, 30, 40]
    report = (tmp_path / "report.md").read_text()
    assert "suspected boundary" in report
    assert "maximum capacity" in report
    assert "TPS lower bound" in report
    assert "1.25x" in report
    assert "CV" not in report
    assert "confirmed boundary" not in report
    assert "conversation_id" not in (tmp_path / "result.json").read_text().lower()


def test_missing_replica_boundary_is_load_ceiling_insufficient(tmp_path: Path) -> None:
    blocks = [_point("basic", 160, replicas=replicas, count=100 * replicas) for replicas in (1, 2, 4)]
    result, success = finalize_staging_public_capacity(
        artifact_dir=tmp_path,
        environment=_environment(),
        blocks=blocks,
    )
    assert success
    assert result.conclusion == "load_ceiling_insufficient"
    assert result.scaling_assessments[0].conclusion == "load_ceiling_insufficient"


def test_runtime_e2b_limit_does_not_override_basic_directional_result(tmp_path: Path) -> None:
    blocks: list[StagingPublicCapacityPoint] = []
    experiments: tuple[tuple[StagingPublicCapacityReplicaCount, int, int, int], ...] = (
        (1, 20, 30, 100),
        (2, 30, 40, 125),
        (4, 40, 60, 160),
    )
    for replicas, lower_c, higher_c, lower_count in experiments:
        blocks.append(_point("basic", lower_c, replicas=replicas, count=lower_count))
        boundary = _execution("basic", higher_c, replicas=replicas, count=lower_count + 5)
        boundary.load.timed_out = True
        boundary.load.timeout_requests = 1
        blocks.append(finalize_staging_public_capacity_point(boundary))
    runtime = _execution("shell", 10, replicas=2)
    runtime.e2b_observation = StagingPublicCapacityE2BObservation(
        running_max=20,
        paused_max=10,
        running_limit_consecutive_seconds=3,
        limit_reached=True,
        observation_complete=True,
        sample_count=60,
        successful_sample_count=60,
    )
    blocks.append(finalize_staging_public_capacity_point(runtime))
    result, success = finalize_staging_public_capacity(
        artifact_dir=tmp_path,
        environment=_environment(),
        blocks=blocks,
    )
    assert success
    assert result.conclusion == "directional_scaling_observed"
    shell_assessment = next(item for item in result.assessments if item.scenario_id == "shell")
    shell_point = next(item for item in result.points if item.scenario_id == "shell")
    assert shell_point.terminal_runs_per_second is None
    assert shell_point.terminal_p95_ms is None
    assert shell_assessment.e2b_limited
    assert shell_assessment.correctness_status == "passed"
    assert shell_assessment.runtime_limit_signal == "e2b_limited"
    assert shell_assessment.validated_through is None
    assert shell_assessment.suspected_boundary_lower is None
    assert shell_assessment.suspected_boundary_upper is None
    assert shell_assessment.terminal_runs_per_second_lower_bound is None


def test_basic_e2b_limit_prevents_an_agent_scaling_conclusion(tmp_path: Path) -> None:
    execution = _execution("basic", 20, replicas=1)
    execution.e2b_observation = StagingPublicCapacityE2BObservation(
        running_max=20,
        paused_max=20,
        running_limit_consecutive_seconds=3,
        limit_reached=True,
        observation_complete=True,
        sample_count=60,
        successful_sample_count=60,
    )
    result, success = finalize_staging_public_capacity(
        artifact_dir=tmp_path,
        environment=_environment(),
        blocks=[finalize_staging_public_capacity_point(execution)],
    )
    assert success
    assert result.conclusion == "e2b_limited"


def test_skipped_point_is_single_block_and_does_not_fabricate_cleanup() -> None:
    point = build_staging_public_capacity_skipped_point(
        scenario_id="config",
        requested_concurrency=10,
        backend_replicas=4,
        block_index=1,
        reason="prior cleanup gate failed",
    )
    assert point.status == "skipped"
    assert not point.physical_cleanup.checked
    assert point.cleanup == []


def test_stage_matrix_and_finalize_are_replica_relative(tmp_path: Path) -> None:
    assert len(staging_public_capacity_stage_matrix(1)) == 18
    assert len(staging_public_capacity_stage_matrix(2)) == 11
    assert len(staging_public_capacity_stage_matrix(4)) == 11
    blocks = [
        _point(scenario, concurrency, replicas=2) for scenario, concurrency in staging_public_capacity_stage_matrix(2)
    ]
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=_environment(),
        backend_replicas=2,
        deployment_before=_deployment(2),
        deployment_after=_deployment(2),
        blocks=blocks,
    )
    assert success
    assert result.mode == "staging-public-e2e-scaling-stage"
    assert result.backend_replicas == 2
    assert result.matrix_complete
    assert result.status == "passed"
    assert "scaling_assessments" not in result.model_dump()
    assert (tmp_path / "deployment-evidence.json").is_file()
    report = (tmp_path / "report.md").read_text()
    assert "does not compare replicas" in report
    assert "`shell` Runtime check: correctness **`passed`**, limit signal **`none`**" in report
    assert "`config` Runtime check: correctness **`passed`**, limit signal **`none`**" in report
    assert "## Basic capacity observations" in report
    assert "## Block details" in report
    assert "### Basic c1 — `valid`" in report
    assert "#### 10-second measurement buckets" in report
    assert "  - Failure rates" not in report
    assert "| c1 | `valid`" in report
    shell_assessment = next(item for item in result.assessments if item.scenario_id == "shell")
    assert shell_assessment.validated_through is None
    assert shell_assessment.terminal_runs_per_second_lower_bound is None


def test_filtered_stage_is_degraded_not_cross_replica_inconclusive(tmp_path: Path) -> None:
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=_environment(),
        backend_replicas=4,
        deployment_before=_deployment(4),
        deployment_after=_deployment(4),
        blocks=[_point("basic", 1, replicas=4)],
    )
    assert success
    assert not result.matrix_complete
    assert result.status == "degraded"
    assert result.errors == ["replica-stage matrix is incomplete or intentionally filtered"]


def test_stage_report_separates_skipped_basic_points_from_metrics(tmp_path: Path) -> None:
    skipped = build_staging_public_capacity_skipped_point(
        scenario_id="basic",
        requested_concurrency=10,
        backend_replicas=1,
        block_index=1,
        reason="stopped after a prior cleanup failure",
    )
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=_environment(),
        backend_replicas=1,
        deployment_before=_deployment(1),
        deployment_after=_deployment(1),
        blocks=[_point("basic", 1), skipped],
    )
    assert success
    report = (tmp_path / "report.md").read_text()
    assert "| c10 | `skipped`" not in report
    assert "## Not run" in report
    assert "- Basic c10: stopped after a prior cleanup failure." in report
    assert "10s buckets attempted/successful/runs-s/p95-ms" not in report


def test_stage_report_keeps_file_as_runtime_correctness_and_cleanup_evidence(tmp_path: Path) -> None:
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=_environment(),
        backend_replicas=1,
        deployment_before=_deployment(1),
        deployment_after=_deployment(1),
        blocks=[_point("file", 1)],
    )
    assert success
    assert result.assessments[0].terminal_runs_per_second_lower_bound is None
    report = (tmp_path / "report.md").read_text()
    assert "| `file` | c1 | `valid`" in report
    assert "ToolFiles/storage remaining" in report


def test_stage_file_block_requires_file_cleanup_deployment_capability(tmp_path: Path) -> None:
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path / "file",
        environment=_environment(),
        backend_replicas=1,
        deployment_before=_deployment(1, file_cleanup_valid=False),
        deployment_after=_deployment(1, file_cleanup_valid=False),
        blocks=[_point("file", 1)],
    )
    assert not success
    assert result.status == "failed"
    assert any("File cleanup capability" in error for error in result.errors)

    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path / "basic",
        environment=_environment(),
        backend_replicas=1,
        deployment_before=_deployment(1, file_cleanup_valid=False),
        deployment_after=_deployment(1, file_cleanup_valid=False),
        blocks=[_point("basic", 1)],
    )
    assert success
    assert result.status == "degraded"


def test_stage_edge_probes_are_required_even_without_measurement_samples(tmp_path: Path) -> None:
    skipped = build_staging_public_capacity_skipped_point(
        scenario_id="basic",
        requested_concurrency=1,
        backend_replicas=1,
        block_index=1,
        reason="pre-measurement boundary",
    )
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=_environment(),
        backend_replicas=1,
        deployment_before=_deployment(1),
        deployment_after=_deployment(1),
        blocks=[skipped],
    )
    assert success
    assert result.status == "degraded"
    assert not any("x-version" in error for error in result.errors)


@pytest.mark.parametrize(
    "environment",
    (
        _environment().model_copy(update={"edge_version_after": None}),
        _environment().model_copy(update={"edge_version_after": "v2"}),
    ),
)
def test_stage_fails_for_missing_or_mismatched_edge_probe(
    tmp_path: Path,
    environment,
) -> None:
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=environment,
        backend_replicas=1,
        deployment_before=_deployment(1),
        deployment_after=_deployment(1),
        blocks=[_point("basic", 1)],
    )
    assert not success
    assert result.status == "failed"
    assert any("x-version" in error for error in result.errors)


def test_stage_fails_when_measurement_header_does_not_match_edge_probes(tmp_path: Path) -> None:
    point = _point("basic", 1)
    point.observations[0].sample.edge_version = "v2"
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=_environment(),
        backend_replicas=1,
        deployment_before=_deployment(1),
        deployment_after=_deployment(1),
        blocks=[point],
    )
    assert not success
    assert result.status == "failed"
    assert any("did not match the replica-stage probes" in error for error in result.errors)


@pytest.mark.parametrize(
    "missing_field",
    ("config_expected_sha256", "benchmark_scope_fingerprint"),
)
def test_stage_fails_closed_without_required_scaling_environment_identity(
    tmp_path: Path,
    missing_field: str,
) -> None:
    environment = _environment().model_copy(update={missing_field: None})

    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=environment,
        backend_replicas=2,
        deployment_before=_deployment(2),
        deployment_after=_deployment(2),
        blocks=[_point("basic", 1, replicas=2)],
    )

    assert not success
    assert result.status == "failed"
    assert any("evidence was missing" in error for error in result.errors)


def test_stage_rejects_valid_deployment_evidence_for_a_different_replica_count(tmp_path: Path) -> None:
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=_environment(),
        backend_replicas=2,
        deployment_before=_deployment(1),
        deployment_after=_deployment(1),
        blocks=[_point("basic", 1, replicas=2)],
    )
    assert not success
    assert result.status == "failed"
    assert "replica-stage deployment evidence did not match the requested replica count" in result.errors


def test_stage_deployment_comparison_ignores_only_pod_list_order(tmp_path: Path) -> None:
    deployment_before = _deployment(2)
    deployment_after = _deployment(2)
    pods = cast(list[object], deployment_after["pods"])
    deployment_after["pods"] = list(reversed(pods))
    result, success = finalize_staging_public_capacity_stage(
        artifact_dir=tmp_path,
        environment=_environment(),
        backend_replicas=2,
        deployment_before=deployment_before,
        deployment_after=deployment_after,
        blocks=[_point("basic", 1, replicas=2)],
    )
    assert success
    assert result.status == "degraded"
    assert not any("changed during the stage" in error for error in result.errors)


@pytest.mark.parametrize(
    ("stats", "forbidden_values", "expected_code"),
    [
        ({"nested": {"conversation-id": "must-not-survive"}}, (), "private_artifact_field"),
        ({"nested": {"message": "prefix opaque-service-key suffix"}}, ("opaque-service-key",), "secret_value_detected"),
    ],
)
def test_stage_artifact_safety_fails_before_normal_artifacts_are_written(
    tmp_path: Path,
    stats: dict[str, object],
    forbidden_values: tuple[str, ...],
    expected_code: str,
) -> None:
    artifact_dir = tmp_path / "unsafe-stage"
    point = _point("basic", 1, replicas=2)
    point.load.stats = stats

    with pytest.raises(PublicArtifactSafetyError) as raised:
        finalize_staging_public_capacity_stage(
            artifact_dir=artifact_dir,
            environment=_environment(),
            backend_replicas=2,
            deployment_before=_deployment(2),
            deployment_after=_deployment(2),
            blocks=[point],
            forbidden_values=forbidden_values,
        )

    assert raised.value.code == expected_code
    assert not (artifact_dir / "result.json").exists()
    assert not (artifact_dir / "report.md").exists()
    assert not (artifact_dir / "environment.json").exists()
