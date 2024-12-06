from __future__ import annotations

from pydantic import BaseModel

from dify_oapi.core.model.base_response import BaseResponse


class GetWorkflowLogResponse(BaseResponse):
    page: int | None = None
    limit: int | None = None
    total: int | None = None
    has_more: bool | None = None
    data: list[GetWorkflowLogResponseData] | None = None


class GetWorkflowLogResponseData(BaseModel):
    id: str | None = None
    workflow_run: GetWorkflowLogResponseDataWorkflowRun | None = None
    created_from: str | None = None
    created_by_role: str | None = None
    created_by_account: str | None = None
    created_by_end_user: GetWorkflowLogResponseDataEndUser | None = None
    created_at: int | None = None


class GetWorkflowLogResponseDataWorkflowRun(BaseModel):
    id: str | None = None
    version: str | None = None
    status: str | None = None
    error: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_at: int | None = None
    finished_at: int | None = None


class GetWorkflowLogResponseDataEndUser(BaseModel):
    id: str | None = None
    type: str | None = None
    is_anonymous: bool | None = None
    session_id: str | None = None
