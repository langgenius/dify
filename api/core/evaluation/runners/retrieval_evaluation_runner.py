import logging
from typing import Any

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    DefaultMetric,
    EvaluationDatasetInput,
    EvaluationItemInput,
    EvaluationItemResult,
    NodeInfo,
)
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from graphon.node_events import NodeRunResult

logger = logging.getLogger(__name__)


class RetrievalEvaluationRunner(BaseEvaluationRunner):
    """Runner for retrieval evaluation: performs knowledge base retrieval, then evaluates."""

    def __init__(self, evaluation_instance: BaseEvaluationInstance):
        super().__init__(evaluation_instance)

    def evaluate_metrics(
        self,
        node_run_result_list: list[NodeRunResult],
        default_metric: DefaultMetric,
        model_provider: str,
        model_name: str,
        tenant_id: str,
        dataset_items: list[EvaluationDatasetInput] | None = None,
        node_info: NodeInfo | None = None,
    ) -> list[EvaluationItemResult]:
        """Compute retrieval evaluation metrics."""
        if not node_run_result_list:
            return []

        merged_items = []
        for i, node_result in enumerate(node_run_result_list):
            outputs = node_result.outputs
            query = self._extract_query(dict(node_result.inputs))
            result_list = outputs.get("result", [])
            contexts = [item.get("content", "") for item in result_list if item.get("content")]
            output = "\n---\n".join(contexts)
            dataset_item = dataset_items[i] if dataset_items and i < len(dataset_items) else None

            merged_items.append(
                EvaluationItemInput(
                    index=i,
                    inputs={"query": query},
                    output=output,
                    expected_output=dataset_item.get_expected_output_for_node(node_info.title) if dataset_item else None,
                    context=contexts,
                )
            )

        return self.evaluation_instance.evaluate_retrieval(
            merged_items, [default_metric.metric], model_provider, model_name, tenant_id
        )

    @staticmethod
    def _extract_query(inputs: dict[str, Any]) -> str:
        for key in ("query", "question", "input", "text"):
            if key in inputs:
                return str(inputs[key])
        values = list(inputs.values())
        return str(values[0]) if values else ""
