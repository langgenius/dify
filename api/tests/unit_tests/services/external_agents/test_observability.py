"""Dispatch counts and nullable usage are independent of native workflow aggregates."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

from services.external_agents.observability import InvocationMetric, MetricBucket, aggregate_buckets, aggregate_metrics

NOW = datetime(2026, 11, 9, tzinfo=UTC)


def metric(identifier: str = "call", tokens: int | None = None) -> InvocationMetric:
    return InvocationMetric(identifier, "app", "production", NOW, NOW, NOW + timedelta(seconds=2), tokens)


def test_known_zero_counts_towards_coverage() -> None:
    result = aggregate_metrics([metric("a", 0), metric("b")])
    assert result.calls == 2
    assert result.reported_tokens == 0
    assert result.token_reporting_numerator == 1
    assert result.token_reporting_denominator == 2
    assert result.token_reporting_coverage == 0.5


def test_unknown_running_and_bad_times_still_count_calls() -> None:
    result = aggregate_metrics(
        [metric("a", 9), replace(metric("b"), ended_at=None), replace(metric("c"), ended_at=NOW - timedelta(seconds=1))]
    )
    assert result.calls == 3
    assert result.average_call_duration == 2
    assert result.reported_tokens == 9


def test_predispatch_tests_and_repeated_rows_do_not_inflate_calls() -> None:
    result = aggregate_metrics(
        [
            metric("a"),
            metric("a"),
            replace(metric("b"), origin="overview_test"),
            replace(metric("c"), dispatched_at=None),
        ]
    )
    assert result.calls == 1
    assert result.reported_tokens is None
    assert result.token_reporting_coverage == 0


def test_empty_values_are_not_zero_consumption() -> None:
    result = aggregate_metrics([])
    assert result.calls == 0
    assert result.reported_tokens is result.average_call_duration is result.token_reporting_coverage is None


def test_daily_summary_uses_additive_denominators() -> None:
    result = aggregate_buckets(
        [
            MetricBucket(NOW.date(), 1, 100, 1, 0, 1),
            MetricBucket((NOW + timedelta(days=1)).date(), 9, 9, 9, 0, 0),
        ]
    )
    assert result.calls == 10
    assert result.average_call_duration == 10.9
    assert result.reported_tokens == 0
    assert result.token_reporting_coverage == 0.1
