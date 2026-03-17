import datetime
import logging
import random
import time
from collections.abc import Sequence
from typing import TYPE_CHECKING, cast

import sqlalchemy as sa
from sqlalchemy import delete, select, tuple_
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from configs import dify_config
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
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


if TYPE_CHECKING:
    from opentelemetry.metrics import Counter, Histogram


class MessagesCleanupMetrics:
    """
    Records low-cardinality OpenTelemetry metrics for expired message cleanup jobs.

    We keep labels stable (dry_run/window_mode/task_label/status) so these metrics remain
    dashboard-friendly for long-running CronJob executions.
    """

    _job_runs_total: "Counter | None"
    _batches_total: "Counter | None"
    _messages_scanned_total: "Counter | None"
    _messages_filtered_total: "Counter | None"
    _messages_deleted_total: "Counter | None"
    _job_duration_seconds: "Histogram | None"
    _batch_duration_seconds: "Histogram | None"
    _base_attributes: dict[str, str]

    def __init__(self, *, dry_run: bool, has_window: bool, task_label: str) -> None:
        self._job_runs_total = None
        self._batches_total = None
        self._messages_scanned_total = None
        self._messages_filtered_total = None
        self._messages_deleted_total = None
        self._job_duration_seconds = None
        self._batch_duration_seconds = None
        self._base_attributes = {
            "job_name": "messages_cleanup",
            "dry_run": str(dry_run).lower(),
            "window_mode": "between" if has_window else "before_cutoff",
            "task_label": task_label,
        }
        self._init_instruments()

    def _init_instruments(self) -> None:
        if not dify_config.ENABLE_OTEL:
            return

        try:
            from opentelemetry.metrics import get_meter

            meter = get_meter("messages_cleanup", version=dify_config.project.version)
            self._job_runs_total = meter.create_counter(
                "messages_cleanup_jobs_total",
                description="Total number of expired message cleanup jobs by status.",
                unit="{job}",
            )
            self._batches_total = meter.create_counter(
                "messages_cleanup_batches_total",
                description="Total number of message cleanup batches processed.",
                unit="{batch}",
            )
            self._messages_scanned_total = meter.create_counter(
                "messages_cleanup_scanned_messages_total",
                description="Total messages scanned by cleanup jobs.",
                unit="{message}",
            )
            self._messages_filtered_total = meter.create_counter(
                "messages_cleanup_filtered_messages_total",
                description="Total messages selected by cleanup policy.",
                unit="{message}",
            )
            self._messages_deleted_total = meter.create_counter(
                "messages_cleanup_deleted_messages_total",
                description="Total messages deleted by cleanup jobs.",
                unit="{message}",
            )
            self._job_duration_seconds = meter.create_histogram(
                "messages_cleanup_job_duration_seconds",
                description="Duration of expired message cleanup jobs in seconds.",
                unit="s",
            )
            self._batch_duration_seconds = meter.create_histogram(
                "messages_cleanup_batch_duration_seconds",
                description="Duration of expired message cleanup batch processing in seconds.",
                unit="s",
            )
        except Exception:
            logger.exception("messages_cleanup_metrics: failed to initialize instruments")

    def _attrs(self, **extra: str) -> dict[str, str]:
        return {**self._base_attributes, **extra}

    @staticmethod
    def _add(counter: "Counter | None", value: int, attributes: dict[str, str]) -> None:
        if not counter or value <= 0:
            return
        try:
            counter.add(value, attributes)
        except Exception:
            logger.exception("messages_cleanup_metrics: failed to add counter value")

    @staticmethod
    def _record(histogram: "Histogram | None", value: float, attributes: dict[str, str]) -> None:
        if not histogram:
            return
        try:
            histogram.record(value, attributes)
        except Exception:
            logger.exception("messages_cleanup_metrics: failed to record histogram value")

    def record_batch(
        self,
        *,
        scanned_messages: int,
        filtered_messages: int,
        deleted_messages: int,
        batch_duration_seconds: float,
    ) -> None:
        attributes = self._attrs()
        self._add(self._batches_total, 1, attributes)
        self._add(self._messages_scanned_total, scanned_messages, attributes)
        self._add(self._messages_filtered_total, filtered_messages, attributes)
        self._add(self._messages_deleted_total, deleted_messages, attributes)
        self._record(self._batch_duration_seconds, batch_duration_seconds, attributes)

    def record_completion(self, *, status: str, job_duration_seconds: float) -> None:
        attributes = self._attrs(status=status)
        self._add(self._job_runs_total, 1, attributes)
        self._record(self._job_duration_seconds, job_duration_seconds, attributes)


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
        task_label: str = "custom",
    ) -> None:
        """
        Initialize the service with cleanup parameters.

        Args:
            policy: The policy that determines which messages to delete
            end_before: End time (exclusive) of the range
            start_from: Optional start time (inclusive) of the range
            batch_size: Number of messages to process per batch
            dry_run: Whether to perform a dry run (no actual deletion)
            task_label: Optional task label for retention metrics
        """
        self._policy = policy
        self._end_before = end_before
        self._start_from = start_from
        self._batch_size = batch_size
        self._dry_run = dry_run
        self._metrics = MessagesCleanupMetrics(
            dry_run=dry_run,
            has_window=bool(start_from),
            task_label=task_label,
        )

    @classmethod
    def from_time_range(
        cls,
        policy: MessagesCleanPolicy,
        start_from: datetime.datetime,
        end_before: datetime.datetime,
        batch_size: int = 1000,
        dry_run: bool = False,
        task_label: str = "custom",
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
            task_label: Optional task label for retention metrics

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
            task_label=task_label,
        )

    @classmethod
    def from_days(
        cls,
        policy: MessagesCleanPolicy,
        days: int = 30,
        batch_size: int = 1000,
        dry_run: bool = False,
        task_label: str = "custom",
    ) -> "MessagesCleanService":
        """
        Create a service instance for cleaning messages older than specified days.

        Args:
            policy: The policy that determines which messages to delete
            days: Number of days to look back from now
            batch_size: Number of messages to process per batch
            dry_run: Whether to perform a dry run (no actual deletion)
            task_label: Optional task label for retention metrics

        Returns:
            MessagesCleanService instance

        Raises:
            ValueError: If invalid parameters
        """
        if days < 0:
            raise ValueError(f"days ({days}) must be greater than or equal to 0")

        if batch_size <= 0:
            raise ValueError(f"batch_size ({batch_size}) must be greater than 0")

        end_before = naive_utc_now() - datetime.timedelta(days=days)

        logger.info(
            "clean_messages: days=%s, end_before=%s, batch_size=%s, policy=%s",
            days,
            end_before,
            batch_size,
            policy.__class__.__name__,
        )

        return cls(
            policy=policy,
            end_before=end_before,
            start_from=None,
            batch_size=batch_size,
            dry_run=dry_run,
            task_label=task_label,
        )

    def run(self) -> dict[str, int]:
        """
        Execute the message cleanup operation.

        Returns:
            Dict with statistics: batches, filtered_messages, total_deleted
        """
        status = "success"
        run_start = time.monotonic()
        try:
            return self._clean_messages_by_time_range()
        except Exception:
            status = "failed"
            raise
        finally:
            self._metrics.record_completion(
                status=status,
                job_duration_seconds=time.monotonic() - run_start,
            )

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

        max_batch_interval_ms = dify_config.SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_MAX_INTERVAL

        while True:
            stats["batches"] += 1
            batch_start = time.monotonic()
            batch_scanned_messages = 0
            batch_filtered_messages = 0
            batch_deleted_messages = 0

            # Step 1: Fetch a batch of messages using cursor
            with Session(db.engine, expire_on_commit=False) as session:
                fetch_messages_start = time.monotonic()
                msg_stmt = (
                    select(Message.id, Message.app_id, Message.created_at)
                    .where(Message.created_at < self._end_before)
                    .order_by(Message.created_at, Message.id)
                    .limit(self._batch_size)
                )

                if self._start_from:
                    msg_stmt = msg_stmt.where(Message.created_at >= self._start_from)

                # Apply cursor condition: (created_at, id) > (last_created_at, last_message_id)
                if _cursor:
                    msg_stmt = msg_stmt.where(
                        tuple_(Message.created_at, Message.id)
                        > tuple_(
                            sa.literal(_cursor[0], type_=sa.DateTime()),
                            sa.literal(_cursor[1], type_=Message.id.type),
                        )
                    )

                raw_messages = list(session.execute(msg_stmt).all())
                messages = [
                    SimpleMessage(id=msg_id, app_id=app_id, created_at=msg_created_at)
                    for msg_id, app_id, msg_created_at in raw_messages
                ]
                logger.info(
                    "clean_messages (batch %s): fetched %s messages in %sms",
                    stats["batches"],
                    len(messages),
                    int((time.monotonic() - fetch_messages_start) * 1000),
                )

                # Track total messages fetched across all batches
                stats["total_messages"] += len(messages)
                batch_scanned_messages = len(messages)

                if not messages:
                    logger.info("clean_messages (batch %s): no more messages to process", stats["batches"])
                    self._metrics.record_batch(
                        scanned_messages=batch_scanned_messages,
                        filtered_messages=batch_filtered_messages,
                        deleted_messages=batch_deleted_messages,
                        batch_duration_seconds=time.monotonic() - batch_start,
                    )
                    break

                # Update cursor to the last message's (created_at, id)
                _cursor = (messages[-1].created_at, messages[-1].id)

                # Step 2: Extract app_ids and query tenant_ids
                app_ids = list({msg.app_id for msg in messages})

                if not app_ids:
                    logger.info("clean_messages (batch %s): no app_ids found, skip", stats["batches"])
                    continue

                fetch_apps_start = time.monotonic()
                app_stmt = select(App.id, App.tenant_id).where(App.id.in_(app_ids))
                apps = list(session.execute(app_stmt).all())
                logger.info(
                    "clean_messages (batch %s): fetched %s apps for %s app_ids in %sms",
                    stats["batches"],
                    len(apps),
                    len(app_ids),
                    int((time.monotonic() - fetch_apps_start) * 1000),
                )

            if not apps:
                logger.info("clean_messages (batch %s): no apps found, skip", stats["batches"])
                self._metrics.record_batch(
                    scanned_messages=batch_scanned_messages,
                    filtered_messages=batch_filtered_messages,
                    deleted_messages=batch_deleted_messages,
                    batch_duration_seconds=time.monotonic() - batch_start,
                )
                continue

            # Build app_id -> tenant_id mapping
            app_to_tenant: dict[str, str] = {app.id: app.tenant_id for app in apps}

            # Step 3: Delegate to policy to determine which messages to delete
            policy_start = time.monotonic()
            message_ids_to_delete = self._policy.filter_message_ids(messages, app_to_tenant)
            logger.info(
                "clean_messages (batch %s): policy selected %s/%s messages in %sms",
                stats["batches"],
                len(message_ids_to_delete),
                len(messages),
                int((time.monotonic() - policy_start) * 1000),
            )

            if not message_ids_to_delete:
                logger.info("clean_messages (batch %s): no messages to delete, skip", stats["batches"])
                self._metrics.record_batch(
                    scanned_messages=batch_scanned_messages,
                    filtered_messages=batch_filtered_messages,
                    deleted_messages=batch_deleted_messages,
                    batch_duration_seconds=time.monotonic() - batch_start,
                )
                continue

            stats["filtered_messages"] += len(message_ids_to_delete)
            batch_filtered_messages = len(message_ids_to_delete)

            # Step 4: Batch delete messages and their relations
            if not self._dry_run:
                with Session(db.engine, expire_on_commit=False) as session:
                    delete_relations_start = time.monotonic()
                    # Delete related records first
                    self._batch_delete_message_relations(session, message_ids_to_delete)
                    delete_relations_ms = int((time.monotonic() - delete_relations_start) * 1000)

                    # Delete messages
                    delete_messages_start = time.monotonic()
                    delete_stmt = delete(Message).where(Message.id.in_(message_ids_to_delete))
                    delete_result = cast(CursorResult, session.execute(delete_stmt))
                    messages_deleted = delete_result.rowcount
                    delete_messages_ms = int((time.monotonic() - delete_messages_start) * 1000)
                    commit_start = time.monotonic()
                    session.commit()
                    commit_ms = int((time.monotonic() - commit_start) * 1000)

                    stats["total_deleted"] += messages_deleted
                    batch_deleted_messages = messages_deleted

                    logger.info(
                        "clean_messages (batch %s): processed %s messages, deleted %s messages",
                        stats["batches"],
                        len(messages),
                        messages_deleted,
                    )
                    logger.info(
                        "clean_messages (batch %s): relations %sms,  messages %sms, commit %sms, batch total %sms",
                        stats["batches"],
                        delete_relations_ms,
                        delete_messages_ms,
                        commit_ms,
                        int((time.monotonic() - batch_start) * 1000),
                    )

                # Random sleep between batches to avoid overwhelming the database
                sleep_ms = random.uniform(0, max_batch_interval_ms)  # noqa: S311
                logger.info("clean_messages (batch %s): sleeping for %.2fms", stats["batches"], sleep_ms)
                time.sleep(sleep_ms / 1000)
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

            self._metrics.record_batch(
                scanned_messages=batch_scanned_messages,
                filtered_messages=batch_filtered_messages,
                deleted_messages=batch_deleted_messages,
                batch_duration_seconds=time.monotonic() - batch_start,
            )

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
