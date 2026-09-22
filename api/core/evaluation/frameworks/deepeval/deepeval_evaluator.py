from __future__ import annotations

import logging
import math
from collections.abc import Sequence
from types import SimpleNamespace
from typing import Any, override

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import DeepEvalConfig
from core.evaluation.entities.evaluation_entity import (
    AGENT_METRIC_NAMES,
    LLM_METRIC_NAMES,
    RETRIEVAL_METRIC_NAMES,
    WORKFLOW_METRIC_NAMES,
    AgentEvaluationItem,
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
    EvaluationMetricName,
)
from core.evaluation.frameworks.deepeval.deepeval_model_wrapper import DifyDeepEvalModel

logger = logging.getLogger(__name__)

_DEEPEVAL_METRICS = {
    EvaluationMetricName.FAITHFULNESS.value,
    EvaluationMetricName.ANSWER_RELEVANCY.value,
    EvaluationMetricName.ANSWER_CORRECTNESS.value,
    EvaluationMetricName.CONTEXT_PRECISION.value,
    EvaluationMetricName.CONTEXT_RECALL.value,
    EvaluationMetricName.CONTEXT_RELEVANCE.value,
    EvaluationMetricName.ARGUMENT_CORRECTNESS.value,
}

_DEEPEVAL_REFERENCE_METRICS = {
    EvaluationMetricName.ANSWER_CORRECTNESS.value,
    EvaluationMetricName.CONTEXT_PRECISION.value,
    EvaluationMetricName.CONTEXT_RECALL.value,
}

_ANSWER_CORRECTNESS_STEPS = [
    "Compare the actual output with the expected output and identify factual contradictions.",
    "Check whether the actual output covers the key information present in the expected output.",
    "Ignore harmless differences in wording or presentation that do not change the meaning.",
    "Assign a higher score when the actual output is both factually correct and complete.",
]


class DeepEvalEvaluator(BaseEvaluationInstance):
    """DeepEval adapter using Dify's configured evaluation model as the judge."""

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
        return [metric.value for metric in candidates if metric.value in _DEEPEVAL_METRICS]

    @override
    def metric_requires_expected_output(self, metric_name: str) -> bool:
        return metric_name in _DEEPEVAL_REFERENCE_METRICS

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
        return self._evaluate(
            items,
            metric_names,
            model_provider,
            model_name,
            tenant_id,
            EvaluationCategory.RETRIEVAL,
        )

    def evaluate_agent(
        self,
        items: list[AgentEvaluationItem],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(
            items,
            metric_names,
            model_provider,
            model_name,
            tenant_id,
            EvaluationCategory.AGENT,
        )

    def evaluate_workflow(
        self,
        items: list[EvaluationItemInput],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate(
            items,
            metric_names,
            model_provider,
            model_name,
            tenant_id,
            EvaluationCategory.WORKFLOW,
        )

    def _evaluate(
        self,
        items: Sequence[EvaluationItemInput],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
        category: EvaluationCategory,
    ) -> list[EvaluationItemResult]:
        requested_metrics = metric_names or self.get_supported_metrics(category)
        category_metrics = set(self.get_supported_metrics(category))
        supported_metrics = [name for name in requested_metrics if name in category_metrics]
        unsupported_metrics = [name for name in requested_metrics if name not in category_metrics]
        if not supported_metrics:
            raise ValueError(f"DeepEval does not support any requested metrics: {requested_metrics}")

        components = _load_deepeval_components()
        model: DifyDeepEvalModel | None = None
        results: list[EvaluationItemResult] = []
        for item in items:
            errors = [f"Metric '{name}' is not supported by DeepEval." for name in unsupported_metrics]
            if category == EvaluationCategory.AGENT and isinstance(item, AgentEvaluationItem) and not item.tool_calls:
                results.append(
                    EvaluationItemResult(
                        index=item.index,
                        actual_output=item.output,
                        metrics=[
                            EvaluationMetric(
                                name=EvaluationMetricName.ARGUMENT_CORRECTNESS.value,
                                value=None,
                                details={
                                    "status": "not_applicable",
                                    "reason": "The Agent did not call any tools for this dataset row.",
                                },
                            )
                        ],
                        error="; ".join(errors) if errors else None,
                    )
                )
                continue

            if model is None:
                model = DifyDeepEvalModel(model_provider, model_name, tenant_id)
            metrics: list[EvaluationMetric] = []
            test_case = _build_test_case(item, category, components)
            for canonical_name, metric in _build_deepeval_metrics(supported_metrics, model, components):
                try:
                    measured_score = metric.measure(test_case, _show_indicator=False)
                    score = getattr(metric, "score", measured_score)
                    numeric_score = float(score)
                    if not math.isfinite(numeric_score):
                        raise ValueError(f"DeepEval returned a non-finite score: {score}")
                    details: dict[str, Any] = {}
                    reason = getattr(metric, "reason", None)
                    if reason:
                        details["reason"] = str(reason)
                    metrics.append(EvaluationMetric(name=canonical_name, value=numeric_score, details=details))
                except Exception as exc:
                    logger.exception("DeepEval metric %s failed for item %d", canonical_name, item.index)
                    errors.append(f"Metric '{canonical_name}' failed: {exc}")

            results.append(
                EvaluationItemResult(
                    index=item.index,
                    actual_output=item.output,
                    metrics=metrics,
                    error="; ".join(errors) if errors else None,
                )
            )
        return results


def _load_deepeval_components() -> SimpleNamespace:
    from deepeval.metrics import (
        AnswerRelevancyMetric,
        ArgumentCorrectnessMetric,
        ContextualPrecisionMetric,
        ContextualRecallMetric,
        ContextualRelevancyMetric,
        FaithfulnessMetric,
        GEval,
    )
    from deepeval.test_case import LLMTestCase, SingleTurnParams, ToolCall

    return SimpleNamespace(
        AnswerRelevancyMetric=AnswerRelevancyMetric,
        ArgumentCorrectnessMetric=ArgumentCorrectnessMetric,
        ContextualPrecisionMetric=ContextualPrecisionMetric,
        ContextualRecallMetric=ContextualRecallMetric,
        ContextualRelevancyMetric=ContextualRelevancyMetric,
        FaithfulnessMetric=FaithfulnessMetric,
        GEval=GEval,
        LLMTestCase=LLMTestCase,
        SingleTurnParams=SingleTurnParams,
        ToolCall=ToolCall,
    )


def _build_deepeval_metrics(
    requested_metrics: list[str],
    model: DifyDeepEvalModel,
    components: SimpleNamespace,
) -> list[tuple[str, Any]]:
    """Build fresh stateful metric instances for one dataset item."""
    standard_metric_classes = {
        EvaluationMetricName.FAITHFULNESS.value: components.FaithfulnessMetric,
        EvaluationMetricName.ANSWER_RELEVANCY.value: components.AnswerRelevancyMetric,
        EvaluationMetricName.CONTEXT_PRECISION.value: components.ContextualPrecisionMetric,
        EvaluationMetricName.CONTEXT_RECALL.value: components.ContextualRecallMetric,
        EvaluationMetricName.CONTEXT_RELEVANCE.value: components.ContextualRelevancyMetric,
    }
    metrics: list[tuple[str, Any]] = []
    for name in requested_metrics:
        if name == EvaluationMetricName.ANSWER_CORRECTNESS.value:
            metric = components.GEval(
                name="Answer Correctness",
                evaluation_params=[
                    components.SingleTurnParams.INPUT,
                    components.SingleTurnParams.ACTUAL_OUTPUT,
                    components.SingleTurnParams.EXPECTED_OUTPUT,
                ],
                evaluation_steps=_ANSWER_CORRECTNESS_STEPS,
                model=model,
                threshold=None,
                async_mode=False,
                verbose_mode=False,
                _include_g_eval_suffix=False,
            )
        elif name == EvaluationMetricName.ARGUMENT_CORRECTNESS.value:
            metric = components.ArgumentCorrectnessMetric(
                model=model,
                threshold=None,
                include_reason=True,
                async_mode=False,
                verbose_mode=False,
            )
        else:
            metric_class = standard_metric_classes.get(name)
            if metric_class is None:
                continue
            metric = metric_class(
                model=model,
                threshold=None,
                include_reason=True,
                async_mode=False,
                verbose_mode=False,
            )
        metrics.append((name, metric))
    return metrics


def _build_test_case(
    item: EvaluationItemInput,
    category: EvaluationCategory,
    components: SimpleNamespace,
) -> Any:
    if category == EvaluationCategory.AGENT:
        if not isinstance(item, AgentEvaluationItem):
            raise TypeError("Agent evaluation requires AgentEvaluationItem inputs.")
        return components.LLMTestCase(
            input=_format_input(item.inputs, category),
            actual_output=item.output,
            tools_called=[
                components.ToolCall(
                    name=tool_call.name,
                    input_parameters=tool_call.arguments,
                    output=tool_call.output,
                )
                for tool_call in item.tool_calls
            ],
        )
    return components.LLMTestCase(
        input=_format_input(item.inputs, category),
        actual_output=item.output,
        expected_output=item.expected_output,
        retrieval_context=item.context,
    )


def _format_input(inputs: dict[str, Any], category: EvaluationCategory) -> str:
    match category:
        case EvaluationCategory.LLM | EvaluationCategory.WORKFLOW:
            return str(inputs.get("prompt", ""))
        case EvaluationCategory.RETRIEVAL:
            return str(inputs.get("query", ""))
        case EvaluationCategory.AGENT:
            return str(inputs.get("task", ""))
        case _:
            return str(next(iter(inputs.values()), "")) if inputs else ""
