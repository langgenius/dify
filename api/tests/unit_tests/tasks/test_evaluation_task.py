"""Unit tests for evaluation task result helpers."""

import io
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import MagicMock

import pytest
from openpyxl import load_workbook

from core.evaluation.entities.evaluation_entity import (
    CustomizedMetricOutputField,
    CustomizedMetrics,
    EvaluationDatasetInput,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationRunData,
    NodeInfo,
)
from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig, JudgmentResult
from graphon.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now
from models.evaluation import EvaluationRun, EvaluationRunStatus
from services.evaluation_service import EvaluationService
from tasks.evaluation_task import (
    _apply_judgment,
    _build_missing_result_errors,
    _compute_metrics_summary,
    _execute_evaluation_runner,
    _finalize_results,
    _generate_result_xlsx,
    _merge_customized_results,
    _merge_result,
    _stamp_and_merge,
    _workflow_task_id,
    reconcile_stale_evaluation_runs,
)

_NODE_INFO = NodeInfo(node_id="llm-1", type="llm", title="Answer")


def test_merge_and_stamp_results_use_dataset_indices() -> None:
    results_by_index: dict[int, EvaluationItemResult] = {}
    _stamp_and_merge(
        [EvaluationItemResult(index=0, metrics=[EvaluationMetric(name="faithfulness", value=0.9)])],
        [42],
        _NODE_INFO,
        results_by_index,
    )
    _merge_result(
        results_by_index,
        42,
        EvaluationItemResult(index=42, metrics=[EvaluationMetric(name="answer_correctness", value=0.8)]),
    )

    assert [metric.name for metric in results_by_index[42].metrics] == [
        "faithfulness",
        "answer_correctness",
    ]
    assert results_by_index[42].metrics[0].node_info == _NODE_INFO


def test_customized_results_remap_positional_indices() -> None:
    results_by_index: dict[int, EvaluationItemResult] = {}
    input_list = [
        EvaluationDatasetInput(index=101, inputs={"query": "first"}),
        EvaluationDatasetInput(index=205, inputs={"query": "second"}),
    ]

    _merge_customized_results(
        results_by_index,
        [EvaluationItemResult(index=1, metrics=[EvaluationMetric(name="score", value=0.88)])],
        input_list,
    )

    assert list(results_by_index) == [205]


def test_customized_evaluator_skips_rows_where_target_execution_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evaluation_instance = MagicMock()
    evaluation_instance.evaluate_with_customized_workflow.return_value = [
        EvaluationItemResult(index=0, metrics=[EvaluationMetric(name="score", value=0.9)])
    ]
    persist_results = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task._persist_results", persist_results)
    monkeypatch.setattr("tasks.evaluation_task._cooperative_checkpoint", MagicMock())
    monkeypatch.setattr("tasks.evaluation_task._update_run_progress", MagicMock())
    successful_node_result = NodeRunResult(outputs={"text": "answer"})
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        evaluation_model_provider="",
        evaluation_model="",
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app-1",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        ),
        input_list=[
            EvaluationDatasetInput(index=10, inputs={"query": "failed"}),
            EvaluationDatasetInput(index=20, inputs={"query": "succeeded"}),
        ],
    )

    results = _execute_evaluation_runner(
        session=MagicMock(),
        run_data=run_data,
        evaluation_instance=evaluation_instance,
        node_run_result_mapping_list=[{}, {"llm-1": successful_node_result}],
    )

    assert results[0].index == 10
    assert results[0].error == "Target execution produced no successful node results for this row."
    assert results[1].index == 20
    assert results[1].metrics[0].name == "score"
    evaluation_instance.evaluate_with_customized_workflow.assert_called_once()
    call_kwargs = evaluation_instance.evaluate_with_customized_workflow.call_args.kwargs
    assert call_kwargs["node_run_result_mapping_list"] == [{"llm-1": successful_node_result}]
    assert call_kwargs["customized_metrics"] == run_data.customized_metrics
    assert call_kwargs["tenant_id"] == "tenant-1"
    assert callable(call_kwargs["cancellation_check"])
    assert callable(call_kwargs["task_id_factory"])
    persist_results.assert_called_once()


def test_missing_target_rows_are_materialized_as_errors() -> None:
    input_list = [
        EvaluationDatasetInput(index=1, inputs={"query": "first"}),
        EvaluationDatasetInput(index=2, inputs={"query": "second"}),
    ]
    missing_errors = _build_missing_result_errors(
        input_list,
        [{}, {"llm-1": NodeRunResult(outputs={"text": "answer"})}],
    )

    results = _finalize_results(input_list, {}, missing_errors)

    assert results[0].error == "Target execution produced no successful node results for this row."
    assert results[1].error == "No evaluation metrics were generated for this row."


def test_missing_target_rows_preserve_execution_error() -> None:
    input_list = [EvaluationDatasetInput(index=7, inputs={"query": "first"})]

    missing_errors = _build_missing_result_errors(input_list, [{}], ["provider timed out"])

    assert missing_errors == {7: "Target execution failed: provider timed out"}


def test_workflow_task_ids_are_deterministic_per_run_phase_and_position() -> None:
    assert _workflow_task_id("run-1", "target", 3) == "evaluation:run-1:target:3"
    assert _workflow_task_id("run-1", "evaluator", 3) == "evaluation:run-1:evaluator:3"


def test_reconcile_stale_evaluation_runs_uses_running_started_at(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory,
) -> None:
    now = naive_utc_now()
    with sqlite_session_factory() as session:
        session.add_all(
            [
                EvaluationRun(
                    id="30000000-0000-0000-0000-000000000001",
                    tenant_id="30000000-0000-0000-0000-000000000002",
                    target_type="apps",
                    target_id="30000000-0000-0000-0000-000000000003",
                    target_workflow_version_id="30000000-0000-0000-0000-000000000004",
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.RUNNING,
                    total_items=2,
                    celery_task_id="celery-1",
                    created_by="30000000-0000-0000-0000-000000000006",
                    created_at=now,
                    started_at=now - timedelta(hours=2),
                ),
                EvaluationRun(
                    id="30000000-0000-0000-0000-000000000011",
                    tenant_id="30000000-0000-0000-0000-000000000002",
                    target_type="apps",
                    target_id="30000000-0000-0000-0000-000000000003",
                    target_workflow_version_id="30000000-0000-0000-0000-000000000004",
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.PENDING,
                    total_items=2,
                    celery_task_id="celery-2",
                    created_by="30000000-0000-0000-0000-000000000006",
                    created_at=now - timedelta(hours=2),
                ),
                EvaluationRun(
                    id="30000000-0000-0000-0000-000000000021",
                    tenant_id="30000000-0000-0000-0000-000000000002",
                    target_type="apps",
                    target_id="30000000-0000-0000-0000-000000000003",
                    target_workflow_version_id="30000000-0000-0000-0000-000000000004",
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.RUNNING,
                    total_items=2,
                    celery_task_id="celery-3",
                    created_by="30000000-0000-0000-0000-000000000006",
                    created_at=now - timedelta(hours=2),
                    started_at=now,
                ),
            ]
        )
        session.commit()

    @contextmanager
    def create_session():
        with sqlite_session_factory() as session:
            yield session

    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_TASK_TIMEOUT", 60)
    stop_tasks = MagicMock()
    monkeypatch.setattr(EvaluationService, "_stop_workflow_tasks", stop_tasks)
    celery_control = MagicMock()
    monkeypatch.setattr("celery.current_app.control", celery_control)

    assert reconcile_stale_evaluation_runs.run() == 1

    with sqlite_session_factory() as session:
        run = session.get(EvaluationRun, "30000000-0000-0000-0000-000000000001")
        assert run is not None
        assert run.status == EvaluationRunStatus.FAILED
        assert "timeout" in (run.error or "")
        pending_run = session.get(EvaluationRun, "30000000-0000-0000-0000-000000000011")
        assert pending_run is not None
        assert pending_run.status == EvaluationRunStatus.PENDING
        recently_started_run = session.get(EvaluationRun, "30000000-0000-0000-0000-000000000021")
        assert recently_started_run is not None
        assert recently_started_run.status == EvaluationRunStatus.RUNNING
    stop_tasks.assert_called_once_with("30000000-0000-0000-0000-000000000001", 2)
    celery_control.revoke.assert_called_once_with("celery-1", terminate=False)


def test_judgment_summary_ignores_errored_items() -> None:
    judgment_config = JudgmentConfig(
        conditions=[
            JudgmentCondition(
                variable_selector=["llm-1", "faithfulness"],
                comparison_operator=">",
                value="0.8",
            )
        ]
    )
    results = _apply_judgment(
        [
            EvaluationItemResult(
                index=1,
                metrics=[EvaluationMetric(name="faithfulness", value=0.9, node_info=_NODE_INFO)],
            ),
            EvaluationItemResult(index=2, error="timeout"),
        ],
        judgment_config,
    )
    summary = _compute_metrics_summary(results, judgment_config)

    assert results[0].judgment.passed is True
    assert results[1].judgment == JudgmentResult()
    assert summary["_judgment"]["evaluated_items"] == 1
    assert summary["_judgment"]["pass_rate"] == 1.0


def test_result_xlsx_has_node_scoped_metrics_and_references() -> None:
    input_list = [
        EvaluationDatasetInput(
            index=1,
            inputs={"query": "hello"},
            expected_outputs={"Answer": "world"},
        )
    ]
    results = [
        EvaluationItemResult(
            index=1,
            actual_output="answer",
            metrics=[EvaluationMetric(name="faithfulness", value=0.9, node_info=_NODE_INFO)],
        )
    ]

    workbook = load_workbook(io.BytesIO(_generate_result_xlsx(input_list, results)))
    worksheet = workbook.active

    assert worksheet is not None
    assert [cell.value for cell in worksheet[1]] == [
        "index",
        "query",
        "Answer : expected_output",
        "actual_output",
        "Answer (llm-1) : faithfulness",
        "error",
    ]
