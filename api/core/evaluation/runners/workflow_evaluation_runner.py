import logging
from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    EvaluationItemInput,
    EvaluationItemResult,
)
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from models.model import App

logger = logging.getLogger(__name__)


class WorkflowEvaluationRunner(BaseEvaluationRunner):
    """Runner for workflow evaluation: executes workflow App in non-streaming mode."""

    def __init__(self, evaluation_instance: BaseEvaluationInstance, session: Session):
        super().__init__(evaluation_instance, session)

    def evaluate_metrics(
        self,
        items: list[EvaluationItemInput],
        results: list[EvaluationItemResult],
        default_metrics: list[dict[str, Any]],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Compute workflow evaluation metrics (end-to-end)."""
        result_by_index = {r.index: r for r in results}
        merged_items = []
        for item in items:
            result = result_by_index.get(item.index)
            context = []
            if result and result.actual_output:
                context.append(result.actual_output)
            merged_items.append(
                EvaluationItemInput(
                    index=item.index,
                    inputs=item.inputs,
                    expected_output=item.expected_output,
                    context=context + (item.context or []),
                )
            )

        evaluated = self.evaluation_instance.evaluate_workflow(
            merged_items, default_metrics, model_provider, model_name, tenant_id
        )

        # Merge metrics back preserving metadata
        eval_by_index = {r.index: r for r in evaluated}
        final_results = []
        for result in results:
            if result.index in eval_by_index:
                eval_result = eval_by_index[result.index]
                final_results.append(
                    EvaluationItemResult(
                        index=result.index,
                        actual_output=result.actual_output,
                        metrics=eval_result.metrics,
                        metadata=result.metadata,
                        error=result.error,
                    )
                )
            else:
                final_results.append(result)
        return final_results

    @staticmethod
    def _extract_output(response: Mapping[str, Any]) -> str:
        """Extract text output from workflow response."""
        if "data" in response and isinstance(response["data"], Mapping):
            outputs = response["data"].get("outputs", {})
            if isinstance(outputs, Mapping):
                values = list(outputs.values())
                return str(values[0]) if values else ""
            return str(outputs)
        return str(response)

    @staticmethod
    def _extract_node_executions(response: Mapping[str, Any]) -> list[dict]:
        """Extract node execution trace from workflow response."""
        data = response.get("data", {})
        if isinstance(data, Mapping):
            return data.get("node_executions", [])
        return []
