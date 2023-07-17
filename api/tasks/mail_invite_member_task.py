import logging
import time

import click
from celery import shared_task
from flask import current_app

from extensions.ext_mail import mail


@shared_task
def send_invite_member_mail_task(to: str, token: str, inviter_name: str, workspace_id: str, workspace_name: str):
    """
    Async Send invite member mail
    :param to
    :param token
    :param inviter_name
    :param workspace_id
    :param workspace_name

    Usage: send_invite_member_mail_task.delay(to, token, inviter_name, workspace_id, workspace_name)
    """
    if not mail.is_inited():
        return

    logging.info(click.style('Start send invite member mail to {} in workspace {}'.format(to, workspace_name),
                             fg='green'))
    start_at = time.perf_counter()

    try:
        mail.send(
            to=to,
            subject="{} invited you to join {}".format(inviter_name, workspace_name),
            html="""<p>Hi there,</p>
<p>{inviter_name} invited you to join {workspace_name}.</p>
<p>Click <a href="{url}">here</a> to join.</p>
<p>Thanks,</p>
<p>Dify Team</p>""".format(inviter_name=inviter_name, workspace_name=workspace_name,
                           url='{}/activate?workspace_id={}&email={}&token={}'.format(
                               current_app.config.get("CONSOLE_WEB_URL"),
                               workspace_id,
                               to,
                               token)
                           )
        )

        end_at = time.perf_counter()
        logging.info(
            click.style('Send invite member mail to {} succeeded: latency: {}'.format(to, end_at - start_at),
                        fg='green'))
    except Exception:
        logging.exception("Send invite member mail to {} failed".format(to))
