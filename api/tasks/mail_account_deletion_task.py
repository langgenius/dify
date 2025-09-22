import logging
import time

import click
from celery import shared_task

from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service

logger = logging.getLogger(__name__)


@shared_task(queue="mail")
def send_deletion_success_task(to: str, language: str = "en-US"):
    """
    Send account deletion success email with internationalization support.

    Args:
        to: Recipient email address
        language: Language code for email localization
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start send account deletion success email to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.ACCOUNT_DELETION_SUCCESS,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "email": to,
            },
        )

        end_at = time.perf_counter()
        logger.info(
            click.style(f"Send account deletion success email to {to}: latency: {end_at - start_at}", fg="green")
        )
    except Exception:
        logger.exception("Send account deletion success email to %s failed", to)


@shared_task(queue="mail")
def send_account_deletion_verification_code(to: str, code: str, language: str = "en-US"):
    """
    Send account deletion verification code email with internationalization support.

    Args:
        to: Recipient email address
        code: Verification code
        language: Language code for email localization
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start send account deletion verification code email to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.ACCOUNT_DELETION_VERIFICATION,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "code": code,
            },
        )

        end_at = time.perf_counter()
        logger.info(
            click.style(
                "Send account deletion verification code email to {} succeeded: latency: {}".format(
                    to, end_at - start_at
                ),
                fg="green",
            )
        )
    except Exception:
        logger.exception("Send account deletion verification code email to %s failed", to)
