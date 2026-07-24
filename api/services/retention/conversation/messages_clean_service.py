import datetime
import logging
import math
import random
import time
from collections.abc import Iterator, Sequence
from typing import TYPE_CHECKING, Literal, TypedDict, cast

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
from services.retention.conversation.messages_clean_app_scan import EligibleAppRoundRobinScanner
from services.retention.conversation.messages_clean_policy import (
    EligibleAppMessagesCleanPolicy,
    MessagesCleanPolicy,
    SimpleMessage,
)

logger = logging.getLogger(__name__)


if TYPE_CHECKING:
    from opentelemetry.metrics import Counter, Histogram


_MIN_ELIGIBLE_HIT_RATE = 0.005
_HIT_RATE_EMA_ALPHA = 0.3
MessagesCleanScanStrategy = Literal["auto", "global", "eligible_apps"]


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


class MessageDeleteResultDict(TypedDict):
    messages_deleted: int
    chunks: int
    relations_ms: int
    messages_ms: int


class MessagesCleanService:
    """
    Service for cleaning expired messages based on retention policies.

    Compatible with non cloud edition (billing disabled): all messages in the time range will be deleted.
    If billing is enabled: only sandbox plan tenant messages are deleted (with whitelist and grace period support).

    Billing-disabled cleanup uses the global message cursor because every message in the time range is eligible.
    Billing-enabled cleanup can use an eligible-app round-robin strategy: discover apps whose tenants are sandbox
    and past grace, scan messages through per-app cursors, then revalidate tenant plans immediately before deletion.
    The global cursor remains available as a rollback strategy and for non-billing policies.
    """

    def __init__(
        self,
        policy: MessagesCleanPolicy,
        end_before: datetime.datetime,
        start_from: datetime.datetime | None = None,
        batch_size: int = 1000,
        max_candidate_batch_size: int | None = None,
        delete_batch_size: int | None = None,
        per_app_batch_size: int | None = None,
        app_page_size: int = 500,
        scan_strategy: MessagesCleanScanStrategy = "auto",
        dry_run: bool = False,
        task_label: str = "custom",
    ) -> None:
        """
        Initialize the service with cleanup parameters.

        Args:
            policy: The policy that determines which messages to delete
            end_before: End time (exclusive) of the range
            start_from: Optional start time (inclusive) of the range
            batch_size: Initial number of candidate messages to scan per batch
            max_candidate_batch_size: Maximum number of candidate messages to scan per batch
            delete_batch_size: Maximum number of messages to delete per transaction
            per_app_batch_size: Maximum number of messages to fetch per eligible app turn
            app_page_size: Number of apps to inspect per eligibility discovery query
            scan_strategy: "auto", "global", or "eligible_apps"
            dry_run: Whether to perform a dry run (no actual deletion)
            task_label: Optional task label for retention metrics
        """
        if batch_size <= 0:
            raise ValueError(f"batch_size ({batch_size}) must be greater than 0")

        if max_candidate_batch_size is not None and max_candidate_batch_size <= 0:
            raise ValueError(f"max_candidate_batch_size ({max_candidate_batch_size}) must be greater than 0")

        if delete_batch_size is not None and delete_batch_size <= 0:
            raise ValueError(f"delete_batch_size ({delete_batch_size}) must be greater than 0")

        if per_app_batch_size is not None and per_app_batch_size <= 0:
            raise ValueError(f"per_app_batch_size ({per_app_batch_size}) must be greater than 0")

        if app_page_size <= 0:
            raise ValueError(f"app_page_size ({app_page_size}) must be greater than 0")

        if scan_strategy not in ("auto", "global", "eligible_apps"):
            raise ValueError(f"scan_strategy ({scan_strategy}) must be one of: auto, global, eligible_apps")

        self._policy = policy
        self._end_before = end_before
        self._start_from = start_from
        self._batch_size = batch_size
        self._candidate_batch_size = batch_size
        self._delete_batch_size = delete_batch_size or batch_size
        self._max_candidate_batch_size = max(max_candidate_batch_size or batch_size, self._candidate_batch_size)
        self._per_app_batch_size = per_app_batch_size or batch_size
        self._app_page_size = app_page_size
        self._scan_strategy = scan_strategy
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
        max_candidate_batch_size: int | None = None,
        delete_batch_size: int | None = None,
        per_app_batch_size: int | None = None,
        app_page_size: int = 500,
        scan_strategy: MessagesCleanScanStrategy = "auto",
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
            batch_size: Initial number of candidate messages to scan per batch
            max_candidate_batch_size: Maximum number of candidate messages to scan per batch
            delete_batch_size: Maximum number of messages to delete per transaction
            per_app_batch_size: Maximum number of messages to fetch per eligible app turn
            app_page_size: Number of apps to inspect per eligibility discovery query
            scan_strategy: "auto", "global", or "eligible_apps"
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

        if max_candidate_batch_size is not None and max_candidate_batch_size <= 0:
            raise ValueError(f"max_candidate_batch_size ({max_candidate_batch_size}) must be greater than 0")

        if delete_batch_size is not None and delete_batch_size <= 0:
            raise ValueError(f"delete_batch_size ({delete_batch_size}) must be greater than 0")

        if per_app_batch_size is not None and per_app_batch_size <= 0:
            raise ValueError(f"per_app_batch_size ({per_app_batch_size}) must be greater than 0")

        if app_page_size <= 0:
            raise ValueError(f"app_page_size ({app_page_size}) must be greater than 0")

        logger.info(
            "clean_messages: start_from=%s, end_before=%s, batch_size=%s, "
            "max_candidate_batch_size=%s, delete_batch_size=%s, per_app_batch_size=%s, "
            "app_page_size=%s, scan_strategy=%s, policy=%s",
            start_from,
            end_before,
            batch_size,
            max_candidate_batch_size,
            delete_batch_size,
            per_app_batch_size,
            app_page_size,
            scan_strategy,
            policy.__class__.__name__,
        )

        return cls(
            policy=policy,
            end_before=end_before,
            start_from=start_from,
            batch_size=batch_size,
            max_candidate_batch_size=max_candidate_batch_size,
            delete_batch_size=delete_batch_size,
            per_app_batch_size=per_app_batch_size,
            app_page_size=app_page_size,
            scan_strategy=scan_strategy,
            dry_run=dry_run,
            task_label=task_label,
        )

    @classmethod
    def from_days(
        cls,
        policy: MessagesCleanPolicy,
        days: int = 30,
        batch_size: int = 1000,
        max_candidate_batch_size: int | None = None,
        delete_batch_size: int | None = None,
        per_app_batch_size: int | None = None,
        app_page_size: int = 500,
        scan_strategy: MessagesCleanScanStrategy = "auto",
        dry_run: bool = False,
        task_label: str = "custom",
    ) -> "MessagesCleanService":
        """
        Create a service instance for cleaning messages older than specified days.

        Args:
            policy: The policy that determines which messages to delete
            days: Number of days to look back from now
            batch_size: Initial number of candidate messages to scan per batch
            max_candidate_batch_size: Maximum number of candidate messages to scan per batch
            delete_batch_size: Maximum number of messages to delete per transaction
            per_app_batch_size: Maximum number of messages to fetch per eligible app turn
            app_page_size: Number of apps to inspect per eligibility discovery query
            scan_strategy: "auto", "global", or "eligible_apps"
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

        if max_candidate_batch_size is not None and max_candidate_batch_size <= 0:
            raise ValueError(f"max_candidate_batch_size ({max_candidate_batch_size}) must be greater than 0")

        if delete_batch_size is not None and delete_batch_size <= 0:
            raise ValueError(f"delete_batch_size ({delete_batch_size}) must be greater than 0")

        if per_app_batch_size is not None and per_app_batch_size <= 0:
            raise ValueError(f"per_app_batch_size ({per_app_batch_size}) must be greater than 0")

        if app_page_size <= 0:
            raise ValueError(f"app_page_size ({app_page_size}) must be greater than 0")

        end_before = naive_utc_now() - datetime.timedelta(days=days)

        logger.info(
            "clean_messages: days=%s, end_before=%s, batch_size=%s, "
            "max_candidate_batch_size=%s, delete_batch_size=%s, per_app_batch_size=%s, "
            "app_page_size=%s, scan_strategy=%s, policy=%s",
            days,
            end_before,
            batch_size,
            max_candidate_batch_size,
            delete_batch_size,
            per_app_batch_size,
            app_page_size,
            scan_strategy,
            policy.__class__.__name__,
        )

        return cls(
            policy=policy,
            end_before=end_before,
            start_from=None,
            batch_size=batch_size,
            max_candidate_batch_size=max_candidate_batch_size,
            delete_batch_size=delete_batch_size,
            per_app_batch_size=per_app_batch_size,
            app_page_size=app_page_size,
            scan_strategy=scan_strategy,
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
            if self._should_use_eligible_app_strategy():
                return self._clean_messages_by_eligible_apps()
            return self._clean_messages_by_time_range()
        except Exception:
            status = "failed"
            raise
        finally:
            self._metrics.record_completion(
                status=status,
                job_duration_seconds=time.monotonic() - run_start,
            )

    def _should_use_eligible_app_strategy(self) -> bool:
        if self._scan_strategy == "global":
            return False

        if isinstance(self._policy, EligibleAppMessagesCleanPolicy):
            return True

        if self._scan_strategy == "eligible_apps":
            raise ValueError("scan_strategy=eligible_apps requires an eligible-app cleanup policy")

        return False

    def _clean_messages_by_time_range(self) -> MessagesCleanStatsDict:
        """
        Clean messages within a time range using cursor-based pagination.

        Time range is [start_from, end_before)

        Steps:
        1. Iterate candidate messages using cursor pagination (by created_at, id)
        2. Resolve app_id -> tenant_id mapping with a job-level cache
        3. Delegate to policy to determine which messages to delete
        4. Delete messages and their relations in small chunks

        Returns:
            Dict with statistics: batches, filtered_messages, total_deleted
        """
        stats: MessagesCleanStatsDict = {
            "batches": 0,
            "total_messages": 0,
            "filtered_messages": 0,
            "total_deleted": 0,
        }

        cursor: tuple[datetime.datetime, str] | None = None
        app_to_tenant_cache: dict[str, str | None] = {}
        current_candidate_batch_size = self._candidate_batch_size
        smoothed_hit_rate: float | None = None
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

        logger.info(
            "clean_messages: start cleaning messages (dry_run=%s), start_from=%s, end_before=%s, "
            "candidate_batch_size=%s, max_candidate_batch_size=%s, delete_batch_size=%s",
            self._dry_run,
            self._start_from,
            self._end_before,
            self._candidate_batch_size,
            self._max_candidate_batch_size,
            self._delete_batch_size,
        )

        while True:
            stats["batches"] += 1
            batch_start = time.monotonic()
            batch_scanned_messages = 0
            batch_filtered_messages = 0
            batch_deleted_messages = 0

            # Step 1: Fetch a batch of messages using cursor
            with session_factory.begin() as session:
                fetch_messages_start = time.monotonic()
                msg_stmt = (
                    select(Message.id, Message.app_id, Message.created_at)
                    .where(Message.created_at < self._end_before)
                    .order_by(Message.created_at, Message.id)
                    .limit(current_candidate_batch_size)
                )

                if self._start_from:
                    msg_stmt = msg_stmt.where(Message.created_at >= self._start_from)

                # Apply cursor condition: (created_at, id) > (last_created_at, last_message_id)
                if cursor:
                    msg_stmt = msg_stmt.where(
                        tuple_(Message.created_at, Message.id)
                        > tuple_(
                            sa.literal(cursor[0], type_=sa.DateTime()),
                            sa.literal(cursor[1], type_=Message.id.type),
                        )
                    )

                raw_messages = list(session.execute(msg_stmt).all())
                messages = [
                    SimpleMessage(id=msg_id, app_id=app_id, created_at=msg_created_at)
                    for msg_id, app_id, msg_created_at in raw_messages
                ]
                logger.info(
                    "clean_messages (batch %s): fetched %s candidate messages with limit %s in %sms",
                    stats["batches"],
                    len(messages),
                    current_candidate_batch_size,
                    int((time.monotonic() - fetch_messages_start) * 1000),
                )

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

                # Advance by candidate rows before policy filtering. This avoids retrying the same paid/unknown slice.
                cursor = (messages[-1].created_at, messages[-1].id)

                # Step 2: Extract app_ids and query tenant_ids
                app_ids = list({msg.app_id for msg in messages})

                if not app_ids:
                    logger.info("clean_messages (batch %s): no app_ids found, skip", stats["batches"])
                    smoothed_hit_rate, current_candidate_batch_size = self._adjust_candidate_batch_size(
                        smoothed_hit_rate=smoothed_hit_rate,
                        candidate_count=batch_scanned_messages,
                        eligible_count=0,
                    )
                    self._metrics.record_batch(
                        scanned_messages=batch_scanned_messages,
                        filtered_messages=batch_filtered_messages,
                        deleted_messages=batch_deleted_messages,
                        batch_duration_seconds=time.monotonic() - batch_start,
                    )
                    continue

                fetch_apps_start = time.monotonic()
                app_to_tenant, app_cache_misses, apps_found = self._load_app_to_tenant_mapping(
                    session=session,
                    app_ids=app_ids,
                    app_to_tenant_cache=app_to_tenant_cache,
                )
                logger.info(
                    "clean_messages (batch %s): resolved %s apps for %s app_ids (cache_misses=%s, found=%s) in %sms",
                    stats["batches"],
                    len(app_to_tenant),
                    len(app_ids),
                    app_cache_misses,
                    apps_found,
                    int((time.monotonic() - fetch_apps_start) * 1000),
                )

            if not app_to_tenant:
                logger.info("clean_messages (batch %s): no apps found, skip", stats["batches"])
                smoothed_hit_rate, current_candidate_batch_size = self._adjust_candidate_batch_size(
                    smoothed_hit_rate=smoothed_hit_rate,
                    candidate_count=batch_scanned_messages,
                    eligible_count=0,
                )
                self._metrics.record_batch(
                    scanned_messages=batch_scanned_messages,
                    filtered_messages=batch_filtered_messages,
                    deleted_messages=batch_deleted_messages,
                    batch_duration_seconds=time.monotonic() - batch_start,
                )
                continue

            # Step 3: Delegate to policy to determine which messages to delete
            policy_start = time.monotonic()
            message_ids_to_delete = list(self._policy.filter_message_ids(messages, app_to_tenant))
            batch_filtered_messages = len(message_ids_to_delete)
            stats["filtered_messages"] += batch_filtered_messages
            smoothed_hit_rate, next_candidate_batch_size = self._adjust_candidate_batch_size(
                smoothed_hit_rate=smoothed_hit_rate,
                candidate_count=batch_scanned_messages,
                eligible_count=batch_filtered_messages,
            )
            logger.info(
                "clean_messages (batch %s): policy selected %s/%s messages in %sms "
                "(smoothed_hit_rate=%.4f, next_candidate_batch_size=%s)",
                stats["batches"],
                batch_filtered_messages,
                len(messages),
                int((time.monotonic() - policy_start) * 1000),
                smoothed_hit_rate,
                next_candidate_batch_size,
            )
            current_candidate_batch_size = next_candidate_batch_size

            if not message_ids_to_delete:
                logger.info("clean_messages (batch %s): no messages to delete, skip", stats["batches"])
                self._metrics.record_batch(
                    scanned_messages=batch_scanned_messages,
                    filtered_messages=batch_filtered_messages,
                    deleted_messages=batch_deleted_messages,
                    batch_duration_seconds=time.monotonic() - batch_start,
                )
                continue

            # Step 4: Batch delete messages and their relations
            if not self._dry_run:
                delete_result = self._delete_messages_in_chunks(
                    session_factory=session_factory,
                    message_ids=message_ids_to_delete,
                )

                stats["total_deleted"] += delete_result["messages_deleted"]
                batch_deleted_messages = delete_result["messages_deleted"]

                logger.info(
                    "clean_messages (batch %s): processed %s candidate messages, deleted %s messages in %s chunks",
                    stats["batches"],
                    len(messages),
                    delete_result["messages_deleted"],
                    delete_result["chunks"],
                )
                logger.info(
                    "clean_messages (batch %s): relations %sms, messages %sms, batch total %sms",
                    stats["batches"],
                    delete_result["relations_ms"],
                    delete_result["messages_ms"],
                    int((time.monotonic() - batch_start) * 1000),
                )

                self._sleep_after_batch(stats["batches"], batch_deleted_messages)
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

    def _clean_messages_by_eligible_apps(self) -> MessagesCleanStatsDict:
        """
        Clean messages by first discovering eligible apps, then scanning messages with per-app cursors.

        The policy may cache plans during app discovery. Before each delete chunk, the policy must revalidate
        the selected message ids against fresh tenant plans.
        """
        if not isinstance(self._policy, EligibleAppMessagesCleanPolicy):
            raise ValueError("eligible app cleanup requires an eligible-app cleanup policy")

        stats: MessagesCleanStatsDict = {
            "batches": 0,
            "total_messages": 0,
            "filtered_messages": 0,
            "total_deleted": 0,
        }
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        scanner = EligibleAppRoundRobinScanner(
            policy=self._policy,
            start_from=self._start_from,
            end_before=self._end_before,
            app_page_size=self._app_page_size,
            per_app_batch_size=self._per_app_batch_size,
        )

        logger.info(
            "clean_messages: start eligible-app cleanup (dry_run=%s), start_from=%s, end_before=%s, "
            "app_page_size=%s, per_app_batch_size=%s, delete_batch_size=%s",
            self._dry_run,
            self._start_from,
            self._end_before,
            self._app_page_size,
            self._per_app_batch_size,
            self._delete_batch_size,
        )

        while True:
            stats["batches"] += 1
            batch_start = time.monotonic()

            fetch_start = time.monotonic()
            scan_batch = scanner.fetch_batch(session_factory, target_message_count=self._delete_batch_size)

            batch_scanned_messages = len(scan_batch.messages)
            stats["total_messages"] += batch_scanned_messages
            logger.info(
                "clean_messages (batch %s, eligible_apps): fetched %s messages from %s app turns in %sms "
                "(apps_scanned=%s, eligible_apps=%s, empty_apps=%s, exhausted_apps=%s)",
                stats["batches"],
                batch_scanned_messages,
                scan_batch.app_fetches,
                int((time.monotonic() - fetch_start) * 1000),
                scanner.scanned_apps,
                scanner.eligible_apps,
                scanner.empty_apps,
                scan_batch.exhausted_apps,
            )

            if not scan_batch.messages:
                logger.info("clean_messages (batch %s, eligible_apps): no more messages to process", stats["batches"])
                self._metrics.record_batch(
                    scanned_messages=batch_scanned_messages,
                    filtered_messages=0,
                    deleted_messages=0,
                    batch_duration_seconds=time.monotonic() - batch_start,
                )
                break

            revalidate_start = time.monotonic()
            message_ids_to_delete = list(
                self._policy.revalidate_message_ids(scan_batch.messages, scan_batch.app_to_tenant)
            )
            batch_filtered_messages = len(message_ids_to_delete)
            stats["filtered_messages"] += batch_filtered_messages
            revalidated_dropped = batch_scanned_messages - batch_filtered_messages
            logger.info(
                "clean_messages (batch %s, eligible_apps): revalidated %s/%s messages in %sms (dropped=%s)",
                stats["batches"],
                batch_filtered_messages,
                batch_scanned_messages,
                int((time.monotonic() - revalidate_start) * 1000),
                revalidated_dropped,
            )

            batch_deleted_messages = self._handle_delete_candidates(
                session_factory=session_factory,
                message_ids_to_delete=message_ids_to_delete,
                batch_index=stats["batches"],
                scanned_messages=batch_scanned_messages,
            )
            stats["total_deleted"] += batch_deleted_messages

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
        logger.info(
            "clean_messages eligible-app discovery completed: apps_scanned=%s, eligible_apps=%s, empty_apps=%s",
            scanner.scanned_apps,
            scanner.eligible_apps,
            scanner.empty_apps,
        )

        return stats

    def _handle_delete_candidates(
        self,
        *,
        session_factory: sessionmaker[Session],
        message_ids_to_delete: Sequence[str],
        batch_index: int,
        scanned_messages: int,
    ) -> int:
        if not message_ids_to_delete:
            logger.info("clean_messages (batch %s): no messages to delete, skip", batch_index)
            return 0

        if self._dry_run:
            sample_size = min(10, len(message_ids_to_delete))
            sampled_ids = random.sample(list(message_ids_to_delete), sample_size)

            logger.info(
                "clean_messages (batch %s, dry_run): would delete %s messages, sampling %s ids:",
                batch_index,
                len(message_ids_to_delete),
                sample_size,
            )
            for msg_id in sampled_ids:
                logger.info("clean_messages (batch %s, dry_run) sample: message_id=%s", batch_index, msg_id)
            return 0

        delete_result = self._delete_messages_in_chunks(
            session_factory=session_factory,
            message_ids=message_ids_to_delete,
        )

        logger.info(
            "clean_messages (batch %s): processed %s candidate messages, deleted %s messages in %s chunks",
            batch_index,
            scanned_messages,
            delete_result["messages_deleted"],
            delete_result["chunks"],
        )
        logger.info(
            "clean_messages (batch %s): relations %sms, messages %sms",
            batch_index,
            delete_result["relations_ms"],
            delete_result["messages_ms"],
        )
        self._sleep_after_batch(batch_index, delete_result["messages_deleted"])
        return delete_result["messages_deleted"]

    @staticmethod
    def _load_app_to_tenant_mapping(
        *,
        session: Session,
        app_ids: Sequence[str],
        app_to_tenant_cache: dict[str, str | None],
    ) -> tuple[dict[str, str], int, int]:
        unique_app_ids = sorted(set(app_ids))
        missing_app_ids = [app_id for app_id in unique_app_ids if app_id not in app_to_tenant_cache]
        found_apps = 0

        if missing_app_ids:
            app_stmt = select(App.id, App.tenant_id).where(App.id.in_(missing_app_ids))
            apps = list(session.execute(app_stmt).all())
            found_app_ids: set[str] = set()
            for app_id, tenant_id in apps:
                app_to_tenant_cache[app_id] = tenant_id
                found_app_ids.add(app_id)
            found_apps = len(found_app_ids)

            for app_id in set(missing_app_ids) - found_app_ids:
                app_to_tenant_cache[app_id] = None

        app_to_tenant: dict[str, str] = {}
        for app_id in unique_app_ids:
            tenant_id = app_to_tenant_cache.get(app_id)
            if tenant_id is not None:
                app_to_tenant[app_id] = tenant_id

        return app_to_tenant, len(missing_app_ids), found_apps

    def _adjust_candidate_batch_size(
        self,
        *,
        smoothed_hit_rate: float | None,
        candidate_count: int,
        eligible_count: int,
    ) -> tuple[float, int]:
        if candidate_count <= 0:
            next_smoothed_hit_rate = smoothed_hit_rate or 0.0
            return next_smoothed_hit_rate, self._candidate_batch_size_for_hit_rate(next_smoothed_hit_rate)

        hit_rate = eligible_count / candidate_count
        if smoothed_hit_rate is None:
            next_smoothed_hit_rate = hit_rate
        else:
            next_smoothed_hit_rate = (_HIT_RATE_EMA_ALPHA * hit_rate) + ((1 - _HIT_RATE_EMA_ALPHA) * smoothed_hit_rate)

        return next_smoothed_hit_rate, self._candidate_batch_size_for_hit_rate(next_smoothed_hit_rate)

    def _candidate_batch_size_for_hit_rate(self, hit_rate: float) -> int:
        effective_hit_rate = max(hit_rate, _MIN_ELIGIBLE_HIT_RATE)
        desired_batch_size = math.ceil(self._delete_batch_size / effective_hit_rate)
        lower_bound = min(self._delete_batch_size, self._max_candidate_batch_size)
        return min(max(desired_batch_size, lower_bound), self._max_candidate_batch_size)

    def _delete_messages_in_chunks(
        self,
        *,
        session_factory: sessionmaker[Session],
        message_ids: Sequence[str],
    ) -> MessageDeleteResultDict:
        result: MessageDeleteResultDict = {
            "messages_deleted": 0,
            "chunks": 0,
            "relations_ms": 0,
            "messages_ms": 0,
        }

        for message_id_chunk in self._iter_message_id_chunks(message_ids, self._delete_batch_size):
            result["chunks"] += 1
            with session_factory.begin() as session:
                delete_relations_start = time.monotonic()
                self._batch_delete_message_relations(session, message_id_chunk)
                result["relations_ms"] += int((time.monotonic() - delete_relations_start) * 1000)

                delete_messages_start = time.monotonic()
                delete_stmt = delete(Message).where(Message.id.in_(message_id_chunk))
                delete_result = cast(CursorResult, session.execute(delete_stmt))
                result["messages_deleted"] += delete_result.rowcount
                result["messages_ms"] += int((time.monotonic() - delete_messages_start) * 1000)

        return result

    @staticmethod
    def _iter_message_id_chunks(message_ids: Sequence[str], chunk_size: int) -> Iterator[Sequence[str]]:
        for start_index in range(0, len(message_ids), chunk_size):
            yield message_ids[start_index : start_index + chunk_size]

    def _sleep_after_batch(self, batch_index: int, deleted_messages: int) -> None:
        if deleted_messages <= 0:
            return

        max_batch_interval_ms = dify_config.SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_MAX_INTERVAL
        sleep_ratio = min(1.0, deleted_messages / self._delete_batch_size)
        sleep_ms = random.uniform(0, max_batch_interval_ms * sleep_ratio)  # noqa: S311
        logger.info("clean_messages (batch %s): sleeping for %.2fms", batch_index, sleep_ms)
        time.sleep(sleep_ms / 1000)

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
