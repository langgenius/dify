import json
import logging
import time
from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime
from uuid import UUID

import click
from celery import shared_task
from pydantic import TypeAdapter, ValidationError
from redis.exceptions import RedisError
from sqlalchemy import and_, delete, or_, select

from configs import dify_config
from core.db.session_factory import session_factory
from extensions.ext_redis import redis_client
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
from models.agent import AgentWorkingResourceStatus, AgentWorkspace, AgentWorkspaceOwnerType
from models.human_input import HumanInputDelivery, HumanInputFormRecipient
from models.tools import ToolConversationVariables, ToolFile
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection

logger = logging.getLogger(__name__)

_MAX_RETRIES = 5
_RETRY_DELAY_SECONDS = 30
_ORPHANED_WORKSPACE_CURSOR_KEY = "conversation:orphaned-workspace-cleanup-cursor"
_ORPHANED_WORKSPACE_CURSOR = TypeAdapter(tuple[datetime | None, UUID])


def _delete_storage_object(file_key: str) -> None:
    try:
        storage.delete(file_key)
    except Exception:
        # A prior attempt may have deleted the object before its DB transaction
        # rolled back. Only suppress the retry when the backend confirms absence.
        if storage.exists(file_key):
            raise
        logger.info("Storage object %s was already absent", file_key)


def _group_workspace_ids(rows: Iterable[tuple[str, str]]) -> dict[str, list[str]]:
    """Group trusted Workspace rows by tenant for post-commit collection."""
    by_tenant: defaultdict[str, list[str]] = defaultdict(list)
    for tenant_id, workspace_id in rows:
        by_tenant[tenant_id].append(workspace_id)
    return by_tenant


def _cleanup_conversation_related_data(conversation_id: str) -> bool:
    """Remove an absent or soft-deleted conversation's data and enqueue retired Workspaces.

    The storage object is deleted before its ``ToolFile`` row so a failed attempt
    retains the durable ``file_key`` needed by the next retry. Retired Workspaces
    are rediscovered on retry even if the Conversation removal already committed.
    An active Conversation returns False and leaves its resources untouched.
    """

    with session_factory.create_session() as session:
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

        form_ids = select(HumanInputForm.id).where(HumanInputForm.conversation_id == conversation_id)
        session.execute(delete(HumanInputFormUploadFile).where(HumanInputFormUploadFile.form_id.in_(form_ids)))
        session.execute(delete(HumanInputFormUploadToken).where(HumanInputFormUploadToken.form_id.in_(form_ids)))
        session.execute(delete(HumanInputFormRecipient).where(HumanInputFormRecipient.form_id.in_(form_ids)))
        session.execute(delete(HumanInputDelivery).where(HumanInputDelivery.form_id.in_(form_ids)))
        session.execute(delete(HumanInputForm).where(HumanInputForm.conversation_id == conversation_id))

        session.execute(delete(Message).where(Message.conversation_id == conversation_id))
        session.execute(delete(PinnedConversation).where(PinnedConversation.conversation_id == conversation_id))
        session.execute(delete(AgentDebugConversation).where(AgentDebugConversation.conversation_id == conversation_id))
        workspaces = session.execute(
            select(AgentWorkspace.tenant_id, AgentWorkspace.id).where(
                AgentWorkspace.owner_type == AgentWorkspaceOwnerType.CONVERSATION,
                AgentWorkspace.owner_id == conversation_id,
                AgentWorkspace.status == AgentWorkingResourceStatus.RETIRED,
            )
        )
        workspaces_by_tenant = _group_workspace_ids(workspaces.tuples())
        session.execute(
            delete(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.is_deleted.is_(True),
            )
        )
        session.commit()
    for tenant_id, workspace_ids in workspaces_by_tenant.items():
        enqueue_agent_resource_collection(tenant_id=tenant_id, workspace_ids=workspace_ids)
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


def _read_orphaned_workspace_cursor() -> tuple[datetime | None, str] | None:
    try:
        cursor: object = redis_client.get(_ORPHANED_WORKSPACE_CURSOR_KEY)
    except (RedisError, RuntimeError):
        logger.warning("Unable to read retired Workspace cleanup cursor", exc_info=True)
        return None
    if not isinstance(cursor, (str, bytes)):
        return None
    try:
        retired_at, workspace_id = _ORPHANED_WORKSPACE_CURSOR.validate_json(cursor)
        return retired_at, str(workspace_id)
    except ValidationError:
        logger.warning("Ignoring invalid retired Workspace cleanup cursor")
        return None


@shared_task(queue="conversation")
def sweep_deleted_conversations() -> int:
    """Redispatch soft-deleted conversations and their detached retired Workspaces.

    Limit each query separately so outstanding conversation cleanups cannot
    prevent recovery after a conversation deletion has already committed. Return
    the number of conversation and Workspace IDs successfully dispatched. The
    detached Workspace scan wraps at the tail so failed rows remain eligible
    without preventing other Workspaces from being dispatched.
    """

    batch_size = dify_config.CONVERSATION_CLEANUP_BATCH_SIZE
    cursor = _read_orphaned_workspace_cursor()
    with session_factory.create_session() as session:
        conversation_ids = list(
            session.scalars(
                select(Conversation.id)
                .where(Conversation.is_deleted.is_(True))
                .order_by(Conversation.updated_at, Conversation.id)
                .limit(batch_size)
            )
        )
        orphan_query = (
            select(AgentWorkspace.tenant_id, AgentWorkspace.id, AgentWorkspace.retired_at)
            .where(
                AgentWorkspace.owner_type == AgentWorkspaceOwnerType.CONVERSATION,
                AgentWorkspace.status == AgentWorkingResourceStatus.RETIRED,
                ~select(Conversation.id).where(Conversation.id == AgentWorkspace.owner_id).exists(),
            )
            .order_by(AgentWorkspace.retired_at.is_not(None), AgentWorkspace.retired_at, AgentWorkspace.id)
            .limit(batch_size)
        )
        orphaned = []
        if cursor is not None:
            retired_at, workspace_id = cursor
            if retired_at is None:
                after_cursor = or_(
                    AgentWorkspace.retired_at.is_not(None),
                    and_(AgentWorkspace.retired_at.is_(None), AgentWorkspace.id > workspace_id),
                )
            else:
                after_cursor = or_(
                    AgentWorkspace.retired_at > retired_at,
                    and_(AgentWorkspace.retired_at == retired_at, AgentWorkspace.id > workspace_id),
                )
            orphaned = list(session.execute(orphan_query.where(after_cursor)).tuples())
        if not orphaned:
            orphaned = list(session.execute(orphan_query).tuples())
        workspaces_by_tenant = _group_workspace_ids(
            (tenant_id, workspace_id) for tenant_id, workspace_id, _ in orphaned
        )

    dispatched = 0
    for conversation_id in conversation_ids:
        try:
            delete_conversation_related_data.delay(conversation_id)
            dispatched += 1
        except Exception:
            logger.exception("Failed to dispatch cleanup for conversation %s", conversation_id)
    for tenant_id, workspace_ids in workspaces_by_tenant.items():
        try:
            enqueue_agent_resource_collection(tenant_id=tenant_id, workspace_ids=workspace_ids)
            dispatched += len(workspace_ids)
        except Exception:
            logger.exception(
                "Failed to redispatch retired conversation Workspaces",
                extra={"tenant_id": tenant_id, "workspace_ids": workspace_ids},
            )
    if orphaned:
        _, workspace_id, retired_at = orphaned[-1]
        try:
            _ = redis_client.set(
                _ORPHANED_WORKSPACE_CURSOR_KEY,
                json.dumps([retired_at.isoformat() if retired_at is not None else None, workspace_id]),
            )
        except (RedisError, RuntimeError):
            logger.warning("Unable to advance retired Workspace cleanup cursor", exc_info=True)
    return dispatched
