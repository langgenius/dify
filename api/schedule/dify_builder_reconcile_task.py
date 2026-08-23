"""Beat sweeper for interrupted dify-builder sessions (P3b Task 5).

``interrupted`` is already DERIVED on read (Task 3's ``get_session_view``:
``is_working(state) and not session_lock.exists(sid)``) -- the moment a dead
advance task's lock TTL expires, on-read already reports interrupted without
this sweeper. This task is therefore a backstop/notifier, not the mechanism
that sets interrupted: it finds sessions stuck in a working state with no
live advance lock past ``DIFY_BUILDER_MAX_ADVANCE_SECONDS`` of
staleness, publishes an interrupted signal to the progress bus so any live
SSE re-syncs, and logs a warning.

It must NOT mutate committed session state (that would break resume-from-
committed -- the user's retry re-runs the working handler from the committed
state) and must NOT re-enqueue (non-idempotent steps like publish/verify
require explicit user retry -- this matches the P3b idempotency deferral).
No schema change, no migration.

Runs on the default worker (no ``queue=``), like the other lightweight
``schedule/*`` beat tasks -- NOT the ``dify_builder`` queue used by
``tasks.dify_builder_advance_task``. The ``FlaskTask`` base
(``extensions.ext_celery.init_app``) already provides ``app_context``; this
module must not push its own.
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


@shared_task
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
            select(DifyBuilderSession.id, DifyBuilderSession.current_state)
            .where(DifyBuilderSession.current_state.in_(_WORKING_STATES))
            .where(DifyBuilderSession.updated_at < stale_before)
        ).all()

    flagged = 0
    for sid, state in rows:
        if session_lock.exists(sid):
            continue  # a live advance holds the lock -- leave it alone
        progress_bus.publish(sid, {"kind": "error", "error": "interrupted"})
        logger.warning("Dify Builder session %s interrupted (state=%s, no live lock)", sid, state)
        flagged += 1
    return flagged
