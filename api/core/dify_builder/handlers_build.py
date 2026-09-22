"""Build-flow handlers: pure ``(env, turn, session, fc) -> StepResult`` steps.

Mirrors ``handlers_fix.py`` for the Build entry mode (spec: docs/superpowers/
specs/2026-08-22-dify-builder-slice2-build-design.md). Cards for a state
are emitted by the handler transitioning INTO it; working states auto-advance;
the build itself rides on ``handle_plan_approval`` (approve_plan) because
``build.execution`` is a waiting state. ``build.complete`` is terminal and has
no handler -- its completion summary is emitted by the governance-tail handlers
(``handle_governance_feedback`` for automatic/disabled policies, or
``handle_await_learning`` for the ask policy).
"""

import json
import logging
import uuid

from core.dify_builder.changes import describe_changed_nodes, describe_proposed_nodes
from core.dify_builder.contract import (
    AssistantTurnItem,
    BuildLearningCard,
    ChallengeCard,
    ChangeSetCard,
    CheckpointCard,
    DecisionItem,
    ErrorCard,
    ExecutionProgress,
    FormCard,
    NoticeItem,
    PlanCard,
    PublishCard,
    ResourceSelectCard,
    SummaryCard,
    SummaryRow,
    TestResultCard,
    TestStat,
)
from core.dify_builder.errors import DraftWouldNotStartError
from core.dify_builder.handlers_fix import (
    MAX_REPEATED_REPAIRS,
    NO_OUTPUT_BODY,
    NO_OUTPUT_REPLY,
    UNKNOWN_OUTCOME_STUCK_BODY,
    UNKNOWN_OUTCOME_STUCK_REPLY,
    UNKNOWN_TEST_OUTCOME_NOTICE,
    action_kind,
    action_string,
    append_card,
    build_change_set,
    build_form_fields,
    dead_end_branch_node_id,
    drop_unapplied_repair,
    emit_canvas,
    failure_signature,
    first_failed_node,
    is_input_failure,
    launch_error_text,
    merge_known_keys,
    mint_checkpoint,
    model_config_error_text,
    note_repair_error,
    note_unknown_outcome,
    perform_revert,
    repair_is_repeating,
    run_finished_without_output,
    start_schema,
    testdata_form_fields,
    without_endpoint_values,
    without_upload_values,
)
from core.dify_builder.models import (
    ConversationItem,
    Diagnosis,
    DifyBuilderContext,
    MutationIntent,
    NodeEvent,
    NodeOutput,
    Risk,
    Run,
    Session,
    TestInput,
    Turn,
)
from core.dify_builder.progress import ProgressReporter
from core.dify_builder.runner import Env, Handler, StepResult
from core.dify_builder.state import PcState

logger = logging.getLogger(__name__)

__all__ = [
    "build_registry",
    "handle_await_learning",
    "handle_await_repair",
    "handle_await_testdata",
    "handle_capability_check",
    "handle_execution",
    "handle_goal_analysis",
    "handle_governance_feedback",
    "handle_initial_plan",
    "handle_plan_approval",
    "handle_publish",
    "handle_resource_recommendation",
    "handle_reverted",
    "handle_review",
    "handle_test_and_repair",
]


def _emit_completion(fc: DifyBuilderContext) -> list[ConversationItem]:
    """Shared build-complete summary, emitted on every governance-tail exit."""
    rows = [
        SummaryRow(label="Workflow", value="Start -> Knowledge -> LLM -> End"),
        SummaryRow(label="Nodes", value=str(len(fc.built_node_ids))),
        SummaryRow(label="Status", value="Complete"),
    ]
    return append_card(fc, SummaryCard(variant="completion", title="Build complete", rows=rows))


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
    """(waiting) Entry state. Gates on the GOAL, not the action: a session
    whose composer already carried the goal in (fc.goal_text set at creation)
    needs no send_goal action and proceeds immediately. Only a goal-less
    session (create-from-blank) still waits for someone to supply one via
    send_goal. Either way: reset the canvas, analyze the goal into
    requirements, and transition to build.goal_analysis emitting its form +
    challenge cards."""
    kind = action_kind(turn)
    text, ok = action_string(turn, "text")
    if ok and text:
        fc.goal_text = text
    # The composer already carried the goal in; only a goal-less session
    # (create-from-blank) still needs someone to supply one.
    if not fc.goal_text and kind != "send_goal":
        return StepResult(next=PcState.BUILD_CAPABILITY_CHECK, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("build-understand-goal", "Understand the requested workflow"),
            ("build-prepare-requirements", "Prepare requirement fields"),
        ],
    )
    progress.activate("build-understand-goal")
    emit_canvas(env, "reset_build_canvas")
    analysis = env.agent.analyze_goal(fc.goal_text)
    fc.form_fields = list(analysis.get("fields") or [])
    fc.requirements = dict(analysis.get("values") or {})
    _refine_app_name(env, fc)

    progress.activate("build-prepare-requirements")
    form_items = append_card(
        fc,
        FormCard(
            variant="build_requirements",
            fields=build_form_fields(fc.form_fields),
            values=dict(fc.requirements),
            frozen=False,
        ),
    )
    challenge_items = append_card(
        fc,
        ChallengeCard(
            title="Proceeding with sensible defaults",
            body="I filled in typical requirements; edit and submit to adjust.",
            tone="warning",
        ),
    )
    execution = progress.finish()
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=progress.operation_id,
            stage_id=str(s.current_state),
            execution=execution,
            reply_text="Let's clarify the requirements.",
            cards=["form", "challenge"],
        ),
    )
    return StepResult(
        next=PcState.BUILD_GOAL_ANALYSIS,
        context=fc,
        items=[*form_items, *challenge_items, *turn_items],
    )


def handle_goal_analysis(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) On ``submit_requirements`` merge the form payload, propose
    plan v1, and go straight to resource discovery (build.resource_recommendation)
    via the shared ``_discover_and_offer_resources`` helper. The decision-free
    find_resources gate that used to sit at build.initial_plan (showing the
    same plan a second time) is gone; that state is now reached only via the
    continue_adjusting/retry_after_revert loop-back (handle_initial_plan)."""
    kind = action_kind(turn)
    if kind != "submit_requirements":
        return StepResult(next=PcState.BUILD_GOAL_ANALYSIS, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("build-review-requirements", "Review confirmed requirements"),
            ("build-draft-plan", "Draft the workflow plan"),
        ],
    )
    progress.activate("build-review-requirements")
    if turn.action is not None and isinstance(turn.action.payload, dict):
        keys = [f["key"] for f in fc.form_fields if isinstance(f, dict) and f.get("key")]
        fc.requirements = merge_known_keys(fc.requirements, turn.action.payload, keys)

    progress.activate("build-draft-plan")
    fc.plan_items = env.agent.propose_plan_v1(fc.requirements)
    fc.plan_version_tag = "v1"

    decision_items = append_card(fc, DecisionItem(text="Submitted requirements"))
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
        ("build-discover-resources", "Find compatible resources"),
        ("build-prepare-resource-options", "Prepare resource recommendations"),
    ]
    if progress is None:
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            stage_id=str(s.current_state),
            steps=steps,
        )
    else:
        progress.add_steps(steps)
    progress.activate("build-discover-resources")
    options = env.agent.discover_resources(list(fc.plan_items))
    progress.activate("build-prepare-resource-options")
    rs_items = append_card(
        fc,
        ResourceSelectCard(
            recommended=options,
        ),
    )
    if not options:
        # An empty card on its own reads as a failure. Say why: nothing here
        # matched, the build continues, and resources can still be added on the
        # canvas. The card is still emitted so the confirm gate keeps its active
        # interaction and a later pass cannot inherit a stale one.
        rs_items += append_card(
            fc,
            NoticeItem(text="No workspace resources matched this plan — continuing without any."),
        )
    gap = env.agent.assess_capability_gap(list(fc.plan_items), options)
    if gap:
        # Distinct from the empty-resources notice above: this fires even when
        # SOME resources matched but one plan step still has nothing that can
        # perform it (including a tool that's installed but unauthorized --
        # readiness "missing_config" doesn't cover a step either). The two
        # notices are independent and can both appear.
        rs_items += append_card(fc, NoticeItem(text=gap))
    execution = progress.finish()
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=progress.operation_id,
            stage_id=str(s.current_state),
            execution=execution,
            reply_text="Recommended resources.",
            cards=["resource_select"],
        ),
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
    snapshot the pre-build graph as the restore checkpoint (self-minted id so
    the CheckpointCard shown at plan_approval carries a real id -- mirrors
    handle_verify's self-minted run id). Transition to build.plan_approval."""
    kind = action_kind(turn)
    if kind != "confirm_resources":
        return StepResult(next=PcState.BUILD_RESOURCE_RECOMMENDATION, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("build-bind-resources", "Bind selected resources to the plan"),
            ("build-create-checkpoint", "Create a pre-build checkpoint"),
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
    fc.plan_version_tag = "v1"

    progress.activate("build-create-checkpoint")
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    checkpoint_id = mint_checkpoint(env, s, fc, graph, graph_hash, PcState.BUILD_PLAN_APPROVAL)

    decision_items = append_card(fc, DecisionItem(text="Confirmed resources"))
    plan_items = append_card(fc, PlanCard(title="Build plan", version_tag="v1", items=list(fc.plan_items)))
    checkpoint_items = append_card(
        fc, CheckpointCard(checkpoint_id=checkpoint_id, label="Pre-build checkpoint", created_at="")
    )
    execution = progress.finish()
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=progress.operation_id,
            stage_id=str(s.current_state),
            execution=execution,
            reply_text="Plan v1 ready for approval.",
            cards=["plan", "checkpoint"],
        ),
    )
    return StepResult(
        next=PcState.BUILD_PLAN_APPROVAL,
        context=fc,
        items=[*decision_items, *plan_items, *checkpoint_items, *turn_items],
    )


def _graph_not_applied(
    env: Env,
    s: Session,
    fc: DifyBuilderContext,
    progress: ProgressReporter,
    *,
    title: str,
    body: str,
    reply_text: str,
) -> StepResult:
    """apply_repair refused the generated graph and wrote nothing: say why and
    keep the plan approvable (re-approving regenerates the graph).

    apply_repair streams a canvas marker per applied intent BEFORE it raises
    (on_canvas=env.emit_canvas), so the client has already seen add_*/apply_*
    markers for mutations that were never written. The draft is still the
    checkpoint taken at plan approval (create_checkpoint), so tell the client
    to revert to it, same signal perform_revert uses."""
    emit_canvas(env, "revert_checkpoint")
    progress.fail_step("build-apply-graph")
    execution = progress.finish(status="error")
    error_items = append_card(fc, ErrorCard(title=title, body=body, tone="danger"))
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=progress.operation_id,
            stage_id=str(s.current_state),
            execution=execution,
            reply_text=reply_text,
            cards=["error"],
        ),
    )
    return StepResult(next=PcState.BUILD_PLAN_APPROVAL, context=fc, items=[*error_items, *turn_items])


def handle_plan_approval(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) THE BUILD. Only ``approve_repair`` (resolved from approve_plan)
    builds: drive apply_repair once with all create_node/connect intents
    (node-by-node canvas reveal via env.emit_canvas), emit the change_set +
    plan v1.x + assistant_turn(with execution activities), transition to build.execution.

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

    From-scratch delete-placeholder branch: when the draft has no non-start
    nodes yet (nothing has been built), any start node(s) already on the
    draft (e.g. the canvas's default placeholder start) are deleted before
    the generator's intents are applied, so the generator's own start node
    is the only one left. (Final-review fix, Minor #2): ids about to be
    deleted are excluded from the already-present comparison, so a generator
    create_node/connect that happens to reuse a just-deleted placeholder id
    still gets applied instead of being silently dropped."""
    kind = action_kind(turn)
    if kind != "approve_repair":
        return StepResult(next=PcState.BUILD_PLAN_APPROVAL, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("build-generate-graph", "Generate the workflow graph"),
            ("build-validate-graph", "Validate changes against the current canvas"),
            ("build-apply-graph", "Apply the workflow to the canvas"),
        ],
    )
    progress.activate("build-generate-graph")
    emit_canvas(env, "create_checkpoint")
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
            f"I couldn't generate a valid workflow graph: {build_result.error} "
            "Adjust the goal or the plan and approve again to retry."
            if build_result.error
            else (
                "I couldn't generate a valid workflow graph from this plan. "
                "Adjust the goal or the plan and approve again to retry."
            )
        )
        error_items = append_card(
            fc,
            ErrorCard(title="Couldn't build the workflow", body=body, diagnostics=build_result.diagnostics),
        )
        progress.fail_step("build-generate-graph")
        execution = progress.finish(status="error")
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=progress.operation_id,
                stage_id=str(s.current_state),
                execution=execution,
                reply_text=(
                    "I couldn't build a valid workflow graph -- see the error above. Adjust the plan and approve again."
                ),
                cards=["error"],
            ),
        )
        return StepResult(
            next=PcState.BUILD_PLAN_APPROVAL,
            context=fc,
            items=[*error_items, *turn_items],
        )

    progress.activate("build-validate-graph")
    current_graph, _current_hash = env.dify.read_graph(s.app_id, turn.actor)
    current_nodes = current_graph.get("nodes", [])
    existing_node_ids = {n.get("id") for n in current_nodes}
    existing_edges = {(e.get("source"), e.get("target")) for e in current_graph.get("edges", [])}

    existing_non_start = [n for n in current_nodes if (n.get("data") or {}).get("type") != "start"]
    delete_intents: list[MutationIntent] = []
    if not existing_non_start:  # from-scratch build: drop the draft's placeholder start(s)
        delete_intents = [
            MutationIntent(op="delete_node", args={"node_id": n["id"]})
            for n in current_nodes
            if (n.get("data") or {}).get("type") == "start" and n.get("id")
        ]

    # M2 fix (final review, Minor/latent): ids about to be deleted must NOT
    # count as "already present" for the create/connect filter below -- else
    # a generator create_node/connect that reuses a just-deleted placeholder
    # id (e.g. both named "start") is dropped, and the node vanishes (delete
    # with no re-create). Only affects the from-scratch branch: on loop-back
    # delete_intents is empty, so these sets are identical to the originals
    # and behavior there is unchanged.
    deleted_node_ids = {intent.args["node_id"] for intent in delete_intents}
    creatable_existing_node_ids = existing_node_ids - deleted_node_ids
    creatable_existing_edges = {
        (src, dst) for (src, dst) in existing_edges if src not in deleted_node_ids and dst not in deleted_node_ids
    }

    def _already_present(intent) -> bool:
        if intent.op == "create_node":
            return intent.args.get("node_id") in creatable_existing_node_ids
        if intent.op == "connect":
            return (intent.args.get("from_node"), intent.args.get("to_node")) in creatable_existing_edges
        return False

    to_apply = delete_intents + [intent for intent in intents if not _already_present(intent)]

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
        error_items = append_card(
            fc,
            ErrorCard(
                title="Nothing was applied to the canvas",
                body=(
                    "This app's canvas already contains nodes with the same ids as the ones this "
                    "plan would create, so applying it would have changed nothing and I've stopped "
                    "rather than report a build that did not happen. Clear the canvas (or start "
                    "from a new app) and approve again."
                ),
            ),
        )
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=progress.operation_id,
                stage_id=str(s.current_state),
                execution=execution,
                reply_text=(
                    "I didn't apply anything: the canvas already has nodes with these ids. "
                    "Clear it or start from a new app, then approve again."
                ),
                cards=["error"],
            ),
        )
        return StepResult(
            next=PcState.BUILD_PLAN_APPROVAL,
            context=fc,
            items=[*error_items, *turn_items],
        )

    progress.activate("build-apply-graph")
    try:
        result = env.dify.apply_repair(
            s.app_id, turn.actor, to_apply, on_canvas=env.emit_canvas, expected_revision=fc.last_snapshot_hash
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
            title="The workflow can't start",
            body=f"The generated workflow would fail before its first node: {exc}",
            reply_text=(
                "I didn't apply the workflow: it would fail before its first node. Adjust the plan and approve again."
            ),
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
            title="Couldn't apply the workflow",
            body=f"The generated workflow couldn't be applied to the draft: {exc}",
            reply_text="I couldn't apply the workflow -- see the error above. Adjust the plan and approve again.",
        )
    fc.last_snapshot_hash = result.new_hash
    fc.last_structure_fingerprint = result.structure_fingerprint
    fc.built_node_ids = [
        intent.args["node_id"]
        for intent in intents
        if intent.op == "create_node" and isinstance(intent.args.get("node_id"), str)
    ]
    changes, scope, fc.change_set = build_change_set(result, default_scope="structure", fallback_diff="graph built")

    change_set_items = append_card(
        fc,
        ChangeSetCard(
            count=len(changes),
            changes=changes,
            scope=scope,
            nodes=result.nodes or describe_changed_nodes(result.changed_nodes),
        ),
    )
    # Spec N4: the app is named once here, in the card headline, and nowhere
    # else in the build output -- the completion receipt never repeats it.
    plan_items = append_card(
        fc,
        PlanCard(
            title=f"{fc.app_name} is ready" if fc.app_name else "Build plan",
            version_tag="v1.1",
            items=list(fc.plan_items),
        ),
    )
    decision_items = append_card(fc, DecisionItem(text="Approved the plan"))
    execution = progress.finish()
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=progress.operation_id,
            stage_id=str(s.current_state),
            execution=execution,
            reply_text="Workflow built on the canvas.",
            cards=["change_set", "plan"],
        ),
    )
    return StepResult(
        next=PcState.BUILD_EXECUTION,
        context=fc,
        items=[*change_set_items, *plan_items, *decision_items, *turn_items],
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
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.BUILD_REVERTED, context=fc, items=items)
    if kind == "run_test":
        if fc.test_input_ref == "":
            graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
            schema = start_schema(graph)
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
            form_items = append_card(
                fc,
                FormCard(
                    variant="testdata",
                    fields=testdata_form_fields(schema),
                    values=prefill,
                    frozen=False,
                ),
            )
            turn_items = append_card(
                fc,
                AssistantTurnItem(
                    turn_id=str(uuid.uuid4()),
                    stage_id=str(s.current_state),
                    execution=ExecutionProgress(status="completed"),
                    reply_text="I filled in test inputs -- edit them if you like, then run the test.",
                    cards=["form"],
                ),
            )
            return StepResult(next=PcState.BUILD_AWAIT_TESTDATA, context=fc, items=[*form_items, *turn_items])
        emit_canvas(env, "start_test_run")
        items = append_card(fc, DecisionItem(text="Run tests"))
        return StepResult(next=PcState.BUILD_TEST_AND_REPAIR, context=fc, items=items)
    return StepResult(next=PcState.BUILD_EXECUTION, context=fc)


def handle_await_testdata(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Prepare inputs for the live test run. mock -> schema-shaped
    generate_mock_inputs; provide/upload -> the payload's inputs dict (may carry
    file refs). Persists a TestInput and advances to build.test_and_repair."""
    mode, _ = action_string(turn, "mode")
    if mode == "mock":
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            stage_id=str(s.current_state),
            steps=[("build-generate-test-inputs", "Generate test inputs")],
        )
        progress.activate("build-generate-test-inputs")
        graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
        # An endpoint is left out, never mocked: its missing required key fails
        # the launch as an input, which routes back to this gate.
        inputs = without_endpoint_values(graph, env.agent.generate_mock_inputs(start_schema(graph), {}))
        progress.finish()
    else:
        inputs = {}
        if turn.action is not None and isinstance(turn.action.payload.get("inputs"), dict):
            inputs = turn.action.payload["inputs"]
    ti = TestInput(session_id=s.id, source=mode or "upload", inputs=inputs)
    env.repo.save_test_input(ti)
    fc.test_input_ref = ti.id
    return StepResult(next=PcState.BUILD_TEST_AND_REPAIR, context=fc)


# Node outputs are only truncated upstream at ~100,000 chars per string, so a
# report-generating workflow (the Builder's showcase case) can otherwise push
# hundreds of KB of JSON into the conversation-item row, the SSE frame, and
# the localizer walk on every successful build. The card is a preview, not a
# download -- this cap keeps it one.
_MAX_TERMINAL_OUTPUT_CHARS = 2000
_TERMINAL_OUTPUT_TRUNCATED_MARKER = "\n… (truncated)"


def _terminal_output(per_node: list[NodeOutput]) -> str:
    """The last node that produced anything, as readable JSON, or "".

    Deliberately status-agnostic: node status spellings differ by source
    ("success" vs "succeeded"), and a status filter that silently misses is
    worse than showing the output of a run that ended badly -- showing what
    ran is the point of the card. Capped at ``_MAX_TERMINAL_OUTPUT_CHARS``
    (see its comment) -- a big JSON blob is capped with a visible marker
    rather than silently dropped.
    """
    for node in reversed(per_node):
        if node.outputs:
            rendered = json.dumps(node.outputs, ensure_ascii=False, indent=2)
            if len(rendered) > _MAX_TERMINAL_OUTPUT_CHARS:
                return rendered[:_MAX_TERMINAL_OUTPUT_CHARS] + _TERMINAL_OUTPUT_TRUNCATED_MARKER
            return rendered
    return ""


def handle_test_and_repair(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Live test: run the built draft with mock inputs. Success
    -> build.review. Failure -> real diagnose + propose_repair, staged for the
    build.await_repair approval gate. No auto-apply (human-gated)."""
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("build-prepare-test", "Prepare the workflow test"),
            ("build-run-test", "Run the workflow"),
            ("build-evaluate-test", "Evaluate the test result"),
        ],
    )
    progress.activate("build-prepare-test")
    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)

    if fc.test_input_ref:
        inputs = env.repo.get_test_input(fc.test_input_ref).inputs
    else:  # defensive: the gate normally prepares inputs first
        inputs = without_endpoint_values(graph, env.agent.generate_mock_inputs(start_schema(graph), {}))
        ti = TestInput(session_id=s.id, source="mock", inputs=inputs)
        env.repo.save_test_input(ti)
        fc.test_input_ref = ti.id

    progress.activate("build-run-test")

    def emit(event: NodeEvent) -> None:
        progress.observe_node("build-run-test", event)

    try:
        raw = env.dify.run_draft(s.app_id, turn.actor, inputs, emit, on_workflow_event=env.emit_workflow)
        status, per_node, dify_run_id, run_error = raw.status, raw.per_node, raw.dify_run_id, raw.error
    except Exception as exc:
        # Never crash the advance; capture the launch error (log + store) instead
        # of swallowing it, so diagnose/routing have something to act on.
        logger.exception("dify_builder verify run failed to launch (session=%s, app=%s)", s.id, s.app_id)
        status, per_node, dify_run_id, run_error = "failed", [], "", launch_error_text(exc)

    if status == "succeeded":
        progress.complete("build-run-test")
    else:
        progress.fail_step("build-run-test")
    progress.activate("build-evaluate-test")

    run = Run(
        id=str(uuid.uuid4()),
        kind="verify",
        dify_run_id=dify_run_id,
        status=status,
        per_node=per_node,
        error=run_error,
        inputs_ref=fc.test_input_ref,
        immutable=True,
    )

    if status != "running":
        fc.unknown_outcome_count = 0

    if status == "succeeded" and run_finished_without_output(graph, per_node):
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
        emit_canvas(env, "mark_test_error", dify_run_id=run.dify_run_id)
        test_items = append_card(
            fc,
            TestResultCard(
                title="Test run",
                subtitle="Finished without output",
                tone="error",
                stats=[TestStat(value="1", label="runs"), TestStat(value="0", label="errors")],
                run_ids=[run.id],
                dify_run_id=run.dify_run_id,
            ),
        )
        error_items = append_card(
            fc, ErrorCard(title="No output produced", body=NO_OUTPUT_BODY, tone="danger", node_id=run.culprit_node_id)
        )
        execution = progress.finish()
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=progress.operation_id,
                stage_id=str(s.current_state),
                execution=execution,
                reply_text=NO_OUTPUT_REPLY,
                cards=["test_result", "error"],
            ),
        )
        return StepResult(
            next=PcState.BUILD_AWAIT_REPAIR,
            context=fc,
            items=[*test_items, *error_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    if status == "succeeded":
        emit_canvas(env, "mark_test_success", dify_run_id=run.dify_run_id)
        test_items = append_card(
            fc,
            TestResultCard(
                title="Test run",
                subtitle="All checks passed",
                tone="success",
                stats=[TestStat(value="1", label="runs"), TestStat(value="0", label="errors")],
                run_ids=[run.id],
                dify_run_id=run.dify_run_id,
                output=_terminal_output(per_node),
            ),
        )
        emit_canvas(env, "mark_review_ready")
        summary_items = append_card(
            fc,
            SummaryCard(
                variant="review",
                title="Review",
                items=[f"Workflow built ({len(fc.built_node_ids)} nodes)", "Tests passing"],
            ),
        )
        execution = progress.finish()
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=progress.operation_id,
                stage_id=str(s.current_state),
                execution=execution,
                reply_text="Tests passed; ready for review.",
                cards=["test_result", "summary"],
            ),
        )
        return StepResult(
            next=PcState.BUILD_REVIEW,
            context=fc,
            items=[*test_items, *summary_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    if status == "running":
        # Stream truncated: the run's outcome is genuinely unknown, NOT a
        # failure (Run.status documents "running" for exactly this case).
        # Diagnosing/staging a repair here would edit the draft under a run
        # that may still be executing -- surface a neutral notice instead and
        # return to build.execution (re-runnable), without ever calling
        # diagnose or propose_repair. The second consecutive unknown outcome
        # stops the re-run loop at the gate (no staged repair) instead.
        if note_unknown_outcome(fc):
            fc.verify_run_id = run.id
            fc.diagnosis = None
            fc.staged_repair = []
            stuck_items = append_card(
                fc, ErrorCard(title="Test outcome unknown", body=UNKNOWN_OUTCOME_STUCK_BODY, tone="danger")
            )
            execution = progress.finish()
            turn_items = append_card(
                fc,
                AssistantTurnItem(
                    turn_id=progress.operation_id,
                    stage_id=str(s.current_state),
                    execution=execution,
                    reply_text=UNKNOWN_OUTCOME_STUCK_REPLY,
                    cards=["error"],
                ),
            )
            return StepResult(
                next=PcState.BUILD_AWAIT_REPAIR,
                context=fc,
                items=[*stuck_items, *turn_items],
                run=run,
                run_id_sink=[run.id],
            )
        notice_items = append_card(fc, NoticeItem(text=UNKNOWN_TEST_OUTCOME_NOTICE, tone="neutral"))
        execution = progress.finish()
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=progress.operation_id,
                stage_id=str(s.current_state),
                execution=execution,
                reply_text=UNKNOWN_TEST_OUTCOME_NOTICE,
                cards=["notice"],
            ),
        )
        return StepResult(
            next=PcState.BUILD_EXECUTION,
            context=fc,
            items=[*notice_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    # failure: real diagnosis + proposed repair, staged for the approval gate
    run.culprit_node_id = first_failed_node(per_node)
    fc.verify_run_id = run.id
    emit_canvas(env, "mark_test_error", dify_run_id=run.dify_run_id)

    if is_input_failure(run):
        # the run failed on its INPUT, not the config -- route back to the
        # testdata gate instead of the config-repair gate; clear the stale
        # input ref (and the verify_run_id we just set) so a fresh
        # provide_testdata cycle starts clean.
        fc.test_input_ref = ""
        fc.verify_run_id = ""
        test_items = append_card(
            fc,
            TestResultCard(
                title="Test run",
                subtitle="Failed",
                tone="error",
                stats=[TestStat(value="1", label="runs"), TestStat(value="1", label="errors")],
                run_ids=[run.id],
                dify_run_id=run.dify_run_id,
            ),
        )
        form_items = append_card(
            fc,
            FormCard(
                variant="testdata",
                fields=testdata_form_fields(start_schema(graph)),
                values={},
                frozen=False,
            ),
        )
        execution = progress.finish()
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=progress.operation_id,
                stage_id=str(s.current_state),
                execution=execution,
                reply_text="The run failed on its inputs — provide test data and retry.",
                cards=["test_result", "form"],
            ),
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
            "The workflow uses a model that isn't configured or available for this workspace, so "
            "it can't run. This is a model-configuration issue, not a workflow-logic problem -- "
            "configure the model (or choose a different one) and re-run the test. "
            f"Details: {model_error}"
        )
        fc.diagnosis = Diagnosis(culprit_node_id=first_failed_node(per_node), root_cause=root_cause, severity="high")
        fc.staged_repair = []
        fc.risk = Risk(level="high", reason="model not configured", has_external_side_effect=False)
        test_items = append_card(
            fc,
            TestResultCard(
                title="Test run",
                subtitle="Failed",
                tone="error",
                stats=[TestStat(value="1", label="runs"), TestStat(value="1", label="errors")],
                run_ids=[run.id],
                dify_run_id=run.dify_run_id,
            ),
        )
        error_items = append_card(
            fc,
            ErrorCard(
                title="Model not configured",
                body=root_cause,
                tone="danger",
                node_id=fc.diagnosis.culprit_node_id,
            ),
        )
        execution = progress.finish()
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=progress.operation_id,
                stage_id=str(s.current_state),
                execution=execution,
                reply_text=(
                    "The test failed because the workflow's model isn't configured. Configure it "
                    "(or change the model), then re-run — this isn't a workflow-logic issue."
                ),
                cards=["test_result", "error"],
            ),
        )
        return StepResult(
            next=PcState.BUILD_AWAIT_REPAIR,
            context=fc,
            items=[*test_items, *error_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    # config failure: existing diagnose + propose_repair -> BUILD_AWAIT_REPAIR
    progress.add_steps(
        [
            ("build-diagnose-failure", "Diagnose the failed workflow"),
            ("build-prepare-repair", "Prepare a safe repair"),
        ]
    )
    progress.activate("build-diagnose-failure")
    diagnosis = env.agent.diagnose(run, graph, per_node)
    _note_repair_error(fc, run)
    if _repair_is_repeating(fc):
        # The same failure has now survived _MAX_REPEATED_REPAIRS repairs, so
        # another round would aim at the same wrong thing. Stop spending runs
        # and hand the decision back (ESQ1-285 burned nine approvals this way,
        # ESQ1-290 six). Clearing staged_repair also engages the empty-repair
        # guard above, so "Apply the fix" cannot be approved into a no-op.
        fc.diagnosis = diagnosis
        fc.staged_repair = []
        progress.finish()
        stuck_items = append_card(
            fc,
            ErrorCard(
                title="Repeated failure",
                body=(
                    f"{diagnosis.root_cause or 'The run failed.'}\n\n"
                    "The same error survived the last repairs, so I've stopped retrying. "
                    "Edit the node directly and test again, or revert."
                ),
                tone="danger",
                node_id=diagnosis.culprit_node_id,
            ),
        )
        return StepResult(
            next=PcState.BUILD_AWAIT_REPAIR,
            context=fc,
            items=stuck_items,
            run=run,
            run_id_sink=[run.id],
        )
    progress.activate("build-prepare-repair")
    intents, risk = env.agent.propose_repair(diagnosis, graph)
    fc.diagnosis = diagnosis
    fc.staged_repair = list(intents)
    fc.risk = risk
    test_items = append_card(
        fc,
        TestResultCard(
            title="Test run",
            subtitle="Failed",
            tone="error",
            stats=[TestStat(value="1", label="runs"), TestStat(value="1", label="errors")],
            run_ids=[run.id],
            dify_run_id=run.dify_run_id,
        ),
    )
    error_items = append_card(
        fc,
        ErrorCard(
            title="Test failed",
            body=diagnosis.root_cause or "The run failed.",
            tone="danger",
            node_id=diagnosis.culprit_node_id,
        ),
    )
    proposed = [f"{i.op} {i.args.get('node_id', '')}".strip() for i in intents]
    cs_items = (
        append_card(
            fc,
            ChangeSetCard(
                count=len(intents),
                changes=proposed,
                scope="configuration",
                nodes=describe_proposed_nodes(intents, graph),
            ),
        )
        if intents
        else []
    )
    execution = progress.finish()
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=progress.operation_id,
            stage_id=str(s.current_state),
            execution=execution,
            reply_text=(
                "Test failed — here's a proposed fix to review."
                if intents
                else "Test failed — no safe automatic fix; edit or keep draft."
            ),
            cards=["test_result", "error"] + (["change_set"] if intents else []),
        ),
    )
    return StepResult(
        next=PcState.BUILD_AWAIT_REPAIR,
        context=fc,
        items=[*test_items, *error_items, *cs_items, *turn_items],
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
    keep_draft -> build.review; undo -> build.reverted. apply_repair runs ONLY
    here, only on approve."""
    kind = action_kind(turn)
    if kind == "approve_repair":
        if not fc.staged_repair:
            # Nothing staged: applying would change nothing and the retest
            # would fail identically. Don't spend a run on it (ESQ1-291).
            items = append_card(
                fc,
                NoticeItem(text="No fix is staged for this failure -- keep the draft or revert."),
            )
            return StepResult(next=PcState.BUILD_AWAIT_REPAIR, context=fc, items=items)
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            stage_id=str(s.current_state),
            steps=[
                ("build-apply-repair", "Apply the approved repair"),
                ("build-prepare-retest", "Prepare to retest the workflow"),
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
            )
        except DraftWouldNotStartError as exc:
            # The fix applied, but apply_repair's preflight found the result
            # would fail at Graph.init, so nothing was written. Not a stale
            # fix: say so, then the same no-safe-fix surface as below.
            logger.warning(
                "Dify Builder: staged repair would leave a draft that cannot start for app %s: %s", s.app_id, exc
            )
            items = drop_unapplied_repair(
                fc,
                progress,
                title="The workflow can't start",
                body=f"The proposed fix would leave a workflow that fails before its first node: {exc}",
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
                fc,
                progress,
                title="Couldn't apply the fix",
                body=f"The proposed fix no longer applies to the current draft: {exc}",
            )
            return StepResult(next=PcState.BUILD_AWAIT_REPAIR, context=fc, items=items)
        fc.last_snapshot_hash = result.new_hash
        fc.last_structure_fingerprint = result.structure_fingerprint
        fc.staged_repair = []
        changes, scope, fc.change_set = build_change_set(result, default_scope="configuration", fallback_diff="repair")
        cs_items = append_card(
            fc,
            ChangeSetCard(
                count=len(changes),
                changes=changes,
                scope=scope,
                nodes=result.nodes or describe_changed_nodes(result.changed_nodes),
            ),
        )
        progress.activate("build-prepare-retest")
        decision_items = append_card(fc, DecisionItem(text="Applied the fix; ready to retest"))
        progress.finish()
        return StepResult(next=PcState.BUILD_EXECUTION, context=fc, items=[*cs_items, *decision_items])
    if kind == "keep_draft":
        items = append_card(fc, DecisionItem(text="Kept the draft despite the failure"))
        return StepResult(next=PcState.BUILD_REVIEW, context=fc, items=items)
    if kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.BUILD_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.BUILD_AWAIT_REPAIR, context=fc)


def handle_review(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Terminal decision. publish_workflow -> build.publish;
    keep_draft -> build.governance_feedback (skips publish); continue_adjusting
    (resolved to re_fix) -> build.initial_plan (re-plan); revert (undo) ->
    build.reverted: restores the pre-build draft from the checkpoint and
    invalidates the approvals made since it (via perform_revert)."""
    kind = action_kind(turn)
    if kind == "publish_workflow":
        items = append_card(fc, DecisionItem(text="Chose to publish"))
        return StepResult(next=PcState.BUILD_PUBLISH, context=fc, items=items)
    if kind == "keep_draft":
        emit_canvas(env, "cancel_publish")
        items = append_card(fc, DecisionItem(text="Kept the draft"))
        return StepResult(next=PcState.BUILD_GOVERNANCE_FEEDBACK, context=fc, items=items)
    if kind == "re_fix":  # continue_adjusting
        emit_canvas(env, "cancel_publish")
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            stage_id=str(s.current_state),
            steps=[("build-revise-plan", "Revise the workflow plan")],
        )
        progress.activate("build-revise-plan")
        # Draft the plan, but do NOT show it yet: build.initial_plan (next)
        # runs resource discovery unconditionally and falls straight through
        # to build.resource_recommendation, which shows the ONE plan card for
        # this pass (v1, resources bound) -- exactly the duplicate-card
        # removal task 2 already did for the straight-through path. Showing
        # it here too would mean two "Build plan" v1 cards in one pass.
        fc.plan_items = env.agent.propose_plan_v1(fc.requirements)
        fc.plan_version_tag = "v1"
        fc.test_input_ref = ""
        fc.verify_run_id = ""
        fc.repair_attempts = 0
        fc.last_repair_error = ""
        fc.unknown_outcome_count = 0
        decision_items = append_card(fc, DecisionItem(text="Continue adjusting"))
        execution = progress.finish()
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=progress.operation_id,
                stage_id=str(s.current_state),
                execution=execution,
                reply_text="Revised plan.",
                cards=[],
            ),
        )
        return StepResult(
            next=PcState.BUILD_INITIAL_PLAN,
            context=fc,
            items=[*decision_items, *turn_items],
        )
    if kind == "undo":  # revert
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.BUILD_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.BUILD_REVIEW, context=fc)


def handle_publish(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Publish the built workflow, emit the PublishCard, and
    auto-advance to build.governance_feedback."""
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[("build-publish-workflow", "Publish the new workflow")],
    )
    progress.activate("build-publish-workflow")
    env.dify.publish(s.app_id, turn.actor)
    emit_canvas(env, "publish_workflow")
    items = append_card(fc, PublishCard(version="1.0", badge="live"))
    progress.finish()
    return StepResult(next=PcState.BUILD_GOVERNANCE_FEEDBACK, context=fc, items=items)


def handle_governance_feedback(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Governance tail: apply the skill-learning policy.
    automatic -> learn + accepted card; disabled -> skipped card; ask ->
    emit the pending prompt and rest at build.await_learning. Reached via both
    publish and keep_draft (scenario-neutral)."""
    policy = fc.skill_learning_policy or "ask"
    if policy == "automatic":
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            stage_id=str(s.current_state),
            steps=[("build-capture-learning", "Capture reusable build guidance")],
        )
        progress.activate("build-capture-learning")
        descriptor = env.agent.learn_from_build(
            fc.goal_text, dict(fc.requirements), list(fc.plan_items), list(fc.built_node_ids)
        )
        items = append_card(fc, BuildLearningCard(policy="automatic", state="accepted"))
        items += append_card(fc, NoticeItem(text=descriptor))
        items += _emit_completion(fc)
        progress.finish()
        return StepResult(next=PcState.BUILD_COMPLETE, context=fc, items=items)
    if policy == "disabled":
        items = append_card(fc, BuildLearningCard(policy="disabled", state="skipped"))
        items += _emit_completion(fc)
        return StepResult(next=PcState.BUILD_COMPLETE, context=fc, items=items)
    # ask (default): prompt, then rest for the user's accept/skip.
    items = append_card(fc, BuildLearningCard(policy="ask", state="pending"))
    return StepResult(next=PcState.BUILD_AWAIT_LEARNING, context=fc, items=items)


def handle_await_learning(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Resolve the ask-policy skill-learning prompt. accept_learning
    -> learn + accepted decision; anything else (skip_learning / absent) ->
    skipped. Either way emit the completion summary and reach build.complete."""
    kind = action_kind(turn)
    if kind == "accept_learning":
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            stage_id=str(s.current_state),
            steps=[("build-capture-learning", "Capture reusable build guidance")],
        )
        progress.activate("build-capture-learning")
        descriptor = env.agent.learn_from_build(
            fc.goal_text, dict(fc.requirements), list(fc.plan_items), list(fc.built_node_ids)
        )
        items = append_card(fc, DecisionItem(text="Accepted skill learning"))
        items += append_card(fc, NoticeItem(text=descriptor))
        progress.finish()
    else:
        items = append_card(fc, DecisionItem(text="Skipped skill learning"))
    items += _emit_completion(fc)
    return StepResult(next=PcState.BUILD_COMPLETE, context=fc, items=items)


def handle_reverted(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) After a revert. ``retry_after_revert`` (resolved to re_fix)
    re-proposes plan v1 and returns to build.initial_plan."""
    kind = action_kind(turn)
    if kind != "re_fix":
        return StepResult(next=PcState.BUILD_REVERTED, context=fc)
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[("build-restart-plan", "Rebuild the workflow plan")],
    )
    progress.activate("build-restart-plan")
    # Draft the plan, but do NOT show it yet -- same duplicate-card removal
    # as handle_review's re_fix branch: build.initial_plan (next) falls
    # straight through to build.resource_recommendation, which shows the ONE
    # plan card for this pass (v1, resources bound).
    fc.plan_items = env.agent.propose_plan_v1(fc.requirements)
    fc.plan_version_tag = "v1"
    fc.test_input_ref = ""
    fc.verify_run_id = ""
    fc.repair_attempts = 0
    fc.last_repair_error = ""
    fc.unknown_outcome_count = 0
    execution = progress.finish()
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=progress.operation_id,
            stage_id=str(s.current_state),
            execution=execution,
            reply_text="Restarting the plan.",
            cards=[],
        ),
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
        PcState.BUILD_GOVERNANCE_FEEDBACK: handle_governance_feedback,
        PcState.BUILD_AWAIT_LEARNING: handle_await_learning,
        PcState.BUILD_REVERTED: handle_reverted,
    }
