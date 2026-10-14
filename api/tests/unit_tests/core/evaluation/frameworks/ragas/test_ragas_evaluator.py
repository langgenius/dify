"""Contract tests for the pinned RAGAS adapter."""

import sys
from types import ModuleType, SimpleNamespace
from typing import TYPE_CHECKING, cast

import pytest

from core.evaluation.entities.config_entity import RagasConfig
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolCall,
    EvaluationCategory,
    EvaluationItemInput,
)
from core.evaluation.frameworks.ragas.ragas_evaluator import RagasEvaluator
from core.plugin.impl.exc import PluginInvokeError
from graphon.model_runtime.errors.invoke import (
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)

if TYPE_CHECKING:
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper


class _FakeRagasData:
    user_input: list["_FakeRagasData"]
    reference_tool_calls: list["_FakeRagasData"]
    tool_calls: list["_FakeRagasData"]
    name: str
    args: dict[str, object]

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


def test_evaluate_with_ragas_uses_bounded_transient_retry_config(monkeypatch: pytest.MonkeyPatch) -> None:
    import pandas as pd

    captured: dict[str, object] = {}

    def fake_evaluate(**kwargs: object) -> SimpleNamespace:
        captured.update(kwargs)
        return SimpleNamespace(to_pandas=lambda: pd.DataFrame({"answer_relevancy": [0.75]}))

    ragas_module = ModuleType("ragas")
    ragas_module.__path__ = []
    ragas_module.__dict__["evaluate"] = fake_evaluate
    dataset_schema_module = ModuleType("ragas.dataset_schema")
    dataset_schema_module.__dict__["EvaluationDataset"] = lambda samples: SimpleNamespace(samples=samples)
    run_config_module = ModuleType("ragas.run_config")
    run_config_module.__dict__["RunConfig"] = lambda **kwargs: SimpleNamespace(**kwargs)
    monkeypatch.setitem(sys.modules, "ragas", ragas_module)
    monkeypatch.setitem(sys.modules, "ragas.dataset_schema", dataset_schema_module)
    monkeypatch.setitem(sys.modules, "ragas.run_config", run_config_module)

    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(evaluator, "_build_sample", lambda *_args: object())
    monkeypatch.setattr(evaluator, "_build_ragas_metrics", lambda *_args: [object()])

    results = evaluator._evaluate_with_ragas(
        [EvaluationItemInput(index=0, inputs={"prompt": "question"}, output="answer")],
        ["answer_relevancy"],
        cast("DifyModelWrapper", object()),
        object(),
        EvaluationCategory.LLM,
    )

    run_config = cast(SimpleNamespace, captured["run_config"])
    assert run_config.timeout == 120
    assert run_config.exception_types == (
        InvokeConnectionError,
        InvokeRateLimitError,
        InvokeServerUnavailableError,
    )
    assert not any(issubclass(PluginInvokeError, exception_type) for exception_type in run_config.exception_types)
    assert results[0].metrics[0].value == 0.75


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
