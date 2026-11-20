"""Generate the CSV for the published runs of one Workflow app."""

from datetime import UTC
from typing import TextIO

from libs.datetime_utils import ensure_naive_utc
from machinery.context import RequestContext
from services.retention.log_export_csv import write_log_export_csv
from services.retention.workflow_run.log_export_service import WorkflowLogExportFilters
from services.workflow_app_log_query_service import WorkflowAppLogQueryService


class WorkflowLogCsvWriter:
    """Resolve the app and write one CSV row per run matching the submitted filters."""

    def __init__(self, *, logs: WorkflowAppLogQueryService) -> None:
        self._logs = logs

    def write_csv(
        self, context: RequestContext, app_id: str, *, filters: WorkflowLogExportFilters, output: TextIO
    ) -> int:
        """Require a live Workflow app in the caller's workspace and an open text stream."""
        scope = self._logs.get_log_export_scope(context, app_id)
        rows = self._logs.iter_log_export_rows(scope=scope, filters=filters)
        return write_log_export_csv(
            output,
            (
                {
                    "app_id": scope.app_id,
                    "app_type": "Workflow",
                    "end_user_id": row.end_user_id,
                    "account_id": row.account_id,
                    "account_name": row.account_name,
                    "run_id": row.run_id,
                    "created_at": ensure_naive_utc(row.created_at).replace(tzinfo=UTC).isoformat(),
                    "user_input": row.inputs,
                    "app_response": row.outputs,
                    "status": row.status,
                    "trigger_by": row.trigger_by,
                }
                for row in rows
            ),
        )
