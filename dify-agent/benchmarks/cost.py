"""Translate one local-E2B capacity result into auditable cost evidence."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys
from typing import ClassVar, Literal, Sequence, cast

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from benchmarks.scenario import BenchmarkMode
from benchmarks.schemas import BlockResult, CapacityPoint, CapacityResult, RunSample


ScenarioId = Literal["basic", "shell", "resume", "config", "file"]
ComponentStatus = Literal["calculated", "incomplete", "not_applicable"]
ScenarioStatus = Literal["complete", "incomplete"]
E2BPlan = Literal["hobby", "pro"]

SCENARIO_IDS: tuple[ScenarioId, ...] = ("basic", "shell", "resume", "config", "file")
E2B_CPU_USD_PER_VCPU_SECOND = 0.000014
E2B_MEMORY_USD_PER_GIB_SECOND = 0.0000045
E2B_HOBBY_MONTHLY_BASE_USD = 0.0
E2B_PRO_MONTHLY_BASE_USD = 150.0
E2B_PRO_INCLUDED_CONCURRENCY = 100
E2B_PRO_ADDON_SLOTS = 500
E2B_PRO_ADDON_MONTHLY_USD = 500.0
E2B_PRO_MAX_CONCURRENCY = 1100


class E2BOfficialPricingV1(BaseModel):
    """Auditable snapshot of E2B's public pricing used by this model."""

    currency: Literal["USD"] = "USD"
    cpu_usd_per_vcpu_second: float = E2B_CPU_USD_PER_VCPU_SECOND
    memory_usd_per_gib_second: float = E2B_MEMORY_USD_PER_GIB_SECOND
    hobby_monthly_base_usd: float = E2B_HOBBY_MONTHLY_BASE_USD
    pro_monthly_base_usd: float = E2B_PRO_MONTHLY_BASE_USD
    pro_included_concurrency: int = E2B_PRO_INCLUDED_CONCURRENCY
    pro_concurrency_addon_slots: int = E2B_PRO_ADDON_SLOTS
    pro_concurrency_addon_monthly_usd: float = E2B_PRO_ADDON_MONTHLY_USD
    pro_max_concurrency: int = E2B_PRO_MAX_CONCURRENCY
    source_url: Literal["https://e2b.dev/pricing"] = "https://e2b.dev/pricing"
    billing_url: Literal["https://e2b.dev/docs/billing"] = "https://e2b.dev/docs/billing"
    lifecycle_events_url: Literal["https://e2b.dev/docs/sandbox/lifecycle-events-webhooks"] = (
        "https://e2b.dev/docs/sandbox/lifecycle-events-webhooks"
    )
    concurrency_addon_url: Literal["https://e2b.dev/docs/faq/increase-concurrency"] = (
        "https://e2b.dev/docs/faq/increase-concurrency"
    )
    checked_at: Literal["2026-08-02"] = "2026-08-02"

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_official_snapshot(self) -> "E2BOfficialPricingV1":
        expected: dict[str, float | int] = {
            "cpu_usd_per_vcpu_second": E2B_CPU_USD_PER_VCPU_SECOND,
            "memory_usd_per_gib_second": E2B_MEMORY_USD_PER_GIB_SECOND,
            "hobby_monthly_base_usd": E2B_HOBBY_MONTHLY_BASE_USD,
            "pro_monthly_base_usd": E2B_PRO_MONTHLY_BASE_USD,
            "pro_included_concurrency": E2B_PRO_INCLUDED_CONCURRENCY,
            "pro_concurrency_addon_slots": E2B_PRO_ADDON_SLOTS,
            "pro_concurrency_addon_monthly_usd": E2B_PRO_ADDON_MONTHLY_USD,
            "pro_max_concurrency": E2B_PRO_MAX_CONCURRENCY,
        }
        for name, value in expected.items():
            if getattr(self, name) != value:
                raise ValueError(f"{name} must match the official E2B pricing snapshot")
        return self


class CostInputV1(BaseModel):
    schema_version: Literal[1] = 1
    monthly_runs: int = Field(ge=0)
    peak_rps: float = Field(ge=0)
    usage_weights: dict[ScenarioId, float] | None = None
    peak_weights: dict[ScenarioId, float] | None = None
    e2b_plan: E2BPlan
    peak_running_sandboxes: int = Field(ge=0)
    include_fixed_plan_cost: bool = True
    e2b_pricing: E2BOfficialPricingV1 = Field(default_factory=E2BOfficialPricingV1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @field_validator("usage_weights", "peak_weights")
    @classmethod
    def validate_weights(
        cls,
        value: dict[ScenarioId, float] | None,
    ) -> dict[ScenarioId, float] | None:
        if value is None:
            return None
        if set(value) != set(SCENARIO_IDS):
            raise ValueError("weights must contain exactly basic, shell, resume, config, and file")
        if any(weight < 0 or weight > 1 for weight in value.values()):
            raise ValueError("weights must be between 0 and 1")
        if not math.isclose(sum(value.values()), 1.0, rel_tol=0, abs_tol=1e-9):
            raise ValueError("weights must sum to 1")
        return value

    @model_validator(mode="after")
    def validate_plan_concurrency(self) -> "CostInputV1":
        if self.e2b_plan == "hobby" and self.peak_running_sandboxes > 20:
            raise ValueError("E2B Hobby supports at most 20 concurrent Sandboxes")
        if self.e2b_plan == "pro" and self.peak_running_sandboxes > E2B_PRO_MAX_CONCURRENCY:
            raise ValueError(f"E2B Pro supports at most {E2B_PRO_MAX_CONCURRENCY} concurrent Sandboxes")
        return self


class CostSourceV1(BaseModel):
    capacity_result_path: str
    mode: BenchmarkMode
    commit: str
    content_hash: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CostDemandV1(BaseModel):
    monthly_runs: int = Field(ge=0)
    peak_rps: float = Field(ge=0)
    usage_weights: dict[ScenarioId, float] | None = None
    peak_weights: dict[ScenarioId, float] | None = None
    e2b_plan: E2BPlan
    peak_running_sandboxes: int = Field(ge=0)
    include_fixed_plan_cost: bool

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentCostV1(BaseModel):
    status: Literal["calculated", "incomplete"]
    capacity_runs_per_second: float | None = Field(default=None, ge=0)
    acu: int | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class E2BCostV1(BaseModel):
    status: ComponentStatus
    running_seconds_per_run: float | None = Field(default=None, ge=0)
    vcpu_seconds_per_run: float | None = Field(default=None, ge=0)
    memory_gib_seconds_per_run: float | None = Field(default=None, ge=0)
    usage_cost_per_run: float | None = Field(default=None, ge=0)
    monthly_running_seconds: float | None = Field(default=None, ge=0)
    monthly_usage_cost: float | None = Field(default=None, ge=0)
    monthly_plan_base_cost: float | None = Field(default=None, ge=0)
    monthly_concurrency_addon_cost: float | None = Field(default=None, ge=0)
    fixed_cost_included: bool | None = None
    monthly_cost: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CostEstimateV1(BaseModel):
    status: ScenarioStatus
    selected_concurrency: int | None = Field(default=None, ge=1)
    terminal_p95_ms: float | None = Field(default=None, ge=0)
    agent_cpu_ms_per_run: float | None = Field(default=None, ge=0)
    agent_memory_peak_mib: float | None = Field(default=None, ge=0)
    agent: AgentCostV1
    e2b: E2BCostV1
    total_monthly_cost: float | None = Field(default=None, ge=0)
    warnings: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CostEnvelopeV1(BaseModel):
    best_scenario: ScenarioId
    best_monthly_cost: float = Field(ge=0)
    worst_scenario: ScenarioId
    worst_monthly_cost: float = Field(ge=0)
    worst_to_best_ratio: float | None = Field(default=None, ge=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CostResultV1(BaseModel):
    schema_version: Literal[1] = 1
    capacity_schema_version: Literal[1] = 1
    source: CostSourceV1
    e2b_pricing: E2BOfficialPricingV1
    demand: CostDemandV1
    matrix_complete: bool
    complete: bool
    pure_scenarios: dict[ScenarioId, CostEstimateV1]
    weighted: CostEstimateV1 | None = None
    cost_envelope: CostEnvelopeV1 | None = None
    warnings: list[str] = Field(default_factory=list)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class _UnitMetrics(BaseModel):
    capacity_runs_per_second: float = Field(gt=0)
    terminal_p95_ms: float | None = Field(default=None, ge=0)
    agent_cpu_ms_per_run: float | None = Field(default=None, ge=0)
    agent_memory_peak_mib: float | None = Field(default=None, ge=0)
    e2b_applicable: bool
    e2b_active_seconds_per_run: float | None = Field(default=None, ge=0)
    e2b_vcpu_seconds_per_run: float | None = Field(default=None, ge=0)
    e2b_memory_gib_seconds_per_run: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


def calculate_cost_result(*, capacity_result_path: Path, cost_input: CostInputV1) -> CostResultV1:
    capacity_result_path = capacity_result_path.resolve()
    capacity = CapacityResult.model_validate_json(capacity_result_path.read_text())
    if capacity.schema_version != 1:
        raise ValueError(f"unsupported capacity result schema {capacity.schema_version}")
    if capacity.mode == "local-runtime":
        raise ValueError("local-runtime is validation-only; use its capacity report instead of the cost model")
    samples = _load_samples(capacity_result_path.parent / "samples.jsonl")
    warnings = [] if capacity.matrix_complete else ["capacity matrix is incomplete"]
    estimates: dict[ScenarioId, CostEstimateV1] = {}
    metrics_by_scenario: dict[ScenarioId, _UnitMetrics] = {}

    for scenario_id in SCENARIO_IDS:
        points = [point for point in capacity.points if point.scenario_id == scenario_id]
        point_warnings = _excluded_point_warnings(points)
        selected = _select_capacity_point(points)
        if selected is None:
            point_warnings.append("no valid capacity point is available")
            estimates[scenario_id] = _incomplete_estimate(
                e2b_applicable=capacity.mode == "local-e2b" and scenario_id != "basic",
                cost_input=cost_input,
                warnings=point_warnings,
            )
            warnings.append(f"{scenario_id}: no valid capacity point")
            continue
        metrics, evidence_warnings = _load_selected_metrics(
            capacity_result_path=capacity_result_path,
            capacity=capacity,
            point=selected,
            samples=samples,
        )
        point_warnings.extend(evidence_warnings)
        if metrics is None:
            estimates[scenario_id] = _incomplete_estimate(
                e2b_applicable=capacity.mode == "local-e2b" and scenario_id != "basic",
                cost_input=cost_input,
                warnings=point_warnings,
                selected_concurrency=selected.requested_concurrency,
            )
            warnings.append(f"{scenario_id}: selected point lacks required source evidence")
            continue
        metrics_by_scenario[scenario_id] = metrics
        estimates[scenario_id] = _estimate_from_metrics(
            peak_metrics=metrics,
            usage_metrics=metrics,
            mode=capacity.mode,
            cost_input=cost_input,
            selected_concurrency=selected.requested_concurrency,
            terminal_p95_ms=selected.terminal_p95_ms,
            memory_peak_mib=selected.agent_memory_peak_mib,
            warnings=point_warnings,
        )

    weighted = _weighted_estimate(
        metrics_by_scenario=metrics_by_scenario,
        mode=capacity.mode,
        cost_input=cost_input,
    )
    cost_envelope = _cost_envelope(estimates)
    if cost_envelope is None:
        warnings.append("pure-scenario cost envelope is incomplete")
    complete = capacity.matrix_complete and all(estimate.status == "complete" for estimate in estimates.values())
    if weighted is not None:
        complete = complete and weighted.status == "complete"
    return CostResultV1(
        source=CostSourceV1(
            capacity_result_path=str(capacity_result_path),
            mode=capacity.mode,
            commit=capacity.target.commit,
            content_hash=capacity.target.content_hash,
        ),
        e2b_pricing=cost_input.e2b_pricing,
        demand=CostDemandV1(
            monthly_runs=cost_input.monthly_runs,
            peak_rps=cost_input.peak_rps,
            usage_weights=cost_input.usage_weights,
            peak_weights=cost_input.peak_weights,
            e2b_plan=cost_input.e2b_plan,
            peak_running_sandboxes=cost_input.peak_running_sandboxes,
            include_fixed_plan_cost=cost_input.include_fixed_plan_cost,
        ),
        matrix_complete=capacity.matrix_complete,
        complete=complete,
        pure_scenarios=estimates,
        weighted=weighted,
        cost_envelope=cost_envelope,
        warnings=warnings,
    )


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
        reason = (
            "; ".join(_compact_reason(item) for item in point.reasons) if point.reasons else "canonical point status"
        )
        warnings.append(f"c{point.requested_concurrency} {point.status} excluded: {reason}")
    return warnings


def _compact_reason(reason: str, *, limit: int = 320) -> str:
    normalized = " ".join(reason.split())
    return normalized if len(normalized) <= limit else f"{normalized[: limit - 3]}..."


def _select_capacity_point(points: Sequence[CapacityPoint]) -> CapacityPoint | None:
    valid = [point for point in points if point.status == "valid" and point.runs_per_second > 0]
    return min(valid, key=lambda point: (-point.runs_per_second, point.requested_concurrency)) if valid else None


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


def _load_selected_metrics(
    *,
    capacity_result_path: Path,
    capacity: CapacityResult,
    point: CapacityPoint,
    samples: Sequence[RunSample],
) -> tuple[_UnitMetrics | None, list[str]]:
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

    e2b_applicable = capacity.mode == "local-e2b" and point.scenario_id != "basic"
    active_per_run = None
    vcpu_seconds_per_run = None
    memory_gib_seconds_per_run = None
    warnings: list[str] = []
    if e2b_applicable:
        active_values = [sample.e2b_active_seconds for sample in selected_samples]
        if any(value is None for value in active_values):
            warnings.append("one or more successful samples lack E2B active seconds")
        else:
            active = [cast(float, value) for value in active_values]
            active_per_run = sum(active) / len(active)
            vcpu_counts = [sample.e2b_vcpu_count for sample in selected_samples]
            if any(value is None for value in vcpu_counts):
                warnings.append("one or more successful samples lack E2B vCPU count")
            else:
                vcpu_seconds = [
                    active_seconds * cast(float, vcpu_count)
                    for active_seconds, vcpu_count in zip(active, vcpu_counts, strict=True)
                ]
                vcpu_seconds_per_run = sum(vcpu_seconds) / len(vcpu_seconds)
            memory_mib = [sample.e2b_memory_mib for sample in selected_samples]
            if any(value is None for value in memory_mib):
                warnings.append("one or more successful samples lack E2B memory MiB")
            else:
                memory_gib_seconds = [
                    active_seconds * cast(float, memory) / 1024
                    for active_seconds, memory in zip(active, memory_mib, strict=True)
                ]
                memory_gib_seconds_per_run = sum(memory_gib_seconds) / len(memory_gib_seconds)
    return (
        _UnitMetrics(
            capacity_runs_per_second=point.runs_per_second,
            terminal_p95_ms=point.terminal_p95_ms,
            agent_cpu_ms_per_run=point.agent_cpu_ms_per_run,
            agent_memory_peak_mib=point.agent_memory_peak_mib,
            e2b_applicable=e2b_applicable,
            e2b_active_seconds_per_run=active_per_run,
            e2b_vcpu_seconds_per_run=vcpu_seconds_per_run,
            e2b_memory_gib_seconds_per_run=memory_gib_seconds_per_run,
        ),
        warnings,
    )


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


def _estimate_from_metrics(
    *,
    peak_metrics: _UnitMetrics | None,
    usage_metrics: _UnitMetrics | None,
    mode: BenchmarkMode,
    cost_input: CostInputV1,
    selected_concurrency: int | None,
    terminal_p95_ms: float | None,
    memory_peak_mib: float | None,
    warnings: Sequence[str],
) -> CostEstimateV1:
    agent = _agent_capacity(peak_metrics, cost_input.peak_rps)
    e2b = _e2b_cost(usage_metrics, mode, cost_input)
    estimate_warnings = list(warnings)
    if agent.status == "incomplete":
        estimate_warnings.append("Agent peak capacity is incomplete")
    if e2b.status == "incomplete":
        estimate_warnings.append("E2B lifecycle resource evidence is incomplete")
    components_complete = agent.status == "calculated" and e2b.status in {"calculated", "not_applicable"}
    total = 0.0 if e2b.status == "not_applicable" else e2b.monthly_cost
    if not components_complete:
        total = None
    return CostEstimateV1(
        status="complete" if components_complete else "incomplete",
        selected_concurrency=selected_concurrency,
        terminal_p95_ms=terminal_p95_ms,
        agent_cpu_ms_per_run=(usage_metrics.agent_cpu_ms_per_run if usage_metrics is not None else None),
        agent_memory_peak_mib=memory_peak_mib,
        agent=agent,
        e2b=e2b,
        total_monthly_cost=total,
        warnings=list(dict.fromkeys(estimate_warnings)),
    )


def _agent_capacity(metrics: _UnitMetrics | None, peak_rps: float) -> AgentCostV1:
    if metrics is None:
        return AgentCostV1(status="incomplete")
    return AgentCostV1(
        status="calculated",
        capacity_runs_per_second=metrics.capacity_runs_per_second,
        acu=math.ceil(peak_rps / metrics.capacity_runs_per_second),
    )


def _e2b_cost(metrics: _UnitMetrics | None, mode: BenchmarkMode, cost_input: CostInputV1) -> E2BCostV1:
    if mode == "local-runtime" or (metrics is not None and not metrics.e2b_applicable):
        return E2BCostV1(status="not_applicable")
    plan_base, concurrency_addon = _fixed_e2b_cost(cost_input)
    if metrics is None:
        return E2BCostV1(
            status="incomplete",
            monthly_plan_base_cost=plan_base,
            monthly_concurrency_addon_cost=concurrency_addon,
            fixed_cost_included=cost_input.include_fixed_plan_cost,
        )
    active = metrics.e2b_active_seconds_per_run
    vcpu_seconds = metrics.e2b_vcpu_seconds_per_run
    memory_gib_seconds = metrics.e2b_memory_gib_seconds_per_run
    if vcpu_seconds is None or memory_gib_seconds is None:
        return E2BCostV1(
            status="incomplete",
            running_seconds_per_run=active,
            vcpu_seconds_per_run=vcpu_seconds,
            memory_gib_seconds_per_run=memory_gib_seconds,
            monthly_plan_base_cost=plan_base,
            monthly_concurrency_addon_cost=concurrency_addon,
            fixed_cost_included=cost_input.include_fixed_plan_cost,
        )
    pricing = cost_input.e2b_pricing
    usage_per_run = (
        vcpu_seconds * pricing.cpu_usd_per_vcpu_second + memory_gib_seconds * pricing.memory_usd_per_gib_second
    )
    monthly_usage = usage_per_run * cost_input.monthly_runs
    fixed = plan_base + concurrency_addon if cost_input.include_fixed_plan_cost else 0
    return E2BCostV1(
        status="calculated",
        running_seconds_per_run=active,
        vcpu_seconds_per_run=vcpu_seconds,
        memory_gib_seconds_per_run=memory_gib_seconds,
        usage_cost_per_run=usage_per_run,
        monthly_running_seconds=active * cost_input.monthly_runs if active is not None else None,
        monthly_usage_cost=monthly_usage,
        monthly_plan_base_cost=plan_base,
        monthly_concurrency_addon_cost=concurrency_addon,
        fixed_cost_included=cost_input.include_fixed_plan_cost,
        monthly_cost=monthly_usage + fixed,
    )


def _fixed_e2b_cost(cost_input: CostInputV1) -> tuple[float, float]:
    pricing = cost_input.e2b_pricing
    if cost_input.e2b_plan == "hobby":
        return pricing.hobby_monthly_base_usd, 0
    excess = max(0, cost_input.peak_running_sandboxes - pricing.pro_included_concurrency)
    addon_count = math.ceil(excess / pricing.pro_concurrency_addon_slots)
    return pricing.pro_monthly_base_usd, addon_count * pricing.pro_concurrency_addon_monthly_usd


def _weighted_estimate(
    *,
    metrics_by_scenario: dict[ScenarioId, _UnitMetrics],
    mode: BenchmarkMode,
    cost_input: CostInputV1,
) -> CostEstimateV1 | None:
    if cost_input.peak_weights is None and cost_input.usage_weights is None:
        return None
    warnings: list[str] = []
    peak_metrics = None
    usage_metrics = None
    if cost_input.peak_weights is None:
        warnings.append("peak_weights are missing")
    else:
        peak_metrics = _weighted_metrics(metrics_by_scenario, cost_input.peak_weights, mode)
        if peak_metrics is None:
            warnings.append("a positive peak weight references a scenario without valid metrics")
    if cost_input.usage_weights is None:
        warnings.append("usage_weights are missing")
    else:
        usage_metrics = _weighted_metrics(metrics_by_scenario, cost_input.usage_weights, mode)
        if usage_metrics is None:
            warnings.append("a positive usage weight references a scenario without valid metrics")
    return _estimate_from_metrics(
        peak_metrics=peak_metrics,
        usage_metrics=usage_metrics,
        mode=mode,
        cost_input=cost_input,
        selected_concurrency=None,
        terminal_p95_ms=None,
        memory_peak_mib=None,
        warnings=["weighted values are derived, not a directly measured capacity point", *warnings],
    )


def _weighted_metrics(
    metrics: dict[ScenarioId, _UnitMetrics],
    weights: dict[ScenarioId, float],
    mode: BenchmarkMode,
) -> _UnitMetrics | None:
    selected = cast(list[ScenarioId], [scenario_id for scenario_id in SCENARIO_IDS if weights[scenario_id] > 0])
    if any(scenario_id not in metrics for scenario_id in selected):
        return None
    capacity = 1 / sum(weights[scenario_id] / metrics[scenario_id].capacity_runs_per_second for scenario_id in selected)

    cpu = None
    if all(metrics[scenario_id].agent_cpu_ms_per_run is not None for scenario_id in selected):
        cpu = sum(
            weights[scenario_id] * cast(float, metrics[scenario_id].agent_cpu_ms_per_run) for scenario_id in selected
        )
    e2b_applicable = mode == "local-e2b" and any(scenario_id != "basic" for scenario_id in selected)
    active = None
    vcpu_seconds = None
    memory_gib_seconds = None
    if e2b_applicable:
        applicable = cast(list[ScenarioId], [scenario_id for scenario_id in selected if scenario_id != "basic"])
        if all(metrics[scenario_id].e2b_active_seconds_per_run is not None for scenario_id in applicable):
            active = sum(
                weights[scenario_id] * cast(float, metrics[scenario_id].e2b_active_seconds_per_run)
                for scenario_id in applicable
            )
        if all(metrics[scenario_id].e2b_vcpu_seconds_per_run is not None for scenario_id in applicable):
            vcpu_seconds = sum(
                weights[scenario_id] * cast(float, metrics[scenario_id].e2b_vcpu_seconds_per_run)
                for scenario_id in applicable
            )
        if all(metrics[scenario_id].e2b_memory_gib_seconds_per_run is not None for scenario_id in applicable):
            memory_gib_seconds = sum(
                weights[scenario_id] * cast(float, metrics[scenario_id].e2b_memory_gib_seconds_per_run)
                for scenario_id in applicable
            )
    return _UnitMetrics(
        capacity_runs_per_second=capacity,
        agent_cpu_ms_per_run=cpu,
        e2b_applicable=e2b_applicable,
        e2b_active_seconds_per_run=active,
        e2b_vcpu_seconds_per_run=vcpu_seconds,
        e2b_memory_gib_seconds_per_run=memory_gib_seconds,
    )


def _incomplete_estimate(
    *,
    e2b_applicable: bool,
    cost_input: CostInputV1,
    warnings: Sequence[str],
    selected_concurrency: int | None = None,
) -> CostEstimateV1:
    e2b = _e2b_cost(None, "local-e2b", cost_input) if e2b_applicable else E2BCostV1(status="not_applicable")
    return CostEstimateV1(
        status="incomplete",
        selected_concurrency=selected_concurrency,
        agent=AgentCostV1(status="incomplete"),
        e2b=e2b,
        warnings=list(warnings),
    )


def _cost_envelope(estimates: dict[ScenarioId, CostEstimateV1]) -> CostEnvelopeV1 | None:
    if any(estimate.status != "complete" or estimate.total_monthly_cost is None for estimate in estimates.values()):
        return None
    priced = cast(
        list[tuple[ScenarioId, float]],
        [(scenario_id, cast(float, estimates[scenario_id].total_monthly_cost)) for scenario_id in SCENARIO_IDS],
    )
    best_scenario, best_cost = min(priced, key=lambda item: (item[1], SCENARIO_IDS.index(item[0])))
    worst_scenario, worst_cost = max(priced, key=lambda item: (item[1], -SCENARIO_IDS.index(item[0])))
    ratio = (worst_cost / best_cost) if best_cost > 0 else (1 if worst_cost == 0 else None)
    return CostEnvelopeV1(
        best_scenario=best_scenario,
        best_monthly_cost=best_cost,
        worst_scenario=worst_scenario,
        worst_monthly_cost=worst_cost,
        worst_to_best_ratio=ratio,
    )


def render_cost_report(result: CostResultV1) -> str:
    demand = result.demand
    pricing = result.e2b_pricing
    lines = [
        f"# Dify Agent cost model: {result.source.mode}",
        "",
        "> Derived from local benchmark evidence. This is not a SaaS SLO or Kubernetes sizing recommendation.",
        "",
        "## Source and assumptions",
        "",
        f"- Capacity result: `{result.source.capacity_result_path}`",
        f"- Commit/content: `{result.source.commit}` / `{result.source.content_hash}`",
        f"- Currency: **{pricing.currency}**",
        f"- E2B price source: **{pricing.source_url}**",
        f"- E2B billing source: **{pricing.billing_url}**",
        f"- E2B lifecycle source: **{pricing.lifecycle_events_url}**",
        f"- E2B concurrency add-on source: **{pricing.concurrency_addon_url}**",
        f"- Price checked at: **{pricing.checked_at}**",
        f"- CPU: **{pricing.cpu_usd_per_vcpu_second:.6f} USD/vCPU-s**",
        f"- Memory: **{pricing.memory_usd_per_gib_second:.7f} USD/GiB-s**",
        f"- E2B plan: **{demand.e2b_plan}**",
        f"- Peak running Sandboxes: **{demand.peak_running_sandboxes}**",
        f"- Include fixed plan/add-on cost: `{str(demand.include_fixed_plan_cost).lower()}`",
        f"- Monthly Runs: **{demand.monthly_runs}**",
        f"- Peak Runs/s: **{_number(demand.peak_rps)}**",
        f"- Capacity matrix complete: `{str(result.matrix_complete).lower()}`",
        f"- Cost result complete: `{str(result.complete).lower()}`",
        "",
        "## Pure scenarios",
        "",
        "| Scenario | Status | C | Runs/s | ACU | E2B running s/run | vCPU-s/run | GiB-s/run | Usage USD/run | "
        "Usage USD/month | Fixed USD/month | Total Cost (E2B only) |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for scenario_id in SCENARIO_IDS:
        lines.append(_report_row(scenario_id, result.pure_scenarios[scenario_id]))
    if result.weighted is not None:
        lines.extend(["", "## Weighted result", "", _report_row("weighted", result.weighted)])
    if result.cost_envelope is not None:
        envelope = result.cost_envelope
        lines.extend(
            [
                "",
                "## Pure-scenario cost envelope",
                "",
                f"- Best: `{envelope.best_scenario}` = {_number(envelope.best_monthly_cost)}",
                f"- Worst: `{envelope.worst_scenario}` = {_number(envelope.worst_monthly_cost)}",
                f"- Worst/best ratio: {_number(envelope.worst_to_best_ratio)}",
            ]
        )
    diagnostics = list(result.warnings)
    for scenario_id in SCENARIO_IDS:
        diagnostics.extend(f"{scenario_id}: {item}" for item in result.pure_scenarios[scenario_id].warnings)
    if result.weighted is not None:
        diagnostics.extend(f"weighted: {item}" for item in result.weighted.warnings)
    if diagnostics:
        lines.extend(["", "## Diagnostics", ""])
        lines.extend(f"- {item}" for item in dict.fromkeys(diagnostics))
    lines.extend(
        [
            "",
            "## Calculation contracts",
            "",
            "- Peak weights drive harmonic Agent capacity; ACU is a capacity count and has no price here.",
            "- Usage weights drive E2B running time, resource-seconds, and usage cost.",
            "- E2B usage cost is `vCPU-s × CPU rate + GiB-s × memory rate`; there is no per-Run rounding.",
            "- Running time, vCPU count, and memory MiB come from matching E2B pause lifecycle events.",
            "- Paused time is not charged; Basic does not use E2B and is not applicable.",
            "- The Basic row therefore excludes E2B plan fees; fixed cost appears only on E2B-applicable rows.",
            "- Hobby includes 10 GiB storage and Pro includes 20 GiB; public storage-overage pricing is unavailable.",
            "- One-time credits are excluded. Enterprise custom pricing is unsupported.",
            "- Fixed USD/month is the official plan base plus any Pro concurrency add-ons; inclusion is explicit above.",
            "- Total Cost contains E2B cost only.",
            "- local-runtime is validation-only and is rejected by this cost command.",
            "- Missing lifecycle resource fields produce `incomplete`; the model never guesses a template size.",
            "- No Pod, Node, or Kubernetes equivalent is produced.",
            "",
        ]
    )
    return "\n".join(lines)


def _report_row(label: str, estimate: CostEstimateV1) -> str:
    fixed_cost = None
    if estimate.e2b.monthly_plan_base_cost is not None and estimate.e2b.monthly_concurrency_addon_cost is not None:
        fixed_cost = estimate.e2b.monthly_plan_base_cost + estimate.e2b.monthly_concurrency_addon_cost
    return (
        f"| `{label}` | `{estimate.status}` | {_number(estimate.selected_concurrency)} | "
        f"{_number(estimate.agent.capacity_runs_per_second)} | {_number(estimate.agent.acu)} | "
        f"{_number(estimate.e2b.running_seconds_per_run)} | "
        f"{_number(estimate.e2b.vcpu_seconds_per_run)} | "
        f"{_number(estimate.e2b.memory_gib_seconds_per_run)} | "
        f"{_number(estimate.e2b.usage_cost_per_run)} | "
        f"{_number(estimate.e2b.monthly_usage_cost)} | {_number(fixed_cost)} | "
        f"{_number(estimate.total_monthly_cost)} |"
    )


def _number(value: float | int | None) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, int):
        return str(value)
    return f"{value:.4f}"


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capacity-result", type=Path, required=True)
    parser.add_argument("--cost-input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    capacity_result_path = cast(Path, args.capacity_result).resolve()
    try:
        cost_input = CostInputV1.model_validate_json(cast(Path, args.cost_input).read_text())
        result = calculate_cost_result(capacity_result_path=capacity_result_path, cost_input=cost_input)
    except (OSError, ValueError) as exc:
        print(f"bench-cost: {exc}", file=sys.stderr)
        return 2
    requested_output = cast(Path | None, args.output_dir)
    output_dir = (
        requested_output.resolve()
        if requested_output is not None
        else capacity_result_path.parent.parent / f"{_new_run_id()}-cost"
    )
    output_dir.mkdir(parents=True, exist_ok=False)
    (output_dir / "cost-input.json").write_text(cost_input.model_dump_json(indent=2))
    (output_dir / "cost-result.json").write_text(result.model_dump_json(indent=2))
    (output_dir / "cost-report.md").write_text(render_cost_report(result))
    print(output_dir)
    return 0


def _new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")


if __name__ == "__main__":
    raise SystemExit(main())
