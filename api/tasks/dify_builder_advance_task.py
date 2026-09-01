"""Celery task that runs the dify_builder engine's ``Runner.advance`` off the
request thread (P3b Task 4).

The usecase's ``dispatch`` (Task 3) acquires the cross-process advance lock
(``services.dify_builder.session_lock``) in the web process and enqueues
this task; this task runs the actual engine step in the Celery process and
releases the lock in ``finally`` -- regardless of whether the step succeeded,
lost a version-CAS race, or raised. Progress (per-node events during a
working step, plus the settled terminal state) is forwarded to the session's
progress bus (``services.dify_builder.progress_bus``) for the P3c SSE
endpoint to relay.

Each invocation opens its own ``sessionmaker(bind=db.engine, ...)`` --
mirrors ``services.dify_builder.dify_port._session_factory`` -- rather
than reusing the Flask-request-scoped ``db.session``, since this runs in a
Celery worker, not a Flask request. The ``FlaskTask`` base
(``extensions.ext_celery.init_app``) already wraps the task body in
``app.app_context()``, so this module must NOT push its own context.
"""

import logging
from dataclasses import asdict

from celery import shared_task
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.dify_builder.errors import ConflictError
from core.dify_builder.handlers_build import build_registry
from core.dify_builder.handlers_edit import edit_registry
from core.dify_builder.handlers_fix import fix_registry
from core.dify_builder.models import Action, Actor, NodeEvent, Turn
from core.dify_builder.runner import Env, Runner
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from services.dify_builder import progress_bus, session_lock
from services.dify_builder.agent_factory import build_dify_builder_agent
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService

logger = logging.getLogger(__name__)

__all__ = ["advance_session"]


def _build_repo() -> SqlDifyBuilderRepository:
    # Per-task sessionmaker (never the Flask-request-scoped db.session) --
    # mirrors dify_port._session_factory().
    return SqlDifyBuilderRepository(sessionmaker(bind=db.engine, expire_on_commit=False))


@shared_task(queue="dify_builder", soft_time_limit=dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS)
def advance_session(session_id: str, action_dict: dict, actor_dict: dict, token: str) -> None:
    """Run one ``Runner.advance`` for ``session_id``, then release the
    advance lock held under ``token``. Always releases the lock, even on a
    lost CAS race or an unexpected engine failure -- a stuck lock would wedge
    the session for its full TTL (``DIFY_BUILDER_MAX_ADVANCE_SECONDS``)."""
    try:
        repo = _build_repo()
        dify = WorkflowServiceDifyPort()
        actor = Actor(**actor_dict)
        # The per-session model choice lives on the context (stable for the session).
        # Read the head so the real agent is constructed with the user's chosen model.
        _s, _fc = repo.get_session(session_id)
        agent = build_dify_builder_agent(tenant_id=actor.tenant_id, model_config=_fc.model_config)

        def emit(ne: NodeEvent) -> None:
            progress_bus.publish(
                session_id,
                {"kind": "node", "node_id": ne.node_id, "title": ne.title, "status": ne.status, "error": ne.error},
            )

        def emit_canvas(event: dict) -> None:
            progress_bus.publish(session_id, {"kind": "canvas", **event})

        env = Env(dify=dify, agent=agent, repo=repo, now=naive_utc_now, emit=emit, emit_canvas=emit_canvas)
        runner = Runner(env, fix_registry() | build_registry() | edit_registry())
        runner.advance(session_id, Turn(action=Action(**action_dict), actor=actor))
        # Project a SessionView (single source of truth for phase/run_status/
        # actions) rather than recomputing those fields inline -- once Task 5
        # fills in `actions`, this frame gets them for free. The no-op
        # enqueue is never called by get_session_view; the actor is the
        # session owner (they dispatched this action), so the owner-check
        # inside get_session_view passes.
        view = DifyBuilderService(repo, session_lock, lambda *a, **k: None).get_session_view(session_id, actor)
        progress_bus.publish(session_id, {"kind": "state", **asdict(view)})
    except ConflictError:
        progress_bus.publish(session_id, {"kind": "error", "error": "conflict"})
    except Exception:
        # Generic message only -- never leak exception detail into the
        # progress event (it is relayed to the end user via SSE in P3c).
        logger.exception("dify_builder advance failed for session %s", session_id)
        progress_bus.publish(session_id, {"kind": "error", "error": "step failed"})
    finally:
        session_lock.release(session_id, token)
