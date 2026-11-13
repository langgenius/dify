"""Retry delivery of App deletion cleanup recorded in the database."""

from __future__ import annotations

import logging
import socket
from datetime import datetime, timedelta

from celery import shared_task
from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from repositories.app_deletion_outbox_repository import AppDeletionOutboxRepository
from services.app_service import AppService

logger = logging.getLogger(__name__)

_BATCH_SIZE = 50
_LEASE_DURATION = timedelta(minutes=5)
_MAX_RETRY_DELAY_SECONDS = 3600


@shared_task(queue="app_deletion")
def dispatch_app_deletion_outbox() -> int:
    """Deliver pending deletions; the periodic schedule recovers missed wakeups."""
    return _dispatch(session_factory.get_session_maker())


def _dispatch(sessions: sessionmaker[Session], *, now: datetime | None = None, worker_id: str | None = None) -> int:
    dispatch_started_at = now or naive_utc_now()
    worker_id = worker_id or f"{socket.gethostname()}:{dispatch_app_deletion_outbox.request.id or 'manual'}"
    with sessions.begin() as session:
        AppDeletionOutboxRepository(session).delete_succeeded_before(
            completed_before=dispatch_started_at - timedelta(days=30), limit=_BATCH_SIZE
        )
    delivered = 0
    for _ in range(_BATCH_SIZE):
        with sessions.begin() as session:
            work = AppDeletionOutboxRepository(session).claim_ready(
                now=now or naive_utc_now(),
                lease_owner=worker_id,
                lease_duration=_LEASE_DURATION,
                limit=1,
            )
        if not work:
            break
        item = work[0]
        attempted_at = naive_utc_now()
        try:
            AppService.notify_deleted_app(item.deletion, account_id=item.account_id)
        except Exception as exc:
            delay = min(2 ** min(item.attempt_count, 12), _MAX_RETRY_DELAY_SECONDS)
            with sessions.begin() as session:
                AppDeletionOutboxRepository(session).schedule_retry(
                    outbox_id=item.outbox_id,
                    lease_owner=worker_id,
                    next_attempt_at=attempted_at + timedelta(seconds=delay),
                    error_message=str(exc)[:4000],
                )
            logger.exception("App deletion cleanup delivery failed", extra={"app_id": item.app_id})
            continue
        with sessions.begin() as session:
            AppDeletionOutboxRepository(session).mark_succeeded(
                outbox_id=item.outbox_id,
                lease_owner=worker_id,
                completed_at=naive_utc_now(),
            )
        delivered += 1
    return delivered


__all__ = ["dispatch_app_deletion_outbox"]
