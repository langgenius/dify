import logging
from typing import Any

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import RagasConfig
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

# Maps canonical EvaluationMetricName to the corresponding ragas metric class.
# Metrics not listed here are unsupported by ragas and will be skipped.
_RAGAS_METRIC_MAP: dict[EvaluationMetricName, str] = {
    EvaluationMetricName.FAITHFULNESS: "Faithfulness",
    EvaluationMetricName.ANSWER_RELEVANCY: "AnswerRelevancy",
    EvaluationMetricName.ANSWER_CORRECTNESS: "AnswerCorrectness",
    EvaluationMetricName.SEMANTIC_SIMILARITY: "SemanticSimilarity",
    EvaluationMetricName.CONTEXT_PRECISION: "ContextPrecision",
    EvaluationMetricName.CONTEXT_RECALL: "ContextRecall",
    EvaluationMetricName.CONTEXT_RELEVANCE: "ContextRelevance",
    EvaluationMetricName.TOOL_CORRECTNESS: "ToolCallAccuracy",
}


class RagasEvaluator(BaseEvaluationInstance):
    """RAGAS framework adapter for evaluation."""

    def __init__(self, config: RagasConfig):
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
        return [m for m in candidates if m in _RAGAS_METRIC_MAP]

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
        """Core evaluation logic using RAGAS."""
        model_wrapper = DifyModelWrapper(model_provider, model_name, tenant_id)
        requested_metrics = [metric_name] if metric_name else self.get_supported_metrics(category)

        try:
            return self._evaluate_with_ragas(items, requested_metrics, model_wrapper, category)
        except ImportError:
            logger.warning("RAGAS not installed, falling back to simple evaluation")
            return self._evaluate_simple(items, requested_metrics, model_wrapper)

    def _evaluate_with_ragas(
        self,
        items: list[EvaluationItemInput],
        requested_metrics: list[str],
        model_wrapper: DifyModelWrapper,
        category: EvaluationCategory,
    ) -> list[EvaluationItemResult]:
        """Evaluate using RAGAS library.

        Builds SingleTurnSample differently per category to match ragas requirements:
        - LLM/Workflow: user_input=prompt, response=output, reference=expected_output
        - Retrieval: user_input=query, reference=expected_output, retrieved_contexts=context
        - Agent: Not supported via EvaluationDataset (requires message-based API)
        """
        from ragas import evaluate as ragas_evaluate
        from ragas.dataset_schema import EvaluationDataset

        samples: list[Any] = []
        for item in items:
            sample = self._build_sample(item, category)
            samples.append(sample)

        dataset = EvaluationDataset(samples=samples)

        ragas_metrics = self._build_ragas_metrics(requested_metrics)
        if not ragas_metrics:
            logger.warning("No valid RAGAS metrics found for: %s", requested_metrics)
            return [EvaluationItemResult(index=item.index) for item in items]

        try:
            result = ragas_evaluate(
                dataset=dataset,
                metrics=ragas_metrics,
            )

            results: list[EvaluationItemResult] = []
            result_df = result.to_pandas()
            for i, item in enumerate(items):
                metrics: list[EvaluationMetric] = []
                for m_name in requested_metrics:
                    if m_name in result_df.columns:
                        score = result_df.iloc[i][m_name]
                        if score is not None and not (isinstance(score, float) and score != score):
                            metrics.append(EvaluationMetric(name=m_name, value=float(score)))
                results.append(EvaluationItemResult(index=item.index, metrics=metrics))
            return results
        except Exception:
            logger.exception("RAGAS evaluation failed, falling back to simple evaluation")
            return self._evaluate_simple(items, requested_metrics, model_wrapper)

    @staticmethod
    def _build_sample(item: EvaluationItemInput, category: EvaluationCategory) -> Any:
        """Build a ragas SingleTurnSample with the correct fields per category.

        ragas metric field requirements:
        - faithfulness:       user_input, response, retrieved_contexts
        - answer_relevancy:   user_input, response
        - answer_correctness: user_input, response, reference
        - semantic_similarity: user_input, response, reference
        - context_precision:  user_input, reference, retrieved_contexts
        - context_recall:     user_input, reference, retrieved_contexts
        - context_relevance:  user_input, retrieved_contexts
        """
        from ragas.dataset_schema import SingleTurnSample

        user_input = _format_input(item.inputs, category)

        match category:
            case EvaluationCategory.LLM:
                # response = actual LLM output, reference = expected output
                return SingleTurnSample(
                    user_input=user_input,
                    response=item.output,
                    reference=item.expected_output or "",
                    retrieved_contexts=item.context or [],
                )
            case EvaluationCategory.RETRIEVAL:
                # context_precision/recall only need reference + retrieved_contexts
                return SingleTurnSample(
                    user_input=user_input,
                    reference=item.expected_output or "",
                    retrieved_contexts=item.context or [],
                )
            case _:
                return SingleTurnSample(
                    user_input=user_input,
                    response=item.output,
                )

    def _evaluate_simple(
        self,
        items: list[EvaluationItemInput],
        requested_metrics: list[str],
        model_wrapper: DifyModelWrapper,
    ) -> list[EvaluationItemResult]:
        """Simple LLM-as-judge fallback when RAGAS is not available."""
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

    @staticmethod
    def _build_ragas_metrics(requested_metrics: list[str]) -> list[Any]:
        """Build RAGAS metric instances from canonical metric names."""
        try:
            from ragas.metrics.collections import (
                AnswerCorrectness,
                AnswerRelevancy,
                ContextPrecision,
                ContextRecall,
                ContextRelevance,
                Faithfulness,
                SemanticSimilarity,
                ToolCallAccuracy,
            )

            # Maps canonical name → ragas metric class
            ragas_class_map: dict[str, Any] = {
                EvaluationMetricName.FAITHFULNESS: Faithfulness,
                EvaluationMetricName.ANSWER_RELEVANCY: AnswerRelevancy,
                EvaluationMetricName.ANSWER_CORRECTNESS: AnswerCorrectness,
                EvaluationMetricName.SEMANTIC_SIMILARITY: SemanticSimilarity,
                EvaluationMetricName.CONTEXT_PRECISION: ContextPrecision,
                EvaluationMetricName.CONTEXT_RECALL: ContextRecall,
                EvaluationMetricName.CONTEXT_RELEVANCE: ContextRelevance,
                EvaluationMetricName.TOOL_CORRECTNESS: ToolCallAccuracy,
            }

            metrics = []
            for name in requested_metrics:
                metric_class = ragas_class_map.get(name)
                if metric_class:
                    metrics.append(metric_class())
                else:
                    logger.warning("Metric '%s' is not supported by RAGAS, skipping", name)
            return metrics
        except ImportError:
            logger.warning("RAGAS metrics not available")
            return []


def _format_input(inputs: dict[str, Any], category: EvaluationCategory) -> str:
    """Extract the user-facing input string from the inputs dict."""
    match category:
        case EvaluationCategory.LLM | EvaluationCategory.WORKFLOW:
            return str(inputs.get("prompt", ""))
        case EvaluationCategory.RETRIEVAL:
            return str(inputs.get("query", ""))
        case _:
            return str(next(iter(inputs.values()), "")) if inputs else ""
