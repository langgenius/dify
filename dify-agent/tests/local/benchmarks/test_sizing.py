import json
import math
from pathlib import Path

import pytest
from pydantic import ValidationError

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
from benchmarks.sizing import ScenarioId, SizingInputV1, calculate_sizing_result, main


def _point(
    scenario_id: ScenarioId,
    *,
    mode: BenchmarkMode = "local-e2b",
    concurrency: int = 1,
    runs_per_second: float = 10,
    status: CapacityStatus = "valid",
    successful_runs: int = 2,
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
    mode: BenchmarkMode = "local-e2b",
    points: list[CapacityPoint] | None = None,
    active_seconds: list[float] | None = None,
    e2b_vcpu_counts: list[float | None] | None = None,
    e2b_memory_mib: list[float | None] | None = None,
) -> Path:
    selected_points = points or [_point(scenario) for scenario in ("basic", "shell", "resume", "config", "file")]
    capacity_path = root / "result.json"
    capacity_path.write_text(_capacity_result(mode, selected_points).model_dump_json(indent=2))
    samples: list[RunSample] = []
    for point in selected_points:
        if point.status != "valid":
            continue
        block_id = f"run-{point.scenario_id}-c{point.requested_concurrency}"
        is_e2b = mode == "local-e2b" and point.scenario_id != "basic"
        active_values = active_seconds or [0.5] * point.successful_runs
        vcpu_values = e2b_vcpu_counts or [2] * point.successful_runs
        memory_values = e2b_memory_mib or [512] * point.successful_runs
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
                e2b_active_seconds=active_values[index] if is_e2b else None,
                e2b_vcpu_count=vcpu_values[index] if is_e2b else None,
                e2b_memory_mib=memory_values[index] if is_e2b else None,
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
            redis_before=RedisSnapshot(),
            redis_after=RedisSnapshot(),
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


def _input(**updates: object) -> SizingInputV1:
    values: dict[str, object] = {
        "monthly_runs": 1800,
        "peak_rps": 17,
        "e2b_concurrency": 20,
    }
    values.update(updates)
    return SizingInputV1.model_validate(values)


def test_sizing_input_only_accepts_official_calculator_concurrency_options() -> None:
    assert _input(e2b_concurrency=20).e2b_concurrency == 20
    assert _input(e2b_concurrency=100).e2b_concurrency == 100
    assert _input(e2b_concurrency=600).e2b_concurrency == 600
    assert _input(e2b_concurrency=1100).e2b_concurrency == 1100

    with pytest.raises(ValidationError):
        _input(e2b_concurrency=50)
    with pytest.raises(ValidationError):
        _input(monthly_runs=-1)


def test_selects_fastest_valid_point_and_tie_uses_lower_concurrency(tmp_path: Path) -> None:
    points = [_point(scenario) for scenario in ("basic", "shell", "resume", "config", "file")]
    points.extend(
        [
            _point("shell", concurrency=10, runs_per_second=20),
            _point("shell", concurrency=20, runs_per_second=20),
            _point("shell", concurrency=30, runs_per_second=100, status="invalid"),
        ]
    )
    capacity_path = _write_capacity_artifacts(tmp_path, points=points)

    shell = calculate_sizing_result(capacity_result_path=capacity_path, sizing_input=_input()).scenarios["shell"]

    assert shell.selected_concurrency == 10
    assert shell.capacity_runs_per_second == 20
    assert "1 invalid capacity point" in " ".join(shell.warnings)


def test_calculates_acu_and_official_e2b_calculator_inputs(tmp_path: Path) -> None:
    points = [_point(scenario, runs_per_second=8) for scenario in ("basic", "shell", "resume", "config", "file")]
    capacity_path = _write_capacity_artifacts(
        tmp_path,
        points=points,
        active_seconds=[1, 3],
        e2b_vcpu_counts=[2, 2],
        e2b_memory_mib=[512, 512],
    )

    result = calculate_sizing_result(capacity_result_path=capacity_path, sizing_input=_input())
    shell = result.scenarios["shell"]

    assert shell.status == "ready"
    assert shell.required_acu == 3
    assert shell.e2b.status == "ready"
    assert shell.e2b.vcpus == 2
    assert shell.e2b.ram_gb == pytest.approx(0.5)
    assert shell.e2b.active_seconds_per_run == pytest.approx(2)
    assert shell.e2b.run_hours_per_month == pytest.approx(1)
    assert shell.e2b.concurrency == 20
    assert result.scenarios["basic"].e2b.status == "not_applicable"


def test_missing_or_mixed_lifecycle_resources_keep_acu_but_mark_e2b_incomplete(tmp_path: Path) -> None:
    capacity_path = _write_capacity_artifacts(
        tmp_path,
        e2b_vcpu_counts=[2, None],
        e2b_memory_mib=[512, 1024],
    )

    shell = calculate_sizing_result(capacity_result_path=capacity_path, sizing_input=_input()).scenarios["shell"]

    assert shell.required_acu == 2
    assert shell.status == "incomplete"
    assert shell.e2b.status == "incomplete"
    assert shell.e2b.run_hours_per_month == pytest.approx(0.25)
    assert shell.e2b.vcpus is None
    assert shell.e2b.ram_gb is None
    assert "lack E2B vCPU count" in " ".join(shell.warnings)
    assert "multiple E2B memory" in " ".join(shell.warnings)


def test_no_valid_point_is_incomplete_without_fabricating_acu(tmp_path: Path) -> None:
    points = [_point(scenario) for scenario in ("basic", "shell", "resume", "config", "file")]
    points[1] = _point("shell", status="invalid")
    capacity_path = _write_capacity_artifacts(tmp_path, points=points)

    shell = calculate_sizing_result(capacity_result_path=capacity_path, sizing_input=_input()).scenarios["shell"]

    assert shell.status == "incomplete"
    assert shell.required_acu is None
    assert shell.e2b.status == "incomplete"
    assert "c1 invalid excluded: product error" in shell.warnings


def test_historical_block_field_is_accepted_but_unknown_fields_are_not(tmp_path: Path) -> None:
    capacity_path = _write_capacity_artifacts(tmp_path)
    block_path = tmp_path / "blocks" / "basic-c1" / "block-result.json"
    payload = json.loads(block_path.read_text())
    payload["minimum_successful_runs"] = 100
    block_path.write_text(json.dumps(payload))

    result = calculate_sizing_result(capacity_result_path=capacity_path, sizing_input=_input())
    assert result.scenarios["basic"].status == "ready"

    payload["unknown_field"] = True
    block_path.write_text(json.dumps(payload))
    result = calculate_sizing_result(capacity_result_path=capacity_path, sizing_input=_input())
    assert result.scenarios["basic"].status == "incomplete"


def test_local_runtime_is_validation_only_and_rejected(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    points = [_point(scenario, mode="local-runtime") for scenario in ("basic", "shell", "resume", "config", "file")]
    capacity_path = _write_capacity_artifacts(tmp_path, mode="local-runtime", points=points)
    output_dir = tmp_path / "must-not-exist"

    assert (
        main(
            [
                "--capacity-result",
                str(capacity_path),
                "--monthly-runs",
                "1000",
                "--peak-rps",
                "10",
                "--e2b-concurrency",
                "20",
                "--output-dir",
                str(output_dir),
            ]
        )
        == 2
    )
    assert "local-runtime is validation-only" in capsys.readouterr().err
    assert not output_dir.exists()


def test_cli_writes_only_sizing_artifacts_and_no_monetary_model(tmp_path: Path) -> None:
    points = [
        _point(scenario, runs_per_second=1.23456789) for scenario in ("basic", "shell", "resume", "config", "file")
    ]
    capacity_path = _write_capacity_artifacts(tmp_path, points=points)
    output_dir = tmp_path / "sizing-output"

    assert (
        main(
            [
                "--capacity-result",
                str(capacity_path),
                "--monthly-runs",
                "18000",
                "--peak-rps",
                "17",
                "--e2b-concurrency",
                "20",
                "--output-dir",
                str(output_dir),
            ]
        )
        == 0
    )

    for name in ("sizing-input.json", "sizing-result.json", "sizing-report.md"):
        assert (output_dir / name).is_file()
    serialized = json.loads((output_dir / "sizing-result.json").read_text())
    report = (output_dir / "sizing-report.md").read_text()
    all_output = json.dumps(serialized).lower() + report.lower()
    assert "price" not in all_output
    assert "monthly_cost" not in all_output
    assert "plan_base" not in all_output
    assert "total cost" not in all_output
    assert "| Required ACU | E2B vCPUs | E2B RAM GB | E2B Run Hours/month | E2B Concurrency |" in report
    assert "https://pricing.e2b.dev/" in report
    assert "1.2346" in report
    assert "1.23457" not in report
    assert "| `shell` | `ready` | 1 | 1.2346 | 14 | 2.0000 | 0.5000 | 2 | 20 |" in report
    assert "2.5000" not in report
    assert math.isfinite(serialized["scenarios"]["basic"]["capacity_runs_per_second"])
