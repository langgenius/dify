import logging
import time

import click
from celery import shared_task

from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service

logger = logging.getLogger(__name__)


@shared_task(queue="mail")
def send_email_code_login_mail_task(language: str, to: str, code: str):
    """
    Send email code login email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        code: Email verification code
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start email code login mail to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.EMAIL_CODE_LOGIN,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "code": code,
            },
        )

        end_at = time.perf_counter()
        logger.info(
            click.style(f"Send email code login mail to {to} succeeded: latency: {end_at - start_at}", fg="green")
        )
    except Exception:
        logger.exception("Send email code login mail to %s failed", to)
