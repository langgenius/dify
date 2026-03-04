import collections
import logging
from typing import Any

from configs import dify_config
from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
from core.evaluation.entities.evaluation_entity import EvaluationCategory

logger = logging.getLogger(__name__)


class EvaluationFrameworkConfigMap(collections.UserDict[str, dict[str, Any]]):
    """Registry mapping framework enum -> {config_class, evaluator_class}."""

    def __getitem__(self, framework: str) -> dict[str, Any]:
        match framework:
            case EvaluationFrameworkEnum.RAGAS:
                from core.evaluation.entities.config_entity import RagasConfig
                from core.evaluation.frameworks.ragas.ragas_evaluator import RagasEvaluator

                return {
                    "config_class": RagasConfig,
                    "evaluator_class": RagasEvaluator,
                }
            case EvaluationFrameworkEnum.DEEPEVAL:
                raise NotImplementedError("DeepEval adapter is not yet implemented.")
            case EvaluationFrameworkEnum.CUSTOMIZED:
                from core.evaluation.entities.config_entity import CustomizedEvaluatorConfig
                from core.evaluation.frameworks.customized.customized_evaluator import CustomizedEvaluator

                return {
                    "config_class": CustomizedEvaluatorConfig,
                    "evaluator_class": CustomizedEvaluator,
                }
            case _:
                raise ValueError(f"Unknown evaluation framework: {framework}")


evaluation_framework_config_map = EvaluationFrameworkConfigMap()


class EvaluationManager:
    """Factory for evaluation instances based on global configuration."""

    @staticmethod
    def get_evaluation_instance() -> BaseEvaluationInstance | None:
        """Create and return an evaluation instance based on EVALUATION_FRAMEWORK env var."""
        framework = dify_config.EVALUATION_FRAMEWORK
        if not framework or framework == EvaluationFrameworkEnum.NONE:
            return None

        try:
            config_map = evaluation_framework_config_map[framework]
            evaluator_class = config_map["evaluator_class"]
            config_class = config_map["config_class"]
            config = config_class()
            return evaluator_class(config)
        except Exception:
            logger.exception("Failed to create evaluation instance for framework: %s", framework)
            return None

    @staticmethod
    def get_supported_metrics(category: EvaluationCategory) -> list[str]:
        """Return supported metrics for the current framework and given category."""
        instance = EvaluationManager.get_evaluation_instance()
        if instance is None:
            return []
        return instance.get_supported_metrics(category)
