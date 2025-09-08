import logging
import time

import click
from celery import shared_task

from extensions.ext_database import db
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

    try:
        db.session.query(MessageAnnotation).where(MessageAnnotation.conversation_id == conversation_id).delete(
            synchronize_session=False
        )

        db.session.query(MessageFeedback).where(MessageFeedback.conversation_id == conversation_id).delete(
            synchronize_session=False
        )

        db.session.query(ToolConversationVariables).where(
            ToolConversationVariables.conversation_id == conversation_id
        ).delete(synchronize_session=False)

        db.session.query(ToolFile).where(ToolFile.conversation_id == conversation_id).delete(synchronize_session=False)

        db.session.query(ConversationVariable).where(ConversationVariable.conversation_id == conversation_id).delete(
            synchronize_session=False
        )

        db.session.query(Message).where(Message.conversation_id == conversation_id).delete(synchronize_session=False)

        db.session.query(PinnedConversation).where(PinnedConversation.conversation_id == conversation_id).delete(
            synchronize_session=False
        )

        db.session.commit()

        end_at = time.perf_counter()
        logger.info(
            click.style(
                f"Succeeded cleaning data from db for conversation_id {conversation_id} latency: {end_at - start_at}",
                fg="green",
            )
        )

    except Exception as e:
        logger.exception("Failed to delete data from db for conversation_id: %s failed", conversation_id)
        db.session.rollback()
        raise e
    finally:
        db.session.close()
