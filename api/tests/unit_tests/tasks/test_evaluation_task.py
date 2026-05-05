"""Unit tests for evaluation task helpers."""

import io

from openpyxl import load_workbook

from core.evaluation.entities.evaluation_entity import EvaluationDatasetInput
from core.evaluation.entities.evaluation_entity import EvaluationItemResult, EvaluationMetric, NodeInfo
from core.evaluation.entities.judgment_entity import (
    JudgmentCondition,
    JudgmentConfig,
    JudgmentResult,
)
from graphon.node_events import NodeRunResult
from tasks.evaluation_task import (
    _apply_judgment,
    _build_missing_result_errors,
    _compute_metrics_summary,
    _finalize_results,
    _generate_result_xlsx,
    _merge_customized_results,
    _merge_result,
    _stamp_and_merge,
)

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


def test_finalize_results_materializes_missing_dataset_rows() -> None:
    input_list = [
        EvaluationDatasetInput(index=101, inputs={"query": "first"}),
        EvaluationDatasetInput(index=205, inputs={"query": "second"}),
    ]
    results_by_index = {
        205: EvaluationItemResult(index=205, metrics=[EvaluationMetric(name="faithfulness", value=0.9)])
    }

    finalized = _finalize_results(
        input_list=input_list,
        results_by_index=results_by_index,
        missing_errors={101: "Target execution produced no node results for this row."},
    )

    assert [result.index for result in finalized] == [101, 205]
    assert finalized[0].error == "Target execution produced no node results for this row."
    assert finalized[1].metrics[0].name == "faithfulness"


def test_build_missing_result_errors_marks_empty_node_runs() -> None:
    input_list = [
        EvaluationDatasetInput(index=1, inputs={"query": "hello"}),
        EvaluationDatasetInput(index=2, inputs={"query": "world"}),
    ]
    node_run_results = [
        {},
        {"llm-node": NodeRunResult(outputs={"text": "answer"})},
    ]

    errors = _build_missing_result_errors(input_list, node_run_results)

    assert errors == {
        1: "Target execution produced no node results for this row.",
        2: "No evaluation metrics were generated for this row.",
    }


def test_apply_judgment_supports_customized_metric_scope() -> None:
    judgment_config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                variable_selector=["workflow-app-1", "score"],
                comparison_operator="≥",
                value="0.8",
            )
        ],
    )
    results = [
        EvaluationItemResult(
            index=1,
            metrics=[
                EvaluationMetric(
                    name="score",
                    value=0.91,
                    node_info=NodeInfo(node_id="workflow-app-1", type="customized", title="customized"),
                )
            ],
        )
    ]

    judged = _apply_judgment(results, judgment_config)

    assert judged[0].judgment.passed is True


def test_merge_customized_results_remaps_positional_indices() -> None:
    results_by_index: dict[int, EvaluationItemResult] = {}
    input_list = [
        EvaluationDatasetInput(index=101, inputs={"query": "first"}),
        EvaluationDatasetInput(index=205, inputs={"query": "second"}),
    ]
    customized_results = [
        EvaluationItemResult(index=1, metrics=[EvaluationMetric(name="score", value=0.88)]),
    ]

    _merge_customized_results(results_by_index, customized_results, input_list)

    assert list(results_by_index.keys()) == [205]
    assert results_by_index[205].metrics[0].name == "score"


def test_generate_result_xlsx_preserves_multiple_expected_output_columns() -> None:
    input_list = [
        EvaluationDatasetInput(
            index=1,
            inputs={"query": "hello"},
            expected_outputs={"llm1": "world", "knowledge1": "chunk"},
        )
    ]
    results = [EvaluationItemResult(index=1, actual_output="answer")]

    content = _generate_result_xlsx(input_list, results)
    workbook = load_workbook(io.BytesIO(content))
    worksheet = workbook.active

    headers = [cell.value for cell in worksheet[1]]

    assert headers == [
        "index",
        "query",
        "llm1 : expected_output",
        "knowledge1 : expected_output",
        "actual_output",
        "error",
    ]
