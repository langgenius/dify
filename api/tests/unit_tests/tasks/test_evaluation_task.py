"""Unit tests for evaluation task result helpers."""

import io
import json
from collections.abc import Generator
from contextlib import contextmanager
from datetime import timedelta
from functools import partial
from threading import Event
from uuid import UUID

import pytest
from celery.exceptions import Retry
from dify_agent.protocol import CreateRunRequest, RunComposition
from openpyxl import load_workbook
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from clients.agent_backend.fake_client import FakeAgentBackendRunClient, FakeAgentBackendScenario
from core.app.apps.agent_app.runtime_request_builder import AgentAppRuntimeRequest
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    CustomizedMetricOutputField,
    CustomizedMetrics,
    DefaultMetric,
    EvaluationCategory,
    EvaluationDatasetInput,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationRunData,
    NodeInfo,
)
from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig, JudgmentResult
from core.evaluation.exceptions import EvaluationWorkflowVersionNotFoundError
from core.evaluation.runners.agent_evaluation_runner import AgentEvaluationRunner
from core.evaluation.runners.llm_evaluation_runner import LLMEvaluationRunner
from core.evaluation.runners.retrieval_evaluation_runner import RetrievalEvaluationRunner
from graphon.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import AgentConfigVersionKind, AgentWorkspaceBinding
from models.agent_config_entities import AgentSoulConfig
from models.evaluation import (
    EvaluationRun,
    EvaluationRunItem,
    EvaluationRunItemStatus,
    EvaluationRunStatus,
    EvaluationTargetType,
)
from models.model import UploadFile
from models.workflow import WorkflowKind
from services.agent.evaluation_target_service import ResolvedAgentEvaluationTarget
from services.evaluation_service import EvaluationService
from tasks.evaluation_task import (
    EvaluationRunCancelledError,
    EvaluationRunLease,
    EvaluationRunOwnershipLostError,
    _apply_judgment,
    _build_missing_result_errors,
    _collect_retrieval_contexts,
    _compute_metrics_summary,
    _create_runner,
    _delete_stored_result_file,
    _enqueue_retired_agent_binding,
    _evaluate_agent_row,
    _evaluate_retrieval_results,
    _evaluate_with_customized_workflow,
    _execute_agent_target,
    _execute_evaluation,
    _execute_evaluation_runner,
    _execute_running_evaluation,
    _finalize_results,
    _generate_result_xlsx,
    _maintain_evaluation_run_heartbeat,
    _merge_customized_results,
    _merge_result,
    _persist_results,
    _persist_target_checkpoint,
    _renew_evaluation_run_heartbeat,
    _renew_evaluation_run_heartbeat_while_running,
    _resume_agent_rows,
    _resume_retrieval_rows,
    _resume_workflow_rows,
    _retire_agent_binding,
    _stamp_and_merge,
    _store_result_file,
    _update_run_progress,
    _workflow_task_id,
    reconcile_stale_evaluation_runs,
    run_evaluation,
)
from tests.helpers.unit.core.evaluation.capturing_evaluation_instance import CapturingEvaluationInstance
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant, make_workflow


def test_collect_retrieval_contexts_keeps_only_content_from_requested_nodes() -> None:
    node_results = {
        "first": NodeRunResult(outputs={"result": [{"content": "alpha"}, {"content": ""}, {"other": "x"}]}),
        "second": NodeRunResult(outputs={"result": "invalid"}),
        "third": NodeRunResult(outputs={"result": [{"content": 3}, None]}),
    }

    assert _collect_retrieval_contexts(node_results, []) is None
    assert _collect_retrieval_contexts(node_results, ["missing", "first", "second", "third"]) == ["alpha", "3"]


def test_store_result_file_persists_upload_matching_saved_bytes(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    saved: list[tuple[str, bytes]] = []
    monkeypatch.setattr("tasks.evaluation_task.storage.save", lambda key, data: saved.append((key, data)))

    upload = _store_result_file("tenant-1", "run-12345678", b"xlsx-bytes", sqlite_session, "account-1")

    assert upload is sqlite_session.get(UploadFile, upload.id)
    assert upload.name == "evaluation-result-run-1234.xlsx"
    assert upload.size == len(b"xlsx-bytes")
    assert upload.used is True
    assert saved == [(upload.key, b"xlsx-bytes")]


def test_store_result_file_removes_saved_bytes_when_database_flush_fails(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    saved_keys: list[str] = []
    deleted_keys: list[str] = []
    monkeypatch.setattr("tasks.evaluation_task.storage.save", lambda key, _data: saved_keys.append(key))
    monkeypatch.setattr("tasks.evaluation_task.storage.delete", lambda key: deleted_keys.append(key))

    def fail_flush(_session: Session, _flush_context: object, _instances: object) -> None:
        raise RuntimeError("database unavailable")

    event.listen(sqlite_session, "before_flush", fail_flush)
    try:
        with pytest.raises(RuntimeError, match="database unavailable"):
            _store_result_file("tenant-1", "run-12345678", b"xlsx-bytes", sqlite_session, "account-1")
    finally:
        event.remove(sqlite_session, "before_flush", fail_flush)

    assert saved_keys == deleted_keys
    assert len(saved_keys) == 1


def test_delete_stored_result_file_ignores_storage_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    deleted: list[str] = []

    def delete(key: str) -> None:
        deleted.append(key)
        raise OSError("storage unavailable")

    monkeypatch.setattr("tasks.evaluation_task.storage.delete", delete)
    _delete_stored_result_file("result-key")
    assert deleted == ["result-key"]


def test_customized_workflow_uses_pinned_version_and_keeps_row_errors(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.app.apps.workflow.app_generator import WorkflowAppGenerator
    from models.model import AppMode
    from services.workflow_service import WorkflowService

    account = make_account()
    tenant = make_tenant()
    workflow = make_workflow(
        workflow_id="workflow-1", app_id="evaluator-app-1", version="1", kind=WorkflowKind.EVALUATION
    )
    app = make_app(app_id="evaluator-app-1", mode=AppMode.WORKFLOW, created_by=account.id, workflow_id=workflow.id)
    sqlite_session.add_all(
        [
            account,
            tenant,
            TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.NORMAL),
            app,
            workflow,
        ]
    )
    sqlite_session.commit()

    @contextmanager
    def create_session() -> Generator[Session]:
        yield sqlite_session

    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)
    monkeypatch.setattr(
        "services.workflow_service.WorkflowService",
        partial(WorkflowService, session_maker=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)),
    )
    generated: list[dict[str, object]] = []

    def generate(_self: WorkflowAppGenerator, **kwargs: object) -> dict[str, object]:
        generated.append(kwargs)
        outputs = {"score": 0.8} if kwargs["task_id"] == "task-0" else {}
        return {"data": {"outputs": outputs}}

    monkeypatch.setattr(WorkflowAppGenerator, "generate", generate)
    cancellation_checks: list[int] = []
    metrics = CustomizedMetrics(
        evaluation_workflow_id=app.id,
        evaluation_workflow_version_id=workflow.id,
        input_fields={"prompt": "{{#node.text#}}"},
        output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
    )

    results = _evaluate_with_customized_workflow(
        CapturingEvaluationInstance(),
        [
            {"node": NodeRunResult(outputs={"text": "first"})},
            {"node": NodeRunResult(outputs={"text": "second"})},
        ],
        metrics,
        tenant.id,
        cancellation_check=lambda: cancellation_checks.append(1),
        task_id_factory=lambda index: f"task-{index}",
    )

    assert len(generated) == 2
    assert generated[0]["workflow"] is workflow
    assert generated[0]["args"] == {"inputs": {"prompt": "first"}}
    assert generated[1]["args"] == {"inputs": {"prompt": "second"}}
    assert results[0].metrics[0].name == "score"
    assert results[0].metrics[0].value == 0.8
    assert results[1].error == (
        "Customized evaluation failed: Evaluation workflow returned none of the configured metric outputs"
    )
    assert len(cancellation_checks) == 4


def test_workflow_metric_runner_scores_only_rows_with_a_matching_node(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    def evaluate(items: list[EvaluationItemInput]) -> list[EvaluationItemResult]:
        return [
            EvaluationItemResult(index=0, metrics=[EvaluationMetric(name="answer_relevancy", value=0.9)])
            for _item in items
        ]

    evaluation_instance = CapturingEvaluationInstance(llm_result_factory=evaluate)
    progress: list[float] = []
    persisted: list[list[EvaluationItemResult]] = []
    monkeypatch.setattr("tasks.evaluation_task._cooperative_checkpoint", lambda *_args: None)
    monkeypatch.setattr(
        "tasks.evaluation_task._update_run_progress", lambda _session, _lease, rate: progress.append(rate)
    )
    monkeypatch.setattr(
        "tasks.evaluation_task._persist_results",
        lambda _session, _lease, results, *_args: persisted.append(results),
    )
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="answer_relevancy", node_info_list=[_NODE_INFO])],
        input_list=[
            EvaluationDatasetInput(index=10, inputs={"query": "missing"}),
            EvaluationDatasetInput(index=20, inputs={"query": "present"}, expected_output="expected"),
        ],
    )

    results = _execute_evaluation_runner(
        sqlite_session,
        run_data,
        evaluation_instance,
        [{}, {"llm-1": NodeRunResult(outputs={"text": "answer"})}],
        _lease(run_data.evaluation_run_id),
    )

    assert results[0].index == 10
    assert results[0].error == "Target execution produced no successful node results for this row."
    assert results[1].index == 20
    assert results[1].metrics[0].name == "answer_relevancy"
    assert results[1].metrics[0].node_info == _NODE_INFO
    assert evaluation_instance.llm_items[0].output == "answer"
    assert progress == [0.85]
    assert persisted == [results]


def test_workflow_metric_failures_remain_row_local_when_customized_evaluator_fails(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail_metric(_items: list[EvaluationItemInput]) -> list[EvaluationItemResult]:
        raise RuntimeError("judge unavailable")

    def fail_customized(**_kwargs: object) -> list[EvaluationItemResult]:
        raise RuntimeError("evaluator unavailable")

    persisted: list[list[EvaluationItemResult]] = []
    monkeypatch.setattr("tasks.evaluation_task._cooperative_checkpoint", lambda *_args: None)
    monkeypatch.setattr("tasks.evaluation_task._update_run_progress", lambda *_args: None)
    monkeypatch.setattr("tasks.evaluation_task._evaluate_with_customized_workflow", fail_customized)
    monkeypatch.setattr(
        "tasks.evaluation_task._persist_results", lambda _session, _lease, results, *_args: persisted.append(results)
    )
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="answer_relevancy", node_info_list=[_NODE_INFO])],
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            evaluation_workflow_version_id="evaluator-version",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        ),
        input_list=[EvaluationDatasetInput(index=7, inputs={"query": "hello"})],
    )

    results = _execute_evaluation_runner(
        sqlite_session,
        run_data,
        CapturingEvaluationInstance(llm_result_factory=fail_metric),
        [{"llm-1": NodeRunResult(outputs={"text": "answer"})}],
        _lease("run-1"),
    )

    assert "judge unavailable" in (results[0].error or "")
    assert "evaluator unavailable" in (results[0].error or "")
    assert persisted == [results]


def test_retrieval_metric_runner_preserves_row_errors_when_scoring_fails(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("tasks.evaluation_task._cooperative_checkpoint", lambda *_args: None)
    progress: list[float] = []
    persisted: list[list[EvaluationItemResult]] = []
    monkeypatch.setattr(
        "tasks.evaluation_task._update_run_progress", lambda _session, _lease, rate: progress.append(rate)
    )
    monkeypatch.setattr(
        "tasks.evaluation_task._persist_results",
        lambda _session, _lease, results, *_args: persisted.append(results),
    )

    def fail_scoring(*_args: object, **_kwargs: object) -> list[EvaluationItemResult]:
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr("tasks.evaluation_task.RetrievalEvaluationRunner.evaluate_metrics", fail_scoring)
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="knowledge_base",
        target_id="dataset-1",
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="context_precision", node_info_list=[])],
        input_list=[
            EvaluationDatasetInput(index=10, inputs={"query": "present"}),
            EvaluationDatasetInput(index=20, inputs={"query": "failed"}),
        ],
    )

    results = _evaluate_retrieval_results(
        sqlite_session,
        run_data,
        CapturingEvaluationInstance(),
        [NodeRunResult(outputs={"result": []}), None],
        [None, "retrieval timeout"],
        _lease(run_data.evaluation_run_id),
    )

    assert results[0].error == "Retrieval metric 'context_precision' failed: provider unavailable"
    assert results[1].error == "Retrieval failed: retrieval timeout"
    assert progress == [0.85]
    assert persisted == [results]


def test_customized_metric_runner_maps_filtered_rows_to_original_positions(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("tasks.evaluation_task._cooperative_checkpoint", lambda *_args: None)
    persisted: list[list[EvaluationItemResult]] = []
    monkeypatch.setattr(
        "tasks.evaluation_task._persist_results",
        lambda _session, _lease, results, *_args: persisted.append(results),
    )
    evaluator_task_ids: list[str] = []

    def evaluate_customized(**kwargs: object) -> list[EvaluationItemResult]:
        mappings = kwargs["node_run_result_mapping_list"]
        assert isinstance(mappings, list)
        assert len(mappings) == 1
        task_id_factory = kwargs["task_id_factory"]
        assert callable(task_id_factory)
        evaluator_task_ids.append(task_id_factory(0))
        return [EvaluationItemResult(index=0, metrics=[EvaluationMetric(name="score", value=0.9)])]

    monkeypatch.setattr("tasks.evaluation_task._evaluate_with_customized_workflow", evaluate_customized)
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        evaluation_model_provider="provider",
        evaluation_model="model",
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            evaluation_workflow_version_id="evaluator-version",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        ),
        input_list=[
            EvaluationDatasetInput(index=10, inputs={"prompt": "missing"}),
            EvaluationDatasetInput(index=20, inputs={"prompt": "present"}),
        ],
    )

    results = _execute_evaluation_runner(
        sqlite_session,
        run_data,
        CapturingEvaluationInstance(),
        [{}, {"llm": NodeRunResult(outputs={"text": "answer"})}],
        _lease(run_data.evaluation_run_id),
        task_positions=[5, 7],
        report_progress=False,
    )

    assert evaluator_task_ids == [_workflow_task_id("run-1", "evaluator", 7)]
    assert results[0].error == "Target execution produced no successful node results for this row."
    assert results[1].index == 20
    assert results[1].metrics[0].value == 0.9
    assert persisted == [results]


_NODE_INFO = NodeInfo(node_id="llm-1", type="llm", title="Answer")
_EXECUTION_TOKEN = "40000000-0000-0000-0000-000000000001"


def _lease(run_id: str, token: str = _EXECUTION_TOKEN) -> EvaluationRunLease:
    return EvaluationRunLease(run_id=run_id, token=token)


class _RecordingCeleryControl:
    """Keep revocation calls observable at the Celery boundary."""

    def __init__(self) -> None:
        self.revocations: list[tuple[str, bool]] = []

    def revoke(self, task_id: str, *, terminate: bool) -> None:
        self.revocations.append((task_id, terminate))


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
    _stamp_and_merge([EvaluationItemResult(index=5, error="extra result")], [42], _NODE_INFO, results_by_index)

    assert [metric.name for metric in results_by_index[42].metrics] == [
        "faithfulness",
        "answer_correctness",
    ]
    assert results_by_index[42].metrics[0].node_info == _NODE_INFO


def test_create_runner_supports_agent_category() -> None:
    assert isinstance(_create_runner(EvaluationCategory.AGENT, CapturingEvaluationInstance()), AgentEvaluationRunner)
    assert isinstance(_create_runner(EvaluationCategory.LLM, CapturingEvaluationInstance()), LLMEvaluationRunner)
    assert isinstance(
        _create_runner(EvaluationCategory.RETRIEVAL, CapturingEvaluationInstance()), RetrievalEvaluationRunner
    )
    assert isinstance(
        _create_runner(EvaluationCategory.KNOWLEDGE_BASE, CapturingEvaluationInstance()), RetrievalEvaluationRunner
    )
    with pytest.raises(ValueError, match="Unsupported evaluation category"):
        _create_runner(EvaluationCategory.WORKFLOW, CapturingEvaluationInstance())


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
    sqlite_session: Session,
) -> None:
    evaluation_instance = CapturingEvaluationInstance()
    evaluator_calls: list[dict[str, object]] = []

    def customized_evaluator(**kwargs: object) -> list[EvaluationItemResult]:
        evaluator_calls.append(kwargs)
        return [EvaluationItemResult(index=0, metrics=[EvaluationMetric(name="score", value=0.9)])]

    monkeypatch.setattr("tasks.evaluation_task._evaluate_with_customized_workflow", customized_evaluator)
    persisted_results: list[list[EvaluationItemResult]] = []

    def persist_results(
        _session: Session, _lease: EvaluationRunLease, results: list[EvaluationItemResult], *_args: object
    ) -> None:
        persisted_results.append(results)

    monkeypatch.setattr("tasks.evaluation_task._persist_results", persist_results)
    monkeypatch.setattr("tasks.evaluation_task._cooperative_checkpoint", lambda *_args: None)
    monkeypatch.setattr("tasks.evaluation_task._update_run_progress", lambda *_args: None)
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
        session=sqlite_session,
        run_data=run_data,
        evaluation_instance=evaluation_instance,
        node_run_result_mapping_list=[{}, {"llm-1": successful_node_result}],
        lease=_lease(run_data.evaluation_run_id),
    )

    assert results[0].index == 10
    assert results[0].error == "Target execution produced no successful node results for this row."
    assert results[1].index == 20
    assert results[1].metrics[0].name == "score"
    assert len(evaluator_calls) == 1
    call_kwargs = evaluator_calls[0]
    assert call_kwargs["evaluation_instance"] is evaluation_instance
    assert call_kwargs["node_run_result_mapping_list"] == [{"llm-1": successful_node_result}]
    assert call_kwargs["customized_metrics"] == run_data.customized_metrics
    assert call_kwargs["tenant_id"] == "tenant-1"
    assert callable(call_kwargs["cancellation_check"])
    assert callable(call_kwargs["task_id_factory"])
    assert persisted_results == [results]


def test_customized_evaluator_missing_pinned_version_is_not_materialized_as_row_error(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    evaluation_instance = CapturingEvaluationInstance()

    def customized_evaluator(**_kwargs: object) -> list[EvaluationItemResult]:
        raise EvaluationWorkflowVersionNotFoundError("Pinned evaluation workflow version was deleted.")

    monkeypatch.setattr("tasks.evaluation_task._evaluate_with_customized_workflow", customized_evaluator)
    persisted_results: list[list[EvaluationItemResult]] = []

    def persist_results(
        _session: Session, _lease: EvaluationRunLease, results: list[EvaluationItemResult], *_args: object
    ) -> None:
        persisted_results.append(results)

    monkeypatch.setattr("tasks.evaluation_task._persist_results", persist_results)
    monkeypatch.setattr("tasks.evaluation_task._cooperative_checkpoint", lambda *_args: None)
    monkeypatch.setattr("tasks.evaluation_task._update_run_progress", lambda *_args: None)
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
            session=sqlite_session,
            run_data=run_data,
            evaluation_instance=evaluation_instance,
            node_run_result_mapping_list=[{"llm-1": NodeRunResult(outputs={"text": "answer"})}],
            lease=_lease(run_data.evaluation_run_id),
        )

    assert persisted_results == []


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
    target_id = _workflow_task_id("run-1", "target", 3)

    assert UUID(target_id).version == 5
    assert target_id == _workflow_task_id("run-1", "target", 3)
    ids = {
        target_id,
        _workflow_task_id("run-1", "evaluator", 3),
        _workflow_task_id("run-1", "target", 4),
        _workflow_task_id("run-2", "target", 3),
    }
    assert len(ids) == 4


def test_execute_evaluation_starts_running_lease_before_work(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    run_id = "30000000-0000-0000-0000-000000000051"
    workflow_version_id = "30000000-0000-0000-0000-000000000004"
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id="30000000-0000-0000-0000-000000000002",
                target_type=EvaluationTargetType.APPS,
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

    executed_leases: list[EvaluationRunLease] = []

    def execute_running(
        _session: Session,
        _run_data: EvaluationRunData,
        _evaluation_instance: object,
        _created_by: str,
        execution_lease: EvaluationRunLease,
    ) -> None:
        executed_leases.append(execution_lease)

    monkeypatch.setattr("tasks.evaluation_task._execute_running_evaluation", execute_running)
    maintained_leases: list[EvaluationRunLease] = []

    @contextmanager
    def maintain_heartbeat(lease: EvaluationRunLease) -> Generator[None]:
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
    assert executed_leases == [lease]


def test_execute_evaluation_accepts_knowledge_retrieval_v2_payload(
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
                target_type=EvaluationTargetType.APPS,
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

    executed: list[EvaluationRunData] = []

    def execute_running(
        _session: Session,
        payload: EvaluationRunData,
        _evaluation_instance: object,
        _created_by: str,
        _lease: EvaluationRunLease,
    ) -> None:
        executed.append(payload)

    monkeypatch.setattr("tasks.evaluation_task._execute_running_evaluation", execute_running)

    @contextmanager
    def maintain_heartbeat(_lease: EvaluationRunLease) -> Generator[None]:
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
        _execute_evaluation(session, run_data, _lease(run_id))

    assert executed == [run_data]


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
                target_type=EvaluationTargetType.APPS,
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

    def fail_on_evaluation(*_args: object) -> None:
        pytest.fail("Duplicate delivery must not begin evaluation")

    monkeypatch.setattr("tasks.evaluation_task._execute_running_evaluation", fail_on_evaluation)
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


@pytest.mark.parametrize(
    ("case", "expected_error"),
    [
        ("wrong_lease", "lease does not match"),
        ("missing_run", None),
        ("cancelled", None),
        ("mismatched_payload", "payload does not match"),
        ("missing_workflow_version", "missing target_workflow_version_id"),
        ("missing_agent_snapshot", "missing target_agent_config_snapshot_id"),
        ("framework_unconfigured", "framework not configured"),
    ],
)
def test_execute_evaluation_rejects_invalid_or_terminal_task_deliveries(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    case: str,
    expected_error: str | None,
) -> None:
    run_id = "30000000-0000-0000-0000-000000000055"
    target_type = (
        EvaluationTargetType.APPS
        if case == "missing_workflow_version"
        else EvaluationTargetType.AGENTS
        if case == "missing_agent_snapshot"
        else EvaluationTargetType.KNOWLEDGE_BASE
    )
    persisted_target_id = "30000000-0000-0000-0000-000000000003"
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id="30000000-0000-0000-0000-000000000002",
        target_type=target_type.value,
        target_id="other-target" if case == "mismatched_payload" else persisted_target_id,
        evaluation_model_provider="",
        evaluation_model="",
        input_list=[],
    )
    if case not in {"wrong_lease", "missing_run"}:
        with sqlite_session_factory() as session:
            session.add(
                EvaluationRun(
                    id=run_id,
                    tenant_id=run_data.tenant_id,
                    target_type=target_type,
                    target_id=persisted_target_id,
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.CANCELLED if case == "cancelled" else EvaluationRunStatus.PENDING,
                    total_items=0,
                    created_by="30000000-0000-0000-0000-000000000006",
                )
            )
            session.commit()
    if case == "framework_unconfigured":
        monkeypatch.setattr("tasks.evaluation_task.EvaluationManager.get_evaluation_instance", lambda _framework: None)
    monkeypatch.setattr(
        "tasks.evaluation_task._execute_running_evaluation",
        lambda *_args: pytest.fail("An invalid or terminal task must not execute rows"),
    )
    lease = _lease("other-run") if case == "wrong_lease" else _lease(run_id)

    with sqlite_session_factory() as session:
        if expected_error:
            with pytest.raises(ValueError, match=expected_error):
                _execute_evaluation(session, run_data, lease)
        else:
            _execute_evaluation(session, run_data, lease)

    if case == "cancelled":
        with sqlite_session_factory() as session:
            run = session.get(EvaluationRun, run_id)
            assert run is not None
            assert run.status == EvaluationRunStatus.CANCELLED


@pytest.mark.parametrize(
    ("failure", "expected_failure"),
    [
        (EvaluationRunCancelledError(), None),
        (EvaluationRunOwnershipLostError("stale task"), None),
        (ValueError("invalid payload"), "invalid payload"),
        (RuntimeError("backend unavailable"), "Evaluation failed after 1 attempts: backend unavailable"),
    ],
)
def test_run_evaluation_classifies_terminal_and_nonretryable_failures(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    failure: Exception,
    expected_failure: str | None,
) -> None:
    @contextmanager
    def create_session() -> Generator[Session]:
        with sqlite_session_factory() as session:
            yield session

    def fail_execution(*_args: object) -> None:
        raise failure

    failures: list[str] = []
    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)
    monkeypatch.setattr("tasks.evaluation_task._execute_evaluation", fail_execution)
    monkeypatch.setattr(
        "tasks.evaluation_task._mark_run_failed", lambda _session, _lease, error: failures.append(error)
    )
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_MAX_RETRIES", 0)
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="knowledge_base",
        target_id="dataset-1",
        evaluation_model_provider="",
        evaluation_model="",
        input_list=[],
    )

    run_evaluation.push_request(retries=0)
    try:
        run_evaluation.run(run_data.model_dump(mode="json"))
    finally:
        run_evaluation.pop_request()

    assert failures == ([expected_failure] if expected_failure else [])


@pytest.mark.parametrize("persist_raises", [False, True])
def test_run_evaluation_retries_when_state_persistence_loses_the_run(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session], persist_raises: bool
) -> None:
    @contextmanager
    def create_session() -> Generator[Session]:
        with sqlite_session_factory() as session:
            yield session

    def fail_execution(*_args: object) -> None:
        raise RuntimeError("temporary outage")

    def mark_pending(*_args: object) -> bool:
        if persist_raises:
            raise RuntimeError("retry state unavailable")
        return False

    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)
    monkeypatch.setattr("tasks.evaluation_task._execute_evaluation", fail_execution)
    monkeypatch.setattr("tasks.evaluation_task._mark_run_pending_for_retry", mark_pending)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_MAX_RETRIES", 2)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_RETRY_DELAY", 1)
    monkeypatch.setattr(run_evaluation, "retry", lambda **_kwargs: Retry("scheduled"))
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="knowledge_base",
        target_id="dataset-1",
        evaluation_model_provider="",
        evaluation_model="",
        input_list=[],
    )

    run_evaluation.push_request(retries=0)
    try:
        if persist_raises:
            with pytest.raises(Retry, match="scheduled"):
                run_evaluation.run(run_data.model_dump(mode="json"))
        else:
            run_evaluation.run(run_data.model_dump(mode="json"))
    finally:
        run_evaluation.pop_request()


def test_heartbeat_context_recovers_from_transient_renewal_error(monkeypatch: pytest.MonkeyPatch) -> None:
    renewed = Event()
    attempts: list[int] = []

    def renew(_lease: EvaluationRunLease) -> bool:
        attempts.append(len(attempts))
        if len(attempts) == 1:
            raise RuntimeError("temporary database outage")
        renewed.set()
        return False

    monkeypatch.setattr("tasks.evaluation_task._renew_evaluation_run_heartbeat", renew)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_HEARTBEAT_INTERVAL", 0.001)
    with _maintain_evaluation_run_heartbeat(_lease("run-1")):
        assert renewed.wait(1)

    assert len(attempts) == 2


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
                target_type=EvaluationTargetType.KNOWLEDGE_BASE,
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
    def create_session() -> Generator[Session]:
        with sqlite_session_factory() as session:
            yield session

    transient_error = RuntimeError("temporary database outage")
    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)

    def fail_running_evaluation(*_args: object) -> None:
        raise transient_error

    monkeypatch.setattr("tasks.evaluation_task._execute_running_evaluation", fail_running_evaluation)

    @contextmanager
    def maintain_heartbeat(_lease: EvaluationRunLease) -> Generator[None]:
        yield

    monkeypatch.setattr("tasks.evaluation_task._maintain_evaluation_run_heartbeat", maintain_heartbeat)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_MAX_RETRIES", 3)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_RETRY_DELAY", 7)
    retry_calls: list[tuple[BaseException, int, bool]] = []

    def retry(*, exc: BaseException, countdown: int, throw: bool) -> Retry:
        retry_calls.append((exc, countdown, throw))
        return Retry("scheduled")

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

    assert retry_calls == [(transient_error, 7, False)]
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
                target_type=EvaluationTargetType.APPS,
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
    def create_session() -> Generator[Session]:
        with sqlite_session_factory() as session:
            yield session

    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)

    def missing_workflow(*_args: object) -> None:
        raise EvaluationWorkflowVersionNotFoundError("Pinned workflow version was deleted.")

    monkeypatch.setattr("tasks.evaluation_task._execute_running_evaluation", missing_workflow)

    @contextmanager
    def maintain_heartbeat(_lease: EvaluationRunLease) -> Generator[None]:
        yield

    monkeypatch.setattr("tasks.evaluation_task._maintain_evaluation_run_heartbeat", maintain_heartbeat)
    retry_calls: list[object] = []
    monkeypatch.setattr(run_evaluation, "retry", lambda **kwargs: retry_calls.append(kwargs))
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

    assert retry_calls == []
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
                target_type=EvaluationTargetType.APPS,
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


def test_completed_checkpoints_publish_result_file_and_finish_run(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    run_id = "30000000-0000-0000-0000-000000000083"
    lease = _lease(run_id)
    item = EvaluationDatasetInput(index=7, inputs={"prompt": "What is the answer?"}, expected_output="42")
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
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id=run_data.tenant_id,
                target_type=EvaluationTargetType.APPS,
                target_id=run_data.target_id,
                target_workflow_version_id=run_data.target_workflow_version_id,
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.RUNNING,
                execution_token=lease.token,
                total_items=1,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()
        _persist_results(
            session,
            lease,
            [EvaluationItemResult(index=7, actual_output="42", metrics=[EvaluationMetric(name="accuracy", value=1.0)])],
            [item],
        )

    def resume_checkpointed_rows(*_args: object) -> None:
        return None

    saved: list[tuple[str, bytes]] = []
    monkeypatch.setattr("tasks.evaluation_task._resume_workflow_rows", resume_checkpointed_rows)
    monkeypatch.setattr("tasks.evaluation_task.storage.save", lambda key, content: saved.append((key, content)))
    with sqlite_session_factory() as session:
        _execute_running_evaluation(
            session,
            run_data,
            CapturingEvaluationInstance(),
            "30000000-0000-0000-0000-000000000006",
            lease,
        )

    with sqlite_session_factory() as session:
        run = session.get(EvaluationRun, run_id)
        assert run is not None
        assert run.status == EvaluationRunStatus.COMPLETED
        assert run.execution_token is None
        assert run.completed_items == 1
        assert run.failed_items == 0
        assert run.result_file_id is not None
        upload = session.get(UploadFile, run.result_file_id)
        assert upload is not None
        assert upload.key == saved[0][0]
        assert load_workbook(io.BytesIO(saved[0][1])).active is not None


def test_rejected_completion_removes_unpublished_result_file(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    run_id = "30000000-0000-0000-0000-000000000084"
    lease = _lease(run_id)
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id="30000000-0000-0000-0000-000000000002",
        target_type="apps",
        target_id="30000000-0000-0000-0000-000000000003",
        target_workflow_version_id="30000000-0000-0000-0000-000000000004",
        evaluation_model_provider="",
        evaluation_model="",
        input_list=[],
    )
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id=run_data.tenant_id,
                target_type=EvaluationTargetType.APPS,
                target_id=run_data.target_id,
                target_workflow_version_id=run_data.target_workflow_version_id,
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.RUNNING,
                execution_token=lease.token,
                total_items=0,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()

    saved_keys: list[str] = []
    deleted_keys: list[str] = []
    monkeypatch.setattr("tasks.evaluation_task._resume_workflow_rows", lambda *_args: None)
    monkeypatch.setattr("tasks.evaluation_task._update_run_progress", lambda *_args: None)
    monkeypatch.setattr("tasks.evaluation_task._affected_rows", lambda _result: 0)
    monkeypatch.setattr("tasks.evaluation_task.storage.save", lambda key, _content: saved_keys.append(key))
    monkeypatch.setattr("tasks.evaluation_task.storage.delete", lambda key: deleted_keys.append(key))

    with sqlite_session_factory() as session:
        with pytest.raises(EvaluationRunOwnershipLostError, match="completion lease was rejected"):
            _execute_running_evaluation(
                session,
                run_data,
                CapturingEvaluationInstance(),
                "30000000-0000-0000-0000-000000000006",
                lease,
            )

    assert saved_keys == deleted_keys
    assert len(saved_keys) == 1
    with sqlite_session_factory() as session:
        run = session.get(EvaluationRun, run_id)
        assert run is not None
        assert run.status == EvaluationRunStatus.RUNNING
        assert run.result_file_id is None
        assert session.scalar(select(UploadFile).where(UploadFile.key == saved_keys[0])) is None


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
                target_type=EvaluationTargetType.APPS,
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
                    target_type=EvaluationTargetType.APPS,
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
        queried_run_ids: list[str] = []

        def query_results(
            *, session: Session, tenant_id: str, app_id: str, workflow_run_id: str
        ) -> dict[str, NodeRunResult]:
            assert tenant_id == run_data.tenant_id
            assert app_id == run_data.target_id
            assert isinstance(session, Session)
            queried_run_ids.append(workflow_run_id)
            return node_results

        def execute_targets(**_kwargs: object) -> None:
            pytest.fail("Checkpointed target must not be executed again")

        runner_calls: list[dict[str, object]] = []

        def execute_runner(**kwargs: object) -> list[EvaluationItemResult]:
            runner_calls.append(kwargs)
            return []

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

        _resume_workflow_rows(session, run_data, CapturingEvaluationInstance(), lease)

    assert queried_run_ids == ["30000000-0000-0000-0000-000000000091"]
    assert len(runner_calls) == 1
    assert runner_calls[0]["node_run_result_mapping_list"] == [node_results]
    assert runner_calls[0]["workflow_run_id_map"] == {7: "30000000-0000-0000-0000-000000000091"}
    assert runner_calls[0]["task_positions"] == [0]
    assert runner_calls[0]["lease"] == lease


def test_resume_workflow_rows_checkpoints_new_targets_and_persists_row_errors(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    run_id = "30000000-0000-0000-0000-000000000102"
    lease = _lease(run_id)
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id="30000000-0000-0000-0000-000000000002",
        target_type="apps",
        target_id="30000000-0000-0000-0000-000000000003",
        target_workflow_version_id="30000000-0000-0000-0000-000000000004",
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="answer_relevancy", node_info_list=[_NODE_INFO])],
        input_list=[
            EvaluationDatasetInput(index=7, inputs={"prompt": "first"}),
            EvaluationDatasetInput(index=9, inputs={"prompt": "second"}),
        ],
    )
    with sqlite_session_factory() as session:
        session.add(
            EvaluationRun(
                id=run_id,
                tenant_id=run_data.tenant_id,
                target_type=EvaluationTargetType.APPS,
                target_id=run_data.target_id,
                target_workflow_version_id=run_data.target_workflow_version_id,
                evaluation_config_id="30000000-0000-0000-0000-000000000005",
                config_snapshot="{}",
                status=EvaluationRunStatus.RUNNING,
                execution_token=lease.token,
                total_items=2,
                created_by="30000000-0000-0000-0000-000000000006",
            )
        )
        session.commit()

    cleared_task_ids: list[str] = []
    monkeypatch.setattr(
        "core.app.apps.execution_coordinator.clear_app_task_cancellation_signals",
        lambda task_id: cleared_task_ids.append(task_id),
    )

    def execute_targets(**kwargs: object) -> tuple[list[dict[str, NodeRunResult]], list[str | None], list[str | None]]:
        callback = kwargs["result_callback"]
        progress = kwargs["progress_callback"]
        assert callable(callback)
        assert callable(progress)
        assert kwargs["task_positions"] == [0, 1]
        success = {"llm-1": NodeRunResult(outputs={"text": "answer"})}
        callback(0, success, "workflow-run-7", None)
        progress(1, 2)
        callback(1, {}, None, "provider unavailable")
        progress(2, 2)
        return [success, {}], ["workflow-run-7", None], [None, "provider unavailable"]

    monkeypatch.setattr(EvaluationService, "execute_targets", execute_targets)
    evaluator = CapturingEvaluationInstance(
        llm_result_factory=lambda items: [
            EvaluationItemResult(index=0, metrics=[EvaluationMetric(name="answer_relevancy", value=0.8)])
            for _item in items
        ]
    )
    with sqlite_session_factory() as session:
        _resume_workflow_rows(session, run_data, evaluator, lease)

    with sqlite_session_factory() as session:
        checkpoints = session.scalars(
            select(EvaluationRunItem)
            .where(EvaluationRunItem.evaluation_run_id == run_id)
            .order_by(EvaluationRunItem.item_index)
        ).all()
        assert [checkpoint.status for checkpoint in checkpoints] == [
            EvaluationRunItemStatus.COMPLETED,
            EvaluationRunItemStatus.COMPLETED,
        ]
        assert checkpoints[0].workflow_run_id == "workflow-run-7"
        assert checkpoints[0].metrics_list[0]["value"] == 0.8
        assert checkpoints[1].error == "Target execution failed: provider unavailable"
    assert cleared_task_ids == [
        _workflow_task_id(run_id, "target", 0),
        _workflow_task_id(run_id, "target", 1),
    ]


@pytest.mark.parametrize("scenario", ["success", "failed", "stream_ended"])
def test_execute_agent_target_persists_backend_checkpoint_and_terminal_result(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    scenario: str,
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
                target_type=EvaluationTargetType.AGENTS,
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

    target = ResolvedAgentEvaluationTarget(
        agent_id=agent_id,
        agent_name="Research Agent",
        app_id="app-1",
        config_snapshot_id=snapshot_id,
        home_snapshot_id=None,
        agent_soul=AgentSoulConfig(),
    )
    monkeypatch.setattr(
        "tasks.evaluation_task.AgentEvaluationTargetService.resolve_active_snapshot",
        lambda **_kwargs: target,
    )
    binding = AgentWorkspaceBinding(
        id=binding_id,
        tenant_id=tenant_id,
        app_id="app-1",
        workspace_id="workspace-1",
        agent_id=agent_id,
        agent_config_version_id=snapshot_id,
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref="binding-ref-1",
    )
    monkeypatch.setattr(
        "tasks.evaluation_task.AgentEvaluationTargetService.ensure_row_binding",
        lambda **_kwargs: binding,
    )
    runtime_request = AgentAppRuntimeRequest(
        request=CreateRunRequest(composition=RunComposition(layers=[])),
        redacted_request={},
        metadata={},
        binding_id=binding_id,
    )
    monkeypatch.setattr(
        "tasks.evaluation_task.AgentEvaluationTargetService.build_runtime_request",
        lambda **_kwargs: runtime_request,
    )
    client = FakeAgentBackendRunClient(
        run_id="backend-run-1",
        scenario=FakeAgentBackendScenario.FAILED if scenario == "failed" else FakeAgentBackendScenario.SUCCESS,
    )
    if scenario == "stream_ended":
        monkeypatch.setattr(client, "stream_events", lambda *_args, **_kwargs: iter(()))
    monkeypatch.setattr("tasks.evaluation_task.create_agent_backend_run_client", lambda **_kwargs: client)
    retired_bindings: list[tuple[str, str]] = []

    def retire_binding(*, session: Session, tenant_id: str, binding_id: str) -> str:
        assert isinstance(session, Session)
        retired_bindings.append((tenant_id, binding_id))
        return binding_id

    monkeypatch.setattr(
        "tasks.evaluation_task.AgentWorkspaceService.retire_binding",
        retire_binding,
    )
    enqueued_bindings: list[tuple[str, str]] = []

    def enqueue_binding(tenant_id: str, binding_id: str) -> None:
        enqueued_bindings.append((tenant_id, binding_id))

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
        if scenario == "stream_ended":
            with pytest.raises(RuntimeError, match="ended without a terminal event"):
                _execute_agent_target(
                    session=session,
                    run_data=run_data,
                    dataset_item=dataset_item,
                    account_id="30000000-0000-0000-0000-000000000006",
                    lease=lease,
                )
        else:
            agent_item, target_error = _execute_agent_target(
                session=session,
                run_data=run_data,
                dataset_item=dataset_item,
                account_id="30000000-0000-0000-0000-000000000006",
                lease=lease,
            )
            if scenario == "success":
                assert target_error is None
                assert agent_item is not None
                assert agent_item.output == "hello agent"
            else:
                assert agent_item is None
                assert target_error == "Agent execution failed: fake failure"

    assert client.request is runtime_request.request
    with sqlite_session_factory() as session:
        checkpoint = session.scalar(
            select(EvaluationRunItem).where(
                EvaluationRunItem.evaluation_run_id == run_id,
                EvaluationRunItem.item_index == 7,
            )
        )
        assert checkpoint is not None
        assert checkpoint.status == (
            EvaluationRunItemStatus.TARGET_RUNNING
            if scenario == "stream_ended"
            else EvaluationRunItemStatus.TARGET_COMPLETED
        )
        assert checkpoint.agent_backend_run_id == "backend-run-1"
        assert checkpoint.agent_workspace_binding_id == binding_id
        if scenario == "success":
            assert (
                AgentEvaluationItem.model_validate_json(checkpoint.target_result_json or "{}").output == "hello agent"
            )
        else:
            assert checkpoint.target_result_json is None
    assert retired_bindings == ([] if scenario == "stream_ended" else [(tenant_id, binding_id)])
    assert enqueued_bindings == ([] if scenario == "stream_ended" else [(tenant_id, binding_id)])


def test_execute_agent_target_reuses_persisted_target_without_restarting_backend(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    run_id = "30000000-0000-0000-0000-000000000122"
    lease = _lease(run_id)
    item = EvaluationDatasetInput(index=7, inputs={"query": "research this"})
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id="30000000-0000-0000-0000-000000000002",
        target_type="agents",
        target_id="30000000-0000-0000-0000-000000000003",
        target_agent_config_snapshot_id="30000000-0000-0000-0000-000000000004",
        evaluation_model_provider="",
        evaluation_model="",
        input_list=[item],
    )
    with sqlite_session_factory() as session:
        session.add_all(
            [
                EvaluationRun(
                    id=run_id,
                    tenant_id=run_data.tenant_id,
                    target_type=EvaluationTargetType.AGENTS,
                    target_id=run_data.target_id,
                    target_agent_config_snapshot_id=run_data.target_agent_config_snapshot_id,
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
                    inputs='{"query": "research this"}',
                    target_result_json=AgentEvaluationItem(
                        index=7, inputs={"task": "research this"}, output="done"
                    ).model_dump_json(),
                ),
            ]
        )
        session.commit()

    monkeypatch.setattr(
        "tasks.evaluation_task.AgentEvaluationTargetService.resolve_active_snapshot", lambda **_kwargs: object()
    )

    def unexpected_backend(*_args: object, **_kwargs: object) -> None:
        pytest.fail("A checkpointed row must not restart the Agent backend")

    monkeypatch.setattr("tasks.evaluation_task.create_agent_backend_run_client", unexpected_backend)
    with sqlite_session_factory() as session:
        agent_item, error = _execute_agent_target(
            session=session, run_data=run_data, dataset_item=item, account_id="account-1", lease=lease
        )
        assert agent_item is not None
        assert agent_item.output == "done"
        assert error is None

        checkpoint = session.scalar(
            select(EvaluationRunItem).where(
                EvaluationRunItem.evaluation_run_id == run_id, EvaluationRunItem.item_index == 7
            )
        )
        assert checkpoint is not None
        checkpoint.status = EvaluationRunItemStatus.COMPLETED
        session.commit()
        agent_item, error = _execute_agent_target(
            session=session, run_data=run_data, dataset_item=item, account_id="account-1", lease=lease
        )

    assert agent_item is None
    assert error == "Agent evaluation row was already completed."


@pytest.mark.parametrize("retire_result", ["binding-1", None, "failure"])
def test_retire_agent_binding_enqueues_only_a_successful_retirement(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    retire_result: str | None,
) -> None:
    @contextmanager
    def create_session() -> Generator[Session]:
        with sqlite_session_factory() as session:
            yield session

    def retire(*, session: Session, tenant_id: str, binding_id: str) -> str | None:
        assert isinstance(session, Session)
        assert (tenant_id, binding_id) == ("tenant-1", "binding-1")
        if retire_result == "failure":
            raise RuntimeError("cleanup unavailable")
        return retire_result

    enqueued: list[tuple[str, str]] = []
    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)
    monkeypatch.setattr("tasks.evaluation_task.AgentWorkspaceService.retire_binding", retire)
    monkeypatch.setattr(
        "tasks.evaluation_task._enqueue_retired_agent_binding",
        lambda tenant_id, binding_id: enqueued.append((tenant_id, binding_id)),
    )

    _retire_agent_binding("tenant-1", "binding-1")

    assert enqueued == ([("tenant-1", "binding-1")] if retire_result == "binding-1" else [])


def test_retired_agent_binding_enqueue_failure_is_contained(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_enqueue(**_kwargs: object) -> None:
        raise RuntimeError("queue unavailable")

    monkeypatch.setattr("tasks.evaluation_task.enqueue_agent_resource_collection", fail_enqueue)
    _enqueue_retired_agent_binding("tenant-1", "binding-1")


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
                    target_type=EvaluationTargetType.AGENTS,
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

    def execute_target(**_kwargs: object) -> None:
        pytest.fail("Checkpointed Agent target must not be executed again")

    evaluated_rows: list[dict[str, object]] = []

    def evaluate_row(**kwargs: object) -> None:
        evaluated_rows.append(kwargs)

    monkeypatch.setattr("tasks.evaluation_task._execute_agent_target", execute_target)
    monkeypatch.setattr("tasks.evaluation_task._evaluate_agent_row", evaluate_row)
    retired_bindings: list[tuple[str, str]] = []

    def retire_binding(tenant_id: str, binding_id: str) -> None:
        retired_bindings.append((tenant_id, binding_id))

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
        _resume_agent_rows(session, run_data, CapturingEvaluationInstance(), "account-1", lease)

    assert retired_bindings == [(tenant_id, "30000000-0000-0000-0000-000000000008")]
    assert evaluated_rows[0]["agent_item"] == checkpointed_item
    assert evaluated_rows[0]["target_error"] is None


def test_resume_agent_rows_skips_completed_rows_and_reports_missing_target_checkpoint(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    run_id = "30000000-0000-0000-0000-000000000132"
    tenant_id = "30000000-0000-0000-0000-000000000002"
    lease = _lease(run_id)
    with sqlite_session_factory() as session:
        session.add_all(
            [
                EvaluationRun(
                    id=run_id,
                    tenant_id=tenant_id,
                    target_type=EvaluationTargetType.AGENTS,
                    target_id="30000000-0000-0000-0000-000000000003",
                    target_agent_config_snapshot_id="30000000-0000-0000-0000-000000000004",
                    evaluation_config_id="30000000-0000-0000-0000-000000000005",
                    config_snapshot="{}",
                    status=EvaluationRunStatus.RUNNING,
                    execution_token=lease.token,
                    total_items=3,
                    created_by="30000000-0000-0000-0000-000000000006",
                ),
                EvaluationRunItem(
                    evaluation_run_id=run_id,
                    item_index=1,
                    status=EvaluationRunItemStatus.COMPLETED,
                    inputs='{"query": "completed"}',
                    agent_workspace_binding_id="binding-completed",
                ),
                EvaluationRunItem(
                    evaluation_run_id=run_id,
                    item_index=2,
                    status=EvaluationRunItemStatus.TARGET_COMPLETED,
                    inputs='{"query": "missing"}',
                    agent_workspace_binding_id="binding-missing",
                ),
            ]
        )
        session.commit()

    fresh_item = AgentEvaluationItem(index=3, inputs={"task": "new"}, output="new answer")
    executed: list[int] = []

    def execute_target(**kwargs: object) -> tuple[AgentEvaluationItem, None]:
        dataset_item = kwargs["dataset_item"]
        assert isinstance(dataset_item, EvaluationDatasetInput)
        executed.append(dataset_item.index)
        return fresh_item, None

    evaluated: list[dict[str, object]] = []
    retired: list[str] = []
    progress: list[float] = []
    monkeypatch.setattr("tasks.evaluation_task._execute_agent_target", execute_target)
    monkeypatch.setattr("tasks.evaluation_task._evaluate_agent_row", lambda **kwargs: evaluated.append(kwargs))
    monkeypatch.setattr("tasks.evaluation_task._retire_agent_binding", lambda _tenant, binding: retired.append(binding))
    monkeypatch.setattr(
        "tasks.evaluation_task._update_run_progress", lambda _session, _lease, rate: progress.append(rate)
    )
    run_data = EvaluationRunData(
        evaluation_run_id=run_id,
        tenant_id=tenant_id,
        target_type="agents",
        target_id="30000000-0000-0000-0000-000000000003",
        target_agent_config_snapshot_id="30000000-0000-0000-0000-000000000004",
        evaluation_model_provider="provider",
        evaluation_model="model",
        input_list=[
            EvaluationDatasetInput(index=1, inputs={"query": "completed"}),
            EvaluationDatasetInput(index=2, inputs={"query": "missing"}),
            EvaluationDatasetInput(index=3, inputs={"query": "new"}),
        ],
    )

    with sqlite_session_factory() as session:
        _resume_agent_rows(session, run_data, CapturingEvaluationInstance(), "account-1", lease)

    assert executed == [3]
    assert retired == ["binding-completed", "binding-missing"]
    assert [row["task_position"] for row in evaluated] == [1, 2]
    assert evaluated[0]["target_error"] == "Checkpointed Agent target result is missing."
    assert evaluated[1]["agent_item"] == fresh_item
    assert len(progress) == 2


def test_evaluate_agent_row_uses_native_agent_evaluator(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    node_info = NodeInfo(node_id="agent-1", type="agent", title="Research Agent")
    agent_item = AgentEvaluationItem(index=7, inputs={"task": "hello"}, output="done")
    evaluation_instance = CapturingEvaluationInstance(
        agent_result_factory=lambda _items: [
            EvaluationItemResult(index=0, metrics=[EvaluationMetric(name="task_completion", value=0.9)])
        ]
    )
    persisted_results: list[list[EvaluationItemResult]] = []

    def persist_results(
        _session: Session, _lease: EvaluationRunLease, results: list[EvaluationItemResult], *_args: object
    ) -> None:
        persisted_results.append(results)

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
        session=sqlite_session,
        run_data=run_data,
        evaluation_instance=evaluation_instance,
        agent_item=agent_item,
        target_error=None,
        task_position=0,
        lease=_lease("run-1"),
    )

    assert evaluation_instance.agent_calls == [([agent_item], ["task_completion"], "provider", "model", "tenant-1")]
    persisted_result = persisted_results[0][0]
    assert persisted_result.index == 7
    assert persisted_result.metrics[0].node_info == node_info
    assert persisted_result.overall_score == 0.9


def test_evaluate_agent_row_runs_customized_evaluator_without_native_metrics(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    lease = _lease("run-1")
    agent_item = AgentEvaluationItem(
        index=7,
        inputs={"task": "hello"},
        output="done",
        expected_output="expected",
    )
    evaluation_instance = CapturingEvaluationInstance()
    evaluator_calls: list[dict[str, object]] = []

    def customized_evaluator(**kwargs: object) -> list[EvaluationItemResult]:
        evaluator_calls.append(kwargs)
        return [
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

    monkeypatch.setattr("tasks.evaluation_task._evaluate_with_customized_workflow", customized_evaluator)
    persisted_results: list[list[EvaluationItemResult]] = []

    def persist_results(
        _session: Session, _lease: EvaluationRunLease, results: list[EvaluationItemResult], *_args: object
    ) -> None:
        persisted_results.append(results)

    cleared_signals: list[tuple[Session, EvaluationRunLease, str, list[int]]] = []

    def clear_signals(session: Session, lease: EvaluationRunLease, phase: str, positions: list[int]) -> None:
        cleared_signals.append((session, lease, phase, positions))

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
        session=sqlite_session,
        run_data=run_data,
        evaluation_instance=evaluation_instance,
        agent_item=agent_item,
        target_error=None,
        task_position=4,
        lease=lease,
    )

    assert evaluation_instance.agent_calls == []
    assert cleared_signals == [(sqlite_session, lease, "evaluator", [4])]
    assert len(evaluator_calls) == 1
    call_kwargs = evaluator_calls[0]
    assert call_kwargs["evaluation_instance"] is evaluation_instance
    node_results = call_kwargs["node_run_result_mapping_list"]
    assert isinstance(node_results, list)
    first_result = node_results[0]
    assert isinstance(first_result, dict)
    synthetic_result = first_result["agent"]
    assert isinstance(synthetic_result, NodeRunResult)
    assert synthetic_result.outputs["query"] == "hello"
    assert synthetic_result.outputs["output"] == "done"
    assert synthetic_result.outputs["expected_output"] == "expected"
    assert call_kwargs["customized_metrics"] == run_data.customized_metrics
    assert call_kwargs["tenant_id"] == "tenant-1"
    task_id_factory = call_kwargs["task_id_factory"]
    assert callable(task_id_factory)
    assert task_id_factory(0) == _workflow_task_id("run-1", "evaluator", 4)
    persisted_result = persisted_results[0][0]
    assert persisted_result.index == 7
    assert persisted_result.actual_output == "done"
    assert persisted_result.metrics[0].name == "score"
    assert persisted_result.overall_score == 0.8


def test_evaluate_agent_row_keeps_native_and_customized_failures_on_the_row(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    persisted: list[list[EvaluationItemResult]] = []
    monkeypatch.setattr(
        "tasks.evaluation_task._persist_results", lambda _session, _lease, results, *_args: persisted.append(results)
    )
    monkeypatch.setattr("tasks.evaluation_task._clear_workflow_cancellation_signals", lambda *_args: None)

    def customized_failure(**_kwargs: object) -> list[EvaluationItemResult]:
        raise RuntimeError("evaluator unavailable")

    monkeypatch.setattr("tasks.evaluation_task._evaluate_with_customized_workflow", customized_failure)
    run_data = EvaluationRunData(
        evaluation_run_id="run-1",
        tenant_id="tenant-1",
        target_type="agents",
        target_id="agent-1",
        target_agent_config_snapshot_id="snapshot-1",
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="task_completion", node_info_list=[NodeInfo(node_id="agent-1", type="agent", title="Agent")]
            )
        ],
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            evaluation_workflow_version_id="evaluator-version",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        ),
        input_list=[EvaluationDatasetInput(index=7, inputs={"query": "hello"})],
    )
    agent_item = AgentEvaluationItem(index=7, inputs={"task": "hello"}, output="done")

    _evaluate_agent_row(
        session=sqlite_session,
        run_data=run_data,
        evaluation_instance=CapturingEvaluationInstance(),
        agent_item=agent_item,
        target_error=None,
        task_position=2,
        lease=_lease("run-1"),
    )

    assert len(persisted) == 1
    assert persisted[0][0].actual_output == "done"
    assert "Agent evaluator returned no result" in (persisted[0][0].error or "")
    assert "evaluator unavailable" in (persisted[0][0].error or "")


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
                    target_type=EvaluationTargetType.KNOWLEDGE_BASE,
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
        retrieval_calls: list[dict[str, object]] = []

        def execute_retrieval(**kwargs: object) -> tuple[list[NodeRunResult], list[None]]:
            retrieval_calls.append(kwargs)
            return [NodeRunResult(outputs={"result": []})], [None]

        evaluation_calls: list[dict[str, object]] = []

        def evaluate_retrieval(**kwargs: object) -> None:
            evaluation_calls.append(kwargs)

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

        _resume_retrieval_rows(session, run_data, CapturingEvaluationInstance(), "account-1", lease)

    assert len(retrieval_calls) == 1
    retrieved_items = retrieval_calls[0]["input_list"]
    assert isinstance(retrieved_items, list)
    assert len(retrieved_items) == 1
    assert isinstance(retrieved_items[0], EvaluationDatasetInput)
    assert retrieved_items[0].index == 2
    assert len(evaluation_calls) == 1
    evaluated_run_data = evaluation_calls[0]["run_data"]
    assert isinstance(evaluated_run_data, EvaluationRunData)
    assert evaluated_run_data.input_list[0].index == 2
    assert evaluation_calls[0]["lease"] == lease
    assert evaluation_calls[0]["report_progress"] is False


def test_heartbeat_loop_renews_until_run_is_no_longer_running(monkeypatch: pytest.MonkeyPatch) -> None:
    stop_event = Event()
    renewed_leases: list[EvaluationRunLease] = []

    def renew_heartbeat(lease: EvaluationRunLease) -> bool:
        renewed_leases.append(lease)
        return len(renewed_leases) == 1

    monkeypatch.setattr("tasks.evaluation_task._renew_evaluation_run_heartbeat", renew_heartbeat)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_HEARTBEAT_INTERVAL", 0)
    lease = _lease("run-1")

    _renew_evaluation_run_heartbeat_while_running(lease, stop_event)

    assert renewed_leases == [lease, lease]


def test_renew_evaluation_run_heartbeat_only_updates_running_run(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
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
                    target_type=EvaluationTargetType.APPS,
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
                    target_type=EvaluationTargetType.APPS,
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
    def create_session() -> Generator[Session]:
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
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = naive_utc_now()
    with sqlite_session_factory() as session:
        session.add_all(
            [
                EvaluationRun(
                    id="30000000-0000-0000-0000-000000000001",
                    tenant_id="30000000-0000-0000-0000-000000000002",
                    target_type=EvaluationTargetType.APPS,
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
                    target_type=EvaluationTargetType.APPS,
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
                    target_type=EvaluationTargetType.APPS,
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
    def create_session() -> Generator[Session]:
        with sqlite_session_factory() as session:
            yield session

    monkeypatch.setattr("tasks.evaluation_task.session_factory.create_session", create_session)
    monkeypatch.setattr("tasks.evaluation_task.dify_config.EVALUATION_RUN_LEASE_TIMEOUT", 60)
    stopped_tasks: list[tuple[str, int]] = []

    def stop_tasks(run_id: str, total_items: int) -> None:
        stopped_tasks.append((run_id, total_items))

    monkeypatch.setattr(EvaluationService, "_stop_workflow_tasks", stop_tasks)
    from celery import current_app as celery_app

    celery_control = _RecordingCeleryControl()
    monkeypatch.setattr(celery_app, "control", celery_control)

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
    assert stopped_tasks == [("30000000-0000-0000-0000-000000000001", 2)]
    assert celery_control.revocations == [("celery-1", False)]


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


def test_summaries_and_xlsx_keep_same_title_nodes_separate() -> None:
    first_node = NodeInfo(node_id="llm-1", type="llm", title="Answer")
    second_node = NodeInfo(node_id="llm-2", type="llm", title="Answer")
    results = [
        EvaluationItemResult(
            index=1,
            metrics=[
                EvaluationMetric(name="faithfulness", value=0.2, node_info=first_node),
                EvaluationMetric(name="faithfulness", value=0.8, node_info=second_node),
            ],
        ),
        EvaluationItemResult(
            index=2,
            metrics=[
                EvaluationMetric(name="faithfulness", value=0.6, node_info=second_node),
                EvaluationMetric(
                    name="faithfulness", value=0.4, node_info=first_node.model_copy(update={"title": "Renamed"})
                ),
            ],
        ),
    ]

    summary = _compute_metrics_summary(results, None)["metrics"]

    assert set(summary) == {"Answer : faithfulness [llm-1]", "Answer : faithfulness [llm-2]"}
    assert summary["Answer : faithfulness [llm-1]"] == pytest.approx(
        {"count": 2, "average": 0.3, "min": 0.2, "max": 0.4}
    )
    assert summary["Answer : faithfulness [llm-2]"] == pytest.approx(
        {"count": 2, "average": 0.7, "min": 0.6, "max": 0.8}
    )

    inputs = [EvaluationDatasetInput(index=index, inputs={}) for index in (1, 2)]
    workbook = load_workbook(io.BytesIO(_generate_result_xlsx(inputs, results)))
    worksheet = workbook.active
    assert worksheet is not None
    assert [cell.value for cell in worksheet[1]] == [
        "index",
        "actual_output",
        "Answer : faithfulness [llm-1]",
        "Answer : faithfulness [llm-2]",
        "error",
    ]
    assert [cell.value for cell in worksheet[2][2:4]] == [0.2, 0.8]
    assert [cell.value for cell in worksheet[3][2:4]] == [0.4, 0.6]


def test_metric_headers_remain_unique_when_titles_contain_disambiguation_suffixes() -> None:
    nodes = [
        NodeInfo(node_id="llm-1", type="llm", title="Answer"),
        NodeInfo(node_id="llm-2", type="llm", title="Answer"),
        NodeInfo(node_id="llm-3", type="llm", title="Answer : faithfulness [llm-1]"),
    ]
    results = [
        EvaluationItemResult(
            index=1,
            metrics=[
                EvaluationMetric(name="faithfulness", value=0.2, node_info=nodes[0]),
                EvaluationMetric(name="faithfulness", value=0.8, node_info=nodes[1]),
                EvaluationMetric(name="faithfulness", value=0.6, node_info=nodes[2]),
                EvaluationMetric(name="Answer : faithfulness [llm-1]", value=0.9),
                EvaluationMetric(name="Answer : faithfulness", value=0.4),
            ],
        )
    ]

    summary = _compute_metrics_summary(results, None)["metrics"]
    assert len(summary) == 5
    assert all(metric["count"] == 1 for metric in summary.values())
    assert sorted(metric["average"] for metric in summary.values()) == [0.2, 0.4, 0.6, 0.8, 0.9]
    assert summary["Answer : faithfulness [llm-1]"]["average"] == 0.9

    workbook = load_workbook(io.BytesIO(_generate_result_xlsx([EvaluationDatasetInput(index=1, inputs={})], results)))
    worksheet = workbook.active
    assert worksheet is not None
    exported_metrics = {
        header.value: score.value for header, score in zip(worksheet[1][2:-1], worksheet[2][2:-1], strict=True)
    }
    assert exported_metrics == {name: metric["average"] for name, metric in summary.items()}


def test_result_xlsx_preserves_formula_like_text_as_literal_cells() -> None:
    input_list = [EvaluationDatasetInput(index=1, inputs={"=input": "=1+1"}, expected_outputs={"=node": "=2+2"})]
    results = [
        EvaluationItemResult(
            index=1,
            actual_output="=3+3",
            metrics=[
                EvaluationMetric(name="=metric", value="=4+4"),
                EvaluationMetric(name="numeric", value=0.9),
            ],
            error="=5+5",
        )
    ]

    workbook = load_workbook(io.BytesIO(_generate_result_xlsx(input_list, results)))
    worksheet = workbook.active

    assert worksheet is not None
    formula_like_cells = {
        "B1": "=input",
        "B2": "=1+1",
        "C1": "=node : expected_output",
        "C2": "=2+2",
        "D2": "=3+3",
        "E1": "=metric",
        "E2": "=4+4",
        "G2": "=5+5",
    }
    for coordinate, expected_value in formula_like_cells.items():
        cell = worksheet[coordinate]
        assert cell.value == expected_value
        assert cell.data_type == "s"

    assert worksheet["A2"].value == 1
    assert worksheet["A2"].data_type == "n"
    assert worksheet["F2"].value == 0.9
    assert worksheet["F2"].data_type == "n"


def test_result_xlsx_serializes_structured_metric_values() -> None:
    object_value = {"score": 0.8, "samples": [0.2, 0.8]}
    array_value = [0.2, 0.8]
    input_list = [EvaluationDatasetInput(index=1, inputs={})]
    results = [
        EvaluationItemResult(
            index=1,
            metrics=[
                EvaluationMetric(name="object", value=object_value),
                EvaluationMetric(name="array", value=array_value),
                EvaluationMetric(name="numeric", value=0.9),
            ],
        )
    ]

    workbook = load_workbook(io.BytesIO(_generate_result_xlsx(input_list, results)))
    worksheet = workbook.active

    assert worksheet is not None
    assert [cell.value for cell in worksheet[1]] == ["index", "actual_output", "object", "array", "numeric", "error"]
    assert worksheet["C2"].data_type == "s"
    assert isinstance(worksheet["C2"].value, str)
    assert json.loads(worksheet["C2"].value) == object_value
    assert worksheet["D2"].data_type == "s"
    assert isinstance(worksheet["D2"].value, str)
    assert json.loads(worksheet["D2"].value) == array_value
    assert worksheet["E2"].value == 0.9
    assert worksheet["E2"].data_type == "n"
