"""Queue and deliver email for a completed CSV log export."""

from datetime import datetime

from celery import shared_task

from configs import dify_config
from extensions.ext_mail import mail
from libs.datetime_utils import ensure_naive_utc
from libs.email_i18n import EmailType, get_email_i18n_service
from services.retention.log_export_adapters import log_export_download_path, read_log_export_app_name
from services.retention.log_export_task import LogExportKind


@shared_task(queue="mail")
def send_log_export_ready_email_task(
    *, tenant_id: str, app_id: str, task_id: str, export_kind: str, requested_by: str, expires_at: str
) -> None:
    """Send to the saved requester only after claiming delivery for the ready export."""
    console_url = dify_config.CONSOLE_API_URL or dify_config.CONSOLE_WEB_URL
    if not mail.is_inited() or not console_url:
        return

    from extensions.ext_application_services import application_services

    services = application_services()
    kind = LogExportKind(export_kind)
    if not services.log_export_email_notifications.claim_delivery(
        tenant_id=tenant_id, app_id=app_id, task_id=task_id, export_kind=kind, requested_by=requested_by
    ):
        return

    account = services.accounts.lifecycle.get_account_by_id(requested_by)
    if account is None or not account.email:
        return

    path = log_export_download_path(app_id=app_id, task_id=task_id, export_kind=kind)
    url = f"{console_url.rstrip('/')}{path}"
    app_name = read_log_export_app_name(tenant_id=tenant_id, app_id=app_id, export_kind=kind)
    expiration = ensure_naive_utc(datetime.fromisoformat(expires_at))
    get_email_i18n_service().send_email(
        email_type=EmailType.LOG_EXPORT_READY,
        language_code=account.interface_language or "en-US",
        to=account.email,
        template_context={
            "app_name": app_name,
            "download_url": url,
            "expires_at": expiration.strftime("%Y-%m-%d %H:%M UTC"),
        },
    )


def dispatch_log_export_email(
    *, tenant_id: str, app_id: str, task_id: str, export_kind: LogExportKind, requested_by: str, expires_at: datetime
) -> None:
    """Queue the saved export identifiers for a mail worker, expiring delivery with the file."""
    send_log_export_ready_email_task.apply_async(
        kwargs={
            "tenant_id": tenant_id,
            "app_id": app_id,
            "task_id": task_id,
            "export_kind": export_kind.value,
            "requested_by": requested_by,
            "expires_at": expires_at.isoformat(),
        },
        expires=expires_at,
    )
