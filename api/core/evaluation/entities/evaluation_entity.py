import json
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from core.evaluation.entities.judgment_entity import JudgmentConfig, JudgmentResult


class EvaluationCategory(StrEnum):
    LLM = "llm"
    RETRIEVAL = "knowledge_retrieval"
    WORKFLOW = "workflow"
    SNIPPET = "snippet"
    KNOWLEDGE_BASE = "knowledge_base"


class EvaluationMetricName(StrEnum):
    """Canonical metric names shared across all evaluation frameworks.

    Each framework maps these names to its own internal implementation.
    A framework that does not support a given metric should log a warning
    and skip it rather than raising an error.

    ── LLM / general text-quality metrics ──────────────────────────────────
    FAITHFULNESS
        Measures whether every claim in the model's response is grounded in
        the provided retrieved context. A high score means the answer
        contains no hallucinated content — each statement can be traced back
        to a passage in the context.
        Required fields: user_input, response, retrieved_contexts.

    ANSWER_RELEVANCY
        Measures how well the model's response addresses the user's question.
        A high score means the answer stays on-topic; a low score indicates
        irrelevant content or a failure to answer the actual question.
        Required fields: user_input, response.

    ANSWER_CORRECTNESS
        Measures the factual accuracy and completeness of the model's answer
        relative to a ground-truth reference. It combines semantic similarity
        with key-fact coverage, so both meaning and content matter.
        Required fields: user_input, response, reference (expected_output).

    SEMANTIC_SIMILARITY
        Measures the cosine similarity between the model's response and the
        reference answer in an embedding space. It evaluates whether the two
        texts convey the same meaning, independent of factual correctness.
        Required fields: response, reference (expected_output).

    ── Retrieval-quality metrics ────────────────────────────────────────────
    CONTEXT_PRECISION
        Measures the proportion of retrieved context chunks that are actually
        relevant to the question (precision). A high score means the retrieval
        pipeline returns little noise.
        Required fields: user_input, reference, retrieved_contexts.

    CONTEXT_RECALL
        Measures the proportion of ground-truth information that is covered by
        the retrieved context chunks (recall). A high score means the retrieval
        pipeline does not miss important supporting evidence.
        Required fields: user_input, reference, retrieved_contexts.

    CONTEXT_RELEVANCE
        Measures how relevant each individual retrieved chunk is to the query.
        Similar to CONTEXT_PRECISION but evaluated at the chunk level rather
        than against a reference answer.
        Required fields: user_input, retrieved_contexts.

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


# Per-category canonical metric lists used by get_supported_metrics().
LLM_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.FAITHFULNESS,  # Every claim is grounded in context; no hallucinations
    EvaluationMetricName.ANSWER_RELEVANCY,  # Response stays on-topic and addresses the question
    EvaluationMetricName.ANSWER_CORRECTNESS,  # Factual accuracy and completeness vs. reference
    EvaluationMetricName.SEMANTIC_SIMILARITY,  # Semantic closeness to the reference answer
]

RETRIEVAL_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.CONTEXT_PRECISION,  # Fraction of retrieved chunks that are relevant (precision)
    EvaluationMetricName.CONTEXT_RECALL,  # Fraction of ground-truth info covered by retrieval (recall)
    EvaluationMetricName.CONTEXT_RELEVANCE,  # Per-chunk relevance to the query
]

WORKFLOW_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.FAITHFULNESS,
    EvaluationMetricName.ANSWER_RELEVANCY,
    EvaluationMetricName.ANSWER_CORRECTNESS,
]

METRIC_NODE_TYPE_MAPPING: dict[str, str] = {
    **{m.value: "llm" for m in LLM_METRIC_NAMES},
    **{m.value: "knowledge-retrieval" for m in RETRIEVAL_METRIC_NAMES},
}

METRIC_VALUE_TYPE_MAPPING: dict[str, str] = {
    EvaluationMetricName.FAITHFULNESS: "number",
    EvaluationMetricName.ANSWER_RELEVANCY: "number",
    EvaluationMetricName.ANSWER_CORRECTNESS: "number",
    EvaluationMetricName.SEMANTIC_SIMILARITY: "number",
    EvaluationMetricName.CONTEXT_PRECISION: "number",
    EvaluationMetricName.CONTEXT_RECALL: "number",
    EvaluationMetricName.CONTEXT_RELEVANCE: "number",
}


class NodeInfo(BaseModel):
    node_id: str
    type: str
    title: str


class EvaluationMetric(BaseModel):
    name: str
    value: Any
    details: dict[str, Any] = Field(default_factory=dict)
    node_info: NodeInfo | None = None


class EvaluationItemInput(BaseModel):
    index: int
    inputs: dict[str, Any]
    output: str
    expected_output: str | None = None
    context: list[str] | None = None


class EvaluationDatasetInput(BaseModel):
    """Parsed dataset row used throughout evaluation execution.

    ``expected_output`` keeps backward compatibility with the original
    single-reference template. When users upload node-specific reference
    columns such as ``LLM 1 : expected_output``, they are stored in
    ``expected_outputs`` and resolved by node title at execution time.
    """

    index: int
    inputs: dict[str, Any]
    expected_output: str | None = None
    expected_outputs: dict[str, str] = Field(default_factory=dict)

    def get_expected_output_for_node(self, node_title: str | None) -> str | None:
        """Return the best matching reference answer for the given node title."""
        if node_title:
            if node_title in self.expected_outputs:
                return self.expected_outputs[node_title]

        if self.expected_output is not None:
            return self.expected_output

        if len(self.expected_outputs) == 1:
            return next(iter(self.expected_outputs.values()))

        return None

    def serialize_expected_output(self) -> str | None:
        """Serialize references for persistence and API responses.

        Single-reference datasets stay unchanged, while multi-node references
        are stored as JSON so history/detail APIs can still expose the full
        uploaded payload without changing the database schema.
        """
        if self.expected_output is not None and not self.expected_outputs:
            return self.expected_output

        if not self.expected_outputs:
            return None

        serialized_expected_outputs = dict(self.expected_outputs)
        if self.expected_output is not None:
            serialized_expected_outputs = {"expected_output": self.expected_output, **serialized_expected_outputs}

        return json.dumps(serialized_expected_outputs, ensure_ascii=False, sort_keys=True)

    def iter_expected_output_columns(self) -> list[tuple[str, str]]:
        """Return uploaded expected-output columns in display order."""
        columns: list[tuple[str, str]] = []
        if self.expected_output is not None:
            columns.append(("expected_output", self.expected_output))

        for node_title, value in self.expected_outputs.items():
            columns.append((f"{node_title} : expected_output", value))

        return columns


class EvaluationItemResult(BaseModel):
    index: int
    actual_output: str | None = None
    metrics: list[EvaluationMetric] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    judgment: JudgmentResult = Field(default_factory=JudgmentResult)
    overall_score: float | None = None
    error: str | None = None


class DefaultMetric(BaseModel):
    metric: str
    value_type: str = ""
    node_info_list: list[NodeInfo]


class CustomizedMetricOutputField(BaseModel):
    variable: str
    value_type: str


class CustomizedMetrics(BaseModel):
    """Custom evaluator selection.

    ``evaluation_workflow_id`` is the evaluator App ID retained for API
    compatibility. ``evaluation_workflow_version_id`` is resolved at run
    creation so an in-flight or historical run never follows a later publish.
    """

    evaluation_workflow_id: str
    evaluation_workflow_version_id: str | None = None
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


class EvaluationRunSnapshot(EvaluationRunRequest):
    """Immutable run configuration plus the target's pinned dataset input schema."""

    dataset_input_types: dict[str, str] = Field(default_factory=dict)


class EvaluationRunData(BaseModel):
    """Serializable data for Celery task."""

    evaluation_run_id: str
    tenant_id: str
    target_type: str
    target_id: str
    target_workflow_version_id: str | None = None
    evaluation_model_provider: str
    evaluation_model: str
    default_metrics: list[DefaultMetric] = Field(default_factory=list)
    customized_metrics: CustomizedMetrics | None = None
    judgment_config: JudgmentConfig | None = None
    llm_context_node_mapping: dict[str, list[str]] = Field(default_factory=dict)
    input_list: list[EvaluationDatasetInput]
