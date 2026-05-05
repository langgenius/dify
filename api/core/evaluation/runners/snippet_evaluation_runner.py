"""Runner for Snippet evaluation.

Snippets are essentially workflows, so we reuse ``evaluate_workflow`` from
the evaluation instance for metric computation.
"""

import logging
from collections.abc import Mapping
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


class SnippetEvaluationRunner(BaseEvaluationRunner):
    """Runner for snippet evaluation: evaluates a published Snippet workflow."""

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
        """Compute evaluation metrics for snippet outputs."""
        if not node_run_result_list:
            return []
        merged_items = self._merge_results_into_items(node_run_result_list)
        return self.evaluation_instance.evaluate_workflow(
            merged_items, [default_metric.metric], model_provider, model_name, tenant_id
        )

    @staticmethod
    def _merge_results_into_items(items: list[NodeRunResult]) -> list[EvaluationItemInput]:
        """Create EvaluationItemInput list from NodeRunResult for snippet evaluation."""
        merged = []
        for i, item in enumerate(items):
            output = _extract_snippet_output(item.outputs)
            merged.append(
                EvaluationItemInput(
                    index=i,
                    inputs=dict(item.inputs),
                    output=output,
                )
            )
        return merged


def _extract_snippet_output(outputs: Mapping[str, Any]) -> str:
    """Extract the primary output text from snippet NodeRunResult.outputs."""
    if "answer" in outputs:
        return str(outputs["answer"])
    if "text" in outputs:
        return str(outputs["text"])
    values = list(outputs.values())
    return str(values[0]) if values else ""
