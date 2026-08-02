import json
import math
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from benchmarks.cost import (
    CostInputV1,
    SCENARIO_IDS,
    ScenarioId,
    calculate_cost_result,
    main,
    render_cost_report,
)
from benchmarks.scenario import BenchmarkMode
from benchmarks.schemas import (
    BlockResult,
    CapacityPoint,
    CapacityResult,
    CapacityStatus,
    EnvironmentFingerprint,
    RedisSnapshot,
    RunOutcomeSummary,
    RunSample,
    TargetIdentity,
)


def _point(
    scenario_id: ScenarioId,
    *,
    mode: BenchmarkMode = "local-e2b",
    concurrency: int = 1,
    runs_per_second: float = 10,
    status: CapacityStatus = "valid",
    successful_runs: int = 2,
    redis_commands_per_run: float = 5,
    redis_network_kb_per_run: float = 2,
    agent_network_kb_per_run: float = 4,
) -> CapacityPoint:
    return CapacityPoint(
        mode=mode,
        scenario_id=scenario_id,
        workload=scenario_id,
        requested_concurrency=concurrency,
        observed_max_active=concurrency,
        attempted_runs=successful_runs,
        successful_runs=successful_runs,
        timeout_runs=0,
        throttle_runs=0,
        success_rate=1,
        terminal_p95_ms=25,
        runs_per_second=runs_per_second,
        agent_cpu_ms_per_run=10,
        agent_memory_peak_mib=128,
        redis_commands_per_run=redis_commands_per_run,
        redis_network_kb_per_run=redis_network_kb_per_run,
        agent_network_kb_per_run=agent_network_kb_per_run,
        status=status,
        reasons=["product error"] if status == "invalid" else [],
    )


def _capacity_result(mode: BenchmarkMode, points: list[CapacityPoint]) -> CapacityResult:
    return CapacityResult(
        mode=mode,
        matrix_complete=True,
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
            docker_memory_bytes=8 * 1024**3,
            compose_hash="compose",
            harness_hash="harness",
            scenario_manifest_hash="manifest",
            redis_image="redis",
            resource_limits={"agent": "2 CPU/2 GiB"},
        ),
        points=points,
    )


def _write_capacity_artifacts(
    root: Path,
    *,
    mode: BenchmarkMode,
    points: list[CapacityPoint],
    active_seconds: dict[ScenarioId, list[float]] | None = None,
    e2b_vcpu_count: float | None = 2,
    e2b_memory_mib: float | None = 512,
    storage_bytes_per_run: float = 100,
) -> Path:
    capacity_path = root / "result.json"
    capacity_path.write_text(_capacity_result(mode, points).model_dump_json(indent=2))
    samples: list[RunSample] = []
    for point in points:
        if point.status != "valid":
            continue
        block_id = f"run-{point.scenario_id}-c{point.requested_concurrency}"
        scenario_active = (active_seconds or {}).get(
            cast(ScenarioId, point.scenario_id),
            [0.5] * point.successful_runs,
        )
        block_samples = [
            RunSample(
                mode=mode,
                scenario_id=point.scenario_id,
                block_id=block_id,
                benchmark_run_id=f"{block_id}-{index}",
                worker_index=index % point.requested_concurrency,
                run_id=f"run-{index}",
                admitted=True,
                terminal_e2e_ms=20,
                e2b_active_seconds=(
                    scenario_active[index]
                    if mode == "local-e2b" and point.scenario_id != "basic" and scenario_active
                    else None
                ),
                e2b_vcpu_count=(e2b_vcpu_count if mode == "local-e2b" and point.scenario_id != "basic" else None),
                e2b_memory_mib=(e2b_memory_mib if mode == "local-e2b" and point.scenario_id != "basic" else None),
                terminal_status="succeeded",
                ledger_valid=True,
                event_replay_valid=True,
                cleanup_valid=True,
            )
            for index in range(point.successful_runs)
        ]
        samples.extend(block_samples)
        block = BlockResult(
            mode=mode,
            scenario_id=point.scenario_id,
            scenario_version=1,
            workload=point.workload,
            requested_concurrency=point.requested_concurrency,
            block_id=block_id,
            measurement_started_at_ns=1,
            measurement_ended_at_ns=2,
            elapsed_seconds=1,
            outcomes=RunOutcomeSummary(
                attempted_runs=point.successful_runs,
                admitted_runs=point.successful_runs,
                terminal_runs=point.successful_runs,
                successful_runs=point.successful_runs,
                success_rate=1,
                runs_per_second=point.runs_per_second,
                observed_max_active=point.requested_concurrency,
            ),
            redis_before=RedisSnapshot(storage_bytes=100),
            redis_after=RedisSnapshot(storage_bytes=100 + int(storage_bytes_per_run * point.successful_runs)),
            samples=block_samples,
            valid=True,
        )
        block_dir = root / "blocks" / f"{point.scenario_id}-c{point.requested_concurrency}"
        block_dir.mkdir(parents=True)
        (block_dir / "block-result.json").write_text(block.model_dump_json(indent=2))
    with (root / "samples.jsonl").open("w") as output:
        for sample in samples:
            output.write(sample.model_dump_json() + "\n")
    return capacity_path


def _input(**updates: object) -> CostInputV1:
    values: dict[str, object] = {
        "monthly_runs": 1000,
        "peak_rps": 10,
        "e2b_plan": "hobby",
        "peak_running_sandboxes": 20,
        "include_fixed_plan_cost": True,
    }
    values.update(updates)
    return CostInputV1.model_validate(values)


def _five_points(*, mode: BenchmarkMode = "local-e2b") -> list[CapacityPoint]:
    return [_point(scenario_id, mode=mode) for scenario_id in SCENARIO_IDS]


def test_peak_and_usage_weights_must_each_cover_five_scenarios_and_sum_to_one() -> None:
    with pytest.raises(ValidationError, match="exactly basic"):
        _input(usage_weights={"basic": 1})

    with pytest.raises(ValidationError, match="sum to 1"):
        _input(peak_weights={scenario: 0.1 for scenario in SCENARIO_IDS})

    weights = {scenario: 0.2 for scenario in SCENARIO_IDS}
    cost_input = _input(usage_weights=weights, peak_weights=weights)
    assert cost_input.usage_weights == weights
    assert cost_input.peak_weights == weights


def test_cost_input_uses_the_official_e2b_pricing_snapshot() -> None:
    pricing = _input().e2b_pricing

    assert pricing.currency == "USD"
    assert pricing.cpu_usd_per_vcpu_second == pytest.approx(0.000014)
    assert pricing.memory_usd_per_gib_second == pytest.approx(0.0000045)
    assert pricing.hobby_monthly_base_usd == 0
    assert pricing.pro_monthly_base_usd == 150
    assert pricing.source_url == "https://e2b.dev/pricing"
    assert pricing.concurrency_addon_url == "https://e2b.dev/docs/faq/increase-concurrency"
    assert pricing.checked_at == "2026-08-02"

    payload = _input().model_dump()
    payload["e2b_price_per_billed_second"] = 1
    with pytest.raises(ValidationError, match="Extra inputs"):
        CostInputV1.model_validate(payload)

    payload = _input().model_dump()
    pricing_payload = cast(dict[str, object], payload["e2b_pricing"])
    pricing_payload["cpu_usd_per_vcpu_second"] = 1
    with pytest.raises(ValidationError, match="official E2B pricing snapshot"):
        CostInputV1.model_validate(payload)


def test_selects_fastest_valid_point_and_tie_uses_lower_concurrency(tmp_path: Path) -> None:
    points = _five_points()
    points.extend(
        [
            _point("basic", concurrency=10, runs_per_second=20),
            _point("basic", concurrency=20, runs_per_second=20),
            _point("shell", concurrency=20, runs_per_second=100, status="invalid"),
        ]
    )
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=points)

    result = calculate_cost_result(capacity_result_path=capacity_path, cost_input=_input())

    assert set(result.pure_scenarios) == set(SCENARIO_IDS)
    assert result.pure_scenarios["basic"].selected_concurrency == 10
    assert result.pure_scenarios["shell"].selected_concurrency == 1
    assert "1 invalid capacity point" in " ".join(result.pure_scenarios["shell"].warnings)


def test_known_historical_schema_v1_block_field_is_accepted(tmp_path: Path) -> None:
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=_five_points())
    block_path = tmp_path / "blocks" / "basic-c1" / "block-result.json"
    payload = json.loads(block_path.read_text())
    payload["minimum_successful_runs"] = 100
    block_path.write_text(json.dumps(payload))

    result = calculate_cost_result(capacity_result_path=capacity_path, cost_input=_input())

    assert result.pure_scenarios["basic"].status == "complete"


def test_unknown_historical_block_field_remains_invalid(tmp_path: Path) -> None:
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=_five_points())
    block_path = tmp_path / "blocks" / "basic-c1" / "block-result.json"
    payload = json.loads(block_path.read_text())
    payload["unknown_field"] = "not-compatible"
    block_path.write_text(json.dumps(payload))

    result = calculate_cost_result(capacity_result_path=capacity_path, cost_input=_input())

    basic = result.pure_scenarios["basic"]
    assert basic.status == "incomplete"
    assert "selected block artifact is invalid" in " ".join(basic.warnings)


def test_no_valid_point_is_incomplete_and_does_not_fabricate_capacity(tmp_path: Path) -> None:
    points = _five_points()
    points[1] = _point("shell", status="invalid")
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=points)

    result = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(e2b_plan="pro", peak_running_sandboxes=101),
    )

    shell = result.pure_scenarios["shell"]
    assert shell.status == "incomplete"
    assert shell.agent.capacity_runs_per_second is None
    assert shell.e2b.monthly_plan_base_cost == 150
    assert shell.e2b.monthly_concurrency_addon_cost == 500
    assert "c1 invalid excluded: product error" in shell.warnings
    assert not result.complete


def test_invalid_point_diagnostics_are_single_line_and_bounded(tmp_path: Path) -> None:
    points = _five_points()
    points[1] = _point("shell", status="invalid")
    points[1].reasons = ["driver failed\n" + "trace " * 100]
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=points)

    result = calculate_cost_result(capacity_result_path=capacity_path, cost_input=_input())

    warning = next(item for item in result.pure_scenarios["shell"].warnings if item.startswith("c1 invalid"))
    assert "\n" not in warning
    assert len(warning) < 400


def test_e2b_uses_official_cpu_and_memory_resource_second_pricing_without_rounding(tmp_path: Path) -> None:
    points = _five_points(mode="local-e2b")
    active = {scenario: [0, 1.1] for scenario in SCENARIO_IDS if scenario != "basic"}
    capacity_path = _write_capacity_artifacts(
        tmp_path,
        mode="local-e2b",
        points=points,
        active_seconds=cast(dict[ScenarioId, list[float]], active),
    )
    result = calculate_cost_result(capacity_result_path=capacity_path, cost_input=_input())

    assert result.pure_scenarios["basic"].e2b.status == "not_applicable"
    shell = result.pure_scenarios["shell"].e2b
    assert shell.status == "calculated"
    assert shell.running_seconds_per_run == pytest.approx(0.55)
    assert shell.vcpu_seconds_per_run == pytest.approx(1.1)
    assert shell.memory_gib_seconds_per_run == pytest.approx(0.275)
    expected_per_run = 1.1 * 0.000014 + 0.275 * 0.0000045
    assert shell.usage_cost_per_run == pytest.approx(expected_per_run)
    assert shell.monthly_running_seconds == pytest.approx(550)
    assert shell.monthly_usage_cost == pytest.approx(expected_per_run * 1000)
    assert shell.monthly_cost == pytest.approx(expected_per_run * 1000)


def test_local_runtime_is_validation_only_and_rejected_by_cost_model(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    points = _five_points(mode="local-runtime")
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-runtime", points=points)
    input_path = tmp_path / "input.json"
    input_path.write_text(_input().model_dump_json())
    output_dir = tmp_path / "must-not-exist"

    assert (
        main(
            [
                "--capacity-result",
                str(capacity_path),
                "--cost-input",
                str(input_path),
                "--output-dir",
                str(output_dir),
            ]
        )
        == 2
    )
    assert "local-runtime is validation-only" in capsys.readouterr().err
    assert not output_dir.exists()


def test_missing_e2b_resource_evidence_only_invalidates_e2b_component(tmp_path: Path) -> None:
    active = {scenario: [0.5, 0.75] for scenario in SCENARIO_IDS if scenario != "basic"}
    capacity_path = _write_capacity_artifacts(
        tmp_path,
        mode="local-e2b",
        points=_five_points(mode="local-e2b"),
        active_seconds=cast(dict[ScenarioId, list[float]], active),
        e2b_memory_mib=None,
    )

    shell = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(e2b_plan="pro", peak_running_sandboxes=101),
    ).pure_scenarios["shell"]

    assert shell.status == "incomplete"
    assert shell.agent.status == "calculated"
    assert shell.e2b.status == "incomplete"
    assert shell.e2b.running_seconds_per_run == pytest.approx(0.625)
    assert shell.e2b.memory_gib_seconds_per_run is None
    assert shell.e2b.monthly_plan_base_cost == 150
    assert shell.e2b.monthly_concurrency_addon_cost == 500


def test_agent_capacity_and_total_use_selected_block_evidence(tmp_path: Path) -> None:
    capacity_path = _write_capacity_artifacts(
        tmp_path,
        mode="local-e2b",
        points=_five_points(),
        storage_bytes_per_run=100,
    )

    result = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(),
    )

    basic = result.pure_scenarios["basic"]
    assert basic.agent.acu == 1
    assert basic.total_monthly_cost == 0
    shell = result.pure_scenarios["shell"]
    assert shell.total_monthly_cost == shell.e2b.monthly_cost


def test_official_hobby_and_pro_fixed_costs_are_explicit(tmp_path: Path) -> None:
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=_five_points())

    hobby = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(),
    ).pure_scenarios["shell"]
    pro = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(e2b_plan="pro", peak_running_sandboxes=101),
    ).pure_scenarios["shell"]

    assert hobby.e2b.monthly_plan_base_cost == 0
    assert hobby.e2b.monthly_concurrency_addon_cost == 0
    assert hobby.e2b.monthly_cost == hobby.e2b.monthly_usage_cost
    assert pro.e2b.monthly_plan_base_cost == 150
    assert pro.e2b.monthly_concurrency_addon_cost == 500
    assert pro.e2b.monthly_cost == pytest.approx(cast(float, pro.e2b.monthly_usage_cost) + 650)


def test_fixed_plan_cost_can_be_excluded_for_incremental_cost(tmp_path: Path) -> None:
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=_five_points())
    estimate = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(
            e2b_plan="pro",
            peak_running_sandboxes=101,
            include_fixed_plan_cost=False,
        ),
    ).pure_scenarios["shell"]

    assert estimate.e2b.monthly_plan_base_cost == 150
    assert estimate.e2b.monthly_concurrency_addon_cost == 500
    assert estimate.e2b.fixed_cost_included is False
    assert estimate.e2b.monthly_cost == estimate.e2b.monthly_usage_cost
    assert estimate.total_monthly_cost == estimate.e2b.monthly_usage_cost


def test_plan_concurrency_limits_are_validated() -> None:
    with pytest.raises(ValidationError, match="Hobby supports at most 20"):
        _input(peak_running_sandboxes=21)
    with pytest.raises(ValidationError, match="Pro supports at most 1100"):
        _input(e2b_plan="pro", peak_running_sandboxes=1101)


def test_peak_and_usage_weights_produce_separate_weighted_result(tmp_path: Path) -> None:
    points = [
        _point(scenario_id, runs_per_second=float(10 * (index + 1))) for index, scenario_id in enumerate(SCENARIO_IDS)
    ]
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=points)
    weights = cast(dict[ScenarioId, float], {scenario: 0.2 for scenario in SCENARIO_IDS})

    result = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(peak_rps=25, peak_weights=weights, usage_weights=weights),
    )

    assert result.weighted is not None
    expected = 1 / sum(0.2 / point.runs_per_second for point in points)
    assert result.weighted.agent.capacity_runs_per_second == pytest.approx(expected)
    assert result.weighted.selected_concurrency is None
    assert result.weighted.agent_memory_peak_mib is None
    assert result.cost_envelope is not None
    assert result.cost_envelope.best_scenario == "basic"
    assert result.cost_envelope.worst_scenario == "shell"
    assert result.cost_envelope.worst_to_best_ratio is None


def test_missing_weight_group_only_invalidates_its_weighted_dimensions(tmp_path: Path) -> None:
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=_five_points())
    weights = cast(dict[ScenarioId, float], {scenario: 0.2 for scenario in SCENARIO_IDS})

    peak_only = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(peak_weights=weights),
    ).weighted
    usage_only = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(usage_weights=weights),
    ).weighted

    assert peak_only is not None
    assert peak_only.agent.status == "calculated"
    assert peak_only.e2b.status == "incomplete"
    assert usage_only is not None
    assert usage_only.agent.status == "incomplete"
    assert usage_only.e2b.status == "calculated"


def test_zero_weight_scenario_without_valid_point_does_not_block_weighted_result(tmp_path: Path) -> None:
    points = _five_points()
    points[1] = _point("shell", status="invalid")
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=points)
    weights = cast(
        dict[ScenarioId, float],
        {"basic": 1, "shell": 0, "resume": 0, "config": 0, "file": 0},
    )

    result = calculate_cost_result(
        capacity_result_path=capacity_path,
        cost_input=_input(peak_weights=weights, usage_weights=weights),
    )

    assert result.pure_scenarios["shell"].status == "incomplete"
    assert result.weighted is not None
    assert result.weighted.status == "complete"
    assert result.cost_envelope is None


def test_cli_writes_three_artifacts_without_kubernetes_equivalents(tmp_path: Path) -> None:
    points = _five_points()
    points[0] = _point("basic", runs_per_second=1.23456789)
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=points)
    input_path = tmp_path / "input-source.json"
    input_path.write_text(_input().model_dump_json(indent=2))
    output_dir = tmp_path / "cost-output"

    assert (
        main(
            [
                "--capacity-result",
                str(capacity_path),
                "--cost-input",
                str(input_path),
                "--output-dir",
                str(output_dir),
            ]
        )
        == 0
    )

    for name in ("cost-input.json", "cost-result.json", "cost-report.md"):
        assert (output_dir / name).is_file()
    serialized = json.loads((output_dir / "cost-result.json").read_text())
    keys = json.dumps(serialized).lower()
    report = (output_dir / "cost-report.md").read_text()
    assert "pod" not in keys
    assert "node" not in keys
    assert "kubernetes" not in keys
    assert serialized["source"]["commit"] == "abc"
    assert serialized["demand"]["monthly_runs"] == 1000
    assert "| ACU |" in report
    assert "ACU / Cost" not in report
    assert "Redis" not in report
    assert "E2B running s/run | vCPU-s/run | GiB-s/run | Usage USD/run" in report
    assert "Usage USD/month | Fixed USD/month | Total Cost (E2B only)" in report
    assert "billed s/run" not in report
    assert "Network" not in report
    assert "monthly_cost" not in serialized["pure_scenarios"]["basic"]["agent"]
    assert "redis" not in serialized["pure_scenarios"]["basic"]
    assert "network" not in serialized["pure_scenarios"]["basic"]
    assert "acu_monthly_price" not in json.loads((output_dir / "cost-input.json").read_text())
    assert "redis_tiers" not in json.loads((output_dir / "cost-input.json").read_text())
    assert "network_price_per_gib" not in json.loads((output_dir / "cost-input.json").read_text())
    assert json.loads((output_dir / "cost-input.json").read_text())["e2b_pricing"][
        "cpu_usd_per_vcpu_second"
    ] == pytest.approx(0.000014)
    assert serialized["pure_scenarios"]["basic"]["agent"]["capacity_runs_per_second"] == pytest.approx(1.23456789)
    assert "1.2346" in report
    assert "1.23457" not in report
    assert math.isfinite(serialized["pure_scenarios"]["basic"]["agent"]["capacity_runs_per_second"])


def test_report_displays_official_price_provenance_and_four_decimal_places(tmp_path: Path) -> None:
    points = _five_points()
    points[0] = _point("basic", runs_per_second=1.23456789)
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-e2b", points=points)

    result = calculate_cost_result(capacity_result_path=capacity_path, cost_input=_input())
    report = render_cost_report(result)

    assert result.pure_scenarios["basic"].agent.capacity_runs_per_second == pytest.approx(1.23456789)
    assert "E2B price source: **https://e2b.dev/pricing**" in report
    assert "Price checked at: **2026-08-02**" in report
    assert "CPU: **0.000014 USD/vCPU-s**" in report
    assert "Memory: **0.0000045 USD/GiB-s**" in report
    assert "Currency: **USD**" in report
    assert "1.2346" in report
    assert "1.23457" not in report
    assert "$" not in report
