"""Notify clients about interrupted Builder sessions.

A session with an expired advance lease is already interrupted when read.
The sweeper emits an invalidation for stale working sessions so SSE clients
refresh their durable state. Retry remains a client action.
"""

import logging
from datetime import timedelta

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.dify_builder.state import PcState, is_working
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.dify_builder import DifyBuilderSession
from services.dify_builder import progress_bus, session_lock

logger = logging.getLogger(__name__)

__all__ = ["reconcile_interrupted_sessions"]

_WORKING_STATES = [str(s) for s in PcState if is_working(s)]


def _session_factory() -> sessionmaker:
    return sessionmaker(bind=db.engine, expire_on_commit=False)


@shared_task(queue="dify_builder")
def reconcile_interrupted_sessions() -> int:
    """Beat sweeper: sessions stuck in a working state with no live advance
    lock past the staleness threshold are interrupted (the advancing task died
    before releasing the lock). Publish an interrupted signal to the progress
    bus so any live SSE re-syncs, and log. Does NOT mutate committed state
    (resume-from-committed) or re-enqueue (non-idempotent steps need explicit
    user retry). Returns the number of sessions flagged."""
    stale_before = naive_utc_now() - timedelta(seconds=dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS)
    factory = _session_factory()
    with factory() as db_session:
        rows = db_session.execute(
            select(DifyBuilderSession.id, DifyBuilderSession.current_state, DifyBuilderSession.version)
            .where(DifyBuilderSession.current_state.in_(_WORKING_STATES))
            .where(DifyBuilderSession.updated_at < stale_before)
        ).all()

    flagged = 0
    for sid, state, _version in rows:
        if session_lock.exists(sid):
            continue  # a live advance holds the lock
        progress_bus.publish(sid, {"kind": "error", "error": "interrupted"})
        logger.warning("Dify Builder session %s interrupted (state=%s, no live lock)", sid, state)
        flagged += 1
    return flagged
