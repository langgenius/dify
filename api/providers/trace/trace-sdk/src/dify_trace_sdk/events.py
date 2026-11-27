"""Trace events: what producers report when a traced operation finishes.

An event carries Dify record identifiers plus the facts that are persisted
nowhere else (moderation verdicts, tool calls, generated names, timings). The
trace pipeline reloads everything else from the database after validating
the owner chain, so events stay small and never carry credentials.
"""

import json
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

_EVENT_CONFIG = ConfigDict(extra="forbid", frozen=True)


def json_safe(value: object) -> JsonValue:
    """Convert a producer value to strict JSON: other objects become strings, and so do NaN and Infinity."""
    return json.loads(json.dumps(value, ensure_ascii=False, default=str), parse_constant=str)


class TraceCorrelation(BaseModel):
    """Caller-supplied correlation, propagated unchanged to the trace."""

    external_trace_id: str | None
    session_id: str | None
    parent_workflow_run_id: str | None
    parent_node_execution_id: str | None

    model_config = _EVENT_CONFIG


class MessageCompleted(BaseModel):
    kind: Literal["message"] = "message"
    message_id: str
    conversation_id: str | None

    model_config = _EVENT_CONFIG


class WorkflowRunCompleted(BaseModel):
    kind: Literal["workflow_run"] = "workflow_run"
    workflow_run_id: str
    conversation_id: str | None
    total_tokens: int | None
    """The in-memory total when the persisted run may lag behind."""

    model_config = _EVENT_CONFIG


class ModerationChecked(BaseModel):
    kind: Literal["moderation"] = "moderation"
    message_id: str | None
    inputs: dict[str, JsonValue]
    query: str
    flagged: bool
    action: str
    preset_response: str
    started_at: datetime
    ended_at: datetime

    model_config = _EVENT_CONFIG


class SuggestedQuestionsGenerated(BaseModel):
    kind: Literal["suggested_questions"] = "suggested_questions"
    message_id: str
    questions: list[str]
    started_at: datetime
    ended_at: datetime

    model_config = _EVENT_CONFIG


class DatasetRetrieved(BaseModel):
    kind: Literal["dataset_retrieval"] = "dataset_retrieval"
    message_id: str | None
    documents: list[dict[str, JsonValue]]
    started_at: datetime
    ended_at: datetime

    model_config = _EVENT_CONFIG


class ToolInvoked(BaseModel):
    kind: Literal["tool"] = "tool"
    message_id: str
    tool_name: str
    tool_inputs: dict[str, JsonValue]
    tool_outputs: str
    tool_config: dict[str, JsonValue]
    error: str | None
    time_cost: float
    started_at: datetime
    ended_at: datetime

    model_config = _EVENT_CONFIG


class ConversationNamed(BaseModel):
    kind: Literal["conversation_name"] = "conversation_name"
    conversation_id: str | None
    message_id: str | None
    inputs: str
    name: str
    started_at: datetime
    ended_at: datetime

    model_config = _EVENT_CONFIG


class PromptGenerated(BaseModel):
    kind: Literal["prompt_generation"] = "prompt_generation"
    operation_type: str
    instruction: str
    generated_output: str
    model_provider: str
    model_name: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency: float
    total_price: float | None
    currency: str | None
    error: str | None
    started_at: datetime
    ended_at: datetime

    model_config = _EVENT_CONFIG


class DraftNodeExecuted(BaseModel):
    kind: Literal["draft_node_execution"] = "draft_node_execution"
    node_execution: dict[str, JsonValue]

    model_config = _EVENT_CONFIG


type TracePayload = Annotated[
    MessageCompleted
    | WorkflowRunCompleted
    | ModerationChecked
    | SuggestedQuestionsGenerated
    | DatasetRetrieved
    | ToolInvoked
    | ConversationNamed
    | PromptGenerated
    | DraftNodeExecuted,
    Field(discriminator="kind"),
]


class TraceEvent(BaseModel):
    event_id: str
    tenant_id: str
    app_id: str | None
    """``None`` only for workspace-level operations such as prompt generation."""
    user_id: str | None
    occurred_at: datetime
    correlation: TraceCorrelation
    payload: TracePayload

    model_config = _EVENT_CONFIG
