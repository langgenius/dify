import logging
import time

import click
from celery import shared_task
from flask import render_template

from configs import dify_config
from extensions.ext_mail import mail


@shared_task(queue='mail')
def send_invite_member_mail_task(language: str, to: str, token: str, inviter_name: str, workspace_name: str):
    """
    Async Send invite member mail
    :param language
    :param to
    :param token
    :param inviter_name
    :param workspace_name

    Usage: send_invite_member_mail_task.delay(langauge, to, token, inviter_name, workspace_name)
    """
    if not mail.is_inited():
        return

    logging.info(click.style('Start send invite member mail to {} in workspace {}'.format(to, workspace_name),
                             fg='green'))
    start_at = time.perf_counter()

    # send invite member mail using different languages
    try:
        url = f'{dify_config.CONSOLE_WEB_URL}/activate?token={token}'
        if language == 'zh-Hans':
            html_content = render_template('invite_member_mail_template_zh-CN.html',
                                           to=to,
                                           inviter_name=inviter_name,
                                           workspace_name=workspace_name,
                                           url=url)
            mail.send(to=to, subject="立即加入 Dify 工作空间", html=html_content)
        else:
            html_content = render_template('invite_member_mail_template_en-US.html',
                                           to=to,
                                           inviter_name=inviter_name,
                                           workspace_name=workspace_name,
                                           url=url)
            mail.send(to=to, subject="Join Dify Workspace Now", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style('Send invite member mail to {} succeeded: latency: {}'.format(to, end_at - start_at),
                        fg='green'))
    except Exception:
        logging.exception("Send invite member mail to {} failed".format(to))