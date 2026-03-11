import logging
from typing import Any

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import RagasConfig
from core.evaluation.entities.evaluation_entity import (
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
)
from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

logger = logging.getLogger(__name__)

# Metric name mappings per category
LLM_METRICS = ["faithfulness", "answer_relevancy", "answer_correctness", "semantic_similarity"]
RETRIEVAL_METRICS = ["context_precision", "context_recall", "context_relevance"]
AGENT_METRICS = ["tool_call_accuracy", "answer_correctness"]
WORKFLOW_METRICS = ["faithfulness", "answer_correctness"]


class RagasEvaluator(BaseEvaluationInstance):
    """RAGAS framework adapter for evaluation."""

    def __init__(self, config: RagasConfig):
        self.config = config

    def get_supported_metrics(self, category: EvaluationCategory) -> list[str]:
        match category:
            case EvaluationCategory.LLM:
                return LLM_METRICS
            case EvaluationCategory.RETRIEVAL:
                return RETRIEVAL_METRICS
            case EvaluationCategory.AGENT:
                return AGENT_METRICS
            case EvaluationCategory.WORKFLOW:
                return WORKFLOW_METRICS
            case _:
                return []

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
        return self._evaluate(
            items, metric_name, model_provider, model_name, tenant_id, EvaluationCategory.RETRIEVAL
        )

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
        return self._evaluate(
            items, metric_name, model_provider, model_name, tenant_id, EvaluationCategory.WORKFLOW
        )

    def _evaluate(
        self,
        items: list[EvaluationItemInput],
        metric_name: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
        category: EvaluationCategory,
    ) -> list[EvaluationItemResult]:
        """Core evaluation logic using RAGAS.

        Uses the Dify model wrapper as judge LLM. Falls back to simple
        string similarity if RAGAS import fails.
        """
        model_wrapper = DifyModelWrapper(model_provider, model_name, tenant_id)
        # Extract metric names from metric_name string.
        requested_metrics = (
            [metric_name]
            if metric_name
            else self.get_supported_metrics(category)
        )

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
        """Evaluate using RAGAS library."""
        from ragas import evaluate as ragas_evaluate
        from ragas.dataset_schema import EvaluationDataset, SingleTurnSample

        # Build RAGAS dataset
        samples = []
        for item in items:
            sample = SingleTurnSample(
                user_input=self._inputs_to_query(item.inputs),
                response=item.expected_output or "",
                retrieved_contexts=item.context or [],
            )
            if item.expected_output:
                sample.reference = item.expected_output
            samples.append(sample)

        dataset = EvaluationDataset(samples=samples)

        # Build metric instances
        ragas_metrics = self._build_ragas_metrics(requested_metrics)

        if not ragas_metrics:
            logger.warning("No valid RAGAS metrics found for: %s", requested_metrics)
            return [EvaluationItemResult(index=item.index) for item in items]

        # Run RAGAS evaluation
        try:
            result = ragas_evaluate(
                dataset=dataset,
                metrics=ragas_metrics,
            )

            # Convert RAGAS results to our format
            results = []
            result_df = result.to_pandas()
            for i, item in enumerate(items):
                metrics = []
                for metric_name in requested_metrics:
                    if metric_name in result_df.columns:
                        score = result_df.iloc[i][metric_name]
                        if score is not None and not (isinstance(score, float) and score != score):  # NaN check
                            metrics.append(EvaluationMetric(name=metric_name, value=float(score)))
                results.append(EvaluationItemResult(index=item.index, metrics=metrics))
            return results
        except Exception:
            logger.exception("RAGAS evaluation failed, falling back to simple evaluation")
            return self._evaluate_simple(items, requested_metrics, model_wrapper)

    def _evaluate_simple(
        self,
        items: list[EvaluationItemInput],
        requested_metrics: list[str],
        model_wrapper: DifyModelWrapper,
    ) -> list[EvaluationItemResult]:
        """Simple LLM-as-judge fallback when RAGAS is not available."""
        results = []
        for item in items:
            metrics = []
            query = self._inputs_to_query(item.inputs)

            for metric_name in requested_metrics:
                try:
                    score = self._judge_with_llm(model_wrapper, metric_name, query, item)
                    metrics.append(EvaluationMetric(name=metric_name, value=score))
                except Exception:
                    logger.exception("Failed to compute metric %s for item %d", metric_name, item.index)

            results.append(EvaluationItemResult(index=item.index, metrics=metrics))
        return results

    def _judge_with_llm(
        self,
        model_wrapper: DifyModelWrapper,
        metric_name: str,
        query: str,
        item: EvaluationItemInput,
    ) -> float:
        """Use the LLM to judge a single metric for a single item."""
        prompt = self._build_judge_prompt(metric_name, query, item)
        response = model_wrapper.invoke(prompt)
        return self._parse_score(response)

    def _build_judge_prompt(self, metric_name: str, query: str, item: EvaluationItemInput) -> str:
        """Build a scoring prompt for the LLM judge."""
        parts = [
            f"Evaluate the following on the metric '{metric_name}' using a scale of 0.0 to 1.0.",
            f"\nQuery: {query}",
        ]
        if item.expected_output:
            parts.append(f"\nExpected Output: {item.expected_output}")
        if item.context:
            parts.append(f"\nContext: {'; '.join(item.context)}")
        parts.append(
            "\nRespond with ONLY a single floating point number between 0.0 and 1.0, nothing else."
        )
        return "\n".join(parts)

    @staticmethod
    def _parse_score(response: str) -> float:
        """Parse a float score from LLM response."""
        cleaned = response.strip()
        try:
            score = float(cleaned)
            return max(0.0, min(1.0, score))
        except ValueError:
            # Try to extract first number from response
            import re

            match = re.search(r"(\d+\.?\d*)", cleaned)
            if match:
                score = float(match.group(1))
                return max(0.0, min(1.0, score))
            return 0.0

    @staticmethod
    def _inputs_to_query(inputs: dict[str, Any]) -> str:
        """Convert input dict to a query string."""
        if "query" in inputs:
            return str(inputs["query"])
        if "question" in inputs:
            return str(inputs["question"])
        # Fallback: concatenate all input values
        return " ".join(str(v) for v in inputs.values())

    @staticmethod
    def _build_ragas_metrics(requested_metrics: list[str]) -> list[Any]:
        """Build RAGAS metric instances from metric names."""
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

            metric_map: dict[str, Any] = {
                "faithfulness": Faithfulness,
                "answer_relevancy": AnswerRelevancy,
                "answer_correctness": AnswerCorrectness,
                "semantic_similarity": SemanticSimilarity,
                "context_precision": ContextPrecision,
                "context_recall": ContextRecall,
                "context_relevance": ContextRelevance,
                "tool_call_accuracy": ToolCallAccuracy,
            }

            metrics = []
            for name in requested_metrics:
                metric_class = metric_map.get(name)
                if metric_class:
                    metrics.append(metric_class())
                else:
                    logger.warning("Unknown RAGAS metric: %s", name)
            return metrics
        except ImportError:
            logger.warning("RAGAS metrics not available")
            return []
