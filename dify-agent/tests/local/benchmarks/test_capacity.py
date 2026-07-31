from benchmarks.capacity import (
    aggregate_capacity_point,
    build_capacity_matrix,
    render_capacity_markdown,
)
from benchmarks.scenario import BenchmarkMode, CapacityWorkload, load_scenario_manifest
from benchmarks.schemas import (
    BlockResult,
    CapacityResult,
    ComponentResourceSummary,
    EnvironmentFingerprint,
    RedisSnapshot,
    ResourceSummary,
    RunOutcomeSummary,
    RunSample,
    StatsCoverage,
    TargetIdentity,
)


def _block(
    *,
    mode: BenchmarkMode = "local-runtime",
    scenario_id: str = "shell",
    workload: CapacityWorkload = "shell",
    concurrency: int = 10,
    successful: int = 100,
    observed_active: int = 10,
    active_seconds: float | None = None,
) -> BlockResult:
    sample = RunSample(
        mode=mode,
        scenario_id=scenario_id,
        block_id="block",
        benchmark_run_id="run",
        worker_index=0,
        run_id="run-id",
        admitted=True,
        terminal_e2e_ms=20,
        e2b_active_seconds=active_seconds,
        terminal_status="succeeded",
        ledger_valid=True,
        event_replay_valid=True,
        cleanup_valid=True,
    )
    resources = ResourceSummary(
        components={
            "agent": ComponentResourceSummary(
                cpu_ms_per_run=4.5,
                memory_peak_mib=123,
                network_bytes_per_run=2500,
                stats_coverage=StatsCoverage(window_covered=True),
            )
        },
        redis_commands_per_run=66,
    )
    return BlockResult(
        mode=mode,
        scenario_id=scenario_id,
        scenario_version=1,
        workload=workload,
        requested_concurrency=concurrency,
        block_id="block",
        measurement_started_at_ns=1,
        measurement_ended_at_ns=2,
        elapsed_seconds=10,
        minimum_successful_runs=100,
        outcomes=RunOutcomeSummary(
            attempted_runs=successful,
            admitted_runs=successful,
            terminal_runs=successful,
            successful_runs=successful,
            success_rate=1,
            runs_per_second=10,
            observed_max_active=observed_active,
        ),
        redis_before=RedisSnapshot(total_net_input_bytes=100, total_net_output_bytes=200),
        redis_after=RedisSnapshot(
            total_net_input_bytes=100 + successful * 1000,
            total_net_output_bytes=200 + successful * 2000,
        ),
        resources=resources,
        samples=[sample.model_copy(deep=True) for _ in range(successful)],
        cleanup={"jobs_empty": True, "bindings_destroyed": True},
        valid=True,
    )


def test_each_mode_expands_five_scenarios_at_three_concurrency_levels() -> None:
    manifest = load_scenario_manifest()

    runtime = build_capacity_matrix(mode="local-runtime", manifest=manifest)
    e2b = build_capacity_matrix(mode="local-e2b", manifest=manifest)

    assert len(runtime) == len(e2b) == 15
    assert {point.requested_concurrency for point in runtime} == {1, 10, 20}
    assert next(point for point in runtime if point.scenario.id == "file").minimum_successful_runs == 10


def test_aggregate_uses_friendly_per_run_units() -> None:
    point = aggregate_capacity_point(_block())

    assert point.status == "valid"
    assert point.agent_cpu_ms_per_run == 4.5
    assert point.agent_memory_peak_mib == 123
    assert point.redis_commands_per_run == 66
    assert point.agent_network_kb_per_run == 2.5
    assert point.redis_network_kb_per_run == 3
    assert point.terminal_p95_ms == 20


def test_high_concurrency_shortfall_is_saturated() -> None:
    point = aggregate_capacity_point(_block(successful=20, observed_active=5))

    assert point.status == "saturated"
    assert any("required" in reason for reason in point.reasons)


def test_missing_e2b_active_window_is_invalid() -> None:
    point = aggregate_capacity_point(_block(mode="local-e2b", active_seconds=None))

    assert point.status == "invalid"
    assert any("E2B active-window" in reason for reason in point.reasons)


def test_report_has_no_quota_or_binding_outputs() -> None:
    block = _block()
    result = CapacityResult(
        mode="local-runtime",
        matrix_complete=False,
        agent_capacity_unit={"cpu_cores": 2.0, "memory_mib": 2048, "workers": 1},
        target=TargetIdentity(
            commit="abc",
            dirty=True,
            content_hash="hash",
            agent_image_id="sha256:agent",
        ),
        environment=EnvironmentFingerprint(
            captured_at="now",
            os="Docker",
            architecture="arm64",
            kernel="kernel",
            cpu_model="cpu",
            docker_engine="engine",
            docker_compose="compose",
            docker_cpus=8,
            docker_memory_bytes=8,
            compose_hash="compose",
            harness_hash="harness",
            scenario_manifest_hash="manifest",
            redis_image="redis",
            resource_limits={"agent": "2 CPU/2 GiB"},
        ),
        points=[aggregate_capacity_point(block)],
    )

    report = render_capacity_markdown(result)

    assert "2 vCPU / 2 GiB" in report
    assert "CPU-ms/run" in report
    assert "Memory peak MiB" in report
    assert "quota recommendation" not in report.lower()
    assert "binding stock" not in report.lower()
