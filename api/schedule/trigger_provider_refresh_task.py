import logging
from collections.abc import Iterable, Sequence

from celery import group
from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.engine.row import Row
from sqlalchemy.orm import Session

import app
from configs import dify_config
from core.trigger.utils.locks import build_trigger_refresh_lock_keys
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.helper import current_timestamp
from models.trigger import TriggerSubscription
from tasks.trigger_subscription_refresh_tasks import trigger_subscription_refresh

logger = logging.getLogger(__name__)


def _build_due_filter(now_ts: int):
    """Build SQLAlchemy filter for due credential or subscription refresh."""
    credential_due: ColumnElement[bool] = and_(
        TriggerSubscription.credential_expires_at != -1,
        TriggerSubscription.credential_expires_at
        <= now_ts + int(dify_config.TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS),
    )
    subscription_due: ColumnElement[bool] = and_(
        TriggerSubscription.expires_at != -1,
        TriggerSubscription.expires_at <= now_ts + int(dify_config.TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS),
    )
    return or_(credential_due, subscription_due)


def _acquire_locks(keys: Iterable[str], ttl_seconds: int) -> list[bool]:
    """Attempt to acquire locks in a single pipelined round-trip.

    Returns a list of booleans indicating which locks were acquired.
    """
    pipe = redis_client.pipeline(transaction=False)
    for key in keys:
        pipe.set(key, b"1", ex=ttl_seconds, nx=True)
    results = pipe.execute()
    return [bool(r) for r in results]


@app.celery.task(queue="trigger_refresh_publisher")
def trigger_provider_refresh() -> None:
    """
    Scan due trigger subscriptions and enqueue refresh tasks with in-flight locks.
    """
    now: int = current_timestamp()

    batch_size: int = int(dify_config.TRIGGER_PROVIDER_REFRESH_BATCH_SIZE)
    lock_ttl: int = max(300, int(dify_config.TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS))

    with Session(db.engine, expire_on_commit=False) as session:
        filter: ColumnElement[bool] = _build_due_filter(now_ts=now)
        # Keep the list of due subscriptions stable for this publisher run.
        # Refresh workers update the same rows, so OFFSET pagination over a
        # changing due set can skip rows after an earlier page is processed.
        subscription_rows: Sequence[Row[tuple[str, str]]] = session.execute(
            select(TriggerSubscription.tenant_id, TriggerSubscription.id)
            .where(filter)
            .order_by(TriggerSubscription.updated_at.asc(), TriggerSubscription.id.asc())
        ).all()
        total_due = len(subscription_rows)
        logger.info("Trigger refresh scan start: due=%d", total_due)
        if total_due == 0:
            return

        pages = (total_due + batch_size - 1) // batch_size
        for page in range(pages):
            offset = page * batch_size
            page_rows = subscription_rows[offset : offset + batch_size]

            subscriptions: list[tuple[str, str]] = [
                (str(tenant_id), str(subscription_id)) for tenant_id, subscription_id in page_rows
            ]
            lock_keys: list[str] = build_trigger_refresh_lock_keys(subscriptions)
            acquired: list[bool] = _acquire_locks(keys=lock_keys, ttl_seconds=lock_ttl)

            if not any(acquired):
                continue

            jobs = [
                trigger_subscription_refresh.s(tenant_id=tenant_id, subscription_id=subscription_id)
                for (tenant_id, subscription_id), is_locked in zip(subscriptions, acquired)
                if is_locked
            ]
            result = group(jobs).apply_async()
            enqueued = len(jobs)

            logger.info(
                "Trigger refresh page %d/%d: scanned=%d locks_acquired=%d enqueued=%d result=%s",
                page + 1,
                pages,
                len(subscriptions),
                sum(1 for x in acquired if x),
                enqueued,
                result,
            )

    logger.info("Trigger refresh scan done: due=%d", total_due)
