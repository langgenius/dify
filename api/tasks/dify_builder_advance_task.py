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
from core.dify_builder.contract import AgentMessageEventData
from core.dify_builder.errors import ConflictError
from core.dify_builder.handlers_build import build_registry
from core.dify_builder.handlers_edit import edit_registry
from core.dify_builder.handlers_fix import fix_registry
from core.dify_builder.models import Action, Actor, NodeEvent, Turn
from core.dify_builder.runner import CommittedTransition, Env, Runner
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from services.dify_builder import progress_bus, session_lock
from services.dify_builder.agent_factory import build_dify_builder_agent
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.errors import HashMismatchError
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
    terminal_error: dict | None = None
    completed: tuple[SqlDifyBuilderRepository, WorkflowServiceDifyPort, Actor] | None = None
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

        def emit_commit(commit: CommittedTransition) -> None:
            try:
                progress_bus.publish(session_id, {"kind": "commit", **asdict(commit)})
            except Exception:
                # A commit event is an observer notification for state that is
                # already durable. Losing the notification must not abort the
                # engine or suppress the final authoritative state frame.
                logger.exception(
                    "dify_builder commit event publish failed for session %s version %s",
                    session_id,
                    commit.version,
                )

        def emit_message(message: AgentMessageEventData) -> None:
            try:
                progress_bus.publish(session_id, asdict(message))
            except Exception:
                # Streaming delivery is best effort. The complete answer is
                # still persisted and delivered in commit/state frames.
                logger.exception(
                    "dify_builder agent_message event publish failed for session %s turn %s",
                    session_id,
                    message.id,
                )

        env = Env(
            dify=dify,
            agent=agent,
            repo=repo,
            now=naive_utc_now,
            emit=emit,
            emit_canvas=emit_canvas,
            emit_commit=emit_commit,
            emit_message=emit_message,
        )
        runner = Runner(env, fix_registry() | build_registry() | edit_registry())
        action = Action(**action_dict)
        if action.base_app_revision:
            _graph, current_app_revision = dify.read_graph(_s.app_id, actor)
            if action.base_app_revision != current_app_revision:
                raise ConflictError(f"stale app revision for app {_s.app_id}")
        runner.advance(session_id, Turn(action=action, actor=actor))
        completed = (repo, dify, actor)
    except (ConflictError, HashMismatchError):
        terminal_error = {"kind": "error", "error": "conflict"}
    except Exception:
        # Generic message only -- never leak exception detail into the
        # progress event (it is relayed to the end user via SSE in P3c).
        logger.exception("dify_builder advance failed for session %s", session_id)
        terminal_error = {"kind": "error", "error": "step failed"}
    finally:
        session_lock.release(session_id, token)

    # Publish terminal frames only after releasing the lock so the
    # authoritative SSE state no longer projects a completed/waiting
    # transition as executing.
    if terminal_error is not None:
        progress_bus.publish(session_id, terminal_error)
    elif completed is not None:
        repo, dify, actor = completed
        view = DifyBuilderService(
            repo,
            session_lock,
            lambda *a, **k: None,
            get_app_revision_fn=lambda app_id, owner: dify.read_graph(app_id, owner)[1],
        ).get_session_view(session_id, actor)
        progress_bus.publish(session_id, {"kind": "state", **asdict(view)})
