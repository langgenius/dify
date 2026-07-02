from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import AliasChoices, Field, field_validator

from fields.base import ResponseModel
from fields.end_user_fields import SimpleEndUser
from fields.member_fields import SimpleAccountResponse
from libs.helper import to_timestamp


class WorkflowRunForLogResponse(ResponseModel):
    id: str
    version: str | None = None
    status: str | None = None
    triggered_from: str | None = None
    error: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_at: int | None = None
    finished_at: int | None = None
    exceptions_count: int | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: Any) -> str | None:
        if value is None or isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @field_validator("created_at", "finished_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowRunForArchivedLogResponse(ResponseModel):
    id: str
    status: str | None = None
    triggered_from: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: Any) -> str | None:
        if value is None or isinstance(value, str):
            return value
        return str(getattr(value, "value", value))


class WorkflowRunForListResponse(ResponseModel):
    id: str
    version: str | None = None
    status: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_by_account: SimpleAccountResponse | None = None
    created_at: int | None = None
    finished_at: int | None = None
    exceptions_count: int | None = None
    retry_index: int | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: Any) -> str | None:
        if value is None or isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @field_validator("created_at", "finished_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class AdvancedChatWorkflowRunForListResponse(WorkflowRunForListResponse):
    conversation_id: str | None = None
    message_id: str | None = None


class AdvancedChatWorkflowRunPaginationResponse(ResponseModel):
    limit: int
    has_more: bool
    data: list[AdvancedChatWorkflowRunForListResponse]


class WorkflowRunPaginationResponse(ResponseModel):
    limit: int
    has_more: bool
    data: list[WorkflowRunForListResponse]


class WorkflowRunCountResponse(ResponseModel):
    total: int
    running: int
    succeeded: int
    failed: int
    stopped: int
    partial_succeeded: int = Field(
        alias="partial_succeeded",
        validation_alias=AliasChoices("partial_succeeded", "partial-succeeded"),
    )


class WorkflowRunDetailResponse(ResponseModel):
    id: str
    version: str | None = None
    graph: Any = Field(validation_alias="graph_dict")
    inputs: Any = Field(validation_alias="inputs_dict")
    status: str | None = None
    outputs: Any = Field(validation_alias="outputs_dict")
    error: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_by_role: str | None = None
    created_by_account: SimpleAccountResponse | None = None
    created_by_end_user: SimpleEndUser | None = None
    created_at: int | None = None
    finished_at: int | None = None
    exceptions_count: int | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: Any) -> str | None:
        if value is None or isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @field_validator("created_at", "finished_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowRunNodeExecutionResponse(ResponseModel):
    id: str
    index: int | None = None
    predecessor_node_id: str | None = None
    node_id: str | None = None
    node_type: str | None = None
    title: str | None = None
    inputs: Any = Field(default=None, validation_alias="inputs_dict")
    process_data: Any = Field(default=None, validation_alias="process_data_dict")
    outputs: Any = Field(default=None, validation_alias="outputs_dict")
    status: str | None = None
    error: str | None = None
    elapsed_time: float | None = None
    execution_metadata: Any = Field(default=None, validation_alias="execution_metadata_dict")
    extras: Any = None
    created_at: int | None = None
    created_by_role: str | None = None
    created_by_account: SimpleAccountResponse | None = None
    created_by_end_user: SimpleEndUser | None = None
    finished_at: int | None = None
    inputs_truncated: bool | None = None
    outputs_truncated: bool | None = None
    process_data_truncated: bool | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: Any) -> str | None:
        if value is None or isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @field_validator("created_at", "finished_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class WorkflowRunNodeExecutionListResponse(ResponseModel):
    data: list[WorkflowRunNodeExecutionResponse]
