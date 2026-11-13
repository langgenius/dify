"""Contract tests for the pinned RAGAS adapter."""

import sys
from dataclasses import dataclass
from types import ModuleType

import pytest

from core.evaluation.agent.agent_judge_evaluator import AgentLLMJudgeEvaluator
from core.evaluation.entities.config_entity import RagasConfig
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    AgentToolCall,
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
)
from core.evaluation.frameworks.ragas.ragas_evaluator import (
    RagasAgentComponents,
    RagasEvaluator,
    _import_ragas_metrics_module,
)
from core.plugin.impl.exc import PluginInvokeError
from graphon.model_runtime.errors.invoke import (
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)


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


def _fake_agent_components() -> RagasAgentComponents:
    return RagasAgentComponents(
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

    metrics_module = ModuleType("ragas.metrics")
    for name in (
        "Faithfulness",
        "AnswerRelevancy",
        "AnswerCorrectness",
        "SemanticSimilarity",
        "ContextPrecision",
        "ContextRecall",
        "ContextRelevance",
    ):
        setattr(metrics_module, name, FakeMetric)
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

    @dataclass
    class FakeEvaluationDataset:
        samples: list[object]

    @dataclass
    class FakeRunConfig:
        timeout: int
        exception_types: tuple[type[Exception], ...]

    class FakeEvaluationResult:
        def to_pandas(self) -> pd.DataFrame:
            return pd.DataFrame({"answer_relevancy": [0.75]})

    captured: dict[str, object] = {}

    def fake_evaluate(**kwargs: object) -> FakeEvaluationResult:
        captured.update(kwargs)
        return FakeEvaluationResult()

    ragas_module = ModuleType("ragas")
    ragas_module.__path__ = []
    ragas_module.__dict__["evaluate"] = fake_evaluate
    dataset_schema_module = ModuleType("ragas.dataset_schema")
    dataset_schema_module.__dict__["EvaluationDataset"] = FakeEvaluationDataset
    run_config_module = ModuleType("ragas.run_config")
    run_config_module.__dict__["RunConfig"] = FakeRunConfig
    monkeypatch.setitem(sys.modules, "ragas", ragas_module)
    monkeypatch.setitem(sys.modules, "ragas.dataset_schema", dataset_schema_module)
    monkeypatch.setitem(sys.modules, "ragas.run_config", run_config_module)

    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(evaluator, "_build_sample", lambda *_args: object())
    monkeypatch.setattr(evaluator, "_build_ragas_metrics", lambda *_args: [object()])

    results = evaluator._evaluate_with_ragas(
        [EvaluationItemInput(index=0, inputs={"prompt": "question"}, output="answer")],
        ["answer_relevancy"],
        object(),  # pyrefly: ignore[bad-argument-type] -- the stubbed RAGAS evaluator only forwards this value
        object(),
        EvaluationCategory.LLM,
    )

    run_config = captured["run_config"]
    assert isinstance(run_config, FakeRunConfig)
    assert run_config.timeout == 180
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


@pytest.mark.parametrize(
    ("category", "expected_fields"),
    [
        (
            EvaluationCategory.LLM,
            {
                "user_input": "question",
                "response": "answer",
                "reference": "expected",
                "retrieved_contexts": ["context"],
            },
        ),
        (
            EvaluationCategory.RETRIEVAL,
            {"user_input": "query", "reference": "expected", "retrieved_contexts": ["context"]},
        ),
        (EvaluationCategory.WORKFLOW, {"user_input": "question", "response": "answer"}),
    ],
)
def test_build_sample_passes_category_fields_to_ragas(
    monkeypatch: pytest.MonkeyPatch,
    category: EvaluationCategory,
    expected_fields: dict[str, object],
) -> None:
    ragas_module = ModuleType("ragas")
    ragas_module.__path__ = []
    schema_module = ModuleType("ragas.dataset_schema")
    schema_module.__dict__["SingleTurnSample"] = _FakeRagasData
    monkeypatch.setitem(sys.modules, "ragas", ragas_module)
    monkeypatch.setitem(sys.modules, "ragas.dataset_schema", schema_module)

    sample = RagasEvaluator._build_sample(
        EvaluationItemInput(
            index=1,
            inputs={"prompt": "question", "query": "query"},
            output="answer",
            expected_output="expected",
            context=["context"],
        ),
        category,
    )

    assert sample.__dict__ == expected_fields


def test_import_ragas_metrics_falls_back_to_collections(monkeypatch: pytest.MonkeyPatch) -> None:
    collections = ModuleType("ragas.metrics.collections")
    requested: list[str] = []

    def import_metric_module(name: str) -> ModuleType:
        requested.append(name)
        if name == "ragas.metrics":
            raise ImportError("metric classes moved")
        return collections

    monkeypatch.setattr("core.evaluation.frameworks.ragas.ragas_evaluator.import_module", import_metric_module)

    assert _import_ragas_metrics_module() is collections
    assert requested == ["ragas.metrics", "ragas.metrics.collections"]


def test_agent_evaluation_merges_native_judge_and_reference_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    evaluator = RagasEvaluator(RagasConfig())
    item = AgentEvaluationItem(
        index=4,
        inputs={"task": "Check Paris weather"},
        output="Sunny",
        tool_calls=[AgentToolCall(name="weather", arguments={"city": "Paris"})],
        expected_tool_calls=[AgentToolCall(name="weather", arguments={"city": "Paris"})],
    )
    monkeypatch.setattr(
        "core.evaluation.frameworks.ragas.ragas_evaluator._load_ragas_agent_components",
        _fake_agent_components,
    )
    monkeypatch.setattr(
        AgentLLMJudgeEvaluator,
        "evaluate",
        lambda *_args: [
            EvaluationItemResult(
                index=4,
                actual_output="Sunny",
                metrics=[EvaluationMetric(name="task_completion", value=0.8)],
            )
        ],
    )

    results = evaluator.evaluate_agent(
        [item],
        ["task_completion", "tool_call_accuracy", "unsupported_metric"],
        "unused-provider",
        "unused-model",
        "tenant-1",
    )

    assert [metric.name for metric in results[0].metrics] == ["task_completion", "tool_call_accuracy"]
    assert [metric.value for metric in results[0].metrics] == [0.8, 1.0]
    assert "unsupported_metric" in (results[0].error or "")


def test_ragas_agent_metric_rejects_non_finite_reference_score(monkeypatch: pytest.MonkeyPatch) -> None:
    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(
        "core.evaluation.frameworks.ragas.ragas_evaluator._load_ragas_agent_components",
        _fake_agent_components,
    )
    monkeypatch.setattr(_FakeToolCallAccuracy, "multi_turn_score", lambda *_args: float("inf"))

    result = evaluator.evaluate_agent(
        [
            AgentEvaluationItem(
                index=3,
                inputs={"task": "Check the weather"},
                output="Sunny",
                tool_calls=[AgentToolCall(name="weather", arguments={"city": "Paris"})],
                expected_tool_calls=[AgentToolCall(name="weather", arguments={"city": "Paris"})],
            )
        ],
        ["tool_call_accuracy"],
        "provider",
        "model",
        "tenant",
    )[0]

    assert result.metrics == []
    assert "non-finite score" in (result.error or "")


def test_ragas_rejects_agent_metric_with_no_supported_evaluator() -> None:
    with pytest.raises(ValueError, match="does not support any requested Agent metrics"):
        RagasEvaluator(RagasConfig()).evaluate_agent([], ["unsupported_metric"], "provider", "model", "tenant")


def test_ragas_metric_loader_reports_missing_package(monkeypatch: pytest.MonkeyPatch) -> None:
    def missing_metrics() -> None:
        raise ImportError("ragas unavailable")

    monkeypatch.setattr(
        "core.evaluation.frameworks.ragas.ragas_evaluator._import_ragas_metrics_module", missing_metrics
    )

    with pytest.raises(RuntimeError, match="not installed in the evaluation worker"):
        RagasEvaluator._build_ragas_metrics(["faithfulness"], object())


def test_ragas_category_calls_use_tenant_scoped_wrappers(monkeypatch: pytest.MonkeyPatch) -> None:
    @dataclass
    class FakeModelWrapper:
        model_provider: str
        model_name: str
        tenant_id: str

    model_wrapper_module = ModuleType("core.evaluation.frameworks.ragas.ragas_model_wrapper")
    model_wrapper_module.__dict__["DifyModelWrapper"] = FakeModelWrapper
    monkeypatch.setitem(sys.modules, model_wrapper_module.__name__, model_wrapper_module)

    evaluator = RagasEvaluator(RagasConfig())
    categories: list[EvaluationCategory] = []

    def evaluate_with_ragas(
        items: list[EvaluationItemInput],
        metrics: list[str],
        model_wrapper: object,
        embeddings_wrapper: object,
        category: EvaluationCategory,
    ) -> list[EvaluationItemResult]:
        assert items[0].output == "answer"
        assert metrics == evaluator.get_supported_metrics(category)
        assert vars(model_wrapper)["model_provider"] == "provider"
        assert vars(model_wrapper)["model_name"] == "model"
        assert vars(model_wrapper)["tenant_id"] == "tenant"
        assert vars(embeddings_wrapper)["tenant_id"] == "tenant"
        categories.append(category)
        return [EvaluationItemResult(index=0, actual_output="answer")]

    monkeypatch.setattr(evaluator, "_evaluate_with_ragas", evaluate_with_ragas)
    items = [EvaluationItemInput(index=0, inputs={"prompt": "question"}, output="answer")]

    assert evaluator.evaluate_llm(items, [], "provider", "model", "tenant")[0].actual_output == "answer"
    assert evaluator.evaluate_retrieval(items, [], "provider", "model", "tenant")[0].actual_output == "answer"
    assert evaluator.evaluate_workflow(items, [], "provider", "model", "tenant")[0].actual_output == "answer"
    assert categories == [EvaluationCategory.LLM, EvaluationCategory.RETRIEVAL, EvaluationCategory.WORKFLOW]
