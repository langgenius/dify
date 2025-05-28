import logging
import time

import click
from celery import shared_task  # type: ignore
from flask import render_template

from extensions.ext_mail import mail


@shared_task(queue="mail")
def send_deletion_success_task(to):
    """Send email to user regarding account deletion."""
    if not mail.is_inited():
        return

    logging.info(click.style(f"Start send account deletion success email to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        html_content = render_template(
            "delete_account_success_template_en-US.html",
            to=to,
            email=to,
        )
        mail.send(to=to, subject="Your Dify.AI Account Has Been Successfully Deleted", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send account deletion success email to {}: latency: {}".format(to, end_at - start_at), fg="green"
            )
        )
    except Exception:
        logging.exception("Send account deletion success email to {} failed".format(to))


@shared_task(queue="mail")
def send_account_deletion_verification_code(to, code):
    """Send email to user regarding account deletion verification code.

    Args:
        to (str): Recipient email address
        code (str): Verification code
    """
    if not mail.is_inited():
        return

    logging.info(click.style(f"Start send account deletion verification code email to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        html_content = render_template("delete_account_code_email_template_en-US.html", to=to, code=code)
        mail.send(to=to, subject="Dify.AI Account Deletion and Verification", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send account deletion verification code email to {} succeeded: latency: {}".format(
                    to, end_at - start_at
                ),
                fg="green",
            )
        )
    except Exception:
        logging.exception("Send account deletion verification code email to {} failed".format(to))
