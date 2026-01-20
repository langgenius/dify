import datetime
import logging
import random
from collections.abc import Sequence
from typing import cast

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from extensions.ext_database import db
from models.model import (
    App,
    AppAnnotationHitHistory,
    DatasetRetrieverResource,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageChain,
    MessageFeedback,
    MessageFile,
)
from models.web import SavedMessage
from services.retention.conversation.messages_clean_policy import (
    MessagesCleanPolicy,
    SimpleMessage,
)

logger = logging.getLogger(__name__)


class MessagesCleanService:
    """
    Service for cleaning expired messages based on retention policies.

    Compatible with non cloud edition (billing disabled): all messages in the time range will be deleted.
    If billing is enabled: only sandbox plan tenant messages are deleted (with whitelist and grace period support).
    """

    def __init__(
        self,
        policy: MessagesCleanPolicy,
        end_before: datetime.datetime,
        start_from: datetime.datetime | None = None,
        batch_size: int = 1000,
        dry_run: bool = False,
    ) -> None:
        """
        Initialize the service with cleanup parameters.

        Args:
            policy: The policy that determines which messages to delete
            end_before: End time (exclusive) of the range
            start_from: Optional start time (inclusive) of the range
            batch_size: Number of messages to process per batch
            dry_run: Whether to perform a dry run (no actual deletion)
        """
        self._policy = policy
        self._end_before = end_before
        self._start_from = start_from
        self._batch_size = batch_size
        self._dry_run = dry_run

    @classmethod
    def from_time_range(
        cls,
        policy: MessagesCleanPolicy,
        start_from: datetime.datetime,
        end_before: datetime.datetime,
        batch_size: int = 1000,
        dry_run: bool = False,
    ) -> "MessagesCleanService":
        """
        Create a service instance for cleaning messages within a specific time range.

        Time range is [start_from, end_before).

        Args:
            policy: The policy that determines which messages to delete
            start_from: Start time (inclusive) of the range
            end_before: End time (exclusive) of the range
            batch_size: Number of messages to process per batch
            dry_run: Whether to perform a dry run (no actual deletion)

        Returns:
            MessagesCleanService instance

        Raises:
            ValueError: If start_from >= end_before or invalid parameters
        """
        if start_from >= end_before:
            raise ValueError(f"start_from ({start_from}) must be less than end_before ({end_before})")

        if batch_size <= 0:
            raise ValueError(f"batch_size ({batch_size}) must be greater than 0")

        logger.info(
            "clean_messages: start_from=%s, end_before=%s, batch_size=%s, policy=%s",
            start_from,
            end_before,
            batch_size,
            policy.__class__.__name__,
        )

        return cls(
            policy=policy,
            end_before=end_before,
            start_from=start_from,
            batch_size=batch_size,
            dry_run=dry_run,
        )

    @classmethod
    def from_days(
        cls,
        policy: MessagesCleanPolicy,
        days: int = 30,
        batch_size: int = 1000,
        dry_run: bool = False,
    ) -> "MessagesCleanService":
        """
        Create a service instance for cleaning messages older than specified days.

        Args:
            policy: The policy that determines which messages to delete
            days: Number of days to look back from now
            batch_size: Number of messages to process per batch
            dry_run: Whether to perform a dry run (no actual deletion)

        Returns:
            MessagesCleanService instance

        Raises:
            ValueError: If invalid parameters
        """
        if days < 0:
            raise ValueError(f"days ({days}) must be greater than or equal to 0")

        if batch_size <= 0:
            raise ValueError(f"batch_size ({batch_size}) must be greater than 0")

        end_before = datetime.datetime.now() - datetime.timedelta(days=days)

        logger.info(
            "clean_messages: days=%s, end_before=%s, batch_size=%s, policy=%s",
            days,
            end_before,
            batch_size,
            policy.__class__.__name__,
        )

        return cls(policy=policy, end_before=end_before, start_from=None, batch_size=batch_size, dry_run=dry_run)

    def run(self) -> dict[str, int]:
        """
        Execute the message cleanup operation.

        Returns:
            Dict with statistics: batches, filtered_messages, total_deleted
        """
        return self._clean_messages_by_time_range()

    def _clean_messages_by_time_range(self) -> dict[str, int]:
        """
        Clean messages within a time range using cursor-based pagination.

        Time range is [start_from, end_before)

        Steps:
        1. Iterate messages using cursor pagination (by created_at, id)
        2. Query app_id -> tenant_id mapping
        3. Delegate to policy to determine which messages to delete
        4. Batch delete messages and their relations

        Returns:
            Dict with statistics: batches, filtered_messages, total_deleted
        """
        stats = {
            "batches": 0,
            "total_messages": 0,
            "filtered_messages": 0,
            "total_deleted": 0,
        }

        # Cursor-based pagination using (created_at, id) to avoid infinite loops
        # and ensure proper ordering with time-based filtering
        _cursor: tuple[datetime.datetime, str] | None = None

        logger.info(
            "clean_messages: start cleaning messages (dry_run=%s), start_from=%s, end_before=%s",
            self._dry_run,
            self._start_from,
            self._end_before,
        )

        while True:
            stats["batches"] += 1

            # Step 1: Fetch a batch of messages using cursor
            with Session(db.engine, expire_on_commit=False) as session:
                msg_stmt = (
                    select(Message.id, Message.app_id, Message.created_at)
                    .where(Message.created_at < self._end_before)
                    .order_by(Message.created_at, Message.id)
                    .limit(self._batch_size)
                )

                if self._start_from:
                    msg_stmt = msg_stmt.where(Message.created_at >= self._start_from)

                # Apply cursor condition: (created_at, id) > (last_created_at, last_message_id)
                # This translates to:
                #   created_at > last_created_at OR (created_at = last_created_at AND id > last_message_id)
                if _cursor:
                    # Continuing from previous batch
                    msg_stmt = msg_stmt.where(
                        (Message.created_at > _cursor[0])
                        | ((Message.created_at == _cursor[0]) & (Message.id > _cursor[1]))
                    )

                raw_messages = list(session.execute(msg_stmt).all())
                messages = [
                    SimpleMessage(id=msg_id, app_id=app_id, created_at=msg_created_at)
                    for msg_id, app_id, msg_created_at in raw_messages
                ]

                # Track total messages fetched across all batches
                stats["total_messages"] += len(messages)

                if not messages:
                    logger.info("clean_messages (batch %s): no more messages to process", stats["batches"])
                    break

                # Update cursor to the last message's (created_at, id)
                _cursor = (messages[-1].created_at, messages[-1].id)

                # Step 2: Extract app_ids and query tenant_ids
                app_ids = list({msg.app_id for msg in messages})

                if not app_ids:
                    logger.info("clean_messages (batch %s): no app_ids found, skip", stats["batches"])
                    continue

                app_stmt = select(App.id, App.tenant_id).where(App.id.in_(app_ids))
                apps = list(session.execute(app_stmt).all())

            if not apps:
                logger.info("clean_messages (batch %s): no apps found, skip", stats["batches"])
                continue

            # Build app_id -> tenant_id mapping
            app_to_tenant: dict[str, str] = {app.id: app.tenant_id for app in apps}

            # Step 3: Delegate to policy to determine which messages to delete
            message_ids_to_delete = self._policy.filter_message_ids(messages, app_to_tenant)

            if not message_ids_to_delete:
                logger.info("clean_messages (batch %s): no messages to delete, skip", stats["batches"])
                continue

            stats["filtered_messages"] += len(message_ids_to_delete)

            # Step 4: Batch delete messages and their relations
            if not self._dry_run:
                with Session(db.engine, expire_on_commit=False) as session:
                    # Delete related records first
                    self._batch_delete_message_relations(session, message_ids_to_delete)

                    # Delete messages
                    delete_stmt = delete(Message).where(Message.id.in_(message_ids_to_delete))
                    delete_result = cast(CursorResult, session.execute(delete_stmt))
                    messages_deleted = delete_result.rowcount
                    session.commit()

                    stats["total_deleted"] += messages_deleted

                    logger.info(
                        "clean_messages (batch %s): processed %s messages, deleted %s messages",
                        stats["batches"],
                        len(messages),
                        messages_deleted,
                    )
            else:
                # Log random sample of message IDs that would be deleted (up to 10)
                sample_size = min(10, len(message_ids_to_delete))
                sampled_ids = random.sample(list(message_ids_to_delete), sample_size)

                logger.info(
                    "clean_messages (batch %s, dry_run): would delete %s messages, sampling %s ids:",
                    stats["batches"],
                    len(message_ids_to_delete),
                    sample_size,
                )
                for msg_id in sampled_ids:
                    logger.info("clean_messages (batch %s, dry_run) sample: message_id=%s", stats["batches"], msg_id)

        logger.info(
            "clean_messages completed: total batches: %s, total messages: %s, filtered messages: %s, total deleted: %s",
            stats["batches"],
            stats["total_messages"],
            stats["filtered_messages"],
            stats["total_deleted"],
        )

        return stats

    @staticmethod
    def _batch_delete_message_relations(session: Session, message_ids: Sequence[str]) -> None:
        """
        Batch delete all related records for given message IDs.

        Args:
            session: Database session
            message_ids: List of message IDs to delete relations for
        """
        if not message_ids:
            return

        # Delete all related records in batch
        session.execute(delete(MessageFeedback).where(MessageFeedback.message_id.in_(message_ids)))

        session.execute(delete(MessageAnnotation).where(MessageAnnotation.message_id.in_(message_ids)))

        session.execute(delete(MessageChain).where(MessageChain.message_id.in_(message_ids)))

        session.execute(delete(MessageAgentThought).where(MessageAgentThought.message_id.in_(message_ids)))

        session.execute(delete(MessageFile).where(MessageFile.message_id.in_(message_ids)))

        session.execute(delete(SavedMessage).where(SavedMessage.message_id.in_(message_ids)))

        session.execute(delete(AppAnnotationHitHistory).where(AppAnnotationHitHistory.message_id.in_(message_ids)))

        session.execute(delete(DatasetRetrieverResource).where(DatasetRetrieverResource.message_id.in_(message_ids)))
