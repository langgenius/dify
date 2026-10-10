import json
from enum import StrEnum
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field

from core.evaluation.entities.config_entity import EvaluationFrameworkEnum
from core.evaluation.entities.judgment_entity import JudgmentConfig, JudgmentResult


class EvaluationCategory(StrEnum):
    LLM = "llm"
    RETRIEVAL = "knowledge_retrieval"
    AGENT = "agent"
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

    ── Agent metrics ──────────────────────────────────────────────────────────────
    ARGUMENT_CORRECTNESS
        Uses an LLM judge to decide whether the arguments passed to tools are
        appropriate for the user's task. It does not require reference tool
        calls and is intentionally distinct from exact trace matching.
        Required fields: user_input, tools_called.

    TOOL_CALL_ACCURACY
        Compares the actual tool names, order, and arguments with reference
        tool calls supplied in the evaluation dataset.
        Required fields: tools_called, expected_tool_calls.

    TASK_COMPLETION
        Uses a Dify-owned LLM judge to evaluate whether the Agent's final
        response completes the task. Optional success criteria describe the
        desired outcome without prescribing an exact answer.

    TRAJECTORY_QUALITY
        Uses a Dify-owned LLM judge to evaluate the coherence, efficiency,
        observation use, and error recovery of the normalized Agent trace.

    TOOL_SELECTION_CORRECTNESS
        Uses a Dify-owned LLM judge to evaluate selected tools against the
        exact tool definitions visible to the Agent at runtime.

    TOOL_ARGUMENT_CORRECTNESS
        Uses a Dify-owned LLM judge to evaluate model-controlled tool
        arguments against the runtime-visible input schemas.

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

    # Agent metrics. These names intentionally preserve their framework
    # semantics instead of presenting judge-based and reference-based scores
    # as the same metric.
    TASK_COMPLETION = "task_completion"
    TRAJECTORY_QUALITY = "trajectory_quality"
    TOOL_SELECTION_CORRECTNESS = "tool_selection_correctness"
    TOOL_ARGUMENT_CORRECTNESS = "tool_argument_correctness"
    ARGUMENT_CORRECTNESS = "argument_correctness"
    TOOL_CALL_ACCURACY = "tool_call_accuracy"


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

AGENT_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.TASK_COMPLETION,
    EvaluationMetricName.TRAJECTORY_QUALITY,
    EvaluationMetricName.TOOL_SELECTION_CORRECTNESS,
    EvaluationMetricName.TOOL_ARGUMENT_CORRECTNESS,
    EvaluationMetricName.ARGUMENT_CORRECTNESS,
    EvaluationMetricName.TOOL_CALL_ACCURACY,
]

NATIVE_AGENT_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.TASK_COMPLETION,
    EvaluationMetricName.TRAJECTORY_QUALITY,
    EvaluationMetricName.TOOL_SELECTION_CORRECTNESS,
    EvaluationMetricName.TOOL_ARGUMENT_CORRECTNESS,
]

WORKFLOW_METRIC_NAMES: list[EvaluationMetricName] = [
    EvaluationMetricName.FAITHFULNESS,
    EvaluationMetricName.ANSWER_RELEVANCY,
    EvaluationMetricName.ANSWER_CORRECTNESS,
]

METRIC_NODE_TYPE_MAPPING: dict[str, str] = {
    **{m.value: "llm" for m in LLM_METRIC_NAMES},
    **{m.value: "knowledge-retrieval" for m in RETRIEVAL_METRIC_NAMES},
    **{m.value: "agent" for m in AGENT_METRIC_NAMES},
}

METRIC_VALUE_TYPE_MAPPING: dict[str, str] = {
    EvaluationMetricName.FAITHFULNESS: "number",
    EvaluationMetricName.ANSWER_RELEVANCY: "number",
    EvaluationMetricName.ANSWER_CORRECTNESS: "number",
    EvaluationMetricName.SEMANTIC_SIMILARITY: "number",
    EvaluationMetricName.CONTEXT_PRECISION: "number",
    EvaluationMetricName.CONTEXT_RECALL: "number",
    EvaluationMetricName.CONTEXT_RELEVANCE: "number",
    EvaluationMetricName.TASK_COMPLETION: "number",
    EvaluationMetricName.TRAJECTORY_QUALITY: "number",
    EvaluationMetricName.TOOL_SELECTION_CORRECTNESS: "number",
    EvaluationMetricName.TOOL_ARGUMENT_CORRECTNESS: "number",
    EvaluationMetricName.ARGUMENT_CORRECTNESS: "number",
    EvaluationMetricName.TOOL_CALL_ACCURACY: "number",
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


class AgentToolCall(BaseModel):
    """Framework-neutral representation of one Agent tool call."""

    name: str = Field(min_length=1)
    call_id: str | None = None
    tool_ref: str | None = None
    arguments: dict[str, Any] = Field(
        default_factory=dict,
        validation_alias=AliasChoices("arguments", "args", "input_parameters"),
    )
    output: Any | None = None


class AgentToolDefinition(BaseModel):
    """Credential-free snapshot of one tool exactly as exposed to an Agent."""

    tool_ref: str = Field(min_length=1)
    name: str = Field(min_length=1)
    display_name: str = ""
    description: str = ""
    input_schema: dict[str, Any] = Field(default_factory=dict)
    schema_available: bool = True


class AgentTrajectoryStep(BaseModel):
    """Framework-neutral observable Agent step used by all Agent judges."""

    step_id: str = Field(min_length=1)
    parent_step_id: str | None = None
    sequence: int = Field(ge=0)
    actor_id: str | None = None
    step_type: Literal["agent_message", "tool_call", "tool_result", "error", "final_output"]
    tool_call_id: str | None = None
    tool_ref: str | None = None
    tool_name: str | None = None
    arguments: dict[str, Any] | None = None
    content: Any | None = None
    status: Literal["succeeded", "failed", "unknown"] = "unknown"
    error: str | None = None
    duration_ms: int | None = Field(default=None, ge=0)


class AgentTrajectory(BaseModel):
    """Versioned normalized trace contract shared by legacy Agent and Agent V2 adapters."""

    schema_version: str = "1.0"
    source: Literal["legacy", "agent_v2"]
    steps: list[AgentTrajectoryStep] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class AgentEvaluationItem(EvaluationItemInput):
    """Agent evaluation input independent of a concrete Agent runtime."""

    tool_calls: list[AgentToolCall] = Field(default_factory=list)
    expected_tool_calls: list[AgentToolCall] | None = None
    success_criteria: list[str] | None = None
    available_tools: list[AgentToolDefinition] | None = None
    trajectory: AgentTrajectory | None = None


class AgentEvaluationTraceSnapshot(BaseModel):
    """Serializable Agent V2 trace captured only for evaluation executions."""

    schema_version: str = "1.0"
    tool_calls: list[AgentToolCall] = Field(default_factory=list)
    available_tools: list[AgentToolDefinition] = Field(default_factory=list)
    trajectory: AgentTrajectory


class EvaluationDatasetInput(BaseModel):
    """Parsed dataset row used throughout evaluation execution.

    ``expected_output`` keeps backward compatibility with the original
    single-reference template. When users upload node-specific reference
    columns such as ``Answer : expected_output``, they are stored in
    ``expected_outputs`` and resolved by the user-visible node title at
    execution time. Legacy node-ID columns remain supported. Agent reference
    traces follow the same convention with ``expected_tool_calls``. Optional
    Agent outcome criteria use ``success_criteria`` columns and never require
    tool names or trace internals from dataset authors.
    """

    index: int
    inputs: dict[str, Any]
    expected_output: str | None = None
    expected_outputs: dict[str, str] = Field(default_factory=dict)
    expected_tool_calls: list[AgentToolCall] | None = None
    expected_tool_calls_by_node: dict[str, list[AgentToolCall]] = Field(default_factory=dict)
    success_criteria: list[str] | None = None
    success_criteria_by_node: dict[str, list[str]] = Field(default_factory=dict)

    def get_expected_output_for_node(self, node_id: str | None, node_title: str | None = None) -> str | None:
        """Return the title-scoped answer, legacy ID-scoped answer, or global reference."""
        for node_key in (node_title, node_id):
            normalized_node_key = str(node_key or "").strip()
            if normalized_node_key and normalized_node_key in self.expected_outputs:
                return self.expected_outputs[normalized_node_key]

        if self.expected_output is not None:
            return self.expected_output

        return None

    def get_expected_tool_calls_for_node(
        self,
        node_id: str | None,
        node_title: str | None = None,
    ) -> list[AgentToolCall] | None:
        """Return title-scoped, legacy ID-scoped, or global reference tool calls."""
        for node_key in (node_title, node_id):
            normalized_node_key = str(node_key or "").strip()
            if normalized_node_key and normalized_node_key in self.expected_tool_calls_by_node:
                return self.expected_tool_calls_by_node[normalized_node_key]

        if self.expected_tool_calls is not None:
            return self.expected_tool_calls

        return None

    def get_success_criteria_for_node(
        self,
        node_id: str | None,
        node_title: str | None = None,
    ) -> list[str] | None:
        """Return node-scoped or global optional Agent success criteria."""
        for node_key in (node_title, node_id):
            normalized_node_key = str(node_key or "").strip()
            if normalized_node_key and normalized_node_key in self.success_criteria_by_node:
                return self.success_criteria_by_node[normalized_node_key]
        return self.success_criteria

    def serialize_expected_output(self) -> str | None:
        """Serialize references for persistence and API responses.

        Single-reference datasets stay unchanged, while multi-node references
        are stored as JSON so history/detail APIs can still expose the full
        uploaded payload without changing the database schema.
        """
        has_tool_call_references = self.expected_tool_calls is not None or bool(self.expected_tool_calls_by_node)
        has_success_criteria = self.success_criteria is not None or bool(self.success_criteria_by_node)
        if (
            self.expected_output is not None
            and not self.expected_outputs
            and not has_tool_call_references
            and not has_success_criteria
        ):
            return self.expected_output

        if not self.expected_outputs and not has_tool_call_references and not has_success_criteria:
            return None

        serialized_expected_outputs: dict[str, Any] = dict(self.expected_outputs)
        if self.expected_output is not None:
            serialized_expected_outputs = {"expected_output": self.expected_output, **serialized_expected_outputs}

        if self.expected_tool_calls is not None:
            serialized_expected_outputs["expected_tool_calls"] = [
                tool_call.model_dump(mode="json", exclude_none=True) for tool_call in self.expected_tool_calls
            ]
        for node_key, tool_calls in self.expected_tool_calls_by_node.items():
            serialized_expected_outputs[f"{node_key} : expected_tool_calls"] = [
                tool_call.model_dump(mode="json", exclude_none=True) for tool_call in tool_calls
            ]
        if self.success_criteria is not None:
            serialized_expected_outputs["success_criteria"] = self.success_criteria
        for node_key, criteria in self.success_criteria_by_node.items():
            serialized_expected_outputs[f"{node_key} : success_criteria"] = criteria

        return json.dumps(serialized_expected_outputs, ensure_ascii=False, sort_keys=True)

    def iter_expected_output_columns(self) -> list[tuple[str, str]]:
        """Return uploaded expected-output columns in display order."""
        columns: list[tuple[str, str]] = []
        if self.expected_output is not None:
            columns.append(("expected_output", self.expected_output))

        for node_key, value in self.expected_outputs.items():
            columns.append((f"{node_key} : expected_output", value))

        if self.expected_tool_calls is not None:
            columns.append(("expected_tool_calls", _serialize_tool_calls(self.expected_tool_calls)))
        for node_key, tool_calls in self.expected_tool_calls_by_node.items():
            columns.append((f"{node_key} : expected_tool_calls", _serialize_tool_calls(tool_calls)))

        if self.success_criteria is not None:
            columns.append(("success_criteria", "\n".join(self.success_criteria)))
        for node_key, criteria in self.success_criteria_by_node.items():
            columns.append((f"{node_key} : success_criteria", "\n".join(criteria)))

        return columns


def _serialize_tool_calls(tool_calls: list[AgentToolCall]) -> str:
    return json.dumps(
        [tool_call.model_dump(mode="json", exclude_none=True) for tool_call in tool_calls],
        ensure_ascii=False,
        sort_keys=True,
    )


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

    evaluation_framework: EvaluationFrameworkEnum = EvaluationFrameworkEnum.RAGAS
    dataset_input_types: dict[str, str] = Field(default_factory=dict)


class EvaluationRunData(BaseModel):
    """Serializable data for Celery task."""

    evaluation_run_id: str
    tenant_id: str
    target_type: str
    target_id: str
    target_workflow_version_id: str | None = None
    target_agent_config_snapshot_id: str | None = None
    evaluation_framework: EvaluationFrameworkEnum = EvaluationFrameworkEnum.RAGAS
    evaluation_model_provider: str
    evaluation_model: str
    default_metrics: list[DefaultMetric] = Field(default_factory=list)
    customized_metrics: CustomizedMetrics | None = None
    judgment_config: JudgmentConfig | None = None
    llm_context_node_mapping: dict[str, list[str]] = Field(default_factory=dict)
    input_list: list[EvaluationDatasetInput]
