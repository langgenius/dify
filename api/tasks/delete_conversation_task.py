import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from configs import dify_config
from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from models import (
    AgentDebugConversation,
    Conversation,
    ConversationVariable,
    HumanInputForm,
    HumanInputFormUploadFile,
    HumanInputFormUploadToken,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
    PinnedConversation,
    SavedMessage,
)
from models.human_input import HumanInputDelivery, HumanInputFormRecipient
from models.tools import ToolConversationVariables, ToolFile
from repositories.file.upload_file_repository import UploadFileRepository
from services.file_adapters import build_upload_file_reclaimer

logger = logging.getLogger(__name__)

_MAX_RETRIES = 5
_RETRY_DELAY_SECONDS = 30


def _delete_storage_object(file_key: str) -> None:
    try:
        storage.delete(file_key)
    except Exception:
        # A prior attempt may have deleted the object before its DB transaction
        # rolled back. Only suppress the retry when the backend confirms absence.
        if storage.exists(file_key):
            raise
        logger.info("Storage object %s was already absent", file_key)


def _cleanup_conversation_related_data(conversation_id: str) -> bool:
    """Physically remove a soft-deleted conversation and its owned resources.

    The storage object is deleted before its ``ToolFile`` row so a failed attempt
    retains the durable ``file_key`` needed by the next retry.
    """

    sessions = session_factory.get_session_maker()
    upload_files = UploadFileRepository(session_factory=sessions)
    upload_reclaimer = build_upload_file_reclaimer(session_factory=sessions, files=upload_files)
    with sessions() as session:
        conversation = session.scalar(select(Conversation).where(Conversation.id == conversation_id).with_for_update())
        if conversation is not None and not conversation.is_deleted:
            logger.warning("Skipped cleanup for active conversation %s", conversation_id)
            return False

        tool_files = list(
            session.scalars(
                select(ToolFile)
                .where(ToolFile.conversation_id == conversation_id)
                .order_by(ToolFile.id)
                .with_for_update()
            )
        )
        for tool_file in tool_files:
            _delete_storage_object(tool_file.file_key)
            session.delete(tool_file)

        message_ids = select(Message.id).where(Message.conversation_id == conversation_id)
        session.execute(delete(MessageAgentThought).where(MessageAgentThought.message_id.in_(message_ids)))
        session.execute(delete(MessageChain).where(MessageChain.message_id.in_(message_ids)))
        session.execute(delete(MessageFile).where(MessageFile.message_id.in_(message_ids)))
        session.execute(delete(SavedMessage).where(SavedMessage.message_id.in_(message_ids)))
        session.execute(delete(MessageAnnotation).where(MessageAnnotation.conversation_id == conversation_id))
        session.execute(delete(MessageFeedback).where(MessageFeedback.conversation_id == conversation_id))
        session.execute(
            delete(ToolConversationVariables).where(ToolConversationVariables.conversation_id == conversation_id)
        )
        session.execute(delete(ConversationVariable).where(ConversationVariable.conversation_id == conversation_id))

        # Serialize every HITL owner mutation in form -> recipient -> token
        # order. Upload publication takes shared locks in this same order; if it
        # wins, this transaction observes its link, and if cleanup wins, the
        # publisher rechecks the now-missing form and rejects the upload.
        forms = list(
            session.scalars(
                select(HumanInputForm)
                .where(HumanInputForm.conversation_id == conversation_id)
                .order_by(HumanInputForm.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        form_ids = tuple(form.id for form in forms)
        candidates_by_tenant: dict[str, list[str]] = {}
        if form_ids:
            recipients = list(
                session.scalars(
                    select(HumanInputFormRecipient)
                    .where(HumanInputFormRecipient.form_id.in_(form_ids))
                    .order_by(HumanInputFormRecipient.form_id, HumanInputFormRecipient.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            upload_tokens = list(
                session.scalars(
                    select(HumanInputFormUploadToken)
                    .where(HumanInputFormUploadToken.form_id.in_(form_ids))
                    .order_by(HumanInputFormUploadToken.form_id, HumanInputFormUploadToken.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            links = list(
                session.scalars(
                    select(HumanInputFormUploadFile)
                    .where(HumanInputFormUploadFile.form_id.in_(form_ids))
                    .order_by(HumanInputFormUploadFile.form_id, HumanInputFormUploadFile.id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            )
            for link in links:
                candidates_by_tenant.setdefault(link.tenant_id, []).append(link.upload_file_id)
                session.delete(link)
            for upload_token in upload_tokens:
                session.delete(upload_token)
            for recipient in recipients:
                session.delete(recipient)
            session.execute(delete(HumanInputDelivery).where(HumanInputDelivery.form_id.in_(form_ids)))
            for form in forms:
                session.delete(form)

        session.execute(delete(Message).where(Message.conversation_id == conversation_id))
        session.execute(delete(PinnedConversation).where(PinnedConversation.conversation_id == conversation_id))
        session.execute(delete(AgentDebugConversation).where(AgentDebugConversation.conversation_id == conversation_id))
        session.execute(
            delete(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.is_deleted.is_(True),
            )
        )
        # Submitted forms, message text and conversation inputs may reference
        # the same upload as the removed link. Remove all these owners before
        # checking liveness, while retaining the file candidates in this transaction.
        session.flush()
        for tenant_id, file_ids in candidates_by_tenant.items():
            upload_reclaimer.delete_unreferenced_files_in_session(
                session,
                tenant_id=tenant_id,
                file_ids=file_ids,
                delete_blob=_delete_storage_object,
            )
        session.commit()
        return True


@shared_task(queue="conversation", bind=True, max_retries=_MAX_RETRIES, default_retry_delay=_RETRY_DELAY_SECONDS)
def delete_conversation_related_data(self, conversation_id: str) -> None:
    """
    Delete related data conversation in correct order from database to respect foreign key constraints

    Args:
        conversation_id: conversation Id
    """

    logger.info(
        click.style(f"Starting to delete conversation data from db for conversation_id {conversation_id}", fg="green")
    )
    start_at = time.perf_counter()

    try:
        cleaned = _cleanup_conversation_related_data(conversation_id)
    except Exception as exc:
        logger.exception("Failed to delete data for conversation_id: %s", conversation_id)
        countdown = min(_RETRY_DELAY_SECONDS * (2**self.request.retries), 10 * 60)
        raise self.retry(exc=exc, countdown=countdown) from exc

    end_at = time.perf_counter()
    logger.info(
        click.style(
            (
                f"Finished cleaning data for conversation_id {conversation_id}, "
                f"cleaned={cleaned}, latency: {end_at - start_at}"
            ),
            fg="green",
        )
    )


@shared_task(queue="conversation")
def sweep_deleted_conversations() -> int:
    """Re-enqueue soft-deleted conversations whose immediate dispatch was lost."""

    with session_factory.create_session() as session:
        conversation_ids = list(
            session.scalars(
                select(Conversation.id)
                .where(Conversation.is_deleted.is_(True))
                .order_by(Conversation.updated_at, Conversation.id)
                .limit(dify_config.CONVERSATION_CLEANUP_BATCH_SIZE)
            )
        )

    dispatched = 0
    for conversation_id in conversation_ids:
        try:
            delete_conversation_related_data.delay(conversation_id)
            dispatched += 1
        except Exception:
            logger.exception("Failed to dispatch cleanup for conversation %s", conversation_id)
    return dispatched
