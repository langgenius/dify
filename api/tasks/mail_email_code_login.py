import logging
import time

import click
from celery import shared_task  # type: ignore

from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service


@shared_task(queue="mail")
def send_email_code_login_mail_task(language: str, to: str, code: str) -> None:
    """
    Send email code login email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        code: Email verification code
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start email code login mail to {}".format(to), fg="green"))
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
        logging.info(
            click.style(
                "Send email code login mail to {} succeeded: latency: {}".format(to, end_at - start_at), fg="green"
            )
        )
    except Exception:
        logging.exception("Send email code login mail to {} failed".format(to))
