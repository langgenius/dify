"""Unit tests for evaluation task result helpers."""

import io
from collections.abc import Generator
from contextlib import contextmanager
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from agenton.compositor import CompositorSessionSnapshot
from celery.exceptions import Retry
from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from clients.agent_backend import AgentBackendRunSucceededInternalEvent
from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    CustomizedMetricOutputField,
    CustomizedMetrics,
    DefaultMetric,
    EvaluationCategory,
    EvaluationDatasetInput,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationRunData,
    NodeInfo,
)
from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig, JudgmentResult
from core.evaluation.exceptions import EvaluationWorkflowVersionNotFoundError
from core.evaluation.runners.agent_evaluation_runner import AgentEvaluationRunner
from graphon.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now
from models.evaluation import EvaluationRun, EvaluationRunItem, EvaluationRunItemStatus, EvaluationRunStatus
from services.evaluation_service import EvaluationService
from tasks.evaluation_task import (
    EvaluationRunLease,
    EvaluationRunOwnershipLostError,
    _apply_judgment,
    _build_missing_result_errors,
    _compute_metrics_summary,
    _create_runner,
    _evaluate_agent_row,
    _execute_agent_target,
    _execute_evaluation,
    _execute_evaluation_runner,
    _finalize_results,
    _generate_result_xlsx,
    _merge_customized_results,
    _merge_result,
    _persist_results,
    _persist_target_checkpoint,
    _renew_evaluation_run_heartbeat,
    _renew_evaluation_run_heartbeat_while_running,
    _resume_agent_rows,
    _resume_retrieval_rows,
    _resume_workflow_rows,
    _stamp_and_merge,
    _update_run_progress,
    _workflow_task_id,
    reconcile_stale_evaluation_runs,
    run_evaluation,
)

_NODE_INFO = NodeInfo(node_id="llm-1", type="llm", title="Answer")
_EXECUTION_TOKEN = "40000000-0000-0000-0000-000000000001"


def _lease(run_id: str, token: str = _EXECUTION_TOKEN) -> EvaluationRunLease:
    return EvaluationRunLease(run_id=run_id, token=token)


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


def test_create_runner_supports_agent_category() -> None:
    assert isinstance(_create_runner(EvaluationCategory.AGENT, MagicMock()), AgentEvaluationRunner)


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
        lease=_lease(run_data.evaluation_run_id),
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


def test_customized_evaluator_missing_pinned_version_is_not_materialized_as_row_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evaluation_instance = MagicMock()
    evaluation_instance.evaluate_with_customized_workflow.side_effect = EvaluationWorkflowVersionNotFoundError(
        "Pinned evaluation workflow version was deleted."
    )
    persist_results = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task._persist_results", persist_results)
    monkeypatch.setattr("tasks.evaluation_task._cooperative_checkpoint", MagicMock())
    monkeypatch.setattr("tasks.evaluation_task._update_run_progress", MagicMock())
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        evaluation_model_provider="",
        evaluation_model="",
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app-1",
            evaluation_workflow_version_id="evaluator-version-1",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        ),
        input_list=[EvaluationDatasetInput(index=10, inputs={"query": "hello"})],
    )

    with pytest.raises(EvaluationWorkflowVersionNotFoundError, match="was deleted"):
        _execute_evaluation_runner(
            session=MagicMock(),
            run_data=run_data,
            evaluation_instance=evaluation_instance,
            node_run_result_mapping_list=[{"llm-1": NodeRunResult(outputs={"text": "answer"})}],
            lease=_lease(run_data.evaluation_run_id),
        )

    persist_results.assert_not_called()


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


def test_execute_evaluation_starts_running_lease_before_work(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory,
) -> None:
    run_id = "30000000-0000-0000-0000-000000000051"
    workflow_version_id = "30000000-0000-0000-0000-000000000004"
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id="30000000-0000-0000-0000-000000000002",
                target_type="apps",
                target_id="30000000-0000-0000-0000-000000000003",
                target_workflow_version_id=workflow_version_id,
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.PENDING,
                total_items=0,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()

    evaluation_instance = MagicMock()
    get_evaluation_instance = MagicMock(return_value=evaluation_instance)
    monkeypatch.setattr(
        "tasks.evaluation_task.EvaluationManager.get_evaluation_instance",
        get_evaluation_instance,
    )
    execute_running = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task._execute_running_evaluation", execute_running)
    maintained_leases: list[EvaluationRunLease] = []

    @contextmanager
    def maintain_heartbeat(lease: EvaluationRunLease):
        maintained_leases.append(lease)
        yield

    monkeypatch.setattr("tasks.evaluation_task._maintain_evaluation_run_heartbeat", maintain_heartbeat)
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id="30000000-0000-0000-0000-000000000002",
        target_type="apps",
        target_id="30000000-0000-0000-0000-000000000003",
        target_workflow_version_id=workflow_version_id,
        evaluation_model_provider="",
        evaluation_model="",
        input_list=[],
    )
    lease = _lease(run_id)

    with sqlite_session_factory() as session:
        _execute_evaluation(session, run_data, lease)

    with sqlite_session_factory() as session:
        run = session.get(EvaluationRun, run_id)
        assert run is not None
        assert run.status == EvaluationRunStatus.RUNNING
        assert run.execution_token == lease.token
        assert run.started_at is not None
    assert run.heartbeat_at is not None
    assert maintained_leases == [lease]
    get_evaluation_instance.assert_called_once_with(EvaluationFrameworkEnum.RAGAS)
    execute_running.assert_called_once()
    assert execute_running.call_args.args[-1] == lease


def test_execute_evaluation_rejects_disabled_knowledge_retrieval_v2_payload(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000053"
    workflow_version_id = "30000000-0000-0000-0000-000000000004"
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id="30000000-0000-0000-0000-000000000002",
                target_type="apps",
                target_id="30000000-0000-0000-0000-000000000003",
                target_workflow_version_id=workflow_version_id,
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.PENDING,
                total_items=0,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()

    monkeypatch.setattr(
        "services.evaluation_service.dify_config.EVALUATION_KNOWLEDGE_RETRIEVAL_V2_ENABLED",
        False,
    )
    get_instance = MagicMock()
    execute_running = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task.EvaluationManager.get_evaluation_instance", get_instance)
    monkeypatch.setattr("tasks.evaluation_task._execute_running_evaluation", execute_running)
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id="30000000-0000-0000-0000-000000000002",
        target_type="apps",
        target_id="30000000-0000-0000-0000-000000000003",
        target_workflow_version_id=workflow_version_id,
        evaluation_model_provider="",
        evaluation_model="",
        default_metrics=[
            DefaultMetric(
                metric="context_precision",
                node_info_list=[
                    NodeInfo(node_id="retrieval-v2", type="knowledge-retrieval-v2", title="Knowledge Retrieval V2")
                ],
            )
        ],
        input_list=[],
    )

    with sqlite_session_factory() as session:
        with pytest.raises(ValueError, match="knowledge-retrieval-v2.*disabled"):
            _execute_evaluation(session, run_data, _lease(run_id))

    get_instance.assert_not_called()
    execute_running.assert_not_called()


def test_execute_evaluation_does_not_run_duplicate_delivery(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000052"
    workflow_version_id = "30000000-0000-0000-0000-000000000004"
    current_lease = _lease(run_id)
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id="30000000-0000-0000-0000-000000000002",
                target_type="apps",
                target_id="30000000-0000-0000-0000-000000000003",
                target_workflow_version_id=workflow_version_id,
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.RUNNING,
                execution_token=current_lease.token,
                total_items=0,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()

    get_instance = MagicMock()
    execute_running = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task.EvaluationManager.get_evaluation_instance", get_instance)
    monkeypatch.setattr("tasks.evaluation_task._execute_running_evaluation", execute_running)
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id="30000000-0000-0000-0000-000000000002",
        target_type="apps",
        target_id="30000000-0000-0000-0000-000000000003",
        target_workflow_version_id=workflow_version_id,
        evaluation_model_provider="",
        evaluation_model="",
        input_list=[],
    )

    with sqlite_session_factory() as session:
        _execute_evaluation(
            session,
            run_data,
            _lease(run_id, "40000000-0000-0000-0000-000000000002"),
        )

    with sqlite_session_factory() as session:
        run = session.get(EvaluationRun, run_id)
        assert run is not None
        assert run.status == EvaluationRunStatus.RUNNING
        assert run.execution_token == current_lease.token
    get_instance.assert_not_called()
    execute_running.assert_not_called()


def test_run_evaluation_retries_transient_failure_and_keeps_checkpoints(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000061"
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id="30000000-0000-0000-0000-000000000002",
                target_type="knowledge_base",
                target_id="30000000-0000-0000-0000-000000000003",
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.PENDING,
                total_items=1,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()

    @contextmanager
    def create_session() -> Generator[Session, None, None]:
        with sqlite_session_factory() as session:
            yield session

    transient_error = RuntimeError("temporary database outage")
    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)
    monkeypatch.setattr(
        "tasks.evaluation_task.EvaluationManager.get_evaluation_instance",
        MagicMock(return_value=MagicMock()),
    )
    monkeypatch.setattr("tasks.evaluation_task._execute_running_evaluation", MagicMock(side_effect=transient_error))

    @contextmanager
    def maintain_heartbeat(_lease: EvaluationRunLease):
        yield

    monkeypatch.setattr("tasks.evaluation_task._maintain_evaluation_run_heartbeat", maintain_heartbeat)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_MAX_RETRIES", 3)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_RETRY_DELAY", 7)
    retry = MagicMock(return_value=Retry("scheduled"))
    monkeypatch.setattr(run_evaluation, "retry", retry)
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id="30000000-0000-0000-0000-000000000002",
        target_type="knowledge_base",
        target_id="30000000-0000-0000-0000-000000000003",
        evaluation_model_provider="",
        evaluation_model="",
        input_list=[EvaluationDatasetInput(index=1, inputs={"query": "hello"})],
    )

    run_evaluation.push_request(retries=0)
    try:
        with pytest.raises(Retry):
            run_evaluation.run(run_data.model_dump(mode="json"))
    finally:
        run_evaluation.pop_request()

    retry.assert_called_once_with(exc=transient_error, countdown=7, throw=False)
    with sqlite_session_factory() as session:
        run = session.get(EvaluationRun, run_id)
        assert run is not None
        assert run.status == EvaluationRunStatus.PENDING
        assert run.execution_token is None
        assert run.heartbeat_at is None
        assert run.error == "Retry 1/3 scheduled after: temporary database outage"
        assert run.completed_at is None


def test_run_evaluation_does_not_retry_missing_pinned_workflow(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000071"
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id="30000000-0000-0000-0000-000000000002",
                target_type="apps",
                target_id="30000000-0000-0000-0000-000000000003",
                target_workflow_version_id="30000000-0000-0000-0000-000000000004",
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.PENDING,
                total_items=1,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()

    @contextmanager
    def create_session() -> Generator[Session, None, None]:
        with sqlite_session_factory() as session:
            yield session

    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)
    monkeypatch.setattr(
        "tasks.evaluation_task.EvaluationManager.get_evaluation_instance",
        MagicMock(return_value=MagicMock()),
    )
    monkeypatch.setattr(
        "tasks.evaluation_task._execute_running_evaluation",
        MagicMock(side_effect=EvaluationWorkflowVersionNotFoundError("Pinned workflow version was deleted.")),
    )

    @contextmanager
    def maintain_heartbeat(_lease: EvaluationRunLease):
        yield

    monkeypatch.setattr("tasks.evaluation_task._maintain_evaluation_run_heartbeat", maintain_heartbeat)
    retry = MagicMock()
    monkeypatch.setattr(run_evaluation, "retry", retry)
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id="30000000-0000-0000-0000-000000000002",
        target_type="apps",
        target_id="30000000-0000-0000-0000-000000000003",
        target_workflow_version_id="30000000-0000-0000-0000-000000000004",
        evaluation_model_provider="",
        evaluation_model="",
        input_list=[EvaluationDatasetInput(index=1, inputs={"query": "hello"})],
    )

    run_evaluation.push_request(retries=0)
    try:
        run_evaluation.run(run_data.model_dump(mode="json"))
    finally:
        run_evaluation.pop_request()

    retry.assert_not_called()
    with sqlite_session_factory() as session:
        run = session.get(EvaluationRun, run_id)
        assert run is not None
        assert run.status == EvaluationRunStatus.FAILED
        assert run.execution_token is None
        assert run.heartbeat_at is None
        assert run.error == "Pinned workflow version was deleted."


def test_target_checkpoint_is_idempotent_and_becomes_completed_result(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000081"
    lease = _lease(run_id)
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id="30000000-0000-0000-0000-000000000002",
                target_type="apps",
                target_id="30000000-0000-0000-0000-000000000003",
                target_workflow_version_id="30000000-0000-0000-0000-000000000004",
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.RUNNING,
                execution_token=lease.token,
                total_items=1,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()
        item = EvaluationDatasetInput(index=7, inputs={"query": "hello"}, expected_output="world")

        _persist_target_checkpoint(session, lease, item, "30000000-0000-0000-0000-000000000091")
        _persist_target_checkpoint(session, lease, item, "30000000-0000-0000-0000-000000000091")

        checkpoints = session.query(EvaluationRunItem).filter_by(evaluation_run_id=run_id).all()
        assert len(checkpoints) == 1
        assert checkpoints[0].status == EvaluationRunItemStatus.TARGET_COMPLETED

        _persist_results(
            session,
            lease,
            [EvaluationItemResult(index=7, actual_output="answer")],
            [item],
        )

        session.refresh(checkpoints[0])
        run = session.get(EvaluationRun, run_id)
        assert checkpoints[0].status == EvaluationRunItemStatus.COMPLETED
        assert checkpoints[0].workflow_run_id == "30000000-0000-0000-0000-000000000091"
        assert run is not None
        assert run.completed_items == 1
        assert run.failed_items == 0


def test_stale_execution_lease_cannot_write_progress_or_row_checkpoint(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000082"
    current_lease = _lease(run_id)
    stale_lease = _lease(run_id, "40000000-0000-0000-0000-000000000002")
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id="30000000-0000-0000-0000-000000000002",
                target_type="apps",
                target_id="30000000-0000-0000-0000-000000000003",
                target_workflow_version_id="30000000-0000-0000-0000-000000000004",
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.RUNNING,
                execution_token=current_lease.token,
                total_items=1,
                progress_rate=0.2,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()

    with sqlite_session_factory() as session:
        with pytest.raises(EvaluationRunOwnershipLostError):
            _update_run_progress(session, stale_lease, 0.8)

    with sqlite_session_factory() as session:
        with pytest.raises(EvaluationRunOwnershipLostError):
            _persist_target_checkpoint(
                session,
                stale_lease,
                EvaluationDatasetInput(index=7, inputs={"query": "hello"}),
                "30000000-0000-0000-0000-000000000091",
            )

    with sqlite_session_factory() as session:
        run = session.get(EvaluationRun, run_id)
        assert run is not None
        assert run.execution_token == current_lease.token
        assert run.progress_rate == 0.2
        assert session.query(EvaluationRunItem).filter_by(evaluation_run_id=run_id).count() == 0


def test_resume_workflow_rows_reuses_target_checkpoint(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000101"
    lease = _lease(run_id)
    item = EvaluationDatasetInput(index=7, inputs={"query": "hello"})
    with sqlite_session_factory() as session:
        session.add_all(
            [
                EvaluationRun(
                    id=run_id,
                    tenant_id="30000000-0000-0000-0000-000000000002",
                    target_type="apps",
                    target_id="30000000-0000-0000-0000-000000000003",
                    target_workflow_version_id="30000000-0000-0000-0000-000000000004",
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.RUNNING,
                    execution_token=lease.token,
                    total_items=1,
                    created_by="30000000-0000-0000-0000-000000000006",
                ),
                EvaluationRunItem(
                    evaluation_run_id=run_id,
                    workflow_run_id="30000000-0000-0000-0000-000000000091",
                    item_index=7,
                    status=EvaluationRunItemStatus.TARGET_COMPLETED,
                    inputs='{"query": "hello"}',
                ),
            ]
        )
        session.commit()

        node_results = {"llm-1": NodeRunResult(outputs={"text": "answer"})}
        query_results = MagicMock(return_value=node_results)
        execute_targets = MagicMock()
        execute_runner = MagicMock()
        monkeypatch.setattr(EvaluationService, "_query_node_run_results", query_results)
        monkeypatch.setattr(EvaluationService, "execute_targets", execute_targets)
        monkeypatch.setattr("tasks.evaluation_task._execute_evaluation_runner", execute_runner)
        run_data = EvaluationRunData(
            evaluation_run_id=run_id,
            tenant_id="30000000-0000-0000-0000-000000000002",
            target_type="apps",
            target_id="30000000-0000-0000-0000-000000000003",
            target_workflow_version_id="30000000-0000-0000-0000-000000000004",
            evaluation_model_provider="",
            evaluation_model="",
            input_list=[item],
        )

        _resume_workflow_rows(session, run_data, MagicMock(), lease)

    execute_targets.assert_not_called()
    query_results.assert_called_once()
    assert execute_runner.call_args.kwargs["node_run_result_mapping_list"] == [node_results]
    assert execute_runner.call_args.kwargs["workflow_run_id_map"] == {7: "30000000-0000-0000-0000-000000000091"}
    assert execute_runner.call_args.kwargs["task_positions"] == [0]
    assert execute_runner.call_args.kwargs["lease"] == lease


def test_execute_agent_target_persists_backend_checkpoint_and_normalized_result(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000121"
    tenant_id = "30000000-0000-0000-0000-000000000002"
    agent_id = "30000000-0000-0000-0000-000000000003"
    snapshot_id = "30000000-0000-0000-0000-000000000004"
    binding_id = "30000000-0000-0000-0000-000000000008"
    lease = _lease(run_id)
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id=tenant_id,
                target_type="agents",
                target_id=agent_id,
                target_agent_config_snapshot_id=snapshot_id,
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.RUNNING,
                execution_token=lease.token,
                total_items=1,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()

    target = SimpleNamespace(agent_id=agent_id, agent_name="Research Agent")
    monkeypatch.setattr(
        "tasks.evaluation_task.AgentEvaluationTargetService.resolve_active_snapshot",
        MagicMock(return_value=target),
    )
    monkeypatch.setattr(
        "tasks.evaluation_task.AgentEvaluationTargetService.ensure_row_binding",
        MagicMock(return_value=SimpleNamespace(id=binding_id, backend_binding_ref="binding-ref-1")),
    )
    monkeypatch.setattr(
        "tasks.evaluation_task.AgentEvaluationTargetService.build_runtime_request",
        MagicMock(return_value=SimpleNamespace(request=object(), available_tools=())),
    )
    client = MagicMock()
    client.create_run.return_value = SimpleNamespace(run_id="backend-run-1")
    client.stream_events.return_value = [object(), object()]
    monkeypatch.setattr("tasks.evaluation_task.create_agent_backend_run_client", MagicMock(return_value=client))
    terminal = AgentBackendRunSucceededInternalEvent(
        run_id="backend-run-1",
        source_event_id="event-1",
        output={"text": "done"},
        session_snapshot=CompositorSessionSnapshot(layers=[]),
    )
    adapter = MagicMock()
    adapter.adapt.return_value = [terminal]
    monkeypatch.setattr("tasks.evaluation_task.AgentBackendRunEventAdapter", MagicMock(return_value=adapter))
    retire_binding = MagicMock(return_value=binding_id)
    monkeypatch.setattr(
        "tasks.evaluation_task.AgentWorkspaceService.retire_binding",
        retire_binding,
    )
    enqueue_binding = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task._enqueue_retired_agent_binding", enqueue_binding)
    dataset_item = EvaluationDatasetInput(index=7, inputs={"query": "research this"})
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id=tenant_id,
        target_type="agents",
        target_id=agent_id,
        target_agent_config_snapshot_id=snapshot_id,
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="task_completion",
                node_info_list=[NodeInfo(node_id=agent_id, type="agent", title="Research Agent")],
            )
        ],
        input_list=[dataset_item],
    )

    with sqlite_session_factory() as session:
        agent_item, target_error = _execute_agent_target(
            session=session,
            run_data=run_data,
            dataset_item=dataset_item,
            account_id="30000000-0000-0000-0000-000000000006",
            lease=lease,
        )

    assert target_error is None
    assert agent_item is not None
    assert agent_item.output == "done"
    adapter.adapt.assert_called_once()
    with sqlite_session_factory() as session:
        checkpoint = session.scalar(
            select(EvaluationRunItem).where(
                EvaluationRunItem.evaluation_run_id == run_id,
                EvaluationRunItem.item_index == 7,
            )
        )
        assert checkpoint is not None
        assert checkpoint.status == EvaluationRunItemStatus.TARGET_COMPLETED
        assert checkpoint.agent_backend_run_id == "backend-run-1"
        assert checkpoint.agent_workspace_binding_id == binding_id
        assert AgentEvaluationItem.model_validate_json(checkpoint.target_result_json or "{}").output == "done"
    assert retire_binding.call_args.kwargs["tenant_id"] == tenant_id
    assert retire_binding.call_args.kwargs["binding_id"] == binding_id
    enqueue_binding.assert_called_once_with(tenant_id, binding_id)


def test_resume_agent_rows_reuses_target_checkpoint(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000131"
    tenant_id = "30000000-0000-0000-0000-000000000002"
    agent_id = "30000000-0000-0000-0000-000000000003"
    lease = _lease(run_id)
    dataset_item = EvaluationDatasetInput(index=7, inputs={"query": "hello"})
    checkpointed_item = AgentEvaluationItem(index=7, inputs={"task": "hello"}, output="done")
    with sqlite_session_factory() as session:
        session.add_all(
            [
                EvaluationRun(
                    id=run_id,
                    tenant_id=tenant_id,
                    target_type="agents",
                    target_id=agent_id,
                    target_agent_config_snapshot_id="30000000-0000-0000-0000-000000000004",
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.RUNNING,
                    execution_token=lease.token,
                    total_items=1,
                    created_by="30000000-0000-0000-0000-000000000006",
                ),
                EvaluationRunItem(
                    evaluation_run_id=run_id,
                    item_index=7,
                    status=EvaluationRunItemStatus.TARGET_COMPLETED,
                    inputs='{"query": "hello"}',
                    agent_workspace_binding_id="30000000-0000-0000-0000-000000000008",
                    target_result_json=checkpointed_item.model_dump_json(),
                ),
            ]
        )
        session.commit()

    execute_target = MagicMock()
    evaluate_row = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task._execute_agent_target", execute_target)
    monkeypatch.setattr("tasks.evaluation_task._evaluate_agent_row", evaluate_row)
    monkeypatch.setattr("tasks.evaluation_task._update_run_progress", MagicMock())
    retire_binding = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task._retire_agent_binding", retire_binding)
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id=tenant_id,
        target_type="agents",
        target_id=agent_id,
        target_agent_config_snapshot_id="30000000-0000-0000-0000-000000000004",
        evaluation_model_provider="provider",
        evaluation_model="model",
        input_list=[dataset_item],
    )

    with sqlite_session_factory() as session:
        _resume_agent_rows(session, run_data, MagicMock(), "account-1", lease)

    execute_target.assert_not_called()
    retire_binding.assert_called_once_with(
        tenant_id,
        "30000000-0000-0000-0000-000000000008",
    )
    assert evaluate_row.call_args.kwargs["agent_item"] == checkpointed_item
    assert evaluate_row.call_args.kwargs["target_error"] is None


def test_evaluate_agent_row_uses_native_agent_evaluator(monkeypatch: pytest.MonkeyPatch) -> None:
    node_info = NodeInfo(node_id="agent-1", type="agent", title="Research Agent")
    agent_item = AgentEvaluationItem(index=7, inputs={"task": "hello"}, output="done")
    evaluation_instance = MagicMock()
    evaluation_instance.evaluate_agent.return_value = [
        EvaluationItemResult(
            index=0,
            metrics=[EvaluationMetric(name="task_completion", value=0.9)],
        )
    ]
    persist_results = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task._persist_results", persist_results)
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="agents",
        target_id="agent-1",
        target_agent_config_snapshot_id="snapshot-1",
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="task_completion", node_info_list=[node_info])],
        input_list=[EvaluationDatasetInput(index=7, inputs={"query": "hello"})],
    )

    _evaluate_agent_row(
        session=MagicMock(),
        run_data=run_data,
        evaluation_instance=evaluation_instance,
        agent_item=agent_item,
        target_error=None,
        task_position=0,
        lease=_lease("run-1"),
    )

    evaluation_instance.evaluate_agent.assert_called_once_with(
        [agent_item],
        ["task_completion"],
        "provider",
        "model",
        "tenant-1",
    )
    persisted_result = persist_results.call_args.args[2][0]
    assert persisted_result.index == 7
    assert persisted_result.metrics[0].node_info == node_info
    assert persisted_result.overall_score == 0.9


def test_evaluate_agent_row_runs_customized_evaluator_without_native_metrics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = MagicMock()
    lease = _lease("run-1")
    agent_item = AgentEvaluationItem(
        index=7,
        inputs={"task": "hello"},
        output="done",
        expected_output="expected",
    )
    evaluation_instance = MagicMock()
    evaluation_instance.evaluate_with_customized_workflow.return_value = [
        EvaluationItemResult(
            index=0,
            metrics=[
                EvaluationMetric(
                    name="score",
                    value=0.8,
                    node_info=NodeInfo(node_id="evaluator-app", type="customized", title="customized"),
                )
            ],
        )
    ]
    persist_results = MagicMock()
    clear_signals = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task._persist_results", persist_results)
    monkeypatch.setattr("tasks.evaluation_task._clear_workflow_cancellation_signals", clear_signals)
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="agents",
        target_id="agent-1",
        target_agent_config_snapshot_id="snapshot-1",
        evaluation_model_provider="",
        evaluation_model="",
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            evaluation_workflow_version_id="evaluator-version-1",
            input_fields={"answer": "{{#agent.output#}}"},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        ),
        input_list=[EvaluationDatasetInput(index=7, inputs={"query": "hello"})],
    )

    _evaluate_agent_row(
        session=session,
        run_data=run_data,
        evaluation_instance=evaluation_instance,
        agent_item=agent_item,
        target_error=None,
        task_position=4,
        lease=lease,
    )

    evaluation_instance.evaluate_agent.assert_not_called()
    clear_signals.assert_called_once_with(session, lease, "evaluator", [4])
    call_kwargs = evaluation_instance.evaluate_with_customized_workflow.call_args.kwargs
    synthetic_result = call_kwargs["node_run_result_mapping_list"][0]["agent"]
    assert synthetic_result.outputs["query"] == "hello"
    assert synthetic_result.outputs["output"] == "done"
    assert synthetic_result.outputs["expected_output"] == "expected"
    assert call_kwargs["customized_metrics"] == run_data.customized_metrics
    assert call_kwargs["tenant_id"] == "tenant-1"
    assert call_kwargs["task_id_factory"](0) == "evaluation:run-1:evaluator:4"
    persisted_result = persist_results.call_args.args[2][0]
    assert persisted_result.index == 7
    assert persisted_result.actual_output == "done"
    assert persisted_result.metrics[0].name == "score"
    assert persisted_result.overall_score == 0.8


def test_resume_retrieval_rows_skips_completed_checkpoint(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000111"
    lease = _lease(run_id)
    with sqlite_session_factory() as session:
        session.add_all(
            [
                EvaluationRun(
                    id=run_id,
                    tenant_id="30000000-0000-0000-0000-000000000002",
                    target_type="knowledge_base",
                    target_id="30000000-0000-0000-0000-000000000003",
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.RUNNING,
                    execution_token=lease.token,
                    total_items=2,
                    created_by="30000000-0000-0000-0000-000000000006",
                ),
                EvaluationRunItem(
                    evaluation_run_id=run_id,
                    item_index=1,
                    status=EvaluationRunItemStatus.COMPLETED,
                    inputs='{"query": "first"}',
                    judgment="{}",
                ),
            ]
        )
        session.commit()
        execute_retrieval = MagicMock(return_value=([NodeRunResult(outputs={"result": []})], [None]))
        evaluate_retrieval = MagicMock()
        monkeypatch.setattr(EvaluationService, "execute_retrieval_test_targets", execute_retrieval)
        monkeypatch.setattr("tasks.evaluation_task._evaluate_retrieval_results", evaluate_retrieval)
        run_data = EvaluationRunData(
            evaluation_run_id=run_id,
            tenant_id="30000000-0000-0000-0000-000000000002",
            target_type="knowledge_base",
            target_id="30000000-0000-0000-0000-000000000003",
            evaluation_model_provider="",
            evaluation_model="",
            input_list=[
                EvaluationDatasetInput(index=1, inputs={"query": "first"}),
                EvaluationDatasetInput(index=2, inputs={"query": "second"}),
            ],
        )

        _resume_retrieval_rows(session, run_data, MagicMock(), "account-1", lease)

    execute_retrieval.assert_called_once()
    assert execute_retrieval.call_args.kwargs["input_list"][0].index == 2
    evaluate_retrieval.assert_called_once()
    assert evaluate_retrieval.call_args.kwargs["run_data"].input_list[0].index == 2
    assert evaluate_retrieval.call_args.kwargs["lease"] == lease
    assert evaluate_retrieval.call_args.kwargs["report_progress"] is False


def test_heartbeat_loop_renews_until_run_is_no_longer_running(monkeypatch: pytest.MonkeyPatch) -> None:
    stop_event = MagicMock()
    stop_event.wait.side_effect = [False, False]
    renew_heartbeat = MagicMock(side_effect=[True, False])
    monkeypatch.setattr("tasks.evaluation_task._renew_evaluation_run_heartbeat", renew_heartbeat)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_HEARTBEAT_INTERVAL", 17)
    lease = _lease("run-1")

    _renew_evaluation_run_heartbeat_while_running(lease, stop_event)

    assert stop_event.wait.call_count == 2
    stop_event.wait.assert_called_with(17)
    assert renew_heartbeat.call_count == 2
    renew_heartbeat.assert_called_with(lease)


def test_renew_evaluation_run_heartbeat_only_updates_running_run(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory,
) -> None:
    now = naive_utc_now()
    running_run_id = "30000000-0000-0000-0000-000000000031"
    completed_run_id = "30000000-0000-0000-0000-000000000041"
    running_lease = _lease(running_run_id)
    with sqlite_session_factory() as session:
        session.add_all(
            [
                EvaluationRun(
                    id=running_run_id,
                    tenant_id="30000000-0000-0000-0000-000000000002",
                    target_type="apps",
                    target_id="30000000-0000-0000-0000-000000000003",
                    target_workflow_version_id="30000000-0000-0000-0000-000000000004",
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.RUNNING,
                    execution_token=running_lease.token,
                    total_items=2,
                    created_by="30000000-0000-0000-0000-000000000006",
                    heartbeat_at=now - timedelta(minutes=10),
                ),
                EvaluationRun(
                    id=completed_run_id,
                    tenant_id="30000000-0000-0000-0000-000000000002",
                    target_type="apps",
                    target_id="30000000-0000-0000-0000-000000000003",
                    target_workflow_version_id="30000000-0000-0000-0000-000000000004",
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.COMPLETED,
                    total_items=2,
                    created_by="30000000-0000-0000-0000-000000000006",
                ),
            ]
        )
        session.commit()

    @contextmanager
    def create_session():
        with sqlite_session_factory() as session:
            yield session

    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)

    assert _renew_evaluation_run_heartbeat(running_lease) is True
    assert _renew_evaluation_run_heartbeat(_lease(running_run_id, "40000000-0000-0000-0000-000000000002")) is False
    assert _renew_evaluation_run_heartbeat(_lease(completed_run_id)) is False

    with sqlite_session_factory() as session:
        running_run = session.get(EvaluationRun, running_run_id)
        assert running_run is not None
        assert running_run.heartbeat_at is not None
        assert running_run.heartbeat_at > now - timedelta(minutes=10)
        completed_run = session.get(EvaluationRun, completed_run_id)
        assert completed_run is not None
        assert completed_run.heartbeat_at is None


def test_reconcile_stale_evaluation_runs_uses_running_heartbeat_lease(
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
                    execution_token="40000000-0000-0000-0000-000000000011",
                    total_items=2,
                    celery_task_id="celery-1",
                    created_by="30000000-0000-0000-0000-000000000006",
                    created_at=now,
                    started_at=now,
                    heartbeat_at=now - timedelta(hours=2),
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
                    heartbeat_at=now - timedelta(hours=2),
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
                    execution_token="40000000-0000-0000-0000-000000000021",
                    total_items=2,
                    celery_task_id="celery-3",
                    created_by="30000000-0000-0000-0000-000000000006",
                    created_at=now - timedelta(hours=2),
                    started_at=now - timedelta(hours=2),
                    heartbeat_at=now,
                ),
            ]
        )
        session.commit()

    @contextmanager
    def create_session():
        with sqlite_session_factory() as session:
            yield session

    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_LEASE_TIMEOUT", 60)
    stop_tasks = MagicMock()
    monkeypatch.setattr(EvaluationService, "_stop_workflow_tasks", stop_tasks)
    celery_control = MagicMock()
    monkeypatch.setattr("celery.current_app.control", celery_control)

    assert reconcile_stale_evaluation_runs.run() == 1

    with sqlite_session_factory() as session:
        run = session.get(EvaluationRun, "30000000-0000-0000-0000-000000000001")
        assert run is not None
        assert run.status == EvaluationRunStatus.FAILED
        assert run.execution_token is None
        assert run.heartbeat_at is None
        assert "lease" in (run.error or "")
        pending_run = session.get(EvaluationRun, "30000000-0000-0000-0000-000000000011")
        assert pending_run is not None
        assert pending_run.status == EvaluationRunStatus.PENDING
        recently_renewed_run = session.get(EvaluationRun, "30000000-0000-0000-0000-000000000021")
        assert recently_renewed_run is not None
        assert recently_renewed_run.status == EvaluationRunStatus.RUNNING
        assert recently_renewed_run.execution_token == "40000000-0000-0000-0000-000000000021"
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
            expected_outputs={"llm-1": "world"},
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
        "llm-1 : expected_output",
        "actual_output",
        "Answer : faithfulness",
        "error",
    ]
