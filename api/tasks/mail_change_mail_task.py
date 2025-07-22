import logging
import time

import click
from celery import shared_task  # type: ignore
from flask import render_template

from extensions.ext_mail import mail
from services.feature_service import FeatureService


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

    email_config = {
        "zh-Hans": {
            "old_email": {
                "subject": "检测您现在的邮箱",
                "template_with_brand": "change_mail_confirm_old_template_zh-CN.html",
                "template_without_brand": "without-brand/change_mail_confirm_old_template_zh-CN.html",
            },
            "new_email": {
                "subject": "确认您的邮箱地址变更",
                "template_with_brand": "change_mail_confirm_new_template_zh-CN.html",
                "template_without_brand": "without-brand/change_mail_confirm_new_template_zh-CN.html",
            },
        },
        "en": {
            "old_email": {
                "subject": "Check your current email",
                "template_with_brand": "change_mail_confirm_old_template_en-US.html",
                "template_without_brand": "without-brand/change_mail_confirm_old_template_en-US.html",
            },
            "new_email": {
                "subject": "Confirm your new email address",
                "template_with_brand": "change_mail_confirm_new_template_en-US.html",
                "template_without_brand": "without-brand/change_mail_confirm_new_template_en-US.html",
            },
        },
    }

    # send change email mail using different languages
    try:
        system_features = FeatureService.get_system_features()
        lang_key = "zh-Hans" if language == "zh-Hans" else "en"

        if phase not in ["old_email", "new_email"]:
            raise ValueError("Invalid phase")

        config = email_config[lang_key][phase]
        subject = config["subject"]

        if system_features.branding.enabled:
            template = config["template_without_brand"]
        else:
            template = config["template_with_brand"]

        html_content = render_template(template, to=to, code=code)
        mail.send(to=to, subject=subject, html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style("Send change email mail to {} succeeded: latency: {}".format(to, end_at - start_at), fg="green")
        )
    except Exception:
        logging.exception("Send change email mail to {} failed".format(to))
