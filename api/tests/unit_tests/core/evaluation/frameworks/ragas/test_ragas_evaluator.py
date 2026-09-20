"""Contract tests for the pinned RAGAS adapter."""

from types import SimpleNamespace

import pytest

from core.evaluation.entities.config_entity import RagasConfig
from core.evaluation.entities.evaluation_entity import EvaluationCategory
from core.evaluation.frameworks.ragas.ragas_evaluator import RagasEvaluator


def test_supported_metrics_only_expose_metrics_without_external_embeddings() -> None:
    evaluator = RagasEvaluator(RagasConfig())

    assert evaluator.get_supported_metrics(EvaluationCategory.LLM) == [
        "faithfulness",
        "answer_correctness",
    ]
    assert evaluator.get_supported_metrics(EvaluationCategory.RETRIEVAL) == [
        "context_precision",
        "context_recall",
        "context_relevance",
    ]


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
        ContextPrecision=FakeMetric,
        ContextRecall=FakeMetric,
        ContextRelevance=FakeMetric,
    )
    monkeypatch.setattr(
        "core.evaluation.frameworks.ragas.ragas_evaluator._import_ragas_metrics_module",
        lambda: metrics_module,
    )

    metrics = RagasEvaluator._build_ragas_metrics(
        ["faithfulness", "answer_correctness", "context_relevance", "semantic_similarity"]
    )

    assert [metric.name for metric in metrics] == [
        "faithfulness",
        "answer_correctness",
        "context_relevance",
    ]
    assert metrics[1].weights == [1.0, 0.0]
