"""Deterministic local A/B statistics with honest ABBA sample semantics."""

from collections.abc import Callable, Sequence
import math
import random
import statistics
from typing import Literal, cast

from benchmarks.schemas import MetricComparison


Statistic = Callable[[Sequence[float]], float]


def quantile(values: Sequence[float], probability: float) -> float:
    """Return a linearly interpolated quantile without external dependencies."""
    if not values:
        raise ValueError("quantile requires at least one value")
    if not 0 <= probability <= 1:
        raise ValueError("probability must be between zero and one")
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def p95(values: Sequence[float]) -> float:
    """Return the p95 value used by latency regression reports."""
    return quantile(values, 0.95)


def unpaired_bootstrap_relative_change(
    baseline: Sequence[float],
    candidate: Sequence[float],
    *,
    statistic: Statistic,
    iterations: int = 2_000,
    seed: int = 20260729,
) -> tuple[float, float]:
    """Bootstrap independent run samples and return the 95% relative-change interval."""
    if not baseline or not candidate:
        raise ValueError("unpaired bootstrap requires non-empty samples")
    randomizer = random.Random(seed)
    changes: list[float] = []
    for _ in range(iterations):
        baseline_stat = statistic(randomizer.choices(baseline, k=len(baseline)))
        candidate_stat = statistic(randomizer.choices(candidate, k=len(candidate)))
        if baseline_stat == 0:
            continue
        changes.append((candidate_stat / baseline_stat - 1) * 100)
    if not changes:
        raise ValueError("bootstrap cannot calculate relative change from zero baseline")
    return quantile(changes, 0.025), quantile(changes, 0.975)


def blocked_bootstrap_relative_change(
    baseline_blocks: Sequence[Sequence[float]],
    candidate_blocks: Sequence[Sequence[float]],
    *,
    statistic: Statistic,
    iterations: int = 2_000,
    seed: int = 20260729,
) -> tuple[float, float]:
    """Bootstrap ABBA block pairs, then independent runs within each selected block."""
    if len(baseline_blocks) != len(candidate_blocks) or not baseline_blocks:
        raise ValueError("blocked bootstrap requires equally sized non-empty block collections")
    if any(not block for block in [*baseline_blocks, *candidate_blocks]):
        raise ValueError("blocked bootstrap requires non-empty blocks")
    randomizer = random.Random(seed)
    indexes = range(len(baseline_blocks))
    changes: list[float] = []
    for _ in range(iterations):
        baseline_sample: list[float] = []
        candidate_sample: list[float] = []
        for index in randomizer.choices(indexes, k=len(baseline_blocks)):
            baseline_block = baseline_blocks[index]
            candidate_block = candidate_blocks[index]
            baseline_sample.extend(randomizer.choices(baseline_block, k=len(baseline_block)))
            candidate_sample.extend(randomizer.choices(candidate_block, k=len(candidate_block)))
        baseline_stat = statistic(baseline_sample)
        candidate_stat = statistic(candidate_sample)
        if baseline_stat != 0:
            changes.append((candidate_stat / baseline_stat - 1) * 100)
    if not changes:
        raise ValueError("bootstrap cannot calculate relative change from zero baseline")
    return quantile(changes, 0.025), quantile(changes, 0.975)


def compare_latency(
    baseline: Sequence[float],
    candidate: Sequence[float],
    *,
    relative_threshold_percent: float = 10,
    absolute_threshold: float = 1,
) -> MetricComparison:
    """Compare p95 latency and classify a local report-only result."""
    return compare_quantile_latency(
        baseline,
        candidate,
        probability=0.95,
        relative_threshold_percent=relative_threshold_percent,
        absolute_threshold=absolute_threshold,
    )


def compare_quantile_latency(
    baseline: Sequence[float],
    candidate: Sequence[float],
    *,
    probability: float,
    relative_threshold_percent: float = 10,
    absolute_threshold: float = 1,
) -> MetricComparison:
    """Compare one latency quantile and classify a local report-only result."""
    return _compare_samples(
        baseline,
        candidate,
        statistic=lambda values: quantile(values, probability),
        regression_direction="increase",
        relative_threshold_percent=relative_threshold_percent,
        absolute_threshold=absolute_threshold,
    )


def compare_blocked_quantile_latency(
    baseline_blocks: Sequence[Sequence[float]],
    candidate_blocks: Sequence[Sequence[float]],
    *,
    probability: float,
    relative_threshold_percent: float = 10,
    absolute_threshold: float = 1,
) -> MetricComparison:
    """Compare latency while preserving ABBA blocks as the resampling unit."""
    baseline = [value for block in baseline_blocks for value in block]
    candidate = [value for block in candidate_blocks for value in block]
    if not baseline or not candidate:
        return _unavailable_comparison()

    def statistic(values: Sequence[float]) -> float:
        return quantile(values, probability)

    baseline_stat = statistic(baseline)
    candidate_stat = statistic(candidate)
    try:
        interval = blocked_bootstrap_relative_change(
            baseline_blocks,
            candidate_blocks,
            statistic=statistic,
        )
    except ValueError:
        interval = None
    return _resolve_comparison(
        baseline_stat=baseline_stat,
        candidate_stat=candidate_stat,
        interval=interval,
        method="blocked_bootstrap",
        pair_count=min(len(baseline_blocks), len(candidate_blocks)),
        regression_direction="increase",
        relative_threshold_percent=relative_threshold_percent,
        absolute_threshold=absolute_threshold,
    )


def compare_higher_is_better(
    baseline: Sequence[float],
    candidate: Sequence[float],
    *,
    relative_threshold_percent: float = 10,
) -> MetricComparison:
    """Compare a throughput-like metric where a decrease is a regression."""
    return _compare_samples(
        baseline,
        candidate,
        statistic=statistics.fmean,
        regression_direction="decrease",
        relative_threshold_percent=relative_threshold_percent,
        absolute_threshold=0,
    )


def compare_lower_is_better(
    baseline: Sequence[float],
    candidate: Sequence[float],
    *,
    relative_threshold_percent: float = 10,
) -> MetricComparison:
    """Compare a resource metric where an increase is a regression."""
    return _compare_samples(
        baseline,
        candidate,
        statistic=statistics.fmean,
        regression_direction="increase",
        relative_threshold_percent=relative_threshold_percent,
        absolute_threshold=0,
    )


def compare_redis_commands(baseline: Sequence[float], candidate: Sequence[float]) -> MetricComparison:
    """Flag only an extra command reproduced in every available ABBA pair."""
    comparison = compare_paired_blocks(
        baseline,
        candidate,
        regression_direction="increase",
        relative_threshold_percent=math.inf,
        absolute_threshold=math.inf,
    )
    pair_count = min(len(baseline), len(candidate))
    pair_increases = [candidate[index] - baseline[index] >= 1 for index in range(pair_count)]
    if pair_increases and all(pair_increases):
        comparison.verdict = "behavior_change"
    elif any(pair_increases):
        comparison.verdict = "inconclusive"
    return comparison


def compare_paired_blocks(
    baseline: Sequence[float],
    candidate: Sequence[float],
    *,
    regression_direction: Literal["increase", "decrease"],
    relative_threshold_percent: float = 10,
    absolute_threshold: float = 0,
) -> MetricComparison:
    """Compare the two ABBA pairs without manufacturing a confidence interval."""
    pair_count = min(len(baseline), len(candidate))
    if pair_count == 0:
        return _unavailable_comparison()
    paired_baseline = list(baseline[:pair_count])
    paired_candidate = list(candidate[:pair_count])
    baseline_stat = statistics.fmean(paired_baseline)
    candidate_stat = statistics.fmean(paired_candidate)
    regressions = [
        _is_regression(
            baseline_value=baseline_value,
            candidate_value=candidate_value,
            regression_direction=regression_direction,
            relative_threshold_percent=relative_threshold_percent,
            absolute_threshold=absolute_threshold,
        )
        for baseline_value, candidate_value in zip(paired_baseline, paired_candidate, strict=True)
    ]
    if regressions and all(regressions):
        verdict: Literal["no_regression", "possible_regression", "inconclusive"] = "possible_regression"
    elif any(regressions):
        verdict = "inconclusive"
    else:
        verdict = "no_regression"
    comparison = _resolve_comparison(
        baseline_stat=baseline_stat,
        candidate_stat=candidate_stat,
        interval=None,
        method="paired_block_consistency",
        pair_count=pair_count,
        regression_direction=regression_direction,
        relative_threshold_percent=relative_threshold_percent,
        absolute_threshold=absolute_threshold,
    )
    comparison.verdict = verdict
    return comparison


def _compare_samples(
    baseline: Sequence[float],
    candidate: Sequence[float],
    *,
    statistic: Statistic,
    regression_direction: str,
    relative_threshold_percent: float,
    absolute_threshold: float,
) -> MetricComparison:
    if not baseline or not candidate:
        return _unavailable_comparison()
    baseline_stat = statistic(baseline)
    candidate_stat = statistic(candidate)
    try:
        interval = unpaired_bootstrap_relative_change(
            baseline,
            candidate,
            statistic=statistic,
        )
    except ValueError:
        interval = None
    return _resolve_comparison(
        baseline_stat=baseline_stat,
        candidate_stat=candidate_stat,
        interval=interval,
        method="unpaired_bootstrap",
        pair_count=0,
        regression_direction=cast(Literal["increase", "decrease"], regression_direction),
        relative_threshold_percent=relative_threshold_percent,
        absolute_threshold=absolute_threshold,
    )


def _resolve_comparison(
    *,
    baseline_stat: float,
    candidate_stat: float,
    interval: tuple[float, float] | None,
    method: Literal["unpaired_bootstrap", "blocked_bootstrap", "paired_block_consistency"],
    pair_count: int,
    regression_direction: Literal["increase", "decrease"],
    relative_threshold_percent: float,
    absolute_threshold: float,
) -> MetricComparison:
    absolute_change = candidate_stat - baseline_stat
    relative_change = None if baseline_stat == 0 else (candidate_stat / baseline_stat - 1) * 100
    resolved_verdict: Literal[
        "no_regression",
        "possible_regression",
        "behavior_change",
        "inconclusive",
        "unavailable",
    ] = "no_regression"
    if interval is None or interval[0] <= 0 <= interval[1]:
        resolved_verdict = "inconclusive"
    elif _is_regression(
        baseline_value=baseline_stat,
        candidate_value=candidate_stat,
        regression_direction=regression_direction,
        relative_threshold_percent=relative_threshold_percent,
        absolute_threshold=absolute_threshold,
    ):
        resolved_verdict = "possible_regression"

    return MetricComparison(
        baseline=baseline_stat,
        candidate=candidate_stat,
        absolute_change=absolute_change,
        relative_change_percent=relative_change,
        confidence_interval_percent=interval,
        method=method,
        pair_count=pair_count,
        verdict=resolved_verdict,
    )


def _is_regression(
    *,
    baseline_value: float,
    candidate_value: float,
    regression_direction: Literal["increase", "decrease"],
    relative_threshold_percent: float,
    absolute_threshold: float,
) -> bool:
    if baseline_value == 0:
        return False
    absolute_change = candidate_value - baseline_value
    relative_change = (candidate_value / baseline_value - 1) * 100
    return (
        regression_direction == "increase"
        and relative_change > relative_threshold_percent
        and absolute_change > absolute_threshold
    ) or (
        regression_direction == "decrease"
        and relative_change < -relative_threshold_percent
        and -absolute_change > absolute_threshold
    )


def _unavailable_comparison() -> MetricComparison:
    return MetricComparison(
        baseline=None,
        candidate=None,
        absolute_change=None,
        relative_change_percent=None,
        confidence_interval_percent=None,
        method="unavailable",
        pair_count=0,
        verdict="unavailable",
    )


__all__ = [
    "blocked_bootstrap_relative_change",
    "compare_blocked_quantile_latency",
    "compare_higher_is_better",
    "compare_latency",
    "compare_lower_is_better",
    "compare_paired_blocks",
    "compare_quantile_latency",
    "compare_redis_commands",
    "p95",
    "quantile",
    "unpaired_bootstrap_relative_change",
]
