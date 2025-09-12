import logging
import time

import click
from celery import shared_task

from configs import dify_config
from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service

logger = logging.getLogger(__name__)


@shared_task(queue="mail")
def send_reset_password_mail_task(language: str, to: str, code: str):
    """
    Send reset password email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        code: Reset password code
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start password reset mail to {to}", fg="green"))
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
        logger.info(
            click.style(f"Send password reset mail to {to} succeeded: latency: {end_at - start_at}", fg="green")
        )
    except Exception:
        logger.exception("Send password reset mail to %s failed", to)


@shared_task(queue="mail")
def send_reset_password_mail_task_when_account_not_exist(language: str, to: str, is_allow_register: bool) -> None:
    """
    Send reset password email with internationalization support when account not exist.

    Args:
        language: Language code for email localization
        to: Recipient email address
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start password reset mail to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        if is_allow_register:
            sign_up_url = f"{dify_config.CONSOLE_WEB_URL}/signup"
            email_service = get_email_i18n_service()
            email_service.send_email(
                email_type=EmailType.RESET_PASSWORD_WHEN_ACCOUNT_NOT_EXIST,
                language_code=language,
                to=to,
                template_context={
                    "to": to,
                    "sign_up_url": sign_up_url,
                },
            )
        else:
            email_service = get_email_i18n_service()
            email_service.send_email(
                email_type=EmailType.RESET_PASSWORD_WHEN_ACCOUNT_NOT_EXIST_NO_REGISTER,
                language_code=language,
                to=to,
            )

        end_at = time.perf_counter()
        logger.info(
            click.style(f"Send password reset mail to {to} succeeded: latency: {end_at - start_at}", fg="green")
        )
    except Exception:
        logger.exception("Send password reset mail to %s failed", to)
