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


class EvaluationMetricName(StrEnum):
    """Canonical metric names shared across all evaluation frameworks.

    Each framework maps these names to its own internal implementation.
    A framework that does not support a given metric should log a warning
    and skip it rather than raising an error.
    """

    # LLM / general text-quality metrics
    FAITHFULNESS = "faithfulness"
    ANSWER_RELEVANCY = "answer_relevancy"
    ANSWER_CORRECTNESS = "answer_correctness"
    SEMANTIC_SIMILARITY = "semantic_similarity"

    # Retrieval-quality metrics
    CONTEXT_PRECISION = "context_precision"
    CONTEXT_RECALL = "context_recall"
    CONTEXT_RELEVANCE = "context_relevance"

    # Agent-quality metrics
    TOOL_CORRECTNESS = "tool_correctness"
    TASK_COMPLETION = "task_completion"


# Per-category canonical metric lists used by get_supported_metrics().
LLM_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.FAITHFULNESS,
    EvaluationMetricName.ANSWER_RELEVANCY,
    EvaluationMetricName.ANSWER_CORRECTNESS,
    EvaluationMetricName.SEMANTIC_SIMILARITY,
]

RETRIEVAL_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.CONTEXT_PRECISION,
    EvaluationMetricName.CONTEXT_RECALL,
    EvaluationMetricName.CONTEXT_RELEVANCE,
]

AGENT_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.TOOL_CORRECTNESS,
    EvaluationMetricName.TASK_COMPLETION,
]

WORKFLOW_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.FAITHFULNESS,
    EvaluationMetricName.ANSWER_RELEVANCY,
    EvaluationMetricName.ANSWER_CORRECTNESS,
]


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
