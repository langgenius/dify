import pytest

from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
from core.evaluation.evaluation_manager import EvaluationManager
from core.evaluation.frameworks.deepeval.deepeval_evaluator import DeepEvalEvaluator
from core.evaluation.frameworks.ragas.ragas_evaluator import RagasEvaluator


def test_explicit_framework_selection_does_not_follow_global_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("core.evaluation.evaluation_manager.dify_config.EVALUATION_FRAMEWORK", "none")

    assert isinstance(EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.RAGAS), RagasEvaluator)
    assert isinstance(EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.DEEPEVAL), DeepEvalEvaluator)
    assert EvaluationManager.get_evaluation_instance() is None
