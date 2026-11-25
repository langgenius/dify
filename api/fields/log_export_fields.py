from typing import Annotated

from pydantic import BaseModel, Field

from fields.base import ResponseModel
from services.retention.log_export_email import LogExportEmailState
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


class LogExportEmailNotificationPayload(BaseModel):
    """Set the requester's mail preference for a single export."""

    enabled: bool = Field(strict=True)


class LogExportEmailNotificationResponse(ResponseModel):
    """Return the stored preference or that a mail job has been queued."""

    email_notification: LogExportEmailState
