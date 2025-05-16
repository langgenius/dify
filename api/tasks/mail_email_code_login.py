import logging
import time

import click
from celery import shared_task  # type: ignore
from flask import render_template

from extensions.ext_mail import mail
from services.feature_service import FeatureService


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
            template = "email_code_login_mail_template_zh-CN.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                application_title = system_features.branding.application_title
                template = "without-brand/email_code_login_mail_template_zh-CN.html"
                html_content = render_template(template, to=to, code=code, application_title=application_title)
            else:
                html_content = render_template(template, to=to, code=code)
            mail.send(to=to, subject="邮箱验证码", html=html_content)
        else:
            template = "email_code_login_mail_template_en-US.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                application_title = system_features.branding.application_title
                template = "without-brand/email_code_login_mail_template_en-US.html"
                html_content = render_template(template, to=to, code=code, application_title=application_title)
            else:
                html_content = render_template(template, to=to, code=code)
            mail.send(to=to, subject="Email Code", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send email code login mail to {} succeeded: latency: {}".format(to, end_at - start_at), fg="green"
            )
        )
    except Exception:
        logging.exception("Send email code login mail to {} failed".format(to))
