"""Write the filtered logs of one Agent to CSV."""

from contextlib import closing
from datetime import UTC
from typing import TextIO

from libs.datetime_utils import ensure_naive_utc
from machinery.context import RequestContext
from services.agent.observability_contracts import AgentLogExportFilters, AgentObservability
from services.retention.log_export_csv import CsvRowProgress, write_log_export_csv

_LOG_CSV_COLUMNS = (
    "app_type",
    "end_user_id",
    "account_id",
    "conversation_id",
    "message_id",
    "created_at",
    "user_input",
    "app_response",
    "feedback_rating",
    "feedback_content",
    "status",
    "source",
    "agent_id",
)


class AgentLogCsvWriter:
    """Write one row per matching WebApp message or Workflow Agent execution."""

    def __init__(self, *, logs: AgentObservability) -> None:
        """Use the Agent observability port for scoped, detached log reads."""
        self._logs = logs

    def write_csv(
        self,
        context: RequestContext,
        agent_id: str,
        *,
        filters: AgentLogExportFilters,
        output: TextIO,
        report_rows: CsvRowProgress | None = None,
    ) -> int:
        """Write Agent-specific columns and rows for an admitted Agent and return the row count.

        The caller owns the stream and publishes it only on success, since an error
        may leave partial output.
        """
        return self.write_scoped_csv(
            tenant_id=context.active_workspace_id,
            agent_id=agent_id,
            filters=filters,
            output=output,
            report_rows=report_rows,
        )

    def write_agent_csv(
        self,
        agent_id: str,
        *,
        filters: AgentLogExportFilters,
        output: TextIO,
        report_rows: CsvRowProgress | None = None,
    ) -> int:
        """Resolve a trusted server operator's Agent target and write its existing logs to the open stream."""
        tenant_id = self._logs.get_log_export_workspace_id(agent_id)
        return self.write_scoped_csv(
            tenant_id=tenant_id, agent_id=agent_id, filters=filters, output=output, report_rows=report_rows
        )

    def write_scoped_csv(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        filters: AgentLogExportFilters,
        output: TextIO,
        report_rows: CsvRowProgress | None = None,
    ) -> int:
        """Write rows from an existing Agent runtime in the supplied workspace and return the row count."""
        with closing(self._logs.iter_export_rows(tenant_id=tenant_id, agent_id=agent_id, filters=filters)) as rows:
            return write_log_export_csv(
                output,
                (
                    {
                        "app_type": "New Agent",
                        "agent_id": agent_id,
                        "end_user_id": row.end_user_id,
                        "account_id": row.account_id,
                        "conversation_id": row.conversation_id,
                        "message_id": row.message_id,
                        "created_at": ensure_naive_utc(row.created_at).replace(tzinfo=UTC).isoformat(),
                        "user_input": row.user_input,
                        "app_response": row.app_response,
                        "feedback_rating": row.feedback_rating,
                        "feedback_content": row.feedback_content,
                        "status": row.status,
                        "source": row.source,
                    }
                    for row in rows
                ),
                columns=_LOG_CSV_COLUMNS,
                report_rows=report_rows,
            )
