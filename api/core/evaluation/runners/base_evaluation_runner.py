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
from typing import Any

from sqlalchemy.orm import Session

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    EvaluationItemInput,
    EvaluationItemResult,
)
from core.evaluation.entities.judgment_entity import JudgmentConfig
from core.evaluation.judgment.processor import JudgmentProcessor
from libs.datetime_utils import naive_utc_now
from models.evaluation import EvaluationRun, EvaluationRunItem, EvaluationRunStatus

logger = logging.getLogger(__name__)


class BaseEvaluationRunner(ABC):
    """Abstract base class for evaluation runners.

    Runners are responsible for executing the target (App/Snippet/Retrieval)
    to collect actual outputs, then computing evaluation metrics, optionally
    applying judgment conditions, and persisting results.

    Built-in capabilities (implemented in this base class):
      - Customized workflow dispatch (``_evaluate_customized``)
      - Judgment condition evaluation (``_apply_judgment``)

    Subclass responsibilities:
      - ``execute_target``  — target-specific execution logic
      - ``evaluate_metrics`` — framework-specific metric computation (RAGAS etc.)
    """

    def __init__(self, evaluation_instance: BaseEvaluationInstance, session: Session):
        self.evaluation_instance = evaluation_instance
        self.session = session

    @abstractmethod
    def execute_target(
        self,
        tenant_id: str,
        target_id: str,
        target_type: str,
        item: EvaluationItemInput,
    ) -> EvaluationItemResult:
        """Execute the evaluation target for a single item and return the result with actual_output populated."""
        ...

    @abstractmethod
    def evaluate_metrics(
        self,
        items: list[EvaluationItemInput],
        results: list[EvaluationItemResult],
        metrics_config: dict,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Compute evaluation metrics on the collected results.

        Called only when the evaluation is NOT using a customized workflow
        (i.e. ``metrics_config`` does not contain ``workflow_id``).

        Implementations should:
          1. Merge ``actual_output`` from ``results`` into the ``context``
             field of each ``EvaluationItemInput``.
          2. Call ``self.evaluation_instance.evaluate_xxx()`` with the
             merged items.
          3. Return updated results with metrics populated.
        """
        ...

    def run(
        self,
        evaluation_run_id: str,
        tenant_id: str,
        target_id: str,
        target_type: str,
        items: list[EvaluationItemInput],
        metrics_config: dict,
        model_provider: str,
        model_name: str,
        judgment_config: JudgmentConfig | None = None,
    ) -> list[EvaluationItemResult]:
        """Orchestrate target execution + metric evaluation + judgment for all items."""
        evaluation_run = self.session.query(EvaluationRun).filter_by(id=evaluation_run_id).first()
        if not evaluation_run:
            raise ValueError(f"EvaluationRun {evaluation_run_id} not found")

        # Update status to running
        evaluation_run.status = EvaluationRunStatus.RUNNING
        evaluation_run.started_at = naive_utc_now()
        self.session.commit()

        results: list[EvaluationItemResult] = []

        # Phase 1: Execute target for each item
        for item in items:
            try:
                result = self.execute_target(tenant_id, target_id, target_type, item)
                results.append(result)
                evaluation_run.completed_items += 1
            except Exception as e:
                logger.exception("Failed to execute target for item %d", item.index)
                results.append(
                    EvaluationItemResult(
                        index=item.index,
                        error=str(e),
                    )
                )
                evaluation_run.failed_items += 1
            self.session.commit()

        # Phase 2: Compute metrics on successful results
        successful_items = [item for item, result in zip(items, results) if result.error is None]
        successful_results = [r for r in results if r.error is None]

        if successful_items and successful_results:
            try:
                if _is_customized_evaluation(metrics_config):
                    # Customized workflow evaluation — target-type agnostic,
                    # handled via BaseEvaluationInstance.evaluate_with_customized_workflow().
                    evaluated_results = self._evaluate_customized(
                        successful_items, successful_results, metrics_config, tenant_id,
                    )
                else:
                    # Framework-specific evaluation — delegate to subclass
                    evaluated_results = self.evaluate_metrics(
                        successful_items, successful_results, metrics_config,
                        model_provider, model_name, tenant_id,
                    )
                # Merge evaluated metrics back into results
                evaluated_by_index = {r.index: r for r in evaluated_results}
                for i, result in enumerate(results):
                    if result.index in evaluated_by_index:
                        results[i] = evaluated_by_index[result.index]
            except Exception:
                logger.exception("Failed to compute metrics for evaluation run %s", evaluation_run_id)

        # Phase 3: Apply judgment conditions on metrics
        if judgment_config and judgment_config.conditions:
            results = self._apply_judgment(results, items, judgment_config)

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

    # ------------------------------------------------------------------
    # Customized workflow evaluation dispatch
    # ------------------------------------------------------------------

    def _evaluate_customized(
        self,
        items: list[EvaluationItemInput],
        results: list[EvaluationItemResult],
        metrics_config: dict,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Delegate to the instance's customized workflow evaluator.

        Unlike the framework path (which merges ``actual_output`` into
        ``context``), here we pass ``results`` directly — the instance's
        ``evaluate_with_customized_workflow()`` reads ``actual_output``
        from each ``EvaluationItemResult``.
        """
        evaluated = self.evaluation_instance.evaluate_with_customized_workflow(
            items, results, metrics_config, tenant_id,
        )

        # Merge metrics back preserving actual_output and metadata from Phase 1
        eval_by_index = {r.index: r for r in evaluated}
        final_results: list[EvaluationItemResult] = []
        for result in results:
            if result.index in eval_by_index:
                eval_result = eval_by_index[result.index]
                final_results.append(
                    EvaluationItemResult(
                        index=result.index,
                        actual_output=result.actual_output,
                        metrics=eval_result.metrics,
                        metadata={**result.metadata, **eval_result.metadata},
                        error=eval_result.error,
                    )
                )
            else:
                final_results.append(result)
        return final_results

    # ------------------------------------------------------------------
    # Judgment (target-type agnostic)
    # ------------------------------------------------------------------

    @staticmethod
    def _apply_judgment(
        results: list[EvaluationItemResult],
        items: list[EvaluationItemInput],
        judgment_config: JudgmentConfig,
    ) -> list[EvaluationItemResult]:
        """Apply judgment conditions to each result's metrics.

        Builds a metric_name → value mapping from each result's metrics,
        and a variable_values dict from the evaluation target's runtime data
        (inputs, actual_output, expected_output) for variable-type conditions.
        Results with errors are skipped.
        """
        items_by_index = {item.index: item for item in items}
        judged_results: list[EvaluationItemResult] = []

        for result in results:
            if result.error is not None or not result.metrics:
                judged_results.append(result)
                continue

            metric_values: dict[str, object] = {m.name: m.score for m in result.metrics}

            # Build variable pool from the evaluation target's runtime data.
            # These variables can be referenced in conditions with value_source="variable".
            item_input = items_by_index.get(result.index)
            variable_values: dict[str, object] = {}
            if item_input:
                variable_values.update(item_input.inputs)
                if item_input.expected_output is not None:
                    variable_values["expected_output"] = item_input.expected_output
                if item_input.context:
                    variable_values["context"] = "; ".join(item_input.context)
            if result.actual_output is not None:
                variable_values["actual_output"] = result.actual_output

            judgment_result = JudgmentProcessor.evaluate(
                metric_values, judgment_config, variable_values=variable_values
            )

            judged_results.append(
                result.model_copy(update={"judgment": judgment_result})
            )
        return judged_results


def _is_customized_evaluation(metrics_config: dict[str, Any]) -> bool:
    """Check if metrics_config indicates a customized workflow evaluation.

    The convention is that ``metrics_config["workflow_id"]`` is present
    when a user-defined workflow should be used for evaluation.
    """
    return bool(metrics_config.get("workflow_id"))
