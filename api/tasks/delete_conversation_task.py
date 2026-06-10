import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete

from core.db.session_factory import session_factory
from models import ConversationVariable
from models.model import Message, MessageAnnotation, MessageFeedback
from models.tools import ToolConversationVariables, ToolFile
from models.web import PinnedConversation

logger = logging.getLogger(__name__)


@shared_task(queue="conversation")
def delete_conversation_related_data(conversation_id: str):
    """
    Delete related data conversation in correct order from datatbase to respect foreign key constraints

    Args:
        conversation_id: conversation Id
    """

    logger.info(
        click.style(f"Starting to delete conversation data from db for conversation_id {conversation_id}", fg="green")
    )
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        try:
            session.execute(delete(MessageAnnotation).where(MessageAnnotation.conversation_id == conversation_id))

            session.execute(delete(MessageFeedback).where(MessageFeedback.conversation_id == conversation_id))

            session.execute(
                delete(ToolConversationVariables).where(ToolConversationVariables.conversation_id == conversation_id)
            )

            session.execute(delete(ToolFile).where(ToolFile.conversation_id == conversation_id))

            session.execute(delete(ConversationVariable).where(ConversationVariable.conversation_id == conversation_id))

            session.execute(delete(Message).where(Message.conversation_id == conversation_id))

            session.execute(delete(PinnedConversation).where(PinnedConversation.conversation_id == conversation_id))

            session.commit()

            end_at = time.perf_counter()
            logger.info(
                click.style(
                    (
                        f"Succeeded cleaning data from db for conversation_id {conversation_id} "
                        f"latency: {end_at - start_at}"
                    ),
                    fg="green",
                )
            )

        except Exception:
            logger.exception("Failed to delete data from db for conversation_id: %s failed", conversation_id)
            session.rollback()
            raise
