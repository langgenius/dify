"""Create, prepare, and read CSV export tasks for an admitted Workflow app."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from graphon.enums import WorkflowExecutionStatus
from services.retention.log_export_task import (
    LogExportDownload,
    LogExportIdentityLabel,
    LogExportTask,
    LogExportTaskNotFoundError,
    LogExportTaskStore,
    OpenLogExportFile,
    StoreLogExportFile,
    WriteLogExportCsv,
    cancel_pending_log_export_task,
    filter_log_export_identity_labels,
    open_ready_log_export_csv,
    prepare_log_export_task,
    save_and_dispatch_log_export_task,
)


@dataclass(frozen=True, slots=True)
class WorkflowLogExportScope:
    """A resolved Workflow app and its owning workspace."""

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
    """Manage Workflow CSV export tasks within their admitted app scope."""

    def __init__(
        self,
        *,
        tasks: LogExportTaskStore[WorkflowLogExportFilters],
        dispatch: Callable[[str], None],
        store_csv: StoreLogExportFile,
        write_csv: WriteLogExportCsv[WorkflowLogExportFilters],
        open_csv: OpenLogExportFile,
    ) -> None:
        """Bind Workflow task state, delivery, CSV preparation and file storage."""
        self._tasks = tasks
        self._dispatch = dispatch
        self._store_csv = store_csv
        self._write_csv = write_csv
        self._open_csv = open_csv

    def create_task(
        self,
        *,
        scope: WorkflowLogExportScope,
        requested_by: str,
        filters: WorkflowLogExportFilters,
        identity_labels: tuple[LogExportIdentityLabel, ...] = (),
        estimated_rows: int | None = None,
    ) -> WorkflowLogExportTask:
        """Save and dispatch a pending task with its admitted scope, filters and selected labels."""
        task = WorkflowLogExportTask.pending(
            tenant_id=scope.tenant_id,
            app_id=scope.app_id,
            requested_by=requested_by,
            filters=filters,
            identity_labels=filter_log_export_identity_labels(
                identity_labels, end_user_ids=filters.end_user_ids, account_ids=filters.account_ids
            ),
            estimated_rows=estimated_rows,
        )
        save_and_dispatch_log_export_task(task, tasks=self._tasks, dispatch=self._dispatch)
        return task

    def get_task(self, *, scope: WorkflowLogExportScope, task_id: str) -> WorkflowLogExportTask:
        """Return a live task in the admitted workspace and app, or raise if unavailable."""
        task = self._tasks.get(tenant_id=scope.tenant_id, app_id=scope.app_id, task_id=task_id)
        if task is None:
            raise LogExportTaskNotFoundError()
        return task

    def cancel_task(self, *, scope: WorkflowLogExportScope, requested_by: str, task_id: str) -> WorkflowLogExportTask:
        """Cancel the requester's queued export in the admitted Workflow app."""
        task = self.get_task(scope=scope, task_id=task_id)
        return cancel_pending_log_export_task(
            task, requested_by=requested_by, tasks=self._tasks, dispatch=self._dispatch
        )

    def get_latest_task(self, *, scope: WorkflowLogExportScope, requested_by: str) -> WorkflowLogExportTask | None:
        """Return the admitted caller's latest live export for the app, or None if it is unavailable."""
        return self._tasks.get_latest(tenant_id=scope.tenant_id, app_id=scope.app_id, requested_by=requested_by)

    def download_csv(self, *, scope: WorkflowLogExportScope, task_id: str, filename: str) -> LogExportDownload:
        """Serve a ready export in the admitted app as a signed URL or an open CSV stream."""
        task = self.get_task(scope=scope, task_id=task_id)
        return open_ready_log_export_csv(task, open_csv=self._open_csv, filename=filename)

    def prepare_task(self, *, tenant_id: str, app_id: str, task_id: str) -> WorkflowLogExportTask | None:
        """Load the task in the workspace and return it if this attempt publishes its CSV."""
        task = self._tasks.get(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
        return prepare_log_export_task(
            task,
            tasks=self._tasks,
            storage_prefix="workflow-log-exports",
            store_csv=self._store_csv,
            write_csv=self._write_csv,
        )
