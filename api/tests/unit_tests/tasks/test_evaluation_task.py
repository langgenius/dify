"""Unit tests for evaluation task judgment aggregation helpers."""

from core.evaluation.entities.evaluation_entity import EvaluationItemResult, EvaluationMetric
from core.evaluation.entities.judgment_entity import (
    JudgmentCondition,
    JudgmentConfig,
    JudgmentResult,
)
from tasks.evaluation_task import _compute_metrics_summary


def test_compute_metrics_summary_includes_judgment_counts() -> None:
    """Summary should expose pass/fail counts when judgment rules are configured."""
    # Arrange
    judgment_config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                metric_name="faithfulness",
                comparison_operator=">",
                condition_value="0.8",
                condition_type="number",
            )
        ],
    )
    results = [
        EvaluationItemResult(
            index=0,
            metrics=[EvaluationMetric(name="faithfulness", value=0.9)],
            judgment=JudgmentResult(passed=True, logical_operator="and", condition_results=[]),
        ),
        EvaluationItemResult(
            index=1,
            metrics=[EvaluationMetric(name="faithfulness", value=0.4)],
            judgment=JudgmentResult(passed=False, logical_operator="and", condition_results=[]),
        ),
        EvaluationItemResult(index=2, error="timeout"),
    ]

    # Act
    summary = _compute_metrics_summary(results, judgment_config)

    # Assert
    assert summary["faithfulness"] == {
        "average": 0.65,
        "min": 0.4,
        "max": 0.9,
        "count": 2,
    }
    assert summary["_judgment"] == {
        "enabled": True,
        "logical_operator": "and",
        "configured_conditions": 1,
        "evaluated_items": 2,
        "passed_items": 1,
        "failed_items": 1,
        "pass_rate": 0.5,
    }
