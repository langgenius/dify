import logging
import time

import click
from celery import shared_task
from flask import current_app, render_template

from extensions.ext_mail import mail


@shared_task(queue='mail')
def send_reset_password_mail_task(language: str, to: str, token: str):
    """
    Async Send reset password mail
    :param language: Language in which the email should be sent (e.g., 'en', 'zh')
    :param to: Recipient email address
    :param token: Reset password token to be included in the email
    """
    if not mail.is_inited():
        return

    logging.info(click.style('Start password reset mail to {}'.format(to), fg='green'))
    start_at = time.perf_counter()

    # send reset password mail using different languages
    try:
        url = f'{current_app.config.get("CONSOLE_WEB_URL")}/forgot-password?token={token}'
        if language == 'zh-Hans':
            html_content = render_template('reset_password_mail_template_zh-CN.html',
                                           to=to,
                                           url=url)
            mail.send(to=to, subject="重置您的 Dify 密码", html=html_content)
        else:
            html_content = render_template('reset_password_mail_template_en-US.html',
                                           to=to,
                                           url=url)
            mail.send(to=to, subject="Reset Your Dify Password", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style('Send password reset mail to {} succeeded: latency: {}'.format(to, end_at - start_at),
                        fg='green'))
    except Exception:
        logging.exception("Send password reset mail to {} failed".format(to))
