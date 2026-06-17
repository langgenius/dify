import datetime
import logging
import random
import time
from collections.abc import Sequence
from typing import TYPE_CHECKING, TypedDict, cast

import sqlalchemy as sa
from sqlalchemy import delete, select, tuple_
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

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

_SQL_IN_CHUNK_SIZE = 500


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


class MessagesCleanStatsDict(TypedDict):
    batches: int
    total_messages: int
    filtered_messages: int
    total_deleted: int


class MessagesCleanService:
    """
    Service for cleaning expired messages based on retention policies.

    Compatible with non cloud edition (billing disabled): all messages in the time range will be deleted.
    If billing is enabled: only sandbox plan tenant messages are deleted (with whitelist and grace period support).
    """

    _policy: MessagesCleanPolicy
    _end_before: datetime.datetime
    _start_from: datetime.datetime | None
    _batch_size: int
    _dry_run: bool
    _metrics: MessagesCleanupMetrics
    _app_to_tenant_cache: dict[str, str]

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
        self._app_to_tenant_cache = {}
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

    def run(self) -> MessagesCleanStatsDict:
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

    def _clean_messages_by_time_range(self) -> MessagesCleanStatsDict:
        """
        Clean messages within a time range using cursor-based pagination.

        Time range is [start_from, end_before)

        Steps:
        1. Resolve eligible apps up front when the policy supports tenant prefiltering
        2. Iterate messages using cursor pagination (by created_at, id)
        3. Query or reuse app_id -> tenant_id mapping
        4. Delegate to policy to determine which messages to delete
        5. Batch delete messages and their relations

        Returns:
            Dict with statistics: batches, filtered_messages, total_deleted
        """
        stats: MessagesCleanStatsDict = {
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
        eligible_app_ids = self._resolve_eligible_app_ids()
        if eligible_app_ids is not None:
            if not eligible_app_ids:
                logger.info("clean_messages: no eligible apps found, skip message scan")
                return stats

            logger.info("clean_messages: prefiltered %s eligible apps", len(eligible_app_ids))

        while True:
            stats["batches"] += 1
            batch_start = time.monotonic()
            batch_scanned_messages = 0
            batch_filtered_messages = 0
            batch_deleted_messages = 0
            app_to_tenant: dict[str, str] = {}

            # Step 1: Fetch a batch of messages using cursor
            with sessionmaker(bind=db.engine, expire_on_commit=False).begin() as session:
                fetch_messages_start = time.monotonic()
                msg_stmt = (
                    select(Message.id, Message.app_id, Message.created_at)
                    .where(Message.created_at < self._end_before)
                    .order_by(Message.created_at, Message.id)
                    .limit(self._batch_size)
                )

                if eligible_app_ids is not None:
                    msg_stmt = msg_stmt.where(Message.app_id.in_(eligible_app_ids))

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
                app_to_tenant = self._get_app_to_tenant(session, app_ids)
                logger.info(
                    "clean_messages (batch %s): resolved %s apps for %s app_ids in %sms",
                    stats["batches"],
                    len(app_to_tenant),
                    len(app_ids),
                    int((time.monotonic() - fetch_apps_start) * 1000),
                )

            if not app_to_tenant:
                logger.info("clean_messages (batch %s): no apps found, skip", stats["batches"])
                self._metrics.record_batch(
                    scanned_messages=batch_scanned_messages,
                    filtered_messages=batch_filtered_messages,
                    deleted_messages=batch_deleted_messages,
                    batch_duration_seconds=time.monotonic() - batch_start,
                )
                continue

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
                with sessionmaker(bind=db.engine, expire_on_commit=False).begin() as session:
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
                    commit_ms = 0

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

                self._sleep_after_delete_batch(
                    batch_index=stats["batches"],
                    deleted_messages=batch_deleted_messages,
                    max_batch_interval_ms=max_batch_interval_ms,
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

    def _resolve_eligible_app_ids(self) -> set[str] | None:
        """
        Resolve app IDs that can be scanned before touching the high-volume messages table.

        A None return means the policy intentionally keeps the old query path. For billing-enabled
        sandbox cleanup, this returns only apps whose tenants are eligible for deletion.
        """
        if not self._policy.supports_tenant_prefilter():
            return None

        resolve_start = time.monotonic()
        with sessionmaker(bind=db.engine, expire_on_commit=False).begin() as session:
            tenant_ids = list(session.scalars(select(App.tenant_id).distinct()).all())

        eligible_tenant_ids = self._policy.filter_eligible_tenant_ids(tenant_ids)
        if eligible_tenant_ids is None:
            return None

        if not eligible_tenant_ids:
            logger.info(
                "clean_messages: resolved 0 eligible tenants from %s tenants in %sms",
                len(tenant_ids),
                int((time.monotonic() - resolve_start) * 1000),
            )
            return set()

        eligible_app_ids: set[str] = set()
        with sessionmaker(bind=db.engine, expire_on_commit=False).begin() as session:
            for tenant_id_chunk in self._chunked(list(eligible_tenant_ids), _SQL_IN_CHUNK_SIZE):
                app_stmt = select(App.id, App.tenant_id).where(App.tenant_id.in_(tenant_id_chunk))
                for app_id, tenant_id in session.execute(app_stmt).all():
                    self._app_to_tenant_cache[app_id] = tenant_id
                    eligible_app_ids.add(app_id)

        logger.info(
            "clean_messages: resolved %s eligible tenants and %s apps from %s tenants in %sms",
            len(eligible_tenant_ids),
            len(eligible_app_ids),
            len(tenant_ids),
            int((time.monotonic() - resolve_start) * 1000),
        )
        return eligible_app_ids

    def _get_app_to_tenant(self, session: Session, app_ids: Sequence[str]) -> dict[str, str]:
        missing_app_ids = [app_id for app_id in app_ids if app_id not in self._app_to_tenant_cache]
        for app_id_chunk in self._chunked(missing_app_ids, _SQL_IN_CHUNK_SIZE):
            app_stmt = select(App.id, App.tenant_id).where(App.id.in_(app_id_chunk))
            for app_id, tenant_id in session.execute(app_stmt).all():
                self._app_to_tenant_cache[app_id] = tenant_id

        return {app_id: self._app_to_tenant_cache[app_id] for app_id in app_ids if app_id in self._app_to_tenant_cache}

    def _sleep_after_delete_batch(
        self,
        *,
        batch_index: int,
        deleted_messages: int,
        max_batch_interval_ms: int,
    ) -> None:
        sleep_ms = self._calculate_batch_sleep_ms(
            deleted_messages=deleted_messages,
            max_batch_interval_ms=max_batch_interval_ms,
        )
        if sleep_ms <= 0:
            logger.info(
                "clean_messages (batch %s): skip sleep after deleting %s messages",
                batch_index,
                deleted_messages,
            )
            return

        logger.info(
            "clean_messages (batch %s): sleeping for %.2fms after deleting %s messages",
            batch_index,
            sleep_ms,
            deleted_messages,
        )
        time.sleep(sleep_ms / 1000)

    def _calculate_batch_sleep_ms(self, *, deleted_messages: int, max_batch_interval_ms: int) -> float:
        if deleted_messages <= 0 or max_batch_interval_ms <= 0:
            return 0

        sleep_cap_ms = max_batch_interval_ms * min(deleted_messages / self._batch_size, 1)
        return random.uniform(0, sleep_cap_ms)  # noqa: S311

    @staticmethod
    def _chunked(items: Sequence[str], chunk_size: int) -> list[Sequence[str]]:
        return [items[index : index + chunk_size] for index in range(0, len(items), chunk_size)]

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
