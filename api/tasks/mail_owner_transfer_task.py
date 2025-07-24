import logging
import time

import click
from celery import shared_task  # type: ignore

from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service


@shared_task(queue="mail")
def send_owner_transfer_confirm_task(language: str, to: str, code: str, workspace: str) -> None:
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

    logging.info(click.style("Start owner transfer confirm mail to {}".format(to), fg="green"))
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
        logging.info(
            click.style(
                "Send owner transfer confirm mail to {} succeeded: latency: {}".format(to, end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("owner transfer confirm email mail to {} failed".format(to))


@shared_task(queue="mail")
def send_old_owner_transfer_notify_email_task(language: str, to: str, workspace: str, new_owner_email: str) -> None:
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

    logging.info(click.style("Start old owner transfer notify mail to {}".format(to), fg="green"))
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
        logging.info(
            click.style(
                "Send old owner transfer notify mail to {} succeeded: latency: {}".format(to, end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("old owner transfer notify email mail to {} failed".format(to))


@shared_task(queue="mail")
def send_new_owner_transfer_notify_email_task(language: str, to: str, workspace: str) -> None:
    """
    Send new owner transfer notification email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        workspace: Workspace name
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start new owner transfer notify mail to {}".format(to), fg="green"))
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
        logging.info(
            click.style(
                "Send new owner transfer notify mail to {} succeeded: latency: {}".format(to, end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("new owner transfer notify email mail to {} failed".format(to))
