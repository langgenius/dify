from typing import Annotated

from pydantic import Field

from fields.base import ResponseModel
from services.retention.log_export_task import LogExportStage

LogExportEstimatedRows = Annotated[
    int | None,
    Field(ge=0, strict=True, description="CSV row count from the preview at submission, if available."),
]


class LogExportTaskResponse(ResponseModel):
    task_id: str
    estimated_rows: LogExportEstimatedRows = None


class LogExportProgressResponse(ResponseModel):
    """The last reported stage and CSV data-row count for the current attempt."""

    stage: LogExportStage
    rows_written: int = Field(ge=0)
