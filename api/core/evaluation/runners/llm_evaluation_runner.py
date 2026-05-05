import logging
import re
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
        dataset_items: list[EvaluationDatasetInput] | None = None,
        node_info: NodeInfo | None = None,
    ) -> list[EvaluationItemResult]:
        """Use the evaluation instance to compute LLM metrics."""
        if not node_run_result_list:
            return []
        merged_items = self._merge_results_into_items(node_run_result_list, dataset_items, node_info)
        return self.evaluation_instance.evaluate_llm(
            merged_items, [default_metric.metric], model_provider, model_name, tenant_id
        )

    @staticmethod
    def _merge_results_into_items(
        items: list[NodeRunResult],
        dataset_items: list[EvaluationDatasetInput] | None = None,
        node_info: NodeInfo | None = None,
    ) -> list[EvaluationItemInput]:
        """Create new items from NodeRunResult for ragas evaluation.

        Extracts prompts from process_data and concatenates them into a single
        string with role prefixes (e.g. "system: ...\nuser: ...\nassistant: ...").
        The last assistant message in outputs is used as the actual output.
        """
        merged = []
        for i, item in enumerate(items):
            prompts = item.process_data.get("prompts", [])
            prompt = _format_prompts(prompts)
            output = _extract_llm_output(item.outputs)
            dataset_item = dataset_items[i] if dataset_items and i < len(dataset_items) else None
            merged.append(
                EvaluationItemInput(
                    index=i,
                    inputs={"prompt": prompt},
                    output=output,
                    expected_output=dataset_item.get_expected_output_for_node(node_info.title) if dataset_item else None,
                    context=_extract_context_blocks(prompts),
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


def _extract_context_blocks(prompts: list[dict[str, Any]]) -> list[str] | None:
    """Extract tagged context blocks from rendered prompts.

    Evaluation only treats prompt content wrapped in ``<context>...</context>``
    as retrieved evidence. This keeps faithfulness-style metrics opt-in and
    avoids guessing which arbitrary prompt text should be considered context.
    """
    prompt_text = "\n".join(str(prompt.get("text", "")) for prompt in prompts)
    matches = re.findall(r"<context>(.*?)</context>", prompt_text, flags=re.DOTALL)
    contexts = [match.strip() for match in matches if match.strip()]
    return contexts or None
