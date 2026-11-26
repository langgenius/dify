"""Manage temporary CSV exports for an admitted Agent."""

from collections.abc import Callable

from machinery.context import RequestContext
from services.agent.observability_contracts import AgentLogExportFilters, AgentLogExportQuery, AgentObservability
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

AgentLogExportTask = LogExportTask[AgentLogExportFilters]


class AgentLogExportService:
    """Manage CSV exports within the Agent's admitted workspace scope."""

    def __init__(
        self,
        *,
        logs: AgentObservability,
        tasks: LogExportTaskStore[AgentLogExportFilters],
        dispatch: Callable[[str], None],
        store_csv: StoreLogExportFile,
        write_csv: WriteLogExportCsv[AgentLogExportFilters],
        open_csv: OpenLogExportFile,
    ) -> None:
        """Bind Agent log reads, task persistence, dispatch and CSV storage."""
        self._logs = logs
        self._tasks = tasks
        self._dispatch = dispatch
        self._store_csv = store_csv
        self._write_csv = write_csv
        self._open_csv = open_csv

    def create_task(
        self,
        context: RequestContext,
        agent_id: str,
        query: AgentLogExportQuery,
        *,
        identity_labels: tuple[LogExportIdentityLabel, ...] = (),
        estimated_rows: int | None = None,
    ) -> AgentLogExportTask:
        """Save and dispatch a task with the admitted scope, resolved filters and selected labels."""
        filters = self._logs.resolve_log_export_filters(context, agent_id, query)
        task = AgentLogExportTask.pending(
            tenant_id=context.active_workspace_id,
            app_id=agent_id,  # Scope the shared task store by the Console Agent ID.
            requested_by=context.account_id,
            filters=filters,
            identity_labels=filter_log_export_identity_labels(
                identity_labels, end_user_ids=filters.end_user_ids, account_ids=filters.account_ids
            ),
            estimated_rows=estimated_rows,
        )
        save_and_dispatch_log_export_task(task, tasks=self._tasks, dispatch=self._dispatch)
        return task

    def get_task(self, context: RequestContext, agent_id: str, *, task_id: str) -> AgentLogExportTask:
        """Return a live task in the admitted Agent's scope or raise if it is unavailable."""
        self._logs.require_log_export_scope(context, agent_id)
        task = self._tasks.get(tenant_id=context.active_workspace_id, app_id=agent_id, task_id=task_id)
        if task is None:
            raise LogExportTaskNotFoundError()
        return task

    def cancel_task(self, context: RequestContext, agent_id: str, *, task_id: str) -> AgentLogExportTask:
        """Cancel the requester's queued export in the admitted Agent."""
        task = self.get_task(context, agent_id, task_id=task_id)
        return cancel_pending_log_export_task(
            task, requested_by=context.account_id, tasks=self._tasks, dispatch=self._dispatch
        )

    def get_latest_task(self, context: RequestContext, agent_id: str) -> AgentLogExportTask | None:
        """Return the caller's latest live task in the admitted Agent's scope, if one exists."""
        self._logs.require_log_export_scope(context, agent_id)
        return self._tasks.get_latest(
            tenant_id=context.active_workspace_id, app_id=agent_id, requested_by=context.account_id
        )

    def download_csv(self, context: RequestContext, agent_id: str, *, task_id: str, filename: str) -> LogExportDownload:
        """Open a ready task in the admitted Agent's scope or return its short-lived download URL."""
        task = self.get_task(context, agent_id, task_id=task_id)
        return open_ready_log_export_csv(task, open_csv=self._open_csv, filename=filename)

    def prepare_task(self, *, tenant_id: str, app_id: str, task_id: str) -> AgentLogExportTask | None:
        """Load the task by its scoped Agent ID and return it if this attempt publishes its CSV."""
        task = self._tasks.get(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
        return prepare_log_export_task(
            task,
            tasks=self._tasks,
            storage_prefix="agent-log-exports",
            store_csv=self._store_csv,
            write_csv=self._write_csv,
        )
