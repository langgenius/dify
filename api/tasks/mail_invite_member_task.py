import logging
import time

import click
from celery import shared_task  # type: ignore
from flask import render_template

from configs import dify_config
from extensions.ext_mail import mail
from services.feature_service import FeatureService


@shared_task(queue="mail")
def send_invite_member_mail_task(language: str, to: str, token: str, inviter_name: str, workspace_name: str):
    """
    Async Send invite member mail
    :param language
    :param to
    :param token
    :param inviter_name
    :param workspace_name

    Usage: send_invite_member_mail_task.delay(language, to, token, inviter_name, workspace_name)
    """
    if not mail.is_inited():
        return

    logging.info(
        click.style("Start send invite member mail to {} in workspace {}".format(to, workspace_name), fg="green")
    )
    start_at = time.perf_counter()

    # send invite member mail using different languages
    try:
        url = f"{dify_config.CONSOLE_WEB_URL}/activate?token={token}"
        if language == "zh-Hans":
            template = "invite_member_mail_template_zh-CN.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                application_title = system_features.branding.application_title
                template = "without-brand/invite_member_mail_template_zh-CN.html"
                html_content = render_template(
                    template,
                    to=to,
                    inviter_name=inviter_name,
                    workspace_name=workspace_name,
                    url=url,
                    application_title=application_title,
                )
                mail.send(to=to, subject=f"立即加入 {application_title} 工作空间", html=html_content)
            else:
                html_content = render_template(
                    template, to=to, inviter_name=inviter_name, workspace_name=workspace_name, url=url
                )
                mail.send(to=to, subject="立即加入 Dify 工作空间", html=html_content)
        else:
            template = "invite_member_mail_template_en-US.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                application_title = system_features.branding.application_title
                template = "without-brand/invite_member_mail_template_en-US.html"
                html_content = render_template(
                    template,
                    to=to,
                    inviter_name=inviter_name,
                    workspace_name=workspace_name,
                    url=url,
                    application_title=application_title,
                )
                mail.send(to=to, subject=f"Join {application_title} Workspace Now", html=html_content)
            else:
                html_content = render_template(
                    template, to=to, inviter_name=inviter_name, workspace_name=workspace_name, url=url
                )
                mail.send(to=to, subject="Join Dify Workspace Now", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send invite member mail to {} succeeded: latency: {}".format(to, end_at - start_at), fg="green"
            )
        )
    except Exception:
        logging.exception("Send invite member mail to {} failed".format(to))
