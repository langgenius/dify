"""Tests for judgment application in the base evaluation runner."""

from unittest.mock import Mock

from core.evaluation.entities.evaluation_entity import DefaultMetric, EvaluationItemResult, EvaluationMetric
from core.evaluation.entities.judgment_entity import JudgmentCondition, JudgmentConfig
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner


class _FakeItemInput:
    def __init__(self, index: int) -> None:
        self.index = index
        self.inputs = {"query": "hello"}
        self.expected_output = "world"
        self.context = None


class _FakeEvaluationRun:
    def __init__(self) -> None:
        self.status = None
        self.started_at = None
        self.input_list = [_FakeItemInput(index=0)]


class _FakeRunner(BaseEvaluationRunner):
    def evaluate_metrics(
        self,
        node_run_result_mapping_list,
        node_run_result_list,
        default_metric,
        customized_metrics,
        model_provider,
        model_name,
        tenant_id,
    ) -> list[EvaluationItemResult]:
        return [
            EvaluationItemResult(
                index=0,
                actual_output="result",
                metrics=[EvaluationMetric(name="faithfulness", value=0.91)],
            )
        ]


def test_run_applies_judgment_before_persisting_results() -> None:
    """Runner should evaluate judgment rules before persisting item rows."""
    # Arrange
    session = Mock()
    evaluation_run = _FakeEvaluationRun()
    session.query.return_value.filter_by.return_value.first.return_value = evaluation_run

    runner = _FakeRunner(evaluation_instance=Mock(), session=session)
    judgment_config = JudgmentConfig(
        logical_operator="and",
        conditions=[
            JudgmentCondition(
                metric_name="faithfulness",
                comparison_operator=">",
                condition_value="0.8",
                condition_type="number",
            )
        ],
    )

    # Act
    results = runner.run(
        evaluation_run_id="run-id",
        tenant_id="tenant-id",
        target_id="target-id",
        target_type="app",
        node_run_result_list=[Mock()],
        default_metric=DefaultMetric(metric="faithfulness", node_info_list=[]),
        judgment_config=judgment_config,
    )

    # Assert
    assert results[0].judgment.passed is True
    persisted_item = session.add.call_args.args[0]
    assert persisted_item.judgment is not None
    assert '"passed": true' in persisted_item.judgment
