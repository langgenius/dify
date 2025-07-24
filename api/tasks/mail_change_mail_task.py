import logging
import time

import click
from celery import shared_task  # type: ignore

from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service


@shared_task(queue="mail")
def send_change_mail_task(language: str, to: str, code: str, phase: str) -> None:
    """
    Send change email notification with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        code: Email verification code
        phase: Change email phase ('old_email' or 'new_email')
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start change email mail to {}".format(to), fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_change_email(
            language_code=language,
            to=to,
            code=code,
            phase=phase,
        )

        end_at = time.perf_counter()
        logging.info(
            click.style("Send change email mail to {} succeeded: latency: {}".format(to, end_at - start_at), fg="green")
        )
    except Exception:
        logging.exception("Send change email mail to {} failed".format(to))


@shared_task(queue="mail")
def send_change_mail_completed_notification_task(language: str, to: str) -> None:
    """
    Send change email completed notification with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start change email completed notify mail to {}".format(to), fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.CHANGE_EMAIL_COMPLETED,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "email": to,
            },
        )

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send change email completed mail to {} succeeded: latency: {}".format(to, end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("Send change email completed mail to {} failed".format(to))
