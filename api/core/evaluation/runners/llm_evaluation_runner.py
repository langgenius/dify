import logging
from collections.abc import Mapping
from typing import Any

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    DefaultMetric,
    EvaluationItemInput,
    EvaluationItemResult,
)
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from graphon.node_events import NodeRunResult

logger = logging.getLogger(__name__)


class LLMEvaluationRunner(BaseEvaluationRunner):
    """Runner for LLM evaluation: extracts prompts/outputs then evaluates."""

    def __init__(self, evaluation_instance: BaseEvaluationInstance):
        super().__init__(evaluation_instance)

    def evaluate_metrics(
        self,
        node_run_result_list: list[NodeRunResult],
        default_metric: DefaultMetric,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Use the evaluation instance to compute LLM metrics."""
        if not node_run_result_list:
            return []
        merged_items = self._merge_results_into_items(node_run_result_list)
        return self.evaluation_instance.evaluate_llm(
            merged_items, [default_metric.metric], model_provider, model_name, tenant_id
        )

    @staticmethod
    def _merge_results_into_items(
        items: list[NodeRunResult],
    ) -> list[EvaluationItemInput]:
        """Create new items from NodeRunResult for ragas evaluation.

        Extracts prompts from process_data and concatenates them into a single
        string with role prefixes (e.g. "system: ...\nuser: ...\nassistant: ...").
        The last assistant message in outputs is used as the actual output.
        """
        merged = []
        for i, item in enumerate(items):
            prompt = _format_prompts(item.process_data.get("prompts", []))
            output = _extract_llm_output(item.outputs)
            merged.append(
                EvaluationItemInput(
                    index=i,
                    inputs={"prompt": prompt},
                    output=output,
                )
            )
        return merged


def _format_prompts(prompts: list[dict[str, Any]]) -> str:
    """Concatenate a list of prompt messages into a single string for evaluation.

    Each message is formatted as "role: text" and joined with newlines.
    """
    parts: list[str] = []
    for msg in prompts:
        role = msg.get("role", "unknown")
        text = msg.get("text", "")
        parts.append(f"{role}: {text}")
    return "\n".join(parts)


def _extract_llm_output(outputs: Mapping[str, Any]) -> str:
    """Extract the LLM output text from NodeRunResult.outputs."""
    if "text" in outputs:
        return str(outputs["text"])
    if "answer" in outputs:
        return str(outputs["answer"])
    values = list(outputs.values())
    return str(values[0]) if values else ""
