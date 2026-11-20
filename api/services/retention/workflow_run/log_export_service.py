"""Create, prepare, and read CSV export tasks for an admitted Workflow app."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from graphon.enums import WorkflowExecutionStatus
from services.retention.log_export_task import (
    LogExportTask,
    LogExportTaskStore,
    StoreLogExportFile,
    WriteLogExportCsv,
    prepare_log_export_task,
    save_and_dispatch_log_export_task,
)


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


class WorkflowLogExportTaskNotFoundError(Exception):
    """The requested export task is unavailable for the admitted app."""


class WorkflowLogExportService:
    """Manage Workflow CSV export tasks within their admitted app scope."""

    def __init__(
        self,
        *,
        tasks: LogExportTaskStore[WorkflowLogExportFilters],
        dispatch: Callable[[WorkflowLogExportTask], None],
        store_csv: StoreLogExportFile,
        write_csv: WriteLogExportCsv[WorkflowLogExportFilters],
    ) -> None:
        """Bind Workflow task state, delivery and CSV preparation."""
        self._tasks = tasks
        self._dispatch = dispatch
        self._store_csv = store_csv
        self._write_csv = write_csv

    def create_task(
        self, *, scope: WorkflowLogExportScope, requested_by: str, filters: WorkflowLogExportFilters
    ) -> WorkflowLogExportTask:
        """Save and dispatch a pending task with the admitted scope and normalized filters."""
        task = WorkflowLogExportTask.pending(
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
            requested_by=requested_by,
            filters=filters,
        )
        save_and_dispatch_log_export_task(task, tasks=self._tasks, dispatch=self._dispatch)
        return task

    def get_task(self, *, scope: WorkflowLogExportScope, task_id: str) -> WorkflowLogExportTask:
        """Return a live task in the admitted workspace and app, or raise if unavailable."""
        task = self._tasks.get(tenant_id=scope.tenant_id, app_id=scope.app_id, task_id=task_id)
        if task is None:
            raise WorkflowLogExportTaskNotFoundError()
        return task

    def get_latest_task(self, *, scope: WorkflowLogExportScope, requested_by: str) -> WorkflowLogExportTask | None:
        """Return the admitted caller's latest live export for the app, or None if it is unavailable."""
        return self._tasks.get_latest(tenant_id=scope.tenant_id, app_id=scope.app_id, requested_by=requested_by)

    def prepare_task(self, *, tenant_id: str, app_id: str, task_id: str) -> None:
        """Load the task for the workspace and app and prepare its CSV if it is still pending."""
        task = self._tasks.get(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
        prepare_log_export_task(
            task,
            tasks=self._tasks,
            storage_prefix="workflow-log-exports",
            store_csv=self._store_csv,
            write_csv=self._write_csv,
        )
