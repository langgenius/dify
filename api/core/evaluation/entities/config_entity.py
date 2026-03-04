from enum import StrEnum

from pydantic import BaseModel


class EvaluationFrameworkEnum(StrEnum):
    RAGAS = "ragas"
    DEEPEVAL = "deepeval"
    CUSTOMIZED = "customized"
    NONE = "none"


class BaseEvaluationConfig(BaseModel):
    """Base configuration for evaluation frameworks."""
    pass


class RagasConfig(BaseEvaluationConfig):
    """RAGAS-specific configuration."""
    pass


class CustomizedEvaluatorConfig(BaseEvaluationConfig):
    """Configuration for the customized workflow-based evaluator."""
    pass
