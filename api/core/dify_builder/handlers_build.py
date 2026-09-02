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
    build_form_fields,
    emit_canvas,
    first_failed_node,
    is_input_failure,
    merge_known_keys,
    mint_checkpoint,
    perform_revert,
    start_schema,
    testdata_form_fields,
)
from core.dify_builder.models import (
    ConversationItem,
    DifyBuilderContext,
    MutationIntent,
    Run,
    Session,
    TestInput,
    Turn,
)
from core.dify_builder.runner import Env, Handler, StepResult
from core.dify_builder.state import PcState

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
    analysis = env.agent.analyze_goal(fc.goal_text)
    fc.form_fields = list(analysis.get("fields") or [])
    fc.requirements = dict(analysis.get("values") or {})

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


def handle_goal_analysis(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) On ``submit_requirements`` merge the form payload, propose
    plan v1, and transition to build.initial_plan emitting the plan card."""
    kind = action_kind(turn)
    if kind != "submit_requirements":
        return StepResult(next=PcState.BUILD_GOAL_ANALYSIS, context=fc)

    if turn.action is not None and isinstance(turn.action.payload, dict):
        keys = [f["key"] for f in fc.form_fields if isinstance(f, dict) and f.get("key")]
        fc.requirements = merge_known_keys(fc.requirements, turn.action.payload, keys)

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

    emit_canvas(env, "create_checkpoint")
    intents = env.agent.build_nodes(list(fc.plan_items))

    if not any(intent.op == "create_node" for intent in intents):
        # Generation produced no nodes (build.build_nodes' honest-empty path when the
        # generator + its one retry still fail to yield a valid graph). Do NOT delete
        # the placeholder start or report a successful build -- that would empty the
        # canvas while claiming "Workflow built on the canvas." Surface an honest error
        # and stay in plan_approval so the user can adjust the goal/plan and re-approve.
        # (A loop-back re-approve still returns the fixed create intents -- they are only
        # filtered as already-present below -- so zero create intents means genuine failure.)
        error_items = append_card(
            fc,
            ErrorCard(
                title="Couldn't build the workflow",
                body=(
                    "I couldn't generate a valid workflow graph from this plan. "
                    "Adjust the goal or the plan and approve again to retry."
                ),
            ),
        )
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=str(uuid.uuid4()),
                stage_id="build.plan_approval",
                trace=Trace(status="completed", steps=[]),
                reply_text=(
                    "I couldn't build a valid workflow graph -- see the error above. "
                    "Adjust the plan and approve again."
                ),
                cards=["error"],
            ),
        )
        return StepResult(
            next=PcState.BUILD_PLAN_APPROVAL,
            context=fc,
            items=[*error_items, *turn_items],
        )

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
    """(waiting) At rest after the build. ``run_test`` -> build.await_testdata
    when no test input is prepared yet (gate), else straight to
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
            form_items = append_card(
                fc,
                FormCard(
                    variant="testdata",
                    fields=testdata_form_fields(start_schema(graph)),
                    values={},
                    frozen=False,
                ),
            )
            turn_items = append_card(
                fc,
                AssistantTurnItem(
                    turn_id=str(uuid.uuid4()),
                    stage_id="build.await_testdata",
                    trace=Trace(status="completed", steps=[]),
                    reply_text="Provide test inputs (or use mock data) to run the test.",
                    cards=["form"],
                ),
            )
            return StepResult(next=PcState.BUILD_AWAIT_TESTDATA, context=fc, items=[*form_items, *turn_items])
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


def handle_await_testdata(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Prepare inputs for the live test run. mock -> schema-shaped
    generate_mock_inputs; provide/upload -> the payload's inputs dict (may carry
    file refs). Persists a TestInput and advances to build.test_and_repair."""
    mode, _ = action_string(turn, "mode")
    if mode == "mock":
        graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
        inputs = env.agent.generate_mock_inputs(start_schema(graph), {})
    else:
        inputs = {}
        if turn.action is not None and isinstance(turn.action.payload.get("inputs"), dict):
            inputs = turn.action.payload["inputs"]
    ti = TestInput(session_id=s.id, source=mode or "upload", inputs=inputs)
    env.repo.save_test_input(ti)
    fc.test_input_ref = ti.id
    return StepResult(next=PcState.BUILD_TEST_AND_REPAIR, context=fc)


def handle_test_and_repair(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Live test: run the built draft with mock inputs. Success
    -> build.review. Failure -> real diagnose + propose_repair, staged for the
    build.await_repair approval gate. No auto-apply (human-gated)."""
    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)

    if fc.test_input_ref:
        inputs = env.repo.get_test_input(fc.test_input_ref).inputs
    else:  # defensive: the gate normally prepares inputs first
        inputs = env.agent.generate_mock_inputs(start_schema(graph), {})
        ti = TestInput(session_id=s.id, source="mock", inputs=inputs)
        env.repo.save_test_input(ti)
        fc.test_input_ref = ti.id

    emit = env.emit if env.emit is not None else (lambda _e: None)
    try:
        raw = env.dify.run_draft(s.app_id, turn.actor, inputs, emit)
        status, per_node, dify_run_id = raw.status, raw.per_node, raw.dify_run_id
    except Exception:  # never crash the advance -- surface as a failed run
        status, per_node, dify_run_id = "failed", [], ""

    run = Run(
        id=str(uuid.uuid4()),
        kind="verify",
        dify_run_id=dify_run_id,
        status=status,
        per_node=per_node,
        inputs_ref=fc.test_input_ref,
        immutable=True,
    )

    if status == "succeeded":
        emit_canvas(env, "mark_test_success")
        test_items = append_card(
            fc,
            TestResultCard(
                title="Test run",
                subtitle="All checks passed",
                tone="success",
                stats=[TestStat(value="1", label="runs"), TestStat(value="0", label="errors")],
                run_ids=[run.id],
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
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=str(uuid.uuid4()),
                stage_id="build.review",
                trace=Trace(status="completed", steps=[]),
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

    # failure: real diagnosis + proposed repair, staged for the approval gate
    run.culprit_node_id = first_failed_node(per_node)
    fc.verify_run_id = run.id
    emit_canvas(env, "mark_test_error")

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
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=str(uuid.uuid4()),
                stage_id="build.await_testdata",
                trace=Trace(status="completed", steps=[]),
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

    # config failure: existing diagnose + propose_repair -> BUILD_AWAIT_REPAIR
    diagnosis = env.agent.diagnose(run, graph, per_node)
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
            fc, ChangeSetCard(count=len(intents), changes=proposed, scope="configuration", full_diff_open=False)
        )
        if intents
        else []
    )
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="build.await_repair",
            trace=Trace(status="completed", steps=[]),
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


def handle_await_repair(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Post-failure gate mirroring fix.await_decision. approve_repair
    applies the staged repair and re-runs the test (build.test_and_repair);
    keep_draft -> build.review; undo -> build.reverted. apply_repair runs ONLY
    here, only on approve."""
    kind = action_kind(turn)
    if kind == "approve_repair":
        result = env.dify.apply_repair(s.app_id, turn.actor, list(fc.staged_repair), on_canvas=env.emit_canvas)
        fc.last_snapshot_hash = result.new_hash
        fc.last_structure_fingerprint = result.structure_fingerprint
        fc.staged_repair = []
        changes, scope, fc.change_set = build_change_set(
            result, default_scope="configuration", fallback_diff="repair"
        )
        cs_items = append_card(
            fc, ChangeSetCard(count=len(changes), changes=changes, scope=scope, full_diff_open=False)
        )
        decision_items = append_card(fc, DecisionItem(text="Approved the fix; retesting"))
        return StepResult(next=PcState.BUILD_TEST_AND_REPAIR, context=fc, items=[*cs_items, *decision_items])
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
        fc.plan_items = env.agent.propose_plan_v1(fc.requirements)
        fc.plan_version_tag = "v1"
        fc.test_input_ref = ""
        fc.verify_run_id = ""
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
    fc.test_input_ref = ""
    fc.verify_run_id = ""
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
        PcState.BUILD_AWAIT_TESTDATA: handle_await_testdata,
        PcState.BUILD_TEST_AND_REPAIR: handle_test_and_repair,
        PcState.BUILD_AWAIT_REPAIR: handle_await_repair,
        PcState.BUILD_REVIEW: handle_review,
        PcState.BUILD_PUBLISH: handle_publish,
        PcState.BUILD_GOVERNANCE_FEEDBACK: handle_governance_feedback,
        PcState.BUILD_AWAIT_LEARNING: handle_await_learning,
        PcState.BUILD_REVERTED: handle_reverted,
    }
