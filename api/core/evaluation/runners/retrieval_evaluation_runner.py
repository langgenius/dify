import logging
from typing import Any

from sqlalchemy.orm import Session

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    CustomizedMetrics,
    DefaultMetric,
    EvaluationItemInput,
    EvaluationItemResult,
)
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from core.workflow.node_events import NodeRunResult

logger = logging.getLogger(__name__)


class RetrievalEvaluationRunner(BaseEvaluationRunner):
    """Runner for retrieval evaluation: performs knowledge base retrieval, then evaluates."""

    def __init__(self, evaluation_instance: BaseEvaluationInstance, session: Session):
        super().__init__(evaluation_instance, session)

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
        """Compute retrieval evaluation metrics."""
        if not node_run_result_list:
            return []
        if not default_metric:
            raise ValueError("Default metric is required for retrieval evaluation")

        merged_items = []
        for i, node_result in enumerate(node_run_result_list):
            # Extract retrieved contexts from outputs
            outputs = node_result.outputs
            query = self._extract_query(dict(node_result.inputs))
            # Extract retrieved content from result list
            result_list = outputs.get("result", [])
            contexts = [item.get("content", "") for item in result_list if item.get("content")]
            output = "\n---\n".join(contexts)

            merged_items.append(
                EvaluationItemInput(
                    index=i,
                    inputs={"query": query},
                    output=output,
                    context=contexts,
                )
            )

        return self.evaluation_instance.evaluate_retrieval(
            merged_items, default_metric.metric, model_provider, model_name, tenant_id
        )

    @staticmethod
    def _extract_query(inputs: dict[str, Any]) -> str:
        for key in ("query", "question", "input", "text"):
            if key in inputs:
                return str(inputs[key])
        values = list(inputs.values())
        return str(values[0]) if values else ""
