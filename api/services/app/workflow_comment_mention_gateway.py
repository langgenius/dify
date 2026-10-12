"""Celery adapter that delivers workflow comment mention notifications by email."""

from collections.abc import Sequence
from typing import override

from services.app.workflow_comment_service import (
    WorkflowCommentMentionNotification,
    WorkflowCommentMentionNotifier,
)
from tasks.mail_workflow_comment_task import send_workflow_comment_mention_email_task


class CeleryWorkflowCommentMentionNotifier(WorkflowCommentMentionNotifier):
    @override
    def notify(self, notifications: Sequence[WorkflowCommentMentionNotification]) -> None:
        for notification in notifications:
            send_workflow_comment_mention_email_task.delay(
                language=notification.language,
                to=notification.to,
                mentioned_name=notification.mentioned_name,
                commenter_name=notification.commenter_name,
                app_name=notification.app_name,
                comment_content=notification.comment_content,
                app_url=notification.app_url,
            )
