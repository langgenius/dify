import json
import logging
from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    EvaluationItemInput,
    EvaluationItemResult,
)
from libs.datetime_utils import naive_utc_now
from models.evaluation import EvaluationRun, EvaluationRunItem, EvaluationRunStatus

logger = logging.getLogger(__name__)


class BaseEvaluationRunner(ABC):
    """Abstract base class for evaluation runners.

    Runners are responsible for executing the target (App/Snippet/Retrieval)
    to collect actual outputs, then delegating to the evaluation instance
    for metric computation.
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
        """Compute evaluation metrics on the collected results."""
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
    ) -> list[EvaluationItemResult]:
        """Orchestrate target execution + metric evaluation for all items."""
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
                evaluated_results = self.evaluate_metrics(
                    successful_items, successful_results, metrics_config, model_provider, model_name, tenant_id
                )
                # Merge evaluated metrics back into results
                evaluated_by_index = {r.index: r for r in evaluated_results}
                for i, result in enumerate(results):
                    if result.index in evaluated_by_index:
                        results[i] = evaluated_by_index[result.index]
            except Exception:
                logger.exception("Failed to compute metrics for evaluation run %s", evaluation_run_id)

        # Phase 3: Persist individual items
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
                metadata_json=json.dumps(result.metadata) if result.metadata else None,
                error=result.error,
                overall_score=result.overall_score,
            )
            self.session.add(run_item)

        self.session.commit()

        return results
