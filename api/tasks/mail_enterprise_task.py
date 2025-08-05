import logging
import time
from collections.abc import Mapping

import click
from celery import shared_task  # type: ignore
from flask import render_template_string

from extensions.ext_mail import mail
from libs.email_i18n import get_email_i18n_service


@shared_task(queue="mail")
def send_enterprise_email_task(to: list[str], subject: str, body: str, substitutions: Mapping[str, str]):
    if not mail.is_inited():
        return

    logging.info(click.style(f"Start enterprise mail to {to} with subject {subject}", fg="green"))
    start_at = time.perf_counter()

    try:
        html_content = render_template_string(body, **substitutions)

        email_service = get_email_i18n_service()
        email_service.send_raw_email(to=to, subject=subject, html_content=html_content)

        end_at = time.perf_counter()
        logging.info(click.style(f"Send enterprise mail to {to} succeeded: latency: {end_at - start_at}", fg="green"))
    except Exception:
        logging.exception("Send enterprise mail to %s failed", to)
