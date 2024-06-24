from datetime import datetime
from typing import Any, Union

from pydantic import BaseModel


class WorkflowTraceInfo(BaseModel):
    workflow_data: Any
    conversation_id: Union[str, None]
    workflow_id: str
    tenant_id: str
    workflow_run_id: str
    workflow_run_elapsed_time: Union[int, float]
    workflow_run_status: str
    workflow_run_inputs: dict[str, Any]
    workflow_run_outputs: dict[str, Any]
    workflow_run_version: str
    error: str
    total_tokens: int
    file_list: list[str]
    query: str
    metadata: dict[str, Any]


class MessageTraceInfo(BaseModel):
    message_data: Any
    conversation_model: str
    message_tokens: int
    answer_tokens: int
    total_tokens: int
    error: str
    inputs: Union[str, dict[str, Any], list, None]
    outputs: Union[str, dict[str, Any], list, None]
    file_list: list[str]
    created_at: datetime
    end_time: datetime
    metadata: dict[str, Any]
    message_file_data: Any
    conversation_mode: str


class ModerationTraceInfo(BaseModel):
    message_id: str
    inputs: dict[str, Any]
    message_data: Any
    flagged: bool
    action: str
    preset_response: str
    query: str
    start_time: datetime
    end_time: datetime
    metadata: dict[str, Any]


#
class SuggestedQuestionTraceInfo(BaseModel):
    message_id: str
    message_data: Any
    inputs: Union[str, dict[str, Any], list, None]
    outputs: Union[str, dict[str, Any], list, None]
    start_time: datetime
    end_time: datetime
    metadata: dict[str, Any]
    total_tokens: int
    status: Union[str, None]
    error: Union[str, None]
    from_account_id: str
    agent_based: bool
    from_source: str
    model_provider: str
    model_id: str
    suggested_question: list[str]
    level: str
    status_message: Union[str, None]


class DatasetRetrievalTraceInfo(BaseModel):
    message_id: str
    inputs: Union[str, dict[str, Any], list, None]
    documents: Any
    start_time: datetime
    end_time: datetime
    metadata: dict[str, Any]


class ToolTraceInfo(BaseModel):
    message_id: str
    message_data: Any
    tool_name: str
    start_time: datetime
    end_time: datetime
    tool_inputs: dict[str, Any]
    tool_outputs: str
    metadata: dict[str, Any]
    message_file_data: Any
    error: Union[str, None]
    inputs: Union[str, dict[str, Any], list, None]
    outputs: Union[str, dict[str, Any], list, None]
    tool_config: dict[str, Any]
    time_cost: Union[int, float]
    tool_parameters: dict[str, Any]


class GenerateNameTraceInfo(BaseModel):
    conversation_id: str
    inputs: Union[str, dict[str, Any], list, None]
    outputs: Union[str, dict[str, Any], list, None]
    start_time: datetime
    end_time: datetime
    metadata: dict[str, Any]
    tenant_id: str

