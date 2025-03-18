import logging
import time

import click
from celery import shared_task  # type: ignore
from extensions.ext_phone_sms import phone_sms
from flask import render_template


@shared_task(queue="phone_sms")
def send_phone_sms_code_login_task(phone: str, code: str):
    """
    Async Send email code login mail
    :param language: Language in which the email should be sent (e.g., 'en', 'zh')
    :param to: Recipient email address
    :param code: Email code to be included in the email
    """
    if not phone_sms.is_inited():
        return

    logging.info(click.style(f"Start phone sms code login mail to {phone}", fg="green"))
    start_at = time.perf_counter()

    # send email code login mail using different languages
    try:
        phone_sms.send_sms(phone, code)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                f"Send phone sms code login mail to {phone} succeeded: latency: {end_at - start_at}",
                fg="green",
            )
        )
    except Exception as e:
        logging.exception(f"Send phone sms code login mail to {phone} failed: {e}")
