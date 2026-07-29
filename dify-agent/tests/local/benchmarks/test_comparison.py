import pytest

from benchmarks.comparison import (
    compare_blocked_quantile_latency,
    compare_higher_is_better,
    compare_latency,
    compare_paired_blocks,
    compare_redis_commands,
    quantile,
)


def test_quantile_interpolates_small_distributions() -> None:
    assert quantile([1, 2, 3, 4], 0.5) == 2.5
    assert quantile([1, 2, 3, 4], 0.95) == pytest.approx(3.85)


def test_latency_marks_clear_regression() -> None:
    baseline = [10 + index * 0.01 for index in range(50)]
    candidate = [13 + index * 0.01 for index in range(60)]

    comparison = compare_latency(baseline, candidate)

    assert comparison.verdict == "possible_regression"
    assert comparison.method == "unpaired_bootstrap"
    assert comparison.relative_change_percent is not None
    assert comparison.relative_change_percent > 20


def test_throughput_marks_clear_regression() -> None:
    comparison = compare_higher_is_better([100, 101, 99, 100], [80, 81, 79, 80])

    assert comparison.verdict == "possible_regression"
    assert comparison.relative_change_percent == pytest.approx(-20)


def test_noisy_samples_are_inconclusive() -> None:
    comparison = compare_latency(
        [10, 14, 9, 15, 10, 14, 9, 15],
        [10, 14, 9, 15, 10, 14, 9, 15],
    )

    assert comparison.verdict == "inconclusive"


def test_redis_command_increase_is_behavior_change() -> None:
    comparison = compare_redis_commands([10, 10], [11, 11])

    assert comparison.verdict == "behavior_change"


def test_redis_command_increase_in_only_one_abba_pair_is_inconclusive() -> None:
    comparison = compare_redis_commands([10, 10], [9, 12])

    assert comparison.verdict == "inconclusive"


def test_two_abba_block_pairs_use_descriptive_consistency_not_false_confidence() -> None:
    comparison = compare_paired_blocks(
        [100, 102],
        [80, 81],
        regression_direction="decrease",
    )

    assert comparison.verdict == "possible_regression"
    assert comparison.method == "paired_block_consistency"
    assert comparison.pair_count == 2
    assert comparison.confidence_interval_percent is None


def test_mixed_abba_block_directions_are_inconclusive() -> None:
    comparison = compare_paired_blocks(
        [100, 100],
        [80, 120],
        regression_direction="decrease",
    )

    assert comparison.verdict == "inconclusive"


def test_blocked_latency_bootstrap_does_not_pair_unrelated_run_ordinals() -> None:
    comparison = compare_blocked_quantile_latency(
        [[10 + index * 0.01 for index in range(40)], [10.2 + index * 0.01 for index in range(50)]],
        [[13 + index * 0.01 for index in range(50)], [13.2 + index * 0.01 for index in range(40)]],
        probability=0.95,
    )

    assert comparison.verdict == "possible_regression"
    assert comparison.method == "blocked_bootstrap"
    assert comparison.pair_count == 2
