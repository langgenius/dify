"""Edit-flow handlers: pure ``(env, turn, session, fc) -> StepResult`` steps.

Mirrors ``handlers_build.py`` for the Edit entry mode (spec: docs/superpowers/
specs/2026-08-23-dify-builder-slice3-edit-design.md). Cards for a state are
emitted by the handler transitioning INTO it; ``edit.test_affected_paths`` and
``edit.publish`` are working states that auto-advance. Publishing is separated
from the review decision so its progress and side effect precede the terminal
``edit.complete`` transition. Keeping the draft reaches that terminal directly.
"""

import logging
import uuid
from dataclasses import replace

from core.dify_builder.contract import (
    DecisionItem,
    FormCard,
    TestResultCard,
)
from core.dify_builder.errors import DraftWouldNotStartError, HashMismatchError, ProposalWouldRunWrongError
from core.dify_builder.handlers_fix import (
    NO_OUTPUT_BODY,
    UNKNOWN_OUTCOME_STUCK_BODY,
    UNKNOWN_TEST_OUTCOME_REPLY,
    action_kind,
    action_string,
    append_assistant,
    append_card,
    build_change_set,
    build_form_fields,
    confirmed_tool_test,
    dead_end_branch_node_id,
    drop_unapplied_repair,
    emit_canvas,
    first_failed_node,
    input_gate_result,
    is_confirmed_tool_turn,
    is_input_failure,
    launch_error_text,
    merge_known_keys,
    mint_checkpoint,
    model_config_error_text,
    needs_effect_confirmation,
    note_repair_error,
    note_unknown_outcome,
    perform_revert,
    publication_denied,
    publication_for_context,
    record_effect_confirmation,
    repair_is_repeating,
    run_finished_without_output,
    saved_test_inputs,
    start_schema,
    test_failure_reason,
    testdata_form,
    without_endpoint_values,
)
from core.dify_builder.input_schema import schema_hash, validate_runtime_inputs
from core.dify_builder.models import (
    ChangeSet,
    Diagnosis,
    DifyBuilderContext,
    NodeEvent,
    Risk,
    Run,
    Session,
    TestInput,
    Turn,
)
from core.dify_builder.progress import ProgressReporter
from core.dify_builder.runner import Env, Handler, StepResult
from core.dify_builder.state import PcState
from core.dify_builder.testdata import stamp_testdata_http_fixtures
from core.dify_builder.verification import SUCCESS_REPLY, has_output_blocker, is_execution_policy_blocker, result_card
from services.dify_builder.copy_ids import BuilderCopyId
from services.dify_builder.plan import make_plan_card, store_plan
from services.dify_builder.plan_failure import edit_planning_failed
from services.dify_builder.presentation import BuilderText, copy_text, text_parts

logger = logging.getLogger(__name__)

__all__ = [
    "edit_registry",
    "handle_apply_changes",
    "handle_await_repair",
    "handle_await_testdata",
    "handle_capability_check",
    "handle_impact_analysis",
    "handle_plan_approval",
    "handle_publish",
    "handle_reverted",
    "handle_review",
    "handle_test_affected_paths",
]


def handle_capability_check(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Entry state. On ``send_edit_goal`` read the existing graph,
    emit a read-only context summary, analyze impact into edit_rules + target
    nodes (highlighting them), and transition to edit.impact_analysis emitting
    its form plus a streamed impact summary. The canvas is read only here after
    the goal is sent (mock 02-edit.txt:3,9)."""
    kind = action_kind(turn)
    if kind != "send_edit_goal":
        return StepResult(next=PcState.EDIT_CAPABILITY_CHECK, context=fc)

    text, ok = action_string(turn, "text")
    if ok and text:
        fc.goal_text = text
    # A new goal is a new repair loop: the breaker's counter must not carry
    # over from whatever the previous edit was stuck on, and neither may the
    # engine's refusal of a change this goal has nothing to do with.
    fc.repair_attempts = 0
    fc.last_repair_error = ""
    fc.last_edit_rejection = ""

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("edit-inspect-workflow", copy_text(BuilderCopyId.PROGRESS_INSPECT_THE_CURRENT_WORKFLOW)),
            ("edit-analyze-impact", copy_text(BuilderCopyId.PROGRESS_ANALYZE_THE_REQUESTED_CHANGE)),
            ("edit-prepare-impact", copy_text(BuilderCopyId.PROGRESS_PREPARE_THE_IMPACT_SUMMARY)),
        ],
    )
    progress.activate("edit-inspect-workflow")
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    fc.last_snapshot_hash = graph_hash
    fc.last_structure_fingerprint = env.dify.structural_fingerprint(graph)
    node_count = len(graph.get("nodes", []))
    edge_count = len(graph.get("edges", []))

    progress.activate("edit-analyze-impact")
    impact = env.agent.analyze_impact(fc.goal_text, graph)
    fc.form_fields = list(impact.get("fields") or [])
    fc.edit_rules = dict(impact.get("values") or {})
    fc.edit_target_node_ids = list(impact.get("target_node_ids") or [])

    for node_id in fc.edit_target_node_ids:
        emit_canvas(env, "highlight_edit_target", node_id=node_id)

    progress.activate("edit-prepare-impact")
    form_items = append_card(
        fc,
        FormCard(
            variant="edit_rules",
            title=copy_text(BuilderCopyId.FORMS_EDIT_RULES_TITLE),
            description=copy_text(BuilderCopyId.FORMS_EDIT_RULES_DESCRIPTION),
            fields=build_form_fields(fc.form_fields),
            values=dict(fc.edit_rules),
            frozen=False,
        ),
    )
    execution = progress.finish()
    target_text = ", ".join(fc.edit_target_node_ids)
    turn_items = append_assistant(
        env,
        s,
        fc,
        copy_text(BuilderCopyId.EDIT_INSPECTED, nodes=node_count, connections=edge_count, targets=target_text)
        if target_text
        else copy_text(BuilderCopyId.EDIT_INSPECTED_WITHOUT_TARGETS, nodes=node_count, connections=edge_count),
        execution=execution,
        cards=["form"],
        turn_id=progress.operation_id,
    )
    return StepResult(
        next=PcState.EDIT_IMPACT_ANALYSIS,
        context=fc,
        items=[*form_items, *turn_items],
    )


def handle_impact_analysis(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) On ``submit_edit_rules`` merge the form payload, propose the
    change plan, self-mint the backend pre-edit checkpoint, and transition to
    edit.plan_approval. A stored engine refusal is cleared when the submitted
    rules change, because it no longer describes the next proposed edit.
    Failed planning keeps this gate, its submitted rules, and the prior plan."""
    kind = action_kind(turn)
    if kind != "submit_edit_rules":
        return StepResult(next=PcState.EDIT_IMPACT_ANALYSIS, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("edit-review-rules", copy_text(BuilderCopyId.PROGRESS_REVIEW_CONFIRMED_EDIT_RULES)),
            ("edit-draft-plan", copy_text(BuilderCopyId.PROGRESS_DRAFT_THE_CHANGE_PLAN)),
            ("edit-create-checkpoint", copy_text(BuilderCopyId.PROGRESS_CREATE_A_PRE_EDIT_CHECKPOINT)),
        ],
    )
    progress.activate("edit-review-rules")

    if turn.action is not None and isinstance(turn.action.payload, dict):
        keys = [f["key"] for f in fc.form_fields if isinstance(f, dict) and f.get("key")]
        previous_rules = fc.edit_rules
        fc.edit_rules = merge_known_keys(fc.edit_rules, turn.action.payload, keys)
        if fc.edit_rules != previous_rules:
            # ``last_edit_rejection`` describes the batch the engine refused,
            # and that batch is a function of the rules and the graph. Here --
            # and, besides a brand-new goal in handle_capability_check, ONLY
            # here -- the rules stop being the ones it refused, so its
            # complaint stops describing what the next approval will try.
            #
            # Deliberately NOT cleared by the actions that merely route the
            # user here (plan_approval/review's continue_adjusting) nor by
            # edit.reverted's Retry: those leave the rules untouched, so a
            # refusal earned by them is still exactly what the next attempt
            # needs to hear. A gate revert in particular writes nothing, so
            # the restored draft IS the refused draft and Retry would otherwise
            # re-propose the identical plan blind.
            fc.last_edit_rejection = ""

    progress.activate("edit-draft-plan")
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    plan = env.agent.propose_edit_plan(dict(fc.edit_rules), graph)
    if plan is None:
        return edit_planning_failed(env, s, fc, progress, "edit-draft-plan")
    store_plan(fc, plan)

    progress.activate("edit-create-checkpoint")
    fc.checkpoint_seq = fc.next_seq
    mint_checkpoint(env, s, fc, graph, graph_hash, PcState.EDIT_PLAN_APPROVAL)

    decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_SUBMITTED_EDIT_RULES)))
    plan_items = append_card(fc, make_plan_card(fc))
    execution = progress.finish()
    turn_items = append_assistant(
        env,
        s,
        fc,
        copy_text(BuilderCopyId.EDIT_PLAN_READY),
        execution=execution,
        cards=["plan"],
        turn_id=progress.operation_id,
    )
    return StepResult(
        next=PcState.EDIT_PLAN_APPROVAL,
        context=fc,
        items=[*decision_items, *plan_items, *turn_items],
    )


_EDIT_EXECUTION_STEPS = [
    ("edit-prepare", copy_text(BuilderCopyId.PROGRESS_PREPARE_CANVAS_CHANGES)),
    ("edit-highlight", copy_text(BuilderCopyId.PROGRESS_HIGHLIGHT_EDIT_TARGETS)),
    ("edit-apply", copy_text(BuilderCopyId.PROGRESS_APPLY_THE_CHANGE_PLAN)),
]

# A pydantic message quotes a truncated repr of the input it refused, so one
# node's refusal is normally a few hundred characters -- but a batch refusal
# concatenates one per node, and this text is persisted in the session's
# context blob AND prepended to the next prompt. Capped with a visible marker
# for the same reason the terminal-output preview is
# (handlers_build._MAX_TERMINAL_OUTPUT_CHARS).
_MAX_REJECTION_CHARS = 2000
_REJECTION_TRUNCATED_MARKER = "\n… (truncated)"


def _rejection_text(exc: Exception) -> str:
    """The engine's OWN words for why it refused the write, capped.

    ``str(exc)`` and nothing else: the ``PreflightError`` the Dify port raises
    is built from ``preflight.new_preflight_problems``, whose every message is
    produced by re-validating a ``credentials.redact_node_config`` copy of the
    node, and the ``ValueError`` alternative comes from ``graph_ops``, whose
    messages carry only paths, node ids, indexes and type names. So it is
    engine-sourced: no model prose is ever mixed in, and nothing branches on
    this string.

    Credentials are withheld to REDACTION'S DECLARED SCOPE and no further --
    an http-request node's ``authorization`` block and its ``headers`` /
    ``params`` lines. A secret typed into a request ``body`` value is NOT
    covered and reaches this string, and therefore the session's context blob
    and the next prompt, verbatim. See ``services.dify_builder.credentials``
    for why that is deliberate and what closing it would take.
    """
    text = str(exc)
    if len(text) > _MAX_REJECTION_CHARS:
        return text[:_MAX_REJECTION_CHARS] + _REJECTION_TRUNCATED_MARKER
    return text


def _change_not_applied(
    env: Env,
    s: Session,
    fc: DifyBuilderContext,
    progress: ProgressReporter,
    *,
    title: BuilderText,
    body: BuilderText,
    reply_text: BuilderText,
    rejection: str,
    failed_step: str = "edit-apply",
) -> StepResult:
    """apply_repair refused the edit and wrote nothing: say why and keep the
    change plan at its gate. (Edit applies with on_canvas=None, so no canvas
    marker streamed and there is nothing to revert on the client.)

    ``rejection`` is remembered so the NEXT approval is not blind: the gate
    offers re-approval, the draft is unchanged, and without this the agent is
    re-prompted with byte-identical inputs and hands back the same refused
    batch (triage edit-branch-failure-2026-09-22). Stored unconditionally, so a
    second refusal at the same error location with a different bad value
    replaces the first rather than being folded into it.

    Re-approval is one of three exits the gate now offers (see
    ``handle_plan_approval``), and none of the three clears this store on its
    own: only ``handle_impact_analysis`` does, and only when the rules it was
    submitted differ from the ones this refusal was earned on. Continue-adjusting
    routes THROUGH there, so it clears only if the user actually changed
    something; a gate revert writes nothing at all, so the restored draft IS the
    refused draft and its Retry needs this text more than anything else does.
    ``test_a_gate_revert_keeps_the_refusal_its_retry_still_needs`` and
    ``test_routing_back_to_the_form_does_not_forget_the_refusal`` pin both.

    ``failed_step`` is the activity that gets the failure, and it defaults to
    the write because that is where the usual refusal happens. A caller that
    gives up EARLIER must say so: marking a step that was never revealed leaves
    the ones between it and the failure streaming as pending underneath it, so
    the timeline shows work still to come below work that already failed."""
    fc.staged_repair = []
    fc.last_edit_rejection = rejection
    progress.fail_step(failed_step)
    execution = progress.finish(status="error")
    turn_items = append_assistant(
        env, s, fc, text_parts(title, ": ", body, "\n", reply_text), execution=execution, turn_id=progress.operation_id
    )
    return StepResult(next=PcState.EDIT_PLAN_APPROVAL, context=fc, items=turn_items)


def _resume_adjusting(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """Leave an Edit gate for edit.impact_analysis with the edit-rules form
    repopulated and unfrozen, so the user changes the RULES instead of
    re-submitting the same ones.

    Shared by "Continue adjusting" at edit.review and edit.plan_approval.

    Routing the user to the form is not the same as changing the rules -- they
    may edit nothing and resubmit -- so ``last_edit_rejection`` is left alone
    here and cleared by handle_impact_analysis if and when the submitted
    payload actually changes ``fc.edit_rules``."""
    for node_id in fc.edit_target_node_ids:
        emit_canvas(env, "highlight_edit_target", node_id=node_id)
    fc.test_input_ref = ""
    fc.verify_run_id = ""
    fc.repair_attempts = 0
    fc.last_repair_error = ""
    fc.unknown_outcome_count = 0
    decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.ACTIONS_CONTINUE_ADJUSTING)))
    form_items = append_card(
        fc,
        FormCard(
            variant="edit_rules", fields=build_form_fields(fc.form_fields), values=dict(fc.edit_rules), frozen=False
        ),
    )
    target_text = ", ".join(fc.edit_target_node_ids)
    turn_items = append_assistant(
        env,
        s,
        fc,
        copy_text(BuilderCopyId.EDIT_ADJUST, targets=target_text)
        if target_text
        else copy_text(BuilderCopyId.EDIT_ADJUST_WITHOUT_TARGETS),
        cards=["form"],
    )
    return StepResult(
        next=PcState.EDIT_IMPACT_ANALYSIS,
        context=fc,
        items=[*decision_items, *form_items, *turn_items],
    )


def handle_plan_approval(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) THE EDIT. ``approve_repair`` (resolved from approve_plan)
    applies: read the current graph, get the canned set_node_config intents,
    highlight the targets, apply once (on_canvas=None -- Edit narrates its own
    coarse apply_edit_plan rather than the Fix-flavored per-intent apply_error_
    fix), summarize the applied changes in assistant text, and transition to
    edit.apply_changes. The checkpoint stays backend-only.

    An empty proposal stays at the approval gate without attempting a write.
    A nonempty proposal with the same nonempty execution revision is a no-op:
    it rests at edit.apply_changes without claiming an applied change, even
    when the adapter reports touched node IDs.

    Approval is not the only exit. ``re_fix`` (continue_adjusting) goes back to
    edit.impact_analysis with the rules editable, and ``undo`` (revert) restores
    the pre-edit draft from the checkpoint handle_impact_analysis minted and
    lands on edit.reverted. Without those two, an approval the engine refuses
    parks the user at this gate with nothing to press but the same button
    (triage edit-branch-failure-2026-09-22, "Hard dead end")."""
    kind = action_kind(turn)
    if kind == "re_fix":  # continue_adjusting -> re-open the edit rules
        return _resume_adjusting(env, turn, s, fc)
    if kind == "undo":  # revert -> abandon the change plan at its gate
        perform_revert(env, turn, s, fc)
        fc.staged_repair = []
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_REQUESTED_A_REVERT)))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    if kind != "approve_repair":
        return StepResult(next=PcState.EDIT_PLAN_APPROVAL, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=_EDIT_EXECUTION_STEPS,
    )
    progress.activate("edit-prepare")
    graph, read_revision = env.dify.read_graph(s.app_id, turn.actor)
    try:
        intents = env.agent.build_edit_intents(
            dict(fc.edit_rules),
            graph,
            edit_target_node_ids=list(fc.edit_target_node_ids),
            # What the engine said last time it refused this write, if anything.
            # The graph and the rules are byte-identical across re-approvals, so
            # this is the only input that changes -- and the only reason a second
            # approval can produce a different batch.
            last_edit_rejection=fc.last_edit_rejection or None,
        )
    except ProposalWouldRunWrongError as exc:
        # The agent judged its own final proposal wrong and refused to hand it
        # on. Nothing was written and nothing was even attempted -- this is the
        # one refusal with no engine error behind it, because the defect is one
        # the engine ACCEPTS: a draft that would start, run green and produce
        # nothing. Same recovery as a refused write: the plan stays at its gate
        # with the reason on a card, and the reason goes into the next attempt.
        logger.warning("Dify Builder: edit proposal judged wrong before write for app %s: %s", s.app_id, exc)
        return _change_not_applied(
            env,
            s,
            fc,
            progress,
            title=copy_text(BuilderCopyId.LABELS_THE_CHANGE_WOULDN_T_DO_WHAT_YOU_ASKED),
            body=copy_text(BuilderCopyId.EDIT_INEFFECTIVE_PROPOSAL, value=str(exc)),
            reply_text=(copy_text(BuilderCopyId.REPLIES_I_DIDN_T_APPLY_THE_CHANGE)),
            rejection=_rejection_text(exc),
            # Given up during "prepare": nothing was highlighted and nothing was
            # applied, so the failure belongs to the step that was actually
            # running. Failing the write instead would leave edit-highlight
            # pending BELOW a failed edit-apply.
            failed_step="edit-prepare",
        )
    if not intents:
        return _change_not_applied(
            env,
            s,
            fc,
            progress,
            title=copy_text(BuilderCopyId.LABELS_NO_CHANGES_WERE_PROPOSED),
            body=copy_text(BuilderCopyId.LABELS_NOTHING_WAS_APPLIED),
            reply_text=copy_text(BuilderCopyId.REPLIES_REVIEW_THE_RULES_CONTINUE_ADJUSTING_APPROVE),
            rejection="The previous proposal contained no applicable intentions.",
            failed_step="edit-prepare",
        )
    fc.staged_repair = list(intents)

    progress.activate("edit-highlight")
    for node_id in fc.edit_target_node_ids:
        emit_canvas(env, "highlight_edit_target", node_id=node_id)

    progress.activate("edit-apply")
    try:
        result = env.dify.apply_repair(
            s.app_id, turn.actor, intents, on_canvas=None, expected_revision=fc.last_snapshot_hash
        )
    except DraftWouldNotStartError as exc:
        # apply_repair's preflight: the edited draft would fail at Graph.init.
        # Nothing was written; keep the change plan at its gate as a card.
        logger.warning("Dify Builder: edit rejected before write for app %s: %s", s.app_id, exc)
        return _change_not_applied(
            env,
            s,
            fc,
            progress,
            title=copy_text(BuilderCopyId.LABELS_THE_WORKFLOW_CAN_T_START),
            body=copy_text(BuilderCopyId.BUILD_INVALID_GRAPH, value=str(exc)),
            reply_text=(copy_text(BuilderCopyId.REPLIES_I_DIDN_T_APPLY_THE_CHANGE2)),
            rejection=_rejection_text(exc),
        )
    except ValueError as exc:
        # graph_ops refused an intent (e.g. "node not found") before the
        # startability check ever ran. Nothing was written either -- same
        # recovery, but not "can't start".
        logger.warning("Dify Builder: edit could not be applied for app %s: %s", s.app_id, exc)
        return _change_not_applied(
            env,
            s,
            fc,
            progress,
            title=copy_text(BuilderCopyId.LABELS_COULDN_T_APPLY_THE_WORKFLOW),
            body=copy_text(BuilderCopyId.BUILD_APPLY_FAILED, value=str(exc)),
            reply_text=(copy_text(BuilderCopyId.REPLIES_I_COULDN_T_APPLY_THE_CHANGE)),
            rejection=_rejection_text(exc),
        )
    fc.last_snapshot_hash = result.new_hash
    fc.last_structure_fingerprint = result.structure_fingerprint
    # The write went through: whatever the engine refused before is answered,
    # and must not be quoted at the next edit.
    fc.last_edit_rejection = ""
    # Touched IDs and summary counts do not prove an effective edit. The port
    # returns the same opaque execution revision for an idempotent batch.
    if read_revision and result.new_hash == read_revision:
        fc.change_set = ChangeSet()
        decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_APPROVED_THE_CHANGE_PLAN)))
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            copy_text(BuilderCopyId.REPLIES_NO_EFFECTIVE_CHANGES_WERE_NEEDED_THE),
            execution=execution,
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.EDIT_APPLY_CHANGES,
            context=fc,
            items=[*decision_items, *turn_items],
        )
    emit_canvas(env, "apply_edit_plan")

    changes, scope, fc.change_set = build_change_set(result, default_scope="configuration", fallback_diff="no changes")

    decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_APPROVED_THE_CHANGE_PLAN)))
    execution = progress.finish()
    change_lines = "\n".join(f"- {change}" for change in changes) or text_parts(
        "- ", copy_text(BuilderCopyId.EDIT_NO_EFFECTIVE_CHANGES)
    )
    turn_items = append_assistant(
        env,
        s,
        fc,
        text_parts(copy_text(BuilderCopyId.EDIT_APPLIED, count=len(changes), scope=scope), "\n", change_lines),
        execution=execution,
        turn_id=progress.operation_id,
    )
    return StepResult(
        next=PcState.EDIT_APPLY_CHANGES,
        context=fc,
        items=[*decision_items, *turn_items],
    )


def handle_apply_changes(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) At rest after the edit. ``run_affected_tests`` -> edit.await_
    testdata when no test input is prepared yet (gate), else straight to edit.
    test_affected_paths; ``revert`` (resolved to ``undo``) -> edit.reverted:
    restores the pre-edit draft from the checkpoint and invalidates the
    approvals made since it (via perform_revert)."""
    kind = action_kind(turn)
    if kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_REQUESTED_A_REVERT)))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    if kind == "run_affected_tests":
        fc.verify_run_id = ""
        fc.effect_confirmation = {}
        fc.effect_confirmation_form = {}
        fc.code_risk_assessments = {}
        if fc.test_input_ref == "" or needs_effect_confirmation(env, s, fc, turn.actor):
            graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
            card, reply = testdata_form(
                env,
                s,
                fc,
                turn.actor,
                start_schema(graph, env.dify.get_app_mode(s.app_id, turn.actor)),
                saved_test_inputs(env, fc),
                copy_text(BuilderCopyId.REPLIES_PROVIDE_TEST_INPUTS_OR_USE_MOCK_DATA_TO_RUN_THE_AFFECTED_PATH_TEST),
            )
            form_items = append_card(fc, card)
            turn_items = append_assistant(env, s, fc, reply, cards=["form"])
            return StepResult(next=PcState.EDIT_AWAIT_TESTDATA, context=fc, items=[*form_items, *turn_items])
        ti = replace(env.repo.get_test_input(fc.test_input_ref), id="")
        env.repo.save_test_input(ti)
        fc.test_input_ref = ti.id
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.ACTIONS_RUN_AFFECTED_PATH_TESTS)))
        return StepResult(next=PcState.EDIT_TEST_AFFECTED_PATHS, context=fc, items=items)
    return StepResult(next=PcState.EDIT_APPLY_CHANGES, context=fc)


def handle_await_testdata(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Prepare inputs for the affected-path test. mock -> schema-shaped
    generate_mock_inputs; provide/upload -> the payload's inputs dict (may carry
    file refs). Persists a TestInput and advances to edit.test_affected_paths."""
    http_fixtures = stamp_testdata_http_fixtures(env.dify, app_id=s.app_id, turn=turn)
    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
    schema = start_schema(graph, env.dify.get_app_mode(s.app_id, turn.actor))
    mode, _ = action_string(turn, "mode")
    if mode == "mock":
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            reply_language=fc.reply_language,
            stage_id=str(s.current_state),
            steps=[("edit-generate-test-inputs", copy_text(BuilderCopyId.PROGRESS_GENERATE_AFFECTED_PATH_TEST_INPUTS))],
        )
        progress.activate("edit-generate-test-inputs")
        # An endpoint is left out, never mocked: its missing required key fails
        # the launch as an input, which routes back to this gate.
        inputs = without_endpoint_values(graph, env.agent.generate_mock_inputs(schema, {}))
        progress.finish()
    else:
        inputs = {}
        if turn.action is not None and isinstance(turn.action.payload.get("inputs"), dict):
            inputs = turn.action.payload["inputs"]
    inputs, stale_effects = record_effect_confirmation(env, s, fc, turn.actor, inputs)
    if stale_effects:
        return input_gate_result(
            env,
            s,
            fc,
            schema,
            inputs,
            PcState.EDIT_AWAIT_TESTDATA,
            "The test targets or accounts changed. Review the updated confirmation before running.",
            actor=turn.actor,
        )
    try:
        validate_runtime_inputs(schema, inputs)
    except ValueError as exc:
        return input_gate_result(env, s, fc, schema, inputs, PcState.EDIT_AWAIT_TESTDATA, str(exc), actor=turn.actor)
    ti = TestInput(
        session_id=s.id,
        source=mode or "upload",
        inputs=inputs,
        start_schema_hash=schema_hash(schema),
        http_fixtures=http_fixtures,
    )
    env.repo.save_test_input(ti)
    fc.test_input_ref = ti.id
    return StepResult(next=PcState.EDIT_TEST_AFFECTED_PATHS, context=fc)


def handle_test_affected_paths(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Live affected-path test via run_draft. Success ->
    edit.review; failure -> real diagnose + propose_repair, staged for the
    edit.await_repair approval gate. No auto-apply (human-gated)."""
    if is_confirmed_tool_turn(turn, fc):
        return confirmed_tool_test(env, turn, s, fc, review_state=PcState.EDIT_REVIEW, step_prefix="edit")
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("edit-prepare-test", copy_text(BuilderCopyId.PROGRESS_PREPARE_AFFECTED_PATH_TESTS)),
            ("edit-run-test", copy_text(BuilderCopyId.PROGRESS_RUN_AFFECTED_WORKFLOW_PATHS)),
            ("edit-evaluate-test", copy_text(BuilderCopyId.PROGRESS_EVALUATE_THE_TEST_RESULT)),
        ],
    )
    progress.activate("edit-prepare-test")
    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
    schema = start_schema(graph, env.dify.get_app_mode(s.app_id, turn.actor))
    if fc.test_input_ref:
        ti = env.repo.get_test_input(fc.test_input_ref)
        inputs = ti.inputs
    else:  # defensive: the gate normally prepares inputs first
        inputs = without_endpoint_values(graph, env.agent.generate_mock_inputs(schema, {}))
        ti = TestInput(session_id=s.id, source="mock", inputs=inputs, start_schema_hash=schema_hash(schema))
        env.repo.save_test_input(ti)
        fc.test_input_ref = ti.id

    progress.activate("edit-run-test")

    def emit(event: NodeEvent) -> None:
        progress.observe_node("edit-run-test", event)

    raw = None
    try:
        validate_runtime_inputs(schema, inputs, ti)
        confirmation = fc.effect_confirmation
        fc.effect_confirmation = {}
        raw = env.dify.run_draft(
            s.app_id,
            turn.actor,
            inputs,
            emit,
            session_id=s.id,
            test_input_id=fc.test_input_ref,
            on_workflow_event=env.emit_workflow,
            effect_confirmation=confirmation,
        )
        status, per_node, dify_run_id, run_error = raw.status, raw.per_node, raw.dify_run_id, raw.error
    except Exception as exc:
        # Never crash the advance; capture the launch error (log + store) instead
        # of swallowing it, so diagnose/routing have something to act on.
        logger.exception("dify_builder verify run failed to launch (session=%s, app=%s)", s.id, s.app_id)
        status, per_node, dify_run_id, run_error = "failed", [], "", launch_error_text(exc)

    if (
        raw is not None
        and raw.execution_refusal is not None
        and raw.execution_refusal.reason_code == "code_risk_assessment_stale"
    ):
        return input_gate_result(
            env,
            s,
            fc,
            schema,
            dict(inputs),
            PcState.EDIT_AWAIT_TESTDATA,
            copy_text(BuilderCopyId.TEST_POLICY_REVIEW),
            actor=turn.actor,
        )

    if status == "succeeded":
        progress.complete("edit-run-test")
    else:
        progress.fail_step("edit-run-test")
    progress.activate("edit-evaluate-test")

    run = Run(
        execution_refusal=raw.execution_refusal if raw else None,
        id=str(uuid.uuid4()),
        session_id=s.id,
        verification=raw.verification if raw else None,
        kind="verify",
        dify_run_id=dify_run_id,
        status=status,
        per_node=per_node,
        error=run_error,
        inputs_ref=fc.test_input_ref,
        immutable=True,
    )

    fc.verify_run_id = run.id

    if is_execution_policy_blocker(run):
        fc.diagnosis = None
        fc.staged_repair = []
        card = result_card(run)
        items = append_card(fc, card)
        execution = progress.finish()
        items += append_assistant(
            env,
            s,
            fc,
            card.failure_reason or copy_text(BuilderCopyId.TEST_POLICY_REVIEW),
            execution=execution,
            cards=["test_result"],
            turn_id=progress.operation_id,
        )
        return StepResult(next=PcState.EDIT_AWAIT_REPAIR, context=fc, items=items, run=run, run_id_sink=[run.id])

    if status != "running":
        fc.unknown_outcome_count = 0

    if status == "succeeded" and (
        has_output_blocker(run) or (run.verification is None and run_finished_without_output(graph, per_node))
    ):
        # Same as Build's: a branch node ran and every one of its arms was
        # skipped, and no End node ran either. Not green, not an engine error
        # to diagnose; wait at the gate with no staged repair.
        fc.verify_run_id = run.id
        fc.diagnosis = None
        fc.staged_repair = []
        run.culprit_node_id = dead_end_branch_node_id(graph, per_node)
        test_items = append_card(
            fc,
            result_card(run)
            if run.verification
            else TestResultCard(status="failed", failure_reason=NO_OUTPUT_BODY, dify_run_id=run.dify_run_id),
        )
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            (result_card(run).failure_reason or NO_OUTPUT_BODY),
            execution=execution,
            cards=["test_result"],
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.EDIT_AWAIT_REPAIR,
            context=fc,
            items=[*test_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    if status == "succeeded":
        test_items = append_card(
            fc,
            result_card(run),
        )
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            text_parts(SUCCESS_REPLY, " ", result_card(run).review_note or ""),
            execution=execution,
            cards=["test_result"],
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.EDIT_REVIEW,
            context=fc,
            items=[*test_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    if status == "running":
        # A truncated stream cannot establish failure or justify another repair.
        # The second consecutive unknown outcome stops the re-run loop at the
        # gate (no staged repair) instead of bouncing to edit.apply_changes again.
        if note_unknown_outcome(fc):
            fc.verify_run_id = run.id
            fc.diagnosis = None
            fc.staged_repair = []
            execution = progress.finish()
            stuck_items = append_assistant(
                env, s, fc, UNKNOWN_OUTCOME_STUCK_BODY, execution=execution, turn_id=progress.operation_id
            )
            return StepResult(
                next=PcState.EDIT_AWAIT_REPAIR,
                context=fc,
                items=stuck_items,
                run=run,
                run_id_sink=[run.id],
            )
        execution = progress.finish()
        turn_items = append_assistant(
            env, s, fc, UNKNOWN_TEST_OUTCOME_REPLY, execution=execution, turn_id=progress.operation_id
        )
        return StepResult(
            next=PcState.EDIT_APPLY_CHANGES,
            context=fc,
            items=turn_items,
            run=run,
            run_id_sink=[run.id],
        )

    # failure: real diagnosis + proposed repair, staged for the approval gate
    run.culprit_node_id = first_failed_node(per_node)
    fc.verify_run_id = run.id

    if is_input_failure(run):
        # The attempted run failed on its inputs. Keep it as the latest
        # verification evidence while clearing stale inputs for correction.
        fc.test_input_ref = ""
        test_items = append_card(
            fc,
            replace(result_card(run), failure_reason=test_failure_reason(run)),
        )
        card, reply = testdata_form(
            env,
            s,
            fc,
            turn.actor,
            schema,
            inputs,
            copy_text(BuilderCopyId.REPLIES_THE_RUN_FAILED_ON_ITS_INPUTS_PROVIDE_TEST_DATA_AND_RETRY),
        )
        form_items = append_card(fc, card)
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            reply,
            execution=execution,
            cards=["test_result", "form"],
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.EDIT_AWAIT_TESTDATA,
            context=fc,
            items=[*test_items, *form_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    model_error = model_config_error_text(run)
    if model_error is not None:
        # Model-config failure: the run references a model that isn't
        # configured/available -- not a workflow-logic bug. Surface it with a clear
        # diagnosis and NO staged repair (diagnosing/repairing the graph thrashes);
        # the user configures the model (update_model) and re-runs.
        root_cause = (
            "The workflow uses a model that isn't configured or available for this workspace, so it can't run. "
            "This is a model-configuration issue, not a workflow-logic problem -- configure the model "
            "(or choose a different one) and re-run the test. "
            f"Details: {model_error}"
        )
        fc.diagnosis = Diagnosis(culprit_node_id=first_failed_node(per_node), root_cause=root_cause, severity="high")
        fc.staged_repair = []
        fc.risk = Risk(level="high", reason="model not configured", has_external_side_effect=False)
        test_items = append_card(
            fc,
            replace(result_card(run), failure_reason=model_error),
        )
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            copy_text(BuilderCopyId.MODEL_CONFIGURATION_UNAVAILABLE, error=model_error),
            execution=execution,
            cards=["test_result"],
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.EDIT_AWAIT_REPAIR,
            context=fc,
            items=[*test_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    # config failure: existing diagnose + propose_repair -> EDIT_AWAIT_REPAIR
    progress.add_steps(
        [
            ("edit-diagnose-failure", copy_text(BuilderCopyId.PROGRESS_DIAGNOSE_THE_FAILED_PATH)),
            ("edit-prepare-repair", copy_text(BuilderCopyId.PROGRESS_PREPARE_A_SAFE_REPAIR)),
        ]
    )
    progress.activate("edit-diagnose-failure")
    from services.dify_builder.condition_evidence import diagnose_failure, propose_failure

    diagnosis = diagnose_failure(env, s.app_id, turn.actor, run, graph)
    note_repair_error(fc, run)
    if repair_is_repeating(fc):
        # Same breaker as Build's: the identical engine failure has survived
        # MAX_REPEATED_REPAIRS repairs, so another round would aim at the same
        # wrong thing. Stop and hand the decision back (no staged repair).
        fc.diagnosis = diagnosis
        fc.staged_repair = []
        test_items = append_card(fc, replace(result_card(run), failure_reason=test_failure_reason(run)))
        execution = progress.finish()
        stuck_items = append_assistant(
            env,
            s,
            fc,
            f"{diagnosis.root_cause or copy_text(BuilderCopyId.TEST_FAILED_FALLBACK)}\n\n"
            "The same error survived the last repairs, so I've stopped retrying. "
            "Edit the node directly and test again, or revert.",
            execution=execution,
            cards=["test_result"],
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.EDIT_AWAIT_REPAIR,
            context=fc,
            items=[*test_items, *stuck_items],
            run=run,
            run_id_sink=[run.id],
        )
    progress.activate("edit-prepare-repair")
    intents, risk = propose_failure(env, s.app_id, turn.actor, run, diagnosis, graph)
    fc.diagnosis = diagnosis
    fc.staged_repair = list(intents)
    fc.risk = risk
    test_items = append_card(
        fc,
        replace(result_card(run), failure_reason=test_failure_reason(run)),
    )
    proposed = [f"{i.op} {i.args.get('node_id', '')}".strip() for i in intents]
    execution = progress.finish()
    proposal_text = "\n".join(f"- {change}" for change in proposed)
    reply_text = diagnosis.root_cause or copy_text(BuilderCopyId.TEST_FAILED_FALLBACK)
    reply_text = text_parts(
        reply_text,
        (
            text_parts("\n\n", copy_text(BuilderCopyId.REPAIR_PROPOSED_FIX), "\n", proposal_text)
            if intents
            else text_parts("\n\n", copy_text(BuilderCopyId.REPAIR_NO_SAFE_FOUND))
        ),
    )
    turn_items = append_assistant(
        env,
        s,
        fc,
        reply_text,
        execution=execution,
        cards=["test_result"],
        turn_id=progress.operation_id,
    )
    return StepResult(
        next=PcState.EDIT_AWAIT_REPAIR,
        context=fc,
        items=[*test_items, *turn_items],
        run=run,
        run_id_sink=[run.id],
    )


def handle_await_repair(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Post-failure gate for Edit, mirroring Build's await_repair.
    approve_repair applies the staged repair and waits at edit.apply_changes
    for the client's canvas refresh before testing; keep_draft -> edit.review; undo ->
    edit.reverted. apply_repair runs ONLY here, only on approve."""
    kind = action_kind(turn)
    if kind == "approve_repair":
        if not fc.staged_repair:
            # Nothing staged: applying would change nothing and the retest
            # would fail identically. Don't spend a run on it (ESQ1-291).
            # Reachable on the most common Edit failure there is -- the
            # model-config branch above stages NO repair and still routes
            # here.
            items = append_assistant(
                env,
                s,
                fc,
                copy_text(BuilderCopyId.REPLIES_NO_FIX_IS_STAGED_FOR_THIS_FAILURE_KEEP_THE_DRAFT_OR_REVERT),
            )
            return StepResult(next=PcState.EDIT_AWAIT_REPAIR, context=fc, items=items)
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            reply_language=fc.reply_language,
            stage_id=str(s.current_state),
            steps=[
                ("edit-apply-repair", copy_text(BuilderCopyId.PROGRESS_APPLY_THE_APPROVED_REPAIR)),
                ("edit-prepare-retest", copy_text(BuilderCopyId.PROGRESS_PREPARE_TO_RETEST_AFFECTED_PATHS)),
            ],
        )
        progress.activate("edit-apply-repair")
        try:
            result = env.dify.apply_repair(
                s.app_id,
                turn.actor,
                list(fc.staged_repair),
                on_canvas=env.emit_canvas,
                expected_revision=fc.last_snapshot_hash,
                failed_run_id=env.repo.get_run(fc.verify_run_id).dify_run_id if fc.verify_run_id else "",
            )
        except DraftWouldNotStartError as exc:
            # The fix applied, but apply_repair's preflight found the result
            # would fail at Graph.init, so nothing was written. Not a stale
            # fix: say so, then the same surface as below.
            logger.warning(
                "Dify Builder: staged repair would leave a draft that cannot start for app %s: %s", s.app_id, exc
            )
            items = drop_unapplied_repair(
                env,
                s,
                fc,
                progress,
                title=copy_text(BuilderCopyId.LABELS_THE_WORKFLOW_CAN_T_START),
                body=copy_text(BuilderCopyId.REPAIR_INVALID_GRAPH, value=str(exc)),
            )
            return StepResult(next=PcState.EDIT_AWAIT_REPAIR, context=fc, items=items)
        except ValueError as exc:
            # Same stale-intent window as Build's gate: apply_repair
            # re-validates against the draft as it is NOW, and a bad intent
            # must not kill the session (ESQ1-271).
            logger.warning("Dify Builder: staged repair no longer applies for app %s: %s", s.app_id, exc)
            items = drop_unapplied_repair(
                env,
                s,
                fc,
                progress,
                title=copy_text(BuilderCopyId.LABELS_COULDN_T_APPLY_THE_FIX),
                body=copy_text(BuilderCopyId.REPAIR_STALE_PROPOSAL, value=str(exc)),
            )
            return StepResult(next=PcState.EDIT_AWAIT_REPAIR, context=fc, items=items)
        fc.last_snapshot_hash = result.new_hash
        fc.last_structure_fingerprint = result.structure_fingerprint
        fc.staged_repair = []
        changes, scope, fc.change_set = build_change_set(result, default_scope="configuration", fallback_diff="repair")
        progress.activate("edit-prepare-retest")
        decision_items = append_card(
            fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_APPLIED_THE_FIX_READY_TO_RETEST))
        )
        execution = progress.finish()
        change_lines = "\n".join(f"- {change}" for change in changes) or text_parts(
            "- ", copy_text(BuilderCopyId.REPAIR_APPLIED_FALLBACK)
        )
        turn_items = append_assistant(
            env,
            s,
            fc,
            text_parts(copy_text(BuilderCopyId.REPAIR_APPLIED, count=len(changes), scope=scope), "\n", change_lines),
            execution=execution,
            turn_id=progress.operation_id,
        )
        return StepResult(next=PcState.EDIT_APPLY_CHANGES, context=fc, items=[*decision_items, *turn_items])
    if kind == "keep_draft":
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_KEPT_THE_DRAFT_DESPITE_THE_FAILURE)))
        return StepResult(next=PcState.EDIT_REVIEW, context=fc, items=items)
    if kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_REQUESTED_A_REVERT)))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.EDIT_AWAIT_REPAIR, context=fc)


def handle_review(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Final user decision before publish or completion."""
    kind = action_kind(turn)
    if kind == "run_affected_tests":
        fc.verify_run_id = ""
        return handle_apply_changes(env, turn, s, fc)
    if kind == "publish_workflow":
        decision = publication_for_context(env, turn, s, fc)
        if not decision.allowed:
            return publication_denied(env, s, fc, PcState.EDIT_REVIEW, decision.reason)
        return StepResult(
            next=PcState.EDIT_PUBLISH,
            context=fc,
            items=append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_CHOSE_TO_PUBLISH))),
        )
    if kind == "keep_draft":
        decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_KEPT_THE_DRAFT)))
        turn_items = append_assistant(
            env,
            s,
            fc,
            text_parts(copy_text(BuilderCopyId.EDIT_COMPLETED_DRAFT, changes="; ".join(fc.plan_items))),
        )
        return StepResult(next=PcState.EDIT_COMPLETE, context=fc, items=[*decision_items, *turn_items])
    if kind == "re_fix":  # continue_adjusting -> re-analyze impact
        return _resume_adjusting(env, turn, s, fc)
    if kind == "undo":  # revert
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_REQUESTED_A_REVERT)))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.EDIT_REVIEW, context=fc)


def handle_publish(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Publish the updated workflow and close the edit flow."""
    decision = publication_for_context(env, turn, s, fc)
    if not decision.allowed:
        return publication_denied(env, s, fc, PcState.EDIT_REVIEW, decision.reason)
    verified_run = env.repo.get_run(fc.verify_run_id)
    evidence = verified_run.verification
    assert evidence is not None
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[("edit-publish-workflow", copy_text(BuilderCopyId.PROGRESS_PUBLISH_THE_UPDATED_WORKFLOW))],
    )
    progress.activate("edit-publish-workflow")
    try:
        published = env.dify.publish(
            s.app_id,
            turn.actor,
            expected_revision=evidence.execution_revision,
            expected_graph_revision=evidence.executed_graph_revision,
        )
    except HashMismatchError:
        progress.fail_step("edit-publish-workflow")
        progress.finish()
        return publication_denied(env, s, fc, PcState.EDIT_REVIEW, "stale_revision")
    emit_canvas(env, "publish_workflow")
    execution = progress.finish()
    items = append_assistant(
        env,
        s,
        fc,
        copy_text(BuilderCopyId.PUBLISH_EDIT_COMPLETE, version=published.version_name, status=published.status),
        execution=execution,
        turn_id=progress.operation_id,
    )
    return StepResult(next=PcState.EDIT_COMPLETE, context=fc, items=items)


def handle_reverted(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) After a revert. ``retry_after_revert`` (resolved to re_fix)
    re-proposes the change plan, self-mints a fresh pre-edit checkpoint, and
    returns to edit.plan_approval (spec §7.2) only with a complete new plan.
    Failed planning leaves the prior plan, checkpoint and verification intact.

    ``last_edit_rejection`` is deliberately carried through untouched. A revert
    taken at the plan gate wrote nothing, so the restored draft is the refused
    draft and the rules are unchanged -- and Retry is the only action offered
    here, so forgetting the engine's text would re-propose the identical plan
    blind and earn the identical refusal."""
    kind = action_kind(turn)
    if kind != "re_fix":
        return StepResult(next=PcState.EDIT_REVERTED, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("edit-rebuild-plan", copy_text(BuilderCopyId.PROGRESS_REBUILD_THE_CHANGE_PLAN)),
            ("edit-create-checkpoint", copy_text(BuilderCopyId.PROGRESS_CREATE_A_NEW_PRE_EDIT_CHECKPOINT)),
        ],
    )
    progress.activate("edit-rebuild-plan")
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    plan = env.agent.propose_edit_plan(dict(fc.edit_rules), graph)
    if plan is None:
        return edit_planning_failed(env, s, fc, progress, "edit-rebuild-plan")
    store_plan(fc, plan)
    fc.checkpoint_seq = fc.next_seq
    fc.test_input_ref = ""
    fc.verify_run_id = ""
    fc.repair_attempts = 0
    fc.last_repair_error = ""
    fc.unknown_outcome_count = 0
    progress.activate("edit-create-checkpoint")
    mint_checkpoint(env, s, fc, graph, graph_hash, PcState.EDIT_PLAN_APPROVAL)
    plan_items = append_card(fc, make_plan_card(fc))
    execution = progress.finish()
    turn_items = append_assistant(
        env,
        s,
        fc,
        copy_text(BuilderCopyId.LABELS_RE_APPROVE_TO_APPLY_THE_CHANGE),
        execution=execution,
        cards=["plan"],
        turn_id=progress.operation_id,
    )
    return StepResult(next=PcState.EDIT_PLAN_APPROVAL, context=fc, items=[*plan_items, *turn_items])


def edit_registry() -> dict[PcState, Handler]:
    """The Edit handler table; ``edit.complete`` is the terminal state."""
    return {
        PcState.EDIT_CAPABILITY_CHECK: handle_capability_check,
        PcState.EDIT_IMPACT_ANALYSIS: handle_impact_analysis,
        PcState.EDIT_PLAN_APPROVAL: handle_plan_approval,
        PcState.EDIT_APPLY_CHANGES: handle_apply_changes,
        PcState.EDIT_AWAIT_TESTDATA: handle_await_testdata,
        PcState.EDIT_TEST_AFFECTED_PATHS: handle_test_affected_paths,
        PcState.EDIT_AWAIT_REPAIR: handle_await_repair,
        PcState.EDIT_REVIEW: handle_review,
        PcState.EDIT_PUBLISH: handle_publish,
        PcState.EDIT_REVERTED: handle_reverted,
    }
