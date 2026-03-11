import logging
from collections.abc import Mapping
from typing import Any, Union

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


class LLMEvaluationRunner(BaseEvaluationRunner):
    """Runner for LLM evaluation: executes App to get responses, then evaluates."""

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
        """Use the evaluation instance to compute LLM metrics."""
        # Merge actual_output into items for evaluation
        if not node_run_result_list:
            return []
        if not default_metric:
            raise ValueError("Default metric is required for LLM evaluation")
        merged_items = self._merge_results_into_items(node_run_result_list)
        return self.evaluation_instance.evaluate_llm(
            merged_items, default_metric.metric, model_provider, model_name, tenant_id
        )

    @staticmethod
    def _extract_query(inputs: dict[str, Any]) -> str:
        """Extract query from inputs."""
        for key in ("query", "question", "input", "text"):
            if key in inputs:
                return str(inputs[key])
        values = list(inputs.values())
        return str(values[0]) if values else ""

    @staticmethod
    def _extract_output(response: Union[Mapping[str, Any], Any]) -> str:
        """Extract text output from app response."""
        if isinstance(response, Mapping):
            # Workflow response
            if "data" in response and isinstance(response["data"], Mapping):
                outputs = response["data"].get("outputs", {})
                if isinstance(outputs, Mapping):
                    values = list(outputs.values())
                    return str(values[0]) if values else ""
                return str(outputs)
            # Completion response
            if "answer" in response:
                return str(response["answer"])
            if "text" in response:
                return str(response["text"])
        return str(response)

    @staticmethod
    def _merge_results_into_items(
        items: list[NodeRunResult],
    ) -> list[EvaluationItemInput]:
        """Create new items with actual_output set as expected_output context for metrics."""
        merged = []
        for item in items:
            merged.append(
                EvaluationItemInput(
                    index=item.index,
                    inputs={
                        "prompt": item.prompt,
                    },
                    output=item.output,
                    expected_output=item.expected_output,
                )
            )
        return merged
