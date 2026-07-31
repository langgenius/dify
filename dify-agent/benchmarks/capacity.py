"""Capacity matrix expansion, aggregation, and human-readable reporting."""

from __future__ import annotations

import math
from typing import ClassVar, Sequence

from pydantic import BaseModel, ConfigDict, Field

from benchmarks.scenario import BenchmarkMode, CapacityScenario, ScenarioManifest
from benchmarks.schemas import BlockResult, CapacityPoint, CapacityResult


CONCURRENCY_LEVELS = (1, 10, 20)


class CapacityMatrixPoint(BaseModel):
    """One scenario/concurrency point before execution."""

    mode: BenchmarkMode
    scenario: CapacityScenario
    requested_concurrency: int = Field(ge=1)
    minimum_successful_runs: int = Field(ge=1)
    warmup_seconds: float = Field(default=15, ge=0)
    measurement_seconds: float = Field(default=60, gt=0)
    maximum_seconds: float = Field(default=180, gt=0)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


def build_capacity_matrix(
    *,
    mode: BenchmarkMode,
    manifest: ScenarioManifest,
    scenario_id: str | None = None,
    concurrency: int | None = None,
) -> list[CapacityMatrixPoint]:
    """Expand the fixed five-by-three matrix, with optional debug filters."""
    scenarios = manifest.scenarios
    if scenario_id is not None:
        scenarios = [manifest.get(scenario_id)]
    levels = CONCURRENCY_LEVELS if concurrency is None else (concurrency,)
    if any(level not in CONCURRENCY_LEVELS for level in levels):
        raise ValueError("BENCH_CONCURRENCY must be one of 1, 10, or 20")
    return [
        CapacityMatrixPoint(
            mode=mode,
            scenario=scenario,
            requested_concurrency=level,
            minimum_successful_runs=10 if scenario.workload == "file" else 100,
        )
        for scenario in scenarios
        for level in levels
    ]


def aggregate_capacity_point(block: BlockResult) -> CapacityPoint:
    """Convert one measured block into the stable, friendly-unit report row."""
    reasons = list(block.invalid_reasons)
    successful_samples = [sample for sample in block.samples if sample.terminal_status == "succeeded"]
    terminal_values = [
        sample.terminal_e2e_ms for sample in successful_samples if sample.terminal_e2e_ms is not None
    ]
    e2b_active_values = [
        sample.e2b_active_seconds for sample in successful_samples if sample.e2b_active_seconds is not None
    ]
    enough_samples = block.outcomes.successful_runs >= block.minimum_successful_runs
    enough_concurrency = block.outcomes.observed_max_active >= math.ceil(0.9 * block.requested_concurrency)
    if not enough_samples:
        reasons.append(
            f"completed {block.outcomes.successful_runs} successful Runs; "
            f"{block.minimum_successful_runs} required"
        )
    if not enough_concurrency:
        reasons.append(
            f"observed max active {block.outcomes.observed_max_active} was below 90% of "
            f"requested concurrency {block.requested_concurrency}"
        )
    missing_e2b_active = (
        block.mode == "local-e2b"
        and block.workload != "basic"
        and len(e2b_active_values) != len(successful_samples)
    )
    if missing_e2b_active:
        reasons.append("one or more successful Runs lacked E2B active-window evidence")

    correctness_invalid = missing_e2b_active or not block.valid or any(
        not sample.ledger_valid or not sample.event_replay_valid or not sample.cleanup_valid
        for sample in block.samples
        if sample.terminal_status == "succeeded"
    )
    saturated = (
        not enough_samples
        or not enough_concurrency
        or block.outcomes.timeout_runs > 0
        or block.outcomes.throttle_runs > 0
    )
    if correctness_invalid or (block.requested_concurrency == 1 and saturated):
        status = "invalid"
    elif saturated:
        status = "saturated"
    else:
        status = "valid"

    agent = block.resources.components.get("agent")
    redis_network = None
    if block.outcomes.successful_runs:
        input_delta = max(
            0,
            block.redis_after.total_net_input_bytes - block.redis_before.total_net_input_bytes,
        )
        output_delta = max(
            0,
            block.redis_after.total_net_output_bytes - block.redis_before.total_net_output_bytes,
        )
        redis_network = (input_delta + output_delta) / block.outcomes.successful_runs / 1000
    payload_mib_per_second = None
    if block.workload == "file" and block.elapsed_seconds > 0:
        payload_mib_per_second = (
            block.outcomes.successful_runs
            * block.samples[0].payload_bytes
            / 1024**2
            / block.elapsed_seconds
            if block.samples
            else 0
        )
    return CapacityPoint(
        mode=block.mode,
        scenario_id=block.scenario_id,
        workload=block.workload,
        requested_concurrency=block.requested_concurrency,
        observed_max_active=block.outcomes.observed_max_active,
        attempted_runs=block.outcomes.attempted_runs,
        successful_runs=block.outcomes.successful_runs,
        timeout_runs=block.outcomes.timeout_runs,
        throttle_runs=block.outcomes.throttle_runs,
        success_rate=block.outcomes.success_rate,
        terminal_p95_ms=_percentile(terminal_values, 0.95),
        runs_per_second=block.outcomes.runs_per_second,
        agent_cpu_ms_per_run=agent.cpu_ms_per_run if agent is not None else None,
        agent_memory_peak_mib=agent.memory_peak_mib if agent is not None else None,
        e2b_active_seconds_per_run=_mean(e2b_active_values),
        redis_commands_per_run=block.resources.redis_commands_per_run,
        redis_network_kb_per_run=redis_network,
        agent_network_kb_per_run=(
            agent.network_bytes_per_run / 1000
            if agent is not None and agent.network_bytes_per_run is not None
            else None
        ),
        payload_mib_per_second=payload_mib_per_second,
        status=status,
        reasons=reasons,
    )


def render_capacity_markdown(result: CapacityResult) -> str:
    """Render one compact report without quotas, SLOs, or monetary estimates."""
    lines = [
        f"# Dify Agent capacity: {result.mode}",
        "",
        "> Local benchmark reference only. This report is not a SaaS SLO or production capacity promise.",
        "",
        "## Environment",
        "",
        "- Agent capacity unit: **2 vCPU / 2 GiB**, one worker",
        f"- Commit: `{result.target.commit}` ({'dirty worktree' if result.target.dirty else 'clean worktree'})",
        f"- Matrix complete: `{str(result.matrix_complete).lower()}`",
        f"- Docker: `{result.environment.docker_engine}` on `{result.environment.architecture}`",
    ]
    if result.environment.e2b_template:
        lines.append(f"- E2B template: `{result.environment.e2b_template}`")
    lines.extend(
        [
            "",
            "## Capacity points",
            "",
            "| Scenario | C | Active | Success | p95 ms | Runs/s | CPU-ms/run | "
            "Memory peak MiB | E2B active s/run | Redis commands/run | "
            "Agent network KB/run | Status |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
        ]
    )
    for point in sorted(result.points, key=lambda item: (item.scenario_id, item.requested_concurrency)):
        lines.append(
            f"| `{point.scenario_id}` | {point.requested_concurrency} | {point.observed_max_active} | "
            f"{point.successful_runs}/{point.attempted_runs} | {_number(point.terminal_p95_ms)} | "
            f"{_number(point.runs_per_second)} | {_number(point.agent_cpu_ms_per_run)} | "
            f"{_number(point.agent_memory_peak_mib)} | {_number(point.e2b_active_seconds_per_run)} | "
            f"{_number(point.redis_commands_per_run)} | {_number(point.agent_network_kb_per_run)} | "
            f"`{point.status}` |"
        )
    file_points = [point for point in result.points if point.workload == "file"]
    if file_points:
        lines.extend(
            [
                "",
                "## File throughput",
                "",
                "| C | Payload MiB/s | Redis network KB/run |",
                "|---:|---:|---:|",
            ]
        )
        for point in sorted(file_points, key=lambda item: item.requested_concurrency):
            lines.append(
                f"| {point.requested_concurrency} | {_number(point.payload_mib_per_second)} | "
                f"{_number(point.redis_network_kb_per_run)} |"
            )
    invalid = [point for point in result.points if point.reasons]
    if invalid:
        lines.extend(["", "## Point diagnostics", ""])
        for point in invalid:
            lines.append(
                f"- `{point.scenario_id}` c{point.requested_concurrency}: "
                + "; ".join(point.reasons)
            )
    lines.extend(
        [
            "",
            "## Cost-model inputs",
            "",
            "- Agent: use the measured `runs/s`, `CPU-ms/run`, and memory peak for one 2 vCPU / 2 GiB unit.",
            "- Redis: multiply `commands/run` by the expected Run count, then compare with cluster headroom.",
            "- E2B: multiply `active-seconds/run` by Run count, then apply the vendor contract; it is not billed time.",
            "- Network: raw bytes remain in `result.json`; KB/run is observed container traffic, not cloud billable egress.",
            "- No Pod, Node, Redis-cluster, E2B-plan, quota, or monetary recommendation is generated.",
            "",
        ]
    )
    return "\n".join(lines)


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _percentile(values: Sequence[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _number(value: float | int | None) -> str:
    return "N/A" if value is None else f"{value:.3f}"


__all__ = [
    "CONCURRENCY_LEVELS",
    "CapacityMatrixPoint",
    "aggregate_capacity_point",
    "build_capacity_matrix",
    "render_capacity_markdown",
]
