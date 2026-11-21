"""Create, prepare, and read temporary CSV export tasks for an admitted Agent."""

from collections.abc import Callable

from machinery.context import RequestContext
from services.agent.observability_contracts import AgentLogExportFilters, AgentLogExportQuery, AgentObservability
from services.retention.log_export_task import (
    LogExportTask,
    LogExportTaskNotFoundError,
    LogExportTaskStore,
    StoreLogExportFile,
    WriteLogExportCsv,
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
        dispatch: Callable[[AgentLogExportTask], None],
        store_csv: StoreLogExportFile,
        write_csv: WriteLogExportCsv[AgentLogExportFilters],
    ) -> None:
        """Bind Agent log reads, task persistence, dispatch and CSV preparation."""
        self._logs = logs
        self._tasks = tasks
        self._dispatch = dispatch
        self._store_csv = store_csv
        self._write_csv = write_csv

    def create_task(self, context: RequestContext, agent_id: str, query: AgentLogExportQuery) -> AgentLogExportTask:
        """Resolve the admitted scope and filters, then save and dispatch the pending task."""
        filters = self._logs.resolve_log_export_filters(context, agent_id, query)
        task = AgentLogExportTask.pending(
            tenant_id=context.active_workspace_id,
            app_id=agent_id,  # Scope the shared task store by the Console Agent ID.
            requested_by=context.account_id,
            filters=filters,
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

    def get_latest_task(self, context: RequestContext, agent_id: str) -> AgentLogExportTask | None:
        """Return the caller's latest live task in the admitted Agent's scope, if one exists."""
        self._logs.require_log_export_scope(context, agent_id)
        return self._tasks.get_latest(
            tenant_id=context.active_workspace_id, app_id=agent_id, requested_by=context.account_id
        )

    def prepare_task(self, *, tenant_id: str, app_id: str, task_id: str) -> None:
        """Load the workspace's task by its Agent ID and prepare the CSV if it is still pending."""
        task = self._tasks.get(tenant_id=tenant_id, app_id=app_id, task_id=task_id)
        prepare_log_export_task(
            task,
            tasks=self._tasks,
            storage_prefix="agent-log-exports",
            store_csv=self._store_csv,
            write_csv=self._write_csv,
        )
