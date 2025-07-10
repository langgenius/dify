import logging
import time

import click
from celery import shared_task  # type: ignore
from flask import render_template

from extensions.ext_mail import mail


@shared_task(queue="mail")
def send_change_mail_task(language: str, to: str, code: str, phase: str):
    """
    Async Send change email mail
    :param language: Language in which the email should be sent (e.g., 'en', 'zh')
    :param to: Recipient email address
    :param code: Change email code
    :param phase: Change email phase (new_email, old_email)
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start change email mail to {}".format(to), fg="green"))
    start_at = time.perf_counter()

    # send change email mail using different languages
    try:
        if phase == "old_email" :
            template = "change_mail_confirm_old_template_en-US.html"
        elif phase == "new_email":
            template = "change_mail_confirm_new_template_en-US.html"
        else:
            raise ValueError("Invalid phase")
        
        if language == "zh-Hans":
            html_content = render_template(template, to=to, code=code)
            mail.send(to=to, subject="检测您现在的邮箱", html=html_content)
        else:
            html_content = render_template(template, to=to, code=code)
            mail.send(to=to, subject="Check your current email", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style("Send change email mail to {} succeeded: latency: {}".format(to, end_at - start_at), fg="green")
        )
    except Exception:
        logging.exception("Send change email mail to {} failed".format(to))
