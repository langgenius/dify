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

Runs on the existing ``dify_builder`` worker queue, also consumed by
``tasks.dify_builder_advance_task``. The default ``celery`` queue is not in
ordinary Builder worker subscriptions. The ``FlaskTask`` base
(``extensions.ext_celery.init_app``) already provides ``app_context``; this
module must not push its own.
"""

import logging
from collections.abc import Callable
from datetime import timedelta
from typing import cast
from uuid import UUID

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import String, func, select
from sqlalchemy import cast as cast_sql
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.dify_builder.state import PcState, is_working
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models.dify_builder import DifyBuilderSession
from services.dify_builder import progress_bus, session_lock
from services.dify_builder.real_call_consent_service import BuilderRealCallConsentService

logger = logging.getLogger(__name__)

__all__ = ["reconcile_interrupted_sessions"]

_WORKING_STATES = [str(s) for s in PcState if is_working(s)]


# Upper bound of reserved grants examined per sweep by the terminal-settlement repair.
_TERMINAL_REPAIR_LIMIT = 100
_WAITING_BINDING_CURSOR_KEY = "dify_builder:waiting_binding_retention:cursor"


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


@shared_task(queue="dify_builder", soft_time_limit=45, time_limit=50)
def retain_waiting_agent_bindings(*, limit: int = 100) -> int:
    """Bounded health-only retention, independent of the five-minute sweeper.

    The command owner repeats all current authority, checkpoint and workspace
    checks after this detached candidate scan. No recovery or dispatch occurs.
    """
    from core.dify_builder.models import Actor
    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeInvocationState, NativeTestInvocation, NativeTestScope
    from services.dify_builder.wiring import build_native_test_api_service

    if not 1 <= limit <= 100:
        return 0
    try:
        raw_cursor = redis_client.get(_WAITING_BINDING_CURSOR_KEY)
    except SoftTimeLimitExceeded:
        raise
    except Exception:
        logger.warning("Dify Builder waiting binding retention cursor unavailable")
        return 0
    cursor = None
    try:
        value = raw_cursor.decode("ascii") if isinstance(raw_cursor, bytes) and len(raw_cursor) == 36 else raw_cursor
        if isinstance(value, str) and len(value) == 36 and str(UUID(value)) == value:
            cursor = value
    except (ValueError, UnicodeError):
        pass  # Scheduling metadata is never authority or an SQL expression.
    query = (
        select(
            DifyBuilderExecutionRequest.tenant_id,
            DifyBuilderExecutionRequest.actor_id,
            DifyBuilderExecutionRequest.session_id,
            DifyBuilderExecutionRequest.id,
        )
        .join(
            NativeTestScope,
            (NativeTestScope.request_id == DifyBuilderExecutionRequest.id)
            & (NativeTestScope.tenant_id == DifyBuilderExecutionRequest.tenant_id),
        )
        .join(
            NativeInvocationState,
            (NativeInvocationState.request_id == DifyBuilderExecutionRequest.id)
            & (NativeInvocationState.tenant_id == DifyBuilderExecutionRequest.tenant_id),
        )
        .join(
            NativeTestInvocation,
            (NativeTestInvocation.request_id == NativeInvocationState.request_id)
            & (NativeTestInvocation.tenant_id == NativeInvocationState.tenant_id)
            & (NativeTestInvocation.invocation_id == NativeInvocationState.invocation_id),
        )
        .where(
            DifyBuilderExecutionRequest.context["profile"]["profile_id"].as_string() == "builder-agent-confirmed-v1",
            DifyBuilderExecutionRequest.state == "waiting",
            NativeTestScope.task_approved.is_(True),
            NativeTestScope.cancelled.is_(False),
            NativeTestScope.expires_at > naive_utc_now(),
            NativeInvocationState.parent_invocation_id.is_(None),
            NativeInvocationState.state == "waiting",
            NativeInvocationState.cancellation_key.is_(None),
            NativeTestInvocation.active.is_(True),
        )
        .order_by(DifyBuilderExecutionRequest.id)
        .limit(limit)
    )
    with _session_factory()() as session:
        selected = query.where(DifyBuilderExecutionRequest.id > cursor) if cursor is not None else query
        owners = session.execute(selected).all()
        if not owners and cursor is not None:
            owners = session.execute(query).all()
    retained = 0
    for tenant_id, actor_id, session_id, request_id in owners:
        try:
            # Advance before I/O, so a killed or slow prefix cannot monopolize
            # the next pass. This cursor never grants workspace authority.
            if not redis_client.set(_WAITING_BINDING_CURSOR_KEY, request_id, ex=3600):
                return retained
            actor = Actor(account_id=actor_id, tenant_id=tenant_id)
            retained += bool(
                build_native_test_api_service(actor=actor).keep_alive_waiting_binding(
                    actor=actor, session_id=session_id, request_id=request_id
                )
            )
        except SoftTimeLimitExceeded:
            raise
        except Exception:
            logger.warning("Dify Builder waiting binding retention unavailable (request=%s)", request_id)
    return retained


def reconcile_native_tests(*, limit: int = 100) -> int:
    """Recover durable native outbox/cleanup and missed terminal result projections."""
    from core.dify_builder.models import Actor
    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import (
        NativeDispatch,
        NativeEffectDispatchClaim,
        NativeEffectOperation,
        NativeEffectOutcome,
        NativeInvocationState,
        NativeTestInvocation,
        NativeTestScope,
    )
    from models.enums import CreatorUserRole
    from models.workflow import WorkflowRun
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
    # Initial admission/ACK loss may have no NativeDispatch row. Cancellation
    # also revokes its root before a child asynchronously acknowledges the stop.
    # Recover both observations here; public GET remains read-only and cancelled
    # children are only observed, never sent another cancellation RPC.
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
                (NativeInvocationState.state == "running")
                | ((NativeInvocationState.state == "cancelled") & (DifyBuilderExecutionRequest.state != "sealed")),
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
        # Quarantine is never an outbox candidate. Observe only a failed parent's
        # sole unused shell operation; the existing get owner must still prove
        # its exact source, protected receipts and child terminal events.
        unfinished_count = (
            select(func.count())
            .select_from(NativeEffectOperation)
            .where(
                NativeEffectOperation.request_id == DifyBuilderExecutionRequest.id,
                NativeEffectOperation.state.not_in(("completed", "failed", "not_dispatched")),
            )
            .correlate(DifyBuilderExecutionRequest)
            .scalar_subquery()
        )
        failed_unknowns = session.execute(
            select(
                DifyBuilderExecutionRequest.tenant_id,
                DifyBuilderExecutionRequest.actor_id,
                DifyBuilderExecutionRequest.session_id,
                DifyBuilderExecutionRequest.id,
                NativeTestInvocation.bindings,
                NativeEffectOperation.operation_digest,
            )
            .join(NativeInvocationState, NativeInvocationState.request_id == DifyBuilderExecutionRequest.id)
            .join(NativeTestScope, NativeTestScope.request_id == DifyBuilderExecutionRequest.id)
            .join(NativeTestInvocation, NativeTestInvocation.request_id == DifyBuilderExecutionRequest.id)
            .join(NativeEffectOperation, NativeEffectOperation.request_id == DifyBuilderExecutionRequest.id)
            .join(
                WorkflowRun,
                cast_sql(WorkflowRun.id, String)
                == func.coalesce(
                    cast_sql(DifyBuilderExecutionRequest.native_run_id, String),
                    DifyBuilderExecutionRequest.context["native_run_id"].as_string(),
                ),
            )
            .where(
                DifyBuilderExecutionRequest.context["profile"]["profile_id"].as_string()
                == "builder-agent-confirmed-v1",
                DifyBuilderExecutionRequest.state != "sealed",
                NativeInvocationState.parent_invocation_id.is_(None),
                NativeInvocationState.state == "unknown",
                NativeTestScope.cancelled.is_(False),
                NativeInvocationState.cancellation_key.is_(None),
                NativeInvocationState.tenant_id == DifyBuilderExecutionRequest.tenant_id,
                NativeTestScope.tenant_id == DifyBuilderExecutionRequest.tenant_id,
                NativeTestInvocation.tenant_id == DifyBuilderExecutionRequest.tenant_id,
                NativeTestInvocation.invocation_id == NativeInvocationState.invocation_id,
                NativeEffectOperation.tenant_id == DifyBuilderExecutionRequest.tenant_id,
                NativeEffectOperation.invocation_id == NativeInvocationState.invocation_id,
                NativeEffectOperation.state == "claimed",
                NativeEffectOperation.result_ref.is_(None),
                unfinished_count == 1,
                WorkflowRun.tenant_id == DifyBuilderExecutionRequest.tenant_id,
                WorkflowRun.app_id == DifyBuilderExecutionRequest.app_id,
                WorkflowRun.workflow_id == DifyBuilderExecutionRequest.workflow_id,
                WorkflowRun.created_by == DifyBuilderExecutionRequest.actor_id,
                WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
                WorkflowRun.status == "failed",
                ~select(NativeEffectDispatchClaim.id)
                .where(NativeEffectDispatchClaim.operation_id == NativeEffectOperation.id)
                .exists(),
                ~select(NativeEffectOutcome.id)
                .where(NativeEffectOutcome.operation_id == NativeEffectOperation.id)
                .exists(),
                ~select(NativeDispatch.id)
                .where(
                    NativeDispatch.request_id == DifyBuilderExecutionRequest.id,
                    NativeDispatch.state.in_(("queued", "published", "claimed")),
                )
                .exists(),
            )
            .order_by(DifyBuilderExecutionRequest.id.desc())
            .limit(max(0, limit - len(observations)))
        ).all()
        observations.extend(
            row[:4]
            for row in failed_unknowns
            if row.bindings.get(row.operation_digest, {}).get("kind") in {"shell", "bootstrap"}
        )
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
