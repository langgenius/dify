"""Build-flow handlers: pure ``(env, turn, session, fc) -> StepResult`` steps.

Mirrors ``handlers_fix.py`` for the Build entry mode (spec: docs/superpowers/
specs/2026-08-22-dify-builder-slice2-build-design.md). Cards for a state
are emitted by the handler transitioning INTO it; working states auto-advance;
the build itself rides on ``handle_plan_approval`` (approve_plan) because
``build.execution`` is a waiting state. ``build.complete`` is terminal and has
no handler; completion and publish receipts are emitted as assistant text.
"""

import json
import logging
import uuid
from dataclasses import fields, replace
from typing import Any

from core.dify_builder.contract import (
    DecisionItem,
    FormCard,
    ResourceSelectCard,
    TestResultCard,
)
from core.dify_builder.errors import DraftWouldNotStartError, HashMismatchError
from core.dify_builder.input_schema import schema_hash, validate_runtime_inputs
from core.dify_builder.models import (
    ConversationItem,
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
from core.dify_builder.state import PcState
from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.presentation import BuilderText, copy_text, text_parts
from services.dify_builder.application.handlers_fix import (
    MAX_REPEATED_REPAIRS,
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
    failure_signature,
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
    without_upload_values,
)
from services.dify_builder.application.runner import Env, Handler, StepResult
from services.dify_builder.application.testdata import stamp_testdata_http_fixtures
from services.dify_builder.application.verification import (
    SUCCESS_REPLY,
    has_output_blocker,
    is_execution_policy_blocker,
    result_card,
)
from services.dify_builder.execution_messages import change_scope_label
from services.dify_builder.initial_draft import build_intents_for_draft
from services.dify_builder.plan import make_plan_card, store_plan

logger = logging.getLogger(__name__)

__all__ = [
    "build_registry",
    "handle_await_repair",
    "handle_await_testdata",
    "handle_capability_check",
    "handle_execution",
    "handle_goal_analysis",
    "handle_initial_plan",
    "handle_plan_approval",
    "handle_publish",
    "handle_resource_recommendation",
    "handle_reverted",
    "handle_review",
    "handle_test_and_repair",
]


def _refine_app_name(env: Env, fc: DifyBuilderContext) -> None:
    """Replace the prompt-derived app name with a model-written one, once (spec N1).

    Creation named the app by cutting the prompt's opening clause -- mechanical,
    and English-shaped where it has to judge. The goal has just been understood
    here and a model is in hand, so the name can be rewritten properly, in
    whatever language the user wrote. Plan approval then freezes it (spec N3).

    The flag is cleared whether or not the proposal was usable, so a session
    never renames twice and never retries a model that gave nothing. It is
    committed with the transition while the rename commits on its own, so an
    advance that fails after this point proposes again next attempt and
    overwrites with an equivalent title.
    """
    if not fc.app_name_auto:
        return
    fc.app_name_auto = False
    if env.rename_app is None:
        return
    proposed = env.agent.propose_app_name(fc.goal_text, fc.requirements)
    if proposed and proposed.strip():
        stored = env.rename_app(proposed)
        if stored:
            fc.app_name = stored


def handle_capability_check(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """Automatic entry step for the goal persisted during session creation."""
    if not fc.goal_text:
        raise ValueError("dify_builder: build goal is required before capability check")

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("build-understand-goal", copy_text(BuilderCopyId.PROGRESS_UNDERSTAND_THE_REQUESTED_WORKFLOW)),
            ("build-prepare-requirements", copy_text(BuilderCopyId.PROGRESS_PREPARE_REQUIREMENT_FIELDS)),
        ],
    )
    progress.activate("build-understand-goal")
    emit_canvas(env, "reset_build_canvas")
    analysis = env.agent.analyze_goal(fc.goal_text, reply_language=fc.reply_language or None)
    fc.form_fields = list(analysis.get("fields") or [])
    fc.requirements = dict(analysis.get("values") or {})
    _refine_app_name(env, fc)

    progress.activate("build-prepare-requirements")
    form_items = append_card(
        fc,
        FormCard(
            variant="build_requirements",
            title=copy_text(BuilderCopyId.FORMS_REQUIREMENTS_TITLE),
            description=copy_text(BuilderCopyId.FORMS_REQUIREMENTS_DESCRIPTION),
            fields=build_form_fields(fc.form_fields),
            values=dict(fc.requirements),
            frozen=False,
        ),
    )
    execution = progress.finish()
    turn_items = append_assistant(
        env,
        s,
        fc,
        copy_text(BuilderCopyId.BUILD_REQUIREMENTS_DEFAULTS_FILLED),
        execution=execution,
        cards=["form"],
        turn_id=progress.operation_id,
    )
    return StepResult(
        next=PcState.BUILD_GOAL_ANALYSIS,
        context=fc,
        items=[*form_items, *turn_items],
    )


def handle_goal_analysis(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) On ``submit_requirements`` merge the form payload, propose
    plan v1, and go straight to resource discovery (build.resource_recommendation)
    via the shared ``_discover_and_offer_resources`` helper. The decision-free
    find_resources gate that used to sit at build.initial_plan (showing the
    same plan a second time) is gone; that state is now reached only via the
    continue_adjusting/retry_after_revert loop-back (handle_initial_plan).
    If planning returns no usable plan, keep this waiting state and prior plan."""
    kind = action_kind(turn)
    if kind != "submit_requirements":
        return StepResult(next=PcState.BUILD_GOAL_ANALYSIS, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("build-review-requirements", copy_text(BuilderCopyId.PROGRESS_REVIEW_CONFIRMED_REQUIREMENTS)),
            ("build-draft-plan", copy_text(BuilderCopyId.PROGRESS_DRAFT_THE_WORKFLOW_PLAN)),
        ],
    )
    progress.activate("build-review-requirements")
    if turn.action is not None and isinstance(turn.action.payload, dict):
        keys = [f["key"] for f in fc.form_fields if isinstance(f, dict) and f.get("key")]
        fc.requirements = merge_known_keys(fc.requirements, turn.action.payload, keys)

    progress.activate("build-draft-plan")
    plan = env.agent.propose_plan_v1(fc.requirements, goal_text=fc.goal_text)
    if not plan:
        return _planning_failed(env, s, fc, progress, "build-draft-plan", PcState.BUILD_GOAL_ANALYSIS)
    store_plan(fc, plan)

    decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_SUBMITTED_REQUIREMENTS)))
    # Pass the live reporter through: this is still the SAME operation as the
    # requirements review above, and every other handler in this file uses
    # exactly one ProgressReporter per step. A second reporter under the same
    # env.operation_id would restart `revision` at 1, breaking the documented
    # per-operation-monotonic invariant (contract.py's ProgressEventData).
    resource_items, next_state = _discover_and_offer_resources(env, s, fc, progress)
    return StepResult(
        next=next_state,
        context=fc,
        items=[*decision_items, *resource_items],
    )


def _planning_failed(
    env: Env, s: Session, fc: DifyBuilderContext, progress: ProgressReporter, step_id: str, waiting_state: PcState
) -> StepResult:
    """Keep the accepted context and waiting gate when no replacement exists."""
    progress.fail_step(step_id)
    execution = progress.finish(status="error")
    form_items = []
    if waiting_state == PcState.BUILD_GOAL_ANALYSIS:
        # Reload projects the latest durable form, so reoffer accepted values
        # rather than the defaults from before the failed submission. Keep the
        # current field contract, including constraints beyond the goal
        # analyzer's usual scalar specs.
        form_fields = build_form_fields(fc.form_fields)
        specs = {str(spec["key"]): spec for spec in fc.form_fields if isinstance(spec, dict) and spec.get("key")}
        form_fields = [
            replace(
                form_field,
                **{
                    definition.name: specs[form_field.key][definition.name]
                    for definition in fields(form_field)
                    if definition.name not in {"key", "label", "type", "options", "hint"}
                    and definition.name in specs[form_field.key]
                },
            )
            for form_field in form_fields
        ]
        form_items = append_card(
            fc,
            FormCard(
                variant="build_requirements",
                title=copy_text(BuilderCopyId.FORMS_REQUIREMENTS_TITLE),
                description=copy_text(BuilderCopyId.FORMS_REQUIREMENTS_DESCRIPTION),
                fields=form_fields,
                values=dict(fc.requirements),
                frozen=False,
            ),
        )
    from services.dify_builder.execution_messages import cognition_failure_message

    turn_items = append_assistant(
        env,
        s,
        fc,
        cognition_failure_message(
            env.diagnostics,
            copy_text(BuilderCopyId.REPLIES_I_COULDN_T_PRODUCE_A_USABLE),
            reply_language=fc.reply_language,
        ),
        execution=execution,
        cards=["form"] if form_items else None,
        turn_id=progress.operation_id,
    )
    return StepResult(next=waiting_state, context=fc, items=[*form_items, *turn_items])


def _discover_and_offer_resources(
    env: Env, s: Session, fc: DifyBuilderContext, progress: ProgressReporter | None = None
) -> tuple[list[ConversationItem], PcState]:
    """Discover tenant resources and emit the selection card.

    Shared by the straight-through path (requirements submitted -- continues
    the caller's still-open ``progress`` reporter, so the whole step stays
    ONE operation with monotonically increasing revisions) and the
    continue_adjusting path, which re-enters at BUILD_INITIAL_PLAN with no
    reporter yet (``progress=None``, so one is created here). One
    implementation so the two entries cannot drift apart.
    """
    steps = [
        ("build-discover-resources", copy_text(BuilderCopyId.PROGRESS_FIND_COMPATIBLE_RESOURCES)),
        ("build-prepare-resource-options", copy_text(BuilderCopyId.PROGRESS_PREPARE_RESOURCE_RECOMMENDATIONS)),
    ]
    if progress is None:
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            reply_language=fc.reply_language,
            stage_id=str(s.current_state),
            steps=steps,
        )
    else:
        progress.add_steps(steps)
    progress.activate("build-discover-resources")
    options = env.agent.discover_resources(list(fc.plan_items), goal_text=fc.goal_text, requirements=fc.requirements)
    progress.activate("build-prepare-resource-options")
    rs_items = append_card(
        fc,
        ResourceSelectCard(
            title=copy_text(BuilderCopyId.RESOURCES_TITLE),
            description=copy_text(BuilderCopyId.RESOURCES_CATALOGUE_UNAVAILABLE)
            if any(record.get("code") == "inventory_unavailable" for record in env.diagnostics)
            else copy_text(BuilderCopyId.RESOURCES_DESCRIPTION)
            if options
            else copy_text(BuilderCopyId.REPLIES_NO_WORKSPACE_RESOURCES_MATCHED_THIS_PLAN_CONTINUING_WITHOUT_ANY),
            recommended=options,
        ),
    )
    # Keep the empty selection card as the active confirm gate. Its description
    # explains the empty result without adding a standalone conversation item.
    gap = env.agent.assess_capability_gap(
        list(fc.plan_items), options, goal_text=fc.goal_text, requirements=fc.requirements
    )
    execution = progress.finish()
    turn_items = append_assistant(
        env,
        s,
        fc,
        text_parts(copy_text(BuilderCopyId.LABELS_RECOMMENDED_RESOURCES), "\n\n", gap)
        if gap
        else copy_text(BuilderCopyId.LABELS_RECOMMENDED_RESOURCES),
        execution=execution,
        cards=["resource_select"],
        turn_id=progress.operation_id,
    )
    return [*rs_items, *turn_items], PcState.BUILD_RESOURCE_RECOMMENDATION


def handle_initial_plan(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Discover the (canned, ready) resource and fall straight
    through to build.resource_recommendation. Reachable only via the
    continue_adjusting/retry_after_revert loop-back -- the straight-through
    path no longer stops here (see handle_goal_analysis). Unconditional: this
    is a working/pass-through state now (state.py), so the runner drives it
    on entry with no action to gate on -- it must NOT re-require find_resources,
    or the loop-back (which lands here with the action already consumed)
    could never advance past it."""
    items, next_state = _discover_and_offer_resources(env, s, fc)
    return StepResult(next=next_state, context=fc, items=items)


def handle_resource_recommendation(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) On ``confirm_resources`` bind resources into plan v1 and
    snapshot the pre-build graph as the backend restore checkpoint. Transition
    to build.plan_approval."""
    kind = action_kind(turn)
    if kind != "confirm_resources":
        return StepResult(next=PcState.BUILD_RESOURCE_RECOMMENDATION, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("build-bind-resources", copy_text(BuilderCopyId.PROGRESS_BIND_SELECTED_RESOURCES_TO_THE_PLAN)),
            ("build-create-checkpoint", copy_text(BuilderCopyId.PROGRESS_CREATE_A_PRE_BUILD_CHECKPOINT)),
        ],
    )
    progress.activate("build-bind-resources")
    fc.checkpoint_seq = fc.next_seq

    resource_ids: list[str] = []
    if turn.action is not None and isinstance(turn.action.payload, dict):
        raw_ids = turn.action.payload.get("resource_ids")
        if isinstance(raw_ids, list):
            resource_ids = [r for r in raw_ids if isinstance(r, str)]
    fc.resource_selection = {"resource_ids": resource_ids}
    fc.plan_items = env.agent.bind_resources(list(fc.plan_items), resource_ids)

    progress.activate("build-create-checkpoint")
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    mint_checkpoint(env, s, fc, graph, graph_hash, PcState.BUILD_PLAN_APPROVAL)

    decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_CONFIRMED_RESOURCES)))
    plan_items = append_card(fc, make_plan_card(fc))
    execution = progress.finish()
    turn_items = append_assistant(
        env,
        s,
        fc,
        copy_text(BuilderCopyId.BUILD_PLAN_READY),
        execution=execution,
        cards=["plan"],
        turn_id=progress.operation_id,
    )
    return StepResult(
        next=PcState.BUILD_PLAN_APPROVAL,
        context=fc,
        items=[*decision_items, *plan_items, *turn_items],
    )


def _graph_not_applied(
    env: Env,
    s: Session,
    fc: DifyBuilderContext,
    progress: ProgressReporter,
    *,
    title: BuilderText,
    body: BuilderText,
    reply_text: BuilderText,
) -> StepResult:
    """apply_repair refused the generated graph and wrote nothing: say why and
    keep the plan approvable (re-approving regenerates the graph).

    Refresh the client's canvas from the unchanged draft using the same
    signal as perform_revert."""
    emit_canvas(env, "revert_checkpoint")
    progress.fail_step("build-apply-graph")
    execution = progress.finish(status="error")
    turn_items = append_assistant(
        env, s, fc, text_parts(title, ": ", body, "\n", reply_text), execution=execution, turn_id=progress.operation_id
    )
    return StepResult(next=PcState.BUILD_PLAN_APPROVAL, context=fc, items=turn_items)


def handle_plan_approval(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) THE BUILD. Only ``approve_repair`` (resolved from approve_plan)
    builds: drive apply_repair once with all create_node/connect intents
    (node-by-node canvas reveal via env.emit_canvas), summarize the applied
    changes in assistant text, and transition to build.execution.

    Idempotent by construction (final-review fix, Important #1): a loop-back
    from build.review/build.reverted (continue_adjusting/revert/retry_after_
    revert) returns to build.initial_plan WITHOUT resetting the already-built
    graph. Re-walking find_resources -> confirm_resources -> approve_plan then
    calls build_nodes() again, which always proposes the SAME fixed node ids
    -- so before applying, drop any create_node/connect intent that already
    exists in the current draft graph. Everything survives the first build
    (nothing exists yet); a re-approve after a loop-back filters everything
    out (it all already exists), so apply_repair([]) is a no-op rather than
    raising on a colliding node id.

    The service-owned initial-draft policy replaces placeholder Start nodes or
    the unconfigured Chatflow template in the same batch as generation. IDs
    being replaced do not suppress the generated nodes or connections."""
    kind = action_kind(turn)
    if kind != "approve_repair":
        return StepResult(next=PcState.BUILD_PLAN_APPROVAL, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("build-generate-graph", copy_text(BuilderCopyId.PROGRESS_GENERATE_THE_WORKFLOW_GRAPH)),
            ("build-validate-graph", copy_text(BuilderCopyId.PROGRESS_VALIDATE_CHANGES_AGAINST_THE_CURRENT_CANVAS)),
            ("build-apply-graph", copy_text(BuilderCopyId.PROGRESS_APPLY_THE_WORKFLOW_TO_THE_CANVAS)),
        ],
    )
    progress.activate("build-generate-graph")
    # Pass the user's selected resources so a chosen model resource grounds the
    # built nodes (not the Builder's session model). resource_ids were already
    # string-filtered when stored (handle_resource_recommendation).
    selected_resource_ids = list(fc.resource_selection.get("resource_ids") or [])
    # The text the user actually typed (goal + the requirements form as they
    # submitted it) -- core/dify_builder cannot import services, so this is
    # built inline, matching services.dify_builder.agent.user_supplied's
    # trusted_text_for byte-for-byte (see test_plan_approval_passes_trusted_
    # text_matching_user_supplied_trusted_text_for). Lets build_nodes tell an
    # endpoint the user actually gave from one the model invented (ESQ1-302/S5b).
    trusted_text = f"{fc.goal_text}\n{json.dumps(dict(fc.requirements), ensure_ascii=False)}"
    build_result = env.agent.build_nodes(list(fc.plan_items), selected_resource_ids, trusted_text=trusted_text)
    intents = build_result.intents

    if not any(intent.op == "create_node" for intent in intents):
        # Generation produced no nodes (build.build_nodes' honest-empty path when the
        # generator + its one retry still fail to yield a valid graph). Do NOT delete
        # the placeholder start or report a successful build -- that would empty the
        # canvas while claiming "Workflow built on the canvas." Surface an honest error
        # WITH the specific reason (build_result.error, e.g. UNRESOLVED_REFERENCE /
        # non-object JSON / credit_balance_exhausted) so the user can act on it, and stay
        # in plan_approval so they can adjust the goal/plan and re-approve. (A loop-back
        # re-approve still returns the fixed create intents -- only filtered as
        # already-present below -- so zero create intents means genuine failure.)
        body = (
            copy_text(BuilderCopyId.BUILD_GENERATION_FAILED, error=build_result.error)
            if build_result.error
            else (copy_text(BuilderCopyId.REPLIES_I_COULDN_T_GENERATE_A_VALID))
        )
        from services.dify_builder.execution_messages import cognition_failure_message

        body = cognition_failure_message(env.diagnostics, body, reply_language=fc.reply_language)
        logger.warning(
            "dify_builder graph generation failed",
            extra={"session_id": s.id, "app_id": s.app_id, "diagnostics": build_result.diagnostics},
        )
        progress.fail_step("build-generate-graph")
        execution = progress.finish(status="error")
        turn_items = append_assistant(
            env,
            s,
            fc,
            body,
            execution=execution,
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.BUILD_PLAN_APPROVAL,
            context=fc,
            items=turn_items,
        )

    progress.activate("build-validate-graph")
    current_graph, _current_hash = env.dify.read_graph(s.app_id, turn.actor)
    to_apply = build_intents_for_draft(current_graph, intents, mode=env.dify.get_app_mode(s.app_id, turn.actor))

    # A FIRST build of this session that would apply no node at all has not
    # built anything. The draft already carries a PREVIOUS graph under the same
    # generated ids -- the generator always emits node1, node2, ... -- so
    # _already_present filtered every create against nodes this session never
    # built, matching on id alone (an existing node2:llm swallows a planned
    # node2:parameter-extractor). Reporting "graph built" here would claim a
    # canvas the user never got: the empty-build false-success failure, one
    # level further in than the zero-create-intents guard above.
    #
    # The loop-back re-approve this filter exists for is the opposite case and
    # must still no-op silently -- there ``built_node_ids`` names the nodes
    # this session built, so it never reaches this branch.
    if not fc.built_node_ids and not any(intent.op == "create_node" for intent in to_apply):
        progress.fail_step("build-validate-graph")
        execution = progress.finish(status="error")
        turn_items = append_assistant(
            env,
            s,
            fc,
            copy_text(BuilderCopyId.REPLIES_I_DIDN_T_APPLY_ANYTHING_THE),
            execution=execution,
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.BUILD_PLAN_APPROVAL,
            context=fc,
            items=turn_items,
        )

    progress.activate("build-apply-graph")
    confirmed_resources: dict[str, Any] = {}
    if any(item.startswith("agent:") for item in selected_resource_ids):
        confirmed_resources["confirmed_resource_ids"] = selected_resource_ids
    try:
        result = env.dify.apply_repair(
            s.app_id,
            turn.actor,
            to_apply,
            on_canvas=env.emit_canvas,
            expected_revision=fc.last_snapshot_hash,
            **confirmed_resources,
        )
    except DraftWouldNotStartError as exc:
        # The generator's own checks passed, but the draft would fail at
        # Graph.init (apply_repair's preflight; ESQ1-302/303 both died there
        # on the first test run). Nothing was written. Say which node and why,
        # and keep the plan approvable: re-approving regenerates the graph.
        logger.warning("Dify Builder: generated graph rejected before write for app %s: %s", s.app_id, exc)
        return _graph_not_applied(
            env,
            s,
            fc,
            progress,
            title=copy_text(BuilderCopyId.LABELS_THE_WORKFLOW_CAN_T_START),
            body=copy_text(BuilderCopyId.BUILD_INVALID_GRAPH, value=str(exc)),
            reply_text=(copy_text(BuilderCopyId.REPLIES_I_DIDN_T_APPLY_THE_WORKFLOW)),
        )
    except ValueError as exc:
        # graph_ops refused an intent (e.g. "node not found") before the
        # startability check ever ran. Nothing was written either, so the
        # same recovery -- but "can't start" would send the user hunting for
        # a broken node that does not exist.
        logger.warning("Dify Builder: generated graph could not be applied for app %s: %s", s.app_id, exc)
        return _graph_not_applied(
            env,
            s,
            fc,
            progress,
            title=copy_text(BuilderCopyId.LABELS_COULDN_T_APPLY_THE_WORKFLOW),
            body=copy_text(BuilderCopyId.BUILD_APPLY_FAILED, value=str(exc)),
            reply_text=copy_text(BuilderCopyId.REPLIES_I_COULDN_T_APPLY_THE_WORKFLOW),
        )
    fc.last_snapshot_hash = result.new_hash
    fc.last_structure_fingerprint = result.structure_fingerprint
    fc.built_node_ids = [
        intent.args["node_id"]
        for intent in intents
        if intent.op == "create_node" and isinstance(intent.args.get("node_id"), str)
    ]
    changes, scope, fc.change_set = build_change_set(result, default_scope="structure", fallback_diff="graph built")

    decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_APPROVED_THE_PLAN)))
    execution = progress.finish()
    change_lines = "\n".join(f"- {change}" for change in changes) or text_parts(
        "- ", copy_text(BuilderCopyId.BUILD_GRAPH_CREATED)
    )
    turn_items = append_assistant(
        env,
        s,
        fc,
        text_parts(
            copy_text(
                BuilderCopyId.BUILD_GRAPH_APPLIED,
                count=len(changes),
                scope=change_scope_label(scope, fc.reply_language),
            ),
            "\n",
            change_lines,
        ),
        execution=execution,
        turn_id=progress.operation_id,
    )
    return StepResult(
        next=PcState.BUILD_EXECUTION,
        context=fc,
        items=[*decision_items, *turn_items],
    )


def handle_execution(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) At rest after the build. ``run_test`` -> build.await_testdata
    ONLY when no test input is prepared yet AND the start schema declares a
    file/file-list variable (a human has to supply an upload; nothing else
    needs one) -- else the inputs are mocked inline via
    ``env.agent.generate_mock_inputs`` and the flow goes straight to
    build.test_and_repair; ``revert`` (resolved to ``undo``) -> build.reverted:
    restores the pre-build draft from the checkpoint and invalidates the
    approvals made since it (via perform_revert)."""
    kind = action_kind(turn)
    if kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_REQUESTED_A_REVERT)))
        return StepResult(next=PcState.BUILD_REVERTED, context=fc, items=items)
    if kind == "run_test":
        fc.verify_run_id = ""
        # A new user choice is a new attempt; previous effect approval was
        # scoped to the preceding saved-input attempt, including unknown ones.
        fc.effect_confirmation = {}
        fc.effect_confirmation_form = {}
        fc.code_risk_assessments = {}
        # A side effect not yet confirmed for its current target shows the form
        # again, with the prepared inputs, so it is never mocked unannounced.
        if fc.test_input_ref == "" or needs_effect_confirmation(env, s, fc, turn.actor):
            graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
            schema = start_schema(graph, env.dify.get_app_mode(s.app_id, turn.actor))
            if fc.test_input_ref:
                prefill = saved_test_inputs(env, fc)
            else:
                # Pre-fill the form with mock values instead of asking the user to
                # invent them: the cost is one click, not N fields. Still SHOW
                # them -- a green check produced by inputs nobody ever saw is weak
                # evidence about the workflow. Upload fields stay empty because
                # nothing can mock a file. Endpoint fields -- a start variable an
                # http-request node reads its URL from (ESQ1-302's placeholder
                # grounding) -- stay empty too: a mocked endpoint is just another
                # invented URL, so the form asks for those alone as well.
                mocked = without_upload_values(schema, env.agent.generate_mock_inputs(schema, {}))
                prefill = without_endpoint_values(graph, mocked)
            card, reply = testdata_form(
                env,
                s,
                fc,
                turn.actor,
                schema,
                prefill,
                copy_text(BuilderCopyId.REPLIES_I_FILLED_IN_TEST_INPUTS_EDIT_THEM_IF_YOU_LIKE_THEN_RUN_THE_TEST),
            )
            form_items = append_card(fc, card)
            turn_items = append_assistant(env, s, fc, reply, cards=["form"])
            return StepResult(next=PcState.BUILD_AWAIT_TESTDATA, context=fc, items=[*form_items, *turn_items])
        ti = replace(env.repo.get_test_input(fc.test_input_ref), id="")
        env.repo.save_test_input(ti)
        fc.test_input_ref = ti.id
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.ACTIONS_RUN_TESTS)))
        return StepResult(next=PcState.BUILD_TEST_AND_REPAIR, context=fc, items=items)
    return StepResult(next=PcState.BUILD_EXECUTION, context=fc)


def handle_await_testdata(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Prepare inputs for the live test run. mock -> schema-shaped
    generate_mock_inputs; provide/upload -> the payload's inputs dict (may carry
    file refs). Persists a TestInput and advances to build.test_and_repair."""
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
            steps=[("build-generate-test-inputs", copy_text(BuilderCopyId.PROGRESS_GENERATE_TEST_INPUTS))],
        )
        progress.activate("build-generate-test-inputs")
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
            PcState.BUILD_AWAIT_TESTDATA,
            copy_text(BuilderCopyId.TEST_EFFECTS_CHANGED),
            actor=turn.actor,
        )
    try:
        validate_runtime_inputs(schema, inputs)
    except ValueError as exc:
        return input_gate_result(env, s, fc, schema, inputs, PcState.BUILD_AWAIT_TESTDATA, str(exc), actor=turn.actor)
    ti = TestInput(
        session_id=s.id,
        source=mode or "upload",
        inputs=inputs,
        start_schema_hash=schema_hash(schema),
        http_fixtures=http_fixtures,
    )
    env.repo.save_test_input(ti)
    fc.test_input_ref = ti.id
    return StepResult(next=PcState.BUILD_TEST_AND_REPAIR, context=fc)


def handle_test_and_repair(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Live test: run the built draft with mock inputs. Success
    -> build.review. Failure -> real diagnose + propose_repair, staged for the
    build.await_repair approval gate. No auto-apply (human-gated)."""
    if is_confirmed_tool_turn(turn, fc):
        return confirmed_tool_test(env, turn, s, fc, review_state=PcState.BUILD_REVIEW, step_prefix="build")
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("build-prepare-test", copy_text(BuilderCopyId.PROGRESS_PREPARE_THE_WORKFLOW_TEST)),
            ("build-run-test", copy_text(BuilderCopyId.PROGRESS_RUN_THE_WORKFLOW)),
            ("build-evaluate-test", copy_text(BuilderCopyId.PROGRESS_EVALUATE_THE_TEST_RESULT)),
        ],
    )
    progress.activate("build-prepare-test")
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

    progress.activate("build-run-test")

    def emit(event: NodeEvent) -> None:
        progress.observe_node("build-run-test", event)

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
            PcState.BUILD_AWAIT_TESTDATA,
            copy_text(BuilderCopyId.TEST_POLICY_REVIEW),
            actor=turn.actor,
        )

    if status == "succeeded":
        progress.complete("build-run-test")
    else:
        progress.fail_step("build-run-test")
    progress.activate("build-evaluate-test")

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

    from services.dify_builder.execution_messages import native_service_failure

    if is_execution_policy_blocker(run) or native_service_failure(run):
        fc.diagnosis = None
        fc.staged_repair = []
        card = result_card(run, reply_language=fc.reply_language)
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
        return StepResult(next=PcState.BUILD_AWAIT_REPAIR, context=fc, items=items, run=run, run_id_sink=[run.id])

    if status != "running":
        fc.unknown_outcome_count = 0

    if status == "succeeded" and (
        has_output_blocker(run) or (run.verification is None and run_finished_without_output(graph, per_node))
    ):
        # A branch node ran and none of its arms did -- the engine skipped
        # every one (ESQ1-303: both if-else edges on undeclared handles) --
        # and no End node ran either, so the run "succeeded" with nothing to
        # show. Not green; not an engine error to diagnose either, so it
        # waits at the gate with no staged repair for the user to edit,
        # keep, or revert.
        fc.verify_run_id = run.id
        fc.diagnosis = None
        fc.staged_repair = []
        run.culprit_node_id = dead_end_branch_node_id(graph, per_node)
        test_items = append_card(
            fc,
            result_card(run, reply_language=fc.reply_language)
            if run.verification
            else TestResultCard(status="failed", failure_reason=NO_OUTPUT_BODY, dify_run_id=run.dify_run_id),
        )
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            (result_card(run, reply_language=fc.reply_language).failure_reason or NO_OUTPUT_BODY),
            execution=execution,
            cards=["test_result"],
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.BUILD_AWAIT_REPAIR,
            context=fc,
            items=[*test_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    if status == "succeeded":
        test_items = append_card(
            fc,
            result_card(run, reply_language=fc.reply_language),
        )
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            text_parts(SUCCESS_REPLY, " ", result_card(run, reply_language=fc.reply_language).review_note or ""),
            execution=execution,
            cards=["test_result"],
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.BUILD_REVIEW,
            context=fc,
            items=[*test_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    if status == "running":
        # Stream truncated: the run's outcome is genuinely unknown, NOT a
        # failure (Run.status documents "running" for exactly this case).
        # Diagnosing/staging a repair here would edit the draft under a run
        # that may still be executing -- explain the unknown result and
        # return to build.execution (re-runnable), without ever calling
        # diagnose or propose_repair. The second consecutive unknown outcome
        # stops the re-run loop at the gate (no staged repair) instead.
        if note_unknown_outcome(fc):
            fc.verify_run_id = run.id
            fc.diagnosis = None
            fc.staged_repair = []
            execution = progress.finish()
            turn_items = append_assistant(
                env,
                s,
                fc,
                UNKNOWN_OUTCOME_STUCK_BODY,
                execution=execution,
                turn_id=progress.operation_id,
            )
            return StepResult(
                next=PcState.BUILD_AWAIT_REPAIR,
                context=fc,
                items=turn_items,
                run=run,
                run_id_sink=[run.id],
            )
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            UNKNOWN_TEST_OUTCOME_REPLY,
            execution=execution,
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.BUILD_EXECUTION,
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
            replace(result_card(run, reply_language=fc.reply_language), failure_reason=test_failure_reason(run)),
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
            next=PcState.BUILD_AWAIT_TESTDATA,
            context=fc,
            items=[*test_items, *form_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    model_error = model_config_error_text(run)
    if model_error is not None:
        # Model-config failure: the workflow references a model that isn't
        # configured/available. This is NOT a workflow-logic bug -- diagnosing +
        # repairing the graph just thrashes (adds if-else/check nodes). Surface it
        # with a clear diagnosis and NO staged repair; the user configures the
        # model (update_model / provider settings) and re-runs (approve at the gate).
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
            replace(result_card(run, reply_language=fc.reply_language), failure_reason=model_error),
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
            next=PcState.BUILD_AWAIT_REPAIR,
            context=fc,
            items=[*test_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    # config failure: existing diagnose + propose_repair -> BUILD_AWAIT_REPAIR
    progress.add_steps(
        [
            ("build-diagnose-failure", copy_text(BuilderCopyId.PROGRESS_DIAGNOSE_THE_FAILED_WORKFLOW)),
            ("build-prepare-repair", copy_text(BuilderCopyId.PROGRESS_PREPARE_A_SAFE_REPAIR)),
        ]
    )
    progress.activate("build-diagnose-failure")
    from services.dify_builder.condition_evidence import diagnose_failure, propose_failure

    diagnosis = diagnose_failure(env, s.app_id, turn.actor, run, graph)
    _note_repair_error(fc, run)
    if _repair_is_repeating(fc):
        # The same failure has now survived _MAX_REPEATED_REPAIRS repairs, so
        # another round would aim at the same wrong thing. Stop spending runs
        # and hand the decision back (ESQ1-285 burned nine approvals this way,
        # ESQ1-290 six). Clearing staged_repair also engages the empty-repair
        # guard above, so "Apply the fix" cannot be approved into a no-op.
        fc.diagnosis = diagnosis
        fc.staged_repair = []
        execution = progress.finish()
        test_items = append_card(
            fc,
            replace(result_card(run, reply_language=fc.reply_language), failure_reason=test_failure_reason(run)),
        )
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
            next=PcState.BUILD_AWAIT_REPAIR,
            context=fc,
            items=[*test_items, *stuck_items],
            run=run,
            run_id_sink=[run.id],
        )
    progress.activate("build-prepare-repair")
    intents, risk = propose_failure(env, s.app_id, turn.actor, run, diagnosis, graph)
    fc.diagnosis = diagnosis
    fc.staged_repair = list(intents)
    fc.risk = risk
    test_items = append_card(
        fc,
        replace(result_card(run, reply_language=fc.reply_language), failure_reason=test_failure_reason(run)),
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
        next=PcState.BUILD_AWAIT_REPAIR,
        context=fc,
        items=[*test_items, *turn_items],
        run=run,
        run_id_sink=[run.id],
    )


# The repair breaker is shared with Edit and owned by handlers_fix; these
# names stay for the existing call sites and tests in this module.
_MAX_REPEATED_REPAIRS = MAX_REPEATED_REPAIRS
_failure_signature = failure_signature
_note_repair_error = note_repair_error
_repair_is_repeating = repair_is_repeating


def handle_await_repair(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Post-failure gate mirroring fix.await_decision. approve_repair
    applies the staged repair and waits at build.execution. The client resumes
    testing only after applying the committed graph to its canvas;
    keep_draft -> build.complete; undo -> build.reverted. apply_repair runs ONLY
    here, only on approve."""
    kind = action_kind(turn)
    if kind == "approve_repair":
        if not fc.staged_repair:
            # Nothing staged: applying would change nothing and the retest
            # would fail identically. Don't spend a run on it (ESQ1-291).
            items = append_assistant(
                env,
                s,
                fc,
                copy_text(BuilderCopyId.REPLIES_NO_FIX_IS_STAGED_FOR_THIS_FAILURE_KEEP_THE_DRAFT_OR_REVERT),
            )
            return StepResult(next=PcState.BUILD_AWAIT_REPAIR, context=fc, items=items)
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            reply_language=fc.reply_language,
            stage_id=str(s.current_state),
            steps=[
                ("build-apply-repair", copy_text(BuilderCopyId.PROGRESS_APPLY_THE_APPROVED_REPAIR)),
                ("build-prepare-retest", copy_text(BuilderCopyId.PROGRESS_PREPARE_TO_RETEST_THE_WORKFLOW)),
            ],
        )
        progress.activate("build-apply-repair")
        try:
            result = env.dify.apply_repair(
                s.app_id,
                turn.actor,
                list(fc.staged_repair),
                on_canvas=env.emit_canvas,
                expected_revision=fc.last_snapshot_hash,
                failed_run_id=env.repo.get_run(fc.verify_run_id).dify_run_id if fc.verify_run_id else "",
                **dict[str, Any](
                    {"confirmed_resource_ids": list(fc.resource_selection["resource_ids"])}
                    if any(item.startswith("agent:") for item in fc.resource_selection.get("resource_ids", []))
                    else {}
                ),
            )
        except DraftWouldNotStartError as exc:
            # The fix applied, but apply_repair's preflight found the result
            # would fail at Graph.init, so nothing was written. Not a stale
            # fix: say so, then the same no-safe-fix surface as below.
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
            return StepResult(next=PcState.BUILD_AWAIT_REPAIR, context=fc, items=items)
        except ValueError as exc:
            # The repair was validated against the graph as it stood at
            # propose time; apply_repair re-validates against the draft as it
            # is NOW, so a node deleted or a path removed in between makes an
            # intent stale. A bad intent must not kill the session (ESQ1-271)
            # -- degrade to the no-safe-fix surface and let the user decide.
            logger.warning("Dify Builder: staged repair no longer applies for app %s: %s", s.app_id, exc)
            items = drop_unapplied_repair(
                env,
                s,
                fc,
                progress,
                title=copy_text(BuilderCopyId.LABELS_COULDN_T_APPLY_THE_FIX),
                body=copy_text(BuilderCopyId.REPAIR_STALE_PROPOSAL, value=str(exc)),
            )
            return StepResult(next=PcState.BUILD_AWAIT_REPAIR, context=fc, items=items)
        fc.last_snapshot_hash = result.new_hash
        fc.last_structure_fingerprint = result.structure_fingerprint
        fc.staged_repair = []
        changes, scope, fc.change_set = build_change_set(result, default_scope="configuration", fallback_diff="repair")
        progress.activate("build-prepare-retest")
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
            text_parts(
                copy_text(
                    BuilderCopyId.REPAIR_APPLIED, count=len(changes), scope=change_scope_label(scope, fc.reply_language)
                ),
                "\n",
                change_lines,
            ),
            execution=execution,
            turn_id=progress.operation_id,
        )
        return StepResult(next=PcState.BUILD_EXECUTION, context=fc, items=[*decision_items, *turn_items])
    if kind == "keep_draft":
        # Reuse the final draft decision: preserving a failed draft must not
        # require a second identically named confirmation at review.
        return handle_review(env, turn, s, fc)
    if kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_REQUESTED_A_REVERT)))
        return StepResult(next=PcState.BUILD_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.BUILD_AWAIT_REPAIR, context=fc)


def handle_review(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Terminal decision. publish_workflow -> build.publish;
    keep_draft -> build.complete (skips publish); continue_adjusting
    (resolved to re_fix) -> build.initial_plan (re-plan); revert (undo) ->
    build.reverted: restores the pre-build draft from the checkpoint and
    invalidates the approvals made since it (via perform_revert). An empty
    replacement plan leaves the review state and prior test/repair context intact."""
    kind = action_kind(turn)
    if kind == "run_test":
        fc.verify_run_id = ""
        return handle_execution(env, turn, s, fc)
    if kind == "publish_workflow":
        decision = publication_for_context(env, turn, s, fc)
        if not decision.allowed:
            return publication_denied(env, s, fc, PcState.BUILD_REVIEW, decision.reason)
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_CHOSE_TO_PUBLISH)))
        return StepResult(next=PcState.BUILD_PUBLISH, context=fc, items=items)
    if kind == "keep_draft":
        decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_KEPT_THE_DRAFT)))
        turn_items = append_assistant(
            env,
            s,
            fc,
            copy_text(BuilderCopyId.BUILD_COMPLETED_DRAFT, count=len(fc.built_node_ids)),
        )
        return StepResult(next=PcState.BUILD_COMPLETE, context=fc, items=[*decision_items, *turn_items])
    if kind == "re_fix":  # continue_adjusting
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            reply_language=fc.reply_language,
            stage_id=str(s.current_state),
            steps=[("build-revise-plan", copy_text(BuilderCopyId.PROGRESS_REVISE_THE_WORKFLOW_PLAN))],
        )
        progress.activate("build-revise-plan")
        # Draft the plan, but do NOT show it yet: build.initial_plan (next)
        # runs resource discovery unconditionally and falls straight through
        # to build.resource_recommendation, which shows the ONE plan card for
        # this pass (v1, resources bound) -- exactly the duplicate-card
        # removal task 2 already did for the straight-through path. Showing
        # it here too would mean two "Build plan" v1 cards in one pass.
        plan = env.agent.propose_plan_v1(fc.requirements, goal_text=fc.goal_text)
        if not plan:
            return _planning_failed(env, s, fc, progress, "build-revise-plan", PcState.BUILD_REVIEW)
        store_plan(fc, plan)
        fc.test_input_ref = ""
        fc.verify_run_id = ""
        fc.repair_attempts = 0
        fc.last_repair_error = ""
        fc.unknown_outcome_count = 0
        decision_items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.ACTIONS_CONTINUE_ADJUSTING)))
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            copy_text(BuilderCopyId.LABELS_REVISED_PLAN),
            execution=execution,
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.BUILD_INITIAL_PLAN,
            context=fc,
            items=[*decision_items, *turn_items],
        )
    if kind == "undo":  # revert
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_REQUESTED_A_REVERT)))
        return StepResult(next=PcState.BUILD_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.BUILD_REVIEW, context=fc)


def handle_publish(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Publish the built workflow and complete the flow."""
    decision = publication_for_context(env, turn, s, fc)
    if not decision.allowed:
        return publication_denied(env, s, fc, PcState.BUILD_REVIEW, decision.reason)
    verified_run = env.repo.get_run(fc.verify_run_id)
    evidence = verified_run.verification
    assert evidence is not None
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[("build-publish-workflow", copy_text(BuilderCopyId.PROGRESS_PUBLISH_THE_NEW_WORKFLOW))],
    )
    progress.activate("build-publish-workflow")
    try:
        published = env.dify.publish(
            s.app_id,
            turn.actor,
            expected_revision=evidence.execution_revision,
            expected_graph_revision=evidence.executed_graph_revision,
        )
    except HashMismatchError:
        progress.fail_step("build-publish-workflow")
        progress.finish()
        return publication_denied(env, s, fc, PcState.BUILD_REVIEW, "stale_revision")
    emit_canvas(env, "publish_workflow")
    execution = progress.finish()
    items = append_assistant(
        env,
        s,
        fc,
        copy_text(BuilderCopyId.PUBLISH_BUILD_COMPLETE, version=published.version_name, status=published.status),
        execution=execution,
        turn_id=progress.operation_id,
    )
    return StepResult(next=PcState.BUILD_COMPLETE, context=fc, items=items)


def handle_reverted(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) After a revert. ``retry_after_revert`` (resolved to re_fix)
    re-proposes plan v1 and returns to build.initial_plan only with a usable
    replacement; otherwise retain this waiting state and prior context."""
    kind = action_kind(turn)
    if kind != "re_fix":
        return StepResult(next=PcState.BUILD_REVERTED, context=fc)
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[("build-restart-plan", copy_text(BuilderCopyId.PROGRESS_REBUILD_THE_WORKFLOW_PLAN))],
    )
    progress.activate("build-restart-plan")
    # Draft the plan, but do NOT show it yet -- same duplicate-card removal
    # as handle_review's re_fix branch: build.initial_plan (next) falls
    # straight through to build.resource_recommendation, which shows the ONE
    # plan card for this pass (v1, resources bound).
    plan = env.agent.propose_plan_v1(fc.requirements, goal_text=fc.goal_text)
    if not plan:
        return _planning_failed(env, s, fc, progress, "build-restart-plan", PcState.BUILD_REVERTED)
    store_plan(fc, plan)
    fc.test_input_ref = ""
    fc.verify_run_id = ""
    fc.repair_attempts = 0
    fc.last_repair_error = ""
    fc.unknown_outcome_count = 0
    execution = progress.finish()
    turn_items = append_assistant(
        env,
        s,
        fc,
        copy_text(BuilderCopyId.LABELS_RESTARTING_THE_PLAN),
        execution=execution,
        turn_id=progress.operation_id,
    )
    return StepResult(next=PcState.BUILD_INITIAL_PLAN, context=fc, items=list(turn_items))


def build_registry() -> dict[PcState, Handler]:
    """The Build handler table. Grows across Slice 2 tasks; ``build.complete``
    is terminal and intentionally absent (the loop returns before lookup)."""
    return {
        PcState.BUILD_CAPABILITY_CHECK: handle_capability_check,
        PcState.BUILD_GOAL_ANALYSIS: handle_goal_analysis,
        PcState.BUILD_INITIAL_PLAN: handle_initial_plan,
        PcState.BUILD_RESOURCE_RECOMMENDATION: handle_resource_recommendation,
        PcState.BUILD_PLAN_APPROVAL: handle_plan_approval,
        PcState.BUILD_EXECUTION: handle_execution,
        PcState.BUILD_AWAIT_TESTDATA: handle_await_testdata,
        PcState.BUILD_TEST_AND_REPAIR: handle_test_and_repair,
        PcState.BUILD_AWAIT_REPAIR: handle_await_repair,
        PcState.BUILD_REVIEW: handle_review,
        PcState.BUILD_PUBLISH: handle_publish,
        PcState.BUILD_REVERTED: handle_reverted,
    }
