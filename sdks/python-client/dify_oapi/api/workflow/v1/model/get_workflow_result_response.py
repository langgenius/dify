from __future__ import annotations


from dify_oapi.core.model.base_response import BaseResponse


class GetWorkflowResultResponse(BaseResponse):
    id: str | None = None
    workflow_id: str | None = None
    status: str | None = None
    inputs: str | None = None
    outputs: str | None = None
    error: str | None = None
    elapsed_time: float | None = None
    total_tokens: int | None = None
    total_steps: int | None = None
    created_at: str | None = None
    finished_at: str | None = None
