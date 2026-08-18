"""Aggregate and render Schema v6 directional public Staging scaling runs."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Sequence
import json
import math
from pathlib import Path

from benchmarks.staging_public_artifact_safety import (
    validate_public_artifact_payload,
    validate_public_artifact_text,
)
from benchmarks.staging_public_schemas import StagingPublicEnvironment, StagingPublicRunSample, StagingPublicScenarioId
from benchmarks.staging_public_deployment import StagingBackendDeploymentEvidence
from benchmarks.staging_public_capacity_schemas import (
    STAGING_PUBLIC_CAPACITY_REPLICAS,
    STAGING_PUBLIC_CAPACITY_SCALING_MATRIX,
    STAGING_PUBLIC_CAPACITY_SCENARIOS,
    StagingPublicCapacityBoundaryCandidate,
    StagingPublicCapacityBucket,
    StagingPublicCapacityConcurrency,
    StagingPublicCapacityConclusion,
    StagingPublicCapacityExecution,
    StagingPublicCapacityLoadResult,
    StagingPublicCapacityMetrics,
    StagingPublicCapacityObservation,
    StagingPublicCapacityPercentiles,
    StagingPublicCapacityPhysicalCleanupEvidence,
    StagingPublicCapacityPoint,
    StagingPublicCapacityPointAggregate,
    StagingPublicCapacityReplicaCount,
    StagingPublicCapacityResult,
    StagingPublicCapacityScalingAssessment,
    StagingPublicCapacityScenarioAssessment,
    StagingPublicCapacitySetupResult,
    StagingPublicCapacityStageResult,
)


def finalize_staging_public_capacity_point(
    execution: StagingPublicCapacityExecution,
) -> StagingPublicCapacityPoint:
    """Validate, aggregate, and classify one independent single-block point."""

    errors: list[str] = []
    invalid = False
    saturated = False
    e2b = execution.e2b_observation
    e2b_limited = e2b is not None and (e2b.limit_reached or e2b.vendor_throttle_observed)
    concurrency = execution.requested_concurrency
    load = execution.load
    warmup_failed = load.warmup_attempted != load.warmup_completed
    warmup_outcomes_accounted = (
        load.warmup_completed + load.warmup_operational_failures + load.warmup_correctness_failures
        == load.warmup_attempted
    )
    basic_warmup_operational_boundary = (
        execution.scenario_id == "basic"
        and load.warmup_operational_failures > 0
        and load.warmup_correctness_failures == 0
        and warmup_outcomes_accounted
    )
    warmup_e2b_limited = load.warmup_e2b_limit_failures > 0

    if execution.setup.e2b_inventory_limited:
        return _finalize_e2b_inventory_limited_point(execution)

    invalid |= _validate_setup_and_load_contract(
        execution,
        basic_warmup_operational_boundary=basic_warmup_operational_boundary,
        e2b_limited=e2b_limited,
        errors=errors,
    )

    invalid |= _validate_cleanup_evidence(execution, errors)

    e2b_limited, e2b_invalid, e2b_saturated = _validate_e2b_limit_evidence(
        execution,
        basic_warmup_operational_boundary=basic_warmup_operational_boundary,
        warmup_e2b_limited=warmup_e2b_limited,
        e2b_limited=e2b_limited,
        errors=errors,
    )
    invalid |= e2b_invalid
    saturated |= e2b_saturated

    observation_invalid, observation_saturated = _validate_warmup_and_measurement_observations(
        execution,
        e2b_limited=e2b_limited,
        warmup_failed=warmup_failed,
        warmup_outcomes_accounted=warmup_outcomes_accounted,
        basic_warmup_operational_boundary=basic_warmup_operational_boundary,
        warmup_e2b_limited=warmup_e2b_limited,
        errors=errors,
    )
    invalid |= observation_invalid
    saturated |= observation_saturated

    metrics, metrics_invalid, metrics_saturated = _classify_measurement_metrics(
        execution,
        e2b_limited=e2b_limited,
        errors=errors,
    )
    invalid |= metrics_invalid
    saturated |= metrics_saturated
    if load.correctness_failures:
        invalid = True
        errors.append(f"observed {load.correctness_failures} correctness failure(s)")
    invalid |= _validate_measurement_counters(execution, errors)
    if warmup_failed and execution.scenario_id != "basic" and not e2b_limited:
        invalid = True
        errors.append("Runtime warmup contained an operational failure without an E2B limit signal")

    status = "invalid" if invalid else "e2b_limited" if e2b_limited else "saturated" if saturated else "valid_scaling"
    return StagingPublicCapacityPoint(
        scenario_id=execution.scenario_id,
        requested_concurrency=concurrency,
        backend_replicas=execution.backend_replicas,
        block_index=execution.block_index,
        phase=execution.phase,
        status=status,
        setup=execution.setup.model_copy(deep=True),
        observations=[item.model_copy(deep=True) for item in execution.observations],
        cleanup=[item.model_copy(deep=True) for item in execution.cleanup],
        load=load.model_copy(deep=True),
        metrics=metrics,
        e2b_observation=(execution.e2b_observation.model_copy(deep=True) if execution.e2b_observation else None),
        physical_cleanup=execution.physical_cleanup.model_copy(deep=True),
        errors=list(dict.fromkeys(errors)),
    )


def _validate_setup_and_load_contract(
    execution: StagingPublicCapacityExecution,
    *,
    basic_warmup_operational_boundary: bool,
    e2b_limited: bool,
    errors: list[str],
) -> bool:
    """Validate replica, setup, worker, and measurement-window invariants."""

    invalid = False
    concurrency = execution.requested_concurrency
    load = execution.load
    if execution.backend_replicas is None:
        invalid = True
        errors.append("observed Agent Backend replica count was missing")
    if load.requested_users != concurrency:
        invalid = True
        errors.append("load-engine requested user count did not match the block")
    if execution.setup.attempted_users != concurrency:
        invalid = True
        errors.append(f"setup attempted {execution.setup.attempted_users}/{concurrency} Users")
    if execution.setup.allocated_users != concurrency:
        invalid = True
        errors.append(f"setup allocated resources for {execution.setup.allocated_users}/{concurrency} Users")
    if not execution.setup.complete or execution.setup.successful_users != concurrency:
        invalid = True
        errors.append(f"setup completed for {execution.setup.successful_users}/{concurrency} Users")
    if execution.setup.errors:
        invalid = True
        errors.extend(f"setup: {error}" for error in execution.setup.errors)
    if load.spawned_users != concurrency or load.setup_ready_users != concurrency:
        invalid = True
        errors.append(
            f"load engine spawned/readied {load.spawned_users}/{load.setup_ready_users} of {concurrency} Users"
        )
    if load.fatal_errors:
        invalid = True
        errors.extend(f"worker: {error}" for error in load.fatal_errors)
    if (load.measurement_started_at is None or load.measurement_ended_at is None) and not (
        basic_warmup_operational_boundary or e2b_limited
    ):
        invalid = True
        errors.append("measurement UTC time window was missing")
    return invalid


def _validate_e2b_limit_evidence(
    execution: StagingPublicCapacityExecution,
    *,
    basic_warmup_operational_boundary: bool,
    warmup_e2b_limited: bool,
    e2b_limited: bool,
    errors: list[str],
) -> tuple[bool, bool, bool]:
    """Classify independent E2B evidence without over-attributing request failures."""

    invalid = False
    saturated = False
    e2b = execution.e2b_observation
    request_level_limit = warmup_e2b_limited or any(
        observation.sample.error_type == "e2b_inventory_limited" for observation in execution.observations
    )
    if e2b is None and not basic_warmup_operational_boundary:
        invalid = True
        errors.append("measurement-window E2B count observation was incomplete")
    elif e2b is not None:
        if e2b.limit_reached or e2b.vendor_throttle_observed:
            e2b_limited = True
            if e2b.limit_reached:
                errors.append(
                    f"E2B running limit was reached (max={e2b.running_max}/{e2b.running_limit}, "
                    f"consecutive={e2b.running_limit_consecutive_seconds}s)"
                )
            if e2b.vendor_throttle_observed:
                errors.append("E2B Vendor inventory observation was throttled")
        # A Vendor throttle is itself the required limit signal. It necessarily
        # prevents a complete count sample, but must not be reclassified as an
        # Agent or correctness failure. Independent observer errors remain invalid.
        throttle_only_gap = e2b.vendor_throttle_observed and e2b.api_error_count == 0
        if not e2b.observation_complete and not throttle_only_gap:
            invalid = True
            errors.append("measurement-window E2B count observation was incomplete")
    if request_level_limit:
        errors.append("the public Runtime transaction reported an E2B Sandbox inventory limit")
        # Request-level errors are diagnostic only. Runtime limit attribution
        # requires the independent count observer to show running=20 for three
        # seconds or Vendor throttling; otherwise this point cannot distinguish
        # E2B inventory from another public-path operational failure.
        if not e2b_limited:
            if execution.scenario_id == "basic":
                saturated = True
            else:
                invalid = True
    return e2b_limited, invalid, saturated


def _validate_warmup_and_measurement_observations(
    execution: StagingPublicCapacityExecution,
    *,
    e2b_limited: bool,
    warmup_failed: bool,
    warmup_outcomes_accounted: bool,
    basic_warmup_operational_boundary: bool,
    warmup_e2b_limited: bool,
    errors: list[str],
) -> tuple[bool, bool]:
    """Validate warmup accounting and classify terminal observation failures."""

    invalid = False
    saturated = False
    load = execution.load
    if load.warmup_correctness_failures:
        invalid = True
        errors.append(f"observed {load.warmup_correctness_failures} warmup correctness failure(s)")
    if warmup_failed and not warmup_outcomes_accounted:
        invalid = True
        errors.append("warmup outcomes did not account for every attempted request")
    if basic_warmup_operational_boundary and not warmup_e2b_limited:
        saturated = True
        errors.append("warmup reported an operational failure before a valid measurement window")

    run_ids = [observation.sample.benchmark_run_id for observation in execution.observations]
    if len(run_ids) != len(set(run_ids)):
        invalid = True
        errors.append("measurement benchmark run identities were not unique")
    for observation in execution.observations:
        sample = observation.sample
        if sample.scenario_id != execution.scenario_id:
            invalid = True
            errors.append("measurement contained a sample from another scenario")
        elif not sample.succeeded and _is_capacity_failure(sample):
            if execution.scenario_id == "basic":
                saturated = True
            elif not e2b_limited:
                invalid = True
            errors.append(_sample_failure(sample))
        elif not sample.succeeded:
            invalid = True
            errors.append(_sample_failure(sample))
    return invalid, saturated


def _classify_measurement_metrics(
    execution: StagingPublicCapacityExecution,
    *,
    e2b_limited: bool,
    errors: list[str],
) -> tuple[StagingPublicCapacityMetrics, bool, bool]:
    """Aggregate measurement metrics and apply scenario-specific operational thresholds."""

    metrics = _aggregate_metrics(execution)
    load = execution.load
    required_active = math.ceil(execution.requested_concurrency * 0.9)
    has_operational_failure = load.measurement_started_at is not None and (
        load.timed_out
        or load.throttled_requests > 0
        or load.timeout_requests > 0
        or metrics.success_rate < 0.95
        or load.observed_max_active < required_active
    )
    if not has_operational_failure:
        return metrics, False, False

    invalid = execution.scenario_id != "basic" and not e2b_limited
    saturated = execution.scenario_id == "basic"
    if load.observed_max_active < required_active:
        errors.append(f"observed max active {load.observed_max_active}/{execution.requested_concurrency} was below 90%")
    if metrics.success_rate < 0.95:
        errors.append(f"success rate {metrics.success_rate:.2%} was below 95%")
    if load.timed_out or load.timeout_requests:
        errors.append(f"observed {load.timeout_requests} timeout request(s)")
    if load.throttled_requests:
        errors.append(f"observed {load.throttled_requests} throttled request(s)")
    return metrics, invalid, saturated


def _validate_cleanup_evidence(
    execution: StagingPublicCapacityExecution,
    errors: list[str],
) -> bool:
    """Validate user and physical cleanup evidence for one capacity point."""

    invalid = False
    concurrency = execution.requested_concurrency
    expected_workers = set(range(concurrency))
    observed_workers = {item.worker_index for item in execution.cleanup}
    if len(observed_workers) != len(execution.cleanup) or observed_workers != expected_workers:
        invalid = True
        errors.append("cleanup evidence did not uniquely cover every requested User")
    for item in execution.cleanup:
        if item.recovered_by_parent:
            invalid = True
            errors.append(f"cleanup required parent recovery for worker {item.worker_index}")
        if not item.complete or not item.attempted or item.http_status_code != 204 or not item.conversation_deleted:
            invalid = True
            errors.append(f"cleanup was incomplete for worker {item.worker_index}")

    physical = execution.physical_cleanup
    if physical.target_conversations != concurrency or physical.target_sandboxes != concurrency:
        invalid = True
        errors.append("physical cleanup targets did not cover every benchmark Conversation/Sandbox")
    if not _physical_cleanup_complete(physical):
        invalid = True
        errors.append("physical Workspace/Binding/Sandbox cleanup evidence was incomplete")
    errors.extend(f"physical cleanup: {error}" for error in physical.errors)
    return invalid


def _validate_measurement_counters(
    execution: StagingPublicCapacityExecution,
    errors: list[str],
) -> bool:
    """Ensure load-engine counters exactly match the public observations."""

    load = execution.load
    observations = execution.observations
    invalid = False
    if load.attempted != len(observations):
        invalid = True
        errors.append(f"measurement observation count {len(observations)} did not match attempted {load.attempted}")
    if load.admitted != sum(item.sample.admitted for item in observations):
        invalid = True
        errors.append("admitted counter did not match measurement observations")
    if load.terminal != sum(observation.sample.terminal_e2e_ms is not None for observation in observations):
        invalid = True
        errors.append("terminal counter did not match measurement observations")
    if load.successful != sum(item.sample.succeeded for item in observations):
        invalid = True
        errors.append("successful counter did not match measurement observations")
    return invalid


def _finalize_e2b_inventory_limited_point(
    execution: StagingPublicCapacityExecution,
) -> StagingPublicCapacityPoint:
    """Preserve a fail-closed setup allocation limit without calling it an Agent boundary."""

    errors = ["E2B Sandbox inventory prevented setup from completing"]
    errors.extend(f"setup: {error}" for error in execution.setup.errors)
    invalid = execution.backend_replicas is None
    if invalid:
        errors.append("observed Agent Backend replica count was missing")
    if execution.load.requested_users != execution.requested_concurrency:
        invalid = True
        errors.append("load-engine requested user count did not match the block")
    if execution.observations or any(
        (
            execution.load.attempted,
            execution.load.admitted,
            execution.load.terminal,
            execution.load.successful,
            execution.load.correctness_failures,
        )
    ):
        invalid = True
        errors.append("measurement began after E2B inventory allocation failed")
    if execution.load.fatal_errors:
        invalid = True
        errors.extend(f"worker: {error}" for error in execution.load.fatal_errors)

    allocated = execution.setup.allocated_users
    observed_cleanup = {item.worker_index for item in execution.cleanup}
    if (
        len(observed_cleanup) != len(execution.cleanup)
        or len(observed_cleanup) != allocated
        or any(worker_index >= execution.requested_concurrency for worker_index in observed_cleanup)
    ):
        invalid = True
        errors.append("cleanup evidence did not uniquely cover every allocated User")
    if any(
        not item.complete
        or not item.attempted
        or item.http_status_code != 204
        or not item.conversation_deleted
        or item.recovered_by_parent
        for item in execution.cleanup
    ):
        invalid = True
        errors.append("cleanup was incomplete for one or more allocated Users")

    physical = execution.physical_cleanup
    if physical.target_conversations != allocated or physical.target_sandboxes != allocated:
        invalid = True
        errors.append("physical cleanup targets did not cover every allocated Conversation/Sandbox")
    if not _physical_cleanup_complete(physical):
        invalid = True
        errors.append("physical Workspace/Binding/Sandbox cleanup evidence was incomplete")
    errors.extend(f"physical cleanup: {error}" for error in physical.errors)
    return StagingPublicCapacityPoint(
        scenario_id=execution.scenario_id,
        requested_concurrency=execution.requested_concurrency,
        backend_replicas=execution.backend_replicas,
        status="invalid" if invalid else "e2b_inventory_limited",
        setup=execution.setup.model_copy(deep=True),
        observations=[],
        cleanup=[item.model_copy(deep=True) for item in execution.cleanup],
        load=execution.load.model_copy(deep=True),
        metrics=StagingPublicCapacityMetrics(),
        e2b_observation=None,
        physical_cleanup=physical.model_copy(deep=True),
        errors=list(dict.fromkeys(errors)),
    )


def build_staging_public_capacity_skipped_point(
    *,
    scenario_id: StagingPublicScenarioId,
    requested_concurrency: StagingPublicCapacityConcurrency,
    block_index: int,
    reason: str,
    backend_replicas: StagingPublicCapacityReplicaCount = 1,
) -> StagingPublicCapacityPoint:
    """Represent a gated point without fabricating measurements."""

    return StagingPublicCapacityPoint(
        scenario_id=scenario_id,
        requested_concurrency=requested_concurrency,
        backend_replicas=backend_replicas,
        block_index=block_index,
        status="skipped",
        setup=StagingPublicCapacitySetupResult(),
        observations=[],
        cleanup=[],
        load=StagingPublicCapacityLoadResult(requested_users=requested_concurrency),
        metrics=StagingPublicCapacityMetrics(),
        physical_cleanup=StagingPublicCapacityPhysicalCleanupEvidence(),
        errors=[reason],
    )


def detect_suspected_boundaries(
    blocks: Sequence[StagingPublicCapacityPoint],
) -> list[StagingPublicCapacityBoundaryCandidate]:
    """Return only the first single-block signal for each replica/scenario."""

    candidates: list[StagingPublicCapacityBoundaryCandidate] = []
    groups: set[tuple[StagingPublicCapacityReplicaCount, StagingPublicScenarioId]] = {
        (block.backend_replicas, block.scenario_id)
        for block in blocks
        if block.backend_replicas is not None and block.scenario_id == "basic"
    }
    for backend_replicas, scenario_id in sorted(groups, key=lambda item: (item[0], item[1])):
        assert backend_replicas is not None
        ordered = sorted(
            (
                block
                for block in blocks
                if block.backend_replicas == backend_replicas
                and block.scenario_id == scenario_id
                and block.status in {"valid_scaling", "saturated"}
            ),
            key=lambda block: block.requested_concurrency,
        )
        previous: StagingPublicCapacityPoint | None = None
        for current in ordered:
            reasons: list[str] = []
            if current.status == "saturated":
                reasons.append(f"c{current.requested_concurrency} reported saturation evidence")
            if previous is not None and _relational_regression(previous, current):
                reasons.append("terminal throughput grew <=10% while terminal p95 grew >=20%")
            if reasons:
                candidates.append(
                    StagingPublicCapacityBoundaryCandidate(
                        scenario_id=scenario_id,
                        backend_replicas=backend_replicas,
                        lower_concurrency=previous.requested_concurrency if previous else None,
                        higher_concurrency=current.requested_concurrency,
                        reasons=reasons,
                    )
                )
                break
            previous = current
    return candidates


def finalize_staging_public_capacity(
    *,
    artifact_dir: Path,
    environment: StagingPublicEnvironment,
    blocks: Sequence[StagingPublicCapacityPoint],
) -> tuple[StagingPublicCapacityResult, bool]:
    """Aggregate single blocks, assess directional scaling, and write artifacts."""

    aggregates = _aggregate_points(blocks)
    assessments = _assess_scenarios(blocks, aggregates)
    scaling_assessments = [_assess_scaling("basic", aggregates, assessments)]
    observed = {
        (block.backend_replicas, block.scenario_id, block.requested_concurrency)
        for block in blocks
        if block.backend_replicas is not None
    }
    matrix_complete = observed == set(STAGING_PUBLIC_CAPACITY_SCALING_MATRIX) and len(blocks) == len(
        STAGING_PUBLIC_CAPACITY_SCALING_MATRIX
    )
    errors: list[str] = []
    if not matrix_complete:
        errors.append("directional scaling matrix is incomplete or intentionally filtered")
    invalid = any(block.status == "invalid" for block in blocks) or any(
        point.status == "invalid" for point in aggregates
    )
    edge_errors = _validate_public_edge_stage_evidence(environment, blocks)
    if edge_errors:
        invalid = True
        errors.extend(edge_errors)

    conclusion = _overall_conclusion(
        scaling_assessments,
        invalid,
        # Runtime E2B limits are reported on Shell/Config assessments but do
        # not replace the Basic-only Agent replica scaling conclusion.
        e2b_limited=any(item.scenario_id == "basic" and item.e2b_limited for item in assessments),
        e2b_inventory_limited=any(item.e2b_inventory_limited for item in assessments),
    )
    degraded = (
        not matrix_complete
        or any(
            block.status
            in {
                "saturated",
                "e2b_limited",
                "e2b_inventory_limited",
                "skipped",
            }
            for block in blocks
        )
        or conclusion != "directional_scaling_observed"
    )
    status = "failed" if invalid else "degraded" if degraded else "passed"
    result = StagingPublicCapacityResult(
        matrix_complete=matrix_complete,
        status=status,
        conclusion=conclusion,
        environment=environment,
        blocks=[block.model_copy(deep=True) for block in blocks],
        points=aggregates,
        assessments=assessments,
        scaling_assessments=scaling_assessments,
        errors=errors,
    )
    _write_artifacts(artifact_dir, result)
    return result, not invalid


def staging_public_capacity_stage_matrix(
    backend_replicas: StagingPublicCapacityReplicaCount,
) -> tuple[tuple[StagingPublicScenarioId, int], ...]:
    """Return the asymmetric public matrix expected for one replica stage."""

    return tuple(
        (scenario_id, concurrency)
        for replicas, scenario_id, concurrency in STAGING_PUBLIC_CAPACITY_SCALING_MATRIX
        if replicas == backend_replicas
    )


def finalize_staging_public_capacity_stage(
    *,
    artifact_dir: Path,
    environment: StagingPublicEnvironment,
    backend_replicas: StagingPublicCapacityReplicaCount,
    deployment_before: dict[str, object],
    deployment_after: dict[str, object],
    blocks: Sequence[StagingPublicCapacityPoint],
    forbidden_values: Sequence[str] = (),
) -> tuple[StagingPublicCapacityStageResult, bool]:
    """Finalize one independently run stage without inferring cross-replica scaling."""

    errors: list[str] = []
    deployment_invalid = False
    environment_invalid = False
    if environment.config_expected_sha256 is None:
        environment_invalid = True
        errors.append("replica-stage Config fixture SHA256 evidence was missing")
    if environment.e2b_observer_mode != "local":
        environment_invalid = True
        errors.append("replica-stage local E2B observer evidence was missing")
    if environment.benchmark_scope_fingerprint is None:
        environment_invalid = True
        errors.append("replica-stage benchmark scope evidence was missing")
    try:
        before_evidence = StagingBackendDeploymentEvidence.model_validate(deployment_before)
        after_evidence = StagingBackendDeploymentEvidence.model_validate(deployment_after)
    except ValueError:
        deployment_invalid = True
        errors.append("replica-stage deployment evidence was malformed")
    else:
        if not before_evidence.valid or before_evidence.errors:
            deployment_invalid = True
            errors.append("replica-stage deployment preflight did not pass")
        if not after_evidence.valid or after_evidence.errors:
            deployment_invalid = True
            errors.append("replica-stage deployment postflight did not pass")
        if (
            before_evidence.expected_replicas != backend_replicas
            or after_evidence.expected_replicas != backend_replicas
        ):
            deployment_invalid = True
            errors.append("replica-stage deployment evidence did not match the requested replica count")
        if _stable_stage_deployment_payload(before_evidence) != _stable_stage_deployment_payload(after_evidence):
            deployment_invalid = True
            errors.append("Agent Deployment, Pod, image, worker, or topology evidence changed during the stage")
    replica_mismatch = any(block.backend_replicas != backend_replicas for block in blocks)
    if replica_mismatch:
        errors.append("one or more blocks did not match the stage replica count")
    aggregates = _aggregate_points(blocks)
    assessments = _assess_scenarios(blocks, aggregates)
    observed = {(block.scenario_id, block.requested_concurrency) for block in blocks}
    expected = set(staging_public_capacity_stage_matrix(backend_replicas))
    matrix_complete = observed == expected and len(blocks) == len(expected)
    if not matrix_complete:
        errors.append("replica-stage matrix is incomplete or intentionally filtered")
    invalid = (
        environment_invalid
        or deployment_invalid
        or replica_mismatch
        or any(block.status == "invalid" for block in blocks)
        or any(point.status == "invalid" for point in aggregates)
    )
    edge_errors = _validate_public_edge_stage_evidence(environment, blocks)
    if edge_errors:
        invalid = True
        errors.extend(edge_errors)
    degraded = not matrix_complete or any(
        block.status
        in {
            "saturated",
            "e2b_limited",
            "e2b_inventory_limited",
            "skipped",
        }
        for block in blocks
    )
    status = "failed" if invalid else "degraded" if degraded else "passed"
    result = StagingPublicCapacityStageResult(
        backend_replicas=backend_replicas,
        matrix_complete=matrix_complete,
        status=status,
        environment=environment,
        deployment_before=dict(deployment_before),
        deployment_after=dict(deployment_after),
        blocks=[block.model_copy(deep=True) for block in blocks],
        points=aggregates,
        assessments=assessments,
        errors=list(dict.fromkeys(errors)),
    )
    _write_stage_artifacts(
        artifact_dir,
        result,
        forbidden_values=forbidden_values,
    )
    return result, not invalid


def _validate_public_edge_stage_evidence(
    environment: StagingPublicEnvironment,
    blocks: Sequence[StagingPublicCapacityPoint],
) -> list[str]:
    """Require before/after probes and align every measured response header."""

    errors: list[str] = []
    before = environment.edge_version_before
    after = environment.edge_version_after
    if before is None or after is None:
        errors.append("public edge x-version before/after probe evidence was missing")
    elif before != after:
        errors.append("public edge x-version changed between replica-stage probes")
    expected = before if before is not None and before == after else None
    measurement_samples = [observation.sample for block in blocks for observation in block.observations]
    if any(sample.edge_version is None for sample in measurement_samples):
        errors.append("public edge x-version evidence was missing from a measurement transaction")
    sample_versions = {sample.edge_version for sample in measurement_samples if sample.edge_version is not None}
    if len(sample_versions) > 1:
        errors.append("public edge x-version changed during the replica stage")
    if expected is not None and sample_versions and sample_versions != {expected}:
        errors.append("public edge x-version did not match the replica-stage probes")
    if environment.edge_version is not None and before is not None and environment.edge_version != before:
        errors.append("public edge x-version did not match the captured environment fingerprint")
    return list(dict.fromkeys(errors))


def render_staging_public_capacity_stage_markdown(result: StagingPublicCapacityStageResult) -> str:
    """Render one replica stage without claiming cross-replica scaling."""

    measured = sum(point.status != "skipped" for point in result.points)
    expected = len(staging_public_capacity_stage_matrix(result.backend_replicas))
    lines = [
        f"# Dify Agent Staging public E2E scaling stage: {result.backend_replicas} replica(s)",
        "",
        "> Shared Staging public-edge single-block observations. This stage report does not compare replicas or establish a verified limit, maximum capacity, or production SLO.",
        "",
        "## Stage summary",
        "",
        f"- Status: **`{result.status}`**.",
        f"- Execution coverage: **{measured}/{expected} measured**.",
        "- Evidence confidence: **low (single block, shared Staging traffic)**.",
        f"- Public edge x-version before/after: **`{result.environment.edge_version_before or 'N/A'}`** / "
        f"**`{result.environment.edge_version_after or 'N/A'}`**.",
    ]
    for assessment in result.assessments:
        if assessment.scenario_id == "basic":
            lines.append(
                f"- `basic`: validated through **{_concurrency(assessment.validated_through)}**, "
                f"suspected boundary **{_boundary(assessment.suspected_boundary_lower, assessment.suspected_boundary_upper)}**, "
                f"TPS lower bound **{_number(assessment.terminal_runs_per_second_lower_bound, 2)}**, "
                f"E2B inventory limited **{str(assessment.e2b_inventory_limited).lower()}**."
            )
        else:
            lines.append(
                f"- `{assessment.scenario_id}` Runtime check: correctness "
                f"**`{assessment.correctness_status}`**, limit signal "
                f"**`{assessment.runtime_limit_signal}`**."
            )
    basic_points = [item for item in result.points if item.scenario_id == "basic"]
    measured_basic_blocks = [
        (point, _stage_block_for_point(result.blocks, point)) for point in basic_points if point.status != "skipped"
    ]
    skipped_basic_points = [item for item in basic_points if item.status == "skipped"]
    lines.extend(_render_basic_capacity_table(measured_basic_blocks))
    lines.extend(["", "## Block details", ""])
    for point, block in measured_basic_blocks:
        lines.extend(_render_basic_block_details(point, block))
    lines.extend(_render_skipped_basic_points(skipped_basic_points, result.blocks))
    lines.extend(
        [
            "",
            "## Interpretation boundary",
            "",
            "- This file describes one replica stage only; cross-replica conclusions belong to the aggregate report.",
            "- Runtime points are correctness and E2B-limit evidence, not Agent capacity boundaries.",
            "- A Basic suspected boundary is a single-block directional signal, not a confirmed maximum.",
        ]
    )
    return "\n".join(lines) + "\n"


def _stage_block_for_point(
    blocks: Sequence[StagingPublicCapacityPoint],
    point: StagingPublicCapacityPointAggregate,
) -> StagingPublicCapacityPoint:
    return next(
        item
        for item in blocks
        if item.scenario_id == point.scenario_id and item.requested_concurrency == point.requested_concurrency
    )


def _render_basic_capacity_table(
    basic_blocks: Sequence[tuple[StagingPublicCapacityPointAggregate, StagingPublicCapacityPoint]],
) -> list[str]:
    lines = [
        "",
        "## Basic capacity observations",
        "",
        "| Concurrency | Result | Success | Offered runs/s | Completed runs/s | Active avg/peak | Terminal p95 | E2B running/paused max |",
        "|---:|---|---:|---:|---:|---:|---:|---:|",
    ]
    if not basic_blocks:
        lines.append("| N/A | `not_run` | N/A | N/A | N/A | N/A | N/A | N/A |")
        return lines
    for point, block in basic_blocks:
        attempted = block.metrics.attempted
        successful = block.metrics.successful
        success = f"{successful / attempted:.2%} ({successful}/{attempted})" if attempted else "N/A"
        e2b = block.e2b_observation
        e2b_counts = f"{e2b.running_max}/{e2b.paused_max}" if e2b else "N/A"
        lines.append(
            f"| c{point.requested_concurrency} | `{_display_result(point.status)}` | "
            f"{success} | {_number(block.metrics.admission_runs_per_second, 2)} | "
            f"{_number(block.metrics.terminal_runs_per_second, 2)} | "
            f"{block.metrics.active_mean:.2f}/{block.metrics.active_max} | "
            f"{_number(block.metrics.terminal_e2e.p95_ms, 2)} ms | {e2b_counts} |"
        )
    return lines


def _render_basic_block_details(
    point: StagingPublicCapacityPointAggregate,
    block: StagingPublicCapacityPoint,
) -> list[str]:
    physical = block.physical_cleanup
    lines = [
        f"### Basic c{point.requested_concurrency} — `{_display_result(point.status)}`",
        "",
        f"- Counts attempted/admitted/terminal/successful: **{block.metrics.attempted}/"
        f"{block.metrics.admitted}/{block.metrics.terminal}/{block.metrics.successful}**.",
        f"- Failure rates: timeout={block.metrics.timeout_rate:.2%}, "
        f"throttle={block.metrics.throttle_rate:.2%}, HTTP={block.metrics.http_failure_rate:.2%}, "
        f"SSE={block.metrics.sse_failure_rate:.2%}; drain={block.metrics.drain_duration_seconds:.2f}s.",
        "- Terminal p50/p95/p99: "
        f"{_percentile_triple(block.metrics.terminal_e2e)} ms; early/late p95: "
        f"{_number(block.metrics.early_terminal_p95_ms, 2)}/"
        f"{_number(block.metrics.late_terminal_p95_ms, 2)} ms.",
        "- Headers / first SSE / first answer p50/p95/p99: "
        f"{_percentile_triple(block.metrics.response_headers)}; "
        f"{_percentile_triple(block.metrics.first_sse)}; "
        f"{_percentile_triple(block.metrics.first_answer)} ms.",
        "- Physical cleanup remaining Workspaces/Bindings/Vendor Sandboxes: "
        f"{physical.db_workspaces_remaining}/{physical.db_bindings_remaining}/"
        f"{physical.vendor_sandboxes_remaining}; zero checks={physical.consecutive_zero_checks}, "
        f"interval={physical.interval_seconds:.2f}s.",
        "",
        "#### 10-second measurement buckets",
        "",
        "| Window | Attempted | Successful | Offered runs/s | Terminal p95 |",
        "|---|---:|---:|---:|---:|",
    ]
    lines.extend(
        f"| {bucket.start_seconds}-{bucket.end_seconds}s | {bucket.attempted} | "
        f"{bucket.successful} | {bucket.runs_per_second:.2f} | "
        f"{_number(bucket.terminal_p95_ms, 2)} ms |"
        for bucket in block.metrics.buckets
    )
    if block.errors:
        lines.extend(["", "#### Diagnostics", ""])
        lines.extend(f"- {error}" for error in block.errors)
    lines.append("")
    return lines


def _render_skipped_basic_points(
    skipped_points: Sequence[StagingPublicCapacityPointAggregate],
    blocks: Sequence[StagingPublicCapacityPoint],
) -> list[str]:
    if not skipped_points:
        return []
    lines = ["## Not run", ""]
    for point in skipped_points:
        block = _stage_block_for_point(blocks, point)
        reason = "; ".join(block.errors) if block.errors else "no reason recorded"
        lines.append(f"- Basic c{point.requested_concurrency}: {reason}.")
    return lines


def render_staging_public_capacity_markdown(result: StagingPublicCapacityResult) -> str:
    measured = sum(point.status != "skipped" for point in result.points)
    skipped = sum(point.status == "skipped" for point in result.points)
    lines = [
        "# Dify Agent Staging public E2E directional scaling",
        "",
        "> Shared Staging public-edge single-block observations. This report does not establish a verified limit, maximum capacity, linear scaling, or a production SLO.",
        "",
        "## Conclusion",
        "",
        f"- Overall result: **`{result.conclusion}`**.",
        f"- Execution coverage: **{measured}/{len(STAGING_PUBLIC_CAPACITY_SCALING_MATRIX)} measured**, {skipped} skipped.",
        "- Evidence confidence: **low (single block, shared Staging traffic)**.",
        f"- Public edge x-version before/after: **`{result.environment.edge_version_before or 'N/A'}`** / "
        f"**`{result.environment.edge_version_after or 'N/A'}`**.",
    ]
    for item in result.assessments:
        if item.scenario_id == "basic":
            lines.append(
                f"- `basic`, {item.backend_replicas} replica(s): validated through "
                f"**{_concurrency(item.validated_through)}**, suspected boundary "
                f"**{_boundary(item.suspected_boundary_lower, item.suspected_boundary_upper)}**, "
                f"TPS lower bound **{_number(item.terminal_runs_per_second_lower_bound, 2)}**, "
                f"E2B inventory limited **{str(item.e2b_inventory_limited).lower()}**."
            )
        else:
            lines.append(
                f"- `{item.scenario_id}`, {item.backend_replicas} replica(s) Runtime check: "
                f"correctness **`{item.correctness_status}`**, limit signal "
                f"**`{item.runtime_limit_signal}`**."
            )
    lines.extend(
        [
            "",
            "## Capacity points",
            "",
            "| Replicas | Scenario | Concurrency | Result | Success | Completed runs/s | Throughput change | Terminal p95 | p95 change | Signal | E2B running |",
            "|---:|---|---:|---|---:|---:|---:|---:|---:|---|---:|",
        ]
    )
    previous: dict[tuple[int, StagingPublicScenarioId], StagingPublicCapacityPointAggregate] = {}
    for point in (item for item in result.points if item.scenario_id == "basic"):
        key = (point.backend_replicas or 0, point.scenario_id)
        block = next(
            (
                item
                for item in result.blocks
                if item.backend_replicas == point.backend_replicas
                and item.scenario_id == point.scenario_id
                and item.requested_concurrency == point.requested_concurrency
            ),
            None,
        )
        attempted = block.metrics.attempted if block else 0
        successful = block.metrics.successful if block else 0
        prior = previous.get(key)
        throughput_change = _relative_change(
            point.terminal_runs_per_second,
            prior.terminal_runs_per_second if prior else None,
        )
        p95_change = _relative_change(point.terminal_p95_ms, prior.terminal_p95_ms if prior else None)
        success = f"{successful / attempted:.2%} ({successful}/{attempted})" if attempted else "N/A"
        e2b_running = (
            str(block.e2b_observation.running_max) if block is not None and block.e2b_observation is not None else "N/A"
        )
        lines.append(
            f"| {point.backend_replicas or 'N/A'} | `{point.scenario_id}` | c{point.requested_concurrency} | "
            f"`{_display_result(point.status)}` | {success} | {_number(point.terminal_runs_per_second, 2)} | "
            f"{_signed_percent(throughput_change)} | {_milliseconds(point.terminal_p95_ms)} | "
            f"{_signed_percent(p95_change)} | `{_display_capacity_signal(point)}` | {e2b_running} |"
        )
        if point.status == "valid_scaling":
            previous[key] = point

    lines.extend(
        [
            "",
            "## Replica scaling",
            "",
            "| Scenario | T(1) | T(2) | T(4) | 1→2 gain | 2→4 gain | Directional conclusion |",
            "|---|---:|---:|---:|---:|---:|---|",
        ]
    )
    for item in result.scaling_assessments:
        lines.append(
            f"| `{item.scenario_id}` | {_number(item.replica_1_terminal_runs_per_second, 2)} | "
            f"{_number(item.replica_2_terminal_runs_per_second, 2)} | "
            f"{_number(item.replica_4_terminal_runs_per_second, 2)} | "
            f"{_multiple(item.replica_2_over_1_gain)} | {_multiple(item.replica_4_over_2_gain)} | "
            f"`{item.conclusion}` |"
        )

    lines.extend(
        [
            "",
            "## Transaction diagnostics",
            "",
            "> Shell and Config timings below are correctness diagnostics only; they are not capacity bounds or scaling inputs.",
            "",
        ]
    )
    for block in result.blocks:
        lines.append(
            f"### {block.backend_replicas or 'unknown'} replica(s) / {block.scenario_id} / c{block.requested_concurrency}"
        )
        lines.append("")
        lines.append(
            f"- Active avg/peak: {block.metrics.active_mean:.2f}/{block.metrics.active_max}; "
            f"offered/completed runs/s: {_number(block.metrics.admission_runs_per_second, 2)}/"
            f"{_number(block.metrics.terminal_runs_per_second, 2)}."
        )
        lines.append(
            f"- Counts attempted/admitted/terminal/success: {block.metrics.attempted}/"
            f"{block.metrics.admitted}/{block.metrics.terminal}/{block.metrics.successful}; failure rates "
            f"timeout={block.metrics.timeout_rate:.2%}, throttle={block.metrics.throttle_rate:.2%}, "
            f"HTTP={block.metrics.http_failure_rate:.2%}, SSE={block.metrics.sse_failure_rate:.2%}."
        )
        lines.append(
            "- Terminal p50/p95/p99 ms: "
            f"{_number(block.metrics.terminal_e2e.p50_ms, 2)}/"
            f"{_number(block.metrics.terminal_e2e.p95_ms, 2)}/"
            f"{_number(block.metrics.terminal_e2e.p99_ms, 2)}."
        )
        lines.append(
            "- Early/late terminal p95 and drift: "
            f"{_number(block.metrics.early_terminal_p95_ms, 2)}/"
            f"{_number(block.metrics.late_terminal_p95_ms, 2)} ms "
            f"({_percent(block.metrics.terminal_p95_change_ratio)})."
        )
        physical = block.physical_cleanup
        lines.append(
            "- Physical cleanup remaining Workspaces/Bindings/Vendor Sandboxes: "
            f"{physical.db_workspaces_remaining}/{physical.db_bindings_remaining}/"
            f"{physical.vendor_sandboxes_remaining}; zero checks={physical.consecutive_zero_checks}, "
            f"interval={physical.interval_seconds:.2f}s."
        )
        if block.e2b_observation is not None:
            e2b = block.e2b_observation
            lines.append(
                f"- E2B running/paused max: {e2b.running_max}/{e2b.paused_max}; "
                f"limit={e2b.running_limit}, consecutive at limit={e2b.running_limit_consecutive_seconds}s."
            )
        lines.extend(f"- Diagnostic: {error}" for error in block.errors)
        lines.append("")
    lines.extend(
        [
            "## Interpretation boundary",
            "",
            "- Traffic isolation: `false`; resource attribution: `none`.",
            "- Agent, Redis, and E2B bottlenecks cannot be attributed independently without the count-level E2B signal.",
            "- A suspected boundary is a single-block directional signal, not a confirmed maximum.",
        ]
    )
    return "\n".join(lines) + "\n"


def _aggregate_metrics(execution: StagingPublicCapacityExecution) -> StagingPublicCapacityMetrics:
    load = execution.load
    successful = [item for item in execution.observations if item.sample.succeeded]
    samples = [item.sample for item in successful]
    measurement_seconds = load.measurement_duration_seconds
    complete_seconds = measurement_seconds + load.drain_duration_seconds
    early = [
        item.sample.terminal_e2e_ms
        for item in successful
        if item.admitted_offset_seconds < 20 and item.sample.terminal_e2e_ms is not None
    ]
    late_start = max(measurement_seconds - 20, 0)
    late = [
        item.sample.terminal_e2e_ms
        for item in successful
        if item.admitted_offset_seconds >= late_start and item.sample.terminal_e2e_ms is not None
    ]
    early_p95 = _percentile(early, 0.95)
    late_p95 = _percentile(late, 0.95)
    return StagingPublicCapacityMetrics(
        attempted=load.attempted,
        admitted=load.admitted,
        terminal=load.terminal,
        successful=len(successful),
        success_rate=len(successful) / load.attempted if load.attempted else 0,
        timeout_rate=load.timeout_requests / load.attempted if load.attempted else 0,
        throttle_rate=load.throttled_requests / load.attempted if load.attempted else 0,
        http_failure_rate=load.http_failure_requests / load.attempted if load.attempted else 0,
        sse_failure_rate=load.sse_failure_requests / load.attempted if load.attempted else 0,
        admission_runs_per_second=(load.attempted / measurement_seconds if measurement_seconds else None),
        terminal_runs_per_second=(len(successful) / complete_seconds if complete_seconds else None),
        active_mean=load.active_mean,
        active_max=load.observed_max_active,
        drain_duration_seconds=load.drain_duration_seconds,
        drained_runs=load.drained_runs,
        response_headers=_sample_percentiles(samples, lambda sample: sample.response_headers_ms),
        first_sse=_sample_percentiles(samples, lambda sample: sample.time_to_first_sse_ms),
        first_answer=_sample_percentiles(samples, lambda sample: sample.time_to_first_answer_ms),
        terminal_e2e=_sample_percentiles(samples, lambda sample: sample.terminal_e2e_ms),
        buckets=_buckets(execution.observations, measurement_seconds),
        early_terminal_p95_ms=early_p95,
        late_terminal_p95_ms=late_p95,
        terminal_p95_change_ratio=(late_p95 / early_p95 - 1 if early_p95 and late_p95 is not None else None),
    )


def _buckets(
    observations: Sequence[StagingPublicCapacityObservation], measurement_seconds: float
) -> list[StagingPublicCapacityBucket]:
    buckets: list[StagingPublicCapacityBucket] = []
    for start in range(0, int(measurement_seconds), 10):
        end = min(start + 10, int(measurement_seconds))
        selected = [item for item in observations if start <= item.admitted_offset_seconds < end]
        successful = [item for item in selected if item.sample.succeeded]
        latencies = [item.sample.terminal_e2e_ms for item in successful if item.sample.terminal_e2e_ms is not None]
        duration = end - start
        buckets.append(
            StagingPublicCapacityBucket(
                start_seconds=start,
                end_seconds=end,
                attempted=len(selected),
                successful=len(successful),
                runs_per_second=len(successful) / duration if duration else 0,
                terminal_p95_ms=_percentile(latencies, 0.95),
            )
        )
    return buckets


def _aggregate_points(blocks: Sequence[StagingPublicCapacityPoint]) -> list[StagingPublicCapacityPointAggregate]:
    grouped: dict[tuple[int | None, StagingPublicScenarioId, int], list[StagingPublicCapacityPoint]] = defaultdict(list)
    for block in blocks:
        grouped[(block.backend_replicas, block.scenario_id, block.requested_concurrency)].append(block)
    results: list[StagingPublicCapacityPointAggregate] = []
    scenario_order = {scenario: index for index, scenario in enumerate(STAGING_PUBLIC_CAPACITY_SCENARIOS)}
    for key in sorted(grouped, key=lambda item: (item[0] or 0, scenario_order[item[1]], item[2])):
        group = grouped[key]
        block = group[0]
        errors = [error for item in group for error in item.errors]
        status = block.status
        if len(group) != 1:
            status = "invalid"
            errors.append("single-block scaling point was repeated")
        capacity_scenario = block.scenario_id == "basic" and status != "skipped"
        results.append(
            StagingPublicCapacityPointAggregate(
                scenario_id=block.scenario_id,
                requested_concurrency=block.requested_concurrency,
                backend_replicas=block.backend_replicas,
                block_count=len(group),
                status=status,
                terminal_runs_per_second=(block.metrics.terminal_runs_per_second if capacity_scenario else None),
                terminal_p95_ms=(block.metrics.terminal_e2e.p95_ms if capacity_scenario else None),
                errors=list(dict.fromkeys(errors)),
            )
        )
    return results


def _assess_scenarios(
    blocks: Sequence[StagingPublicCapacityPoint],
    aggregates: Sequence[StagingPublicCapacityPointAggregate],
) -> list[StagingPublicCapacityScenarioAssessment]:
    candidates = {(item.backend_replicas, item.scenario_id): item for item in detect_suspected_boundaries(blocks)}
    assessments: list[StagingPublicCapacityScenarioAssessment] = []
    present: list[tuple[StagingPublicCapacityReplicaCount, StagingPublicScenarioId]] = sorted(
        {(item.backend_replicas, item.scenario_id) for item in aggregates if item.backend_replicas is not None},
        key=lambda item: (item[0], item[1]),
    )
    for replicas, scenario_id in present:
        assert replicas is not None
        points = sorted(
            (item for item in aggregates if item.backend_replicas == replicas and item.scenario_id == scenario_id),
            key=lambda item: item.requested_concurrency,
        )
        runtime_scenario = scenario_id in {"shell", "config"}
        candidate = None if runtime_scenario else candidates.get((replicas, scenario_id))
        valid_before_boundary = [
            item
            for item in points
            if item.status == "valid_scaling"
            and (candidate is None or item.requested_concurrency < candidate.higher_concurrency)
        ]
        capacity_point = (
            None
            if runtime_scenario
            else max(valid_before_boundary, key=lambda item: item.requested_concurrency, default=None)
        )
        errors: list[str] = []
        correctness_invalid = any(item.status == "invalid" for item in points)
        e2b_limited = any(item.status == "e2b_limited" for item in points)
        if correctness_invalid:
            errors.append("one or more capacity points were invalid")
        assessments.append(
            StagingPublicCapacityScenarioAssessment(
                scenario_id=scenario_id,
                backend_replicas=replicas,
                correctness_status="invalid" if correctness_invalid else "passed",
                runtime_limit_signal=("e2b_limited" if runtime_scenario and e2b_limited else "none"),
                suspected_boundary_lower=(
                    candidate.lower_concurrency if candidate and not candidate.e2b_limited else None
                ),
                suspected_boundary_upper=(
                    candidate.higher_concurrency if candidate and not candidate.e2b_limited else None
                ),
                validated_through=capacity_point.requested_concurrency if capacity_point else None,
                terminal_runs_per_second_lower_bound=(
                    capacity_point.terminal_runs_per_second if capacity_point else None
                ),
                e2b_limited=e2b_limited,
                e2b_inventory_limited=any(item.status == "e2b_inventory_limited" for item in points),
                errors=errors,
            )
        )
    return assessments


def _assess_scaling(
    scenario_id: StagingPublicScenarioId,
    aggregates: Sequence[StagingPublicCapacityPointAggregate],
    assessments: Sequence[StagingPublicCapacityScenarioAssessment],
) -> StagingPublicCapacityScalingAssessment:
    by_replicas = {item.backend_replicas: item for item in assessments if item.scenario_id == scenario_id}
    errors: list[str] = []
    conclusion: StagingPublicCapacityConclusion
    if any(item.errors for item in by_replicas.values()):
        conclusion = "invalid"
    elif any(item.e2b_inventory_limited for item in by_replicas.values()):
        conclusion = "e2b_inventory_limited"
    elif any(item.e2b_limited for item in by_replicas.values()):
        conclusion = "e2b_limited"
    else:
        conclusion = "no_clear_scaling_gain"

    capacities: dict[int, float | None] = {}
    for replicas in STAGING_PUBLIC_CAPACITY_REPLICAS:
        assessment = by_replicas.get(replicas)
        capacity_point = (
            next(
                (
                    item
                    for item in aggregates
                    if item.scenario_id == scenario_id
                    and item.backend_replicas == replicas
                    and item.requested_concurrency == assessment.validated_through
                    and item.status == "valid_scaling"
                ),
                None,
            )
            if assessment and assessment.validated_through is not None
            else None
        )
        capacities[replicas] = capacity_point.terminal_runs_per_second if capacity_point else None

    gain_2_over_1 = _ratio(capacities[2], capacities[1])
    gain_4_over_2 = _ratio(capacities[4], capacities[2])
    if conclusion not in {"invalid", "e2b_limited", "e2b_inventory_limited"}:
        all_stages_present = all(replicas in by_replicas for replicas in STAGING_PUBLIC_CAPACITY_REPLICAS)
        all_boundaries_observed = all(
            by_replicas[replicas].suspected_boundary_upper is not None
            for replicas in STAGING_PUBLIC_CAPACITY_REPLICAS
            if replicas in by_replicas
        )
        if not all_stages_present or not all_boundaries_observed:
            conclusion = "load_ceiling_insufficient"
        elif gain_2_over_1 is not None and gain_4_over_2 is not None:
            passed = sum(gain >= 1.20 for gain in (gain_2_over_1, gain_4_over_2))
            conclusion = (
                "directional_scaling_observed"
                if passed == 2
                else "partial_scaling_observed"
                if passed == 1
                else "no_clear_scaling_gain"
            )
        else:
            conclusion = "load_ceiling_insufficient"
            errors.append("not all 1/2/4 replica lower-bound throughput values were available")

    return StagingPublicCapacityScalingAssessment(
        scenario_id=scenario_id,
        replica_1_terminal_runs_per_second=capacities[1],
        replica_2_terminal_runs_per_second=capacities[2],
        replica_4_terminal_runs_per_second=capacities[4],
        replica_2_over_1_gain=gain_2_over_1,
        replica_4_over_2_gain=gain_4_over_2,
        conclusion=conclusion,
        errors=errors,
    )


def _overall_conclusion(
    assessments: Sequence[StagingPublicCapacityScalingAssessment],
    invalid: bool,
    *,
    e2b_limited: bool,
    e2b_inventory_limited: bool,
) -> StagingPublicCapacityConclusion:
    if invalid or any(item.conclusion == "invalid" for item in assessments):
        return "invalid"
    if e2b_inventory_limited:
        return "e2b_inventory_limited"
    if e2b_limited:
        return "e2b_limited"
    conclusions = {item.conclusion for item in assessments}
    if "e2b_limited" in conclusions:
        return "e2b_limited"
    if "load_ceiling_insufficient" in conclusions:
        return "load_ceiling_insufficient"
    if conclusions == {"directional_scaling_observed"}:
        return "directional_scaling_observed"
    if "directional_scaling_observed" in conclusions or "partial_scaling_observed" in conclusions:
        return "partial_scaling_observed"
    return "no_clear_scaling_gain"


def _physical_cleanup_complete(value: StagingPublicCapacityPhysicalCleanupEvidence) -> bool:
    return (
        value.checked
        and value.complete
        and value.db_workspaces_remaining == 0
        and value.db_bindings_remaining == 0
        and value.vendor_sandboxes_remaining == 0
        and value.consecutive_zero_checks >= 2
        and value.interval_seconds >= 10
        and not value.errors
    )


def _stable_stage_deployment_payload(
    evidence: StagingBackendDeploymentEvidence,
) -> dict[str, object]:
    """Ignore collection time and Kubernetes list order while preserving all evidence."""

    payload: dict[str, object] = evidence.model_dump(
        mode="json",
        exclude={"captured_at", "pods"},
    )
    payload["pods"] = sorted(pod.model_dump_json() for pod in evidence.pods)
    return payload


def _relational_regression(lower: StagingPublicCapacityPoint, higher: StagingPublicCapacityPoint) -> bool:
    lower_tps = lower.metrics.terminal_runs_per_second
    higher_tps = higher.metrics.terminal_runs_per_second
    lower_p95 = lower.metrics.terminal_e2e.p95_ms
    higher_p95 = higher.metrics.terminal_e2e.p95_ms
    return (
        lower_tps is not None
        and lower_tps > 0
        and higher_tps is not None
        and higher_tps / lower_tps - 1 <= 0.10
        and lower_p95 is not None
        and lower_p95 > 0
        and higher_p95 is not None
        and higher_p95 / lower_p95 - 1 >= 0.20
    )


def _sample_percentiles(
    samples: Sequence[StagingPublicRunSample], getter: Callable[[StagingPublicRunSample], float | None]
) -> StagingPublicCapacityPercentiles:
    values = [value for sample in samples if (value := getter(sample)) is not None]
    return StagingPublicCapacityPercentiles(
        p50_ms=_percentile(values, 0.50),
        p95_ms=_percentile(values, 0.95),
        p99_ms=_percentile(values, 0.99),
    )


def _percentile(values: Sequence[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * probability
    lower, upper = math.floor(position), math.ceil(position)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _is_capacity_failure(sample: StagingPublicRunSample) -> bool:
    evidence = f"{sample.error_type or ''} {sample.error or ''}".lower()
    return any(
        token in evidence for token in ("timeout", "timed out", "throttle", "429", "quota", "e2b_inventory_limited")
    )


def _sample_failure(sample: StagingPublicRunSample) -> str:
    return (
        f"{sample.scenario_id} public transaction failed: {sample.error_type or sample.error or sample.terminal_status}"
    )


def _write_artifacts(artifact_dir: Path, result: StagingPublicCapacityResult) -> None:
    result_payload = result.model_dump(mode="json")
    report = render_staging_public_capacity_markdown(result)
    validate_public_artifact_payload(result_payload)
    validate_public_artifact_text(report)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "logs").mkdir(exist_ok=True)
    _ = (artifact_dir / "result.json").write_text(result.model_dump_json(indent=2), encoding="utf-8")
    _ = (artifact_dir / "report.md").write_text(report, encoding="utf-8")
    _ = (artifact_dir / "environment.json").write_text(result.environment.model_dump_json(indent=2), encoding="utf-8")
    _ = (artifact_dir / "scaling-comparison.json").write_text(
        json.dumps([item.model_dump(mode="json") for item in result.scaling_assessments], indent=2, sort_keys=True),
        encoding="utf-8",
    )
    _ = (artifact_dir / "cleanup.json").write_text(
        json.dumps(
            {
                f"r{b.backend_replicas}-{b.scenario_id}-c{b.requested_concurrency}": {
                    "conversations": [x.model_dump(mode="json") for x in b.cleanup],
                    "physical": b.physical_cleanup.model_dump(mode="json"),
                }
                for b in result.blocks
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    _ = (artifact_dir / "locust-stats.json").write_text(
        json.dumps(
            {f"r{b.backend_replicas}-{b.scenario_id}-c{b.requested_concurrency}": b.load.stats for b in result.blocks},
            indent=2,
            sort_keys=True,
            default=str,
        ),
        encoding="utf-8",
    )
    with (artifact_dir / "samples.jsonl").open("w", encoding="utf-8") as output:
        for block in result.blocks:
            for observation in block.observations:
                _ = output.write(observation.model_dump_json() + "\n")
    _ = (artifact_dir / "logs" / "capacity-summary.log").write_text(
        f"status={result.status}\nconclusion={result.conclusion}\nblocks={len(result.blocks)}\n"
        f"matrix_complete={result.matrix_complete}\n",
        encoding="utf-8",
    )


def _write_stage_artifacts(
    artifact_dir: Path,
    result: StagingPublicCapacityStageResult,
    *,
    forbidden_values: Sequence[str] = (),
) -> None:
    result_payload = result.model_dump(mode="json")
    report = render_staging_public_capacity_stage_markdown(result)
    validate_public_artifact_payload(result_payload, forbidden_values=forbidden_values)
    validate_public_artifact_text(report, forbidden_values=forbidden_values)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    (artifact_dir / "logs").mkdir(exist_ok=True)
    _ = (artifact_dir / "result.json").write_text(result.model_dump_json(indent=2), encoding="utf-8")
    _ = (artifact_dir / "report.md").write_text(report, encoding="utf-8")
    _ = (artifact_dir / "environment.json").write_text(
        result.environment.model_dump_json(indent=2),
        encoding="utf-8",
    )
    _ = (artifact_dir / "deployment-evidence.json").write_text(
        json.dumps(
            {"before": result.deployment_before, "after": result.deployment_after},
            indent=2,
            sort_keys=True,
            default=str,
        ),
        encoding="utf-8",
    )
    _ = (artifact_dir / "cleanup.json").write_text(
        json.dumps(
            {
                f"{b.scenario_id}-c{b.requested_concurrency}": {
                    "conversations": [item.model_dump(mode="json") for item in b.cleanup],
                    "physical": b.physical_cleanup.model_dump(mode="json"),
                }
                for b in result.blocks
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    _ = (artifact_dir / "locust-stats.json").write_text(
        json.dumps(
            {f"{b.scenario_id}-c{b.requested_concurrency}": b.load.stats for b in result.blocks},
            indent=2,
            sort_keys=True,
            default=str,
        ),
        encoding="utf-8",
    )
    with (artifact_dir / "samples.jsonl").open("w", encoding="utf-8") as output:
        for block in result.blocks:
            for observation in block.observations:
                _ = output.write(observation.model_dump_json() + "\n")
    _ = (artifact_dir / "logs" / "capacity-stage-summary.log").write_text(
        f"status={result.status}\nbackend_replicas={result.backend_replicas}\n"
        f"blocks={len(result.blocks)}\nmatrix_complete={result.matrix_complete}\n",
        encoding="utf-8",
    )


def _number(value: float | None, digits: int) -> str:
    return "N/A" if value is None else f"{value:.{digits}f}"


def _milliseconds(value: float | None) -> str:
    return "N/A" if value is None else f"{value / 1000:.2f}s"


def _percent(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.2%}"


def _signed_percent(value: float | None) -> str:
    return "N/A" if value is None else f"{value:+.2%}"


def _relative_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return current / previous - 1


def _ratio(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous <= 0:
        return None
    return current / previous


def _multiple(value: float | None) -> str:
    return "N/A" if value is None else f"{value:.2f}x"


def _display_result(status: str) -> str:
    return {
        "valid_scaling": "valid",
        "saturated": "suspected_saturation",
        "e2b_limited": "e2b_limited",
        "e2b_inventory_limited": "e2b_inventory_limited",
        "invalid": "invalid",
        "skipped": "skipped",
    }.get(status, status)


def _display_capacity_signal(point: StagingPublicCapacityPointAggregate) -> str:
    if point.status == "valid_scaling":
        return "observed_scaling"
    if point.status == "saturated":
        return "suspected_boundary"
    if point.status == "e2b_limited":
        return "e2b_limited"
    if point.status == "e2b_inventory_limited":
        return "e2b_inventory_limited"
    return "unknown"


def _concurrency(value: int | None) -> str:
    return "N/A" if value is None else f"c{value}"


def _boundary(lower: int | None, upper: int | None) -> str:
    if upper is None:
        return "not observed"
    if lower is None:
        return f"at or below c{upper}"
    return f"c{lower}–c{upper}"


def _percentile_triple(value: StagingPublicCapacityPercentiles) -> str:
    return f"{_number(value.p50_ms, 2)}/{_number(value.p95_ms, 2)}/{_number(value.p99_ms, 2)}"


__all__ = [
    "build_staging_public_capacity_skipped_point",
    "detect_suspected_boundaries",
    "finalize_staging_public_capacity",
    "finalize_staging_public_capacity_stage",
    "finalize_staging_public_capacity_point",
    "render_staging_public_capacity_markdown",
    "render_staging_public_capacity_stage_markdown",
    "staging_public_capacity_stage_matrix",
]
