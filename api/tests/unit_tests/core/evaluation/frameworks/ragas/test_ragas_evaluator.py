"""Contract tests for the pinned RAGAS adapter."""

import asyncio
import sys
from dataclasses import dataclass
from types import ModuleType
from typing import override

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
from core.evaluation.exceptions import safe_evaluation_error_text
from core.evaluation.frameworks.ragas.ragas_evaluator import (
    _RAGAS_METRIC_RETRIES,
    RagasAgentComponents,
    RagasEvaluator,
    _import_ragas_metrics_module,
    _score_ragas_metric,
)
from core.plugin.impl.exc import PluginInvokeError
from graphon.model_runtime.errors.invoke import InvokeConnectionError


@dataclass(frozen=True)
class _FakeScore:
    value: float


@dataclass(frozen=True)
class _FakeStructuredResponse:
    structured_output: dict[str, object]


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

    def score(self, **kwargs: object) -> _FakeScore:
        """Require a message trace and tool calls; return whether actual calls match the reference."""
        user_input = kwargs["user_input"]
        reference_tool_calls = kwargs["reference_tool_calls"]
        assert isinstance(user_input, list)
        assert len(user_input) > 1
        actual_message = user_input[1]
        assert isinstance(actual_message, _FakeRagasData)
        assert isinstance(reference_tool_calls, list)
        expected_calls = [call for call in reference_tool_calls if isinstance(call, _FakeRagasData)]
        assert len(expected_calls) == len(reference_tool_calls)
        actual_calls = actual_message.tool_calls
        return _FakeScore(
            value=float(
                [(call.name, call.args) for call in actual_calls] == [(call.name, call.args) for call in expected_calls]
            )
        )


def _fake_agent_components() -> RagasAgentComponents:
    return RagasAgentComponents(
        AIMessage=_FakeRagasData,
        HumanMessage=_FakeRagasData,
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


def test_installed_ragas_evaluates_modern_semantic_similarity_without_provider_io() -> None:
    """The pinned Ragas release evaluates a collections metric through Dify adapters.

    Precondition: the Evaluation dependency group is installed; embeddings are deterministic.
    Postcondition: all seven collections metric classes load, and semantic similarity
    returns a score without calling a provider or changing the public metric name.
    """
    from core.evaluation.frameworks.ragas.ragas_embeddings_wrapper import DifyEmbeddingsWrapper
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

    class DeterministicEmbeddings(DifyEmbeddingsWrapper):
        @override
        def embed_text(self, text: str, **kwargs: object) -> list[float]:
            return [1.0, 0.0] if text == "same" else [0.0, 1.0]

        @override
        async def aembed_text(self, text: str, **kwargs: object) -> list[float]:
            return self.embed_text(text)

    evaluator = RagasEvaluator(RagasConfig())
    embeddings = DeterministicEmbeddings("tenant")
    names = [
        "faithfulness",
        "answer_relevancy",
        "answer_correctness",
        "semantic_similarity",
        "context_precision",
        "context_recall",
        "context_relevance",
    ]
    built = evaluator._build_ragas_metrics(names, DifyModelWrapper("provider", "model", "tenant"), embeddings)
    assert [metric.name for metric in built] == names
    assert built[3].embeddings is embeddings

    result = evaluator._evaluate_with_ragas(
        [EvaluationItemInput(index=0, inputs={"prompt": "question"}, output="same", expected_output="same")],
        ["semantic_similarity"],
        DifyModelWrapper("provider", "model", "tenant"),
        embeddings,
        EvaluationCategory.LLM,
    )[0]

    assert result.error is None
    assert [(metric.name, metric.value) for metric in result.metrics] == [("semantic_similarity", 1.0)]


def test_installed_ragas_faithfulness_uses_dify_structured_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """A real collections LLM metric scores through Dify's structured output adapter."""
    from core.evaluation.frameworks.ragas.ragas_embeddings_wrapper import DifyEmbeddingsWrapper
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

    class FakeModel:
        provider = "provider"

        def get_model_schema(self) -> object:
            return object()

    model = DifyModelWrapper("provider", "model", "tenant")
    monkeypatch.setattr(model, "_get_model_instance", FakeModel)
    response_schemas: list[str] = []

    def fake_structured_output(**kwargs: object) -> _FakeStructuredResponse:
        """Require a titled schema; return the corresponding deterministic judge response."""
        schema = kwargs["json_schema"]
        assert isinstance(schema, dict)
        title = schema["title"]
        assert isinstance(title, str)
        response_schemas.append(title)
        if title == "StatementGeneratorOutput":
            return _FakeStructuredResponse(structured_output={"statements": ["Paris is in France."]})
        if title == "NLIStatementOutput":
            return _FakeStructuredResponse(
                structured_output={
                    "statements": [{"statement": "Paris is in France.", "reason": "The context says so.", "verdict": 1}]
                }
            )
        raise AssertionError(f"Unexpected Ragas response schema: {title}")

    monkeypatch.setattr(
        "core.llm_generator.output_parser.structured_output.invoke_llm_with_structured_output",
        fake_structured_output,
    )
    result = RagasEvaluator(RagasConfig())._evaluate_with_ragas(
        [
            EvaluationItemInput(
                index=0,
                inputs={"prompt": "Where is Paris?"},
                output="Paris is in France.",
                context=["Paris is in France."],
            )
        ],
        ["faithfulness"],
        model,
        DifyEmbeddingsWrapper("tenant"),
        EvaluationCategory.LLM,
    )[0]

    assert response_schemas == ["StatementGeneratorOutput", "NLIStatementOutput"]
    assert result.error is None
    assert [(metric.name, metric.value) for metric in result.metrics] == [("faithfulness", 1.0)]


@pytest.mark.parametrize("context", [None, ["", "   "]])
def test_missing_text_context_fails_only_context_dependent_metric(context: list[str] | None) -> None:
    """An absent evidence value has a public error while other metrics still score."""
    from core.evaluation.frameworks.ragas.ragas_embeddings_wrapper import DifyEmbeddingsWrapper
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

    class DeterministicEmbeddings(DifyEmbeddingsWrapper):
        @override
        def embed_text(self, text: str, **kwargs: object) -> list[float]:
            return [1.0, 0.0]

        @override
        async def aembed_text(self, text: str, **kwargs: object) -> list[float]:
            return self.embed_text(text)

    result = RagasEvaluator(RagasConfig())._evaluate_with_ragas(
        [
            EvaluationItemInput(
                index=0, inputs={"prompt": "question"}, output="same", expected_output="same", context=context
            )
        ],
        ["faithfulness", "semantic_similarity"],
        DifyModelWrapper("provider", "model", "tenant"),
        DeterministicEmbeddings("tenant"),
        EvaluationCategory.LLM,
    )[0]

    assert [(metric.name, metric.value) for metric in result.metrics] == [("semantic_similarity", 1.0)]
    assert result.error is not None
    assert result.error.startswith("EVAL_CONTEXT_MISSING:")
    assert "needs text context present" in result.error
    assert safe_evaluation_error_text(result.error) == result.error


def test_installed_ragas_scores_remaining_collections_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    """The remaining modern metric pipelines accept Dify's structured model and embeddings."""
    from core.evaluation.frameworks.ragas.ragas_embeddings_wrapper import DifyEmbeddingsWrapper
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

    class FakeModel:
        provider = "provider"

        def get_model_schema(self) -> object:
            return object()

    class ConstantEmbeddings(DifyEmbeddingsWrapper):
        @override
        def embed_text(self, text: str, **kwargs: object) -> list[float]:
            return [1.0, 0.0]

        @override
        async def aembed_text(self, text: str, **kwargs: object) -> list[float]:
            return self.embed_text(text)

        @override
        def embed_texts(self, texts: list[str], **kwargs: object) -> list[list[float]]:
            return [self.embed_text(text) for text in texts]

        @override
        async def aembed_texts(self, texts: list[str], **kwargs: object) -> list[list[float]]:
            return self.embed_texts(texts)

        @override
        def for_answer_relevancy(self) -> DifyEmbeddingsWrapper:
            return self

    model = DifyModelWrapper("provider", "model", "tenant")
    monkeypatch.setattr(model, "_get_model_instance", FakeModel)
    responses: dict[str, dict[str, object]] = {
        "StatementGeneratorOutput": {"statements": ["Paris is in France."]},
        "ClassificationWithReason": {
            "TP": [{"statement": "Paris is in France.", "reason": "The reference agrees."}],
            "FP": [],
            "FN": [],
        },
        "AnswerRelevanceOutput": {"question": "Where is Paris?", "noncommittal": 0},
        "ContextPrecisionOutput": {"reason": "The passage answers the question.", "verdict": 1},
        "ContextRecallOutput": {
            "classifications": [{"statement": "Paris is in France.", "reason": "The passage says so.", "attributed": 1}]
        },
        "ContextRelevanceOutput": {"rating": 2},
    }

    def fake_structured_output(**kwargs: object) -> _FakeStructuredResponse:
        """Require a titled schema; return the matching deterministic metric response."""
        schema = kwargs["json_schema"]
        assert isinstance(schema, dict)
        title = schema["title"]
        assert isinstance(title, str)
        return _FakeStructuredResponse(structured_output=responses[title])

    monkeypatch.setattr(
        "core.llm_generator.output_parser.structured_output.invoke_llm_with_structured_output",
        fake_structured_output,
    )
    evaluator = RagasEvaluator(RagasConfig())
    embeddings = ConstantEmbeddings("tenant")
    llm_result = evaluator._evaluate_with_ragas(
        [
            EvaluationItemInput(
                index=0,
                inputs={"prompt": "Where is Paris?"},
                output="Paris is in France.",
                expected_output="Paris is in France.",
            )
        ],
        ["answer_relevancy", "answer_correctness"],
        model,
        embeddings,
        EvaluationCategory.LLM,
    )[0]
    retrieval_result = evaluator._evaluate_with_ragas(
        [
            EvaluationItemInput(
                index=1,
                inputs={"query": "Where is Paris?"},
                output="",
                expected_output="Paris is in France.",
                context=["Paris is in France."],
            )
        ],
        ["context_precision", "context_recall", "context_relevance"],
        model,
        embeddings,
        EvaluationCategory.RETRIEVAL,
    )[0]

    assert llm_result.error is None
    assert retrieval_result.error is None
    assert [metric.name for metric in llm_result.metrics] == ["answer_relevancy", "answer_correctness"]
    assert [metric.value for metric in llm_result.metrics] == pytest.approx([1.0, 1.0])
    assert [metric.name for metric in retrieval_result.metrics] == [
        "context_precision",
        "context_recall",
        "context_relevance",
    ]
    assert [metric.value for metric in retrieval_result.metrics] == pytest.approx([1.0, 1.0, 1.0])


def test_installed_ragas_evaluates_modern_tool_call_accuracy_without_provider_io() -> None:
    """The pinned Ragas release scores a reference tool trace through Dify's adapter.

    Precondition: the expected and actual tool calls are identical.
    Postcondition: the reference-based score is one with no model I/O or error.
    """
    call = AgentToolCall(name="weather", arguments={"city": "Paris"})
    result = RagasEvaluator(RagasConfig()).evaluate_agent(
        [
            AgentEvaluationItem(
                index=1,
                inputs={"task": "Check weather"},
                output="Sunny",
                tool_calls=[call],
                expected_tool_calls=[call],
            )
        ],
        ["tool_call_accuracy"],
        "provider",
        "model",
        "tenant",
    )[0]

    assert result.error is None
    assert [(metric.name, metric.value) for metric in result.metrics] == [("tool_call_accuracy", 1.0)]


def test_installed_ragas_tool_call_accuracy_scores_argument_and_order_mismatches() -> None:
    expected = [
        AgentToolCall(name="weather", arguments={"city": "Paris"}),
        AgentToolCall(name="forecast", arguments={"day": "Monday"}),
    ]
    results = RagasEvaluator(RagasConfig()).evaluate_agent(
        [
            AgentEvaluationItem(
                index=0,
                inputs={"task": "Check Paris weather"},
                output="Done",
                tool_calls=[AgentToolCall(name="weather", arguments={"city": "London"}), expected[1]],
                expected_tool_calls=expected,
            ),
            AgentEvaluationItem(
                index=1,
                inputs={"task": "Check Paris weather"},
                output="Done",
                tool_calls=list(reversed(expected)),
                expected_tool_calls=expected,
            ),
        ],
        ["tool_call_accuracy"],
        "provider",
        "model",
        "tenant",
    )

    assert [result.error for result in results] == [None, None]
    assert [result.metrics[0].value for result in results] == [0.5, 0.0]


def test_modern_ragas_retries_only_transient_provider_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[str] = []

    class FakeMetric:
        async def ascore(self, **_kwargs: object) -> _FakeScore:
            attempts.append("score")
            if len(attempts) < 3:
                raise InvokeConnectionError("transient")
            return _FakeScore(value=0.75)

    async def no_wait(_delay: float) -> None:
        return None

    monkeypatch.setattr("core.evaluation.frameworks.ragas.ragas_evaluator.asyncio.sleep", no_wait)
    assert asyncio.run(_score_ragas_metric(FakeMetric(), {})).value == 0.75
    assert len(attempts) == 3

    class ClientFailureMetric:
        async def ascore(self, **_kwargs: object) -> None:
            attempts.append("client failure")
            raise PluginInvokeError("invalid configuration")

    with pytest.raises(PluginInvokeError):
        asyncio.run(_score_ragas_metric(ClientFailureMetric(), {}))
    assert attempts.count("client failure") == 1

    class AlwaysTransientMetric:
        async def ascore(self, **_kwargs: object) -> None:
            """Require no inputs; fail each attempt with a transient provider error."""
            attempts.append("exhausted")
            raise InvokeConnectionError("still unavailable")

    with pytest.raises(InvokeConnectionError):
        asyncio.run(_score_ragas_metric(AlwaysTransientMetric(), {}))
    assert attempts.count("exhausted") == _RAGAS_METRIC_RETRIES


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
    ("category", "metric_name", "expected_fields"),
    [
        (
            EvaluationCategory.LLM,
            "faithfulness",
            {
                "user_input": "question",
                "response": "answer",
                "retrieved_contexts": ["context"],
            },
        ),
        (
            EvaluationCategory.RETRIEVAL,
            "context_precision",
            {"user_input": "query", "reference": "expected", "retrieved_contexts": ["context"]},
        ),
        (
            EvaluationCategory.WORKFLOW,
            "answer_correctness",
            {"user_input": "question", "response": "answer", "reference": "expected"},
        ),
    ],
)
def test_modern_ragas_passes_metric_fields_for_each_category(
    monkeypatch: pytest.MonkeyPatch,
    category: EvaluationCategory,
    metric_name: str,
    expected_fields: dict[str, object],
) -> None:
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

    captured: list[dict[str, object]] = []

    class FakeMetric:
        name = metric_name

        async def ascore(self, **kwargs: object) -> _FakeScore:
            captured.append(kwargs)
            return _FakeScore(value=0.75)

    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(evaluator, "_build_ragas_metrics", lambda *_args: [FakeMetric()])
    result = evaluator._evaluate_with_ragas(
        [
            EvaluationItemInput(
                index=1,
                inputs={"prompt": "question", "query": "query"},
                output="answer",
                expected_output="expected",
                context=["context"],
            )
        ],
        [metric_name],
        DifyModelWrapper("provider", "model", "tenant"),
        object(),
        category,
    )[0]

    assert captured == [expected_fields]
    assert [(metric.name, metric.value) for metric in result.metrics] == [(metric_name, 0.75)]


def test_modern_ragas_preserves_other_scores_when_one_metric_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

    class GoodMetric:
        name = "faithfulness"

        async def ascore(self, **_kwargs: object) -> _FakeScore:
            return _FakeScore(value=0.75)

    class FailingMetric:
        name = "answer_relevancy"

        async def ascore(self, **_kwargs: object) -> None:
            raise ValueError("secret provider response")

    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(evaluator, "_build_ragas_metrics", lambda *_args: [GoodMetric(), FailingMetric()])
    result = evaluator._evaluate_with_ragas(
        [EvaluationItemInput(index=0, inputs={"prompt": "question"}, output="answer", context=["evidence"])],
        ["faithfulness", "answer_relevancy"],
        DifyModelWrapper("provider", "model", "tenant"),
        object(),
        EvaluationCategory.LLM,
    )[0]

    assert [(metric.name, metric.value) for metric in result.metrics] == [("faithfulness", 0.75)]
    assert result.error is not None
    assert result.error.startswith("EVAL_METRIC_FAILED:")
    assert "secret provider response" not in result.error


def test_modern_ragas_reports_unsupported_metric_without_losing_score(monkeypatch: pytest.MonkeyPatch) -> None:
    """A supported metric still scores when another requested metric is unavailable."""
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

    class FakeMetric:
        name = "answer_relevancy"

        async def ascore(self, **_kwargs: object) -> _FakeScore:
            """Require no inputs; return a deterministic score."""
            return _FakeScore(value=0.75)

    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(evaluator, "_build_ragas_metrics", lambda *_args: [FakeMetric()])
    result = evaluator._evaluate_with_ragas(
        [EvaluationItemInput(index=0, inputs={"prompt": "question"}, output="answer")],
        ["answer_relevancy", "unsupported_metric"],
        DifyModelWrapper("provider", "model", "tenant"),
        object(),
        EvaluationCategory.LLM,
    )[0]

    assert [(metric.name, metric.value) for metric in result.metrics] == [("answer_relevancy", 0.75)]
    assert result.error is not None
    assert result.error.startswith("EVAL_UNSUPPORTED_METRIC:")
    assert "unsupported_metric" not in result.error


@pytest.mark.parametrize("score", [float("nan"), float("inf")])
def test_modern_ragas_rejects_non_finite_scores(monkeypatch: pytest.MonkeyPatch, score: float) -> None:
    """Non-finite judge output fails the metric without exposing its raw value."""
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

    class FakeMetric:
        name = "answer_relevancy"

        async def ascore(self, **_kwargs: object) -> _FakeScore:
            """Require no inputs; return the requested non-finite score."""
            return _FakeScore(value=score)

    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(evaluator, "_build_ragas_metrics", lambda *_args: [FakeMetric()])
    result = evaluator._evaluate_with_ragas(
        [EvaluationItemInput(index=0, inputs={"prompt": "question"}, output="answer")],
        ["answer_relevancy"],
        DifyModelWrapper("provider", "model", "tenant"),
        object(),
        EvaluationCategory.LLM,
    )[0]

    assert result.metrics == []
    assert result.error is not None
    assert result.error.startswith("EVAL_METRIC_FAILED:")
    assert "non-finite score" not in result.error


def test_modern_ragas_scores_rows_with_bounded_concurrency_and_stable_order(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.evaluation.frameworks.ragas.ragas_model_wrapper import DifyModelWrapper

    active = 0
    peak_active = 0

    class FakeMetric:
        name = "answer_relevancy"

        async def ascore(self, *, user_input: str, response: str) -> _FakeScore:
            nonlocal active, peak_active
            assert response == "answer"
            active += 1
            peak_active = max(peak_active, active)
            try:
                await asyncio.sleep(0.01)
                return _FakeScore(value=float(user_input.removeprefix("question-")))
            finally:
                active -= 1

    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(evaluator, "_build_ragas_metrics", lambda *_args: [FakeMetric()])
    items = [
        EvaluationItemInput(index=index, inputs={"prompt": f"question-{index}"}, output="answer") for index in range(20)
    ]
    results = evaluator._evaluate_with_ragas(
        items,
        ["answer_relevancy"],
        DifyModelWrapper("provider", "model", "tenant"),
        object(),
        EvaluationCategory.LLM,
    )

    assert [result.index for result in results] == list(range(20))
    assert [result.metrics[0].value for result in results] == [float(index) for index in range(20)]
    assert 1 < peak_active <= 16


def test_import_ragas_metrics_uses_collections_only(monkeypatch: pytest.MonkeyPatch) -> None:
    collections = ModuleType("ragas.metrics.collections")
    requested: list[str] = []

    def import_metric_module(name: str) -> ModuleType:
        requested.append(name)
        return collections

    monkeypatch.setattr("core.evaluation.frameworks.ragas.ragas_evaluator.import_module", import_metric_module)

    assert _import_ragas_metrics_module() is collections
    assert requested == ["ragas.metrics.collections"]


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
    assert "EVAL_UNSUPPORTED_METRIC:" in (results[0].error or "")
    assert "unsupported_metric" not in (results[0].error or "")


def test_ragas_agent_metric_rejects_non_finite_reference_score(monkeypatch: pytest.MonkeyPatch) -> None:
    evaluator = RagasEvaluator(RagasConfig())
    monkeypatch.setattr(
        "core.evaluation.frameworks.ragas.ragas_evaluator._load_ragas_agent_components",
        _fake_agent_components,
    )
    monkeypatch.setattr(_FakeToolCallAccuracy, "score", lambda *_args, **_kwargs: _FakeScore(value=float("inf")))

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
    assert result.error is not None
    assert result.error.startswith("EVAL_METRIC_FAILED:")
    assert "non-finite score" not in result.error


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
        RagasEvaluator._build_ragas_metrics(["faithfulness"], object(), object())


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
