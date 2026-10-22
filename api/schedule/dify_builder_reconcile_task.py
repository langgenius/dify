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
The one durable write it triggers is the consent owner's conservative
settlement of a stranded reserved confirmed grant (failed before any claim,
unknown after one); a recovered step then needs a new prepare + confirm. The
grants are observed (identity and generation) before the lease check and only
those settle, so a recovery and fresh reservation that commit in between are
never touched. The same owner also repairs, in a bounded pass, a reserved
grant whose command already reached review/FAILED but whose settlement write
failed; a session whose advance lease is live is never touched.
No schema change, no migration. Native confirmed runs additionally recover
terminal Builder result projections from already committed execution evidence;
this never starts or resumes a workflow and respects newer user transitions.

Runs on the default worker (no ``queue=``), like the other lightweight
``schedule/*`` beat tasks -- NOT the ``dify_builder`` queue used by
``tasks.dify_builder_advance_task``. The ``FlaskTask`` base
(``extensions.ext_celery.init_app``) already provides ``app_context``; this
module must not push its own.
"""

import logging
from collections.abc import Callable
from datetime import timedelta
from typing import cast

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.dify_builder.state import PcState, is_working
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.dify_builder import DifyBuilderSession
from services.dify_builder import progress_bus, session_lock
from services.dify_builder.real_call_consent_service import BuilderRealCallConsentService

logger = logging.getLogger(__name__)

__all__ = ["reconcile_interrupted_sessions"]

_WORKING_STATES = [str(s) for s in PcState if is_working(s)]


# Upper bound of reserved grants examined per sweep by the terminal-settlement repair.
_TERMINAL_REPAIR_LIMIT = 100


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
            select(DifyBuilderSession.id, DifyBuilderSession.current_state, DifyBuilderSession.version)
            .where(DifyBuilderSession.current_state.in_(_WORKING_STATES))
            .where(DifyBuilderSession.updated_at < stale_before)
        ).all()

    flagged = 0
    consent = BuilderRealCallConsentService(factory)
    for sid, state, version in rows:
        # Materialize the exact reserved grants of the stale version BEFORE the
        # lease check (SQL closed again before Redis): a recovery and a fresh
        # reservation committed after this point are never this sweep's to settle.
        observation = None
        try:
            observation = consent.observe_stranded(session_id=sid, session_version=version)
        except Exception:
            logger.exception("Dify Builder session %s stranded confirmed grants could not be observed", sid)
        if session_lock.exists(sid):
            continue  # a live advance holds the lock -- leave it alone
        try:
            # Only the observed grants settle, each only while still at its
            # observed generation: failed before any claim, unknown after one.
            # Owned by the consent service; never redispatched, counters never reset.
            settled = consent.reconcile_stranded(observation=observation) if observation is not None else 0
            if settled:
                logger.warning("Dify Builder session %s settled %s stranded confirmed grant(s)", sid, settled)
        except Exception:
            logger.exception("Dify Builder session %s stranded confirmed grant could not be settled", sid)
        progress_bus.publish(sid, {"kind": "error", "error": "interrupted"})
        logger.warning("Dify Builder session %s interrupted (state=%s, no live lock)", sid, state)
        flagged += 1
    try:
        # Repair settlements that failed after a command's terminal (review/FAILED)
        # commit: only reserved unfinished grants, never while a lease is live.
        repaired = consent.reconcile_terminal_grants(limit=_TERMINAL_REPAIR_LIMIT, lease_held=session_lock.exists)
        if repaired:
            logger.warning("Dify Builder settled %s confirmed grant(s) left by terminal commands", repaired)
    except Exception:
        logger.exception("Dify Builder terminal confirmed grant repair failed")
    reconcile_native_tests()
    return flagged


def reconcile_native_tests(*, limit: int = 100) -> int:
    """Recover durable native outbox/cleanup and missed terminal result projections."""
    from core.dify_builder.models import Actor
    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState
    from services.dify_builder.wiring import build_native_test_api_service, native_runtime_owner
    from tasks.dify_builder_advance_task import advance_native_test

    with _session_factory()() as session:
        owners = session.execute(
            select(
                DifyBuilderExecutionRequest.tenant_id,
                DifyBuilderExecutionRequest.actor_id,
                DifyBuilderExecutionRequest.session_id,
                DifyBuilderExecutionRequest.id,
            )
            .outerjoin(NativeDispatch, NativeDispatch.request_id == DifyBuilderExecutionRequest.id)
            .join(NativeInvocationState, NativeInvocationState.request_id == DifyBuilderExecutionRequest.id)
            .where(
                NativeDispatch.state.in_(("queued", "published", "claimed"))
                | (
                    NativeInvocationState.cancellation_key.is_not(None)
                    & NativeInvocationState.cleanup_complete.is_(False)
                )
            )
            .distinct()
            .order_by(DifyBuilderExecutionRequest.id.desc())
            .limit(limit)
        ).all()
    recovered = 0
    for tenant_id, actor_id, session_id, request_id in owners:
        try:
            actor = Actor(account_id=actor_id, tenant_id=tenant_id)
            service = build_native_test_api_service(actor=actor)
            recovered += service.reconcile_pending(
                actor=actor,
                session_id=session_id,
                request_id=request_id,
                publish=cast(Callable[..., None], advance_native_test.delay),
                limit=limit,
            )
        except Exception:
            logger.warning("Dify Builder native continuation requires attention (tenant=%s)", tenant_id)
    # Initial admission/ACK loss may have no NativeDispatch row. Recover its
    # observed pause in this existing worker, never as a side effect of GET.
    with _session_factory()() as session:
        observations = session.execute(
            select(
                DifyBuilderExecutionRequest.tenant_id,
                DifyBuilderExecutionRequest.actor_id,
                DifyBuilderExecutionRequest.session_id,
                DifyBuilderExecutionRequest.id,
            )
            .join(NativeInvocationState, NativeInvocationState.request_id == DifyBuilderExecutionRequest.id)
            .where(
                DifyBuilderExecutionRequest.context["profile"]["profile_id"].as_string()
                == "builder-agent-confirmed-v1",
                NativeInvocationState.parent_invocation_id.is_(None),
                NativeInvocationState.state == "running",
                ~select(NativeDispatch.id)
                .where(
                    NativeDispatch.request_id == DifyBuilderExecutionRequest.id,
                    NativeDispatch.state.in_(("queued", "published", "claimed")),
                )
                .exists(),
            )
            .distinct()
            .order_by(DifyBuilderExecutionRequest.id.desc())
            .limit(limit)
        ).all()
    for tenant_id, actor_id, session_id, request_id in observations:
        try:
            actor = Actor(account_id=actor_id, tenant_id=tenant_id)
            build_native_test_api_service(actor=actor).recover_observation(
                actor=actor, session_id=session_id, request_id=request_id
            )
        except Exception:
            logger.warning("Dify Builder native acknowledgement requires attention (request=%s)", request_id)
    from services.dify_builder.native_testing.confirmed_agent_completion import reconcile_completed_builder_runs

    recovered += reconcile_completed_builder_runs(sessions=_session_factory(), limit=limit)
    native_runtime_owner().retire_closed(sessions=_session_factory())
    return recovered
