import logging
import time

import click
from celery import shared_task  # type: ignore
from flask import render_template

from extensions.ext_mail import mail


@shared_task(queue="mail")
def send_email_code_login_mail_task(language: str, to: str, code: str):
    """
    Async Send email code login mail
    :param language: Language in which the email should be sent (e.g., 'en', 'zh')
    :param to: Recipient email address
    :param code: Email code to be included in the email
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start email code login mail to {}".format(to), fg="green"))
    start_at = time.perf_counter()

    # send email code login mail using different languages
    try:
        if language == "zh-Hans":
            html_content = render_template("email_code_login_mail_template_zh-CN.html", to=to, code=code)
            mail.send(to=to, subject="邮箱验证码", html=html_content)
        else:
            html_content = render_template("email_code_login_mail_template_en-US.html", to=to, code=code)
            mail.send(to=to, subject="Email Code", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send email code login mail to {} succeeded: latency: {}".format(to, end_at - start_at), fg="green"
            )
        )
    except Exception:
        logging.exception("Send email code login mail to {} failed".format(to))
