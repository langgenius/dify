import datetime
import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import cast

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from configs import dify_config
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from extensions.ext_redis import redis_client
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
from services.billing_service import BillingService, SubscriptionPlan

logger = logging.getLogger(__name__)


@dataclass
class SimpleMessage:
    """Lightweight message info containing only essential fields for cleaning."""

    id: str
    app_id: str
    created_at: datetime.datetime


class SandboxMessagesCleanService:
    """
    Service for cleaning expired messages from sandbox plan tenants.
    """

    # Redis key prefix for tenant plan cache
    PLAN_CACHE_KEY_PREFIX = "tenant_plan:"
    # Cache TTL: 10 minutes
    PLAN_CACHE_TTL = 600

    @classmethod
    def clean_sandbox_messages_by_time_range(
        cls,
        start_from: datetime.datetime,
        end_before: datetime.datetime,
        graceful_period: int = 21,
        batch_size: int = 1000,
        dry_run: bool = False,
    ) -> dict[str, int]:
        """
        Clean sandbox messages within a specific time range [start_from, end_before).

        Args:
            start_from: Start time (inclusive) of the range
            end_before: End time (exclusive) of the range
            batch_size: Number of messages to process per batch
            dry_run: Whether to perform a dry run (no actual deletion)

        Returns:
            Statistics about the cleaning operation

        Raises:
            ValueError: If start_from >= end_before
        """
        if start_from >= end_before:
            raise ValueError(f"start_from ({start_from}) must be less than end_before ({end_before})")

        if batch_size <= 0:
            raise ValueError(f"batch_size ({batch_size}) must be greater than 0")

        if graceful_period < 0:
            raise ValueError(f"graceful_period ({graceful_period}) must be greater than or equal to 0")

        logger.info("clean_messages: start_from=%s, end_before=%s, batch_size=%s", start_from, end_before, batch_size)

        return cls._clean_sandbox_messages_by_time_range(
            start_from=start_from,
            end_before=end_before,
            graceful_period=graceful_period,
            batch_size=batch_size,
            dry_run=dry_run,
        )

    @classmethod
    def clean_sandbox_messages_by_days(
        cls,
        days: int = 30,
        graceful_period: int = 21,
        batch_size: int = 1000,
        dry_run: bool = False,
    ) -> dict[str, int]:
        """
        Clean sandbox messages older than specified days.

        Args:
            days: Number of days to look back from now
            batch_size: Number of messages to process per batch
            dry_run: Whether to perform a dry run (no actual deletion)

        Returns:
            Statistics about the cleaning operation
        """
        if days < 0:
            raise ValueError(f"days ({days}) must be greater than or equal to 0")

        if batch_size <= 0:
            raise ValueError(f"batch_size ({batch_size}) must be greater than 0")

        if graceful_period < 0:
            raise ValueError(f"graceful_period ({graceful_period}) must be greater than or equal to 0")

        end_before = datetime.datetime.now() - datetime.timedelta(days=days)

        logger.info("clean_messages: days=%s, end_before=%s, batch_size=%s", days, end_before, batch_size)

        return cls._clean_sandbox_messages_by_time_range(
            end_before=end_before,
            start_from=None,
            graceful_period=graceful_period,
            batch_size=batch_size,
            dry_run=dry_run,
        )

    @classmethod
    def _clean_sandbox_messages_by_time_range(
        cls,
        end_before: datetime.datetime,
        start_from: datetime.datetime | None = None,
        graceful_period: int = 21,
        batch_size: int = 1000,
        dry_run: bool = False,
    ) -> dict[str, int]:
        """
        Internal method to clean sandbox messages within a time range using cursor-based pagination.
        Time range is [start_from, end_before) - left-closed, right-open interval.

        Steps:
        1. Iterate messages using cursor pagination (by created_at, id)
        2. Extract app_ids from messages
        3. Query tenant_ids from apps
        4. Batch fetch subscription plans
        5. Delete messages from sandbox tenants

        Args:
            end_before: End time (exclusive) of the range
            start_from: Optional start time (inclusive) of the range
            batch_size: Number of messages to process per batch
            dry_run: Whether to perform a dry run (no actual deletion)

        Returns:
            Dict with statistics: batches, total_messages, total_deleted
        """
        stats = {
            "batches": 0,
            "total_messages": 0,
            "total_deleted": 0,
        }

        if not dify_config.BILLING_ENABLED:
            logger.info("clean_messages: billing is not enabled, skip cleaning messages")
            return stats

        tenant_whitelist = cls._get_tenant_whitelist()
        logger.info("clean_messages: tenant_whitelist=%s", tenant_whitelist)

        # Cursor-based pagination using (created_at, id) to avoid infinite loops
        # and ensure proper ordering with time-based filtering
        _cursor: tuple[datetime.datetime, str] | None = None

        logger.info(
            "clean_messages: start cleaning messages (dry_run=%s), start_from=%s, end_before=%s",
            dry_run,
            start_from,
            end_before,
        )

        while True:
            stats["batches"] += 1

            # Step 1: Fetch a batch of messages using cursor
            with Session(db.engine, expire_on_commit=False) as session:
                msg_stmt = (
                    select(Message.id, Message.app_id, Message.created_at)
                    .where(Message.created_at < end_before)
                    .order_by(Message.created_at, Message.id)
                    .limit(batch_size)
                )

                if start_from:
                    msg_stmt = msg_stmt.where(Message.created_at >= start_from)

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

                if not messages:
                    logger.info("clean_messages (batch %s): no more messages to process", stats["batches"])
                    break

                # Update cursor to the last message's (created_at, id)
                _cursor = (messages[-1].created_at, messages[-1].id)

                # Step 2: Extract app_ids from this batch
                app_ids = list({msg.app_id for msg in messages})

                if not app_ids:
                    logger.info("clean_messages (batch %s): no app_ids found, skip", stats["batches"])
                    continue

                # Step 3: Query tenant_ids from apps
                app_stmt = select(App.id, App.tenant_id).where(App.id.in_(app_ids))
                apps = list(session.execute(app_stmt).all())

            if not apps:
                logger.info("clean_messages (batch %s): no apps found, skip", stats["batches"])
                continue

            # Step 4: End sesion to call billing API to avoid long-running transaction.
            # Build app_id -> tenant_id mapping
            app_to_tenant: dict[str, str] = {app.id: app.tenant_id for app in apps}
            tenant_ids = list(set(app_to_tenant.values()))

            # Batch fetch subscription plans
            tenant_plans = cls._batch_fetch_tenant_plans(tenant_ids)

            # Step 5: Filter messages from sandbox tenants
            sandbox_message_ids = cls._filter_expired_sandbox_messages(
                messages=messages,
                app_to_tenant=app_to_tenant,
                tenant_plans=tenant_plans,
                tenant_whitelist=tenant_whitelist,
                graceful_period_days=graceful_period,
            )

            if not sandbox_message_ids:
                logger.info("clean_messages (batch %s): no sandbox messages found, skip", stats["batches"])
                continue

            stats["total_messages"] += len(sandbox_message_ids)

            # Step 6: Batch delete messages and their relations
            if not dry_run:
                with Session(db.engine, expire_on_commit=False) as session:
                    # Delete related records first
                    cls._batch_delete_message_relations(session, sandbox_message_ids)

                    # Delete messages
                    delete_stmt = delete(Message).where(Message.id.in_(sandbox_message_ids))
                    delete_result = cast(CursorResult, session.execute(delete_stmt))
                    messages_deleted = delete_result.rowcount
                    session.commit()

                    stats["total_deleted"] += messages_deleted

                    logger.info(
                        "clean_messages (batch %s): processed %s messages, deleted %s sandbox messages",
                        stats["batches"],
                        len(messages),
                        messages_deleted,
                    )
            else:
                sample_ids = ", ".join(sample_id for sample_id in sandbox_message_ids[:5])
                logger.info(
                    "clean_messages (batch %s, dry_run): would delete %s sandbox messages, sample ids: %s",
                    stats["batches"],
                    len(sandbox_message_ids),
                    sample_ids,
                )

        logger.info(
            "clean_messages completed: total batches: %s, total messages: %s, total deleted: %s",
            stats["batches"],
            stats["total_messages"],
            stats["total_deleted"],
        )

        return stats

    @classmethod
    def _filter_expired_sandbox_messages(
        cls,
        messages: Sequence[SimpleMessage],
        app_to_tenant: dict[str, str],
        tenant_plans: dict[str, SubscriptionPlan],
        tenant_whitelist: Sequence[str],
        graceful_period_days: int,
        current_timestamp: int | None = None,
    ) -> list[str]:
        """
        Filter messages that should be deleted based on sandbox plan expiration.

        A message should be deleted if:
        1. It belongs to a sandbox tenant AND
        2. Either:
           a) The tenant has no previous subscription (expiration_date == -1), OR
           b) The subscription expired more than graceful_period_days ago

        Args:
            messages: List of message objects with id and app_id attributes
            app_to_tenant: Mapping from app_id to tenant_id
            tenant_plans: Mapping from tenant_id to subscription plan info
            graceful_period_days: Grace period in days after expiration
            current_timestamp: Current Unix timestamp (defaults to now, injectable for testing)

        Returns:
            List of message IDs that should be deleted
        """
        if current_timestamp is None:
            current_timestamp = int(datetime.datetime.now(datetime.UTC).timestamp())

        sandbox_message_ids: list[str] = []
        graceful_period_seconds = graceful_period_days * 24 * 60 * 60

        for msg in messages:
            # Get tenant_id for this message's app
            tenant_id = app_to_tenant.get(msg.app_id)
            if not tenant_id:
                continue

            # Skip tenant messages in whitelist
            if tenant_id in tenant_whitelist:
                continue

            # Get subscription plan for this tenant
            tenant_plan = tenant_plans.get(tenant_id)
            if not tenant_plan:
                continue

            plan = str(tenant_plan["plan"])
            expiration_date = int(tenant_plan["expiration_date"])

            # Only process sandbox plans
            if plan != CloudPlan.SANDBOX:
                continue

            # Case 1: No previous subscription (-1 means never had a paid subscription)
            if expiration_date == -1:
                sandbox_message_ids.append(msg.id)
                continue

            # Case 2: Subscription expired beyond grace period
            if current_timestamp - expiration_date > graceful_period_seconds:
                sandbox_message_ids.append(msg.id)

        return sandbox_message_ids

    @classmethod
    def _get_tenant_whitelist(cls) -> Sequence[str]:
        return BillingService.get_expired_subscription_cleanup_whitelist()

    @classmethod
    def _batch_fetch_tenant_plans(cls, tenant_ids: Sequence[str]) -> dict[str, SubscriptionPlan]:
        """
        Batch fetch tenant plans with Redis caching.

        This method uses a two-tier strategy:
        1. First, batch fetch from Redis cache using mget
        2. For cache misses, fetch from billing API
        3. Update Redis cache using pipeline for new entries

        Args:
            tenant_ids: List of tenant IDs

        Returns:
            Dict mapping tenant_id to SubscriptionPlan (with "plan" and "expiration_date" keys)
        """
        if not tenant_ids:
            return {}

        tenant_plans: dict[str, SubscriptionPlan] = {}

        # Step 1: Batch fetch from Redis cache using mget
        redis_keys = [f"{cls.PLAN_CACHE_KEY_PREFIX}{tenant_id}" for tenant_id in tenant_ids]
        try:
            cached_values = redis_client.mget(redis_keys)

            # Map cached values back to tenant_ids
            cache_hits: dict[str, SubscriptionPlan] = {}
            cache_misses: list[str] = []

            for tenant_id, cached_value in zip(tenant_ids, cached_values):
                if cached_value:
                    # Redis returns bytes, decode to string and parse JSON
                    json_str = cached_value.decode("utf-8") if isinstance(cached_value, bytes) else cached_value
                    try:
                        plan_dict = json.loads(json_str)
                        if isinstance(plan_dict, dict) and "plan" in plan_dict:
                            cache_hits[tenant_id] = cast(SubscriptionPlan, plan_dict)
                            tenant_plans[tenant_id] = cast(SubscriptionPlan, plan_dict)
                        else:
                            cache_misses.append(tenant_id)
                    except json.JSONDecodeError:
                        cache_misses.append(tenant_id)
                else:
                    cache_misses.append(tenant_id)

            logger.info(
                "clean_messages: fetch_tenant_plans(cache hits=%s, cache misses=%s)",
                len(cache_hits),
                len(cache_misses),
            )
        except Exception as e:
            logger.warning("clean_messages: fetch_tenant_plans(redis mget failed: %s, falling back to API)", e)
            cache_misses = list(tenant_ids)

        # Step 2: Fetch missing plans from billing API
        if cache_misses:
            bulk_plans = BillingService.get_plan_bulk(cache_misses)

            if bulk_plans:
                plans_to_cache: dict[str, SubscriptionPlan] = {}

                for tenant_id, plan_dict in bulk_plans.items():
                    if isinstance(plan_dict, dict):
                        tenant_plans[tenant_id] = plan_dict  # type: ignore
                        plans_to_cache[tenant_id] = plan_dict  # type: ignore

                # Step 3: Batch update Redis cache using pipeline
                if plans_to_cache:
                    try:
                        pipe = redis_client.pipeline()
                        for tenant_id, plan_dict in plans_to_cache.items():
                            redis_key = f"{cls.PLAN_CACHE_KEY_PREFIX}{tenant_id}"
                            # Serialize dict to JSON string
                            json_str = json.dumps(plan_dict)
                            pipe.setex(redis_key, cls.PLAN_CACHE_TTL, json_str)
                        pipe.execute()

                        logger.info(
                            "clean_messages: cached %s new tenant plans to Redis",
                            len(plans_to_cache),
                        )
                    except Exception as e:
                        logger.warning("clean_messages: Redis pipeline failed: %s", e)

        return tenant_plans

    @classmethod
    def _batch_delete_message_relations(cls, session: Session, message_ids: Sequence[str]) -> None:
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
