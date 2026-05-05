import logging
from importlib import import_module
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
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(items, metric_names, model_provider, model_name, tenant_id, EvaluationCategory.LLM)

    def evaluate_retrieval(
        self,
        items: list[EvaluationItemInput],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(items, metric_names, model_provider, model_name, tenant_id, EvaluationCategory.RETRIEVAL)

    def evaluate_agent(
        self,
        items: list[EvaluationItemInput],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(items, metric_names, model_provider, model_name, tenant_id, EvaluationCategory.AGENT)

    def evaluate_workflow(
        self,
        items: list[EvaluationItemInput],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(items, metric_names, model_provider, model_name, tenant_id, EvaluationCategory.WORKFLOW)

    def _evaluate(
        self,
        items: list[EvaluationItemInput],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
        category: EvaluationCategory,
    ) -> list[EvaluationItemResult]:
        """Core evaluation logic using RAGAS."""
        model_wrapper = DifyModelWrapper(model_provider, model_name, tenant_id)
        requested_metrics = metric_names or self.get_supported_metrics(category)

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
            return [EvaluationItemResult(index=item.index, actual_output=item.output) for item in items]

        try:
            result = ragas_evaluate(
                dataset=dataset,
                metrics=ragas_metrics,
                llm=model_wrapper,
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
                results.append(EvaluationItemResult(index=item.index, metrics=metrics, actual_output=item.output))
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
            results.append(EvaluationItemResult(index=item.index, metrics=metrics, actual_output=item.output))
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
            metrics_module = _import_ragas_metrics_module()

            # Maps canonical name → ragas metric class
            ragas_class_map: dict[str, Any] = {
                EvaluationMetricName.FAITHFULNESS: getattr(metrics_module, "Faithfulness"),
                EvaluationMetricName.ANSWER_RELEVANCY: getattr(metrics_module, "AnswerRelevancy"),
                EvaluationMetricName.ANSWER_CORRECTNESS: getattr(metrics_module, "AnswerCorrectness"),
                EvaluationMetricName.SEMANTIC_SIMILARITY: getattr(metrics_module, "SemanticSimilarity"),
                EvaluationMetricName.CONTEXT_PRECISION: getattr(metrics_module, "ContextPrecision"),
                EvaluationMetricName.CONTEXT_RECALL: getattr(metrics_module, "ContextRecall"),
                EvaluationMetricName.CONTEXT_RELEVANCE: getattr(metrics_module, "ContextRelevance"),
                EvaluationMetricName.TOOL_CORRECTNESS: getattr(metrics_module, "ToolCallAccuracy"),
            }

            metrics = []
            for name in requested_metrics:
                metric_class = ragas_class_map.get(name)
                if metric_class:
                    if name == EvaluationMetricName.ANSWER_CORRECTNESS:
                        # ragas answer_correctness blends factuality with semantic
                        # similarity. The latter requires an embeddings backend,
                        # which is not wired through Dify's evaluation stack yet.
                        # Keep the metric usable by relying on the factuality
                        # component only for now.
                        metrics.append(metric_class(weights=[1.0, 0.0], embeddings=_NoopRagasEmbeddings()))
                    else:
                        metrics.append(metric_class())
                else:
                    logger.warning("Metric '%s' is not supported by RAGAS, skipping", name)
            return metrics
        except ImportError:
            logger.warning("RAGAS metrics not available")
            return []


def _import_ragas_metrics_module() -> Any:
    """Load ragas metric classes across supported ragas versions.

    ragas 0.3.x exposes metric classes from ``ragas.metrics`` while some older
    versions used ``ragas.metrics.collections``. Support both so worker
    environments do not silently drop all metrics because of a module path
    mismatch.
    """
    try:
        return import_module("ragas.metrics")
    except ImportError:
        return import_module("ragas.metrics.collections")


class _NoopRagasEmbeddings:
    """Placeholder embeddings for ragas metrics whose embedding branch is disabled.

    ragas eagerly injects a default embeddings backend for any metric that
    subclasses ``MetricWithEmbeddings``. For answer_correctness we currently
    disable the semantic-similarity weight, so no real embedding call should
    happen. Supplying this placeholder keeps ragas from constructing its
    default OpenAI embeddings client during setup.
    """

    async def aembed_query(self, text: str) -> list[float]:
        del text
        return [0.0]

    async def aembed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.0] for _ in texts]


def _format_input(inputs: dict[str, Any], category: EvaluationCategory) -> str:
    """Extract the user-facing input string from the inputs dict."""
    match category:
        case EvaluationCategory.LLM | EvaluationCategory.WORKFLOW:
            return str(inputs.get("prompt", ""))
        case EvaluationCategory.RETRIEVAL:
            return str(inputs.get("query", ""))
        case _:
            return str(next(iter(inputs.values()), "")) if inputs else ""
