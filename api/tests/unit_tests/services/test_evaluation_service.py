"""Focused tests for evaluation service validation and dataset parsing."""

import io
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from openpyxl import load_workbook

from core.evaluation.entities.evaluation_entity import (
    CustomizedMetricOutputField,
    CustomizedMetrics,
    DefaultMetric,
    EvaluationCategory,
    EvaluationConfigData,
    EvaluationDatasetInput,
    EvaluationRunRequest,
    NodeInfo,
)
from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig
from models.evaluation import EvaluationConfiguration, EvaluationRun, EvaluationRunItem, EvaluationRunStatus
from models.model import AppMode
from models.workflow import WorkflowKind, WorkflowType
from services.errors.evaluation import EvaluationDatasetInvalidError
from services.evaluation_service import EvaluationService


@pytest.fixture(autouse=True)
def stub_evaluation_model_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(EvaluationService, "_validate_evaluation_model", MagicMock())


def test_generated_template_uses_workflow_variable_names() -> None:
    content = EvaluationService._generate_xlsx_template(
        [{"variable": "customer_question", "label": "Customer question"}],
        "App",
    )
    worksheet = load_workbook(io.BytesIO(content)).active

    assert worksheet is not None
    assert [cell.value for cell in worksheet[1]] == ["index", "customer_question"]


def test_parse_csv_dataset_preserves_node_specific_references() -> None:
    items = EvaluationService._parse_dataset(
        b"index,query,Judge: final : expected_output\n7,hello,world\n",
        "dataset.csv",
    )

    assert len(items) == 1
    assert items[0].index == 7
    assert items[0].inputs == {"query": "hello"}
    assert items[0].expected_outputs == {"Judge: final": "world"}


def test_parse_csv_dataset_rejects_duplicate_indices() -> None:
    with pytest.raises(EvaluationDatasetInvalidError, match="index '1' is duplicated"):
        EvaluationService._parse_dataset(
            b"index,query\n1,first\n1,second\n",
            "dataset.csv",
        )


def test_dataset_validation_requires_references_for_reference_metrics() -> None:
    items = [EvaluationDatasetInput(index=7, inputs={"query": "hello"})]
    metrics = [DefaultMetric(metric="context_recall", node_info_list=[])]

    with pytest.raises(EvaluationDatasetInvalidError, match="expected_output.*7"):
        EvaluationService._validate_dataset_expected_outputs(items, metrics)


def test_dataset_validation_allows_reference_free_metrics() -> None:
    items = [EvaluationDatasetInput(index=7, inputs={"query": "hello"})]
    metrics = [DefaultMetric(metric="context_relevance", node_info_list=[])]

    EvaluationService._validate_dataset_expected_outputs(items, metrics)


def test_validate_config_rejects_node_type_spoofing(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(id="app-1", mode=AppMode.WORKFLOW.value)
    workflow = SimpleNamespace(walk_nodes=lambda: iter([("node-1", {"type": "llm"})]))
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", MagicMock(return_value=workflow))
    monkeypatch.setattr(
        EvaluationService,
        "get_supported_metrics",
        MagicMock(return_value=["context_precision"]),
    )
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="context_precision",
                node_info_list=[NodeInfo(node_id="node-1", type="knowledge-retrieval", title="Retriever")],
            )
        ],
    )

    with pytest.raises(ValueError, match="type does not match"):
        EvaluationService.validate_evaluation_config(
            session=session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_validate_knowledge_base_config_uses_retrieval_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    supported_metrics = MagicMock(return_value=["context_precision"])
    monkeypatch.setattr(EvaluationService, "get_supported_metrics", supported_metrics)
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="context_precision", node_info_list=[])],
    )

    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(id="dataset-1", provider="vendor")

    EvaluationService.validate_evaluation_config(
        session=session,
        tenant_id="tenant-1",
        target_type="knowledge_base",
        target_id="dataset-1",
        data=config,
    )

    supported_metrics.assert_called_once_with(EvaluationCategory.RETRIEVAL)


def test_validate_knowledge_base_config_rejects_customized_evaluator() -> None:
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        )
    )

    with pytest.raises(ValueError, match="not supported for knowledge bases"):
        EvaluationService.validate_evaluation_config(
            session=MagicMock(),
            tenant_id="tenant-1",
            target_type="knowledge_base",
            target_id="dataset-1",
            data=config,
        )


def test_validate_config_rejects_undeclared_customized_output(monkeypatch: pytest.MonkeyPatch) -> None:
    target = SimpleNamespace(id="app-1", mode=AppMode.WORKFLOW.value)
    evaluator_app = SimpleNamespace(id="evaluator-app")
    session = MagicMock()
    session.scalar.side_effect = [target, evaluator_app]
    target_workflow = SimpleNamespace(walk_nodes=lambda: iter([("node-1", {"type": "llm"})]))
    evaluator_workflow = SimpleNamespace(
        type=WorkflowType.WORKFLOW,
        resolved_kind=WorkflowKind.EVALUATION,
        walk_nodes=lambda: iter([("end", {"type": "end", "outputs": [{"variable": "score", "value_type": "number"}]})]),
    )
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", MagicMock(return_value=target_workflow))
    workflow_service = MagicMock()
    workflow_service.get_published_workflow.return_value = evaluator_workflow
    monkeypatch.setattr("services.evaluation_service.WorkflowService", MagicMock(return_value=workflow_service))
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="missing", value_type="number")],
        )
    )

    with pytest.raises(ValueError, match="not declared.*missing"):
        EvaluationService.validate_evaluation_config(
            session=session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_validate_config_rejects_non_workflow_app(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(id="app-1", mode=AppMode.ADVANCED_CHAT.value)
    monkeypatch.setattr(
        EvaluationService,
        "get_supported_metrics",
        MagicMock(return_value=["faithfulness"]),
    )
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="faithfulness",
                node_info_list=[NodeInfo(node_id="node-1", type="llm", title="LLM")],
            )
        ],
    )

    with pytest.raises(ValueError, match="Only workflow apps"):
        EvaluationService.validate_evaluation_config(
            session=session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_pin_target_workflow_returns_published_snapshot_id(monkeypatch: pytest.MonkeyPatch) -> None:
    target = SimpleNamespace(id="app-1", mode=AppMode.WORKFLOW.value)
    session = MagicMock()
    session.scalar.return_value = target
    workflow = SimpleNamespace(id="workflow-version-7")
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", MagicMock(return_value=workflow))

    version_id, resolved_workflow = EvaluationService._pin_target_workflow(
        session=session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
    )

    assert version_id == "workflow-version-7"
    assert resolved_workflow is workflow


def test_extract_llm_context_node_mapping_uses_published_graph_selectors() -> None:
    workflow = SimpleNamespace(
        walk_nodes=lambda: iter(
            [
                ("retrieval-1", {"type": "knowledge-retrieval"}),
                (
                    "llm-1",
                    {
                        "type": "llm",
                        "context": {"enabled": True, "variable_selector": ["retrieval-1", "result"]},
                    },
                ),
            ]
        )
    )

    assert EvaluationService._extract_llm_context_node_mapping(workflow) == {"llm-1": ["retrieval-1"]}


def test_validate_knowledge_base_config_rejects_external_provider() -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(id="dataset-1", provider="external")
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="context_relevance", node_info_list=[])],
    )

    with pytest.raises(ValueError, match="External knowledge bases"):
        EvaluationService.validate_evaluation_config(
            session=session,
            tenant_id="tenant-1",
            target_type="knowledge_base",
            target_id="dataset-1",
            data=config,
        )


def test_validate_knowledge_base_judgment_uses_dataset_metric_selector(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(id="dataset-1", provider="vendor")
    monkeypatch.setattr(EvaluationService, "get_supported_metrics", MagicMock(return_value=["context_relevance"]))
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[DefaultMetric(metric="context_relevance", node_info_list=[])],
        judgment_config=JudgmentConfig(
            conditions=[
                JudgmentCondition(
                    variable_selector=["dataset-1", "context_relevance"],
                    comparison_operator=">",
                    value="0.5",
                )
            ]
        ),
    )

    EvaluationService.validate_evaluation_config(
        session=session,
        tenant_id="tenant-1",
        target_type="knowledge_base",
        target_id="dataset-1",
        data=config,
    )


def test_validate_config_rejects_missing_required_customized_input(monkeypatch: pytest.MonkeyPatch) -> None:
    target = SimpleNamespace(id="app-1", mode=AppMode.WORKFLOW.value)
    evaluator_app = SimpleNamespace(id="evaluator-app")
    session = MagicMock()
    session.scalar.side_effect = [target, evaluator_app]
    target_workflow = SimpleNamespace(walk_nodes=lambda: iter([("node-1", {"type": "llm"})]))
    evaluator_workflow = SimpleNamespace(
        type=WorkflowType.WORKFLOW,
        resolved_kind=WorkflowKind.EVALUATION,
        user_input_form=lambda: [{"variable": "answer", "required": True}],
        walk_nodes=lambda: iter([("end", {"type": "end", "outputs": [{"variable": "score"}]})]),
    )
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", MagicMock(return_value=target_workflow))
    workflow_service = MagicMock()
    workflow_service.get_published_workflow.return_value = evaluator_workflow
    monkeypatch.setattr("services.evaluation_service.WorkflowService", MagicMock(return_value=workflow_service))
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        )
    )

    with pytest.raises(ValueError, match="required inputs.*answer"):
        EvaluationService.validate_evaluation_config(
            session=session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_validate_config_rejects_unknown_customized_selector_node(monkeypatch: pytest.MonkeyPatch) -> None:
    target = SimpleNamespace(id="app-1", mode=AppMode.WORKFLOW.value)
    evaluator_app = SimpleNamespace(id="evaluator-app")
    session = MagicMock()
    session.scalar.side_effect = [target, evaluator_app]
    target_workflow = SimpleNamespace(walk_nodes=lambda: iter([("node-1", {"type": "llm"})]))
    evaluator_workflow = SimpleNamespace(
        type=WorkflowType.WORKFLOW,
        resolved_kind=WorkflowKind.EVALUATION,
        user_input_form=lambda: [{"variable": "answer", "required": True}],
        walk_nodes=lambda: iter([("end", {"type": "end", "outputs": [{"variable": "score"}]})]),
    )
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", MagicMock(return_value=target_workflow))
    workflow_service = MagicMock()
    workflow_service.get_published_workflow.return_value = evaluator_workflow
    monkeypatch.setattr("services.evaluation_service.WorkflowService", MagicMock(return_value=workflow_service))
    config = EvaluationConfigData(
        customized_metrics=CustomizedMetrics(
            evaluation_workflow_id="evaluator-app",
            input_fields={"answer": "{{#missing_node.text#}}"},
            output_fields=[CustomizedMetricOutputField(variable="score", value_type="number")],
        )
    )

    with pytest.raises(ValueError, match="missing_node.*published target workflow"):
        EvaluationService.validate_evaluation_config(
            session=session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_validate_config_rejects_unknown_judgment_selector(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(id="app-1", mode=AppMode.WORKFLOW.value)
    workflow = SimpleNamespace(walk_nodes=lambda: iter([("node-1", {"type": "llm"})]))
    monkeypatch.setattr(EvaluationService, "_resolve_published_workflow", MagicMock(return_value=workflow))
    monkeypatch.setattr(EvaluationService, "get_supported_metrics", MagicMock(return_value=["faithfulness"]))
    config = EvaluationConfigData(
        evaluation_model_provider="provider",
        evaluation_model="model",
        default_metrics=[
            DefaultMetric(
                metric="faithfulness",
                node_info_list=[NodeInfo(node_id="node-1", type="llm", title="LLM")],
            )
        ],
        judgment_config=JudgmentConfig(
            conditions=[
                JudgmentCondition(
                    variable_selector=["node-1", "answer_correctness"],
                    comparison_operator=">",
                    value="0.8",
                )
            ]
        ),
    )

    with pytest.raises(ValueError, match="Judgment selector"):
        EvaluationService.validate_evaluation_config(
            session=session,
            tenant_id="tenant-1",
            target_type="apps",
            target_id="app-1",
            data=config,
        )


def test_cancel_run_stops_each_possible_workflow_task(monkeypatch: pytest.MonkeyPatch) -> None:
    run = SimpleNamespace(
        id="run-1",
        status="running",
        total_items=2,
        celery_task_id="celery-1",
        completed_at=None,
        progress_rate=0.4,
    )
    session = MagicMock()
    monkeypatch.setattr(EvaluationService, "get_evaluation_run_detail", MagicMock(return_value=run))
    stop_workflow_tasks = MagicMock()
    monkeypatch.setattr(EvaluationService, "_stop_workflow_tasks", stop_workflow_tasks)
    celery_control = MagicMock()
    monkeypatch.setattr("celery.current_app.control", celery_control)

    EvaluationService.cancel_evaluation_run(
        session=session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        run_id="run-1",
    )

    stop_workflow_tasks.assert_called_once_with("run-1", 2)
    celery_control.revoke.assert_called_once_with("celery-1", terminate=False)


def test_stop_workflow_tasks_sends_graph_commands_when_queue_stop_flags_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stop_flag = MagicMock(side_effect=RuntimeError("redis flag failed"))
    graph_manager = MagicMock()
    monkeypatch.setattr(
        "core.app.apps.base_app_queue_manager.AppQueueManager.set_stop_flag_no_user_check",
        stop_flag,
    )
    monkeypatch.setattr("graphon.graph_engine.manager.GraphEngineManager", MagicMock(return_value=graph_manager))

    EvaluationService._stop_workflow_tasks("run-1", 1)

    assert stop_flag.call_count == 2
    assert graph_manager.send_stop_command.call_count == 2


def test_stage_target_cleanup_removes_target_rows_and_preserves_evaluator_defaults(sqlite_session) -> None:
    target_config = EvaluationConfiguration(
        id="10000000-0000-0000-0000-000000000001",
        tenant_id="10000000-0000-0000-0000-000000000010",
        target_type="apps",
        target_id="10000000-0000-0000-0000-000000000100",
        metrics_config=json.dumps({"default_metrics": [], "customized_metrics": None}),
        created_by="10000000-0000-0000-0000-000000001000",
        updated_by="10000000-0000-0000-0000-000000001000",
    )
    referencing_config = EvaluationConfiguration(
        id="20000000-0000-0000-0000-000000000001",
        tenant_id=target_config.tenant_id,
        target_type="apps",
        target_id="20000000-0000-0000-0000-000000000100",
        metrics_config=json.dumps(
            {
                "default_metrics": [{"metric": "faithfulness", "node_info_list": []}],
                "customized_metrics": {"evaluation_workflow_id": target_config.target_id},
            }
        ),
        evaluator_app_id=target_config.target_id,
        created_by=target_config.created_by,
        updated_by=target_config.updated_by,
    )
    run = EvaluationRun(
        id="10000000-0000-0000-0000-000000000002",
        tenant_id=target_config.tenant_id,
        target_type="apps",
        target_id=target_config.target_id,
        target_workflow_version_id="10000000-0000-0000-0000-000000000003",
        evaluation_config_id=target_config.id,
        config_snapshot="{}",
        status=EvaluationRunStatus.COMPLETED,
        total_items=1,
        progress_rate=1.0,
        created_by=target_config.created_by,
    )
    item = EvaluationRunItem(
        id="10000000-0000-0000-0000-000000000004",
        evaluation_run_id=run.id,
        item_index=1,
    )
    sqlite_session.add_all([target_config, referencing_config, run, item])
    sqlite_session.commit()

    EvaluationService.stage_target_evaluation_cleanup(
        session=sqlite_session,
        tenant_id=target_config.tenant_id,
        target_type="apps",
        target_id=target_config.target_id,
    )
    sqlite_session.flush()

    assert sqlite_session.get(EvaluationConfiguration, target_config.id) is None
    assert sqlite_session.get(EvaluationRun, run.id) is None
    assert sqlite_session.get(EvaluationRunItem, item.id) is None
    preserved = sqlite_session.get(EvaluationConfiguration, referencing_config.id)
    assert preserved is not None
    assert preserved.evaluator_app_id is None
    assert preserved.metrics_config_dict["customized_metrics"] is None


def test_stage_target_cleanup_does_not_stop_tasks_after_rollback(
    sqlite_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = EvaluationConfiguration(
        id="30000000-0000-0000-0000-000000000001",
        tenant_id="30000000-0000-0000-0000-000000000010",
        target_type="snippets",
        target_id="30000000-0000-0000-0000-000000000100",
        metrics_config=json.dumps({"default_metrics": [], "customized_metrics": None}),
        created_by="30000000-0000-0000-0000-000000001000",
        updated_by="30000000-0000-0000-0000-000000001000",
    )
    run = EvaluationRun(
        id="30000000-0000-0000-0000-000000000002",
        tenant_id=config.tenant_id,
        target_type="snippets",
        target_id=config.target_id,
        target_workflow_version_id="30000000-0000-0000-0000-000000000003",
        evaluation_config_id=config.id,
        config_snapshot="{}",
        status=EvaluationRunStatus.RUNNING,
        total_items=1,
        progress_rate=0.2,
        created_by=config.created_by,
        celery_task_id="celery-task-1",
    )
    sqlite_session.add_all([config, run])
    sqlite_session.commit()
    stop_workflow_tasks = MagicMock()
    monkeypatch.setattr(EvaluationService, "_stop_workflow_tasks", stop_workflow_tasks)

    EvaluationService.stage_target_evaluation_cleanup(
        session=sqlite_session,
        tenant_id=config.tenant_id,
        target_type="snippets",
        target_id=config.target_id,
    )
    sqlite_session.rollback()
    assert sqlite_session.get(EvaluationRun, run.id) is not None

    sqlite_session.commit()

    stop_workflow_tasks.assert_not_called()


def test_start_run_persists_and_dispatches_target_workflow_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.scalar.return_value = "tenant-1"
    session.query.return_value.filter_by.return_value.filter.return_value.count.return_value = 0

    def assign_run_id(model: object) -> None:
        if isinstance(model, EvaluationRun):
            model.id = "run-1"

    session.add.side_effect = assign_run_id
    monkeypatch.setattr(
        "services.evaluation_service.EvaluationManager.get_evaluation_instance",
        MagicMock(return_value=object()),
    )
    monkeypatch.setattr(
        EvaluationService,
        "save_evaluation_config",
        MagicMock(return_value=SimpleNamespace(id="config-1")),
    )
    monkeypatch.setattr(
        EvaluationService,
        "_pin_target_workflow",
        MagicMock(
            return_value=(
                "workflow-version-7",
                SimpleNamespace(walk_nodes=lambda: iter([])),
            )
        ),
    )
    apply_async = MagicMock()
    monkeypatch.setattr("tasks.evaluation_task.run_evaluation.apply_async", apply_async)

    run = EvaluationService.start_evaluation_run(
        session=session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        account_id="account-1",
        dataset_file_content=b"index,query\n1,hello\n",
        dataset_filename="dataset.csv",
        run_request=EvaluationRunRequest(file_id="file-1", evaluation_model="model"),
    )

    assert run.target_workflow_version_id == "workflow-version-7"
    dispatch_kwargs = apply_async.call_args.kwargs
    assert set(dispatch_kwargs) == {"args", "task_id"}
    dispatched_payload = dispatch_kwargs["args"][0]
    assert dispatched_payload["target_workflow_version_id"] == "workflow-version-7"


def test_run_single_app_target_loads_pinned_workflow_version(monkeypatch: pytest.MonkeyPatch) -> None:
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW.value)
    workflow = SimpleNamespace(id="workflow-version-7")
    session = MagicMock()
    session.scalar.return_value = app
    workflow_service = MagicMock()
    workflow_service.get_published_workflow_by_id.return_value = workflow
    monkeypatch.setattr("services.evaluation_service.WorkflowService", MagicMock(return_value=workflow_service))
    monkeypatch.setattr(
        "core.evaluation.runners.get_service_account_for_app",
        MagicMock(return_value=SimpleNamespace(id="account-1")),
    )
    generator = MagicMock()
    generator.generate.return_value = {"workflow_run_id": "workflow-run-1"}
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator", MagicMock(return_value=generator))

    result = EvaluationService._run_single_target(
        session=session,
        tenant_id="tenant-1",
        target_type="apps",
        target_id="app-1",
        target_workflow_version_id="workflow-version-7",
        item=EvaluationDatasetInput(index=1, inputs={"query": "hello"}),
        task_id="evaluation:run-1:target:0",
    )

    assert result["workflow_run_id"] == "workflow-run-1"
    workflow_service.get_published_workflow_by_id.assert_called_once_with(
        app_model=app,
        workflow_id="workflow-version-7",
        session=session,
    )
    assert generator.generate.call_args.kwargs["workflow"] is workflow
    assert generator.generate.call_args.kwargs["task_id"] == "evaluation:run-1:target:0"
