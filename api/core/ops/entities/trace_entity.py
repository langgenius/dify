from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Any, Union

from pydantic import BaseModel, ConfigDict, field_serializer, field_validator


class BaseTraceInfo(BaseModel):
    message_id: str | None = None
    message_data: Any | None = None
    inputs: Union[str, dict[str, Any], list] | None = None
    outputs: Union[str, dict[str, Any], list] | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    metadata: dict[str, Any]
    trace_id: str | None = None

    @field_validator("inputs", "outputs")
    @classmethod
    def ensure_type(cls, v):
        if v is None:
            return None
        if isinstance(v, str | dict | list):
            return v
        return ""

    model_config = ConfigDict(protected_namespaces=())

    @field_serializer("start_time", "end_time")
    def serialize_datetime(self, dt: datetime | None) -> str | None:
        if dt is None:
            return None
        return dt.isoformat()


class WorkflowTraceInfo(BaseTraceInfo):
    workflow_data: Any = None
    conversation_id: str | None = None
    workflow_app_log_id: str | None = None
    workflow_id: str
    tenant_id: str
    workflow_run_id: str
    workflow_run_elapsed_time: Union[int, float]
    workflow_run_status: str
    workflow_run_inputs: Mapping[str, Any]
    workflow_run_outputs: Mapping[str, Any]
    workflow_run_version: str
    error: str | None = None
    total_tokens: int
    file_list: list[str]
    query: str
    metadata: dict[str, Any]


class MessageTraceInfo(BaseTraceInfo):
    conversation_model: str
    message_tokens: int
    answer_tokens: int
    total_tokens: int
    error: str | None = None
    file_list: Union[str, dict[str, Any], list] | None = None
    message_file_data: Any | None = None
    conversation_mode: str
    gen_ai_server_time_to_first_token: float | None = None
    llm_streaming_time_to_generate: float | None = None
    is_streaming_request: bool = False


class ModerationTraceInfo(BaseTraceInfo):
    flagged: bool
    action: str
    preset_response: str
    query: str


class SuggestedQuestionTraceInfo(BaseTraceInfo):
    total_tokens: int
    status: str | None = None
    error: str | None = None
    from_account_id: str | None = None
    agent_based: bool | None = None
    from_source: str | None = None
    model_provider: str | None = None
    model_id: str | None = None
    suggested_question: list[str]
    level: str
    status_message: str | None = None
    workflow_run_id: str | None = None

    model_config = ConfigDict(protected_namespaces=())


class DatasetRetrievalTraceInfo(BaseTraceInfo):
    documents: Any = None
    error: str | None = None


class ToolTraceInfo(BaseTraceInfo):
    tool_name: str
    tool_inputs: dict[str, Any]
    tool_outputs: str
    metadata: dict[str, Any]
    message_file_data: Any = None
    error: str | None = None
    tool_config: dict[str, Any]
    time_cost: Union[int, float]
    tool_parameters: dict[str, Any]
    file_url: Union[str, None, list] = None


class GenerateNameTraceInfo(BaseTraceInfo):
    conversation_id: str | None = None
    tenant_id: str


class TaskData(BaseModel):
    app_id: str
    trace_info_type: str
    trace_info: Any = None


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
    DATASOURCE_TRACE = "datasource"
