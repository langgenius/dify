"""Derive Agent ACU demand and E2B calculator inputs from one capacity result."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys
from typing import ClassVar, Literal, Sequence, cast

from pydantic import BaseModel, ConfigDict, Field

from benchmarks.scenario import BenchmarkMode
from benchmarks.schemas import BlockResult, CapacityPoint, CapacityResult, RunSample


ScenarioId = Literal["basic", "shell", "resume", "config", "file"]
E2BConcurrency = Literal[20, 100, 600, 1100]
SizingStatus = Literal["ready", "incomplete"]
E2BInputStatus = Literal["ready", "incomplete", "not_applicable"]

SCENARIO_IDS: tuple[ScenarioId, ...] = ("basic", "shell", "resume", "config", "file")
E2B_CALCULATOR_URL = "https://pricing.e2b.dev/"
E2B_CALCULATOR_CHECKED_AT = "2026-08-02"


class SizingInputV1(BaseModel):
    schema_version: Literal[1] = 1
    monthly_runs: int = Field(ge=0)
    peak_rps: float = Field(ge=0)
    e2b_concurrency: E2BConcurrency

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SizingSourceV1(BaseModel):
    capacity_result_path: str
    mode: BenchmarkMode
    commit: str
    content_hash: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class E2BCalculatorInputsV1(BaseModel):
    status: E2BInputStatus
    vcpus: float | None = Field(default=None, gt=0)
    ram_gb: float | None = Field(default=None, gt=0)
    run_hours_per_month: float | None = Field(default=None, ge=0)
    concurrency: E2BConcurrency | None = None
    active_seconds_per_run: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class ScenarioSizingV1(BaseModel):
    status: SizingStatus
    selected_concurrency: int | None = Field(default=None, ge=1)
    capacity_runs_per_second: float | None = Field(default=None, gt=0)
    required_acu: int | None = Field(default=None, ge=0)
    e2b: E2BCalculatorInputsV1
    warnings: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SizingResultV1(BaseModel):
    schema_version: Literal[1] = 1
    capacity_schema_version: Literal[1] = 1
    source: SizingSourceV1
    sizing_input: SizingInputV1
    e2b_calculator_url: Literal["https://pricing.e2b.dev/"] = E2B_CALCULATOR_URL
    e2b_calculator_checked_at: Literal["2026-08-02"] = E2B_CALCULATOR_CHECKED_AT
    matrix_complete: bool
    complete: bool
    scenarios: dict[ScenarioId, ScenarioSizingV1]
    warnings: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


@dataclass(slots=True, frozen=True)
class _SelectedEvidence:
    active_seconds_per_run: float | None
    vcpus: float | None
    ram_gb: float | None


def calculate_sizing_result(
    *,
    capacity_result_path: Path,
    sizing_input: SizingInputV1,
) -> SizingResultV1:
    capacity_result_path = capacity_result_path.resolve()
    capacity = CapacityResult.model_validate_json(capacity_result_path.read_text())
    if capacity.schema_version != 1:
        raise ValueError(f"unsupported capacity result schema {capacity.schema_version}")
    if capacity.mode == "local-runtime":
        raise ValueError("local-runtime is validation-only; use local-e2b for E2B calculator inputs")
    samples = _load_samples(capacity_result_path.parent / "samples.jsonl")
    result_warnings = [] if capacity.matrix_complete else ["capacity matrix is incomplete"]
    scenarios: dict[ScenarioId, ScenarioSizingV1] = {}

    for scenario_id in SCENARIO_IDS:
        points = [point for point in capacity.points if point.scenario_id == scenario_id]
        warnings = _excluded_point_warnings(points)
        selected = _select_capacity_point(points)
        if selected is None:
            warnings.append("no valid capacity point is available")
            scenarios[scenario_id] = _incomplete_sizing(
                e2b_applicable=scenario_id != "basic",
                warnings=warnings,
            )
            result_warnings.append(f"{scenario_id}: no valid capacity point")
            continue
        evidence, evidence_warnings = _load_selected_evidence(
            capacity_result_path=capacity_result_path,
            capacity=capacity,
            point=selected,
            samples=samples,
        )
        warnings.extend(evidence_warnings)
        if evidence is None:
            scenarios[scenario_id] = _incomplete_sizing(
                e2b_applicable=scenario_id != "basic",
                warnings=warnings,
                selected=selected,
            )
            result_warnings.append(f"{scenario_id}: selected point lacks required source evidence")
            continue
        scenarios[scenario_id] = _sizing_from_evidence(
            scenario_id=scenario_id,
            point=selected,
            evidence=evidence,
            sizing_input=sizing_input,
            warnings=warnings,
        )

    complete = capacity.matrix_complete and all(item.status == "ready" for item in scenarios.values())
    return SizingResultV1(
        source=SizingSourceV1(
            capacity_result_path=str(capacity_result_path),
            mode=capacity.mode,
            commit=capacity.target.commit,
            content_hash=capacity.target.content_hash,
        ),
        sizing_input=sizing_input,
        matrix_complete=capacity.matrix_complete,
        complete=complete,
        scenarios=scenarios,
        warnings=result_warnings,
    )


def _select_capacity_point(points: Sequence[CapacityPoint]) -> CapacityPoint | None:
    valid = [point for point in points if point.status == "valid" and point.runs_per_second > 0]
    return min(valid, key=lambda point: (-point.runs_per_second, point.requested_concurrency)) if valid else None


def _excluded_point_warnings(points: Sequence[CapacityPoint]) -> list[str]:
    warnings: list[str] = []
    invalid_count = sum(point.status == "invalid" for point in points)
    saturated_count = sum(point.status == "saturated" for point in points)
    if invalid_count:
        warnings.append(f"{invalid_count} invalid capacity point(s) were excluded")
    if saturated_count:
        warnings.append(f"{saturated_count} saturated capacity point(s) were excluded")
    for point in sorted(points, key=lambda item: item.requested_concurrency):
        if point.status == "valid":
            continue
        reason = "; ".join(_compact_reason(item) for item in point.reasons) if point.reasons else "point status"
        warnings.append(f"c{point.requested_concurrency} {point.status} excluded: {reason}")
    return warnings


def _compact_reason(reason: str, *, limit: int = 320) -> str:
    normalized = " ".join(reason.split())
    return normalized if len(normalized) <= limit else f"{normalized[: limit - 3]}..."


def _load_samples(path: Path) -> list[RunSample]:
    samples: list[RunSample] = []
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            samples.append(RunSample.model_validate_json(line))
        except Exception as exc:
            raise ValueError(f"invalid sample on line {line_number}: {exc}") from exc
    return samples


def _load_selected_evidence(
    *,
    capacity_result_path: Path,
    capacity: CapacityResult,
    point: CapacityPoint,
    samples: Sequence[RunSample],
) -> tuple[_SelectedEvidence | None, list[str]]:
    block_path = (
        capacity_result_path.parent
        / "blocks"
        / f"{point.scenario_id}-c{point.requested_concurrency}"
        / "block-result.json"
    )
    if not block_path.exists():
        return None, ["selected block artifact is missing"]
    try:
        block = _load_block_result(block_path)
    except Exception as exc:
        return None, [f"selected block artifact is invalid: {type(exc).__name__}: {exc}"]
    if (
        block.schema_version != 1
        or block.mode != capacity.mode
        or block.scenario_id != point.scenario_id
        or block.requested_concurrency != point.requested_concurrency
        or not block.valid
    ):
        return None, ["selected block artifact does not match its capacity point"]
    if block.outcomes.successful_runs <= 0 or block.outcomes.successful_runs != point.successful_runs:
        return None, ["selected block successful Run count does not match its capacity point"]
    selected_samples = [
        sample for sample in samples if sample.block_id == block.block_id and sample.terminal_status == "succeeded"
    ]
    if len(selected_samples) != block.outcomes.successful_runs:
        return None, ["selected samples.jsonl successful Run count does not match the block"]
    if point.scenario_id == "basic":
        return _SelectedEvidence(active_seconds_per_run=None, vcpus=None, ram_gb=None), []

    warnings: list[str] = []
    active_values = [sample.e2b_active_seconds for sample in selected_samples]
    active_seconds_per_run = None
    if any(value is None for value in active_values):
        warnings.append("one or more successful samples lack E2B active seconds")
    else:
        active = [cast(float, value) for value in active_values]
        active_seconds_per_run = sum(active) / len(active)
    vcpus, vcpu_warning = _consistent_value(
        [sample.e2b_vcpu_count for sample in selected_samples],
        label="E2B vCPU count",
    )
    ram_mib, memory_warning = _consistent_value(
        [sample.e2b_memory_mib for sample in selected_samples],
        label="E2B memory MiB",
    )
    warnings.extend(item for item in (vcpu_warning, memory_warning) if item is not None)
    return (
        _SelectedEvidence(
            active_seconds_per_run=active_seconds_per_run,
            vcpus=vcpus,
            ram_gb=ram_mib / 1024 if ram_mib is not None else None,
        ),
        warnings,
    )


def _consistent_value(values: Sequence[float | None], *, label: str) -> tuple[float | None, str | None]:
    if any(value is None for value in values):
        return None, f"one or more successful samples lack {label}"
    present = [cast(float, value) for value in values]
    if len(set(present)) != 1:
        return None, f"successful samples contain multiple {label} values"
    return present[0], None


def _load_block_result(path: Path) -> BlockResult:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError("block result must be a JSON object")
    if "minimum_successful_runs" in payload:
        minimum_successful_runs = payload["minimum_successful_runs"]
        if (
            payload.get("schema_version") != 1
            or isinstance(minimum_successful_runs, bool)
            or not isinstance(minimum_successful_runs, int)
            or minimum_successful_runs < 0
        ):
            raise ValueError("invalid historical minimum_successful_runs")
        payload = {key: value for key, value in payload.items() if key != "minimum_successful_runs"}
    return BlockResult.model_validate(payload)


def _sizing_from_evidence(
    *,
    scenario_id: ScenarioId,
    point: CapacityPoint,
    evidence: _SelectedEvidence,
    sizing_input: SizingInputV1,
    warnings: Sequence[str],
) -> ScenarioSizingV1:
    required_acu = math.ceil(sizing_input.peak_rps / point.runs_per_second)
    if scenario_id == "basic":
        e2b = E2BCalculatorInputsV1(status="not_applicable")
    else:
        run_hours = (
            evidence.active_seconds_per_run * sizing_input.monthly_runs / 3600
            if evidence.active_seconds_per_run is not None
            else None
        )
        ready = (
            evidence.active_seconds_per_run is not None and evidence.vcpus is not None and evidence.ram_gb is not None
        )
        e2b = E2BCalculatorInputsV1(
            status="ready" if ready else "incomplete",
            vcpus=evidence.vcpus,
            ram_gb=evidence.ram_gb,
            run_hours_per_month=run_hours,
            concurrency=sizing_input.e2b_concurrency,
            active_seconds_per_run=evidence.active_seconds_per_run,
        )
    return ScenarioSizingV1(
        status="ready" if e2b.status in {"ready", "not_applicable"} else "incomplete",
        selected_concurrency=point.requested_concurrency,
        capacity_runs_per_second=point.runs_per_second,
        required_acu=required_acu,
        e2b=e2b,
        warnings=list(dict.fromkeys(warnings)),
    )


def _incomplete_sizing(
    *,
    e2b_applicable: bool,
    warnings: Sequence[str],
    selected: CapacityPoint | None = None,
) -> ScenarioSizingV1:
    return ScenarioSizingV1(
        status="incomplete",
        selected_concurrency=selected.requested_concurrency if selected is not None else None,
        capacity_runs_per_second=selected.runs_per_second if selected is not None else None,
        required_acu=None,
        e2b=E2BCalculatorInputsV1(status="incomplete" if e2b_applicable else "not_applicable"),
        warnings=list(warnings),
    )


def render_sizing_report(result: SizingResultV1) -> str:
    sizing_input = result.sizing_input
    lines = [
        "# Dify Agent ACU and E2B calculator inputs",
        "",
        "> Derived from local-E2B benchmark evidence. No monetary amount is calculated.",
        "",
        "## Inputs",
        "",
        f"- Capacity result: `{result.source.capacity_result_path}`",
        f"- Commit/content: `{result.source.commit}` / `{result.source.content_hash}`",
        f"- Monthly Runs: **{sizing_input.monthly_runs}**",
        f"- Peak Runs/s: **{_number(sizing_input.peak_rps)}**",
        f"- E2B concurrency selection: **{sizing_input.e2b_concurrency}**",
        f"- E2B calculator: {result.e2b_calculator_url}",
        f"- Calculator inputs checked at: **{result.e2b_calculator_checked_at}**",
        f"- Capacity matrix complete: `{str(result.matrix_complete).lower()}`",
        f"- Sizing result complete: `{str(result.complete).lower()}`",
        "",
        "## Per-scenario sizing",
        "",
        "| Scenario | Status | Selected C | Capacity runs/s | Required ACU | E2B vCPUs | E2B RAM GB | "
        "E2B Run Hours/month | E2B Concurrency |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for scenario_id in SCENARIO_IDS:
        lines.append(_report_row(scenario_id, result.scenarios[scenario_id]))
    diagnostics = list(result.warnings)
    for scenario_id in SCENARIO_IDS:
        diagnostics.extend(f"{scenario_id}: {item}" for item in result.scenarios[scenario_id].warnings)
    if diagnostics:
        lines.extend(["", "## Diagnostics", ""])
        lines.extend(f"- {item}" for item in dict.fromkeys(diagnostics))
    lines.extend(
        [
            "",
            "## Calculation contracts",
            "",
            "- `Required ACU = ceil(peak_rps / selected capacity runs/s)`; no safety factor is added.",
            "- `Run Hours / Month = active-seconds/run × monthly_runs / 3600` for each pure scenario.",
            "- E2B vCPUs, RAM, and active time come from matching pause lifecycle events.",
            "- E2B concurrency is a business input and is not inferred from benchmark concurrency or peak RPS.",
            "- Copy vCPUs, RAM GB, Run Hours/month, and concurrency into the official E2B calculator.",
            "- Basic does not allocate E2B, so its E2B fields are not applicable.",
            "",
        ]
    )
    return "\n".join(lines)


def _report_row(label: str, sizing: ScenarioSizingV1) -> str:
    return (
        f"| `{label}` | `{sizing.status}` | {_number(sizing.selected_concurrency)} | "
        f"{_number(sizing.capacity_runs_per_second)} | {_number(sizing.required_acu)} | "
        f"{_number(sizing.e2b.vcpus)} | {_number(sizing.e2b.ram_gb)} | "
        f"{_integer_part(sizing.e2b.run_hours_per_month)} | {_number(sizing.e2b.concurrency)} |"
    )


def _integer_part(value: float | None) -> str:
    return "N/A" if value is None else str(math.trunc(value))


def _number(value: float | int | None) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, int):
        return str(value)
    return f"{value:.4f}"


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capacity-result", type=Path, required=True)
    parser.add_argument("--monthly-runs", type=int, required=True)
    parser.add_argument("--peak-rps", type=float, required=True)
    parser.add_argument("--e2b-concurrency", type=int, choices=(20, 100, 600, 1100), required=True)
    parser.add_argument("--output-dir", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    capacity_result_path = cast(Path, args.capacity_result).resolve()
    try:
        sizing_input = SizingInputV1(
            monthly_runs=cast(int, args.monthly_runs),
            peak_rps=cast(float, args.peak_rps),
            e2b_concurrency=cast(E2BConcurrency, args.e2b_concurrency),
        )
        result = calculate_sizing_result(
            capacity_result_path=capacity_result_path,
            sizing_input=sizing_input,
        )
    except (OSError, ValueError) as exc:
        print(f"bench-sizing: {exc}", file=sys.stderr)
        return 2
    requested_output = cast(Path | None, args.output_dir)
    output_dir = (
        requested_output.resolve()
        if requested_output is not None
        else capacity_result_path.parent.parent / f"{_new_run_id()}-sizing"
    )
    output_dir.mkdir(parents=True, exist_ok=False)
    (output_dir / "sizing-input.json").write_text(sizing_input.model_dump_json(indent=2))
    (output_dir / "sizing-result.json").write_text(result.model_dump_json(indent=2))
    (output_dir / "sizing-report.md").write_text(render_sizing_report(result))
    print(output_dir)
    return 0


def _new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")


if __name__ == "__main__":
    raise SystemExit(main())
