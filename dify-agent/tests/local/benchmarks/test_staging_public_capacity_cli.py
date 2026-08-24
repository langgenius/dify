from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import signal
import sys
from types import SimpleNamespace
from typing import cast

import pytest

from benchmarks import staging_public_capacity_cli
from benchmarks.staging_public_capacity_results import staging_public_capacity_stage_matrix
from benchmarks.staging_public_capacity_schemas import (
    StagingPublicCapacityE2BObservation,
    StagingPublicCapacityExecution,
    StagingPublicCapacityLoadResult,
    StagingPublicCapacityObservation,
    StagingPublicCapacityPhysicalCleanupEvidence,
    StagingPublicCapacityReplicaCount,
    StagingPublicCapacitySetupResult,
    StagingPublicCapacityUserCleanup,
)
from benchmarks.staging_public_deployment import (
    StagingBackendDeploymentEvidence,
    StagingBackendPodEvidence,
    StagingCollectorPreflightEvidence,
)
from benchmarks.staging_public_physical_cleanup import (
    StagingAllocationRecoveryResult,
    StagingDatabaseCleanupEvidence,
    StagingJointCleanupEvidence,
    StagingPhysicalCleanupResult,
)
from benchmarks.staging_public_schemas import (
    StagingPublicEdgeProbeEvidence,
    StagingPublicRunSample,
    StagingPublicScenarioId,
)


_API_KEY = "capacity-key-never-serialize"
_E2B_API_KEY = "e2b-key-never-serialize"
_RUN_ID = "scaling-cli-test"
_NOW = datetime(2026, 8, 13, tzinfo=timezone.utc)


@dataclass(frozen=True)
class _FakeRequest:
    scenario_id: StagingPublicScenarioId
    requested_concurrency: int
    expected_backend_replicas: StagingPublicCapacityReplicaCount
    invocation_id: str


def _deployment(
    replicas: int,
    *,
    uid_suffix: str = "stable",
    file_cleanup_valid: bool = True,
) -> StagingBackendDeploymentEvidence:
    return StagingBackendDeploymentEvidence(
        captured_at=_NOW.isoformat(),
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
                uid=f"uid-{uid_suffix}-{index}",
                node_name=f"node-{index}",
                zone=f"zone-{index % 3}",
                ready=True,
                restart_count=0,
                image="registry/agent@sha256:abc",
                image_id="registry/agent@sha256:abc",
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
    )


def _sample(scenario_id: StagingPublicScenarioId, benchmark_run_id: str) -> StagingPublicRunSample:
    return StagingPublicRunSample(
        scenario_id=scenario_id,
        benchmark_run_id=benchmark_run_id,
        admitted=True,
        http_status_code=200,
        conversation_reused=True,
        response_headers_ms=10,
        time_to_first_sse_ms=20,
        time_to_first_answer_ms=30,
        terminal_e2e_ms=100,
        event_count=2,
        answer_bytes=10,
        edge_version="1.16.1",
        terminal_status="succeeded",
        deterministic_markers_valid=True,
        shell_evidence_valid=scenario_id == "shell",
        config_materialized_item_count=13 if scenario_id == "config" else 0,
        config_materialized_bytes=53_248 if scenario_id == "config" else 0,
        config_materialized_sha256="a" * 64 if scenario_id == "config" else None,
        config_sha_valid=scenario_id == "config",
        file_payload_bytes=16 * 1024 * 1024 if scenario_id == "file" else 0,
        file_payload_sha256=(
            "341aacac661ccb210720bedaa9ead5d668fe5ea41a73532fc147c71e34040df1" if scenario_id == "file" else None
        ),
        file_integrity_valid=scenario_id == "file",
    )


def _valid_execution(request: _FakeRequest) -> StagingPublicCapacityExecution:
    concurrency = request.requested_concurrency
    observations = [
        StagingPublicCapacityObservation(
            worker_index=index,
            turn_index=0,
            admitted_offset_seconds=min(index / max(concurrency, 1), 59),
            terminal_offset_seconds=min(index / max(concurrency, 1), 59) + 0.1,
            sample=_sample(request.scenario_id, f"{request.invocation_id}.m{index}"),
        )
        for index in range(concurrency)
    ]
    return StagingPublicCapacityExecution(
        scenario_id=request.scenario_id,
        requested_concurrency=concurrency,
        backend_replicas=request.expected_backend_replicas,
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
            attempted=concurrency,
            admitted=concurrency,
            terminal=concurrency,
            successful=concurrency,
            observed_max_active=concurrency,
            active_integral_seconds=concurrency * 60,
            active_mean=float(concurrency),
            setup_duration_seconds=concurrency,
            warmup_duration_seconds=15,
            admission_duration_seconds=60,
            measurement_duration_seconds=60,
            measurement_started_at=_NOW,
            measurement_ended_at=_NOW + timedelta(seconds=60),
            stats={"entries": []},
        ),
        e2b_observation=StagingPublicCapacityE2BObservation(
            running_max=min(concurrency, 19),
            paused_max=concurrency,
            sample_count=60,
            successful_sample_count=60,
            observation_complete=True,
        ),
        physical_cleanup=StagingPublicCapacityPhysicalCleanupEvidence(
            checked=True,
            target_conversations=concurrency,
            target_sandboxes=concurrency,
            target_tool_files=1 if request.scenario_id == "file" else 0,
            consecutive_zero_checks=2,
            interval_seconds=10,
            complete=True,
        ),
    )


def _prepare(monkeypatch, tmp_path: Path, *, replicas: int = 1) -> Path:
    results_root = tmp_path / "results"
    package = tmp_path / "model.difypkg"
    package.write_bytes(b"plugin")
    monkeypatch.setenv("BENCH_CONFIRM_STAGING_RUN", "RUN_STAGING_BENCHMARK")
    monkeypatch.setenv("BENCH_STAGING_API_KEY", _API_KEY)
    monkeypatch.setenv("BENCH_E2B_API_KEY", _E2B_API_KEY)
    monkeypatch.setattr(staging_public_capacity_cli, "_plugin_package_version", lambda _path: "0.1.4")
    monkeypatch.setattr(staging_public_capacity_cli, "_git_identity", lambda: ("a" * 40, False))
    monkeypatch.setattr(staging_public_capacity_cli.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "collect_staging_backend_deployment_evidence",
        lambda **_kwargs: _deployment(replicas),
    )
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "probe_staging_public_edge",
        lambda _base_url: StagingPublicEdgeProbeEvidence(
            http_status_code=405,
            edge_version="1.16.1",
            edge_server="cloudflare",
        ),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "staging-public-scaling-stage",
            "--backend-replicas",
            str(replicas),
            "--run-id",
            _RUN_ID,
            "--results-root",
            str(results_root),
            "--plugin-package",
            str(package),
            "--benchmark-tenant-id",
            "benchmark-tenant",
            "--benchmark-agent-id",
            "benchmark-agent",
        ],
    )
    return results_root / f"{_RUN_ID}-staging-public-scaling-r{replicas}"


@pytest.mark.parametrize(
    ("confirmation", "api_key", "e2b_api_key", "message"),
    [
        (None, _API_KEY, _E2B_API_KEY, "BENCH_CONFIRM_STAGING_RUN=RUN_STAGING_BENCHMARK"),
        ("RUN_STAGING_BENCHMARK", None, _E2B_API_KEY, "BENCH_STAGING_API_KEY must be provided"),
        ("RUN_STAGING_BENCHMARK", _API_KEY, None, "BENCH_E2B_API_KEY must be provided"),
    ],
)
def test_safety_gates_fail_before_deployment_or_load(
    monkeypatch,
    capsys,
    confirmation,
    api_key,
    e2b_api_key,
    message,
) -> None:
    if confirmation is None:
        monkeypatch.delenv("BENCH_CONFIRM_STAGING_RUN", raising=False)
    else:
        monkeypatch.setenv("BENCH_CONFIRM_STAGING_RUN", confirmation)
    if api_key is None:
        monkeypatch.delenv("BENCH_STAGING_API_KEY", raising=False)
    else:
        monkeypatch.setenv("BENCH_STAGING_API_KEY", api_key)
    if e2b_api_key is None:
        monkeypatch.delenv("BENCH_E2B_API_KEY", raising=False)
    else:
        monkeypatch.setenv("BENCH_E2B_API_KEY", e2b_api_key)
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "collect_staging_backend_deployment_evidence",
        lambda **_kwargs: pytest.fail("deployment must not be queried"),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "staging-public-scaling-stage",
            "--backend-replicas",
            "1",
            "--benchmark-tenant-id",
            "tenant",
            "--benchmark-agent-id",
            "agent",
        ],
    )
    assert staging_public_capacity_cli.main() == 2
    assert message in capsys.readouterr().err


def test_dirty_harness_fails_before_deployment_or_load(monkeypatch, tmp_path: Path) -> None:
    package = tmp_path / "model.difypkg"
    package.write_bytes(b"plugin")
    monkeypatch.setenv("BENCH_CONFIRM_STAGING_RUN", "RUN_STAGING_BENCHMARK")
    monkeypatch.setenv("BENCH_STAGING_API_KEY", _API_KEY)
    monkeypatch.setenv("BENCH_E2B_API_KEY", _E2B_API_KEY)
    monkeypatch.setattr(staging_public_capacity_cli, "_plugin_package_version", lambda _path: "0.1.4")
    monkeypatch.setattr(staging_public_capacity_cli, "_git_identity", lambda: ("a" * 40, True))
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "collect_staging_backend_deployment_evidence",
        lambda **_kwargs: pytest.fail("deployment must not be queried for a dirty Harness"),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "staging-public-scaling-stage",
            "--backend-replicas",
            "1",
            "--results-root",
            str(tmp_path / "results"),
            "--plugin-package",
            str(package),
            "--benchmark-tenant-id",
            "tenant",
            "--benchmark-agent-id",
            "agent",
        ],
    )

    assert staging_public_capacity_cli.main() == 2


def test_cli_entrypoint_restores_sigterm_handler(monkeypatch) -> None:
    previous = signal.getsignal(signal.SIGTERM)
    monkeypatch.setattr(staging_public_capacity_cli, "main", lambda: 7)

    assert staging_public_capacity_cli._run_cli() == 7
    assert signal.getsignal(signal.SIGTERM) is previous


def test_cli_entrypoint_converts_sigterm_to_safe_interrupt_and_restores_handler(monkeypatch, capsys) -> None:
    previous = signal.getsignal(signal.SIGTERM)

    def interrupted_main() -> int:
        handler = signal.getsignal(signal.SIGTERM)
        assert callable(handler)
        handler(signal.SIGTERM, None)
        pytest.fail("SIGTERM handler must interrupt the active CLI")

    monkeypatch.setattr(staging_public_capacity_cli, "main", interrupted_main)

    assert staging_public_capacity_cli._run_cli() == 130
    assert signal.getsignal(signal.SIGTERM) is previous
    assert "interrupted before safe cleanup completed" in capsys.readouterr().err


def _write_private(path: Path, payload: str) -> None:
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        stream.write(payload)


class _FakeObserver:
    def __init__(self, _options) -> None:
        self.closed = False
        self.cleanup_sample_count = 0

    def start(self) -> None:
        pass

    def collect_public_count_snapshot(self, *, destination: Path):
        sample = staging_public_capacity_cli.E2BObserverSample(
            timestamp=_NOW,
            running=0,
            paused=0,
            target_remaining=0,
            api_status="ok",
        )
        destination.write_text(sample.model_dump_json() + "\n", encoding="utf-8")
        return sample

    def collect_snapshot(self, *, destination: Path) -> Path:
        _write_private(destination, '{"sandbox_id":"private"}\n')
        return destination

    def collect_latest_public_count_sample(self):
        self.cleanup_sample_count += 1
        return staging_public_capacity_cli.E2BObserverSample(
            timestamp=_NOW + timedelta(seconds=self.cleanup_sample_count * 10),
            running=0,
            paused=0,
            target_remaining=0,
            api_status="ok",
        )

    def stop_and_collect(self, *, public_output_dir: Path, private_manifest_path: Path):
        public_output_dir.mkdir()
        sample = staging_public_capacity_cli.E2BObserverSample(
            timestamp=_NOW + timedelta(seconds=30),
            running=0,
            paused=0,
            target_remaining=0,
            api_status="ok",
        )
        samples_path = public_output_dir / "e2b-running-count.jsonl"
        samples_path.write_text(sample.model_dump_json() + "\n", encoding="utf-8")
        _write_private(private_manifest_path, '{"sandbox_id":"private"}\n')
        return SimpleNamespace(
            summary=SimpleNamespace(target_count=1, target_zero_consecutive_seconds=10),
            final_sample=sample,
            public_samples_path=samples_path,
        )

    def close(self) -> None:
        self.closed = True


def _run_block_with_private_recovery(
    monkeypatch,
    tmp_path: Path,
    *,
    reconciliation_error: BaseException | None = None,
    observer_close_error: BaseException | None = None,
    recovered_count: int = 0,
) -> tuple[StagingPublicCapacityExecution, Path, Path]:
    blocks_dir = tmp_path / "public" / "blocks"
    blocks_dir.mkdir(parents=True)
    recovery_root = tmp_path / "private-recovery"

    def run_point(request):
        assert request.private_manifest_output is not None
        _write_private(
            request.private_manifest_output,
            (
                ""
                if recovered_count
                else '{"event":"allocated","worker_index":0,"conversation_id":"private-conversation"}\n'
            ),
        )
        execution = _valid_execution(
            _FakeRequest(
                scenario_id="basic",
                requested_concurrency=1,
                expected_backend_replicas=1,
                invocation_id=request.invocation_id,
            )
        )
        if recovered_count:
            execution = execution.model_copy(
                update={
                    "setup": execution.setup.model_copy(
                        update={
                            "allocated_users": 0,
                            "successful_users": 0,
                            "complete": False,
                            "errors": ["admitted cold request had unknown allocation"],
                        }
                    )
                }
            )
        return execution

    def reconcile(*, private_manifest_path: Path, before_delete, vendor_remaining_probe, **_kwargs):
        _write_private(private_manifest_path, '{"targets":[{"workspace_id":"private"}]}\n')
        before_delete(private_manifest_path)
        if reconciliation_error is not None:
            raise reconciliation_error
        first_vendor_sample = vendor_remaining_probe()
        second_vendor_sample = vendor_remaining_probe()
        assert (second_vendor_sample.timestamp - first_vendor_sample.timestamp).total_seconds() >= 10
        return StagingPhysicalCleanupResult(
            cleanup=tuple(
                _valid_execution(
                    _FakeRequest(
                        scenario_id="basic",
                        requested_concurrency=1,
                        expected_backend_replicas=1,
                        invocation_id="cleanup",
                    )
                ).cleanup
            ),
            database=StagingDatabaseCleanupEvidence(
                target_conversations=1,
                target_workspaces=1,
                target_bindings=1,
                conversations_remaining=0,
                workspaces_remaining=0,
                bindings_remaining=0,
                consecutive_zero_checks=2,
                interval_seconds=10,
                complete=True,
            ),
            joint=StagingJointCleanupEvidence(
                conversations_remaining=0,
                workspaces_remaining=0,
                bindings_remaining=0,
                vendor_sandboxes_remaining=0,
                consecutive_zero_checks=2,
                interval_seconds=10,
                complete=True,
            ),
            private_manifest_path=private_manifest_path,
        )

    def recover(*, private_manifest_path: Path, **_kwargs):
        _write_private(
            private_manifest_path,
            '{"allocations":[{"conversation_id":"private-conversation"}]}\n',
        )
        return StagingAllocationRecoveryResult(
            allocated_count=1,
            recovered_count=recovered_count,
            private_manifest_path=private_manifest_path,
        )

    class Observer(_FakeObserver):
        def close(self) -> None:
            if observer_close_error is not None:
                raise observer_close_error
            super().close()

    monkeypatch.setattr(staging_public_capacity_cli, "StagingE2BLocalObserver", Observer)
    monkeypatch.setattr(staging_public_capacity_cli, "run_staging_public_capacity_point", run_point)
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "recover_unjournaled_staging_public_allocations",
        recover,
    )
    monkeypatch.setattr(staging_public_capacity_cli, "reconcile_staging_public_resources", reconcile)
    monkeypatch.setattr(staging_public_capacity_cli, "validate_private_e2b_target_manifest", lambda **_kwargs: None)
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "capacity_e2b_observation_for_window",
        lambda *_args, **_kwargs: StagingPublicCapacityE2BObservation(
            running_max=0,
            paused_max=0,
            sample_count=1,
            successful_sample_count=1,
            observation_complete=True,
        ),
    )
    monkeypatch.setattr(staging_public_capacity_cli.time, "sleep", lambda _seconds: None)

    execution = staging_public_capacity_cli._execute_block(
        run_id="private-recovery-test",
        settings=staging_public_capacity_cli.StagingPublicProtocolSettings(
            service_api_base_url="https://api-staging.example/v1/",
            api_key=staging_public_capacity_cli.SecretStr(_API_KEY),
            config_expected_sha256="a" * 64,
        ),
        scenario_id="basic",
        concurrency=1,
        backend_replicas=1,
        api_key=_API_KEY,
        blocks_dir=blocks_dir,
        kube_context="staging-main",
        namespace="dify-staging",
        e2b_api_key=_E2B_API_KEY,
        benchmark_tenant_id="benchmark-tenant",
        benchmark_agent_id="benchmark-agent",
        private_recovery_root=recovery_root,
    )
    return execution, recovery_root, blocks_dir / "basic-c1-b1"


def test_successful_block_removes_private_recovery_directory(monkeypatch, tmp_path: Path) -> None:
    execution, recovery_root, block_dir = _run_block_with_private_recovery(monkeypatch, tmp_path)

    assert execution.physical_cleanup.complete is True
    assert recovery_root.stat().st_mode & 0o777 == 0o700
    assert list(recovery_root.iterdir()) == []
    assert not (block_dir / "recovery.json").exists()


@pytest.mark.parametrize("error", [RuntimeError("reconciliation failed"), KeyboardInterrupt()])
def test_failed_or_interrupted_block_retains_private_recovery_with_opaque_public_handle(
    monkeypatch, tmp_path: Path, error: BaseException
) -> None:
    execution, recovery_root, block_dir = _run_block_with_private_recovery(
        monkeypatch,
        tmp_path,
        reconciliation_error=error,
    )

    retained = list(recovery_root.iterdir())
    assert len(retained) == 1
    assert retained[0].stat().st_mode & 0o777 == 0o700
    assert {path.name for path in retained[0].iterdir()} >= {
        "allocation-journal.jsonl",
        "allocation-recovery.json",
        "database-targets.json",
        "e2b-targets-0.jsonl",
    }
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in retained[0].iterdir())
    public_recovery = json.loads((block_dir / "recovery.json").read_text(encoding="utf-8"))
    assert public_recovery == {
        "handle": retained[0].name,
        "schema_version": 1,
        "status": "manual_cleanup_required",
    }
    assert str(recovery_root) not in (block_dir / "recovery.json").read_text(encoding="utf-8")
    assert "private-conversation" not in (block_dir / "recovery.json").read_text(encoding="utf-8")
    assert execution.physical_cleanup.complete is False


def test_recovered_unknown_allocation_is_cleaned_but_invalidates_the_block(monkeypatch, tmp_path: Path) -> None:
    execution, recovery_root, _block_dir = _run_block_with_private_recovery(
        monkeypatch,
        tmp_path,
        recovered_count=1,
    )

    assert execution.physical_cleanup.complete is True
    assert list(recovery_root.iterdir()) == []
    assert "parent recovered an admitted cold request without an SSE allocation identity" in execution.load.fatal_errors


def test_interrupted_observer_cleanup_retains_private_recovery(monkeypatch, tmp_path: Path) -> None:
    execution, recovery_root, block_dir = _run_block_with_private_recovery(
        monkeypatch,
        tmp_path,
        observer_close_error=KeyboardInterrupt(),
    )

    retained = list(recovery_root.iterdir())
    assert len(retained) == 1
    assert json.loads((block_dir / "recovery.json").read_text(encoding="utf-8"))["handle"] == retained[0].name
    assert "E2B observer cleanup was interrupted" in execution.load.fatal_errors


def test_scaling_environment_records_only_non_reversible_observer_and_scope_fingerprints(
    monkeypatch, tmp_path: Path
) -> None:
    artifact_dir = _prepare(monkeypatch, tmp_path, replicas=2)

    def execute(**kwargs):
        return _valid_execution(_fake_request(kwargs))

    monkeypatch.setattr(staging_public_capacity_cli, "_execute_block", execute)
    assert staging_public_capacity_cli.main() == 0

    environment = json.loads((artifact_dir / "environment.json").read_text(encoding="utf-8"))
    assert environment["e2b_observer_mode"] == "local"
    assert environment["benchmark_scope_fingerprint"].startswith("hmac-sha256:")
    serialized = json.dumps(environment)
    assert _API_KEY not in serialized
    assert _E2B_API_KEY not in serialized
    assert "benchmark-tenant" not in serialized
    assert "benchmark-agent" not in serialized


def test_replica_one_runs_asymmetric_stage_in_gate_first_order(monkeypatch, tmp_path: Path) -> None:
    artifact_dir = _prepare(monkeypatch, tmp_path, replicas=1)
    calls: list[tuple[str, int]] = []

    def execute(**kwargs):
        request = _fake_request(kwargs)
        calls.append((request.scenario_id, request.requested_concurrency))
        return _valid_execution(request)

    monkeypatch.setattr(staging_public_capacity_cli, "_execute_block", execute)
    assert staging_public_capacity_cli.main() == 0
    assert calls[:4] == [("basic", 1), ("shell", 1), ("config", 1), ("file", 1)]
    assert set(calls) == set(staging_public_capacity_stage_matrix(1))
    result = json.loads((artifact_dir / "result.json").read_text())
    assert result["schema_version"] == 7
    assert result["mode"] == "staging-public-e2e-scaling-stage"
    assert result["backend_replicas"] == 1
    assert result["matrix_complete"] is True
    for path in artifact_dir.rglob("*"):
        if path.is_file():
            assert _API_KEY not in path.read_text()


@pytest.mark.parametrize("replicas", [2, 4])
def test_scale_out_stage_runs_runtime_correctness_before_basic_scan(
    monkeypatch,
    tmp_path: Path,
    replicas: int,
) -> None:
    _prepare(monkeypatch, tmp_path, replicas=replicas)
    calls: list[tuple[str, int]] = []

    def execute(**kwargs):
        request = _fake_request(kwargs)
        calls.append((request.scenario_id, request.requested_concurrency))
        return _valid_execution(request)

    monkeypatch.setattr(staging_public_capacity_cli, "_execute_block", execute)
    assert staging_public_capacity_cli.main() == 0
    assert calls[:3] == [("basic", 1), ("shell", 10), ("config", 10)]
    assert set(calls) == set(staging_public_capacity_stage_matrix(cast(StagingPublicCapacityReplicaCount, replicas)))


def test_file_points_are_available_only_in_r1() -> None:
    assert staging_public_capacity_cli._selected_stage_matrix(
        1,
        scenario_filter="file",
        concurrency_filter=1,
    ) == [("file", 1)]
    assert staging_public_capacity_cli._selected_stage_matrix(
        1,
        scenario_filter="file",
        concurrency_filter=10,
    ) == [("file", 10)]
    assert staging_public_capacity_cli._selected_stage_matrix(
        1,
        scenario_filter="file",
        concurrency_filter=20,
    ) == [("file", 20)]
    assert (
        staging_public_capacity_cli._selected_stage_matrix(
            2,
            scenario_filter="file",
            concurrency_filter=1,
        )
        == []
    )


def test_r1_file_matrix_fails_before_load_when_cleanup_capability_is_missing(
    monkeypatch,
    tmp_path: Path,
) -> None:
    _prepare(monkeypatch, tmp_path, replicas=1)
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "collect_staging_backend_deployment_evidence",
        lambda **_kwargs: _deployment(1, file_cleanup_valid=False),
    )
    calls = 0

    def execute(**_kwargs):
        nonlocal calls
        calls += 1
        raise AssertionError("File capability gate must run before load")

    monkeypatch.setattr(staging_public_capacity_cli, "_execute_block", execute)
    assert staging_public_capacity_cli.main() == 2
    assert calls == 0


def test_basic_debug_subset_does_not_require_file_cleanup_capability(
    monkeypatch,
    tmp_path: Path,
) -> None:
    _prepare(monkeypatch, tmp_path, replicas=1)
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "collect_staging_backend_deployment_evidence",
        lambda **_kwargs: _deployment(1, file_cleanup_valid=False),
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [*sys.argv, "--scenario", "basic", "--concurrency", "1"],
    )
    calls: list[tuple[str, int]] = []

    def execute(**kwargs):
        request = _fake_request(kwargs)
        calls.append((request.scenario_id, request.requested_concurrency))
        return _valid_execution(request)

    monkeypatch.setattr(staging_public_capacity_cli, "_execute_block", execute)
    assert staging_public_capacity_cli.main() == 0
    assert calls == [("basic", 1)]


def test_basic_stops_after_first_suspected_boundary_without_repeats(monkeypatch, tmp_path: Path) -> None:
    artifact_dir = _prepare(monkeypatch, tmp_path, replicas=1)
    calls: list[tuple[str, int]] = []

    def execute(**kwargs):
        request = _fake_request(kwargs)
        calls.append((request.scenario_id, request.requested_concurrency))
        execution = _valid_execution(request)
        if request.scenario_id == "basic" and request.requested_concurrency == 20:
            execution.load.timeout_requests = 1
            execution.load.timed_out = True
        return execution

    monkeypatch.setattr(staging_public_capacity_cli, "_execute_block", execute)
    assert staging_public_capacity_cli.main() == 0
    assert ("basic", 20) in calls
    assert all(("basic", concurrency) not in calls for concurrency in (30, 40, 60, 80, 120, 160))
    result = json.loads((artifact_dir / "result.json").read_text())
    basic = [block for block in result["blocks"] if block["scenario_id"] == "basic"]
    assert next(block for block in basic if block["requested_concurrency"] == 20)["status"] == "saturated"
    assert all(block["status"] == "skipped" for block in basic if block["requested_concurrency"] > 20)


def test_invalid_point_stops_the_entire_stage(monkeypatch, tmp_path: Path) -> None:
    artifact_dir = _prepare(monkeypatch, tmp_path, replicas=1)
    calls: list[tuple[str, int]] = []

    def execute(**kwargs):
        request = _fake_request(kwargs)
        calls.append((request.scenario_id, request.requested_concurrency))
        execution = _valid_execution(request)
        execution.physical_cleanup.complete = False
        return execution

    monkeypatch.setattr(staging_public_capacity_cli, "_execute_block", execute)
    assert staging_public_capacity_cli.main() == 1
    assert calls == [("basic", 1)]
    result = json.loads((artifact_dir / "result.json").read_text())
    assert result["status"] == "failed"
    assert all(block["status"] == "skipped" for block in result["blocks"][1:])


def test_deployment_drift_fails_the_stage_after_load(monkeypatch, tmp_path: Path) -> None:
    artifact_dir = _prepare(monkeypatch, tmp_path, replicas=1)
    deployments = iter((_deployment(1), _deployment(1, uid_suffix="replacement")))
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "collect_staging_backend_deployment_evidence",
        lambda **_kwargs: next(deployments),
    )

    def execute(**kwargs):
        request = _fake_request(kwargs)
        return _valid_execution(request)

    monkeypatch.setattr(staging_public_capacity_cli, "_execute_block", execute)
    assert staging_public_capacity_cli.main() == 1
    result = json.loads((artifact_dir / "result.json").read_text())
    assert result["status"] == "failed"
    assert any("changed during the stage" in error for error in result["errors"])


def test_edge_rollout_after_last_request_fails_the_stage(monkeypatch, tmp_path: Path) -> None:
    artifact_dir = _prepare(monkeypatch, tmp_path, replicas=1)
    probes = iter(
        (
            StagingPublicEdgeProbeEvidence(http_status_code=405, edge_version="1.16.1"),
            StagingPublicEdgeProbeEvidence(http_status_code=405, edge_version="1.16.2"),
        )
    )
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "probe_staging_public_edge",
        lambda _base_url: next(probes),
    )
    monkeypatch.setattr(
        staging_public_capacity_cli,
        "_execute_block",
        lambda **kwargs: _valid_execution(_fake_request(kwargs)),
    )

    assert staging_public_capacity_cli.main() == 1
    result = json.loads((artifact_dir / "result.json").read_text(encoding="utf-8"))
    assert result["environment"]["edge_version_before"] == "1.16.1"
    assert result["environment"]["edge_version_after"] == "1.16.2"
    assert any("between replica-stage probes" in error for error in result["errors"])


@pytest.mark.parametrize(
    ("stats", "expected_code"),
    [
        ({"nested": {"conversation_id": "private-conversation"}}, "private_artifact_field"),
        ({"nested": {"message": f"prefix {_API_KEY} suffix"}}, "secret_value_detected"),
    ],
)
def test_unsafe_stage_payload_is_purged_before_sanitized_diagnostics(
    monkeypatch,
    tmp_path: Path,
    stats: dict[str, object],
    expected_code: str,
) -> None:
    artifact_dir = _prepare(monkeypatch, tmp_path, replicas=2)

    def execute(**kwargs):
        execution = _valid_execution(_fake_request(kwargs))
        execution.load.stats = stats
        return execution

    monkeypatch.setattr(staging_public_capacity_cli, "_execute_block", execute)

    assert staging_public_capacity_cli.main() == 2
    assert {path.name for path in artifact_dir.iterdir()} == {"stage-diagnostics.json"}
    diagnostics_text = (artifact_dir / "stage-diagnostics.json").read_text(encoding="utf-8")
    diagnostics = json.loads(diagnostics_text)
    assert diagnostics["error"]["code"] == expected_code
    assert _API_KEY not in diagnostics_text
    assert "private-conversation" not in diagnostics_text
    assert not (artifact_dir / "result.json").exists()
    assert not (artifact_dir / "report.md").exists()
    assert not (artifact_dir / "blocks").exists()


def _fake_request(kwargs: dict[str, object]) -> _FakeRequest:
    scenario_id = cast(StagingPublicScenarioId, kwargs["scenario_id"])
    concurrency = cast(int, kwargs["concurrency"])
    replicas = cast(StagingPublicCapacityReplicaCount, kwargs["backend_replicas"])
    return _FakeRequest(
        scenario_id=scenario_id,
        requested_concurrency=concurrency,
        expected_backend_replicas=replicas,
        invocation_id=f"run.{scenario_id}.c{concurrency}",
    )
