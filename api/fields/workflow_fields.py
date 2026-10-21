from typing import Any, Literal

from pydantic import ConfigDict, Field, RootModel

from fields.base import ResponseModel
from fields.types import FloatNumber, Int64, JSONObject, UUIDString


class PauseReasonResponseBase(ResponseModel):
    model_config = ConfigDict(extra="allow")

    form_id: UUIDString | None = None
    node_id: str | None = None
    node_title: str | None = None
    form_content: str | None = None
    inputs: list[JSONObject] = Field(default_factory=list)
    actions: list[JSONObject] = Field(default_factory=list)
    display_in_ui: bool | None = None
    resolved_default_values: dict[str, Any] = Field(default_factory=dict)
    form_token: str | None = None
    approval_channels: list[str] = Field(default_factory=list)
    expiration_time: Int64 | None = None
    message: str | None = None


class WorkflowPauseReasonResponse(PauseReasonResponseBase):
    """Public pause reason emitted by a blocking Workflow execution."""

    TYPE: str


class WorkflowBlockingDataBase(ResponseModel):
    model_config = ConfigDict(extra="allow")

    id: UUIDString
    workflow_id: UUIDString
    outputs: dict[str, Any] | None
    error: str | None
    elapsed_time: FloatNumber
    total_tokens: int
    total_steps: int
    created_at: Int64
    finished_at: Int64 | None


class WorkflowFinishedBlockingDataResponse(WorkflowBlockingDataBase):
    status: Literal["succeeded", "failed", "stopped", "partial-succeeded"]


class WorkflowPausedBlockingDataResponse(WorkflowBlockingDataBase):
    status: Literal["paused"]
    paused_nodes: list[str]
    reasons: list[WorkflowPauseReasonResponse]


class WorkflowFinishedBlockingResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    task_id: UUIDString
    workflow_run_id: UUIDString
    data: WorkflowFinishedBlockingDataResponse


class WorkflowPausedBlockingResponse(ResponseModel):
    model_config = ConfigDict(extra="allow")

    task_id: UUIDString
    workflow_run_id: UUIDString
    data: WorkflowPausedBlockingDataResponse


class WorkflowBlockingResponse(RootModel[WorkflowFinishedBlockingResponse | WorkflowPausedBlockingResponse]):
    """Blocking workflow response for a finished or paused execution."""
