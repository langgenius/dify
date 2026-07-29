import pytest

from benchmarks.orchestrator import build_comparison
from benchmarks.schemas import (
    BlockResult,
    EnvironmentFingerprint,
    RedisSnapshot,
    ResourceSummary,
    RunOutcomeSummary,
    RunSample,
    StatsCoverage,
    TargetIdentity,
    TargetKind,
    TargetResult,
)


def _environment() -> EnvironmentFingerprint:
    return EnvironmentFingerprint(
        captured_at="2026-07-29T00:00:00+00:00",
        os="Docker Desktop",
        architecture="arm64",
        kernel="test",
        cpu_model="test",
        docker_engine="29",
        docker_compose="5",
        docker_cpus=8,
        docker_memory_bytes=8_000_000_000,
        compose_hash="compose",
        harness_hash="harness",
        redis_image="redis@sha256:test",
        python_base_image_id="sha256:python",
    )


def _identity(kind: TargetKind) -> TargetIdentity:
    return TargetIdentity(
        kind=kind,
        ref=kind,
        commit="a" * 40,
        dirty=False,
        content_hash=kind,
        lock_hash="lock",
        image_tag=f"image:{kind}",
        image_id=f"sha256:{kind}",
        python_version="Python 3.12.13",
    )


def _block(*, target: TargetKind, pair_index: int, overhead_ms: float, cpu_seconds: float) -> BlockResult:
    samples = [
        RunSample(
            target=target,
            scenario_id="scenario",
            block_id=f"{target}-{pair_index}",
            pair_index=pair_index,
            benchmark_run_id=f"{target}-{pair_index}-{index}",
            run_id=f"run-{index}",
            admitted=True,
            create_run_http_ms=1,
            time_to_first_event_ms=5,
            terminal_e2e_ms=overhead_ms + 10,
            runtime_overhead_ms=overhead_ms,
            event_count=10,
            terminal_status="succeeded",
            ledger_valid=True,
            event_replay_valid=True,
        )
        for index in range(8)
    ]
    return BlockResult(
        target=target,
        target_id=target,
        scenario_id="scenario",
        scenario_version=1,
        block_id=f"{target}-{pair_index}",
        pair_index=pair_index,
        measurement_started_at_ns=1,
        measurement_ended_at_ns=2,
        outcomes=RunOutcomeSummary(
            attempted_runs=8,
            admitted_runs=8,
            terminal_runs=8,
            successful_runs=8,
            admission_rate=1,
            terminal_rate=1,
            success_rate=1,
            terminal_runs_per_second=100,
            successful_runs_per_second=100,
            events_per_successful_run=10,
            max_active_runs=1,
        ),
        redis_before=RedisSnapshot(),
        redis_after=RedisSnapshot(),
        resources=ResourceSummary(
            agent_cpu_seconds_per_successful_run=cpu_seconds,
            agent_peak_memory_delta_bytes=100,
            agent_memory_gb_seconds_per_successful_run=0.001,
            agent_network_bytes_per_successful_run=50,
            redis_cpu_seconds_per_successful_run=0.002,
            redis_memory_gb_seconds_per_successful_run=0.0005,
            redis_commands_per_successful_run=10,
            redis_command_calls_per_successful_run={"xadd": 8, "set": 2},
            redis_network_bytes_per_successful_run=90,
            redis_storage_bytes_per_successful_run=60,
            agent_stats_coverage=StatsCoverage(sample_count=10, in_window_sample_count=8, window_covered=True),
            redis_stats_coverage=StatsCoverage(sample_count=10, in_window_sample_count=8, window_covered=True),
            fake_stats_coverage=StatsCoverage(sample_count=10, in_window_sample_count=8, window_covered=True),
        ),
        samples=samples,
        valid=True,
    )


def test_build_comparison_preserves_workload_and_resource_metrics() -> None:
    environment = _environment()
    baseline = TargetResult(
        target=_identity("baseline"),
        environment=environment,
        blocks=[
            _block(target="baseline", pair_index=0, overhead_ms=10, cpu_seconds=0.01),
            _block(target="baseline", pair_index=1, overhead_ms=10, cpu_seconds=0.01),
        ],
    )
    candidate = TargetResult(
        target=_identity("candidate"),
        environment=environment,
        blocks=[
            _block(target="candidate", pair_index=0, overhead_ms=13, cpu_seconds=0.012),
            _block(target="candidate", pair_index=1, overhead_ms=13, cpu_seconds=0.012),
        ],
    )

    report = build_comparison(
        baseline_result=baseline,
        candidate_result=candidate,
        scenario_ids=["scenario"],
    )

    scenario = report.scenarios[0]
    assert report.compatible is True
    assert report.overall_verdict == "possible_regression"
    assert scenario.workload_consistent is True
    assert scenario.create_run_http_p95_ms.baseline == 1
    assert scenario.p50_terminal_e2e_ms.relative_change_percent == pytest.approx(15)
    assert scenario.p50_runtime_overhead_ms.relative_change_percent == pytest.approx(30)
    assert scenario.p95_runtime_overhead_ms.verdict == "possible_regression"
    assert scenario.agent_cpu_seconds_per_successful_run.verdict == "possible_regression"
    assert scenario.redis_storage_bytes_per_successful_run.baseline == 60
    assert scenario.redis_command_mix["xadd"].baseline == 8
