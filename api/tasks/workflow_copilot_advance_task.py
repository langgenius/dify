"""Celery task that runs the copilot engine's ``Runner.advance`` off the
request thread (P3b Task 4).

The usecase's ``dispatch`` (Task 3) acquires the cross-process advance lock
(``services.workflow_copilot.session_lock``) in the web process and enqueues
this task; this task runs the actual engine step in the Celery process and
releases the lock in ``finally`` -- regardless of whether the step succeeded,
lost a version-CAS race, or raised. Progress (per-node events during a
working step, plus the settled terminal state) is forwarded to the session's
progress bus (``services.workflow_copilot.progress_bus``) for the P3c SSE
endpoint to relay.

Each invocation opens its own ``sessionmaker(bind=db.engine, ...)`` --
mirrors ``services.workflow_copilot.dify_port._session_factory`` -- rather
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
from core.workflow_copilot.errors import ConflictError
from core.workflow_copilot.handlers_build import build_registry
from core.workflow_copilot.handlers_fix import fix_registry
from core.workflow_copilot.models import Action, Actor, NodeEvent, Turn
from core.workflow_copilot.runner import Env, Runner
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from services.workflow_copilot import progress_bus, session_lock
from services.workflow_copilot.agent_factory import build_copilot_agent
from services.workflow_copilot.dify_port import WorkflowServiceDifyPort
from services.workflow_copilot.repository import SqlCopilotRepository
from services.workflow_copilot.service import WorkflowCopilotService

logger = logging.getLogger(__name__)

__all__ = ["advance_session"]


def _build_repo() -> SqlCopilotRepository:
    # Per-task sessionmaker (never the Flask-request-scoped db.session) --
    # mirrors dify_port._session_factory().
    return SqlCopilotRepository(sessionmaker(bind=db.engine, expire_on_commit=False))


@shared_task(queue="workflow_copilot", soft_time_limit=dify_config.WORKFLOW_COPILOT_MAX_ADVANCE_SECONDS)
def advance_session(session_id: str, action_dict: dict, actor_dict: dict, token: str) -> None:
    """Run one ``Runner.advance`` for ``session_id``, then release the
    advance lock held under ``token``. Always releases the lock, even on a
    lost CAS race or an unexpected engine failure -- a stuck lock would wedge
    the session for its full TTL (``WORKFLOW_COPILOT_MAX_ADVANCE_SECONDS``)."""
    try:
        repo = _build_repo()
        dify = WorkflowServiceDifyPort()
        agent = build_copilot_agent()

        def emit(ne: NodeEvent) -> None:
            progress_bus.publish(
                session_id,
                {"kind": "node", "node_id": ne.node_id, "title": ne.title, "status": ne.status, "error": ne.error},
            )

        def emit_canvas(event: dict) -> None:
            progress_bus.publish(session_id, {"kind": "canvas", **event})

        actor = Actor(**actor_dict)
        env = Env(dify=dify, agent=agent, repo=repo, now=naive_utc_now, emit=emit, emit_canvas=emit_canvas)
        runner = Runner(env, fix_registry() | build_registry())
        runner.advance(session_id, Turn(action=Action(**action_dict), actor=actor))
        # Project a SessionView (single source of truth for phase/run_status/
        # actions) rather than recomputing those fields inline -- once Task 5
        # fills in `actions`, this frame gets them for free. The no-op
        # enqueue is never called by get_session_view; the actor is the
        # session owner (they dispatched this action), so the owner-check
        # inside get_session_view passes.
        view = WorkflowCopilotService(repo, session_lock, lambda *a, **k: None).get_session_view(session_id, actor)
        progress_bus.publish(
            session_id,
            {
                "kind": "state",
                "version": view.version,
                "phase": str(view.phase),
                "run_status": str(view.run_status),
                "state": view.state,
                "canvas_read_only": view.canvas_read_only,
                "actions": [asdict(a) for a in view.actions],
            },
        )
    except ConflictError:
        progress_bus.publish(session_id, {"kind": "error", "error": "conflict"})
    except Exception:
        # Generic message only -- never leak exception detail into the
        # progress event (it is relayed to the end user via SSE in P3c).
        logger.exception("copilot advance failed for session %s", session_id)
        progress_bus.publish(session_id, {"kind": "error", "error": "step failed"})
    finally:
        session_lock.release(session_id, token)
