"""Write the filtered logs of one Agent to CSV."""

from contextlib import closing
from datetime import UTC
from typing import TextIO

from libs.datetime_utils import ensure_naive_utc
from machinery.context import RequestContext
from services.agent.observability_contracts import AgentLogExportFilters, AgentObservability
from services.retention.log_export_csv import write_log_export_csv


class AgentLogCsvWriter:
    """Write one row per matching WebApp message or Workflow Agent execution."""

    def __init__(self, *, logs: AgentObservability) -> None:
        """Use the Agent observability port for scoped, detached log reads."""
        self._logs = logs

    def write_csv(
        self, context: RequestContext, agent_id: str, *, filters: AgentLogExportFilters, output: TextIO
    ) -> int:
        """Write rows for an admitted Agent to an open UTF-8 text stream and return the row count.

        The caller owns the stream and publishes it only on success, since an error
        may leave partial output.
        """
        with closing(self._logs.iter_export_rows(context, agent_id, filters)) as rows:
            return write_log_export_csv(
                output,
                (
                    {
                        "app_type": "New Agent",
                        "agent_id": agent_id,
                        "end_user_id": row.end_user_id,
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
            )
