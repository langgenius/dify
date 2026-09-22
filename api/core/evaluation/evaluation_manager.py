import logging
from typing import Any

from configs import dify_config
from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
from core.evaluation.entities.evaluation_entity import EvaluationCategory

logger = logging.getLogger(__name__)


class EvaluationFrameworkConfigMap:
    """Registry mapping framework enum -> {config_class, evaluator_class}."""

    def __getitem__(self, key: EvaluationFrameworkEnum) -> dict[str, Any]:
        match key:
            case EvaluationFrameworkEnum.RAGAS:
                from core.evaluation.entities.config_entity import RagasConfig
                from core.evaluation.frameworks.ragas.ragas_evaluator import RagasEvaluator

                return {
                    "config_class": RagasConfig,
                    "evaluator_class": RagasEvaluator,
                }
            case EvaluationFrameworkEnum.DEEPEVAL:
                from core.evaluation.entities.config_entity import DeepEvalConfig
                from core.evaluation.frameworks.deepeval.deepeval_evaluator import DeepEvalEvaluator

                return {
                    "config_class": DeepEvalConfig,
                    "evaluator_class": DeepEvalEvaluator,
                }
            case _:
                raise ValueError(f"Unknown evaluation framework: {key}")


evaluation_framework_config_map = EvaluationFrameworkConfigMap()


class EvaluationManager:
    """Factory for evaluation instances based on global configuration."""

    @staticmethod
    def get_configured_framework() -> EvaluationFrameworkEnum:
        """Return the globally configured evaluation framework."""
        return EvaluationFrameworkEnum(dify_config.EVALUATION_FRAMEWORK)

    @staticmethod
    def get_evaluation_instance(
        framework: str | EvaluationFrameworkEnum | None = None,
    ) -> BaseEvaluationInstance | None:
        """Create an evaluator for an explicit framework or the global configuration."""
        selected_framework = (
            EvaluationManager.get_configured_framework() if framework is None else EvaluationFrameworkEnum(framework)
        )
        if selected_framework == EvaluationFrameworkEnum.NONE:
            return None

        config_map = evaluation_framework_config_map[selected_framework]
        evaluator_class = config_map["evaluator_class"]
        config_class = config_map["config_class"]
        return evaluator_class(config_class())

    @staticmethod
    def get_supported_metrics(
        category: EvaluationCategory,
        framework: str | EvaluationFrameworkEnum | None = None,
    ) -> list[str]:
        """Return supported metrics for the selected framework and category."""
        instance = EvaluationManager.get_evaluation_instance(framework)
        if instance is None:
            return []
        return instance.get_supported_metrics(category)
