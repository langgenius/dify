"""Focused tests for evaluation service validation and dataset parsing."""

import io
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
    NodeInfo,
)
from models.workflow import WorkflowKind, WorkflowType
from services.errors.evaluation import EvaluationDatasetInvalidError
from services.evaluation_service import EvaluationService


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
    session.scalar.return_value = SimpleNamespace(id="app-1")
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

    EvaluationService.validate_evaluation_config(
        session=MagicMock(),
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
    target = SimpleNamespace(id="app-1")
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
