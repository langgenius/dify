import logging
import time
from collections.abc import Mapping

import click
from celery import shared_task
from flask import render_template_string
from jinja2.sandbox import SandboxedEnvironment

from configs import dify_config
from configs.feature import TemplateMode
from extensions.ext_mail import mail
from libs.email_i18n import get_email_i18n_service

logger = logging.getLogger(__name__)
SANDBOX_ENV = SandboxedEnvironment()


def _render_template_with_strategy(body: str, substitutions: Mapping[str, str]) -> str:
    mode = dify_config.MAIL_TEMPLATING_MODE
    if mode == TemplateMode.UNSAFE:
        return render_template_string(body, **substitutions)
    if mode == TemplateMode.SANDBOX:
        tmpl = SANDBOX_ENV.from_string(body)
        return tmpl.render(substitutions)
    if mode == TemplateMode.DISABLED:
        return body
    raise ValueError(f"Unsupported mail templating mode: {dify_config.MAIL_TEMPLATING_MODE}")


@shared_task(queue="mail")
def send_inner_email_task(to: list[str], subject: str, body: str, substitutions: Mapping[str, str]):
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start enterprise mail to {to} with subject {subject}", fg="green"))
    start_at = time.perf_counter()

    try:
        html_content = _render_template_with_strategy(body, substitutions)

        email_service = get_email_i18n_service()
        email_service.send_raw_email(to=to, subject=subject, html_content=html_content)

        end_at = time.perf_counter()
        logger.info(click.style(f"Send enterprise mail to {to} succeeded: latency: {end_at - start_at}", fg="green"))
    except Exception:
        logger.exception("Send enterprise mail to %s failed", to)
