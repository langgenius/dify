from __future__ import annotations

from pydantic import BaseModel

from dify_oapi.core.model.base_response import BaseResponse


class RunWorkflowResponse(BaseResponse):
    workflow_run_id: str | None = None
    task_id: str | None = None
    data: RunWorkflowResponseData | None = None


class RunWorkflowResponseData(BaseModel):
    id: str | None = None
    workflow_id: str | None = None
    status: str | None = None
    outputs: dict | None = None
    error: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_at: int | None = None
    finished_at: int | None = None
