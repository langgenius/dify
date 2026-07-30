from benchmarks.capacity import (
    CapacityPoint,
    CapacityProfile,
    CapacityStatus,
    E2BLifecycleSample,
    LatencySummary,
    aggregate_e2b_lifecycle_point,
    aggregate_local_capacity_point,
    build_e2b_service_capacity_matrix,
    build_local_capacity_matrix,
    build_quota_recommendation,
    build_unit_consumption,
    enrich_e2b_service_point,
    render_capacity_markdown,
)
from benchmarks.schemas import (
    BlockResult,
    ComponentResourceSummary,
    ResourceSummary,
    RunOutcomeSummary,
    RunSample,
)


def _point(
    *,
    profile: CapacityProfile,
    scenario_id: str,
    concurrency: int,
    status: CapacityStatus = "validated",
    operations_per_second: float = 10,
) -> CapacityPoint:
    return CapacityPoint(
        profile=profile,
        scenario_id=scenario_id,
        requested_concurrency=concurrency,
        observed_max_active=concurrency,
        block_count=3,
        sample_count=300,
        attempted_operations=300,
        successful_operations=300,
        terminal_operations=300,
        success_rate=1,
        timeout_rate=0,
        throttle_rate=0,
        operations_per_second=operations_per_second,
        create_http_ms=LatencySummary(p50=1, p95=2, p99=3),
        first_event_ms=LatencySummary(p50=4, p95=5, p99=6),
        terminal_e2e_ms=LatencySummary(p50=10, p95=11, p99=12),
        agent_cpu_seconds_per_operation=0.02,
        agent_memory_gb_seconds_per_operation=0.003,
        agent_peak_memory_bytes=10_000,
        redis_commands_per_operation=12,
        redis_storage_bytes_per_operation=100,
        redis_network_bytes_per_operation=200,
        agent_network_bytes_per_operation=300,
        useful_payload_mib_per_second=None,
        e2b_active_window_seconds_per_operation=0.5 if profile == "e2b" else None,
        e2b_create_calls_per_operation=1 if scenario_id == "e2b_binding_create_pause" else 0,
        e2b_resume_calls_per_operation=1 if profile == "e2b" else 0,
        e2b_transfer_bytes_per_operation=1024 if profile == "e2b" else 0,
        reference_valid=True,
        status=status,
    )


def test_local_capacity_matrix_contains_six_workloads_at_four_concurrency_levels() -> None:
    matrix = build_local_capacity_matrix()

    assert len(matrix) == 24
    assert {point.requested_concurrency for point in matrix} == {1, 5, 10, 20}
    assert {point.profile for point in matrix} == {"agent", "capability"}
    assert len({point.workload for point in matrix}) == 6


def test_e2b_service_matrix_keeps_lifecycle_create_as_a_separate_probe() -> None:
    matrix = build_e2b_service_capacity_matrix()

    assert len(matrix) == 20
    assert {point.requested_concurrency for point in matrix} == {1, 5, 10, 20}
    assert all(point.profile == "e2b" for point in matrix)
    assert all("binding_create_pause" not in point.scenario_id for point in matrix)


def test_unit_consumption_normalizes_per_operation_metrics_to_one_thousand_runs() -> None:
    point = _point(profile="e2b", scenario_id="e2b_binding_create_pause", concurrency=10)

    units = build_unit_consumption([point])

    assert len(units) == 1
    unit = units[0]
    assert unit.agent_vcpu_seconds_per_1000_runs == 20
    assert unit.agent_gb_seconds_per_1000_runs == 3
    assert unit.redis_commands_per_1000_runs == 12_000
    assert unit.redis_network_gib_per_1000_runs == 200_000 / (1024**3)
    assert unit.agent_network_gib_per_1000_runs == 300_000 / (1024**3)
    assert unit.e2b_active_seconds_per_1000_runs == 500
    assert unit.e2b_create_calls_per_1000_runs == 1000
    assert unit.e2b_resume_calls_per_1000_runs == 1000
    assert unit.e2b_transfer_gib_per_1000_runs == 1024_000 / (1024**3)
    assert unit.e2b_inventory_units_per_1000_bindings == 1000


def test_capacity_report_exposes_curve_lifecycle_units_and_quota_parameters() -> None:
    local = [_point(profile="agent", scenario_id="basic_c1", concurrency=1)]
    e2b = [
        _point(
            profile="e2b",
            scenario_id="e2b_binding_create_pause_c1",
            concurrency=1,
        )
    ]
    e2b[0].workload = "binding_create_pause"
    e2b[0].e2b_create_pause_ms = LatencySummary(p50=100, p95=120, p99=140)
    quota = build_quota_recommendation(
        local_points=local,
        e2b_points=e2b,
        e2b_max_concurrency=2,
        e2b_max_inventory=1000,
        pilot_tenant_count=1,
    )

    report = render_capacity_markdown(
        target_ref="1.16.1",
        local_points=local,
        e2b_points=e2b,
        quota=quota,
    )

    assert "E2B lifecycle p95" in report
    assert "Unit consumption per 1,000 successful Runs" in report
    assert "Global Active Run / E2B concurrency" in report
    assert "vendor billed time" in report


def test_quota_uses_half_of_the_lowest_fully_validated_capacity() -> None:
    local = [
        _point(profile="agent", scenario_id=scenario, concurrency=concurrency)
        for scenario in ("basic", "shell")
        for concurrency in (1, 5, 10, 20)
    ]
    e2b = [
        _point(
            profile="e2b",
            scenario_id=scenario,
            concurrency=concurrency,
            status="saturated" if scenario == "file" and concurrency == 20 else "validated",
        )
        for scenario in ("resume", "file")
        for concurrency in (1, 5, 10, 20)
    ]

    recommendation = build_quota_recommendation(
        local_points=local,
        e2b_points=e2b,
        e2b_max_concurrency=50,
        e2b_max_inventory=10_000,
        pilot_tenant_count=5,
    )

    assert recommendation.reference_valid is True
    assert recommendation.local_stable_concurrency == 20
    assert recommendation.e2b_stable_concurrency == 10
    assert recommendation.launch_global_concurrency == 5
    assert recommendation.launch_tenant_concurrency == 1
    assert recommendation.global_binding_quota == 5000
    assert recommendation.tenant_binding_quota == 1000
    assert recommendation.status == "recommended"


def test_quota_rejects_quick_or_smoke_reference_points() -> None:
    local = [_point(profile="agent", scenario_id="basic", concurrency=1)]
    e2b = [_point(profile="e2b", scenario_id="resume", concurrency=1)]
    e2b[0].reference_valid = False

    recommendation = build_quota_recommendation(
        local_points=local,
        e2b_points=e2b,
        e2b_max_concurrency=20,
        e2b_max_inventory=1000,
        pilot_tenant_count=2,
    )

    assert recommendation.reference_valid is False
    assert recommendation.status == "no_launch_recommendation"
    assert recommendation.launch_global_concurrency is None
    assert "quick or smoke" in " ".join(recommendation.reasons)


def test_stable_concurrency_requires_all_lower_levels_to_be_validated() -> None:
    local = [
        _point(
            profile="agent",
            scenario_id="basic",
            concurrency=concurrency,
            status="saturated" if concurrency == 5 else "validated",
        )
        for concurrency in (1, 5, 10, 20)
    ]
    e2b = [_point(profile="e2b", scenario_id="resume", concurrency=concurrency) for concurrency in (1, 5, 10, 20)]

    recommendation = build_quota_recommendation(
        local_points=local,
        e2b_points=e2b,
        e2b_max_concurrency=20,
        e2b_max_inventory=1000,
        pilot_tenant_count=2,
    )

    assert recommendation.local_stable_concurrency == 1
    assert recommendation.status == "no_launch_recommendation"
    assert recommendation.launch_global_concurrency is None


def test_stable_concurrency_groups_capacity_scenario_suffixes() -> None:
    local = [
        _point(
            profile="agent",
            scenario_id=f"basic_c{concurrency}",
            concurrency=concurrency,
        )
        for concurrency in (1, 5, 10, 20)
    ]
    e2b = [
        _point(
            profile="e2b",
            scenario_id=f"e2b_shell_c{concurrency}",
            concurrency=concurrency,
        )
        for concurrency in (1, 5, 10, 20)
    ]

    recommendation = build_quota_recommendation(
        local_points=local,
        e2b_points=e2b,
        e2b_max_concurrency=20,
        e2b_max_inventory=1000,
        pilot_tenant_count=2,
    )

    assert recommendation.local_stable_concurrency == 20
    assert recommendation.e2b_stable_concurrency == 20
    assert recommendation.launch_global_concurrency == 10


def _block(*, index: int, concurrency: int, successful: int = 100) -> BlockResult:
    samples = [
        RunSample(
            profile="agent",
            target="candidate",
            scenario_id=f"basic_c{concurrency}",
            block_id=f"block-{index}",
            pair_index=index,
            benchmark_run_id=f"run-{index}-{sample_index}",
            admitted=True,
            create_run_http_ms=1 + sample_index / 100,
            time_to_first_event_ms=2 + sample_index / 100,
            terminal_e2e_ms=10 + sample_index / 100,
            terminal_status="succeeded",
            ledger_valid=True,
            event_replay_valid=True,
            cleanup_valid=True,
        )
        for sample_index in range(successful)
    ]
    return BlockResult(
        profile="agent",
        target="candidate",
        target_id="target",
        scenario_id=f"basic_c{concurrency}",
        scenario_version=1,
        block_id=f"block-{index}",
        pair_index=index,
        measurement_started_at_ns=index * 1_000_000_000,
        measurement_ended_at_ns=(index + 60) * 1_000_000_000,
        outcomes=RunOutcomeSummary(
            attempted_runs=successful,
            admitted_runs=successful,
            terminal_runs=successful,
            successful_runs=successful,
            admission_rate=1,
            terminal_rate=1,
            success_rate=1,
            terminal_runs_per_second=successful / 60,
            successful_runs_per_second=successful / 60,
            successful_operations_per_second=successful / 60,
            service_time_mean_ms=10,
            max_active_runs=concurrency,
        ),
        resources=ResourceSummary(
            components={
                "agent": ComponentResourceSummary(
                    cpu_seconds_per_successful_operation=0.02,
                    peak_memory_delta_bytes=1000 + index,
                    memory_gb_seconds_per_successful_operation=0.003,
                    network_bytes_per_successful_operation=300,
                ),
                "redis": ComponentResourceSummary(network_bytes_per_successful_operation=200),
            },
            redis_commands_per_successful_run=12,
            redis_storage_bytes_per_successful_run=100,
        ),
        samples=samples,
        cleanup={"runtime_state_empty": True},
        valid=True,
    )


def test_local_capacity_aggregation_requires_real_concurrency_and_sample_coverage() -> None:
    point = aggregate_local_capacity_point(
        profile="agent",
        scenario_id="basic_c10",
        requested_concurrency=10,
        blocks=[_block(index=index, concurrency=10) for index in range(3)],
        reference_valid=True,
    )

    assert point.status == "validated"
    assert point.sample_count == 300
    assert point.observed_max_active == 10
    assert point.operations_per_second == 300 / 180
    assert point.terminal_e2e_ms.p95 is not None
    assert point.agent_cpu_seconds_per_operation == 0.02
    assert point.agent_peak_memory_bytes == 1002


def test_local_capacity_aggregation_reports_high_concurrency_shortfall_as_saturation() -> None:
    point = aggregate_local_capacity_point(
        profile="agent",
        scenario_id="basic_c20",
        requested_concurrency=20,
        blocks=[_block(index=index, concurrency=2) for index in range(3)],
        reference_valid=True,
    )

    assert point.status == "saturated"
    assert "below 90%" in " ".join(point.reasons)


def test_quick_capacity_is_correct_but_never_reference_evidence() -> None:
    local = aggregate_local_capacity_point(
        profile="agent",
        scenario_id="basic_c1",
        requested_concurrency=1,
        blocks=[_block(index=0, concurrency=1, successful=2)],
        reference_valid=False,
        expected_blocks=1,
        minimum_samples=2,
    )
    lifecycle_sample = E2BLifecycleSample(
        block_id="quick",
        worker_index=0,
        wave_index=0,
        create_pause_ms=1,
        connect_acquire_ms=1,
        first_output_ms=1,
        release_pause_ms=1,
        destroy_kill_ms=1,
        active_window_seconds=0.001,
        success=True,
    )
    e2b = aggregate_e2b_lifecycle_point(
        requested_concurrency=1,
        samples=[lifecycle_sample],
        block_count=1,
        elapsed_seconds=1,
        observed_max_active=1,
        reference_valid=False,
        expected_blocks=1,
        waves_per_block=1,
    )

    assert local.status == "non_reference"
    assert e2b.status == "non_reference"


def test_e2b_warm_binding_units_exclude_pool_setup_and_count_file_transfer_both_ways() -> None:
    blocks = [_block(index=0, concurrency=5, successful=100)]
    for sample in blocks[0].samples:
        sample.profile = "e2b"
        sample.payload_bytes = 16 * 1024 * 1024
    point = aggregate_local_capacity_point(
        profile="e2b",
        scenario_id="e2b_file_roundtrip_16m_c5",
        requested_concurrency=5,
        blocks=blocks,
        reference_valid=True,
        expected_blocks=1,
        minimum_samples=100,
    )

    enriched = enrich_e2b_service_point(
        point,
        workload="file_roundtrip_16m",
        blocks=blocks,
    )

    assert enriched.e2b_create_calls_per_operation == 0
    assert enriched.e2b_resume_calls_per_operation == 1
    assert enriched.e2b_pause_calls_per_operation == 1
    assert enriched.e2b_kill_calls_per_operation == 0
    assert enriched.e2b_transfer_bytes_per_operation == 32 * 1024 * 1024


def test_e2b_lifecycle_point_requires_two_clean_five_wave_blocks() -> None:
    samples = [
        E2BLifecycleSample(
            block_id=f"block-{block}",
            worker_index=worker,
            wave_index=wave,
            create_pause_ms=100,
            connect_acquire_ms=50,
            first_output_ms=10,
            release_pause_ms=20,
            destroy_kill_ms=30,
            active_window_seconds=0.08,
            success=True,
        )
        for block in range(2)
        for wave in range(5)
        for worker in range(5)
    ]

    point = aggregate_e2b_lifecycle_point(
        requested_concurrency=5,
        samples=samples,
        block_count=2,
        elapsed_seconds=10,
        observed_max_active=5,
        reference_valid=True,
    )

    assert point.status == "validated"
    assert point.sample_count == 50
    assert point.operations_per_second == 5
    assert point.e2b_create_pause_ms.p95 == 100
    assert point.e2b_active_window_seconds_per_operation == 0.08
