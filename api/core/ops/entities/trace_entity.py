from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Any, Optional, Union

from pydantic import BaseModel, ConfigDict, field_validator


class BaseTraceInfo(BaseModel):
    message_id: Optional[str] = None
    message_data: Optional[Any] = None
    inputs: Optional[Union[str, dict[str, Any], list]] = None
    outputs: Optional[Union[str, dict[str, Any], list]] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    metadata: dict[str, Any]

    @field_validator("inputs", "outputs")
    @classmethod
    def ensure_type(cls, v):
        if v is None:
            return None
        if isinstance(v, str | dict | list):
            return v
        return ""

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }


class WorkflowTraceInfo(BaseTraceInfo):
    workflow_data: Any
    conversation_id: Optional[str] = None
    workflow_app_log_id: Optional[str] = None
    workflow_id: str
    tenant_id: str
    workflow_run_id: str
    workflow_run_elapsed_time: Union[int, float]
    workflow_run_status: str
    workflow_run_inputs: Mapping[str, Any]
    workflow_run_outputs: Mapping[str, Any]
    workflow_run_version: str
    error: Optional[str] = None
    total_tokens: int
    file_list: list[str]
    query: str
    metadata: dict[str, Any]


class MessageTraceInfo(BaseTraceInfo):
    conversation_model: str
    message_tokens: int
    answer_tokens: int
    total_tokens: int
    error: Optional[str] = None
    file_list: Optional[Union[str, dict[str, Any], list]] = None
    message_file_data: Optional[Any] = None
    conversation_mode: str


class ModerationTraceInfo(BaseTraceInfo):
    flagged: bool
    action: str
    preset_response: str
    query: str


class SuggestedQuestionTraceInfo(BaseTraceInfo):
    total_tokens: int
    status: Optional[str] = None
    error: Optional[str] = None
    from_account_id: Optional[str] = None
    agent_based: Optional[bool] = None
    from_source: Optional[str] = None
    model_provider: Optional[str] = None
    model_id: Optional[str] = None
    suggested_question: list[str]
    level: str
    status_message: Optional[str] = None
    workflow_run_id: Optional[str] = None

    model_config = ConfigDict(protected_namespaces=())


class DatasetRetrievalTraceInfo(BaseTraceInfo):
    documents: Any


class ToolTraceInfo(BaseTraceInfo):
    tool_name: str
    tool_inputs: dict[str, Any]
    tool_outputs: str
    metadata: dict[str, Any]
    message_file_data: Any
    error: Optional[str] = None
    tool_config: dict[str, Any]
    time_cost: Union[int, float]
    tool_parameters: dict[str, Any]
    file_url: Union[str, None, list]


class GenerateNameTraceInfo(BaseTraceInfo):
    conversation_id: Optional[str] = None
    tenant_id: str


class TaskData(BaseModel):
    app_id: str
    trace_info_type: str
    trace_info: Any


trace_info_info_map = {
    "WorkflowTraceInfo": WorkflowTraceInfo,
    "MessageTraceInfo": MessageTraceInfo,
    "ModerationTraceInfo": ModerationTraceInfo,
    "SuggestedQuestionTraceInfo": SuggestedQuestionTraceInfo,
    "DatasetRetrievalTraceInfo": DatasetRetrievalTraceInfo,
    "ToolTraceInfo": ToolTraceInfo,
    "GenerateNameTraceInfo": GenerateNameTraceInfo,
}


class TraceTaskName(StrEnum):
    CONVERSATION_TRACE = "conversation"
    WORKFLOW_TRACE = "workflow"
    MESSAGE_TRACE = "message"
    MODERATION_TRACE = "moderation"
    SUGGESTED_QUESTION_TRACE = "suggested_question"
    DATASET_RETRIEVAL_TRACE = "dataset_retrieval"
    TOOL_TRACE = "tool"
    GENERATE_NAME_TRACE = "generate_conversation_name"
