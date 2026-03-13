"""Base evaluation runner.

Orchestrates the evaluation lifecycle in four phases:
  1. execute_target   — run the target and collect actual outputs  (abstract)
  2. evaluate_metrics  — compute metrics via framework or customized workflow
  3. apply_judgment    — evaluate pass/fail judgment conditions on metrics
  4. persist           — save results to the database

"""

import json
import logging
from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    CustomizedMetrics,
    DefaultMetric,
    EvaluationItemResult,
)
from core.evaluation.entities.judgment_entity import JudgmentConfig
from core.evaluation.judgment.processor import JudgmentProcessor
from core.workflow.node_events import NodeRunResult
from libs.datetime_utils import naive_utc_now
from models.evaluation import EvaluationRun, EvaluationRunItem, EvaluationRunStatus

logger = logging.getLogger(__name__)


class BaseEvaluationRunner(ABC):
    """Abstract base class for evaluation runners. """

    def __init__(self, evaluation_instance: BaseEvaluationInstance, session: Session):
        self.evaluation_instance = evaluation_instance
        self.session = session

    @abstractmethod
    def evaluate_metrics(
        self,
        node_run_result_mapping_list: list[dict[str, NodeRunResult]] | None,
        node_run_result_list: list[NodeRunResult] | None,
        default_metric: DefaultMetric | None,
        customized_metrics: CustomizedMetrics | None,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Compute evaluation metrics on the collected results."""
        ...

    def run(
        self,
        evaluation_run_id: str,
        tenant_id: str,
        target_id: str,
        target_type: str,
        node_run_result_list: list[NodeRunResult] | None = None,
        default_metric: DefaultMetric | None = None,
        customized_metrics: CustomizedMetrics | None = None,
        model_provider: str = "",
        model_name: str = "",
        node_run_result_mapping_list: list[dict[str, NodeRunResult]] | None = None,
    ) -> list[EvaluationItemResult]:
        """Orchestrate target execution + metric evaluation + judgment for all items."""
        evaluation_run = self.session.query(EvaluationRun).filter_by(id=evaluation_run_id).first()
        if not evaluation_run:
            raise ValueError(f"EvaluationRun {evaluation_run_id} not found")

        if not default_metric and not customized_metrics:
            raise ValueError("Either default_metric or customized_metrics must be provided")

        # Update status to running
        evaluation_run.status = EvaluationRunStatus.RUNNING
        evaluation_run.started_at = naive_utc_now()
        self.session.commit()

        results_by_index: dict[int, EvaluationItemResult] = {}

        # Phase 1: run evaluation
        if default_metric and node_run_result_list:
            try:
                evaluated_results = self.evaluate_metrics(
                    node_run_result_mapping_list=node_run_result_mapping_list,
                    node_run_result_list=node_run_result_list,
                    default_metric=default_metric,
                    customized_metrics=customized_metrics,
                    model_provider=model_provider,
                    model_name=model_name,
                    tenant_id=tenant_id,
                )
                for r in evaluated_results:
                    results_by_index[r.index] = r
            except Exception:
                logger.exception("Failed to compute metrics for evaluation run %s", evaluation_run_id)
        if customized_metrics and node_run_result_mapping_list:
            try:
                customized_results = self.evaluation_instance.evaluate_with_customized_workflow(
                    node_run_result_mapping_list=node_run_result_mapping_list,
                    customized_metrics=customized_metrics,
                    tenant_id=tenant_id,
                )
                for r in customized_results:
                    existing = results_by_index.get(r.index)
                    if existing:
                        # Merge: combine metrics from both sources into one result
                        results_by_index[r.index] = existing.model_copy(
                            update={"metrics": existing.metrics + r.metrics}
                        )
                    else:
                        results_by_index[r.index] = r
            except Exception:
                logger.exception("Failed to compute customized metrics for evaluation run %s", evaluation_run_id)

        results = list(results_by_index.values())

        # Phase 4: Persist individual items
        for result in results:
            item_input = next((item for item in items if item.index == result.index), None)
            run_item = EvaluationRunItem(
                evaluation_run_id=evaluation_run_id,
                item_index=result.index,
                inputs=json.dumps(item_input.inputs) if item_input else None,
                expected_output=item_input.expected_output if item_input else None,
                context=json.dumps(item_input.context) if item_input and item_input.context else None,
                actual_output=result.actual_output,
                metrics=json.dumps([m.model_dump() for m in result.metrics]) if result.metrics else None,
                judgment=json.dumps(result.judgment.model_dump()) if result.judgment else None,
                metadata_json=json.dumps(result.metadata) if result.metadata else None,
                error=result.error,
                overall_score=result.overall_score,
            )
            self.session.add(run_item)

        self.session.commit()

        return results

    @staticmethod
    def _apply_judgment(
        results: list[EvaluationItemResult],
        judgment_config: JudgmentConfig,
        node_run_result_mapping_list: list[dict[str, NodeRunResult]] | None = None,
    ) -> list[EvaluationItemResult]:
        """Apply judgment conditions to each result's metrics.

        Left side (``metric_name``): looked up from evaluate-phase metrics only.
        Right side: when ``value_source="variable"``, ``condition.value``
        contains an expression (e.g. ``{{#node_id.output_key#}}``).  The
        expression is parsed and resolved against the corresponding
        ``node_run_result_mapping`` to obtain the actual comparison value.
        """
        from core.evaluation.base_evaluation_instance import resolve_variable_selector
        from core.evaluation.entities.judgment_entity import JudgmentValueSource
        from core.workflow.nodes.base.variable_template_parser import REGEX as VARIABLE_REGEX

        judged_results: list[EvaluationItemResult] = []

        for idx, result in enumerate(results):
            if result.error is not None or not result.metrics:
                judged_results.append(result)
                continue

            # Left side: only metrics
            metric_values: dict[str, object] = {m.name: m.value for m in result.metrics}

            # Right side: pre-resolve variable expressions against node run results.
            # Each condition.value expression (e.g. "{{#llm1.text#}}") is resolved
            # and stored in variable_values keyed by the raw expression string, so
            # that JudgmentProcessor._resolve_comparison_value can look it up.
            variable_values: dict[str, object] = {}
            node_run_result_mapping = (
                node_run_result_mapping_list[idx]
                if node_run_result_mapping_list and idx < len(node_run_result_mapping_list)
                else {}
            )
            for condition in judgment_config.conditions:
                if (
                    condition.value_source == JudgmentValueSource.VARIABLE
                    and isinstance(condition.value, str)
                    and node_run_result_mapping
                ):
                    match = VARIABLE_REGEX.fullmatch(condition.value)
                    if match:
                        resolved = resolve_variable_selector(
                            match.group(1), node_run_result_mapping
                        )
                        variable_values[condition.value] = resolved

            judgment_result = JudgmentProcessor.evaluate(
                metric_values, judgment_config, variable_values=variable_values
            )

            judged_results.append(
                result.model_copy(update={"judgment": judgment_result})
            )
        return judged_results
