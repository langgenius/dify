from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class EvaluationCategory(StrEnum):
    LLM = "llm"
    RETRIEVAL = "retrieval"
    AGENT = "agent"
    WORKFLOW = "workflow"


class EvaluationMetric(BaseModel):
    name: str
    score: float
    details: dict[str, Any] = Field(default_factory=dict)


class EvaluationItemInput(BaseModel):
    index: int
    inputs: dict[str, Any]
    expected_output: str | None = None
    context: list[str] | None = None


class EvaluationItemResult(BaseModel):
    index: int
    actual_output: str | None = None
    metrics: list[EvaluationMetric] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None

    @property
    def overall_score(self) -> float | None:
        if not self.metrics:
            return None
        scores = [m.score for m in self.metrics]
        return sum(scores) / len(scores)


class EvaluationRunData(BaseModel):
    """Serializable data for Celery task."""
    evaluation_run_id: str
    tenant_id: str
    target_type: str
    target_id: str
    evaluation_category: EvaluationCategory
    evaluation_model_provider: str
    evaluation_model: str
    metrics_config: dict[str, Any] = Field(default_factory=dict)
    items: list[EvaluationItemInput]
