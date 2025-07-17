import logging
import time

import click
from celery import shared_task  # type: ignore
from flask import render_template

from extensions.ext_mail import mail
from services.feature_service import FeatureService


@shared_task(queue="mail")
def send_owner_transfer_confirm_task(language: str, to: str, code: str, workspace: str):
    """
    Async Send owner transfer confirm mail
    :param language: Language in which the email should be sent (e.g., 'en', 'zh')
    :param to: Recipient email address
    :param workspace: Workspace name
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start change email mail to {}".format(to), fg="green"))
    start_at = time.perf_counter()
    # send change email mail using different languages
    try:
        if language == "zh-Hans":
            template = "transfer_workspace_owner_confirm_template_zh-CN.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                template = "without-brand/transfer_workspace_owner_confirm_template_zh-CN.html"
                html_content = render_template(template, to=to, code=code, WorkspaceName=workspace)
                mail.send(to=to, subject="验证您转移工作空间所有权的请求", html=html_content)
            else:
                html_content = render_template(template, to=to, code=code, WorkspaceName=workspace)
                mail.send(to=to, subject="验证您转移工作空间所有权的请求", html=html_content)
        else:
            template = "transfer_workspace_owner_confirm_template_en-US.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                template = "without-brand/transfer_workspace_owner_confirm_template_en-US.html"
                html_content = render_template(template, to=to, code=code, WorkspaceName=workspace)
                mail.send(to=to, subject="Verify Your Request to Transfer Workspace Ownership", html=html_content)
            else:
                html_content = render_template(template, to=to, code=code, WorkspaceName=workspace)
                mail.send(to=to, subject="Verify Your Request to Transfer Workspace Ownership", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send owner transfer confirm mail to {} succeeded: latency: {}".format(to, end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("owner transfer confirm email mail to {} failed".format(to))


@shared_task(queue="mail")
def send_old_owner_transfer_notify_email_task(language: str, to: str, workspace: str, new_owner_email: str):
    """
    Async Send owner transfer confirm mail
    :param language: Language in which the email should be sent (e.g., 'en', 'zh')
    :param to: Recipient email address
    :param workspace: Workspace name
    :param new_owner_email: New owner email
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start change email mail to {}".format(to), fg="green"))
    start_at = time.perf_counter()
    # send change email mail using different languages
    try:
        if language == "zh-Hans":
            template = "transfer_workspace_old_owner_notify_template_zh-CN.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                template = "without-brand/transfer_workspace_old_owner_notify_template_zh-CN.html"
                html_content = render_template(template, to=to, WorkspaceName=workspace, NewOwnerEmail=new_owner_email)
                mail.send(to=to, subject="工作区所有权已转移", html=html_content)
            else:
                html_content = render_template(template, to=to, WorkspaceName=workspace, NewOwnerEmail=new_owner_email)
                mail.send(to=to, subject="工作区所有权已转移", html=html_content)
        else:
            template = "transfer_workspace_old_owner_notify_template_en-US.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                template = "without-brand/transfer_workspace_old_owner_notify_template_en-US.html"
                html_content = render_template(template, to=to, WorkspaceName=workspace, NewOwnerEmail=new_owner_email)
                mail.send(to=to, subject="Workspace ownership has been transferred", html=html_content)
            else:
                html_content = render_template(template, to=to, WorkspaceName=workspace, NewOwnerEmail=new_owner_email)
                mail.send(to=to, subject="Workspace ownership has been transferred", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send owner transfer confirm mail to {} succeeded: latency: {}".format(to, end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("owner transfer confirm email mail to {} failed".format(to))


@shared_task(queue="mail")
def send_new_owner_transfer_notify_email_task(language: str, to: str, workspace: str):
    """
    Async Send owner transfer confirm mail
    :param language: Language in which the email should be sent (e.g., 'en', 'zh')
    :param to: Recipient email address
    :param code: Change email code
    :param workspace: Workspace name
    """
    if not mail.is_inited():
        return

    logging.info(click.style("Start change email mail to {}".format(to), fg="green"))
    start_at = time.perf_counter()
    # send change email mail using different languages
    try:
        if language == "zh-Hans":
            template = "transfer_workspace_new_owner_notify_template_zh-CN.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                template = "without-brand/transfer_workspace_new_owner_notify_template_zh-CN.html"
                html_content = render_template(template, to=to, WorkspaceName=workspace)
                mail.send(to=to, subject=f"您现在是 {workspace} 的所有者", html=html_content)
            else:
                html_content = render_template(template, to=to, WorkspaceName=workspace)
                mail.send(to=to, subject=f"您现在是 {workspace} 的所有者", html=html_content)
        else:
            template = "transfer_workspace_new_owner_notify_template_en-US.html"
            system_features = FeatureService.get_system_features()
            if system_features.branding.enabled:
                template = "without-brand/transfer_workspace_new_owner_notify_template_en-US.html"
                html_content = render_template(template, to=to, WorkspaceName=workspace)
                mail.send(to=to, subject=f"You are now the owner of {workspace}", html=html_content)
            else:
                html_content = render_template(template, to=to, WorkspaceName=workspace)
                mail.send(to=to, subject=f"You are now the owner of {workspace}", html=html_content)

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send owner transfer confirm mail to {} succeeded: latency: {}".format(to, end_at - start_at),
                fg="green",
            )
        )
    except Exception:
        logging.exception("owner transfer confirm email mail to {} failed".format(to))
