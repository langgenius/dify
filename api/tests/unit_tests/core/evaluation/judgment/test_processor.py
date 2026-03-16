"""Unit tests for metric-based judgment evaluation."""

from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig
from core.evaluation.judgment.processor import JudgmentProcessor


def test_evaluate_uses_and_conditions_against_metric_values() -> None:
    """All conditions must pass when the logical operator is ``and``."""
    config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                metric_name="faithfulness",
                comparison_operator=">",
                condition_value="0.8",
                condition_type="number",
            ),
            JudgmentCondition(
                metric_name="answer_relevancy",
                comparison_operator="≥",
                condition_value="0.7",
                condition_type="number",
            ),
        ],
    )

    result = JudgmentProcessor.evaluate(
        {
            "faithfulness": 0.9,
            "answer_relevancy": 0.75,
        },
        config,
    )

    assert result.passed is True
    assert len(result.condition_results) == 2
    assert all(condition_result.passed for condition_result in result.condition_results)


def test_evaluate_sets_passed_false_when_any_and_condition_fails() -> None:
    """A failed metric comparison should make the overall judgment fail."""
    config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                metric_name="faithfulness",
                comparison_operator=">",
                condition_value="0.8",
                condition_type="number",
            ),
            JudgmentCondition(
                metric_name="answer_relevancy",
                comparison_operator="≥",
                condition_value="0.7",
                condition_type="number",
            ),
        ],
    )

    result = JudgmentProcessor.evaluate(
        {
            "faithfulness": 0.9,
            "answer_relevancy": 0.6,
        },
        config,
    )

    assert result.passed is False
    assert result.condition_results[-1].passed is False
