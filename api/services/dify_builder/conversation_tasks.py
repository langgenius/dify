"""Continue a completed Builder task without replacing its owned transcript.

Routing proposes only an edit plan or a fresh test form. It never approves a
mutation, dispatches a workflow, or reuses consent from the preceding task.
"""

from copy import deepcopy
from dataclasses import replace
from typing import TYPE_CHECKING

from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Action, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.state import PcState, is_terminal
from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.presentation import copy_text
from services.dify_builder.application.ports import ContinuationClassifyingAgent
from services.dify_builder.business_acceptance import clear_task_acceptance
from services.dify_builder.task_lifecycle import advance_task_identity

if TYPE_CHECKING:
    from services.dify_builder.application.runner import Env, StepResult


def active_entry_mode(session: Session, context: DifyBuilderContext) -> EntryMode:
    """The session's creation mode stays immutable; continuation mode is CAS state."""
    try:
        return EntryMode(context.active_entry_mode) if context.active_entry_mode else session.entry_mode
    except ValueError:
        return session.entry_mode


def _reset_for_new_task(session: Session, context: DifyBuilderContext, mode: EntryMode) -> None:
    """Shared pure reset; history, recorded requirements and prefill data survive."""
    context.task_control["generation"] = int(context.task_control.get("generation", 0)) + 1
    advance_task_identity(session, context, mode)
    context.paused = False
    context.recovery_class = ""
    context.attachment_material = []
    context.confirmed_requirement_keys = None
    context.retained_test_input_ref = context.test_input_ref or context.retained_test_input_ref
    context.confirmed_consent_id = ""
    context.confirmed_command_id = ""
    context.effect_confirmation = {}
    context.effect_confirmation_form = {}
    context.code_risk_assessments = {}
    clear_task_acceptance(context)
    context.staged_repair = []
    context.change_set = None
    context.repair_attempts = 0
    context.last_repair_error = ""
    context.last_repair_graph_revision = ""
    context.last_edit_rejection = ""
    context.unknown_outcome_count = 0
    context.verify_run_id = ""
    context.checkpoint_id = ""
    context.checkpoint_seq = context.next_seq
    context.failed_run_id = ""
    context.diagnosis = None
    context.risk = None
    context.source = ""
    context.checklist_errors = []
    if mode == EntryMode.EDIT:
        context.plan_items = []
        context.plan_title = ""
        context.plan_input_summary = ""
        context.plan_output_summary = ""
        context.plan_version_tag = ""
        context.resource_selection = {}
        context.edit_target_node_ids = []
        context.edit_rules = {}
        context.built_node_ids = []
        context.form_fields = []


def prepare_abandoned_continuation(
    session: Session, context: DifyBuilderContext, text: str, dsl: dict, revision: str
) -> tuple[PcState, DifyBuilderContext]:
    """Prepare a new goal before dispatch; the locked owner commits it atomically.

    Returns an independent context with no I/O. The caller owns actor/task/CAS
    and current-DSL binding checks, UserItem persistence and the once-only
    client-turn/enqueue receipt. An abandoned worker never receives an exception
    to the existing execution fence.
    """
    if (
        context.task_status != "abandoned"
        or context.task_control.get("conversation_clear")
        or context.task_control.get("settlement", "settled") != "settled"
        or context.task_control.get("receipt", {}).get("enqueue") in {"pending", "dispatching", "claimed", "unknown"}
    ):
        raise ConflictError("abandoned task is not safely settled")
    if not text.strip():
        raise ValueError("new goal is required")
    fresh = deepcopy(context)
    _reset_for_new_task(session, fresh, EntryMode.EDIT)
    fresh.goal_text = text
    fresh.test_input_ref = ""
    fresh.last_snapshot_hash = revision
    fresh.last_structure_fingerprint = ""
    fresh.task_control["dsl"] = deepcopy(dsl)
    fresh.task_control["dsl_revision"] = revision
    return PcState.EDIT_CAPABILITY_CHECK, fresh


def prepare_continuation(
    env: "Env",
    turn: Turn,
    session: Session,
    context: DifyBuilderContext,
    graph: dict,
    text: str,
    *,
    graph_revision: str,
) -> "StepResult | None":
    abandoned = context.task_status == "abandoned"
    if context.task_control.get("settlement") in {"pending", "unknown"} or (
        not abandoned
        and (
            not is_terminal(session.current_state)
            or session.current_state == PcState.FAILED
            or context.paused
            or context.recovery_class
        )
    ):
        return None
    if abandoned:
        intent = "edit"
    elif isinstance(env.agent, ContinuationClassifyingAgent):
        intent = env.agent.continuation_intent(context, graph, text)
    else:
        return None
    if intent not in {"edit", "test"}:
        return None

    from services.dify_builder.application.handlers_fix import (
        append_assistant,
        append_card,
        mint_checkpoint,
        saved_test_inputs,
        start_schema,
        testdata_form,
    )
    from services.dify_builder.application.runner import StepResult

    assert turn.action is not None
    turn_id = turn.action.payload["client_turn_id"]
    if context.verify_run_id and not abandoned:
        run = env.repo.get_run(context.verify_run_id)
        if (
            run.status not in {"succeeded", "failed"}
            or run.verification is None
            or run.verification.execution_evidence is None
            or not run.verification.execution_evidence.sealed
            or run.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
        ):
            # Keep its identity/evidence. A new prompt is not reconciliation.
            items = append_assistant(
                env,
                session,
                context,
                copy_text(BuilderCopyId.REPLIES_EXECUTION_OUTCOME_IS_UNKNOWN_RUN_AGAIN_BEFORE_PUBLISHING),
                turn_id=turn_id,
            )
            return StepResult(next=session.current_state, context=context, items=items)

    next_mode = active_entry_mode(session, context) if intent == "test" else EntryMode.EDIT
    _reset_for_new_task(session, context, next_mode)
    # The model request cannot inherit execution approval. Inputs remain data,
    # and the existing form owner re-reads the current schema and risk facts.
    if intent == "test":
        context.goal_text = text
        mode = active_entry_mode(session, context)
        next_state = {EntryMode.EDIT: PcState.EDIT_AWAIT_TESTDATA, EntryMode.BUILD: PcState.BUILD_AWAIT_TESTDATA}.get(
            mode, PcState.FIX_AWAIT_TESTDATA
        )
        # The existing durable checkpoint is also this task's undo/history
        # boundary. Never inherit the preceding task's restore point.
        context.checkpoint_seq = context.next_seq
        mint_checkpoint(env, session, context, graph, graph_revision, next_state)
        schema = start_schema(graph, env.dify.get_app_mode(session.app_id, turn.actor))
        values = saved_test_inputs(env, context)
        from services.dify_builder.test_input_continuity import reusable_values

        values = reusable_values(schema, values)
        card, reply = testdata_form(
            env,
            session,
            context,
            turn.actor,
            schema,
            values,
            copy_text(BuilderCopyId.REPLIES_PROVIDE_TEST_INPUTS_OR_USE_MOCK_DATA_TO_RUN_VALIDATION),
        )
        items = [
            *append_card(context, card),
            *append_assistant(env, session, context, reply, cards=["form"], turn_id=turn_id),
        ]
        return StepResult(next=next_state, context=context, items=items)

    from services.dify_builder.application.handlers_edit import handle_capability_check

    followup = replace(
        turn,
        action=Action(
            kind="send_edit_goal",
            payload={"text": text},
            base_version=session.version,
            command_id=turn.action.command_id,
        ),
    )
    edit_session = replace(session, current_state=PcState.EDIT_CAPABILITY_CHECK, entry_mode=EntryMode.EDIT)
    result = handle_capability_check(env, followup, edit_session, context)
    # A retry of the same message resolves to this durable response instead of
    # classifying and preparing the followup twice.
    for item in result.items:
        if item.kind == "assistant_turn":
            item.payload["turn_id"] = turn_id
            break
    return result
