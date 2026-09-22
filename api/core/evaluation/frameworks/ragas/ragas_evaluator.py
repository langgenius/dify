from __future__ import annotations

import logging
import math
from importlib import import_module
from typing import TYPE_CHECKING, Any

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import RagasConfig
from core.evaluation.entities.evaluation_entity import (
    LLM_METRIC_NAMES,
    RETRIEVAL_METRIC_NAMES,
    WORKFLOW_METRIC_NAMES,
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationMetricName,
)

if TYPE_CHECKING:
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
            case EvaluationCategory.WORKFLOW | EvaluationCategory.SNIPPET:
                candidates = WORKFLOW_METRIC_NAMES
            case _:
                return []
        return [m.value for m in candidates if m in _RAGAS_METRIC_MAP]

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
        from core.evaluation.frameworks.ragas.ragas_embeddings_wrapper import DifyEmbeddingsWrapper
        from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

        model_wrapper = DifyModelWrapper(model_provider, model_name, tenant_id)
        embeddings_wrapper = DifyEmbeddingsWrapper(tenant_id)
        requested_metrics = metric_names or self.get_supported_metrics(category)

        return self._evaluate_with_ragas(items, requested_metrics, model_wrapper, embeddings_wrapper, category)

    def _evaluate_with_ragas(
        self,
        items: list[EvaluationItemInput],
        requested_metrics: list[str],
        model_wrapper: DifyModelWrapper,
        embeddings_wrapper: Any,
        category: EvaluationCategory,
    ) -> list[EvaluationItemResult]:
        """Evaluate using RAGAS library.

        Builds SingleTurnSample differently per category to match ragas requirements:
        - LLM/Workflow: user_input=prompt, response=output, reference=expected_output
        - Retrieval: user_input=query, reference=expected_output, retrieved_contexts=context
        """
        from ragas import evaluate as ragas_evaluate
        from ragas.dataset_schema import EvaluationDataset

        samples: list[Any] = []
        for item in items:
            sample = self._build_sample(item, category)
            samples.append(sample)

        dataset = EvaluationDataset(samples=samples)

        ragas_metrics = self._build_ragas_metrics(requested_metrics, embeddings_wrapper)
        if not ragas_metrics:
            logger.warning("No valid RAGAS metrics found for: %s", requested_metrics)
            return [EvaluationItemResult(index=item.index, actual_output=item.output) for item in items]

        result = ragas_evaluate(
            dataset=dataset,
            metrics=ragas_metrics,
            llm=model_wrapper,
            raise_exceptions=True,
            show_progress=False,
        )

        results: list[EvaluationItemResult] = []
        result_df = result.to_pandas()
        for i, item in enumerate(items):
            metrics: list[EvaluationMetric] = []
            for m_name in requested_metrics:
                if m_name in result_df.columns:
                    score = result_df.iloc[i][m_name]
                    if score is not None:
                        numeric_score = float(score)
                        if not math.isnan(numeric_score):
                            metrics.append(EvaluationMetric(name=m_name, value=numeric_score))
            missing_metrics = [name for name in requested_metrics if name not in {metric.name for metric in metrics}]
            results.append(
                EvaluationItemResult(
                    index=item.index,
                    metrics=metrics,
                    actual_output=item.output,
                    error=(f"RAGAS returned no score for: {', '.join(missing_metrics)}" if missing_metrics else None),
                )
            )
        return results

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

    @staticmethod
    def _build_ragas_metrics(requested_metrics: list[str], embeddings_wrapper: Any) -> list[Any]:
        """Build RAGAS metric instances from canonical metric names."""
        try:
            metrics_module = _import_ragas_metrics_module()

            # Maps canonical name → ragas metric class
            ragas_class_map: dict[str, Any] = {
                EvaluationMetricName.FAITHFULNESS: metrics_module.Faithfulness,
                EvaluationMetricName.ANSWER_RELEVANCY: metrics_module.AnswerRelevancy,
                EvaluationMetricName.ANSWER_CORRECTNESS: metrics_module.AnswerCorrectness,
                EvaluationMetricName.SEMANTIC_SIMILARITY: metrics_module.SemanticSimilarity,
                EvaluationMetricName.CONTEXT_PRECISION: metrics_module.ContextPrecision,
                EvaluationMetricName.CONTEXT_RECALL: metrics_module.ContextRecall,
                EvaluationMetricName.CONTEXT_RELEVANCE: metrics_module.ContextRelevance,
            }

            metrics = []
            for name in requested_metrics:
                metric_class = ragas_class_map.get(name)
                if metric_class:
                    if name in {
                        EvaluationMetricName.ANSWER_RELEVANCY,
                        EvaluationMetricName.ANSWER_CORRECTNESS,
                        EvaluationMetricName.SEMANTIC_SIMILARITY,
                    }:
                        metrics.append(metric_class(name=name, embeddings=embeddings_wrapper))
                    else:
                        metrics.append(metric_class(name=name))
                else:
                    logger.warning("Metric '%s' is not supported by RAGAS, skipping", name)
            return metrics
        except ImportError as exc:
            raise RuntimeError("RAGAS is not installed in the evaluation worker") from exc


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


def _format_input(inputs: dict[str, Any], category: EvaluationCategory) -> str:
    """Extract the user-facing input string from the inputs dict."""
    match category:
        case EvaluationCategory.LLM | EvaluationCategory.WORKFLOW:
            return str(inputs.get("prompt", ""))
        case EvaluationCategory.RETRIEVAL:
            return str(inputs.get("query", ""))
        case _:
            return str(next(iter(inputs.values()), "")) if inputs else ""
