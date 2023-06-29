import logging
import time

import click
from celery import shared_task
from werkzeug.exceptions import NotFound

from core.generator.llm_generator import LLMGenerator
from extensions.ext_database import db
from models.model import Conversation, Message


@shared_task
def generate_conversation_summary_task(conversation_id: str):
    """
    Async Generate conversation summary
    :param conversation_id:

    Usage: generate_conversation_summary_task.delay(conversation_id)
    """
    logging.info(click.style('Start generate conversation summary: {}'.format(conversation_id), fg='green'))
    start_at = time.perf_counter()

    conversation = db.session.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise NotFound('Conversation not found')

    try:
        # get conversation messages count
        history_message_count = conversation.message_count
        if history_message_count >= 5 and not conversation.summary:
            app_model = conversation.app
            if not app_model:
                return

            history_messages = db.session.query(Message).filter(Message.conversation_id == conversation.id) \
                .order_by(Message.created_at.asc()).all()

            conversation.summary = LLMGenerator.generate_conversation_summary(app_model.tenant_id, history_messages)
            db.session.add(conversation)
            db.session.commit()

        end_at = time.perf_counter()
        logging.info(click.style('Conversation summary generated: {} latency: {}'.format(conversation_id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("generate conversation summary failed")
