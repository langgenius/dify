from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path

from pydantic import BaseModel
import pytest

from benchmarks.staging_public_capacity_results import (
    build_staging_public_capacity_skipped_point,
    finalize_staging_public_capacity_point,
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
    StagingPublicCapacityResult,
    StagingPublicCapacitySetupResult,
    StagingPublicCapacityStageResult,
    StagingPublicCapacityUserCleanup,
)
from benchmarks.staging_public_deployment import (
    StagingBackendDeploymentEvidence,
    StagingBackendPodEvidence,
    StagingCollectorPreflightEvidence,
)
from benchmarks.staging_public_results import build_staging_public_environment
from benchmarks.staging_public_scaling_report_cli import main
from benchmarks.staging_public_schemas import (
    StagingPublicEnvironment,
    StagingPublicRunSample,
    StagingPublicScenarioId,
)


class _DiagnosticError(BaseModel):
    code: str


class _Diagnostics(BaseModel):
    error: _DiagnosticError


def _environment(
    *,
    invocation_id: str,
    target_commit: str = "f" * 40,
    config_expected_sha256: str = "f" * 64,
    benchmark_scope_fingerprint: str = "hmac-sha256:" + "e" * 64,
) -> StagingPublicEnvironment:
    return build_staging_public_environment(
        invocation_id=invocation_id,
        service_api_base_url="https://api-staging.dify.dev/v1/",
        harness_commit="a" * 40,
        harness_dirty=False,
        target_commit=target_commit,
        scenario_manifest_sha256="b" * 64,
        deterministic_plugin_version="0.1.2",
        deterministic_plugin_package_sha256="c" * 64,
        config_expected_sha256=config_expected_sha256,
        e2b_observer_mode="local",
        benchmark_scope_fingerprint=benchmark_scope_fingerprint,
        edge_version="edge-v1",
        edge_version_before="edge-v1",
        edge_version_after="edge-v1",
    )


def _deployment(
    replicas: StagingPublicCapacityReplicaCount,
    *,
    captured_at: str,
    generation: int,
    image_id: str = "registry/agent@sha256:abc",
    effective_agent_config_fingerprint: str = "d" * 64,
) -> dict[str, object]:
    pods = [
        StagingBackendPodEvidence(
            name=f"agent-{replicas}-{index}",
            uid=f"pod-uid-{replicas}-{index}",
            node_name=f"node-{index}",
            zone=f"zone-{index % 3}",
            ready=True,
            restart_count=0,
            image="registry/agent@sha256:abc",
            image_id=image_id,
            cpu_request_millicores=2000,
            cpu_limit_millicores=2000,
            memory_request_mib=2048,
            memory_limit_mib=2048,
            declared_workers=2,
            observed_workers=2,
        )
        for index in range(replicas)
    ]
    return StagingBackendDeploymentEvidence(
        captured_at=captured_at,
        kube_context="staging-main",
        namespace="dify-staging",
        deployment_name="dify-agent-backend",
        service_name="dify-agent-backend-svc",
        expected_replicas=replicas,
        desired_replicas=replicas,
        updated_replicas=replicas,
        ready_replicas=replicas,
        available_replicas=replicas,
        generation=generation,
        observed_generation=generation,
        ready_endpoints=replicas,
        argo_child_auto_sync_disabled=True,
        argo_parent_auto_sync_enabled=True,
        argo_parent_self_heal_enabled=True,
        effective_agent_config_fingerprint=effective_agent_config_fingerprint,
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
            agent_backend_base_url_configured=True,
            agent_backend_health_reachable=False,
            agent_backend_openapi_reachable=True,
            valid=True,
        ),
        pods=pods,
        valid=True,
    ).model_dump(mode="json")


def _sample(
    scenario_id: StagingPublicScenarioId,
    *,
    replicas: StagingPublicCapacityReplicaCount,
    concurrency: StagingPublicCapacityConcurrency,
) -> StagingPublicRunSample:
    return StagingPublicRunSample(
        scenario_id=scenario_id,
        benchmark_run_id=f"run.r{replicas}.{scenario_id}.c{concurrency}",
        admitted=True,
        http_status_code=200,
        response_headers_ms=25,
        time_to_first_sse_ms=40,
        time_to_first_answer_ms=60,
        terminal_e2e_ms=100,
        event_count=2,
        answer_bytes=10,
        edge_version="edge-v1",
        terminal_status="succeeded",
        deterministic_markers_valid=True,
        shell_evidence_valid=scenario_id == "shell",
        config_materialized_item_count=13 if scenario_id == "config" else 0,
        config_materialized_bytes=53_248 if scenario_id == "config" else 0,
        config_materialized_sha256="a" * 64 if scenario_id == "config" else None,
        config_sha_valid=scenario_id == "config",
    )


def _canonical_point(
    scenario_id: StagingPublicScenarioId,
    concurrency: StagingPublicCapacityConcurrency,
    *,
    replicas: StagingPublicCapacityReplicaCount,
) -> StagingPublicCapacityPoint:
    started = datetime(2026, 8, 13, 1, 0, tzinfo=UTC)
    execution = StagingPublicCapacityExecution(
        scenario_id=scenario_id,
        requested_concurrency=concurrency,
        backend_replicas=replicas,
        setup=StagingPublicCapacitySetupResult(
            attempted_users=concurrency,
            allocated_users=concurrency,
            successful_users=concurrency,
            complete=True,
        ),
        observations=[
            StagingPublicCapacityObservation(
                worker_index=0,
                turn_index=0,
                admitted_offset_seconds=0.01,
                terminal_offset_seconds=0.11,
                completed_after_admission_window=False,
                sample=_sample(
                    scenario_id,
                    replicas=replicas,
                    concurrency=concurrency,
                ),
            )
        ],
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
            warmup_attempted=1,
            warmup_completed=1,
            attempted=1,
            admitted=1,
            terminal=1,
            successful=1,
            observed_max_active=concurrency,
            active_integral_seconds=60 * concurrency,
            active_mean=float(concurrency),
            setup_duration_seconds=float(concurrency),
            warmup_duration_seconds=15,
            admission_duration_seconds=60,
            measurement_duration_seconds=60,
            drain_duration_seconds=2,
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
            consecutive_zero_checks=2,
            interval_seconds=10,
            complete=True,
        ),
    )
    point = finalize_staging_public_capacity_point(execution)
    assert point.status == "valid_scaling"
    return point


def _execution_from_test_point(
    point: StagingPublicCapacityPoint,
) -> StagingPublicCapacityExecution:
    return StagingPublicCapacityExecution(
        scenario_id=point.scenario_id,
        requested_concurrency=point.requested_concurrency,
        backend_replicas=point.backend_replicas,
        block_index=point.block_index,
        phase=point.phase,
        setup=point.setup.model_copy(deep=True),
        observations=[item.model_copy(deep=True) for item in point.observations],
        cleanup=[item.model_copy(deep=True) for item in point.cleanup],
        load=point.load.model_copy(deep=True),
        e2b_observation=(point.e2b_observation.model_copy(deep=True) if point.e2b_observation else None),
        physical_cleanup=point.physical_cleanup.model_copy(deep=True),
    )


def _stage_with_basic_c1_boundary() -> StagingPublicCapacityStageResult:
    stage = _stage(1)
    by_key = {(block.scenario_id, block.requested_concurrency): block for block in stage.blocks}
    execution = _execution_from_test_point(by_key[("basic", 1)])
    execution.load.timeout_requests = 1
    boundary = finalize_staging_public_capacity_point(execution)
    assert boundary.status == "saturated"
    blocks = []
    for scenario_id, concurrency in staging_public_capacity_stage_matrix(1):
        if scenario_id == "basic" and concurrency == 1:
            blocks.append(boundary)
        elif scenario_id == "basic":
            blocks.append(
                build_staging_public_capacity_skipped_point(
                    scenario_id=scenario_id,
                    requested_concurrency=concurrency,
                    backend_replicas=1,
                    block_index=1,
                    reason="basic stopped after its first suspected boundary",
                )
            )
        else:
            blocks.append(by_key[(scenario_id, concurrency)])
    return stage.model_copy(update={"status": "degraded", "blocks": blocks})


def _stage(
    replicas: StagingPublicCapacityReplicaCount,
    *,
    target_commit: str = "f" * 40,
    after_image_id: str = "registry/agent@sha256:abc",
    config_expected_sha256: str = "f" * 64,
    before_config_fingerprint: str = "d" * 64,
    after_config_fingerprint: str | None = None,
) -> StagingPublicCapacityStageResult:
    blocks = [
        _canonical_point(
            scenario_id,
            concurrency,
            replicas=replicas,
        )
        for scenario_id, concurrency in staging_public_capacity_stage_matrix(replicas)
    ]
    return StagingPublicCapacityStageResult(
        backend_replicas=replicas,
        matrix_complete=True,
        status="passed",
        environment=_environment(
            invocation_id=f"stage-r{replicas}",
            target_commit=target_commit,
            config_expected_sha256=config_expected_sha256,
        ),
        deployment_before=_deployment(
            replicas,
            captured_at="2026-08-13T01:00:00+00:00",
            generation=replicas,
            effective_agent_config_fingerprint=before_config_fingerprint,
        ),
        deployment_after=_deployment(
            replicas,
            captured_at="2026-08-13T02:00:00+00:00",
            generation=replicas,
            image_id=after_image_id,
            effective_agent_config_fingerprint=(after_config_fingerprint or before_config_fingerprint),
        ),
        blocks=blocks,
        points=[],
        assessments=[],
        errors=[],
    )


def _write_stage(path: Path, stage: StagingPublicCapacityStageResult) -> None:
    _ = path.write_text(stage.model_dump_json(indent=2), encoding="utf-8")


def _read_diagnostics(output: Path) -> tuple[_Diagnostics, str]:
    text = (output / "aggregation-diagnostics.json").read_text(encoding="utf-8")
    return _Diagnostics.model_validate_json(text), text


def _arguments(tmp_path: Path, stages: tuple[StagingPublicCapacityStageResult, ...]) -> tuple[list[str], Path]:
    paths: list[Path] = []
    for replicas, stage in zip((1, 2, 4), stages, strict=True):
        path = tmp_path / f"r{replicas}.json"
        _write_stage(path, stage)
        paths.append(path)
    output = tmp_path / "aggregate"
    return (
        [
            "--replica-1-result",
            str(paths[0]),
            "--replica-2-result",
            str(paths[1]),
            "--replica-4-result",
            str(paths[2]),
            "--output-dir",
            str(output),
        ],
        output,
    )


def test_aggregates_three_valid_schema_v6_stages_offline(tmp_path: Path) -> None:
    args, output = _arguments(tmp_path, (_stage(1), _stage(2), _stage(4)))

    assert main(args) == 0

    result = StagingPublicCapacityResult.model_validate_json((output / "result.json").read_text(encoding="utf-8"))
    assert result.schema_version == 6
    assert result.mode == "staging-public-e2e-scaling"
    assert result.confidence == "single_block_shared_traffic"
    assert {(block.backend_replicas, block.scenario_id) for block in result.blocks} == {
        (1, "basic"),
        (1, "shell"),
        (1, "config"),
        (2, "basic"),
        (2, "shell"),
        (2, "config"),
        (4, "basic"),
        (4, "shell"),
        (4, "config"),
    }
    serialized = (output / "result.json").read_text(encoding="utf-8").lower()
    assert "deployment_before" not in serialized
    assert "pod-uid" not in serialized
    assert "bearer " not in serialized
    assert "e2b_api_key" not in serialized
    assert "app-" not in serialized


def test_rejects_all_skipped_stage_without_a_scheduler_gate(tmp_path: Path) -> None:
    stage_one = _stage(1)
    all_skipped = [
        build_staging_public_capacity_skipped_point(
            scenario_id=scenario_id,
            requested_concurrency=concurrency,
            backend_replicas=1,
            block_index=1,
            reason="fixture has no measured gate",
        )
        for scenario_id, concurrency in staging_public_capacity_stage_matrix(1)
    ]
    stage_one = stage_one.model_copy(update={"status": "degraded", "blocks": all_skipped})
    args, output = _arguments(tmp_path, (stage_one, _stage(2), _stage(4)))

    assert main(args) == 2

    diagnostics, _text = _read_diagnostics(output)
    assert diagnostics.error.code == "noncanonical_stage"


def test_rejects_a_point_with_noncanonical_derived_metrics(tmp_path: Path) -> None:
    stage_one = _stage(1)
    block = stage_one.blocks[0]
    assert block.metrics.terminal_runs_per_second is not None
    changed_metrics = block.metrics.model_copy(
        update={"terminal_runs_per_second": block.metrics.terminal_runs_per_second + 1}
    )
    changed_block = block.model_copy(update={"metrics": changed_metrics})
    changed_blocks = [changed_block, *stage_one.blocks[1:]]
    stage_one = stage_one.model_copy(update={"blocks": changed_blocks})
    args, output = _arguments(tmp_path, (stage_one, _stage(2), _stage(4)))

    assert main(args) == 2

    diagnostics, _text = _read_diagnostics(output)
    assert diagnostics.error.code == "noncanonical_stage"


@pytest.mark.parametrize("tampered_field", ("metrics", "cleanup", "observations"))
def test_rejects_measurement_evidence_hidden_in_a_legal_skipped_point(
    tmp_path: Path,
    tampered_field: str,
) -> None:
    stage_one = _stage_with_basic_c1_boundary()
    skipped_index = next(
        index
        for index, block in enumerate(stage_one.blocks)
        if block.scenario_id == "basic" and block.requested_concurrency == 10
    )
    skipped = stage_one.blocks[skipped_index]
    source = _canonical_point("basic", 10, replicas=1)
    update = {
        "metrics": source.metrics,
        "cleanup": source.cleanup,
        "observations": source.observations,
    }[tampered_field]
    changed = skipped.model_copy(update={tampered_field: update})
    blocks = [*stage_one.blocks]
    blocks[skipped_index] = changed
    stage_one = stage_one.model_copy(update={"blocks": blocks})
    args, output = _arguments(tmp_path, (stage_one, _stage(2), _stage(4)))

    assert main(args) == 2
    diagnostics, _text = _read_diagnostics(output)
    assert diagnostics.error.code == "noncanonical_stage"


def test_rejects_replica_mismatch_with_sanitized_diagnostics(tmp_path: Path) -> None:
    args, output = _arguments(tmp_path, (_stage(2), _stage(2), _stage(4)))

    assert main(args) == 2

    diagnostics = (output / "aggregation-diagnostics.json").read_text(encoding="utf-8")
    assert '"code": "replica_mismatch"' in diagnostics
    assert "pod-uid" not in diagnostics
    assert str(tmp_path) not in diagnostics


def test_rejects_an_incomplete_or_filtered_stage(tmp_path: Path) -> None:
    incomplete = _stage(1).model_copy(update={"matrix_complete": False, "blocks": _stage(1).blocks[:1]})
    args, output = _arguments(tmp_path, (incomplete, _stage(2), _stage(4)))

    assert main(args) == 2

    diagnostics, _text = _read_diagnostics(output)
    assert diagnostics.error.code == "incomplete_stage"


def test_rejects_cross_stage_target_or_harness_fingerprint_drift(tmp_path: Path) -> None:
    args, output = _arguments(
        tmp_path,
        (_stage(1), _stage(2, target_commit="e" * 40), _stage(4)),
    )

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "environment_mismatch"
    assert "e" * 40 not in text


def test_rejects_cross_stage_edge_version_drift(tmp_path: Path) -> None:
    stage_two = _stage(2)
    stage_two = stage_two.model_copy(
        update={
            "environment": stage_two.environment.model_copy(
                update={
                    "edge_version": "edge-v2",
                    "edge_version_before": "edge-v2",
                    "edge_version_after": "edge-v2",
                }
            )
        }
    )
    for block in stage_two.blocks:
        for observation in block.observations:
            observation.sample.edge_version = "edge-v2"
    args, output = _arguments(tmp_path, (_stage(1), stage_two, _stage(4)))

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "environment_mismatch"
    assert "edge-v2" not in text


def test_rejects_edge_rollout_within_a_stage(tmp_path: Path) -> None:
    stage_two = _stage(2)
    stage_two = stage_two.model_copy(
        update={"environment": stage_two.environment.model_copy(update={"edge_version_after": "edge-v2"})}
    )
    args, output = _arguments(tmp_path, (_stage(1), stage_two, _stage(4)))

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "edge_version_drift"
    assert "edge-v2" not in text


@pytest.mark.parametrize(
    ("field_name", "changed_value"),
    (("python_version", "3.12.99"), ("locust_version", "2.99.0")),
)
def test_rejects_cross_stage_load_generator_runtime_drift(
    tmp_path: Path,
    field_name: str,
    changed_value: str,
) -> None:
    stage_two = _stage(2)
    stage_two = stage_two.model_copy(
        update={"environment": stage_two.environment.model_copy(update={field_name: changed_value})}
    )
    args, output = _arguments(tmp_path, (_stage(1), stage_two, _stage(4)))

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "environment_mismatch"
    assert changed_value not in text


def test_rejects_cross_stage_config_fixture_sha_drift(tmp_path: Path) -> None:
    args, output = _arguments(
        tmp_path,
        (
            _stage(1),
            _stage(2, config_expected_sha256="e" * 64),
            _stage(4),
        ),
    )

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "environment_mismatch"
    assert "e" * 64 not in text


@pytest.mark.parametrize(
    "missing_field",
    (
        "config_expected_sha256",
        "benchmark_scope_fingerprint",
        "edge_version_before",
        "edge_version_after",
    ),
)
def test_rejects_stage_without_required_scaling_environment_identity(
    tmp_path: Path,
    missing_field: str,
) -> None:
    stage_two = _stage(2)
    stage_two = stage_two.model_copy(
        update={"environment": stage_two.environment.model_copy(update={missing_field: None})}
    )
    args, output = _arguments(tmp_path, (_stage(1), stage_two, _stage(4)))

    assert main(args) == 2
    diagnostics, _text = _read_diagnostics(output)
    assert diagnostics.error.code == "missing_environment_evidence"


def test_rejects_cross_stage_benchmark_scope_drift(tmp_path: Path) -> None:
    stage_two = _stage(2).model_copy(
        update={
            "environment": _environment(
                invocation_id="stage-r2",
                benchmark_scope_fingerprint="hmac-sha256:" + "f" * 64,
            )
        }
    )
    args, output = _arguments(tmp_path, (_stage(1), stage_two, _stage(4)))

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "environment_mismatch"
    assert "hmac-sha256:" + "f" * 64 not in text


def test_rejects_deployment_drift_within_a_stage(tmp_path: Path) -> None:
    args, output = _arguments(
        tmp_path,
        (_stage(1), _stage(2, after_image_id="registry/agent@sha256:different"), _stage(4)),
    )

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "deployment_drift"
    assert "sha256:different" not in text


def test_rejects_effective_agent_config_drift_within_a_stage(tmp_path: Path) -> None:
    args, output = _arguments(
        tmp_path,
        (
            _stage(1),
            _stage(2, after_config_fingerprint="e" * 64),
            _stage(4),
        ),
    )

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "deployment_drift"
    assert "e" * 64 not in text


def test_rejects_cross_stage_effective_agent_config_drift(tmp_path: Path) -> None:
    args, output = _arguments(
        tmp_path,
        (
            _stage(1),
            _stage(2, before_config_fingerprint="e" * 64),
            _stage(4),
        ),
    )

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "deployment_contract_mismatch"
    assert "e" * 64 not in text


def test_rejects_cross_stage_collector_image_drift(tmp_path: Path) -> None:
    stage_two = _stage(2)
    deployment = StagingBackendDeploymentEvidence.model_validate(stage_two.deployment_before)
    changed_collector = deployment.collector_preflight.model_copy(
        update={"pod_image_id": "registry/api@sha256:different-collector"}
    )
    changed_deployment = deployment.model_copy(update={"collector_preflight": changed_collector})
    stage_two = stage_two.model_copy(
        update={
            "deployment_before": changed_deployment.model_dump(mode="json"),
            "deployment_after": changed_deployment.model_dump(mode="json"),
        }
    )
    args, output = _arguments(tmp_path, (_stage(1), stage_two, _stage(4)))

    assert main(args) == 2
    diagnostics, text = _read_diagnostics(output)
    assert diagnostics.error.code == "deployment_contract_mismatch"
    assert "different-collector" not in text


def test_rejects_credentials_hidden_in_dynamic_locust_stats(tmp_path: Path) -> None:
    stages = (_stage(1), _stage(2), _stage(4))
    stages[1].blocks[0].load.stats["authorization"] = "Bearer do-not-serialize"
    args, output = _arguments(tmp_path, stages)

    assert main(args) == 2

    diagnostics = (output / "aggregation-diagnostics.json").read_text(encoding="utf-8")
    assert '"code": "private_artifact_field"' in diagnostics
    assert "do-not-serialize" not in diagnostics
    assert not (output / "result.json").exists()


def test_rejects_credential_like_values_under_other_dynamic_keys(tmp_path: Path) -> None:
    stages = (_stage(1), _stage(2), _stage(4))
    stages[1].blocks[0].load.stats["message"] = "app-credential-value-that-must-not-survive"
    args, output = _arguments(tmp_path, stages)

    assert main(args) == 2

    diagnostics = (output / "aggregation-diagnostics.json").read_text(encoding="utf-8")
    assert '"code": "secret_value_detected"' in diagnostics
    assert "credential-value" not in diagnostics
    assert not (output / "result.json").exists()


def test_rejects_non_stage_mode_without_echoing_untrusted_values(tmp_path: Path) -> None:
    paths: list[Path] = []
    for replicas in (1, 2, 4):
        path = tmp_path / f"r{replicas}.json"
        payload = _stage(replicas).model_dump(mode="json")
        if replicas == 1:
            payload["mode"] = "wrong-mode-with-e2b_do_not_echo"
        _ = path.write_text(json.dumps(payload), encoding="utf-8")
        paths.append(path)
    output = tmp_path / "aggregate"

    assert (
        main(
            [
                "--replica-1-result",
                str(paths[0]),
                "--replica-2-result",
                str(paths[1]),
                "--replica-4-result",
                str(paths[2]),
                "--output-dir",
                str(output),
            ]
        )
        == 2
    )
    diagnostics = (output / "aggregation-diagnostics.json").read_text(encoding="utf-8")
    assert '"code": "invalid_stage_result"' in diagnostics
    assert "do_not_echo" not in diagnostics
