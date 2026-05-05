"""Unit tests for metric-based judgment evaluation."""

from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig
from core.evaluation.judgment.processor import JudgmentProcessor


def test_evaluate_uses_and_conditions_against_metric_values() -> None:
    """All conditions must pass when the logical operator is ``and``."""
    config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                variable_selector=["llm_node_1", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            ),
            JudgmentCondition(
                variable_selector=["llm_node_1", "answer_relevancy"],
                comparison_operator="≥",
                value="0.7",
            ),
        ],
    )

    result = JudgmentProcessor.evaluate(
        {
            ("llm_node_1", "faithfulness"): 0.9,
            ("llm_node_1", "answer_relevancy"): 0.75,
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
                variable_selector=["llm_node_1", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            ),
            JudgmentCondition(
                variable_selector=["llm_node_1", "answer_relevancy"],
                comparison_operator="≥",
                value="0.7",
            ),
        ],
    )

    result = JudgmentProcessor.evaluate(
        {
            ("llm_node_1", "faithfulness"): 0.9,
            ("llm_node_1", "answer_relevancy"): 0.6,
        },
        config,
    )

    assert result.passed is False
    assert result.condition_results[-1].passed is False


def test_evaluate_with_different_nodes_same_metric() -> None:
    """Conditions can target different nodes even with the same metric name."""
    config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                variable_selector=["llm_node_1", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            ),
            JudgmentCondition(
                variable_selector=["llm_node_2", "faithfulness"],
                comparison_operator=">",
                value="0.5",
            ),
        ],
    )

    result = JudgmentProcessor.evaluate(
        {
            ("llm_node_1", "faithfulness"): 0.9,
            ("llm_node_2", "faithfulness"): 0.6,
        },
        config,
    )

    assert result.passed is True
    assert len(result.condition_results) == 2


def test_evaluate_or_operator_passes_when_one_condition_met() -> None:
    """With ``or`` logical operator, one passing condition should suffice."""
    config = JudgmentConfig(
        logical_operator="or",
        conditions=[
            JudgmentCondition(
                variable_selector=["node_a", "score"],
                comparison_operator=">",
                value="0.9",
            ),
            JudgmentCondition(
                variable_selector=["node_b", "score"],
                comparison_operator=">",
                value="0.5",
            ),
        ],
    )

    result = JudgmentProcessor.evaluate(
        {
            ("node_a", "score"): 0.3,
            ("node_b", "score"): 0.8,
        },
        config,
    )

    assert result.passed is True


def test_evaluate_string_contains_operator() -> None:
    """String operators should work correctly via workflow engine delegation."""
    config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                variable_selector=["node_a", "status"],
                comparison_operator="contains",
                value="success",
            ),
        ],
    )

    result = JudgmentProcessor.evaluate(
        {("node_a", "status"): "evaluation_success_done"},
        config,
    )

    assert result.passed is True


def test_judgment_condition_accepts_ascii_operator_aliases() -> None:
    """Request payloads may use ASCII operators such as ``>=`` and should normalize."""
    condition = JudgmentCondition(
        variable_selector=["node_a", "score"],
        comparison_operator=">=",
        value="0.8",
    )

    assert condition.comparison_operator == "≥"
