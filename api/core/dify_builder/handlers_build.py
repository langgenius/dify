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

import uuid

from core.dify_builder.contract import (
    AssistantTurnItem,
    BuildLearningCard,
    ChallengeCard,
    ChangeSetCard,
    CheckpointCard,
    ConflictPolicyOption,
    DecisionItem,
    ErrorCard,
    FormCard,
    FormField,
    NoticeItem,
    PlanCard,
    PublishCard,
    ResourceSelectCard,
    SummaryCard,
    SummaryRow,
    TestResultCard,
    TestStat,
    Trace,
    TraceStep,
)
from core.dify_builder.handlers_fix import (
    action_kind,
    action_string,
    append_card,
    build_change_set,
    emit_canvas,
    merge_known_keys,
    mint_checkpoint,
    perform_revert,
)
from core.dify_builder.models import (
    ConversationItem,
    DifyBuilderContext,
    Session,
    Turn,
)
from core.dify_builder.runner import Env, Handler, StepResult
from core.dify_builder.state import PcState

__all__ = [
    "build_registry",
    "handle_await_learning",
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


_REQUIREMENT_FIELDS = [
    FormField(key="report_types", label="Report types", type="text"),
    FormField(key="audience", label="Audience", type="text"),
    FormField(key="currency", label="Currency", type="text"),
    FormField(key="metrics", label="Metrics", type="text"),
    FormField(key="output", label="Output", type="textarea"),
    FormField(key="prefer_audited", label="Prefer audited sources", type="bool"),
]


def handle_capability_check(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Entry state. On ``send_goal`` reset the canvas, analyze the
    goal into requirements, and transition to build.goal_analysis emitting its
    form + challenge cards."""
    kind = action_kind(turn)
    if kind != "send_goal":
        return StepResult(next=PcState.BUILD_CAPABILITY_CHECK, context=fc)

    text, ok = action_string(turn, "text")
    if ok and text:
        fc.goal_text = text
    emit_canvas(env, "reset_build_canvas")
    fc.requirements = env.agent.analyze_goal(fc.goal_text)

    form_items = append_card(
        fc,
        FormCard(
            variant="build_requirements",
            fields=list(_REQUIREMENT_FIELDS),
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
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="build.goal_analysis",
            trace=Trace(status="completed", steps=[]),
            reply_text="Let's clarify the requirements.",
            cards=["form", "challenge"],
        ),
    )
    return StepResult(
        next=PcState.BUILD_GOAL_ANALYSIS,
        context=fc,
        items=[*form_items, *challenge_items, *turn_items],
    )


_REQUIREMENT_KEYS = ("report_types", "audience", "currency", "metrics", "output", "prefer_audited")


def handle_goal_analysis(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) On ``submit_requirements`` merge the form payload, propose
    plan v1, and transition to build.initial_plan emitting the plan card."""
    kind = action_kind(turn)
    if kind != "submit_requirements":
        return StepResult(next=PcState.BUILD_GOAL_ANALYSIS, context=fc)

    if turn.action is not None and isinstance(turn.action.payload, dict):
        fc.requirements = merge_known_keys(fc.requirements, turn.action.payload, _REQUIREMENT_KEYS)

    fc.plan_items = env.agent.propose_plan_v1(fc.requirements)
    fc.plan_version_tag = "v1"

    decision_items = append_card(fc, DecisionItem(text="Submitted requirements"))
    plan_items = append_card(
        fc,
        PlanCard(
            title="Build plan",
            version_tag="v1",
            items=list(fc.plan_items),
        ),
    )
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="build.initial_plan",
            trace=Trace(status="completed", steps=[]),
            reply_text="Here's the initial plan.",
            cards=["plan"],
        ),
    )
    return StepResult(
        next=PcState.BUILD_INITIAL_PLAN,
        context=fc,
        items=[*decision_items, *plan_items, *turn_items],
    )


def handle_initial_plan(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) On ``find_resources`` discover the (canned, ready) resource
    and transition to build.resource_recommendation."""
    kind = action_kind(turn)
    if kind != "find_resources":
        return StepResult(next=PcState.BUILD_INITIAL_PLAN, context=fc)

    options = env.agent.discover_resources(list(fc.plan_items))
    rs_items = append_card(
        fc,
        ResourceSelectCard(
            recommended=options,
            conflict_policy_options=[
                ConflictPolicyOption(id="audited", label="Prefer audited", recommended=True),
                ConflictPolicyOption(id="ask", label="Ask each time"),
            ],
        ),
    )
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="build.resource_recommendation",
            trace=Trace(status="completed", steps=[]),
            reply_text="Recommended resources.",
            cards=["resource_select"],
        ),
    )
    return StepResult(
        next=PcState.BUILD_RESOURCE_RECOMMENDATION,
        context=fc,
        items=[*rs_items, *turn_items],
    )


def handle_resource_recommendation(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) On ``confirm_resources`` bind resources into plan v2 and
    snapshot the pre-build graph as the restore checkpoint (self-minted id so
    the CheckpointCard shown at plan_approval carries a real id -- mirrors
    handle_verify's self-minted run id). Transition to build.plan_approval."""
    kind = action_kind(turn)
    if kind != "confirm_resources":
        return StepResult(next=PcState.BUILD_RESOURCE_RECOMMENDATION, context=fc)

    fc.checkpoint_seq = fc.next_seq

    resource_ids: list[str] = []
    conflict_policy = ""
    if turn.action is not None and isinstance(turn.action.payload, dict):
        raw_ids = turn.action.payload.get("resource_ids")
        if isinstance(raw_ids, list):
            resource_ids = [r for r in raw_ids if isinstance(r, str)]
        cp = turn.action.payload.get("conflict_policy")
        if isinstance(cp, str):
            conflict_policy = cp
    fc.resource_selection = {"resource_ids": resource_ids, "conflict_policy": conflict_policy}
    fc.plan_items = env.agent.bind_resources(list(fc.plan_items), resource_ids, conflict_policy)
    fc.plan_version_tag = "v2"

    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    checkpoint_id = mint_checkpoint(env, s, fc, graph, graph_hash, PcState.BUILD_PLAN_APPROVAL)

    decision_items = append_card(fc, DecisionItem(text="Confirmed resources"))
    plan_items = append_card(fc, PlanCard(title="Build plan", version_tag="v2", items=list(fc.plan_items)))
    checkpoint_items = append_card(
        fc, CheckpointCard(checkpoint_id=checkpoint_id, label="Pre-build checkpoint", created_at="")
    )
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="build.plan_approval",
            trace=Trace(status="completed", steps=[]),
            reply_text="Plan v2 ready for approval.",
            cards=["plan", "checkpoint"],
        ),
    )
    return StepResult(
        next=PcState.BUILD_PLAN_APPROVAL,
        context=fc,
        items=[*decision_items, *plan_items, *checkpoint_items, *turn_items],
    )


_BUILD_TRACE_STEPS = [
    TraceStep(id="build-start", label="Create Start node", state="done", tone="success", canvas_event="add_start_node"),
    TraceStep(
        id="build-knowledge",
        label="Create Knowledge Retrieval node",
        state="done",
        tone="success",
        canvas_event="add_knowledge_node",
    ),
    TraceStep(id="build-llm", label="Create LLM node", state="done", tone="success", canvas_event="add_llm_node"),
    TraceStep(id="build-end", label="Create End node", state="done", tone="success", canvas_event="add_output_node"),
]


def handle_plan_approval(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) THE BUILD. Only ``approve_repair`` (resolved from approve_plan)
    builds: drive apply_repair once with all create_node/connect intents
    (node-by-node canvas reveal via env.emit_canvas), emit the change_set +
    plan v2.x + assistant_turn(with Trace.steps), transition to build.execution.

    Idempotent by construction (final-review fix, Important #1): a loop-back
    from build.review/build.reverted (continue_adjusting/revert/retry_after_
    revert) returns to build.initial_plan WITHOUT resetting the already-built
    graph. Re-walking find_resources -> confirm_resources -> approve_plan then
    calls build_nodes() again, which always proposes the SAME fixed node ids
    -- so before applying, drop any create_node/connect intent that already
    exists in the current draft graph. Everything survives the first build
    (nothing exists yet); a re-approve after a loop-back filters everything
    out (it all already exists), so apply_repair([]) is a no-op rather than
    raising on a colliding node id."""
    kind = action_kind(turn)
    if kind != "approve_repair":
        return StepResult(next=PcState.BUILD_PLAN_APPROVAL, context=fc)

    emit_canvas(env, "create_checkpoint")
    intents = env.agent.build_nodes(list(fc.plan_items))

    current_graph, _current_hash = env.dify.read_graph(s.app_id, turn.actor)
    existing_node_ids = {n.get("id") for n in current_graph.get("nodes", [])}
    existing_edges = {(e.get("source"), e.get("target")) for e in current_graph.get("edges", [])}

    def _already_present(intent) -> bool:
        if intent.op == "create_node":
            return intent.args.get("node_id") in existing_node_ids
        if intent.op == "connect":
            return (intent.args.get("from_node"), intent.args.get("to_node")) in existing_edges
        return False

    to_apply = [intent for intent in intents if not _already_present(intent)]

    result = env.dify.apply_repair(s.app_id, turn.actor, to_apply, on_canvas=env.emit_canvas)
    fc.last_snapshot_hash = result.new_hash
    fc.last_structure_fingerprint = result.structure_fingerprint
    fc.built_node_ids = [
        intent.args["node_id"]
        for intent in intents
        if intent.op == "create_node" and isinstance(intent.args.get("node_id"), str)
    ]
    changes, scope, fc.change_set = build_change_set(result, default_scope="structure", fallback_diff="graph built")

    change_set_items = append_card(
        fc, ChangeSetCard(count=len(changes), changes=changes, scope=scope, full_diff_open=False)
    )
    plan_items = append_card(fc, PlanCard(title="Build plan", version_tag="v2.1", items=list(fc.plan_items)))
    decision_items = append_card(fc, DecisionItem(text="Approved the plan"))
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="build.execution",
            trace=Trace(status="completed", steps=list(_BUILD_TRACE_STEPS)),
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
    """(waiting) At rest after the build. ``run_test`` -> build.test_and_repair;
    ``revert`` (resolved to ``undo``) -> build.reverted: restores the pre-build
    draft from the checkpoint and invalidates the approvals made since it (via
    perform_revert)."""
    kind = action_kind(turn)
    if kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.BUILD_REVERTED, context=fc, items=items)
    if kind == "run_test":
        emit_canvas(env, "start_test_run")
        items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=str(uuid.uuid4()),
                stage_id="build.test_and_repair",
                trace=Trace(status="running", steps=[]),
                reply_text="Running tests.",
                cards=[],
            ),
        )
        return StepResult(next=PcState.BUILD_TEST_AND_REPAIR, context=fc, items=items)
    return StepResult(next=PcState.BUILD_EXECUTION, context=fc)


def handle_test_and_repair(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Canned test/repair arc: found a config bug -> applied a
    real set_node_config fix via apply_repair -> retested green. Emits the
    error/change_set/test_result plus the review summary, transitions to
    build.review. No live run_draft (spec: canned test_and_repair)."""
    emit_canvas(env, "mark_test_error")
    error_items = append_card(
        fc,
        ErrorCard(
            title="gross_margin parsed as text",
            body="The LLM node returned gross_margin as a string; tightening the prompt to coerce a number.",
            tone="danger",
            node_id="llm",
        ),
    )

    repair_intents = env.agent.propose_build_repair(list(fc.built_node_ids))
    result = env.dify.apply_repair(s.app_id, turn.actor, repair_intents, on_canvas=env.emit_canvas)
    fc.last_snapshot_hash = result.new_hash
    fc.last_structure_fingerprint = result.structure_fingerprint
    changes, scope, fc.change_set = build_change_set(result, default_scope="configuration", fallback_diff="config edit")
    change_set_items = append_card(
        fc, ChangeSetCard(count=len(changes), changes=changes, scope=scope, full_diff_open=False)
    )

    emit_canvas(env, "mark_test_success")
    test_result_items = append_card(
        fc,
        TestResultCard(
            title="Test run",
            subtitle="All checks passed",
            tone="success",
            stats=[TestStat(value="1", label="runs"), TestStat(value="0", label="errors")],
            run_ids=[],
        ),
    )

    emit_canvas(env, "mark_review_ready")
    summary_items = append_card(
        fc,
        SummaryCard(
            variant="review",
            title="Review",
            items=[
                "Workflow built: Start -> Knowledge -> LLM -> End",
                "1 issue found and fixed",
                "Tests passing",
            ],
        ),
    )
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="build.review",
            trace=Trace(status="completed", steps=[]),
            reply_text="Tests passed; ready for review.",
            cards=["error", "change_set", "test_result", "summary"],
        ),
    )
    return StepResult(
        next=PcState.BUILD_REVIEW,
        context=fc,
        items=[*error_items, *change_set_items, *test_result_items, *summary_items, *turn_items],
    )


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
        fc.plan_items = env.agent.propose_plan_v1(fc.requirements)
        fc.plan_version_tag = "v1"
        decision_items = append_card(fc, DecisionItem(text="Continue adjusting"))
        plan_items = append_card(fc, PlanCard(title="Build plan", version_tag="v1", items=list(fc.plan_items)))
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=str(uuid.uuid4()),
                stage_id="build.initial_plan",
                trace=Trace(status="completed", steps=[]),
                reply_text="Revised plan.",
                cards=["plan"],
            ),
        )
        return StepResult(
            next=PcState.BUILD_INITIAL_PLAN,
            context=fc,
            items=[*decision_items, *plan_items, *turn_items],
        )
    if kind == "undo":  # revert
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.BUILD_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.BUILD_REVIEW, context=fc)


def handle_publish(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Publish the built workflow, emit the PublishCard, and
    auto-advance to build.governance_feedback."""
    env.dify.publish(s.app_id, turn.actor)
    emit_canvas(env, "publish_workflow")
    items = append_card(fc, PublishCard(version="1.0", badge="live"))
    return StepResult(next=PcState.BUILD_GOVERNANCE_FEEDBACK, context=fc, items=items)


def handle_governance_feedback(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Governance tail: apply the skill-learning policy.
    automatic -> learn + accepted card; disabled -> skipped card; ask ->
    emit the pending prompt and rest at build.await_learning. Reached via both
    publish and keep_draft (scenario-neutral)."""
    policy = fc.skill_learning_policy or "ask"
    if policy == "automatic":
        descriptor = env.agent.learn_from_build(
            fc.goal_text, dict(fc.requirements), list(fc.plan_items), list(fc.built_node_ids)
        )
        items = append_card(fc, BuildLearningCard(policy="automatic", state="accepted"))
        items += append_card(fc, NoticeItem(text=descriptor))
        items += _emit_completion(fc)
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
        descriptor = env.agent.learn_from_build(
            fc.goal_text, dict(fc.requirements), list(fc.plan_items), list(fc.built_node_ids)
        )
        items = append_card(fc, DecisionItem(text="Accepted skill learning"))
        items += append_card(fc, NoticeItem(text=descriptor))
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
    fc.plan_items = env.agent.propose_plan_v1(fc.requirements)
    fc.plan_version_tag = "v1"
    plan_items = append_card(fc, PlanCard(title="Build plan", version_tag="v1", items=list(fc.plan_items)))
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="build.initial_plan",
            trace=Trace(status="completed", steps=[]),
            reply_text="Restarting the plan.",
            cards=["plan"],
        ),
    )
    return StepResult(next=PcState.BUILD_INITIAL_PLAN, context=fc, items=[*plan_items, *turn_items])


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
        PcState.BUILD_TEST_AND_REPAIR: handle_test_and_repair,
        PcState.BUILD_REVIEW: handle_review,
        PcState.BUILD_PUBLISH: handle_publish,
        PcState.BUILD_GOVERNANCE_FEEDBACK: handle_governance_feedback,
        PcState.BUILD_AWAIT_LEARNING: handle_await_learning,
        PcState.BUILD_REVERTED: handle_reverted,
    }
