"""Tests for evaluation judgment conditions."""

from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig
from core.evaluation.judgment.processor import JudgmentProcessor


def test_evaluate_combines_node_scoped_metrics_with_and() -> None:
    config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                variable_selector=["llm-1", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            ),
            JudgmentCondition(
                variable_selector=["retrieval-1", "context_precision"],
                comparison_operator=">=",
                value="0.7",
            ),
        ],
    )

    result = JudgmentProcessor.evaluate(
        {
            ("llm-1", "faithfulness"): 0.9,
            ("retrieval-1", "context_precision"): 0.75,
        },
        config,
    )

    assert result.passed is True
    assert [condition.passed for condition in result.condition_results] == [True, True]
    assert config.conditions[1].comparison_operator == "≥"


def test_evaluate_reports_missing_metric() -> None:
    config = JudgmentConfig(
        conditions=[
            JudgmentCondition(
                variable_selector=["llm-1", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            )
        ]
    )

    result = JudgmentProcessor.evaluate({}, config)

    assert result.passed is False
    assert result.condition_results[0].error == (
        "Metric 'faithfulness' on node 'llm-1' not found in evaluation results"
    )


def test_evaluate_supports_workflow_string_operators() -> None:
    config = JudgmentConfig(
        logical_operator="or",
        conditions=[
            JudgmentCondition(
                variable_selector=["custom-evaluator", "label"],
                comparison_operator="contains",
                value="accepted",
            )
        ],
    )

    result = JudgmentProcessor.evaluate(
        {("custom-evaluator", "label"): "evaluation-accepted"},
        config,
    )

    assert result.passed is True
