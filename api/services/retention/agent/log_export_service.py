"""Create temporary CSV export tasks for an admitted Agent."""

from collections.abc import Callable

from machinery.context import RequestContext
from services.agent.observability_contracts import AgentLogExportFilters, AgentLogExportQuery, AgentObservability
from services.retention.log_export_task import LogExportTask

AgentLogExportTask = LogExportTask[AgentLogExportFilters]


class AgentLogExportService:
    """Persist the caller's pending export for the Agent in their active workspace."""

    def __init__(self, *, logs: AgentObservability, save_task: Callable[[AgentLogExportTask], None]) -> None:
        """Bind Agent scope and filter resolution and temporary task storage."""
        self._logs = logs
        self._save_task = save_task

    def create_task(self, context: RequestContext, agent_id: str, query: AgentLogExportQuery) -> AgentLogExportTask:
        """Validate the Agent and its filters, then return the pending task after persistence succeeds."""
        filters = self._logs.resolve_log_export_filters(context, agent_id, query)
        task = AgentLogExportTask.pending(
            tenant_id=context.active_workspace_id,
            app_id=agent_id,  # Scope the shared task store by the Console Agent ID.
            requested_by=context.account_id,
            filters=filters,
        )
        self._save_task(task)
        return task
