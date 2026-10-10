"""Contract tests for the pinned RAGAS adapter."""

from types import SimpleNamespace

import pytest

from core.evaluation.entities.config_entity import RagasConfig
from core.evaluation.entities.evaluation_entity import AgentEvaluationItem, AgentToolCall, EvaluationCategory
from core.evaluation.frameworks.ragas.ragas_evaluator import RagasEvaluator


class _FakeRagasData:
    def __init__(self, **kwargs: object) -> None:
        self.__dict__.update(kwargs)


class _FakeToolCallAccuracy:
    def __init__(self, *, name: str) -> None:
        self.name = name

    def multi_turn_score(self, sample: _FakeRagasData) -> float:
        actual_calls = sample.user_input[1].tool_calls
        expected_calls = sample.reference_tool_calls
        return float(
            [(call.name, call.args) for call in actual_calls] == [(call.name, call.args) for call in expected_calls]
        )


def _fake_agent_components() -> SimpleNamespace:
    return SimpleNamespace(
        AIMessage=_FakeRagasData,
        HumanMessage=_FakeRagasData,
        MultiTurnSample=_FakeRagasData,
        ToolCall=_FakeRagasData,
        ToolCallAccuracy=_FakeToolCallAccuracy,
    )


def test_supported_metrics_cover_all_ragas_llm_and_retrieval_metrics() -> None:
    evaluator = RagasEvaluator(RagasConfig())

    assert evaluator.get_supported_metrics(EvaluationCategory.LLM) == [
        "faithfulness",
        "answer_relevancy",
        "answer_correctness",
        "semantic_similarity",
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
        "tool_call_accuracy",
    ]
    assert evaluator.metric_requires_expected_tool_calls("tool_call_accuracy") is True
    assert evaluator.metric_requires_expected_tool_calls("argument_correctness") is False


def test_build_ragas_metrics_preserves_canonical_names(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeMetric:
        def __init__(self, *, name: str, **kwargs: object) -> None:
            self.name = name
            for key, value in kwargs.items():
                setattr(self, key, value)

    metrics_module = SimpleNamespace(
        Faithfulness=FakeMetric,
        AnswerRelevancy=FakeMetric,
        AnswerCorrectness=FakeMetric,
        SemanticSimilarity=FakeMetric,
        ContextPrecision=FakeMetric,
        ContextRecall=FakeMetric,
        ContextRelevance=FakeMetric,
    )
    monkeypatch.setattr(
        "core.evaluation.frameworks.ragas.ragas_evaluator._import_ragas_metrics_module",
        lambda: metrics_module,
    )

    embeddings = object()
    metrics = RagasEvaluator._build_ragas_metrics(
        ["faithfulness", "answer_relevancy", "answer_correctness", "context_relevance", "semantic_similarity"],
        embeddings,
    )

    assert [metric.name for metric in metrics] == [
        "faithfulness",
        "answer_relevancy",
        "answer_correctness",
        "context_relevance",
        "semantic_similarity",
    ]
    assert metrics[1].embeddings is embeddings
    assert metrics[2].embeddings is embeddings
    assert metrics[4].embeddings is embeddings


def test_tool_call_accuracy_uses_reference_trace_without_llm_judge(monkeypatch: pytest.MonkeyPatch) -> None:
    evaluator = RagasEvaluator(RagasConfig())
    tool_call = AgentToolCall(name="weather", arguments={"city": "Paris"}, output="sunny")
    monkeypatch.setattr(
        "core.evaluation.frameworks.ragas.ragas_evaluator._load_ragas_agent_components",
        _fake_agent_components,
    )

    results = evaluator.evaluate_agent(
        [
            AgentEvaluationItem(
                index=9,
                inputs={"task": "Check the weather in Paris"},
                output="It is sunny.",
                tool_calls=[tool_call],
                expected_tool_calls=[AgentToolCall(name="weather", arguments={"city": "Paris"})],
            )
        ],
        ["tool_call_accuracy"],
        "unused-provider",
        "unused-model",
        "tenant-1",
    )

    assert results[0].index == 9
    assert results[0].actual_output == "It is sunny."
    assert results[0].error is None
    assert results[0].metrics[0].name == "tool_call_accuracy"
    assert results[0].metrics[0].value == 1.0


def test_tool_call_accuracy_requires_reference_tool_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(
        "core.evaluation.frameworks.ragas.ragas_evaluator._load_ragas_agent_components",
        _fake_agent_components,
    )

    results = evaluator.evaluate_agent(
        [
            AgentEvaluationItem(
                index=3,
                inputs={"task": "Check the weather"},
                output="done",
                tool_calls=[AgentToolCall(name="weather", arguments={"city": "Paris"})],
            )
        ],
        ["tool_call_accuracy"],
        "unused-provider",
        "unused-model",
        "tenant-1",
    )

    assert results[0].metrics == []
    assert "requires non-empty expected_tool_calls" in (results[0].error or "")
