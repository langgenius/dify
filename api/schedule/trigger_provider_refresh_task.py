import logging
import math
import time
from collections.abc import Iterable, Sequence

from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.engine.row import Row
from sqlalchemy.orm import Session

import app
from configs import dify_config
from core.trigger.utils.locks import build_trigger_refresh_lock_keys
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.trigger import TriggerSubscription
from tasks.trigger_subscription_refresh_tasks import trigger_subscription_refresh

logger = logging.getLogger(__name__)


def _now_ts() -> int:
    return int(time.time())


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
    now: int = _now_ts()

    batch_size: int = int(dify_config.TRIGGER_PROVIDER_REFRESH_BATCH_SIZE)
    lock_ttl: int = max(300, int(dify_config.TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS))

    with Session(db.engine, expire_on_commit=False) as session:
        filter: ColumnElement[bool] = _build_due_filter(now_ts=now)
        total_due: int = int(session.scalar(statement=select(func.count()).where(filter)) or 0)
        logger.info("Trigger refresh scan start: due=%d", total_due)
        if total_due == 0:
            return

        pages: int = math.ceil(total_due / batch_size)
        for page in range(pages):
            offset: int = page * batch_size
            subscription_rows: Sequence[Row[tuple[str, str]]] = session.execute(
                select(TriggerSubscription.tenant_id, TriggerSubscription.id)
                .where(filter)
                .order_by(TriggerSubscription.updated_at.asc())
                .offset(offset)
                .limit(batch_size)
            ).all()
            if not subscription_rows:
                logger.debug("Trigger refresh page %d/%d empty", page + 1, pages)
                continue

            subscriptions: list[tuple[str, str]] = [
                (str(tenant_id), str(subscription_id)) for tenant_id, subscription_id in subscription_rows
            ]
            lock_keys: list[str] = build_trigger_refresh_lock_keys(subscriptions)
            acquired: list[bool] = _acquire_locks(keys=lock_keys, ttl_seconds=lock_ttl)

            enqueued: int = 0
            for (tenant_id, subscription_id), is_locked in zip(subscriptions, acquired):
                if not is_locked:
                    continue
                trigger_subscription_refresh.delay(tenant_id=tenant_id, subscription_id=subscription_id)
                enqueued += 1

            logger.info(
                "Trigger refresh page %d/%d: scanned=%d locks_acquired=%d enqueued=%d",
                page + 1,
                pages,
                len(subscriptions),
                sum(1 for x in acquired if x),
                enqueued,
            )

    logger.info("Trigger refresh scan done: due=%d", total_due)
