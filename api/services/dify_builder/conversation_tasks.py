"""Continue a completed Builder task without replacing its owned transcript.

Routing proposes only an edit plan or a fresh test form. It never approves a
mutation, dispatches a workflow, or reuses consent from the preceding task.
"""

import json
from dataclasses import replace
from typing import TYPE_CHECKING

from core.dify_builder.models import Action, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.state import PcState, is_terminal
from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.presentation import copy_text
from services.dify_builder.application.ports import ContinuationClassifyingAgent

if TYPE_CHECKING:
    from services.dify_builder.application.runner import Env, StepResult


def active_entry_mode(session: Session, context: DifyBuilderContext) -> EntryMode:
    """The session's creation mode stays immutable; continuation mode is CAS state."""
    try:
        return EntryMode(context.active_entry_mode) if context.active_entry_mode else session.entry_mode
    except ValueError:
        return session.entry_mode


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
    if (
        not is_terminal(session.current_state)
        or session.current_state == PcState.FAILED
        or context.paused
        or context.recovery_class
    ):
        return None
    if not isinstance(env.agent, ContinuationClassifyingAgent):
        return None
    intent = env.agent.continuation_intent(context, graph, text)
    if intent not in {"edit", "test"}:
        return None

    from services.dify_builder.application.handlers_fix import (
        append_assistant,
        append_card,
        saved_test_inputs,
        start_schema,
        testdata_form,
    )
    from services.dify_builder.application.runner import StepResult

    assert turn.action is not None
    turn_id = turn.action.payload["client_turn_id"]
    if context.verify_run_id:
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

    context.retained_test_input_ref = context.test_input_ref or context.retained_test_input_ref
    context.confirmed_consent_id = ""
    context.confirmed_command_id = ""
    context.effect_confirmation = {}
    context.effect_confirmation_form = {}
    context.code_risk_assessments = {}
    context.staged_repair = []
    context.change_set = None
    context.repair_attempts = 0
    context.last_repair_error = ""
    context.last_edit_rejection = ""
    context.unknown_outcome_count = 0
    context.verify_run_id = ""
    # The model request cannot inherit execution approval. Inputs remain data,
    # and the existing form owner re-reads the current schema and risk facts.
    if intent == "test":
        context.last_snapshot_hash = graph_revision
        context.last_structure_fingerprint = env.dify.structural_fingerprint(graph)
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
        mode = active_entry_mode(session, context)
        next_state = {EntryMode.EDIT: PcState.EDIT_AWAIT_TESTDATA, EntryMode.BUILD: PcState.BUILD_AWAIT_TESTDATA}.get(
            mode, PcState.FIX_AWAIT_TESTDATA
        )
        return StepResult(next=next_state, context=context, items=items)

    from services.dify_builder.application.handlers_edit import handle_capability_check

    context.active_entry_mode = str(EntryMode.EDIT)
    context.plan_items = []
    context.resource_selection = {}
    context.edit_target_node_ids = []
    context.edit_rules = {}
    contextual_request = json.dumps(
        {"previous_goal": context.goal_text[:6000], "requirements": context.requirements, "latest_request": text},
        ensure_ascii=False,
    )
    followup = replace(
        turn,
        action=Action(
            kind="send_edit_goal",
            payload={"text": contextual_request},
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
