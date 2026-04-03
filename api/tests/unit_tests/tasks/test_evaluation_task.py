"""Unit tests for evaluation task helpers."""

from core.evaluation.entities.evaluation_entity import EvaluationItemResult, EvaluationMetric, NodeInfo
from core.evaluation.entities.judgment_entity import (
    JudgmentCondition,
    JudgmentConfig,
    JudgmentResult,
)
from tasks.evaluation_task import _compute_metrics_summary, _merge_result, _stamp_and_merge

_NODE_INFO = NodeInfo(node_id="llm_1", type="llm", title="LLM Node")


def test_compute_metrics_summary_includes_judgment_counts() -> None:
    """Summary should expose pass/fail counts when judgment rules are configured."""
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
    results = [
        EvaluationItemResult(
            index=0,
            metrics=[EvaluationMetric(name="faithfulness", value=0.9, node_info=_NODE_INFO)],
            judgment=JudgmentResult(passed=True, logical_operator="and", condition_results=[]),
        ),
        EvaluationItemResult(
            index=1,
            metrics=[EvaluationMetric(name="faithfulness", value=0.4, node_info=_NODE_INFO)],
            judgment=JudgmentResult(passed=False, logical_operator="and", condition_results=[]),
        ),
        EvaluationItemResult(index=2, error="timeout"),
    ]

    summary = _compute_metrics_summary(results, judgment_config)

    assert summary["_judgment"] == {
        "enabled": True,
        "logical_operator": "and",
        "configured_conditions": 1,
        "evaluated_items": 2,
        "passed_items": 1,
        "failed_items": 1,
        "pass_rate": 0.5,
    }


def test_merge_result_combines_metrics_for_same_index() -> None:
    """Merging two results with the same index should concatenate their metrics."""
    results_by_index: dict[int, EvaluationItemResult] = {}

    first = EvaluationItemResult(
        index=0,
        actual_output="output_1",
        metrics=[EvaluationMetric(name="faithfulness", value=0.9)],
    )
    _merge_result(results_by_index, 0, first)

    second = EvaluationItemResult(
        index=0,
        actual_output="output_2",
        metrics=[EvaluationMetric(name="context_precision", value=0.7)],
    )
    _merge_result(results_by_index, 0, second)

    merged = results_by_index[0]
    assert len(merged.metrics) == 2
    assert merged.metrics[0].name == "faithfulness"
    assert merged.metrics[1].name == "context_precision"
    assert merged.actual_output == "output_1"


def test_stamp_and_merge_attaches_node_info() -> None:
    """_stamp_and_merge should set node_info on every metric and remap indices."""
    results_by_index: dict[int, EvaluationItemResult] = {}
    node_info = NodeInfo(node_id="llm_1", type="llm", title="GPT-4")

    evaluated = [
        EvaluationItemResult(
            index=0,
            metrics=[EvaluationMetric(name="faithfulness", value=0.85)],
        )
    ]
    item_indices = [3]

    _stamp_and_merge(evaluated, item_indices, node_info, results_by_index)

    assert 3 in results_by_index
    metric = results_by_index[3].metrics[0]
    assert metric.node_info is not None
    assert metric.node_info.node_id == "llm_1"
    assert metric.node_info.type == "llm"
