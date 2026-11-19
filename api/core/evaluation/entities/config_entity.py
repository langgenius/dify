from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class EvaluationFrameworkEnum(StrEnum):
    RAGAS = "ragas"
    DEEPEVAL = "deepeval"
    NONE = "none"


SelectableEvaluationFramework = Literal[EvaluationFrameworkEnum.RAGAS, EvaluationFrameworkEnum.DEEPEVAL]


class BaseEvaluationConfig(BaseModel):
    """Base configuration for evaluation frameworks."""

    pass


class RagasConfig(BaseEvaluationConfig):
    """RAGAS-specific configuration."""

    pass


class DeepEvalConfig(BaseEvaluationConfig):
    """DeepEval-specific configuration."""

    pass
