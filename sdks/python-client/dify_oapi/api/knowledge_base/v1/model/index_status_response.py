from __future__ import annotations

from pydantic import BaseModel

from dify_oapi.core.model.base_response import BaseResponse


class IndexStatusResponse(BaseResponse):
    data: list[IndexStatusResponseData] | None = None


class IndexStatusResponseData(BaseModel):
    id: str | None = None
    indexing_status: str | None = None
    processing_started_at: float | None = None
    parsing_completed_at: float | None = None
    cleaning_completed_at: float | None = None
    splitting_completed_at: float | None = None
    completed_at: float | None = None
    paused_at: float | None = None
    error: str | None = None
    stopped_at: float | None = None
    completed_segments: int | None = None
    total_segments: int | None = None
