"""Render shared Console responses for authorized CSV exports."""

from http import HTTPStatus
from itertools import chain

from flask import Response

from configs import dify_config
from controllers.common.errors import ForbiddenError
from extensions.ext_application_services import application_services
from extensions.ext_mail import is_enabled as is_mail_enabled
from services.retention.log_export_task import (
    LogExportDownload,
    LogExportKind,
    LogExportStatus,
    LogExportTask,
    LogExportTaskNotFoundError,
)


def log_export_file_response(download: LogExportDownload, *, filename: str) -> Response:
    """Redirect to a signed URL or attach the CSV and close its stream with the response."""
    if isinstance(download, str):
        response = Response(status=HTTPStatus.FOUND, headers={"Location": download})
    else:
        first_chunk, stream = download
        response = Response(chain((first_chunk,), stream), mimetype="text/csv")
        response.headers.set("Content-Disposition", "attachment", filename=filename)
        response.call_on_close(stream.close)
    response.cache_control.no_store = True
    return response


def _log_export_email_is_available() -> bool:
    """Check for configured mail and a public Console URL to put in the email."""
    return is_mail_enabled() and bool(dify_config.CONSOLE_API_URL or dify_config.CONSOLE_WEB_URL)


def log_export_status_email_preference[FiltersT](
    task: LogExportTask[FiltersT], *, account_id: str, export_kind: LogExportKind
) -> dict[str, object]:
    """Expose the private preference only to the requester when mail is configured."""
    if (
        task.requested_by != account_id
        or task.status in (LogExportStatus.FAILED, LogExportStatus.CANCELED)
        or not _log_export_email_is_available()
    ):
        return {}
    state = application_services().log_export_email_notifications.get_state(
        tenant_id=task.tenant_id, app_id=task.app_id, task_id=task.task_id, export_kind=export_kind
    )
    return {"email_notification": state.value}


def update_log_export_email_preference[FiltersT](
    task: LogExportTask[FiltersT], *, account_id: str, export_kind: LogExportKind, enabled: bool
) -> tuple[dict[str, object], HTTPStatus, dict[str, str]]:
    """Update the admitted requester's preference and queue mail if the file is ready."""
    if task.requested_by != account_id:
        raise LogExportTaskNotFoundError()
    if not _log_export_email_is_available():
        raise ForbiddenError("Email notifications are not available.")
    state = application_services().log_export_email_notifications.set_enabled(
        tenant_id=task.tenant_id,
        app_id=task.app_id,
        task_id=task.task_id,
        export_kind=export_kind,
        requested_by=account_id,
        enabled=enabled,
    )
    return {"email_notification": state.value}, HTTPStatus.OK, {"Cache-Control": "no-store"}
