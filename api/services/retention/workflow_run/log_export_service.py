"""Create CSV export tasks for published runs in an admitted Workflow app."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from graphon.enums import WorkflowExecutionStatus
from services.retention.log_export_task import LogExportTask


@dataclass(frozen=True, slots=True)
class WorkflowLogExportScope:
    """A Workflow app resolved within the caller's active workspace."""

    tenant_id: str
    app_id: str


@dataclass(frozen=True, slots=True)
class WorkflowLogExportFilters:
    """Filter published runs by their Logs entries, with time bounds in naive UTC."""

    keyword: str | None = None
    status: WorkflowExecutionStatus | None = None
    created_at_before: datetime | None = None
    created_at_after: datetime | None = None
    end_user_ids: tuple[str, ...] = ()
    account_ids: tuple[str, ...] = ()


WorkflowLogExportTask = LogExportTask[WorkflowLogExportFilters]


class WorkflowLogExportService:
    """Persist a Workflow CSV export request with its admitted scope and filters."""

    def __init__(self, *, save_task: Callable[[WorkflowLogExportTask], None]) -> None:
        """Bind a write that persists Workflow task state with expiration."""
        self._save_task = save_task

    def create_task(
        self, *, scope: WorkflowLogExportScope, requested_by: str, filters: WorkflowLogExportFilters
    ) -> WorkflowLogExportTask:
        """Save a pending task for an admitted app and caller, returning it after a successful write."""
        task = WorkflowLogExportTask.pending(
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
            requested_by=requested_by,
            filters=filters,
        )
        self._save_task(task)
        return task
