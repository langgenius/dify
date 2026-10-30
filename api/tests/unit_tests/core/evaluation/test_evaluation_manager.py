import pytest

from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
from core.evaluation.evaluation_manager import EvaluationManager
from core.evaluation.frameworks.deepeval.deepeval_evaluator import DeepEvalEvaluator
from core.evaluation.frameworks.ragas.ragas_evaluator import RagasEvaluator


def test_framework_selection_ignores_legacy_environment_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EVALUATION_FRAMEWORK", "none")

    assert isinstance(EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.RAGAS), RagasEvaluator)
    assert isinstance(EvaluationManager.get_evaluation_instance(EvaluationFrameworkEnum.DEEPEVAL), DeepEvalEvaluator)
    assert isinstance(EvaluationManager.get_evaluation_instance(), RagasEvaluator)
