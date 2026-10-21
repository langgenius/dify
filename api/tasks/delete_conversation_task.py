import logging
import time
from itertools import groupby
from operator import itemgetter

import click
from celery import shared_task
from sqlalchemy import delete, select, update

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
from repositories.knowledge.upload_file_repository import (
    AgentConfigToolFileCleanup,
    claim_orphan_agent_config_tool_files,
    claim_orphan_upload_files,
    delete_claimed_agent_config_tool_files,
    find_claimed_agent_config_tool_files,
    recheck_claimed_agent_config_tool_files,
    snapshot_conversation_upload_files,
)
from services.knowledge.file_cleanup_gate import physical_file_cleanup_enabled

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


def _cleanup_claimed_tool_files(
    tenant_id: str,
    files: tuple[AgentConfigToolFileCleanup, ...],
    *,
    excluding_conversation_app_id: str | None = None,
) -> int:
    """Delete claimed ToolFiles without holding a database transaction."""

    if not files or not physical_file_cleanup_enabled():
        return 0
    deleted = 0
    first_error: Exception | None = None
    for candidate in files:
        try:
            with session_factory.create_session() as session, session.begin():
                current = recheck_claimed_agent_config_tool_files(
                    session,
                    tenant_id=tenant_id,
                    files=(candidate,),
                    excluding_conversation_app_id=excluding_conversation_app_id,
                )
            if not current:
                continue
            _delete_storage_object(current[0].key)
            with session_factory.create_session() as session, session.begin():
                deleted_ids = delete_claimed_agent_config_tool_files(
                    session,
                    tenant_id=tenant_id,
                    files=current,
                    excluding_conversation_app_id=excluding_conversation_app_id,
                )
            deleted += len(deleted_ids)
        except Exception as exc:
            logger.exception("ToolFile cleanup failed for tenant=%s file=%s", tenant_id, candidate.id)
            if first_error is None:
                first_error = exc
    if first_error is not None:
        raise first_error
    return deleted


def _cleanup_conversation_related_data(conversation_id: str) -> bool:
    """Physically remove a soft-deleted conversation and its owned resources.

    ToolFile candidates are marked in the owner-removal transaction. Storage is
    deleted after commit, and a failed attempt retains the row and ``file_key``
    for bounded recovery.
    """

    claimed_tool_files: dict[str, tuple[AgentConfigToolFileCleanup, ...]] = {}
    with session_factory.create_session() as session:
        conversation = session.scalar(select(Conversation).where(Conversation.id == conversation_id).with_for_update())
        if conversation is not None and not conversation.is_deleted:
            logger.warning("Skipped cleanup for active conversation %s", conversation_id)
            return False
        upload_file_candidates = snapshot_conversation_upload_files(
            session,
            conversation_id=conversation_id,
        )

        tool_files = list(
            session.scalars(
                select(ToolFile)
                .where(ToolFile.conversation_id == conversation_id)
                .order_by(ToolFile.tenant_id, ToolFile.id)
                .with_for_update()
            )
        )
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

        form_ids = select(HumanInputForm.id).where(HumanInputForm.conversation_id == conversation_id)
        session.execute(delete(HumanInputFormUploadFile).where(HumanInputFormUploadFile.form_id.in_(form_ids)))
        session.execute(delete(HumanInputFormUploadToken).where(HumanInputFormUploadToken.form_id.in_(form_ids)))
        session.execute(delete(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id.in_(form_ids)))
        session.execute(delete(HumanInputDelivery).where(HumanInputDelivery.form_id.in_(form_ids)))
        session.execute(delete(HumanInputForm).where(HumanInputForm.conversation_id == conversation_id))
        session.flush()
        for tenant_id, tenant_files in groupby(upload_file_candidates, key=itemgetter(0)):
            claim_orphan_upload_files(
                session,
                tenant_id=tenant_id,
                files=tuple(file for _, file in tenant_files),
            )

        session.execute(delete(Message).where(Message.conversation_id == conversation_id))
        session.execute(delete(PinnedConversation).where(PinnedConversation.conversation_id == conversation_id))
        session.execute(delete(AgentDebugConversation).where(AgentDebugConversation.conversation_id == conversation_id))
        session.execute(
            delete(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.is_deleted.is_(True),
            )
        )
        session.flush()
        tool_file_ids = tuple(file.id for file in tool_files)
        if tool_file_ids:
            session.execute(
                update(ToolFile)
                .where(ToolFile.id.in_(tool_file_ids), ToolFile.conversation_id == conversation_id)
                .values(conversation_id=None)
            )
        for tenant_id, tenant_tool_files in groupby(tool_files, key=lambda file: file.tenant_id):
            candidates = tuple(AgentConfigToolFileCleanup(id=file.id, key=file.file_key) for file in tenant_tool_files)
            claimed_tool_files[tenant_id] = claim_orphan_agent_config_tool_files(
                session,
                tenant_id=tenant_id,
                files=candidates,
            )
        session.commit()
    first_error: Exception | None = None
    for tenant_id, files in claimed_tool_files.items():
        try:
            _cleanup_claimed_tool_files(tenant_id, files)
        except Exception as exc:
            if first_error is None:
                first_error = exc
    if first_error is not None:
        raise first_error
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


@shared_task(queue="conversation")
def recover_agent_config_tool_file_cleanup() -> int:
    """Recover a bounded batch of ToolFiles left after their last owner detached."""

    if not physical_file_cleanup_enabled():
        return 0
    with session_factory.create_session() as session:
        pending = find_claimed_agent_config_tool_files(
            session,
            limit=dify_config.UPLOAD_FILE_CLEANUP_RECOVERY_BATCH_SIZE,
        )
    files_by_tenant: dict[str, list[AgentConfigToolFileCleanup]] = {}
    for tenant_id, file in pending:
        files_by_tenant.setdefault(tenant_id, []).append(file)
    deleted = 0
    for tenant_id, files in files_by_tenant.items():
        try:
            deleted += _cleanup_claimed_tool_files(tenant_id, tuple(files))
        except Exception:
            logger.exception("Deferred ToolFile cleanup failed for tenant=%s", tenant_id)
    return deleted
