import logging
import time

import click
from celery import shared_task
from flask import render_template

from configs import dify_config
from extensions.ext_mail import mail
from models.dataset import DatasetAutoDisableLog


@shared_task(queue="mail")
def send_document_clean_notify_task():
    """
    Async Send document clean notify mail

    Usage: send_document_clean_notify_task.delay()
    """
    if not mail.is_inited():
        return

    logging.info(
        click.style("Start send document clean notify mail", fg="green")
    )
    start_at = time.perf_counter()

    # send document clean notify mail
    try:
        dataset_auto_disable_logs = DatasetAutoDisableLog.query.all()
        html_content = render_template(
            "clean_document_job_mail_template-US.html",
        )
        mail.send(to=to, subject="立即加入 Dify 工作空间", html=html_content)


        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send document clean notify mail succeeded: latency: {}".format(end_at - start_at), fg="green"
            )
        )
    except Exception:
        logging.exception("Send invite member mail to {} failed".format(to))
