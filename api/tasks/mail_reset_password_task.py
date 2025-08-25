import logging
import time

import click
from celery import shared_task

from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service


@shared_task(queue="mail")
def send_reset_password_mail_task(language: str, to: str, code: str) -> None:
    """
    Send reset password email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        code: Reset password code
    """
    if not mail.is_inited():
        return

    logging.info(click.style(f"Start password reset mail to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.RESET_PASSWORD,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "code": code,
            },
        )

        end_at = time.perf_counter()
        logging.info(
            click.style(f"Send password reset mail to {to} succeeded: latency: {end_at - start_at}", fg="green")
        )
    except Exception:
        logging.exception("Send password reset mail to %s failed", to)
