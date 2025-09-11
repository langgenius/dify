import logging
import time

import click
from celery import shared_task

from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service

logger = logging.getLogger(__name__)


@shared_task(queue="mail")
def send_owner_transfer_confirm_task(language: str, to: str, code: str, workspace: str):
    """
    Send owner transfer confirmation email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        code: Verification code
        workspace: Workspace name
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start owner transfer confirm mail to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.OWNER_TRANSFER_CONFIRM,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "code": code,
                "WorkspaceName": workspace,
            },
        )

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Send owner transfer confirm mail to {to} succeeded: latency: {end_at - start_at}",
                fg="green",
            )
        )
    except Exception:
        logger.exception("owner transfer confirm email mail to %s failed", to)


@shared_task(queue="mail")
def send_old_owner_transfer_notify_email_task(language: str, to: str, workspace: str, new_owner_email: str):
    """
    Send old owner transfer notification email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        workspace: Workspace name
        new_owner_email: New owner email address
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start old owner transfer notify mail to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.OWNER_TRANSFER_OLD_NOTIFY,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "WorkspaceName": workspace,
                "NewOwnerEmail": new_owner_email,
            },
        )

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Send old owner transfer notify mail to {to} succeeded: latency: {end_at - start_at}",
                fg="green",
            )
        )
    except Exception:
        logger.exception("old owner transfer notify email mail to %s failed", to)


@shared_task(queue="mail")
def send_new_owner_transfer_notify_email_task(language: str, to: str, workspace: str):
    """
    Send new owner transfer notification email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        workspace: Workspace name
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start new owner transfer notify mail to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.OWNER_TRANSFER_NEW_NOTIFY,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "WorkspaceName": workspace,
            },
        )

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Send new owner transfer notify mail to {to} succeeded: latency: {end_at - start_at}",
                fg="green",
            )
        )
    except Exception:
        logger.exception("new owner transfer notify email mail to %s failed", to)
