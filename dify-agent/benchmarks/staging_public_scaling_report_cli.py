"""Aggregate three validated public Staging replica-stage results.

The command is deliberately offline.  It never contacts Kubernetes, Argo,
E2B, or the public Service API; it accepts only the immutable artifacts
produced by the separately confirmed 1-, 2-, and 4-replica experiments.
"""

from __future__ import annotations

import argparse
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import cast, NoReturn

from pydantic import ValidationError

from benchmarks.staging_public_capacity_results import (
    build_staging_public_capacity_skipped_point,
    detect_suspected_boundaries,
    finalize_staging_public_capacity,
    finalize_staging_public_capacity_point,
    staging_public_capacity_stage_matrix,
)
from benchmarks.staging_public_capacity_schemas import (
    StagingPublicCapacityPoint,
    StagingPublicCapacityReplicaCount,
    StagingPublicCapacityStageResult,
    staging_public_capacity_stage_execution_order,
)
from benchmarks.staging_public_deployment import StagingBackendDeploymentEvidence
from benchmarks.staging_public_artifact_safety import (
    PublicArtifactSafetyError,
    validate_public_artifact_payload,
)
from benchmarks.staging_public_schemas import StagingPublicEnvironment, StagingPublicScenarioId


_ENVIRONMENT_FINGERPRINT_FIELDS: tuple[str, ...] = (
    "service_api_base_url",
    "target_commit",
    "target_commit_evidence",
    "harness_commit",
    "harness_dirty",
    "scenario_manifest_sha256",
    "deterministic_plugin_version",
    "deterministic_plugin_package_sha256",
    "deterministic_plugin_package_evidence",
    "config_expected_sha256",
    "e2b_observer_mode",
    "benchmark_scope_fingerprint",
    "python_version",
    "locust_version",
    "edge_version",
    "edge_version_before",
    "edge_version_after",
)


class _AggregationFailure(RuntimeError):
    """A controlled failure whose text is safe to persist in public diagnostics."""

    def __init__(self, *, code: str, source: str, message: str) -> None:
        super().__init__(message)
        self.code: str = code
        self.source: str = source
        self.safe_message: str = message


@dataclass(frozen=True, slots=True)
class _Arguments:
    replica_1_result: Path
    replica_2_result: Path
    replica_4_result: Path
    output_dir: Path


def main(argv: Sequence[str] | None = None) -> int:
    """Validate and combine three stage artifacts without external access."""

    args = _parse_args(argv)
    output_dir: Path = args.output_dir
    try:
        output_dir.mkdir(parents=True, exist_ok=False)
    except OSError:
        print("staging public scaling aggregation failed: output directory could not be created", file=sys.stderr)
        return 2

    try:
        stages = (
            _load_stage(args.replica_1_result, source="replica_1", expected_replicas=1),
            _load_stage(args.replica_2_result, source="replica_2", expected_replicas=2),
            _load_stage(args.replica_4_result, source="replica_4", expected_replicas=4),
        )
        _validate_cross_stage_environment(stages)
        _validate_cross_stage_deployment(stages)
        blocks = _merge_blocks(stages)
        _validate_public_block_payloads(blocks)
        _result, success = finalize_staging_public_capacity(
            artifact_dir=output_dir,
            environment=stages[0].environment.model_copy(deep=True),
            blocks=blocks,
        )
        print(output_dir)
        return 0 if success else 1
    except _AggregationFailure as exc:
        _write_diagnostics(output_dir, exc)
        print(f"staging public scaling aggregation failed: {exc.safe_message}", file=sys.stderr)
        print(f"staging public scaling diagnostics: {output_dir}", file=sys.stderr)
        return 2
    except Exception:
        failure = _AggregationFailure(
            code="aggregation_failed",
            source="aggregate",
            message="aggregation failed before a validated public result could be produced",
        )
        _write_diagnostics(output_dir, failure)
        print(f"staging public scaling aggregation failed: {failure.safe_message}", file=sys.stderr)
        print(f"staging public scaling diagnostics: {output_dir}", file=sys.stderr)
        return 2


def _parse_args(argv: Sequence[str] | None) -> _Arguments:
    parser = argparse.ArgumentParser(description=__doc__)
    _ = parser.add_argument("--replica-1-result", type=Path, required=True)
    _ = parser.add_argument("--replica-2-result", type=Path, required=True)
    _ = parser.add_argument("--replica-4-result", type=Path, required=True)
    _ = parser.add_argument("--output-dir", type=Path)
    namespace = parser.parse_args(argv)
    output_dir = cast(Path | None, namespace.output_dir)
    if output_dir is None:
        run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
        output_dir = Path(__file__).with_name("results") / f"{run_id}-staging-public-scaling"
    return _Arguments(
        replica_1_result=cast(Path, namespace.replica_1_result),
        replica_2_result=cast(Path, namespace.replica_2_result),
        replica_4_result=cast(Path, namespace.replica_4_result),
        output_dir=output_dir,
    )


def _load_stage(
    path: Path,
    *,
    source: str,
    expected_replicas: StagingPublicCapacityReplicaCount,
) -> StagingPublicCapacityStageResult:
    try:
        stage = StagingPublicCapacityStageResult.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValidationError, ValueError):
        _fail(
            code="invalid_stage_result",
            source=source,
            message=f"{source} was not a valid Schema v7 scaling-stage result",
        )
    if stage.backend_replicas != expected_replicas:
        _fail(
            code="replica_mismatch",
            source=source,
            message=f"{source} did not describe the expected replica count",
        )
    try:
        validate_public_artifact_payload(stage.model_dump(mode="json"))
    except PublicArtifactSafetyError as exc:
        _fail(code=exc.code, source=source, message=exc.safe_message)
    if stage.status == "failed":
        _fail(
            code="failed_stage",
            source=source,
            message=f"{source} was already classified as failed",
        )
    if (
        stage.environment.config_expected_sha256 is None
        or stage.environment.e2b_observer_mode != "local"
        or stage.environment.benchmark_scope_fingerprint is None
        or stage.environment.edge_version_before is None
        or stage.environment.edge_version_after is None
    ):
        _fail(
            code="missing_environment_evidence",
            source=source,
            message=f"{source} did not record every required scaling environment identity",
        )
    expected_matrix = set(staging_public_capacity_stage_matrix(expected_replicas))
    observed_matrix = {(block.scenario_id, block.requested_concurrency) for block in stage.blocks}
    if not stage.matrix_complete or observed_matrix != expected_matrix or len(stage.blocks) != len(expected_matrix):
        _fail(
            code="incomplete_stage",
            source=source,
            message=f"{source} did not contain the complete replica-stage matrix",
        )
    _validate_canonical_stage_blocks(stage, source=source)
    _validate_stage_deployment(stage, source=source, expected_replicas=expected_replicas)
    _validate_stage_public_edge(stage, source=source)
    return stage


def _validate_canonical_stage_blocks(
    stage: StagingPublicCapacityStageResult,
    *,
    source: str,
) -> None:
    """Recompute measured points and require only scheduler-legal skips."""

    by_key = {(block.scenario_id, block.requested_concurrency): block for block in stage.blocks}
    measured: list[StagingPublicCapacityPoint] = []
    stop_all = False
    basic_boundary = False
    for scenario_id, concurrency in _stage_schedule(stage.backend_replicas):
        block = by_key[(scenario_id, concurrency)]
        should_skip = stop_all or (scenario_id == "basic" and basic_boundary)
        if should_skip:
            if block.status != "skipped":
                _fail(
                    code="noncanonical_stage",
                    source=source,
                    message=f"{source} continued load after a single-block scheduler gate",
                )
            _validate_canonical_skipped_block(block, source=source)
            continue
        if block.status == "skipped":
            _fail(
                code="noncanonical_stage",
                source=source,
                message=f"{source} skipped a point before any valid scheduler gate",
            )
        execution = _execution_from_point(block)
        recomputed = finalize_staging_public_capacity_point(execution)
        if recomputed.model_dump(mode="json") != block.model_dump(mode="json"):
            _fail(
                code="noncanonical_stage",
                source=source,
                message=f"{source} contained noncanonical derived point evidence",
            )
        measured.append(recomputed)
        if recomputed.status in {"invalid", "e2b_inventory_limited"}:
            stop_all = True
        elif scenario_id == "basic" and (recomputed.status == "e2b_limited" or detect_suspected_boundaries(measured)):
            basic_boundary = True


def _validate_canonical_skipped_block(
    block: StagingPublicCapacityPoint,
    *,
    source: str,
) -> None:
    """Reject measurements or private lifecycle evidence hidden in a skipped point."""

    if len(block.errors) != 1 or not block.errors[0].strip():
        _fail(
            code="noncanonical_stage",
            source=source,
            message=f"{source} contained malformed skipped-point evidence",
        )
    if block.backend_replicas is None:
        _fail(
            code="noncanonical_stage",
            source=source,
            message=f"{source} contained skipped-point evidence without a replica identity",
        )
    canonical = build_staging_public_capacity_skipped_point(
        scenario_id=block.scenario_id,
        requested_concurrency=block.requested_concurrency,
        backend_replicas=block.backend_replicas,
        block_index=block.block_index,
        reason=block.errors[0],
    )
    if canonical.model_dump(mode="json") != block.model_dump(mode="json"):
        _fail(
            code="noncanonical_stage",
            source=source,
            message=f"{source} contained noncanonical skipped-point evidence",
        )


def _stage_schedule(
    backend_replicas: StagingPublicCapacityReplicaCount,
) -> tuple[tuple[StagingPublicScenarioId, int], ...]:
    return staging_public_capacity_stage_execution_order(backend_replicas)


def _execution_from_point(block: StagingPublicCapacityPoint):
    from benchmarks.staging_public_capacity_schemas import StagingPublicCapacityExecution

    return StagingPublicCapacityExecution(
        scenario_id=block.scenario_id,
        requested_concurrency=block.requested_concurrency,
        backend_replicas=block.backend_replicas,
        block_index=block.block_index,
        phase=block.phase,
        setup=block.setup.model_copy(deep=True),
        warmup_samples=[],
        observations=[item.model_copy(deep=True) for item in block.observations],
        cleanup=[item.model_copy(deep=True) for item in block.cleanup],
        load=block.load.model_copy(deep=True),
        e2b_observation=(block.e2b_observation.model_copy(deep=True) if block.e2b_observation else None),
        physical_cleanup=block.physical_cleanup.model_copy(deep=True),
    )


def _validate_stage_deployment(
    stage: StagingPublicCapacityStageResult,
    *,
    source: str,
    expected_replicas: StagingPublicCapacityReplicaCount,
) -> None:
    before = _deployment_model(stage.deployment_before, source=source, phase="before")
    after = _deployment_model(stage.deployment_after, source=source, phase="after")
    for phase, evidence in (("before", before), ("after", after)):
        if evidence.expected_replicas != expected_replicas or not evidence.valid or evidence.errors:
            _fail(
                code="invalid_deployment_evidence",
                source=source,
                message=f"{source} deployment {phase} evidence did not pass the replica-stage gate",
            )
        if any(block.scenario_id == "file" for block in stage.blocks) and not (
            evidence.collector_preflight.file_cleanup_valid
        ):
            _fail(
                code="invalid_deployment_evidence",
                source=source,
                message=f"{source} deployment {phase} File cleanup capability did not pass",
            )
    if _stable_deployment_fingerprint(before) != _stable_deployment_fingerprint(after):
        _fail(
            code="deployment_drift",
            source=source,
            message=f"{source} deployment changed during the replica stage",
        )


def _deployment_model(
    payload: Mapping[str, object],
    *,
    source: str,
    phase: str,
) -> StagingBackendDeploymentEvidence:
    try:
        return StagingBackendDeploymentEvidence.model_validate(payload)
    except (ValidationError, ValueError):
        _fail(
            code="invalid_deployment_evidence",
            source=source,
            message=f"{source} deployment {phase} evidence was malformed",
        )


def _stable_deployment_fingerprint(evidence: StagingBackendDeploymentEvidence) -> tuple[object, ...]:
    pods = tuple(
        sorted(
            (
                (
                    pod.uid,
                    pod.name,
                    pod.node_name,
                    pod.zone,
                    pod.ready,
                    pod.restart_count,
                    pod.image,
                    pod.image_id,
                    pod.cpu_request_millicores,
                    pod.cpu_limit_millicores,
                    pod.memory_request_mib,
                    pod.memory_limit_mib,
                    pod.declared_workers,
                    pod.observed_workers,
                )
                for pod in evidence.pods
            )
        )
    )
    return (
        evidence.kube_context,
        evidence.namespace,
        evidence.deployment_name,
        evidence.service_name,
        evidence.expected_replicas,
        evidence.desired_replicas,
        evidence.updated_replicas,
        evidence.ready_replicas,
        evidence.available_replicas,
        evidence.generation,
        evidence.observed_generation,
        evidence.ready_endpoints,
        evidence.argo_child_auto_sync_disabled,
        evidence.argo_parent_auto_sync_enabled,
        evidence.argo_parent_self_heal_enabled,
        evidence.effective_agent_config_fingerprint,
        evidence.collector_preflight.model_dump_json(),
        pods,
        evidence.valid,
        tuple(evidence.errors),
    )


def _validate_cross_stage_environment(stages: Sequence[StagingPublicCapacityStageResult]) -> None:
    baseline = _environment_fingerprint(stages[0].environment)
    for stage in stages[1:]:
        if _environment_fingerprint(stage.environment) != baseline:
            _fail(
                code="environment_mismatch",
                source=f"replica_{stage.backend_replicas}",
                message=(
                    "target, harness, plugin, Config fixture, or scenario fingerprint differed across replica stages"
                ),
            )


def _validate_stage_public_edge(
    stage: StagingPublicCapacityStageResult,
    *,
    source: str,
) -> None:
    before = stage.environment.edge_version_before
    after = stage.environment.edge_version_after
    sample_versions = {observation.sample.edge_version for block in stage.blocks for observation in block.observations}
    if (
        before is None
        or after is None
        or before != after
        or None in sample_versions
        or (sample_versions and sample_versions != {before})
        or (stage.environment.edge_version is not None and stage.environment.edge_version != before)
    ):
        _fail(
            code="edge_version_drift",
            source=source,
            message=f"{source} public edge x-version evidence was missing or changed during the Stage",
        )


def _environment_fingerprint(environment: StagingPublicEnvironment) -> tuple[object, ...]:
    return tuple(getattr(environment, field) for field in _ENVIRONMENT_FINGERPRINT_FIELDS)


def _validate_cross_stage_deployment(stages: Sequence[StagingPublicCapacityStageResult]) -> None:
    baseline = _deployment_contract_fingerprint(
        StagingBackendDeploymentEvidence.model_validate(stages[0].deployment_before)
    )
    for stage in stages[1:]:
        current = _deployment_contract_fingerprint(
            StagingBackendDeploymentEvidence.model_validate(stage.deployment_before)
        )
        if current != baseline:
            _fail(
                code="deployment_contract_mismatch",
                source=f"replica_{stage.backend_replicas}",
                message=(
                    "Agent image, resources, workers, effective configuration, or deployment target "
                    "differed across replica stages"
                ),
            )


def _deployment_contract_fingerprint(evidence: StagingBackendDeploymentEvidence) -> tuple[object, ...]:
    pod_contracts = {
        (
            pod.image,
            pod.image_id,
            pod.cpu_request_millicores,
            pod.cpu_limit_millicores,
            pod.memory_request_mib,
            pod.memory_limit_mib,
            pod.declared_workers,
            pod.observed_workers,
        )
        for pod in evidence.pods
    }
    return (
        evidence.kube_context,
        evidence.namespace,
        evidence.deployment_name,
        evidence.service_name,
        evidence.argo_child_auto_sync_disabled,
        evidence.argo_parent_auto_sync_enabled,
        evidence.argo_parent_self_heal_enabled,
        evidence.effective_agent_config_fingerprint,
        evidence.collector_preflight.deployment_name,
        evidence.collector_preflight.expected_replicas,
        evidence.collector_preflight.pod_image,
        evidence.collector_preflight.pod_image_id,
        evidence.collector_preflight.retention_queue_configured,
        evidence.collector_preflight.agent_backend_base_url_configured,
        evidence.collector_preflight.agent_backend_health_reachable,
        evidence.collector_preflight.agent_backend_openapi_reachable,
        evidence.collector_preflight.valid,
        frozenset(pod_contracts),
    )


def _merge_blocks(stages: Sequence[StagingPublicCapacityStageResult]) -> list[StagingPublicCapacityPoint]:
    blocks: list[StagingPublicCapacityPoint] = []
    seen: set[tuple[int, str, int]] = set()
    for stage in stages:
        for block in stage.blocks:
            if block.backend_replicas != stage.backend_replicas:
                _fail(
                    code="block_replica_mismatch",
                    source=f"replica_{stage.backend_replicas}",
                    message="a stage block did not match its declared replica count",
                )
            key = (stage.backend_replicas, block.scenario_id, block.requested_concurrency)
            if key in seen:
                _fail(
                    code="duplicate_block",
                    source=f"replica_{stage.backend_replicas}",
                    message="a replica/scenario/concurrency block appeared more than once",
                )
            seen.add(key)
            blocks.append(block.model_copy(deep=True))
    return blocks


def _validate_public_block_payloads(blocks: Sequence[StagingPublicCapacityPoint]) -> None:
    """Reject dynamic diagnostic fields that could bypass the public schemas."""

    for block in blocks:
        source = f"replica_{block.backend_replicas or 'unknown'}"
        try:
            validate_public_artifact_payload(block.load.stats)
        except PublicArtifactSafetyError as exc:
            _fail(code=exc.code, source=source, message=exc.safe_message)


def _write_diagnostics(output_dir: Path, failure: _AggregationFailure) -> None:
    payload = {
        "schema_version": 1,
        "status": "failed",
        "error": {
            "code": failure.code,
            "source": failure.source,
            "message": failure.safe_message,
        },
    }
    try:
        _ = (output_dir / "aggregation-diagnostics.json").write_text(
            json.dumps(payload, indent=2, sort_keys=True),
            encoding="utf-8",
        )
    except OSError:
        pass


def _fail(*, code: str, source: str, message: str) -> NoReturn:
    raise _AggregationFailure(code=code, source=source, message=message)


if __name__ == "__main__":
    raise SystemExit(main())
