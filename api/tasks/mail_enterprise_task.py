import logging
import time

import click
from celery import shared_task  # type: ignore
from flask import render_template_string

from extensions.ext_mail import mail


@shared_task(queue="mail")
def send_enterprise_email_task(to, subject, body, substitutions):
    if not mail.is_inited():
        return

    logging.info(click.style("Start enterprise mail to {} with subject {}".format(to, subject), fg="green"))
    start_at = time.perf_counter()

    try:
        html_content = render_template_string(body, **substitutions)

        if isinstance(to, list):
            for t in to:
                mail.send(to=t, subject=subject, html=html_content)
        else:
            mail.send(to=to, subject=subject, html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style("Send enterprise mail to {} succeeded: latency: {}".format(to, end_at - start_at), fg="green")
        )
    except Exception:
        logging.exception("Send enterprise mail to {} failed".format(to))
