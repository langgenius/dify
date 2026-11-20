"""Temporary CSV export task state shared by Console applications."""

from datetime import datetime, timedelta
from enum import StrEnum
from typing import Self
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from libs.datetime_utils import utc_now

_LOG_EXPORT_TASK_TTL = timedelta(days=1)


class LogExportStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class LogExportTask[FiltersT](BaseModel):
    """Persist the admitted owner, normalized filters and state of a temporary export."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    task_id: str
    tenant_id: str
    app_id: str
    requested_by: str
    filters: FiltersT
    created_at: datetime
    expires_at: datetime
    status: LogExportStatus = LogExportStatus.PENDING
    storage_key: str | None = None

    @classmethod
    def pending(cls, *, tenant_id: str, app_id: str, requested_by: str, filters: FiltersT) -> Self:
        """Build a fresh pending task with UTC filters and a one-day expiration."""
        created_at = utc_now()
        return cls(
            task_id=str(uuid4()),
            tenant_id=tenant_id,
            app_id=app_id,
            requested_by=requested_by,
            filters=filters,
            created_at=created_at,
            expires_at=created_at + _LOG_EXPORT_TASK_TTL,
        )
