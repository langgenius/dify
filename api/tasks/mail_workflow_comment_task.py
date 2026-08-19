import logging
import time

import click
from celery import shared_task

from extensions.ext_mail import mail
from libs.email_i18n import EmailType, get_email_i18n_service

logger = logging.getLogger(__name__)


@shared_task(queue="mail")
def send_workflow_comment_mention_email_task(
    language: str,
    to: str,
    mentioned_name: str,
    commenter_name: str,
    app_name: str,
    comment_content: str,
    app_url: str,
):
    """
    Send workflow comment mention email with internationalization support.

    Args:
        language: Language code for email localization
        to: Recipient email address
        mentioned_name: Name of the mentioned user
        commenter_name: Name of the comment author
        app_name: Name of the app where the comment was made
        comment_content: Comment content excerpt
        app_url: Link to the app workflow page
    """
    if not mail.is_inited():
        return

    logger.info(click.style(f"Start workflow comment mention mail to {to}", fg="green"))
    start_at = time.perf_counter()

    try:
        email_service = get_email_i18n_service()
        email_service.send_email(
            email_type=EmailType.WORKFLOW_COMMENT_MENTION,
            language_code=language,
            to=to,
            template_context={
                "to": to,
                "mentioned_name": mentioned_name,
                "commenter_name": commenter_name,
                "app_name": app_name,
                "comment_content": comment_content,
                "app_url": app_url,
            },
        )

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Send workflow comment mention mail to {to} succeeded: latency: {end_at - start_at}",
                fg="green",
            )
        )
    except Exception:
        logger.exception("workflow comment mention email to %s failed", to)
