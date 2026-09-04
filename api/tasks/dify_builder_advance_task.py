"""Celery task that runs the dify_builder engine's ``Runner.advance`` off the
request thread (P3b Task 4).

The usecase's ``dispatch`` (Task 3) acquires the cross-process advance lock
(``services.dify_builder.session_lock``) in the web process and enqueues
this task; this task runs the actual engine step in the Celery process and
releases the lock in ``finally`` -- regardless of whether the step succeeded,
lost a version-CAS race, or raised. Progress (curated phase snapshots,
per-node events during a working step, plus the settled terminal state) is
forwarded to the session's progress bus
(``services.dify_builder.progress_bus``) for the P3c SSE endpoint to relay.

Each invocation opens its own ``sessionmaker(bind=db.engine, ...)`` --
mirrors ``services.dify_builder.dify_port._session_factory`` -- rather
than reusing the Flask-request-scoped ``db.session``, since this runs in a
Celery worker, not a Flask request. The ``FlaskTask`` base
(``extensions.ext_celery.init_app``) already wraps the task body in
``app.app_context()``, so this module must NOT push its own context.
"""

import logging
import uuid
from dataclasses import asdict, replace

from celery import shared_task
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.dify_builder.contract import AgentMessageEventData, ErrorCard, ProgressEventData, Trace
from core.dify_builder.errors import ConflictError
from core.dify_builder.handlers_build import build_registry
from core.dify_builder.handlers_edit import edit_registry
from core.dify_builder.handlers_fix import fix_registry
from core.dify_builder.models import Action, Actor, NodeEvent, Session, Turn
from core.dify_builder.runner import CommittedTransition, Env, Runner
from core.dify_builder.state import PcState, is_terminal
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


def _persist_failed_state(
    repo: SqlDifyBuilderRepository,
    session_id: str,
    *,
    expected_version: int,
    expected_state: PcState,
) -> CommittedTransition | None:
    """Persist a generic terminal failure even when agent construction failed."""
    session, context = repo.get_session(session_id)
    if is_terminal(session.current_state):
        return None
    if session.version != expected_version or session.current_state != expected_state:
        raise ConflictError(
            f"dify_builder: refusing stale setup failure for session {session_id} "
            f"at version {session.version} state {session.current_state}"
        )
    operation_id = str(uuid.uuid4())
    at_version = session.version + 1
    item = ErrorCard(
        title="Builder step failed",
        body="The operation could not be completed. Restart from the current draft to continue.",
    ).to_item(seq=context.next_seq, at_version=at_version)
    context.next_seq += 1
    version = repo.compare_and_advance(session.id, session.version, PcState.FAILED, context, [item])
    return CommittedTransition(
        session_id=session.id,
        operation_id=operation_id,
        stage_id=str(session.current_state),
        at_version=version,
        version=version,
        state=PcState.FAILED,
        settled=True,
        items=[item],
    )


@shared_task(queue="dify_builder", soft_time_limit=dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS)
def advance_session(session_id: str, action_dict: dict, actor_dict: dict, token: str) -> None:
    """Run one ``Runner.advance`` for ``session_id``, then release the
    advance lock held under ``token``. Always releases the lock, even on a
    lost CAS race or an unexpected engine failure -- a stuck lock would wedge
    the session for its full TTL (``DIFY_BUILDER_MAX_ADVANCE_SECONDS``)."""
    terminal_error: dict | None = None
    completed: tuple[SqlDifyBuilderRepository, WorkflowServiceDifyPort, Actor] | None = None
    repo: SqlDifyBuilderRepository | None = None
    dify: WorkflowServiceDifyPort | None = None
    actor: Actor | None = None
    runner: Runner | None = None
    env: Env | None = None
    loaded_session: Session | None = None
    last_progress: ProgressEventData | None = None
    try:
        repo = _build_repo()
        dify = WorkflowServiceDifyPort()
        actor = Actor(**actor_dict)
        # The per-session model choice lives on the context (stable for the session).
        # Read the head so the real agent is constructed with the user's chosen model.
        loaded_session, _fc = repo.get_session(session_id)
        agent = build_dify_builder_agent(tenant_id=actor.tenant_id, model_config=_fc.model_config)

        def emit(ne: NodeEvent) -> None:
            assert env is not None
            try:
                progress_bus.publish(
                    session_id,
                    {
                        "kind": "node",
                        "session_id": session_id,
                        "operation_id": env.operation_id,
                        "stage_id": env.stage_id,
                        "at_version": env.at_version,
                        "revision": env.next_event_revision(),
                        "node_id": ne.node_id,
                        "title": ne.title,
                        "status": ne.status,
                        "error": ne.error,
                    },
                )
            except Exception:
                logger.exception("dify_builder node event publish failed for session %s", session_id)

        def emit_canvas(event: dict) -> None:
            assert env is not None
            try:
                progress_bus.publish(
                    session_id,
                    {
                        "kind": "canvas",
                        "session_id": session_id,
                        "operation_id": env.operation_id,
                        "stage_id": env.stage_id,
                        "at_version": env.at_version,
                        "revision": env.next_event_revision(),
                        **event,
                    },
                )
            except Exception:
                logger.exception("dify_builder canvas event publish failed for session %s", session_id)

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

        def emit_progress(progress: ProgressEventData) -> None:
            nonlocal last_progress
            last_progress = progress
            try:
                progress_bus.publish(session_id, asdict(progress))
            except Exception:
                # Phase progress is an observer notification. The following
                # commit/state frames still carry the authoritative result.
                logger.exception(
                    "dify_builder progress event publish failed for session %s operation %s",
                    session_id,
                    progress.operation_id,
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
            emit_progress=emit_progress,
        )
        runner = Runner(env, fix_registry() | build_registry() | edit_registry())
        env.begin_operation(loaded_session)
        action = Action(**action_dict)
        if action.base_app_revision:
            _graph, current_app_revision = dify.read_graph(loaded_session.app_id, actor)
            if action.base_app_revision != current_app_revision:
                raise ConflictError(f"stale app revision for app {loaded_session.app_id}")
        runner.advance(session_id, Turn(action=action, actor=actor))
        completed = (repo, dify, actor)
    except (ConflictError, HashMismatchError):
        terminal_error = {"kind": "error", "error": "conflict"}
    except Exception:
        # Generic message only -- never leak exception detail into the
        # progress event (it is relayed to the end user via SSE in P3c).
        logger.exception("dify_builder advance failed for session %s", session_id)
        if last_progress is not None and last_progress.trace.status == "running":
            failed_trace = Trace(
                status="error",
                steps=[
                    replace(step, state="stopped", tone="error") if step.state == "active" else replace(step)
                    for step in last_progress.trace.steps
                ],
            )
            try:
                progress_bus.publish(
                    session_id,
                    asdict(replace(last_progress, revision=last_progress.revision + 1, trace=failed_trace)),
                )
            except Exception:
                logger.exception("dify_builder failed progress publish failed for session %s", session_id)
        if runner is not None:
            try:
                runner.fail(session_id)
                assert repo is not None
                assert dify is not None
                assert actor is not None
                completed = (repo, dify, actor)
            except ConflictError:
                logger.warning("dify_builder stale worker failure ignored for session %s", session_id)
                terminal_error = {"kind": "error", "error": "conflict"}
            except Exception:
                logger.exception("dify_builder could not persist failed state for session %s", session_id)
                terminal_error = {"kind": "error", "error": "step failed", "recoverable": True}
        elif repo is not None and loaded_session is not None:
            try:
                failure_commit = _persist_failed_state(
                    repo,
                    session_id,
                    expected_version=loaded_session.version,
                    expected_state=loaded_session.current_state,
                )
                if failure_commit is not None:
                    progress_bus.publish(session_id, {"kind": "commit", **asdict(failure_commit)})
                if dify is not None and actor is not None:
                    completed = (repo, dify, actor)
                else:
                    terminal_error = {"kind": "error", "error": "step failed", "recoverable": True}
            except ConflictError:
                logger.warning("dify_builder stale setup failure ignored for session %s", session_id)
                terminal_error = {"kind": "error", "error": "conflict"}
            except Exception:
                logger.exception("dify_builder could not persist early failed state for session %s", session_id)
                terminal_error = {"kind": "error", "error": "step failed", "recoverable": True}
        else:
            terminal_error = {"kind": "error", "error": "step failed", "recoverable": True}
    finally:
        session_lock.release(session_id, token)

    # Publish terminal frames only after releasing the lock so the
    # authoritative SSE state no longer projects a completed/waiting
    # transition as executing.
    if terminal_error is not None:
        progress_bus.publish(session_id, terminal_error)
    elif completed is not None:
        # The advance already succeeded and the lock is released; the session is
        # durable. But the view projection (read_graph) or the publish itself can
        # still raise -- and if this block let that escape, NO terminal frame
        # would reach the SSE client, hanging its stream to the deadline with a
        # stale held version (-> 409 on its next action). Fall back to a terminal
        # error frame so the client stream always ends.
        try:
            repo, dify, actor = completed
            view = DifyBuilderService(
                repo,
                session_lock,
                lambda *a, **k: None,
                get_app_revision_fn=lambda app_id, owner: dify.read_graph(app_id, owner)[1],
            ).get_session_view(session_id, actor)
            progress_bus.publish(session_id, {"kind": "state", **asdict(view)})
        except Exception:
            logger.exception("dify_builder terminal state projection/publish failed for session %s", session_id)
            try:
                progress_bus.publish(session_id, {"kind": "error", "error": "step failed"})
            except Exception:
                logger.exception("dify_builder terminal error frame also failed to publish for session %s", session_id)
