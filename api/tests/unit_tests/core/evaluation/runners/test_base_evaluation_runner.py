"""Tests for judgment application logic (moved from BaseEvaluationRunner to evaluation_task)."""

from core.evaluation.entities.evaluation_entity import EvaluationItemResult, EvaluationMetric, NodeInfo
from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig
from tasks.evaluation_task import _apply_judgment

_NODE_INFO = NodeInfo(node_id="llm_1", type="llm", title="LLM Node")


def test_apply_judgment_marks_passing_result() -> None:
    """Items whose metrics satisfy the judgment conditions should be marked as passed."""
    results = [
        EvaluationItemResult(
            index=0,
            actual_output="result",
            metrics=[EvaluationMetric(name="faithfulness", value=0.91, node_info=_NODE_INFO)],
        )
    ]
    judgment_config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                variable_selector=["llm_1", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            )
        ],
    )

    judged = _apply_judgment(results, judgment_config)

    assert judged[0].judgment.passed is True


def test_apply_judgment_marks_failing_result() -> None:
    """Items whose metrics do NOT satisfy the conditions should be marked as failed."""
    results = [
        EvaluationItemResult(
            index=0,
            metrics=[EvaluationMetric(name="faithfulness", value=0.5, node_info=_NODE_INFO)],
        )
    ]
    judgment_config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                variable_selector=["llm_1", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            )
        ],
    )

    judged = _apply_judgment(results, judgment_config)

    assert judged[0].judgment.passed is False


def test_apply_judgment_skips_errored_items() -> None:
    """Items with errors should be passed through without judgment evaluation."""
    results = [
        EvaluationItemResult(index=0, error="timeout"),
    ]
    judgment_config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                variable_selector=["llm_1", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            )
        ],
    )

    judged = _apply_judgment(results, judgment_config)

    assert judged[0].error == "timeout"
    assert judged[0].judgment.passed is False
