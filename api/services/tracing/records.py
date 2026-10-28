"""Assembled trace records: one Dify operation with the data its sinks need.

Records are plain values copied from committed rows before their session
closes. They live only inside the delivery worker; the canonical trace built
from them is what gets persisted for retries.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from dify_trace_sdk.events import TraceParent
from pydantic import BaseModel, ConfigDict, StrictStr, ValidationError

from graphon.entities import WorkflowNodeExecution


class TraceParentContext(BaseModel):
    """The outer workflow run and node execution that started a nested workflow run."""

    parent_workflow_run_id: StrictStr
    parent_node_execution_id: StrictStr | None = None
    """``None`` when the outer node execution is unknown."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class TraceMessage(BaseModel):
    """The facts of one message that trace sinks read."""

    id: str
    app_id: str
    conversation_id: str
    workflow_run_id: str | None
    """The chatflow run that produced the message; ``None`` for other app modes."""
    query: str
    answer: str
    error: str | None
    """``None`` when the message recorded no error."""
    created_at: datetime
    model_provider: str | None
    """``None`` when no model answered, such as an annotation reply."""
    model_id: str | None
    """``None`` when no model answered, such as an annotation reply."""
    total_price: Decimal | None
    """``None`` when the price was not recorded."""
    currency: str

    model_config = ConfigDict(frozen=True)


class BaseTraceInfo(BaseModel):
    message_id: str | None = None
    message_data: TraceMessage | None = None
    """The message the operation belongs to; ``None`` for operations outside a conversation."""
    inputs: str | dict[str, Any] | list[Any] | None = None
    outputs: str | dict[str, Any] | list[Any] | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    metadata: dict[str, Any]
    trace_id: str | None = None
    """The caller-supplied trace ID, if any."""

    model_config = ConfigDict(protected_namespaces=(), frozen=True)

    @property
    def resolved_trace_id(self) -> str | None:
        """The caller's trace ID, then the workflow run, then the message."""
        if self.trace_id:
            return self.trace_id
        if (
            isinstance(self, WorkflowTraceInfo | WorkflowNodeTraceInfo | SuggestedQuestionTraceInfo)
            and self.workflow_run_id
        ):
            return self.workflow_run_id
        return self.message_id

    @property
    def resolved_parent_context(self) -> tuple[str | None, str | None]:
        """(outer workflow_run_id, outer node_execution_id) of a nested workflow."""
        raw = self.metadata.get("parent_trace_context")
        if not isinstance(raw, Mapping):
            return None, None
        try:
            context = TraceParentContext.model_validate(raw)
        except ValidationError:
            return None, None
        return context.parent_workflow_run_id, context.parent_node_execution_id


class WorkflowTraceInfo(BaseTraceInfo):
    start_time: datetime
    """When the run was created."""
    end_time: datetime
    """When the run finished; only finished runs are traced."""
    node_executions: Sequence[WorkflowNodeExecution]
    conversation_id: str | None
    message_started_at: datetime | None
    """Creation time of the chatflow message this run answers."""
    workflow_app_log_id: str | None
    workflow_id: str
    tenant_id: str
    workflow_run_id: str
    workflow_run_elapsed_time: int | float
    workflow_run_status: str
    workflow_run_inputs: Mapping[str, Any]
    workflow_run_outputs: Mapping[str, Any]
    workflow_run_version: str
    error: str | None
    total_tokens: int
    prompt_tokens: int | None
    completion_tokens: int | None
    file_list: list[str]
    invoked_by: str | None
    query: str
    parent: TraceParent | None
    """The run that started this nested workflow run; ``None`` outside nested workflows."""


class MessageTraceInfo(BaseTraceInfo):
    message_data: TraceMessage
    conversation_model: str
    message_tokens: int
    answer_tokens: int
    total_tokens: int
    error: str | None
    file_list: list[str]
    conversation_mode: str
    gen_ai_server_time_to_first_token: float | None
    llm_streaming_time_to_generate: float | None
    is_streaming_request: bool


class ModerationTraceInfo(BaseTraceInfo):
    flagged: bool
    action: str
    preset_response: str
    query: str


class SuggestedQuestionTraceInfo(BaseTraceInfo):
    total_tokens: int
    status: str | None
    error: str | None
    from_account_id: str | None
    agent_based: bool | None
    from_source: str | None
    model_provider: str | None
    model_id: str | None
    suggested_question: list[str]
    level: str
    status_message: str | None
    workflow_run_id: str | None


class DatasetRetrievalTraceInfo(BaseTraceInfo):
    documents: list[dict[str, Any]]
    error: str | None


class ToolTraceInfo(BaseTraceInfo):
    tool_name: str
    tool_inputs: dict[str, Any]
    tool_outputs: str
    error: str | None
    tool_config: dict[str, Any]
    time_cost: int | float
    tool_parameters: dict[str, Any]
    file_url: str | None


class GenerateNameTraceInfo(BaseTraceInfo):
    conversation_id: str | None
    tenant_id: str


class PromptGenerationTraceInfo(BaseTraceInfo):
    """Prompt generation operations (rule-generate, code-generate, etc.)."""

    tenant_id: str
    user_id: str
    app_id: str | None
    operation_type: str
    instruction: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    model_provider: str
    model_name: str
    latency: float
    total_price: float | None
    currency: str | None
    error: str | None


class WorkflowNodeTraceInfo(BaseTraceInfo):
    workflow_id: str
    workflow_run_id: str
    tenant_id: str
    node_execution_id: str
    node_id: str
    node_type: str
    title: str
    status: str
    error: str | None = None
    elapsed_time: float
    index: int
    predecessor_node_id: str | None = None
    total_tokens: int = 0
    total_price: float = 0.0
    currency: str | None = None
    model_provider: str | None = None
    model_name: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    tool_name: str | None = None
    iteration_id: str | None = None
    iteration_index: int | None = None
    loop_id: str | None = None
    loop_index: int | None = None
    parallel_id: str | None = None
    node_inputs: Mapping[str, Any] | None = None
    node_outputs: Mapping[str, Any] | None = None
    process_data: Mapping[str, Any] | None = None
    invoked_by: str | None = None


class DraftNodeExecutionTrace(WorkflowNodeTraceInfo):
    pass


class OperationType(StrEnum):
    """Operation labels on enterprise token metrics, so totals are not double-counted."""

    WORKFLOW = "workflow"
    NODE_EXECUTION = "node_execution"
    MESSAGE = "message"
    RULE_GENERATE = "rule_generate"
    CODE_GENERATE = "code_generate"
    STRUCTURED_OUTPUT = "structured_output"
    INSTRUCTION_MODIFY = "instruction_modify"
