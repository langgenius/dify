from types import SimpleNamespace
from typing import cast

import pytest

from core.evaluation.entities.config_entity import DeepEvalConfig
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolCall,
    EvaluationCategory,
    EvaluationItemInput,
)
from core.evaluation.frameworks.deepeval.deepeval_evaluator import (
    DeepEvalEvaluator,
    _build_deepeval_metrics,
    _build_test_case,
    _load_deepeval_components,
)
from core.evaluation.frameworks.deepeval.deepeval_model_wrapper import DifyDeepEvalModel


class _FakeParam:
    INPUT = "input"
    ACTUAL_OUTPUT = "actual_output"
    EXPECTED_OUTPUT = "expected_output"


class _FakeTestCase:
    def __init__(self, **kwargs: object) -> None:
        self.__dict__.update(kwargs)


class _FakeToolCall(_FakeTestCase):
    pass


class _FakeMetric:
    def __init__(self, **kwargs: object) -> None:
        self.kwargs = kwargs
        self.score: float | None = None
        self.reason: str | None = None

    def measure(self, test_case: _FakeTestCase, *, _show_indicator: bool) -> float:
        assert _show_indicator is False
        assert test_case.actual_output == "Paris"
        self.score = 0.875
        self.reason = "The response matches the supplied evidence."
        return self.score


def _fake_components() -> SimpleNamespace:
    return SimpleNamespace(
        AnswerRelevancyMetric=_FakeMetric,
        ArgumentCorrectnessMetric=_FakeMetric,
        ContextualPrecisionMetric=_FakeMetric,
        ContextualRecallMetric=_FakeMetric,
        ContextualRelevancyMetric=_FakeMetric,
        FaithfulnessMetric=_FakeMetric,
        GEval=_FakeMetric,
        LLMTestCase=_FakeTestCase,
        SingleTurnParams=_FakeParam,
        ToolCall=_FakeToolCall,
    )


def test_supported_metrics_use_native_deepeval_coverage() -> None:
    evaluator = DeepEvalEvaluator(DeepEvalConfig())

    assert evaluator.get_supported_metrics(EvaluationCategory.LLM) == [
        "faithfulness",
        "answer_relevancy",
        "answer_correctness",
    ]
    assert evaluator.get_supported_metrics(EvaluationCategory.RETRIEVAL) == [
        "context_precision",
        "context_recall",
        "context_relevance",
    ]
    assert evaluator.get_supported_metrics(EvaluationCategory.AGENT) == [
        "task_completion",
        "trajectory_quality",
        "tool_selection_correctness",
        "tool_argument_correctness",
        "argument_correctness",
    ]
    assert evaluator.metric_requires_embeddings("answer_relevancy") is False
    assert evaluator.metric_requires_expected_output("answer_correctness") is True
    assert evaluator.metric_requires_expected_output("context_relevance") is False


def test_metric_factory_always_injects_dify_model_and_score_only_threshold() -> None:
    model = cast(DifyDeepEvalModel, object())
    components = _fake_components()

    metrics = _build_deepeval_metrics(
        ["faithfulness", "answer_correctness", "context_relevance", "argument_correctness"],
        model,
        components,
    )

    assert [name for name, _ in metrics] == [
        "faithfulness",
        "answer_correctness",
        "context_relevance",
        "argument_correctness",
    ]
    for _, metric in metrics:
        assert metric.kwargs["model"] is model
        assert metric.kwargs["threshold"] is None
        assert metric.kwargs["async_mode"] is False
        assert metric.kwargs["verbose_mode"] is False
    assert metrics[1][1].kwargs["evaluation_params"] == ["input", "actual_output", "expected_output"]
    assert metrics[1][1].kwargs["evaluation_steps"]


def test_metric_factory_matches_pinned_deepeval_api() -> None:
    model = object.__new__(DifyDeepEvalModel)
    model.model_provider = "provider"
    model.dify_model_name = "judge-model"

    metrics = _build_deepeval_metrics(
        [
            "faithfulness",
            "answer_relevancy",
            "answer_correctness",
            "context_precision",
            "context_recall",
            "context_relevance",
            "argument_correctness",
        ],
        model,
        _load_deepeval_components(),
    )

    assert [name for name, _ in metrics] == [
        "faithfulness",
        "answer_relevancy",
        "answer_correctness",
        "context_precision",
        "context_recall",
        "context_relevance",
        "argument_correctness",
    ]
    assert all(metric.model is model for _, metric in metrics)
    assert all(metric.threshold is None for _, metric in metrics)
    assert all(metric.async_mode is False for _, metric in metrics)


def test_evaluation_records_deepeval_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    evaluator = DeepEvalEvaluator(DeepEvalConfig())
    model = object()
    monkeypatch.setattr(
        "core.evaluation.frameworks.deepeval.deepeval_evaluator.DifyDeepEvalModel",
        lambda *_args: model,
    )
    monkeypatch.setattr(
        "core.evaluation.frameworks.deepeval.deepeval_evaluator._load_deepeval_components",
        _fake_components,
    )

    results = evaluator.evaluate_llm(
        [
            EvaluationItemInput(
                index=7,
                inputs={"prompt": "What is the capital of France?"},
                output="Paris",
                expected_output="Paris",
                context=["Paris is the capital of France."],
            )
        ],
        ["faithfulness"],
        "provider",
        "model",
        "tenant",
    )

    assert len(results) == 1
    assert results[0].index == 7
    assert results[0].actual_output == "Paris"
    assert results[0].error is None
    assert results[0].metrics[0].name == "faithfulness"
    assert results[0].metrics[0].value == 0.875
    assert results[0].metrics[0].details == {"reason": "The response matches the supplied evidence."}


def test_semantic_similarity_is_explicitly_unsupported() -> None:
    evaluator = DeepEvalEvaluator(DeepEvalConfig())

    with pytest.raises(ValueError, match="does not support any requested metrics"):
        evaluator.evaluate_llm([], ["semantic_similarity"], "provider", "model", "tenant")


def test_agent_test_case_maps_framework_neutral_tool_calls() -> None:
    test_case = _build_test_case(
        AgentEvaluationItem(
            index=0,
            inputs={"task": "Find the current time in Shanghai"},
            output="It is 18:00.",
            tool_calls=[
                AgentToolCall(
                    name="current_time",
                    arguments={"timezone": "Asia/Shanghai"},
                    output="18:00",
                )
            ],
        ),
        EvaluationCategory.AGENT,
        _fake_components(),
    )

    assert test_case.input == "Find the current time in Shanghai"
    assert test_case.actual_output == "It is 18:00."
    assert test_case.tools_called[0].name == "current_time"
    assert test_case.tools_called[0].input_parameters == {"timezone": "Asia/Shanghai"}
    assert test_case.tools_called[0].output == "18:00"


def test_argument_correctness_without_tool_calls_is_not_applicable(monkeypatch: pytest.MonkeyPatch) -> None:
    evaluator = DeepEvalEvaluator(DeepEvalConfig())
    monkeypatch.setattr(
        "core.evaluation.frameworks.deepeval.deepeval_evaluator.DifyDeepEvalModel",
        lambda *_args: object(),
    )
    monkeypatch.setattr(
        "core.evaluation.frameworks.deepeval.deepeval_evaluator._load_deepeval_components",
        _fake_components,
    )

    results = evaluator.evaluate_agent(
        [
            AgentEvaluationItem(
                index=4,
                inputs={"task": "Answer without tools"},
                output="Paris",
                tool_calls=[],
            )
        ],
        ["argument_correctness"],
        "provider",
        "model",
        "tenant",
    )

    assert results[0].error is None
    assert results[0].metrics[0].name == "argument_correctness"
    assert results[0].metrics[0].value is None
    assert results[0].metrics[0].details["status"] == "not_applicable"
