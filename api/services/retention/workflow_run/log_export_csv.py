"""Generate the CSV for the published runs of one Workflow app."""

import json
from datetime import UTC
from typing import TextIO

from libs.datetime_utils import ensure_naive_utc
from machinery.context import RequestContext
from services.retention.log_export_csv import CsvRowProgress, write_log_export_csv
from services.retention.workflow_run.log_export_service import WorkflowLogExportFilters, WorkflowLogExportScope
from services.workflow_app_log_query_service import WorkflowAppLogQueryService

_LOG_CSV_COLUMNS = (
    "app_id",
    "app_type",
    "end_user_id",
    "account_id",
    "account_name",
    "run_id",
    "created_at",
    "user_input",
    "app_response",
    "status",
    "trigger_by",
)


def _format_json_cell(value: str | None) -> str | None:
    """Render escaped Unicode in stored JSON, preserving text that cannot be converted to UTF-8."""
    if value is None or "\\u" not in value:
        return value
    try:
        rendered = json.dumps(json.loads(value), ensure_ascii=False)
        rendered.encode("utf-8")
    except (ValueError, RecursionError):
        return value
    return rendered


class WorkflowLogCsvWriter:
    """Resolve the app and write one CSV row per run matching the submitted filters."""

    def __init__(self, *, logs: WorkflowAppLogQueryService) -> None:
        self._logs = logs

    def write_csv(
        self,
        context: RequestContext,
        app_id: str,
        *,
        filters: WorkflowLogExportFilters,
        output: TextIO,
        report_rows: CsvRowProgress | None = None,
    ) -> int:
        """Write Workflow-run columns for an admitted Workflow app and return the data row count."""
        scope = self._logs.get_log_export_scope(context, app_id)
        return self.write_scoped_csv(scope=scope, filters=filters, output=output, report_rows=report_rows)

    def write_scoped_csv(
        self,
        *,
        scope: WorkflowLogExportScope,
        filters: WorkflowLogExportFilters,
        output: TextIO,
        report_rows: CsvRowProgress | None = None,
    ) -> int:
        """Write matching published runs for an already resolved Workflow app to the caller's UTF-8 stream."""
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
                    "user_input": _format_json_cell(row.inputs),
                    "app_response": _format_json_cell(row.outputs),
                    "status": row.status,
                    "trigger_by": row.trigger_by,
                }
                for row in rows
            ),
            columns=_LOG_CSV_COLUMNS,
            report_rows=report_rows,
        )
