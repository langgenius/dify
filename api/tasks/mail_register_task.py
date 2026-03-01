import logging
import time

import click
from celery import shared_task

from configs import dify_config
from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service

logger = logging.getLogger(__name__)


@shared_task(queue="mail")
def send_email_register_mail_task(language: str, to: str, code: str) -> None:
    """
    Send email register email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        code: Email register code
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start email register mail to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.EMAIL_REGISTER,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "code": code,
            },
        )

        end_at = time.perf_counter()
        logger.info(
            click.style(f"Send email register mail to {to} succeeded: latency: {end_at - start_at}", fg="green")
        )
    except Exception:
        logger.exception("Send email register mail to %s failed", to)


@shared_task(queue="mail")
def send_email_register_mail_task_when_account_exist(language: str, to: str, account_name: str) -> None:
    """
    Send email register email with internationalization support when account exist.

    Args:
        language: Language code for email localization
        to: Recipient email address
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start email register mail to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        login_url = f"{dify_config.CONSOLE_WEB_URL}/signin"
        reset_password_url = f"{dify_config.CONSOLE_WEB_URL}/reset-password"

        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.EMAIL_REGISTER_WHEN_ACCOUNT_EXIST,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "login_url": login_url,
                "reset_password_url": reset_password_url,
                "account_name": account_name,
            },
        )

        end_at = time.perf_counter()
        logger.info(
            click.style(f"Send email register mail to {to} succeeded: latency: {end_at - start_at}", fg="green")
        )
    except Exception:
        logger.exception("Send email register mail to %s failed", to)
