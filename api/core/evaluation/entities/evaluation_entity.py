from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from core.evaluation.entities.judgment_entity import JudgmentConfig, JudgmentResult


class EvaluationCategory(StrEnum):
    LLM = "llm"
    RETRIEVAL = "knowledge_retrieval"
    AGENT = "agent"
    WORKFLOW = "workflow"
    SNIPPET = "snippet"
    RETRIEVAL_TEST = "retrieval_test"


class EvaluationMetric(BaseModel):
    name: str
    value: Any
    details: dict[str, Any] = Field(default_factory=dict)


class EvaluationItemInput(BaseModel):
    index: int
    inputs: dict[str, Any]
    output: str
    expected_output: str | None = None
    context: list[str] | None = None


class EvaluationDatasetInput(BaseModel):
    index: int
    inputs: dict[str, Any]
    expected_output: str | None = None


class EvaluationItemResult(BaseModel):
    index: int
    actual_output: str | None = None
    metrics: list[EvaluationMetric] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    judgment: JudgmentResult = Field(default_factory=JudgmentResult)
    error: str | None = None


class NodeInfo(BaseModel):
    node_id: str
    type: str
    title: str


class DefaultMetric(BaseModel):
    metric: str
    node_info_list: list[NodeInfo]


class CustomizedMetricOutputField(BaseModel):
    variable: str
    value_type: str


class CustomizedMetrics(BaseModel):
    evaluation_workflow_id: str
    input_fields: dict[str, Any]
    output_fields: list[CustomizedMetricOutputField]


class EvaluationConfigData(BaseModel):
    """Structured data for saving evaluation configuration."""

    evaluation_model: str = ""
    evaluation_model_provider: str = ""
    default_metrics: list[DefaultMetric] = Field(default_factory=list)
    customized_metrics: CustomizedMetrics | None = None
    judgment_config: JudgmentConfig | None = None


class EvaluationRunRequest(EvaluationConfigData):
    """Request body for starting an evaluation run."""

    file_id: str


class EvaluationRunData(BaseModel):
    """Serializable data for Celery task."""

    evaluation_run_id: str
    tenant_id: str
    target_type: str
    target_id: str
    evaluation_model_provider: str
    evaluation_model: str
    default_metrics: list[DefaultMetric] = Field(default_factory=list)
    customized_metrics: CustomizedMetrics | None = None
    judgment_config: JudgmentConfig | None = None
    input_list: list[EvaluationDatasetInput]
