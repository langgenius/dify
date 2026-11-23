from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass
from importlib import import_module
from typing import TYPE_CHECKING, Any, override

from core.evaluation.agent.agent_judge_evaluator import AgentLLMJudgeEvaluator, merge_agent_evaluation_results
from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import RagasConfig
from core.evaluation.entities.evaluation_entity import (
    AGENT_METRIC_NAMES,
    LLM_METRIC_NAMES,
    NATIVE_AGENT_METRIC_NAMES,
    RETRIEVAL_METRIC_NAMES,
    WORKFLOW_METRIC_NAMES,
    AgentEvaluationItem,
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationMetricName,
)
from core.evaluation.exceptions import EvaluationErrorCode, new_public_evaluation_error
from core.plugin.impl.base import use_plugin_daemon_request_timeout
from graphon.model_runtime.errors.invoke import (
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
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
    EvaluationMetricName.CONTEXT_PRECISION: "ContextPrecisionWithReference",
    EvaluationMetricName.CONTEXT_RECALL: "ContextRecall",
    EvaluationMetricName.CONTEXT_RELEVANCE: "ContextRelevance",
    EvaluationMetricName.TOOL_CALL_ACCURACY: "ToolCallAccuracy",
}

_RAGAS_EMBEDDING_METRICS = {
    EvaluationMetricName.ANSWER_RELEVANCY.value,
    EvaluationMetricName.ANSWER_CORRECTNESS.value,
    EvaluationMetricName.SEMANTIC_SIMILARITY.value,
}

_RAGAS_REFERENCE_METRICS = {
    EvaluationMetricName.ANSWER_CORRECTNESS.value,
    EvaluationMetricName.SEMANTIC_SIMILARITY.value,
    EvaluationMetricName.CONTEXT_PRECISION.value,
    EvaluationMetricName.CONTEXT_RECALL.value,
}

_NATIVE_AGENT_METRICS = {metric.value for metric in NATIVE_AGENT_METRIC_NAMES}
_RAGAS_METRIC_TIMEOUT_SECONDS = 180
_RAGAS_METRIC_RETRIES = 10
_RAGAS_MAX_WORKERS = 16

_RAGAS_METRIC_FIELDS: dict[str, tuple[str, ...]] = {
    EvaluationMetricName.FAITHFULNESS: ("user_input", "response", "retrieved_contexts"),
    EvaluationMetricName.ANSWER_RELEVANCY: ("user_input", "response"),
    EvaluationMetricName.ANSWER_CORRECTNESS: ("user_input", "response", "reference"),
    EvaluationMetricName.SEMANTIC_SIMILARITY: ("reference", "response"),
    EvaluationMetricName.CONTEXT_PRECISION: ("user_input", "reference", "retrieved_contexts"),
    EvaluationMetricName.CONTEXT_RECALL: ("user_input", "reference", "retrieved_contexts"),
    EvaluationMetricName.CONTEXT_RELEVANCE: ("user_input", "retrieved_contexts"),
}


@dataclass(frozen=True)
class RagasAgentComponents:
    AIMessage: type[Any]
    HumanMessage: type[Any]
    ToolCall: type[Any]
    ToolCallAccuracy: type[Any]


# Retry only provider failures known to be transient. Client-side validation
# failures such as PluginInvokeError must surface immediately.
_RAGAS_RETRYABLE_EXCEPTIONS = (
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)


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
        return [m.value for m in candidates if m in _RAGAS_METRIC_MAP or m.value in _NATIVE_AGENT_METRICS]

    @override
    def metric_requires_embeddings(self, metric_name: str) -> bool:
        return metric_name in _RAGAS_EMBEDDING_METRICS

    @override
    def metric_requires_expected_output(self, metric_name: str) -> bool:
        return metric_name in _RAGAS_REFERENCE_METRICS

    @override
    def metric_requires_expected_tool_calls(self, metric_name: str) -> bool:
        return metric_name == EvaluationMetricName.TOOL_CALL_ACCURACY.value

    @override
    def metric_accepts_success_criteria(self, metric_name: str) -> bool:
        return metric_name == EvaluationMetricName.TASK_COMPLETION.value

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
        items: list[AgentEvaluationItem],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        requested_metrics = metric_names or self.get_supported_metrics(EvaluationCategory.AGENT)
        native_metrics = [name for name in requested_metrics if name in _NATIVE_AGENT_METRICS]
        supported_metrics = [
            name for name in requested_metrics if name == EvaluationMetricName.TOOL_CALL_ACCURACY.value
        ]
        unsupported_metrics = [
            name for name in requested_metrics if name not in supported_metrics and name not in native_metrics
        ]
        result_groups: list[list[EvaluationItemResult]] = []
        if native_metrics:
            result_groups.append(
                AgentLLMJudgeEvaluator().evaluate(
                    items,
                    native_metrics,
                    model_provider,
                    model_name,
                    tenant_id,
                )
            )
        if supported_metrics:
            result_groups.append(self._evaluate_agent_tool_call_accuracy(items, unsupported_metrics))
        elif unsupported_metrics and not native_metrics:
            raise ValueError(f"RAGAS does not support any requested Agent metrics: {requested_metrics}")

        if not result_groups:
            raise ValueError(f"RAGAS does not support any requested Agent metrics: {requested_metrics}")
        return merge_agent_evaluation_results(items, *result_groups)

    def _evaluate_agent_tool_call_accuracy(
        self,
        items: list[AgentEvaluationItem],
        unsupported_metrics: list[str],
    ) -> list[EvaluationItemResult]:
        """Evaluate the retained reference-based legacy Agent metric.

        Precondition: items and requested metrics passed configuration validation.
        Postcondition: unsupported or failed metrics return public diagnostics;
        provider exceptions are available only in server logs.
        """

        components = _load_ragas_agent_components()
        metric = components.ToolCallAccuracy(name=EvaluationMetricName.TOOL_CALL_ACCURACY.value)
        results: list[EvaluationItemResult] = []
        for item in items:
            errors: list[str] = []
            for name in unsupported_metrics:
                failure = new_public_evaluation_error(EvaluationErrorCode.UNSUPPORTED_METRIC)
                logger.info(
                    "RAGAS Agent metric %s is unsupported for item %d (error_id=%s)",
                    name,
                    item.index,
                    failure.error_id,
                )
                errors.append(failure.text)
            evaluated_metrics: list[EvaluationMetric] = []
            if not item.expected_tool_calls:
                errors.append("Metric 'tool_call_accuracy' requires non-empty expected_tool_calls.")
            else:
                try:
                    score = float(metric.score(**self._build_agent_sample(item, components)).value)
                    if not math.isfinite(score):
                        raise ValueError(f"RAGAS returned a non-finite score: {score}")
                    evaluated_metrics.append(
                        EvaluationMetric(name=EvaluationMetricName.TOOL_CALL_ACCURACY.value, value=score)
                    )
                except Exception:
                    failure = new_public_evaluation_error(EvaluationErrorCode.METRIC_FAILED)
                    logger.exception(
                        "RAGAS Agent metric failed for item %d (error_id=%s)", item.index, failure.error_id
                    )
                    errors.append(failure.text)

            results.append(
                EvaluationItemResult(
                    index=item.index,
                    actual_output=item.output,
                    metrics=evaluated_metrics,
                    error="; ".join(errors) if errors else None,
                )
            )
        return results

    def evaluate_workflow(
        self,
        items: list[EvaluationItemInput],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(items, metric_names, model_provider, model_name, tenant_id, EvaluationCategory.WORKFLOW)

    @staticmethod
    def _build_agent_sample(
        item: AgentEvaluationItem, components: RagasAgentComponents | None = None
    ) -> dict[str, Any]:
        """Build keyword inputs for the modern Ragas ToolCallAccuracy metric."""
        components = components or _load_ragas_agent_components()

        actual_tool_calls = [components.ToolCall(name=call.name, args=call.arguments) for call in item.tool_calls]
        expected_tool_calls = [
            components.ToolCall(name=call.name, args=call.arguments) for call in (item.expected_tool_calls or [])
        ]
        return {
            "user_input": [
                components.HumanMessage(content=_format_input(item.inputs, EvaluationCategory.AGENT)),
                components.AIMessage(content=item.output, tool_calls=actual_tool_calls),
            ],
            "reference_tool_calls": expected_tool_calls,
        }

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
        """Score rows with Ragas collections metrics through Dify-owned orchestration."""
        ragas_metrics = self._build_ragas_metrics(requested_metrics, model_wrapper, embeddings_wrapper)
        if not ragas_metrics:
            logger.warning("No valid RAGAS metrics found for: %s", requested_metrics)
            return [EvaluationItemResult(index=item.index, actual_output=item.output) for item in items]

        supported_names = {metric.name for metric in ragas_metrics}
        unsupported_names = [name for name in requested_metrics if name not in supported_names]
        score_results = asyncio.run(_score_ragas_items(items, ragas_metrics, category))
        results: list[EvaluationItemResult] = []
        for item, (metrics, metric_errors) in zip(items, score_results, strict=True):
            errors: list[str] = []
            for name in unsupported_names:
                failure = new_public_evaluation_error(EvaluationErrorCode.UNSUPPORTED_METRIC)
                logger.info(
                    "RAGAS metric %s is unsupported for item %d (error_id=%s)", name, item.index, failure.error_id
                )
                errors.append(failure.text)
            errors.extend(metric_errors)
            results.append(
                EvaluationItemResult(
                    index=item.index,
                    metrics=metrics,
                    actual_output=item.output,
                    error="; ".join(errors) if errors else None,
                )
            )
        return results

    @staticmethod
    def _build_ragas_metrics(requested_metrics: list[str], model_wrapper: Any, embeddings_wrapper: Any) -> list[Any]:
        """Build modern Ragas metrics from canonical Evaluation names."""
        try:
            metrics_module = _import_ragas_metrics_module()

            ragas_class_map: dict[str, Any] = {
                EvaluationMetricName.FAITHFULNESS: metrics_module.Faithfulness,
                EvaluationMetricName.ANSWER_RELEVANCY: metrics_module.AnswerRelevancy,
                EvaluationMetricName.ANSWER_CORRECTNESS: metrics_module.AnswerCorrectness,
                EvaluationMetricName.SEMANTIC_SIMILARITY: metrics_module.SemanticSimilarity,
                EvaluationMetricName.CONTEXT_PRECISION: metrics_module.ContextPrecisionWithReference,
                EvaluationMetricName.CONTEXT_RECALL: metrics_module.ContextRecall,
                EvaluationMetricName.CONTEXT_RELEVANCE: metrics_module.ContextRelevance,
            }

            metrics = []
            for name in requested_metrics:
                metric_class = ragas_class_map.get(name)
                if metric_class:
                    kwargs: dict[str, Any] = {"name": name}
                    if name != EvaluationMetricName.SEMANTIC_SIMILARITY:
                        kwargs["llm"] = model_wrapper
                    if name in _RAGAS_EMBEDDING_METRICS:
                        kwargs["embeddings"] = (
                            embeddings_wrapper.for_answer_relevancy()
                            if name == EvaluationMetricName.ANSWER_RELEVANCY
                            else embeddings_wrapper
                        )
                    metrics.append(metric_class(**kwargs))
                else:
                    logger.warning("Metric '%s' is not supported by RAGAS, skipping", name)
            return metrics
        except ImportError as exc:
            raise RuntimeError("RAGAS is not installed in the evaluation worker") from exc


def _import_ragas_metrics_module() -> Any:
    """Load the metrics API used by the pinned Ragas release."""
    return import_module("ragas.metrics.collections")


def _load_ragas_agent_components() -> RagasAgentComponents:
    from ragas.messages import AIMessage, HumanMessage, ToolCall
    from ragas.metrics.collections import ToolCallAccuracy

    return RagasAgentComponents(
        AIMessage=AIMessage,
        HumanMessage=HumanMessage,
        ToolCall=ToolCall,
        ToolCallAccuracy=ToolCallAccuracy,
    )


async def _score_ragas_metric(metric: Any, kwargs: dict[str, Any]) -> Any:
    """Bound each score attempt and retry only transient provider failures."""
    for attempt in range(_RAGAS_METRIC_RETRIES):
        try:
            return await asyncio.wait_for(metric.ascore(**kwargs), timeout=_RAGAS_METRIC_TIMEOUT_SECONDS)
        except _RAGAS_RETRYABLE_EXCEPTIONS:
            if attempt == _RAGAS_METRIC_RETRIES - 1:
                raise
            await asyncio.sleep(min(2**attempt, 60))
    raise AssertionError("RAGAS metric retry loop ended without a result")


async def _score_ragas_items(
    items: list[EvaluationItemInput], metrics: list[Any], category: EvaluationCategory
) -> list[tuple[list[EvaluationMetric], list[str]]]:
    """Score rows with bounded concurrency while preserving input and metric order.

    Precondition: each requested metric has a declared Ragas field mapping.
    Postcondition: a missing text context fails only metrics requiring it;
    other row metrics still score, and no provider request uses empty evidence.
    """
    semaphore = asyncio.Semaphore(_RAGAS_MAX_WORKERS)

    async def score_one(item_index: int, metric: Any) -> tuple[int, EvaluationMetric | None, str | None]:
        item = items[item_index]
        fields = _RAGAS_METRIC_FIELDS[metric.name]
        if "retrieved_contexts" in fields and not any(context.strip() for context in item.context or []):
            failure = new_public_evaluation_error(EvaluationErrorCode.CONTEXT_MISSING)
            logger.info(
                "RAGAS metric %s has no usable text context for item %d (error_id=%s)",
                metric.name,
                item.index,
                failure.error_id,
            )
            return item_index, None, failure.text
        inputs = {
            "user_input": _format_input(item.inputs, category),
            "response": item.output,
            "reference": item.expected_output or "",
            "retrieved_contexts": item.context or [],
        }
        kwargs = {field: inputs[field] for field in fields}
        async with semaphore:
            try:
                with use_plugin_daemon_request_timeout(_RAGAS_METRIC_TIMEOUT_SECONDS):
                    result = await _score_ragas_metric(metric, kwargs)
                score = float(result.value)
                if not math.isfinite(score):
                    raise ValueError(f"RAGAS returned a non-finite score: {score}")
                return item_index, EvaluationMetric(name=metric.name, value=score), None
            except Exception:
                failure = new_public_evaluation_error(EvaluationErrorCode.METRIC_FAILED)
                logger.exception(
                    "RAGAS metric %s failed for item %d (error_id=%s)", metric.name, item.index, failure.error_id
                )
                return item_index, None, failure.text

    outcomes = await asyncio.gather(*(score_one(index, metric) for index in range(len(items)) for metric in metrics))
    scored: list[tuple[list[EvaluationMetric], list[str]]] = [([], []) for _ in items]
    for index, metric, error in outcomes:
        if metric is not None:
            scored[index][0].append(metric)
        if error is not None:
            scored[index][1].append(error)
    return scored


def _format_input(inputs: dict[str, Any], category: EvaluationCategory) -> str:
    """Extract the user-facing input string from the inputs dict."""
    match category:
        case EvaluationCategory.LLM | EvaluationCategory.WORKFLOW:
            return str(inputs.get("prompt", ""))
        case EvaluationCategory.RETRIEVAL:
            return str(inputs.get("query", ""))
        case EvaluationCategory.AGENT:
            return str(inputs.get("task", ""))
        case _:
            return str(next(iter(inputs.values()), "")) if inputs else ""
