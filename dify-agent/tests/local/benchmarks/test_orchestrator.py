from pathlib import Path

import pytest

from benchmarks.orchestrator import (
    RunOptions,
    _fake_dependency_cpu_saturated,
    _render_markdown,
    build_comparison,
)
from benchmarks.schemas import (
    BlockResult,
    ComponentIdentity,
    ComponentResourceSummary,
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
        profile="agent",
        captured_at="2026-07-29T00:00:00+00:00",
        os="Docker Desktop",
        architecture="arm64",
        kernel="test",
        cpu_model="test",
        docker_engine="29",
        docker_compose="5",
        docker_desktop="Docker Desktop",
        docker_cpus=8,
        docker_memory_bytes=8_000_000_000,
        compose_hash="compose",
        harness_hash="harness",
        redis_image="redis@sha256:test",
        redis_config_hash="redis-config",
        python_base_image_id="sha256:python",
        scenario_manifest_hash="manifest",
        resource_limits={"agent": "4 CPU/1 GiB"},
    )


def _identity(kind: TargetKind) -> TargetIdentity:
    return TargetIdentity(
        kind=kind,
        profile="agent",
        ref=kind,
        content_hash=kind,
        components={
            "agent": ComponentIdentity(
                name="agent",
                ref=kind,
                commit="a" * 40,
                dirty=False,
                content_hash=kind,
                lock_hash="lock",
                image_tag=f"image:{kind}",
                image_id=f"sha256:{kind}",
                runtime_version="Python 3.12.13",
            )
        },
    )


def _block(*, target: TargetKind, pair_index: int, overhead_ms: float, cpu_seconds: float) -> BlockResult:
    samples = [
        RunSample(
            profile="agent",
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
            cleanup_valid=True,
        )
        for index in range(8)
    ]
    return BlockResult(
        profile="agent",
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
            successful_operations_per_second=100,
            service_time_mean_ms=overhead_ms + 10,
            events_per_successful_run=10,
            max_active_runs=1,
        ),
        redis_before=RedisSnapshot(),
        redis_after=RedisSnapshot(),
        resources=ResourceSummary(
            components={
                "agent": ComponentResourceSummary(
                    cpu_seconds_per_successful_operation=cpu_seconds,
                    peak_memory_delta_bytes=100,
                    memory_gb_seconds_per_successful_operation=0.001,
                    network_bytes_per_successful_operation=50,
                    stats_coverage=StatsCoverage(
                        sample_count=10,
                        in_window_sample_count=8,
                        window_covered=True,
                    ),
                ),
                "redis": ComponentResourceSummary(
                    cpu_seconds_per_successful_operation=0.002,
                    memory_gb_seconds_per_successful_operation=0.0005,
                    stats_coverage=StatsCoverage(
                        sample_count=10,
                        in_window_sample_count=8,
                        window_covered=True,
                    ),
                ),
            },
            total_cpu_seconds_per_successful_operation=cpu_seconds,
            total_memory_gb_seconds_per_successful_operation=0.001,
            redis_commands_per_successful_run=10,
            redis_command_calls_per_successful_run={"xadd": 8, "set": 2},
            redis_storage_bytes_per_successful_run=60,
        ),
        samples=samples,
        cleanup={"runtime_state_empty": True},
        valid=True,
    )


def test_build_comparison_preserves_workload_and_resource_metrics() -> None:
    environment = _environment()
    baseline = TargetResult(
        profile="agent",
        target=_identity("baseline"),
        environment=environment,
        blocks=[
            _block(target="baseline", pair_index=0, overhead_ms=10, cpu_seconds=0.01),
            _block(target="baseline", pair_index=1, overhead_ms=10, cpu_seconds=0.01),
        ],
    )
    candidate = TargetResult(
        profile="agent",
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
    assert scenario.service_time_mean_ms.relative_change_percent == pytest.approx(15)
    assert scenario.start_delay_p95_ms.baseline == 5
    assert scenario.runtime_overhead_p95_ms.relative_change_percent == pytest.approx(30)
    assert scenario.runtime_overhead_p95_ms.verdict == "possible_regression"
    assert scenario.component_cpu_seconds_per_successful_operation["agent"].verdict == "possible_regression"
    assert scenario.total_memory_gb_seconds_per_successful_operation.baseline == 0.001
    assert scenario.redis_command_mix["xadd"].baseline == 8


def test_markdown_redis_section_only_expands_changed_commands() -> None:
    environment = _environment()
    baseline_blocks = [
        _block(target="baseline", pair_index=0, overhead_ms=10, cpu_seconds=0.01),
        _block(target="baseline", pair_index=1, overhead_ms=10, cpu_seconds=0.01),
    ]
    candidate_blocks = [
        _block(target="candidate", pair_index=0, overhead_ms=10, cpu_seconds=0.01),
        _block(target="candidate", pair_index=1, overhead_ms=10, cpu_seconds=0.01),
    ]
    for block in candidate_blocks:
        block.resources.redis_commands_per_successful_run = 11
        block.resources.redis_command_calls_per_successful_run["xadd"] = 9
    report = build_comparison(
        baseline_result=TargetResult(
            profile="agent",
            target=_identity("baseline"),
            environment=environment,
            blocks=baseline_blocks,
        ),
        candidate_result=TargetResult(
            profile="agent",
            target=_identity("candidate"),
            environment=environment,
            blocks=candidate_blocks,
        ),
        scenario_ids=["scenario"],
    )

    markdown = _render_markdown(report)
    assert "## Diagnostics" in markdown
    assert "Redis command mix" in markdown
    assert "`xadd`" not in markdown
    assert "comparison.json" in markdown


def test_same_content_comparison_downgrades_measured_deltas_to_noise() -> None:
    environment = _environment()
    baseline_identity = _identity("baseline")
    candidate_identity = _identity("candidate")
    candidate_identity.content_hash = baseline_identity.content_hash
    candidate_identity.components["agent"].content_hash = baseline_identity.components["agent"].content_hash
    report = build_comparison(
        baseline_result=TargetResult(
            profile="agent",
            target=baseline_identity,
            environment=environment,
            blocks=[
                _block(target="baseline", pair_index=0, overhead_ms=10, cpu_seconds=0.01),
                _block(target="baseline", pair_index=1, overhead_ms=10, cpu_seconds=0.01),
            ],
        ),
        candidate_result=TargetResult(
            profile="agent",
            target=candidate_identity,
            environment=environment,
            blocks=[
                _block(target="candidate", pair_index=0, overhead_ms=13, cpu_seconds=0.012),
                _block(target="candidate", pair_index=1, overhead_ms=13, cpu_seconds=0.012),
            ],
        ),
        scenario_ids=["scenario"],
    )

    assert report.overall_verdict == "inconclusive"
    assert report.scenarios[0].runtime_overhead_p95_ms.verdict == "inconclusive"
    assert report.scenarios[0].total_cpu_seconds_per_successful_operation.verdict == "inconclusive"


def test_component_pins_are_capability_only_and_mutually_exclusive() -> None:
    with pytest.raises(ValueError, match="only for the capability"):
        RunOptions(
            profile="runtime",
            baseline_ref="HEAD",
            candidate_ref=None,
            pin_agent_ref="agent-ref",
            pin_runtime_ref=None,
            keep_containers=False,
            quick=True,
            scenario_ids=(),
            results_root=Path("results"),
        )
    with pytest.raises(ValueError, match="cannot be used together"):
        RunOptions(
            profile="capability",
            baseline_ref="HEAD",
            candidate_ref=None,
            pin_agent_ref="agent-ref",
            pin_runtime_ref="runtime-ref",
            keep_containers=False,
            quick=True,
            scenario_ids=(),
            results_root=Path("results"),
        )


def test_fake_dependency_cpu_gate_requires_sustained_sampling() -> None:
    transient = ResourceSummary(
        components={
            "fake-deps": ComponentResourceSummary(
                stats_coverage=StatsCoverage(
                    sample_count=20,
                    in_window_sample_count=2,
                    window_covered=True,
                )
            )
        },
        fake_cpu_p95_percent=75,
    )
    sustained = transient.model_copy(deep=True)
    sustained.components["fake-deps"].stats_coverage.in_window_sample_count = 10

    assert _fake_dependency_cpu_saturated(transient) is False
    assert _fake_dependency_cpu_saturated(sustained) is True
