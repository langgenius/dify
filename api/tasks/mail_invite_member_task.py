import logging
import time

import click
from celery import shared_task  # type: ignore

from configs import dify_config
from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service


@shared_task(queue="mail")
def send_invite_member_mail_task(language: str, to: str, token: str, inviter_name: str, workspace_name: str) -> None:
    """
    Send invite member email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        token: Invitation token
        inviter_name: Name of the person sending the invitation
        workspace_name: Name of the workspace
    """
    if not mail.is_inited():
        return

    logging.info(
        click.style("Start send invite member mail to {} in workspace {}".format(to, workspace_name), fg="green")
    )
    start_at = time.perf_counter()

    try:
        url = f"{dify_config.CONSOLE_WEB_URL}/activate?token={token}"
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.INVITE_MEMBER,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "inviter_name": inviter_name,
                "workspace_name": workspace_name,
                "url": url,
            },
        )

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Send invite member mail to {} succeeded: latency: {}".format(to, end_at - start_at), fg="green"
            )
        )
    except Exception:
        logging.exception("Send invite member mail to {} failed".format(to))
