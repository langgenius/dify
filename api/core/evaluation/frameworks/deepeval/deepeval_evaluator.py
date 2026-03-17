import logging
from typing import Any

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import DeepEvalConfig
from core.evaluation.entities.evaluation_entity import (
    AGENT_METRIC_NAMES,
    LLM_METRIC_NAMES,
    RETRIEVAL_METRIC_NAMES,
    WORKFLOW_METRIC_NAMES,
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationMetricName,
)
from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

logger = logging.getLogger(__name__)

# Maps canonical EvaluationMetricName to the corresponding deepeval metric class name.
# deepeval metric field requirements (LLMTestCase fields):
#   - faithfulness:       input, actual_output, retrieval_context
#   - answer_relevancy:   input, actual_output
#   - context_precision:  input, actual_output, expected_output, retrieval_context
#   - context_recall:     input, actual_output, expected_output, retrieval_context
#   - context_relevance:  input, actual_output, retrieval_context
#   - tool_correctness:   input, actual_output, expected_tools
#   - task_completion:    input, actual_output
# Metrics not listed here are unsupported by deepeval and will be skipped.
_DEEPEVAL_METRIC_MAP: dict[EvaluationMetricName, str] = {
    EvaluationMetricName.FAITHFULNESS: "FaithfulnessMetric",
    EvaluationMetricName.ANSWER_RELEVANCY: "AnswerRelevancyMetric",
    EvaluationMetricName.CONTEXT_PRECISION: "ContextualPrecisionMetric",
    EvaluationMetricName.CONTEXT_RECALL: "ContextualRecallMetric",
    EvaluationMetricName.CONTEXT_RELEVANCE: "ContextualRelevancyMetric",
    EvaluationMetricName.TOOL_CORRECTNESS: "ToolCorrectnessMetric",
    EvaluationMetricName.TASK_COMPLETION: "TaskCompletionMetric",
}


class DeepEvalEvaluator(BaseEvaluationInstance):
    """DeepEval framework adapter for evaluation."""

    def __init__(self, config: DeepEvalConfig):
        self.config = config

    def get_supported_metrics(self, category: EvaluationCategory) -> list[str]:
        match category:
            case EvaluationCategory.LLM:
                candidates = LLM_METRIC_NAMES
            case EvaluationCategory.RETRIEVAL:
                candidates = RETRIEVAL_METRIC_NAMES
            case EvaluationCategory.AGENT:
                candidates = AGENT_METRIC_NAMES
            case EvaluationCategory.WORKFLOW | EvaluationCategory.SNIPPET:
                candidates = WORKFLOW_METRIC_NAMES
            case _:
                return []
        return [m for m in candidates if m in _DEEPEVAL_METRIC_MAP]

    def evaluate_llm(
        self,
        items: list[EvaluationItemInput],
        metric_name: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(items, metric_name, model_provider, model_name, tenant_id, EvaluationCategory.LLM)

    def evaluate_retrieval(
        self,
        items: list[EvaluationItemInput],
        metric_name: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(items, metric_name, model_provider, model_name, tenant_id, EvaluationCategory.RETRIEVAL)

    def evaluate_agent(
        self,
        items: list[EvaluationItemInput],
        metric_name: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(items, metric_name, model_provider, model_name, tenant_id, EvaluationCategory.AGENT)

    def evaluate_workflow(
        self,
        items: list[EvaluationItemInput],
        metric_name: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(items, metric_name, model_provider, model_name, tenant_id, EvaluationCategory.WORKFLOW)

    def _evaluate(
        self,
        items: list[EvaluationItemInput],
        metric_name: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
        category: EvaluationCategory,
    ) -> list[EvaluationItemResult]:
        """Core evaluation logic using DeepEval."""
        model_wrapper = DifyModelWrapper(model_provider, model_name, tenant_id)
        requested_metrics = [metric_name] if metric_name else self.get_supported_metrics(category)

        try:
            return self._evaluate_with_deepeval(items, requested_metrics, category)
        except ImportError:
            logger.warning("DeepEval not installed, falling back to simple evaluation")
            return self._evaluate_simple(items, requested_metrics, model_wrapper)

    def _evaluate_with_deepeval(
        self,
        items: list[EvaluationItemInput],
        requested_metrics: list[str],
        category: EvaluationCategory,
    ) -> list[EvaluationItemResult]:
        """Evaluate using DeepEval library.

        Builds LLMTestCase differently per category:
        - LLM/Workflow: input=prompt, actual_output=output, retrieval_context=context
        - Retrieval: input=query, actual_output=output, expected_output, retrieval_context=context
        - Agent: input=query, actual_output=output
        """
        metric_pairs = _build_deepeval_metrics(requested_metrics)
        if not metric_pairs:
            logger.warning("No valid DeepEval metrics found for: %s", requested_metrics)
            return [EvaluationItemResult(index=item.index) for item in items]

        results: list[EvaluationItemResult] = []
        for item in items:
            test_case = self._build_test_case(item, category)
            metrics: list[EvaluationMetric] = []
            for canonical_name, metric in metric_pairs:
                try:
                    metric.measure(test_case)
                    if metric.score is not None:
                        metrics.append(EvaluationMetric(name=canonical_name, value=float(metric.score)))
                except Exception:
                    logger.exception(
                        "Failed to compute metric %s for item %d",
                        canonical_name,
                        item.index,
                    )
            results.append(EvaluationItemResult(index=item.index, metrics=metrics))
        return results

    @staticmethod
    def _build_test_case(item: EvaluationItemInput, category: EvaluationCategory) -> Any:
        """Build a deepeval LLMTestCase with the correct fields per category."""
        from deepeval.test_case import LLMTestCase

        user_input = _format_input(item.inputs, category)

        match category:
            case EvaluationCategory.LLM | EvaluationCategory.WORKFLOW:
                # faithfulness needs: input, actual_output, retrieval_context
                # answer_relevancy needs: input, actual_output
                return LLMTestCase(
                    input=user_input,
                    actual_output=item.output,
                    expected_output=item.expected_output or None,
                    retrieval_context=item.context or None,
                )
            case EvaluationCategory.RETRIEVAL:
                # contextual_precision/recall needs: input, actual_output, expected_output, retrieval_context
                return LLMTestCase(
                    input=user_input,
                    actual_output=item.output or "",
                    expected_output=item.expected_output or "",
                    retrieval_context=item.context or [],
                )
            case _:
                return LLMTestCase(
                    input=user_input,
                    actual_output=item.output,
                )

    def _evaluate_simple(
        self,
        items: list[EvaluationItemInput],
        requested_metrics: list[str],
        model_wrapper: DifyModelWrapper,
    ) -> list[EvaluationItemResult]:
        """Simple LLM-as-judge fallback when DeepEval is not available."""
        results: list[EvaluationItemResult] = []
        for item in items:
            metrics: list[EvaluationMetric] = []
            for m_name in requested_metrics:
                try:
                    score = self._judge_with_llm(model_wrapper, m_name, item)
                    metrics.append(EvaluationMetric(name=m_name, value=score))
                except Exception:
                    logger.exception("Failed to compute metric %s for item %d", m_name, item.index)
            results.append(EvaluationItemResult(index=item.index, metrics=metrics))
        return results

    def _judge_with_llm(
        self,
        model_wrapper: DifyModelWrapper,
        metric_name: str,
        item: EvaluationItemInput,
    ) -> float:
        """Use the LLM to judge a single metric for a single item."""
        prompt = self._build_judge_prompt(metric_name, item)
        response = model_wrapper.invoke(prompt)
        return self._parse_score(response)

    @staticmethod
    def _build_judge_prompt(metric_name: str, item: EvaluationItemInput) -> str:
        """Build a scoring prompt for the LLM judge."""
        parts = [
            f"Evaluate the following on the metric '{metric_name}' using a scale of 0.0 to 1.0.",
            f"\nInput: {item.inputs}",
            f"\nOutput: {item.output}",
        ]
        if item.expected_output:
            parts.append(f"\nExpected Output: {item.expected_output}")
        if item.context:
            parts.append(f"\nContext: {'; '.join(item.context)}")
        parts.append("\nRespond with ONLY a single floating point number between 0.0 and 1.0, nothing else.")
        return "\n".join(parts)

    @staticmethod
    def _parse_score(response: str) -> float:
        """Parse a float score from LLM response."""
        import re

        cleaned = response.strip()
        try:
            score = float(cleaned)
            return max(0.0, min(1.0, score))
        except ValueError:
            match = re.search(r"(\d+\.?\d*)", cleaned)
            if match:
                score = float(match.group(1))
                return max(0.0, min(1.0, score))
            return 0.0


def _format_input(inputs: dict[str, Any], category: EvaluationCategory) -> str:
    """Extract the user-facing input string from the inputs dict."""
    match category:
        case EvaluationCategory.LLM | EvaluationCategory.WORKFLOW:
            return str(inputs.get("prompt", ""))
        case EvaluationCategory.RETRIEVAL:
            return str(inputs.get("query", ""))
        case _:
            return str(next(iter(inputs.values()), "")) if inputs else ""


def _build_deepeval_metrics(requested_metrics: list[str]) -> list[tuple[str, Any]]:
    """Build DeepEval metric instances from canonical metric names.

    Returns a list of (canonical_name, metric_instance) pairs so that callers
    can record the canonical name rather than the framework-internal class name.
    """
    try:
        from deepeval.metrics import (
            AnswerRelevancyMetric,
            ContextualPrecisionMetric,
            ContextualRecallMetric,
            ContextualRelevancyMetric,
            FaithfulnessMetric,
            TaskCompletionMetric,
            ToolCorrectnessMetric,
        )

        # Maps canonical name → deepeval metric class
        deepeval_class_map: dict[str, Any] = {
            EvaluationMetricName.FAITHFULNESS: FaithfulnessMetric,
            EvaluationMetricName.ANSWER_RELEVANCY: AnswerRelevancyMetric,
            EvaluationMetricName.CONTEXT_PRECISION: ContextualPrecisionMetric,
            EvaluationMetricName.CONTEXT_RECALL: ContextualRecallMetric,
            EvaluationMetricName.CONTEXT_RELEVANCE: ContextualRelevancyMetric,
            EvaluationMetricName.TOOL_CORRECTNESS: ToolCorrectnessMetric,
            EvaluationMetricName.TASK_COMPLETION: TaskCompletionMetric,
        }

        pairs: list[tuple[str, Any]] = []
        for name in requested_metrics:
            metric_class = deepeval_class_map.get(name)
            if metric_class:
                pairs.append((name, metric_class(threshold=0.5)))
            else:
                logger.warning("Metric '%s' is not supported by DeepEval, skipping", name)
        return pairs
    except ImportError:
        logger.warning("DeepEval metrics not available")
        return []
