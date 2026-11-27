"""Advance one Builder session on its worker and release the owned lease.

The Console enqueues a versioned action. The worker runs the durable state
machine, relays ordinary debugger events, and publishes the current projection.
A failed assistant reply can retry the same turn without duplicating user input.
"""

import logging
from collections.abc import Mapping
from contextlib import ExitStack
from dataclasses import asdict, replace

from celery import shared_task
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.dify_builder.contract import (
    AgentMessageEventData,
    AssistantReplyMode,
    AssistantTurnItem,
    ConversationItemAppendedEventData,
    ExecutionActivity,
    ExecutionActivityState,
    ExecutionProgress,
    ExecutionProgressStatus,
    ProgressEventData,
    ReasoningEventData,
    WorkflowEventData,
    post_canvas_action_id,
)
from core.dify_builder.errors import ConflictError
from core.dify_builder.models import CONFIRMED_TOOL_ACTION, Action, Actor, Session, Turn
from core.dify_builder.state import PcState, is_terminal
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.presentation import copy_text
from services.dify_builder import progress_bus, progress_snapshot, session_lock
from services.dify_builder.action_policy import requires_app_revision
from services.dify_builder.agent.localize import LanguageDetector
from services.dify_builder.agent_factory import build_dify_builder_agent
from services.dify_builder.application.cognition_policy import CognitionPolicyDeniedError
from services.dify_builder.application.handlers_build import build_registry
from services.dify_builder.application.handlers_edit import edit_registry
from services.dify_builder.application.handlers_fix import fix_registry
from services.dify_builder.application.runner import Env, Runner
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.errors import HashMismatchError
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import executable_graph_revision
from services.dify_builder.service import DifyBuilderService, _phase_for
from services.dify_builder.session_lock import active_advance_time_limit
from services.dify_builder.task_controls import ExecutionFence, execution_scope, generation, require_active

logger = logging.getLogger(__name__)

__all__ = ["advance_session"]

_COMMAND_FINISHED_UNAVAILABLE_CODE = "command_finished_unavailable"


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
    command_id: str,
) -> int | None:
    """Persist a generic terminal failure even when agent construction failed."""
    session, context = repo.get_session(session_id)
    if is_terminal(session.current_state):
        return None
    if session.version != expected_version or session.current_state != expected_state:
        raise ConflictError(
            f"dify_builder: refusing stale setup failure for session {session_id} "
            f"at version {session.version} state {session.current_state}"
        )
    at_version = session.version + 1
    item = AssistantTurnItem(
        turn_id=command_id,
        stage_id=str(session.current_state),
        execution=ExecutionProgress(status=ExecutionProgressStatus.ERROR),
        reply_text=copy_text(BuilderCopyId.OPERATION_FAILED),
        reply_mode=AssistantReplyMode.COMPLETE,
        reply_language=context.reply_language,
    ).to_item(seq=context.next_seq, at_version=at_version)
    context.next_seq += 1
    context.last_command_id = command_id
    # Terminal: a pending confirmed command reference never survives into a retry.
    context.confirmed_consent_id = ""
    context.confirmed_command_id = ""
    return repo.compare_and_advance(session.id, session.version, PcState.FAILED, context, [item])


@shared_task(
    queue="dify_builder",
    soft_time_limit=dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS,
    time_limit=active_advance_time_limit(),
)
def advance_session(session_id: str, action_dict: dict, actor_dict: dict, token: str) -> None:
    """Run one ``Runner.advance`` for ``session_id``, then release the
    advance lock this worker activated from ``token``. Always releases its own
    lock, even on a lost CAS race or an unexpected engine failure -- a stuck
    lock would wedge the session for its full TTL
    (``DIFY_BUILDER_MAX_ADVANCE_SECONDS``). A delivery that cannot activate the
    token (stale, or a duplicate of a running command) neither runs nor releases."""
    # Exactly one delivery owns the lease; a duplicate or stale delivery gets None and never
    # runs or releases, so it cannot delete an active worker's lease.
    owner = session_lock.activate(session_id, token)
    if not owner:
        logger.warning("dify_builder stale or duplicate queued advance ignored for session %s", session_id)
        return

    terminal_error: dict | None = None
    completed: tuple[SqlDifyBuilderRepository, WorkflowServiceDifyPort, Actor] | None = None
    repo: SqlDifyBuilderRepository | None = None
    dify: WorkflowServiceDifyPort | None = None
    actor: Actor | None = None
    runner: Runner | None = None
    env: Env | None = None
    loaded_session: Session | None = None
    last_progress: ProgressEventData | None = None
    progress_activities: dict[str, ExecutionActivity] = {}
    progress_operation_id = ""
    action: Action | None = None
    fence: ExecutionFence | None = None

    def delivery_active() -> bool:
        if repo is None or fence is None:
            return False
        try:
            require_active(repo, session_id, fence.generation, writer_token=token)
            return True
        except ConflictError:
            return False

    # Keep command authority through setup, execution, and failure compensation.
    # In particular, an exception must not drop the SQL fence before Runner.fail.
    execution = ExitStack()
    try:
        repo = _build_repo()
        if not repo.activate_workflow_writer(session_id, token, active_advance_time_limit() + 30):
            raise ConflictError("workflow writer was superseded or expired")
        dify = WorkflowServiceDifyPort()
        actor = Actor(**actor_dict)
        action = Action(**action_dict)
        if action.kind == CONFIRMED_TOOL_ACTION:
            # A queued approval from the retired executor cannot authorize an ordinary run.
            return
        expected_generation = action.execution_generation
        if expected_generation is None:
            _, observed = repo.get_session_at_version(session_id, action.base_version)
            expected_generation = generation(observed)
        action.execution_generation = expected_generation

        def check_fence() -> None:
            assert fence is not None
            require_active(repo, session_id, fence.generation, writer_token=token)

        fence = ExecutionFence(session_id, expected_generation, check_fence, {}, writer_token=token)
        execution.enter_context(execution_scope(fence))
        check_fence()
        if action.kind == "task_continue":
            from services.dify_builder.task_control_service import claim_continuation, refresh_continuation

            claim_continuation(repo, session_id, actor, action)
            refresh_continuation(repo, dify, session_id, actor, action)
        # The per-session model choice lives on the context (stable for the session).
        # Read the head so the real agent is constructed with the user's chosen model.
        loaded_session, _fc = repo.get_session(session_id)
        try:
            progress_bus.publish(
                session_id,
                {
                    "kind": "command_started",
                    "session_id": session_id,
                    "command_id": action.command_id,
                    "version": loaded_session.version,
                    "phase": _phase_for(loaded_session.current_state),
                },
            )
        except Exception:
            logger.warning("Builder command start notification unavailable for session %s", session_id)
        from services.dify_builder.application.cognition_policy import cognition_admission_required

        if cognition_admission_required(action.kind):
            from extensions.application_services.dify_builder_cognition_policy import select_cognition_config

            select_cognition_config(actor, _fc.model_config)
        require_active(repo, session_id, expected_generation, writer_token=token)
        agent = build_dify_builder_agent(
            tenant_id=actor.tenant_id,
            model_config=_fc.model_config,
            account_id=actor.account_id,
            app_mode=dify.get_app_mode(loaded_session.app_id, actor),
            app_id=loaded_session.app_id,
        )

        def emit_workflow(payload: Mapping[str, object]) -> None:
            if not delivery_active():
                return
            assert env is not None
            try:
                progress_bus.publish(
                    session_id,
                    asdict(
                        WorkflowEventData(
                            session_id=session_id,
                            operation_id=env.operation_id,
                            stage_id=env.stage_id,
                            at_version=env.at_version,
                            revision=env.next_event_revision(),
                            payload=dict(payload),
                        )
                    ),
                )
            except Exception:
                logger.exception("dify_builder workflow event publish failed for session %s", session_id)

        def emit_canvas(event: dict) -> None:
            if not delivery_active():
                return
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

        def emit_message(message: AgentMessageEventData) -> None:
            if not delivery_active():
                return
            try:
                progress_bus.publish(session_id, asdict(message))
            except Exception:
                # Streaming delivery is best effort. The terminal sequence
                # watermark exposes the missing assistant item so the client
                # can recover it through the history endpoint.
                logger.exception(
                    "dify_builder agent_message event publish failed for session %s turn %s",
                    session_id,
                    message.turn_id,
                )

        def emit_item(event: ConversationItemAppendedEventData) -> None:
            if not delivery_active():
                return
            try:
                progress_bus.publish(session_id, asdict(event))
            except Exception:
                # The terminal sequence watermark lets the client detect this
                # missing item and recover it through the history endpoint.
                logger.exception(
                    "dify_builder conversation item event publish failed for session %s seq %s",
                    session_id,
                    event.item.seq,
                )

        def emit_reasoning(reasoning: ReasoningEventData) -> None:
            if not delivery_active():
                return
            try:
                progress_bus.publish(session_id, asdict(reasoning))
            except Exception:
                logger.exception(
                    "dify_builder reasoning event publish failed for session %s operation %s",
                    session_id,
                    reasoning.operation_id,
                )

        def emit_progress(progress: ProgressEventData) -> None:
            nonlocal last_progress, progress_operation_id
            if not delivery_active():
                return
            if progress.operation_id != progress_operation_id:
                progress_activities.clear()
                progress_operation_id = progress.operation_id
            if progress.activity is not None:
                progress_activities[progress.activity.id] = replace(progress.activity)
            last_progress = progress
            assert actor is not None
            try:
                progress_snapshot.save(
                    progress_snapshot.ProgressSnapshot(
                        session_id=session_id,
                        operation_id=progress.operation_id,
                        at_version=progress.at_version,
                        revision=progress.revision,
                        reply_language=progress.reply_language,
                        execution=ExecutionProgress(
                            status=progress.status, activities=list(progress_activities.values())
                        ),
                    ),
                    tenant_id=actor.tenant_id,
                    owner=owner,
                )
            except Exception:
                logger.exception("dify_builder progress snapshot save failed for session %s", session_id)
            try:
                progress_bus.publish(session_id, asdict(progress))
            except Exception:
                # Phase progress is an observer notification. The following
                # command_finished still carries the authoritative projection.
                logger.exception(
                    "dify_builder progress event publish failed for session %s operation %s",
                    session_id,
                    progress.operation_id,
                )

        language_detector = LanguageDetector(agent.model_or_none, prior_language=_fc.reply_language)

        from services.dify_builder.wiring import build_attachment_intake

        env = Env(
            dify=dify,
            agent=agent,
            repo=repo,
            now=naive_utc_now,
            emit_workflow=emit_workflow,
            emit_canvas=emit_canvas,
            emit_message=emit_message,
            emit_item=emit_item,
            emit_progress=emit_progress,
            emit_reasoning=emit_reasoning,
            # Native controls/history must not gain an optional inference just
            # because an old session has no persisted reply language.
            detect_language=language_detector.detect_language if cognition_admission_required(action.kind) else None,
            consume_material=build_attachment_intake(repo).consume,
            command_id=action.command_id,
        )
        runner = Runner(env, fix_registry() | build_registry() | edit_registry())
        if action.base_app_revision and requires_app_revision(action):
            _graph, current_app_revision = dify.read_graph(loaded_session.app_id, actor)
            if action.base_app_revision != current_app_revision:
                raise ConflictError(f"stale app revision for app {loaded_session.app_id}")
        fence.dsl = _fc.task_control.get("dsl", {})
        runner.advance(session_id, Turn(action=action, actor=actor))
        action.execution_generation = fence.generation
        completed = (repo, dify, actor)
    except CognitionPolicyDeniedError as error:
        terminal_error = {
            "kind": "error",
            "error": "model_unavailable",
            "reason_code": error.reason,
            "recoverable": True,
            "session_id": session_id,
            "command_id": action.command_id if action is not None else action_dict.get("command_id"),
        }
    except (ConflictError, HashMismatchError):
        if repo is not None and action is not None and action.kind == "task_continue":
            from services.dify_builder.task_control_service import release_unstarted_continuation

            try:
                release_unstarted_continuation(repo, session_id, action)
            except ConflictError:
                logger.warning("dify_builder stale continuation compensation ignored for session %s", session_id)
        terminal_error = {
            "kind": "error",
            "error": "conflict",
            "session_id": session_id,
            "command_id": action.command_id if action is not None else action_dict.get("command_id"),
        }
    except Exception:
        # Generic message only -- never leak exception detail into the
        # progress event (it is relayed to the end user via SSE in P3c).
        logger.exception("dify_builder advance failed for session %s", session_id)
        if last_progress is not None and last_progress.status == "running" and delivery_active():
            active_activities = [activity for activity in progress_activities.values() if activity.state == "active"]
            failure_deltas = [
                replace(activity, state=ExecutionActivityState.FAILED) for activity in active_activities
            ] or [None]
            try:
                for revision_offset, activity in enumerate(failure_deltas, start=1):
                    progress_bus.publish(
                        session_id,
                        asdict(
                            replace(
                                last_progress,
                                revision=last_progress.revision + revision_offset,
                                status=ExecutionProgressStatus.ERROR,
                                activity=activity,
                            )
                        ),
                    )
            except Exception:
                logger.exception("dify_builder failed progress publish failed for session %s", session_id)
        retryable_message_failure = False
        failed_action_kind = action.kind if action is not None else action_dict.get("kind")
        failed_action_payload = action.payload if action is not None else action_dict.get("payload")
        if repo is not None and failed_action_kind == "message" and isinstance(failed_action_payload, dict):
            client_turn_id = failed_action_payload.get("client_turn_id")
            if isinstance(client_turn_id, str) and client_turn_id:
                try:
                    turn_kinds = repo.get_conversation_turn_kinds(session_id, client_turn_id)
                    retryable_message_failure = "user" in turn_kinds and "assistant_turn" not in turn_kinds
                except Exception:
                    logger.exception(
                        "dify_builder could not inspect failed message turn for session %s",
                        session_id,
                    )

        if retryable_message_failure:
            terminal_error = {
                "kind": "error",
                "error": "step failed",
                "recoverable": True,
                "session_id": session_id,
                "command_id": action.command_id if action is not None else action_dict.get("command_id"),
            }
        elif runner is not None:
            try:
                assert repo is not None
                # ``Runner.fail`` normally fences with the operation metadata
                # established by ``Runner.advance``. If a failure happens
                # before that metadata is initialized, compare against the
                # head loaded by this worker so an expired/stale worker cannot
                # overwrite a transition committed by a newer one.
                if env is not None and env.at_version <= 0 and loaded_session is not None:
                    current, _context = repo.get_session(session_id)
                    if (
                        current.version != loaded_session.version
                        or current.current_state != loaded_session.current_state
                    ):
                        raise ConflictError(
                            f"dify_builder: refusing stale failure for session {session_id} "
                            f"at version {current.version} state {current.current_state}"
                        )
                runner.fail(session_id)
                assert dify is not None
                assert actor is not None
                completed = (repo, dify, actor)
            except ConflictError:
                logger.warning("dify_builder stale worker failure ignored for session %s", session_id)
                terminal_error = {
                    "kind": "error",
                    "error": "conflict",
                    "session_id": session_id,
                    "command_id": action.command_id if action is not None else action_dict.get("command_id"),
                }
            except Exception:
                logger.exception("dify_builder could not persist failed state for session %s", session_id)
                terminal_error = {
                    "kind": "error",
                    "error": "step failed",
                    "recoverable": True,
                    "session_id": session_id,
                    "command_id": action.command_id if action is not None else action_dict.get("command_id"),
                }
        elif repo is not None and loaded_session is not None:
            try:
                _persist_failed_state(
                    repo,
                    session_id,
                    expected_version=loaded_session.version,
                    expected_state=loaded_session.current_state,
                    command_id=action.command_id if action is not None else str(action_dict.get("command_id") or ""),
                )
                if dify is not None and actor is not None:
                    completed = (repo, dify, actor)
                else:
                    terminal_error = {
                        "kind": "error",
                        "error": "step failed",
                        "recoverable": True,
                        "session_id": session_id,
                        "command_id": action.command_id if action is not None else action_dict.get("command_id"),
                    }
            except ConflictError:
                logger.warning("dify_builder stale setup failure ignored for session %s", session_id)
                terminal_error = {
                    "kind": "error",
                    "error": "conflict",
                    "session_id": session_id,
                    "command_id": action.command_id if action is not None else action_dict.get("command_id"),
                }
            except Exception:
                logger.exception("dify_builder could not persist early failed state for session %s", session_id)
                terminal_error = {
                    "kind": "error",
                    "error": "step failed",
                    "recoverable": True,
                    "session_id": session_id,
                    "command_id": action.command_id if action is not None else action_dict.get("command_id"),
                }
        else:
            terminal_error = {
                "kind": "error",
                "error": "step failed",
                "recoverable": True,
                "session_id": session_id,
                "command_id": action.command_id if action is not None else action_dict.get("command_id"),
            }
    finally:
        execution.close()
        # Only this worker's owner value releases the activated lease.
        try:
            if repo is not None:
                repo.release_workflow_writer(session_id, token=token)
        except Exception:
            logger.exception("dify_builder writer release deferred to expiry for session %s", session_id)
        finally:
            session_lock.release(session_id, owner)
        if repo is not None and actor is not None:
            from services.dify_builder.task_control_service import observe_stop

            try:
                observe_stop(repo, session_id, actor)
            except Exception:
                logger.exception("dify_builder stop settlement observation failed for session %s", session_id)

    if repo is not None and action is not None:
        _, head_context = repo.get_session(session_id)
        if head_context.paused or (
            action.execution_generation is not None and generation(head_context) != action.execution_generation
        ):
            return

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
            from services.dify_builder.wiring import build_attachment_intake

            def get_verification_identity(app_id: str, owner: Actor) -> tuple[str, str]:
                graph, revision = dify.read_graph(app_id, owner)
                return revision, executable_graph_revision(graph)

            view = DifyBuilderService(
                repo,
                session_lock,
                lambda *a, **k: None,
                get_app_revision_fn=lambda app_id, owner: dify.read_graph(app_id, owner)[1],
                get_verification_identity_fn=get_verification_identity,
                attachment_intake=build_attachment_intake(repo),
            ).get_session_view(session_id, actor)
            progress_bus.publish(
                session_id,
                {
                    "kind": "command_finished",
                    **asdict(view),
                    "command_id": action.command_id if action is not None else action_dict.get("command_id", ""),
                    "post_canvas_action_id": post_canvas_action_id(
                        str(loaded_session.current_state) if loaded_session is not None else None,
                        action.kind if action is not None else action_dict.get("kind"),
                        completed_state=view.state,
                        available_action_ids=[available.id for available in view.actions],
                    ),
                },
            )
        except Exception:
            logger.exception("dify_builder command_finished projection/publish failed for session %s", session_id)
            try:
                progress_bus.publish(
                    session_id,
                    {
                        "kind": "error",
                        "code": _COMMAND_FINISHED_UNAVAILABLE_CODE,
                        "error": "step failed",
                        "session_id": session_id,
                        "command_id": action.command_id if action is not None else action_dict.get("command_id"),
                    },
                )
            except Exception:
                logger.exception("dify_builder terminal error frame also failed to publish for session %s", session_id)

    if completed is not None and terminal_error is None:
        from services.dify_builder.wiring import dispatch_pending_builder_material

        try:
            completed_repo, _, completed_actor = completed
            dispatch_pending_builder_material(completed_repo, session_id, completed_actor)
        except Exception:
            logger.exception("dify_builder pending material handoff unavailable for session %s", session_id)
