"""Translate one capacity result into auditable resource and cost evidence."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from typing import ClassVar, Literal, Sequence, cast

from pydantic import BaseModel, ConfigDict, Field, field_validator

from benchmarks.scenario import BenchmarkMode
from benchmarks.schemas import BlockResult, CapacityPoint, CapacityResult, RunSample


ScenarioId = Literal["basic", "shell", "resume", "config", "file"]
ComponentStatus = Literal["calculated", "incomplete", "not_applicable"]
ScenarioStatus = Literal["complete", "incomplete"]

SCENARIO_IDS: tuple[ScenarioId, ...] = ("basic", "shell", "resume", "config", "file")
_GIB_BYTES = 1024**3


class E2BBillingV1(BaseModel):
    minimum_seconds: float = Field(ge=0)
    increment_seconds: float = Field(gt=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RedisTierV1(BaseModel):
    """Tiers are evaluated in input order; the first fitting tier is selected."""

    name: str = Field(min_length=1)
    max_commands_per_second: float = Field(gt=0)
    max_memory_bytes: float = Field(gt=0)
    max_network_mbps: float = Field(gt=0)
    monthly_price: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CostInputV1(BaseModel):
    schema_version: Literal[1] = 1
    monthly_runs: int = Field(ge=0)
    peak_rps: float = Field(ge=0)
    billing_period_seconds: float = Field(gt=0)
    retention_seconds: float = Field(ge=0)
    usage_weights: dict[ScenarioId, float] | None = None
    peak_weights: dict[ScenarioId, float] | None = None
    billable_egress_ratio: float | None = Field(default=None, ge=0, le=1)
    e2b_billing: E2BBillingV1 | None = None
    redis_tiers: list[RedisTierV1] = Field(default_factory=list)
    acu_monthly_price: float | None = Field(default=None, ge=0)
    e2b_price_per_billed_second: float | None = Field(default=None, ge=0)
    network_price_per_gib: float | None = Field(default=None, ge=0)

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

    @field_validator("redis_tiers")
    @classmethod
    def validate_redis_tier_names(cls, value: list[RedisTierV1]) -> list[RedisTierV1]:
        names = [tier.name for tier in value]
        if len(names) != len(set(names)):
            raise ValueError("redis_tiers names must be unique")
        return value


class CostSourceV1(BaseModel):
    capacity_result_path: str
    mode: BenchmarkMode
    commit: str
    content_hash: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CostDemandV1(BaseModel):
    monthly_runs: int = Field(ge=0)
    peak_rps: float = Field(ge=0)
    billing_period_seconds: float = Field(gt=0)
    retention_seconds: float = Field(ge=0)
    usage_weights: dict[ScenarioId, float] | None = None
    peak_weights: dict[ScenarioId, float] | None = None
    billable_egress_ratio: float | None = Field(default=None, ge=0, le=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentCostV1(BaseModel):
    status: Literal["calculated", "incomplete"]
    capacity_runs_per_second: float | None = Field(default=None, ge=0)
    acu: int | None = Field(default=None, ge=0)
    monthly_cost: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RedisCostV1(BaseModel):
    status: Literal["calculated", "incomplete"]
    capacity_recommendation: Literal["selected", "no_capacity_recommendation"] | None = None
    commands_per_run: float | None = Field(default=None, ge=0)
    peak_commands_per_second: float | None = Field(default=None, ge=0)
    monthly_commands: float | None = Field(default=None, ge=0)
    storage_bytes_per_run: float | None = Field(default=None, ge=0)
    retained_bytes: float | None = Field(default=None, ge=0)
    network_kb_per_run: float | None = Field(default=None, ge=0)
    peak_network_mbps: float | None = Field(default=None, ge=0)
    selected_tier: str | None = None
    monthly_cost: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class E2BCostV1(BaseModel):
    status: ComponentStatus
    active_seconds_per_run: float | None = Field(default=None, ge=0)
    billed_seconds_per_run: float | None = Field(default=None, ge=0)
    monthly_billed_seconds: float | None = Field(default=None, ge=0)
    monthly_cost: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class NetworkCostV1(BaseModel):
    status: Literal["calculated", "incomplete"]
    observed_kb_per_run: float | None = Field(default=None, ge=0)
    billable_egress_ratio: float | None = Field(default=None, ge=0, le=1)
    monthly_billable_gib: float | None = Field(default=None, ge=0)
    monthly_cost: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CostEstimateV1(BaseModel):
    status: ScenarioStatus
    selected_concurrency: int | None = Field(default=None, ge=1)
    terminal_p95_ms: float | None = Field(default=None, ge=0)
    agent_cpu_ms_per_run: float | None = Field(default=None, ge=0)
    agent_memory_peak_mib: float | None = Field(default=None, ge=0)
    agent: AgentCostV1
    redis: RedisCostV1
    e2b: E2BCostV1
    network: NetworkCostV1
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
    redis_commands_per_run: float = Field(ge=0)
    redis_storage_bytes_per_run: float = Field(ge=0)
    redis_network_kb_per_run: float = Field(ge=0)
    agent_network_kb_per_run: float = Field(ge=0)
    e2b_applicable: bool
    e2b_active_seconds_per_run: float | None = Field(default=None, ge=0)
    e2b_billed_seconds_per_run: float | None = Field(default=None, ge=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


def calculate_cost_result(*, capacity_result_path: Path, cost_input: CostInputV1) -> CostResultV1:
    capacity_result_path = capacity_result_path.resolve()
    capacity = CapacityResult.model_validate_json(capacity_result_path.read_text())
    if capacity.schema_version != 1:
        raise ValueError(f"unsupported capacity result schema {capacity.schema_version}")
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
                warnings=point_warnings,
            )
            warnings.append(f"{scenario_id}: no valid capacity point")
            continue
        metrics, evidence_warnings = _load_selected_metrics(
            capacity_result_path=capacity_result_path,
            capacity=capacity,
            point=selected,
            samples=samples,
            billing=cost_input.e2b_billing,
        )
        point_warnings.extend(evidence_warnings)
        if metrics is None:
            estimates[scenario_id] = _incomplete_estimate(
                e2b_applicable=capacity.mode == "local-e2b" and scenario_id != "basic",
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
        demand=CostDemandV1(
            monthly_runs=cost_input.monthly_runs,
            peak_rps=cost_input.peak_rps,
            billing_period_seconds=cost_input.billing_period_seconds,
            retention_seconds=cost_input.retention_seconds,
            usage_weights=cost_input.usage_weights,
            peak_weights=cost_input.peak_weights,
            billable_egress_ratio=cost_input.billable_egress_ratio,
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
    billing: E2BBillingV1 | None,
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
    if (
        point.redis_commands_per_run is None
        or point.redis_network_kb_per_run is None
        or point.agent_network_kb_per_run is None
    ):
        return None, ["selected point lacks Redis commands, Redis network, or Agent network metrics"]
    selected_samples = [
        sample for sample in samples if sample.block_id == block.block_id and sample.terminal_status == "succeeded"
    ]
    if len(selected_samples) != block.outcomes.successful_runs:
        return None, ["selected samples.jsonl successful Run count does not match the block"]

    storage_delta = block.redis_after.storage_bytes - block.redis_before.storage_bytes
    if storage_delta < 0:
        return None, ["selected block has a negative Redis storage delta"]
    e2b_applicable = capacity.mode == "local-e2b" and point.scenario_id != "basic"
    active_per_run = None
    billed_per_run = None
    warnings: list[str] = []
    if e2b_applicable:
        active_values = [sample.e2b_active_seconds for sample in selected_samples]
        if any(value is None for value in active_values):
            warnings.append("one or more successful samples lack E2B active seconds")
        else:
            active = [cast(float, value) for value in active_values]
            active_per_run = sum(active) / len(active)
            if billing is None:
                warnings.append("E2B billing minimum and increment are missing")
            else:
                billed = [_bill_e2b_seconds(value, billing) for value in active]
                billed_per_run = sum(billed) / len(billed)
    return (
        _UnitMetrics(
            capacity_runs_per_second=point.runs_per_second,
            terminal_p95_ms=point.terminal_p95_ms,
            agent_cpu_ms_per_run=point.agent_cpu_ms_per_run,
            agent_memory_peak_mib=point.agent_memory_peak_mib,
            redis_commands_per_run=point.redis_commands_per_run,
            redis_storage_bytes_per_run=storage_delta / block.outcomes.successful_runs,
            redis_network_kb_per_run=point.redis_network_kb_per_run,
            agent_network_kb_per_run=point.agent_network_kb_per_run,
            e2b_applicable=e2b_applicable,
            e2b_active_seconds_per_run=active_per_run,
            e2b_billed_seconds_per_run=billed_per_run,
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


def _bill_e2b_seconds(active_seconds: float, billing: E2BBillingV1) -> float:
    increments = math.ceil(max(0, active_seconds - 1e-12) / billing.increment_seconds)
    return max(billing.minimum_seconds, increments * billing.increment_seconds)


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
    agent = _agent_cost(peak_metrics, cost_input)
    redis = _redis_cost(peak_metrics, usage_metrics, cost_input)
    network = _network_cost(usage_metrics, cost_input)
    e2b = _e2b_cost(usage_metrics, mode, cost_input)
    estimate_warnings = list(warnings)
    if agent.status == "incomplete":
        estimate_warnings.append("Agent peak capacity or ACU price is incomplete")
    if redis.capacity_recommendation == "no_capacity_recommendation":
        estimate_warnings.append("no Redis tier satisfies peak commands, retained memory, and peak network")
    elif redis.status == "incomplete":
        estimate_warnings.append("Redis capacity evidence or selected-tier price is incomplete")
    if network.status == "incomplete":
        estimate_warnings.append("network usage ratio, usage weights, or price is incomplete")
    if e2b.status == "incomplete":
        estimate_warnings.append("E2B usage, billing rule, or price is incomplete")
    components_complete = (
        agent.status == "calculated"
        and redis.status == "calculated"
        and network.status == "calculated"
        and e2b.status in {"calculated", "not_applicable"}
    )
    cost_values = [agent.monthly_cost, redis.monthly_cost, network.monthly_cost]
    if e2b.status != "not_applicable":
        cost_values.append(e2b.monthly_cost)
    total = _total_cost(*cost_values) if components_complete else None
    return CostEstimateV1(
        status="complete" if components_complete else "incomplete",
        selected_concurrency=selected_concurrency,
        terminal_p95_ms=terminal_p95_ms,
        agent_cpu_ms_per_run=(usage_metrics.agent_cpu_ms_per_run if usage_metrics is not None else None),
        agent_memory_peak_mib=memory_peak_mib,
        agent=agent,
        redis=redis,
        e2b=e2b,
        network=network,
        total_monthly_cost=total,
        warnings=list(dict.fromkeys(estimate_warnings)),
    )


def _agent_cost(metrics: _UnitMetrics | None, cost_input: CostInputV1) -> AgentCostV1:
    if metrics is None:
        return AgentCostV1(status="incomplete")
    acu = math.ceil(cost_input.peak_rps / metrics.capacity_runs_per_second)
    price = cost_input.acu_monthly_price
    return AgentCostV1(
        status="calculated" if price is not None else "incomplete",
        capacity_runs_per_second=metrics.capacity_runs_per_second,
        acu=acu,
        monthly_cost=None if price is None else acu * price,
    )


def _redis_cost(
    peak_metrics: _UnitMetrics | None,
    usage_metrics: _UnitMetrics | None,
    cost_input: CostInputV1,
) -> RedisCostV1:
    peak_commands = cost_input.peak_rps * peak_metrics.redis_commands_per_run if peak_metrics is not None else None
    peak_network = (
        cost_input.peak_rps * peak_metrics.redis_network_kb_per_run * 8 / 1000 if peak_metrics is not None else None
    )
    monthly_commands = (
        cost_input.monthly_runs * usage_metrics.redis_commands_per_run if usage_metrics is not None else None
    )
    retained_bytes = (
        cost_input.monthly_runs
        / cost_input.billing_period_seconds
        * usage_metrics.redis_storage_bytes_per_run
        * cost_input.retention_seconds
        if usage_metrics is not None
        else None
    )
    selected = None
    if peak_commands is not None and peak_network is not None and retained_bytes is not None:
        selected = next(
            (
                tier
                for tier in cost_input.redis_tiers
                if tier.max_commands_per_second >= peak_commands
                and tier.max_memory_bytes >= retained_bytes
                and tier.max_network_mbps >= peak_network
            ),
            None,
        )
    recommendation = None
    if peak_metrics is not None and usage_metrics is not None:
        recommendation = "selected" if selected is not None else "no_capacity_recommendation"
    calculated = selected is not None and selected.monthly_price is not None
    return RedisCostV1(
        status="calculated" if calculated else "incomplete",
        capacity_recommendation=cast(
            Literal["selected", "no_capacity_recommendation"] | None,
            recommendation,
        ),
        commands_per_run=(usage_metrics.redis_commands_per_run if usage_metrics is not None else None),
        peak_commands_per_second=peak_commands,
        monthly_commands=monthly_commands,
        storage_bytes_per_run=(usage_metrics.redis_storage_bytes_per_run if usage_metrics is not None else None),
        retained_bytes=retained_bytes,
        network_kb_per_run=(peak_metrics.redis_network_kb_per_run if peak_metrics is not None else None),
        peak_network_mbps=peak_network,
        selected_tier=selected.name if selected is not None else None,
        monthly_cost=selected.monthly_price if selected is not None else None,
    )


def _network_cost(metrics: _UnitMetrics | None, cost_input: CostInputV1) -> NetworkCostV1:
    if metrics is None:
        return NetworkCostV1(status="incomplete")
    ratio = cost_input.billable_egress_ratio
    gib = (
        cost_input.monthly_runs * metrics.agent_network_kb_per_run * 1000 / _GIB_BYTES * ratio
        if ratio is not None
        else None
    )
    price = cost_input.network_price_per_gib
    return NetworkCostV1(
        status="calculated" if gib is not None and price is not None else "incomplete",
        observed_kb_per_run=metrics.agent_network_kb_per_run,
        billable_egress_ratio=ratio,
        monthly_billable_gib=gib,
        monthly_cost=(gib * price if gib is not None and price is not None else None),
    )


def _e2b_cost(metrics: _UnitMetrics | None, mode: BenchmarkMode, cost_input: CostInputV1) -> E2BCostV1:
    if mode == "local-runtime" or (metrics is not None and not metrics.e2b_applicable):
        return E2BCostV1(status="not_applicable")
    if metrics is None:
        return E2BCostV1(status="incomplete")
    billed = metrics.e2b_billed_seconds_per_run
    monthly_billed = cost_input.monthly_runs * billed if billed is not None else None
    price = cost_input.e2b_price_per_billed_second
    return E2BCostV1(
        status="calculated" if monthly_billed is not None and price is not None else "incomplete",
        active_seconds_per_run=metrics.e2b_active_seconds_per_run,
        billed_seconds_per_run=billed,
        monthly_billed_seconds=monthly_billed,
        monthly_cost=(monthly_billed * price if monthly_billed is not None and price is not None else None),
    )


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

    def weighted(attribute: str) -> float:
        return sum(
            weights[scenario_id] * cast(float, getattr(metrics[scenario_id], attribute)) for scenario_id in selected
        )

    cpu = None
    if all(metrics[scenario_id].agent_cpu_ms_per_run is not None for scenario_id in selected):
        cpu = sum(
            weights[scenario_id] * cast(float, metrics[scenario_id].agent_cpu_ms_per_run) for scenario_id in selected
        )
    e2b_applicable = mode == "local-e2b" and any(scenario_id != "basic" for scenario_id in selected)
    active = None
    billed = None
    if e2b_applicable:
        applicable = cast(list[ScenarioId], [scenario_id for scenario_id in selected if scenario_id != "basic"])
        if all(metrics[scenario_id].e2b_active_seconds_per_run is not None for scenario_id in applicable):
            active = sum(
                weights[scenario_id] * cast(float, metrics[scenario_id].e2b_active_seconds_per_run)
                for scenario_id in applicable
            )
        if all(metrics[scenario_id].e2b_billed_seconds_per_run is not None for scenario_id in applicable):
            billed = sum(
                weights[scenario_id] * cast(float, metrics[scenario_id].e2b_billed_seconds_per_run)
                for scenario_id in applicable
            )
    return _UnitMetrics(
        capacity_runs_per_second=capacity,
        agent_cpu_ms_per_run=cpu,
        redis_commands_per_run=weighted("redis_commands_per_run"),
        redis_storage_bytes_per_run=weighted("redis_storage_bytes_per_run"),
        redis_network_kb_per_run=weighted("redis_network_kb_per_run"),
        agent_network_kb_per_run=weighted("agent_network_kb_per_run"),
        e2b_applicable=e2b_applicable,
        e2b_active_seconds_per_run=active,
        e2b_billed_seconds_per_run=billed,
    )


def _incomplete_estimate(
    *,
    e2b_applicable: bool,
    warnings: Sequence[str],
    selected_concurrency: int | None = None,
) -> CostEstimateV1:
    return CostEstimateV1(
        status="incomplete",
        selected_concurrency=selected_concurrency,
        agent=AgentCostV1(status="incomplete"),
        redis=RedisCostV1(status="incomplete"),
        e2b=E2BCostV1(status="incomplete" if e2b_applicable else "not_applicable"),
        network=NetworkCostV1(status="incomplete"),
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


def _total_cost(*values: float | None) -> float | None:
    return None if any(value is None for value in values) else sum(cast(float, value) for value in values)


def render_cost_report(result: CostResultV1) -> str:
    demand = result.demand
    lines = [
        f"# Dify Agent cost model: {result.source.mode}",
        "",
        "> Derived from local benchmark evidence. This is not a SaaS SLO or Kubernetes sizing recommendation.",
        "",
        "## Source and assumptions",
        "",
        f"- Capacity result: `{result.source.capacity_result_path}`",
        f"- Commit/content: `{result.source.commit}` / `{result.source.content_hash}`",
        f"- Monthly Runs: **{demand.monthly_runs}**",
        f"- Peak Runs/s: **{_number(demand.peak_rps)}**",
        f"- Billing period: **{_number(demand.billing_period_seconds)} seconds**",
        f"- Retention: **{_number(demand.retention_seconds)} seconds**",
        f"- Billable egress ratio: **{_number(demand.billable_egress_ratio)}**",
        f"- Capacity matrix complete: `{str(result.matrix_complete).lower()}`",
        f"- Cost result complete: `{str(result.complete).lower()}`",
        "",
        "## Pure scenarios",
        "",
        "| Scenario | Status | C | Runs/s | ACU / $ | Redis cmd/s | Retained MiB | Redis tier / $ | "
        "E2B active / billed s/run | E2B monthly s / $ | Network GiB / $ | Total $ |",
        "|---|---|---:|---:|---:|---:|---:|---|---|---|---|---:|",
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
            "- Peak weights drive harmonic Agent capacity and Redis peak commands/network.",
            "- Usage weights drive monthly Redis commands/retained bytes, E2B time, and billable network.",
            "- E2B rounds every successful Run before averaging; Basic and local-runtime are not applicable.",
            "- Network starts from Agent container KB/run; the egress ratio is an explicit planning assumption.",
            "- Missing prices remain `null` and incomplete; zero prices remain calculated zero.",
            "- No Pod, Node, or Kubernetes equivalent is produced.",
            "",
        ]
    )
    return "\n".join(lines)


def _report_row(label: str, estimate: CostEstimateV1) -> str:
    retained_mib = estimate.redis.retained_bytes / 1024**2 if estimate.redis.retained_bytes is not None else None
    return (
        f"| `{label}` | `{estimate.status}` | {_number(estimate.selected_concurrency)} | "
        f"{_number(estimate.agent.capacity_runs_per_second)} | {_pair(estimate.agent.acu, estimate.agent.monthly_cost)} | "
        f"{_number(estimate.redis.peak_commands_per_second)} | {_number(retained_mib)} | "
        f"{estimate.redis.selected_tier or 'N/A'} / {_number(estimate.redis.monthly_cost)} | "
        f"{_pair(estimate.e2b.active_seconds_per_run, estimate.e2b.billed_seconds_per_run)} | "
        f"{_pair(estimate.e2b.monthly_billed_seconds, estimate.e2b.monthly_cost)} | "
        f"{_pair(estimate.network.monthly_billable_gib, estimate.network.monthly_cost)} | "
        f"{_number(estimate.total_monthly_cost)} |"
    )


def _pair(left: float | int | None, right: float | int | None) -> str:
    return f"{_number(left)} / {_number(right)}"


def _number(value: float | int | None) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, int):
        return str(value)
    return f"{value:.6g}"


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capacity-result", type=Path, required=True)
    parser.add_argument("--cost-input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    capacity_result_path = cast(Path, args.capacity_result).resolve()
    cost_input = CostInputV1.model_validate_json(cast(Path, args.cost_input).read_text())
    result = calculate_cost_result(capacity_result_path=capacity_result_path, cost_input=cost_input)
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
