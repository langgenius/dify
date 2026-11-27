import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

import click
from celery import shared_task

from extensions.ext_mail import Mail, mail
from libs.email_i18n import EmailI18nService, EmailType, get_email_i18n_service

logger = logging.getLogger(__name__)


@shared_task(queue="mail")
def send_email_code_login_mail_task(language: str, to: str, code: str) -> None:
    """
    Send email code login email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        code: Email verification code
    """
    LoginCodeMailDelivery(mail, get_email_i18n_service).send(language, to, code)


@dataclass(frozen=True)
class LoginCodeMailDelivery:
    """Deliver login mail using explicit mail and lazily constructed email services."""

    mail_service: Mail
    email_service_factory: Callable[[], EmailI18nService]

    def send(self, language: str, to: str, code: str) -> None:
        """Render and deliver in a Flask context when the injected mail is initialized.

        Unavailable mail does not resolve the factory or log delivery. Factory,
        rendering and transport failures are logged and swallowed.
        """
        if not self.mail_service.is_inited():
            return

        logger.info(click.style(f"Start email code login mail to {to}", fg="green"))
        start_at = time.perf_counter()

        try:
            email_service = self.email_service_factory()
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
