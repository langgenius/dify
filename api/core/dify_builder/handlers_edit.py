"""Edit-flow handlers: pure ``(env, turn, session, fc) -> StepResult`` steps.

Mirrors ``handlers_build.py`` for the Edit entry mode (spec: docs/superpowers/
specs/2026-08-23-dify-builder-slice3-edit-design.md). Cards for a state are
emitted by the handler transitioning INTO it; ``edit.test_affected_paths`` is a
working state that auto-advances; the edit itself rides on
``handle_plan_approval`` (approve_plan) and the publish rides on
``handle_review`` (publish_workflow) because ``edit.apply_changes`` is a waiting
state and ``edit.publish`` is terminal (no handler). Per the product mock
(02-edit.txt:36-39) publish AND keep_draft both finish the task at edit.publish.
"""

import uuid

from core.dify_builder.contract import (
    AssistantTurnItem,
    ChallengeCard,
    ChangeSetCard,
    CheckpointCard,
    DecisionItem,
    ErrorCard,
    FormCard,
    PlanCard,
    PublishCard,
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
from core.dify_builder.models import DifyBuilderContext, Run, Session, TestInput, Turn
from core.dify_builder.runner import Env, Handler, StepResult
from core.dify_builder.state import PcState

__all__ = [
    "edit_registry",
    "handle_apply_changes",
    "handle_await_repair",
    "handle_await_testdata",
    "handle_capability_check",
    "handle_impact_analysis",
    "handle_plan_approval",
    "handle_reverted",
    "handle_review",
    "handle_test_affected_paths",
]


def handle_capability_check(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Entry state. On ``send_edit_goal`` read the existing graph,
    emit a read-only context summary, analyze impact into edit_rules + target
    nodes (highlighting them), and transition to edit.impact_analysis emitting
    its form + challenge + change_set(preview). The canvas is read only here,
    after the goal is sent (mock 02-edit.txt:3,9)."""
    kind = action_kind(turn)
    if kind != "send_edit_goal":
        return StepResult(next=PcState.EDIT_CAPABILITY_CHECK, context=fc)

    text, ok = action_string(turn, "text")
    if ok and text:
        fc.goal_text = text

    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
    node_count = len(graph.get("nodes", []))
    edge_count = len(graph.get("edges", []))

    impact = env.agent.analyze_impact(fc.goal_text, graph)
    fc.form_fields = list(impact.get("fields") or [])
    fc.edit_rules = dict(impact.get("values") or {})
    fc.edit_target_node_ids = list(impact.get("target_node_ids") or [])

    for node_id in fc.edit_target_node_ids:
        emit_canvas(env, "highlight_edit_target", node_id=node_id)

    summary_items = append_card(
        fc,
        SummaryCard(
            variant="context",
            title="Current workflow",
            items=[f"Read {node_count} nodes", f"{edge_count} connections"],
        ),
    )
    form_items = append_card(
        fc,
        FormCard(
            variant="edit_rules", fields=build_form_fields(fc.form_fields), values=dict(fc.edit_rules), frozen=False
        ),
    )
    challenge_items = append_card(
        fc,
        ChallengeCard(
            title="High-impact rules",
            body="These rules change branching and output; review before applying.",
            tone="warning",
        ),
    )
    change_set_items = append_card(
        fc,
        ChangeSetCard(
            count=len(fc.edit_target_node_ids),
            changes=[f"will edit {nid}" for nid in fc.edit_target_node_ids],
            scope="configuration",
            full_diff_open=False,
        ),
    )
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="edit.impact_analysis",
            trace=Trace(status="completed", steps=[]),
            reply_text="Here's the impact of your change.",
            cards=["summary", "form", "challenge", "change_set"],
        ),
    )
    return StepResult(
        next=PcState.EDIT_IMPACT_ANALYSIS,
        context=fc,
        items=[*summary_items, *form_items, *challenge_items, *change_set_items, *turn_items],
    )


def handle_impact_analysis(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) On ``submit_edit_rules`` merge the form payload, propose the
    change plan, self-mint the pre-edit checkpoint (so the CheckpointCard at
    plan_approval carries a real id -- mirrors Build's handle_resource_
    recommendation), and transition to edit.plan_approval."""
    kind = action_kind(turn)
    if kind != "submit_edit_rules":
        return StepResult(next=PcState.EDIT_IMPACT_ANALYSIS, context=fc)

    fc.checkpoint_seq = fc.next_seq

    if turn.action is not None and isinstance(turn.action.payload, dict):
        keys = [f["key"] for f in fc.form_fields if isinstance(f, dict) and f.get("key")]
        fc.edit_rules = merge_known_keys(fc.edit_rules, turn.action.payload, keys)

    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    fc.plan_items = env.agent.propose_edit_plan(dict(fc.edit_rules), graph)
    fc.plan_version_tag = "v1"

    checkpoint_id = mint_checkpoint(env, s, fc, graph, graph_hash, PcState.EDIT_PLAN_APPROVAL)

    decision_items = append_card(fc, DecisionItem(text="Submitted edit rules"))
    plan_items = append_card(fc, PlanCard(title="Change plan", version_tag="v1", items=list(fc.plan_items)))
    checkpoint_items = append_card(
        fc, CheckpointCard(checkpoint_id=checkpoint_id, label="Pre-edit checkpoint", created_at="")
    )
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="edit.plan_approval",
            trace=Trace(status="completed", steps=[]),
            reply_text="Change plan ready for approval.",
            cards=["plan", "checkpoint"],
        ),
    )
    return StepResult(
        next=PcState.EDIT_PLAN_APPROVAL,
        context=fc,
        items=[*decision_items, *plan_items, *checkpoint_items, *turn_items],
    )


_EDIT_TRACE_STEPS = [
    TraceStep(
        id="edit-highlight",
        label="Highlight edit targets",
        state="done",
        tone="neutral",
        canvas_event="highlight_edit_target",
    ),
    TraceStep(
        id="edit-apply",
        label="Apply the change plan",
        state="done",
        tone="success",
        canvas_event="apply_edit_plan",
    ),
]


def handle_plan_approval(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) THE EDIT. Only ``approve_repair`` (resolved from approve_plan)
    applies: read the current graph, get the canned set_node_config intents,
    highlight the targets, apply once (on_canvas=None -- Edit narrates its own
    coarse apply_edit_plan rather than the Fix-flavored per-intent apply_error_
    fix), emit the real change_set + checkpoint + assistant_turn, transition to
    edit.apply_changes.

    Naturally idempotent on loop-back re-approve: re-applying the same
    set_node_config value overwrites the node's data (no ValueError, unlike
    Build's create_node); a re-approve simply yields an empty diff."""
    kind = action_kind(turn)
    if kind != "approve_repair":
        return StepResult(next=PcState.EDIT_PLAN_APPROVAL, context=fc)

    emit_canvas(env, "create_checkpoint")
    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
    intents = env.agent.build_edit_intents(dict(fc.edit_rules), graph)
    fc.staged_repair = list(intents)

    for node_id in fc.edit_target_node_ids:
        emit_canvas(env, "highlight_edit_target", node_id=node_id)

    result = env.dify.apply_repair(s.app_id, turn.actor, intents, on_canvas=None)
    fc.last_snapshot_hash = result.new_hash
    fc.last_structure_fingerprint = result.structure_fingerprint
    emit_canvas(env, "apply_edit_plan")

    changes, scope, fc.change_set = build_change_set(result, default_scope="configuration", fallback_diff="no changes")

    change_set_items = append_card(
        fc, ChangeSetCard(count=len(changes), changes=changes, scope=scope, full_diff_open=False)
    )
    checkpoint_items = append_card(
        fc, CheckpointCard(checkpoint_id=fc.checkpoint_id, label="Pre-edit checkpoint", created_at="")
    )
    decision_items = append_card(fc, DecisionItem(text="Approved the change plan"))
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="edit.apply_changes",
            trace=Trace(status="completed", steps=list(_EDIT_TRACE_STEPS)),
            reply_text="Applied the changes to the canvas.",
            cards=["change_set", "checkpoint"],
        ),
    )
    return StepResult(
        next=PcState.EDIT_APPLY_CHANGES,
        context=fc,
        items=[*change_set_items, *checkpoint_items, *decision_items, *turn_items],
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
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    if kind == "run_affected_tests":
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
                    stage_id="edit.await_testdata",
                    trace=Trace(status="completed", steps=[]),
                    reply_text="Provide test inputs (or use mock data) to run the affected-path test.",
                    cards=["form"],
                ),
            )
            return StepResult(next=PcState.EDIT_AWAIT_TESTDATA, context=fc, items=[*form_items, *turn_items])
        emit_canvas(env, "start_test_run")
        items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=str(uuid.uuid4()),
                stage_id="edit.test_affected_paths",
                trace=Trace(status="running", steps=[]),
                reply_text="Running affected-path tests.",
                cards=[],
            ),
        )
        return StepResult(next=PcState.EDIT_TEST_AFFECTED_PATHS, context=fc, items=items)
    return StepResult(next=PcState.EDIT_APPLY_CHANGES, context=fc)


def handle_await_testdata(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Prepare inputs for the affected-path test. mock -> schema-shaped
    generate_mock_inputs; provide/upload -> the payload's inputs dict (may carry
    file refs). Persists a TestInput and advances to edit.test_affected_paths."""
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
    return StepResult(next=PcState.EDIT_TEST_AFFECTED_PATHS, context=fc)


def handle_test_affected_paths(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Live affected-path test via run_draft. Success ->
    edit.review; failure -> real diagnose + propose_repair, staged for the
    edit.await_repair approval gate. No auto-apply (human-gated)."""
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
                title="Affected-path tests",
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
                items=["Applied the change plan", "Affected paths tested", "Tests passing"],
            ),
        )
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=str(uuid.uuid4()),
                stage_id="edit.review",
                trace=Trace(status="completed", steps=[]),
                reply_text="Tests passed; ready for review.",
                cards=["test_result", "summary"],
            ),
        )
        return StepResult(
            next=PcState.EDIT_REVIEW,
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
                title="Affected-path tests",
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
                stage_id="edit.await_testdata",
                trace=Trace(status="completed", steps=[]),
                reply_text="The run failed on its inputs — provide test data and retry.",
                cards=["test_result", "form"],
            ),
        )
        return StepResult(
            next=PcState.EDIT_AWAIT_TESTDATA,
            context=fc,
            items=[*test_items, *form_items, *turn_items],
            run=run,
            run_id_sink=[run.id],
        )

    # config failure: existing diagnose + propose_repair -> EDIT_AWAIT_REPAIR
    diagnosis = env.agent.diagnose(run, graph, per_node)
    intents, risk = env.agent.propose_repair(diagnosis, graph)
    fc.diagnosis = diagnosis
    fc.staged_repair = list(intents)
    fc.risk = risk
    test_items = append_card(
        fc,
        TestResultCard(
            title="Affected-path tests",
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
            stage_id="edit.await_repair",
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
        next=PcState.EDIT_AWAIT_REPAIR,
        context=fc,
        items=[*test_items, *error_items, *cs_items, *turn_items],
        run=run,
        run_id_sink=[run.id],
    )


def handle_await_repair(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Post-failure gate for Edit, mirroring Build's await_repair.
    approve_repair applies the staged repair and re-runs the affected-path
    tests (edit.test_affected_paths); keep_draft -> edit.review; undo ->
    edit.reverted. apply_repair runs ONLY here, only on approve."""
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
        return StepResult(next=PcState.EDIT_TEST_AFFECTED_PATHS, context=fc, items=[*cs_items, *decision_items])
    if kind == "keep_draft":
        items = append_card(fc, DecisionItem(text="Kept the draft despite the failure"))
        return StepResult(next=PcState.EDIT_REVIEW, context=fc, items=items)
    if kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.EDIT_AWAIT_REPAIR, context=fc)


def _completion_rows(fc: DifyBuilderContext, status: str) -> list[SummaryRow]:
    return [
        SummaryRow(label="Change", value="; ".join(fc.plan_items) or "config edit"),
        SummaryRow(label="Status", value=status),
    ]


def handle_review(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Terminal decision. Mock 02-edit.txt:36-39: publish_workflow AND
    keep_draft both = Task Completed -> edit.publish (terminal). Because edit.
    publish runs no handler, this handler emits its cards before returning.
    continue_adjusting (resolved re_fix) -> edit.impact_analysis (re-analyze);
    revert (undo) -> edit.reverted: restores the pre-edit draft from the
    checkpoint and invalidates the approvals made since it (via perform_revert)."""
    kind = action_kind(turn)
    if kind == "publish_workflow":
        env.dify.publish(s.app_id, turn.actor)
        emit_canvas(env, "publish_workflow")
        decision_items = append_card(fc, DecisionItem(text="Chose to publish"))
        publish_items = append_card(fc, PublishCard(version="2.1", badge="live"))
        summary_items = append_card(
            fc, SummaryCard(variant="completion", title="Edit published", rows=_completion_rows(fc, "Published"))
        )
        return StepResult(
            next=PcState.EDIT_PUBLISH, context=fc, items=[*decision_items, *publish_items, *summary_items]
        )
    if kind == "keep_draft":
        emit_canvas(env, "cancel_publish")
        decision_items = append_card(fc, DecisionItem(text="Kept the draft"))
        summary_items = append_card(
            fc, SummaryCard(variant="completion", title="Draft kept", rows=_completion_rows(fc, "Draft kept"))
        )
        return StepResult(next=PcState.EDIT_PUBLISH, context=fc, items=[*decision_items, *summary_items])
    if kind == "re_fix":  # continue_adjusting -> re-analyze impact
        emit_canvas(env, "cancel_publish")
        for node_id in fc.edit_target_node_ids:
            emit_canvas(env, "highlight_edit_target", node_id=node_id)
        fc.test_input_ref = ""
        fc.verify_run_id = ""
        decision_items = append_card(fc, DecisionItem(text="Continue adjusting"))
        form_items = append_card(
            fc,
            FormCard(
                variant="edit_rules", fields=build_form_fields(fc.form_fields), values=dict(fc.edit_rules), frozen=False
            ),
        )
        challenge_items = append_card(
            fc,
            ChallengeCard(
                title="High-impact rules",
                body="These rules change branching and output; review before applying.",
                tone="warning",
            ),
        )
        change_set_items = append_card(
            fc,
            ChangeSetCard(
                count=len(fc.edit_target_node_ids),
                changes=[f"will edit {nid}" for nid in fc.edit_target_node_ids],
                scope="configuration",
                full_diff_open=False,
            ),
        )
        turn_items = append_card(
            fc,
            AssistantTurnItem(
                turn_id=str(uuid.uuid4()),
                stage_id="edit.impact_analysis",
                trace=Trace(status="completed", steps=[]),
                reply_text="Let's adjust the change.",
                cards=["form", "challenge", "change_set"],
            ),
        )
        return StepResult(
            next=PcState.EDIT_IMPACT_ANALYSIS,
            context=fc,
            items=[*decision_items, *form_items, *challenge_items, *change_set_items, *turn_items],
        )
    if kind == "undo":  # revert
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.EDIT_REVIEW, context=fc)


def handle_reverted(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) After a revert. ``retry_after_revert`` (resolved to re_fix)
    re-proposes the change plan, self-mints a fresh pre-edit checkpoint, and
    returns to edit.plan_approval (spec §7.2)."""
    kind = action_kind(turn)
    if kind != "re_fix":
        return StepResult(next=PcState.EDIT_REVERTED, context=fc)

    fc.checkpoint_seq = fc.next_seq
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    fc.plan_items = env.agent.propose_edit_plan(dict(fc.edit_rules), graph)
    fc.plan_version_tag = "v1"
    fc.test_input_ref = ""
    fc.verify_run_id = ""
    checkpoint_id = mint_checkpoint(env, s, fc, graph, graph_hash, PcState.EDIT_PLAN_APPROVAL)
    plan_items = append_card(fc, PlanCard(title="Change plan", version_tag="v1", items=list(fc.plan_items)))
    checkpoint_items = append_card(
        fc, CheckpointCard(checkpoint_id=checkpoint_id, label="Pre-edit checkpoint", created_at="")
    )
    turn_items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="edit.plan_approval",
            trace=Trace(status="completed", steps=[]),
            reply_text="Re-approve to apply the change.",
            cards=["plan", "checkpoint"],
        ),
    )
    return StepResult(
        next=PcState.EDIT_PLAN_APPROVAL, context=fc, items=[*plan_items, *checkpoint_items, *turn_items]
    )


def edit_registry() -> dict[PcState, Handler]:
    """The Edit handler table. Grows across Slice 3 tasks; ``edit.publish`` is
    terminal and intentionally absent (the loop returns before lookup)."""
    return {
        PcState.EDIT_CAPABILITY_CHECK: handle_capability_check,
        PcState.EDIT_IMPACT_ANALYSIS: handle_impact_analysis,
        PcState.EDIT_PLAN_APPROVAL: handle_plan_approval,
        PcState.EDIT_APPLY_CHANGES: handle_apply_changes,
        PcState.EDIT_AWAIT_TESTDATA: handle_await_testdata,
        PcState.EDIT_TEST_AFFECTED_PATHS: handle_test_affected_paths,
        PcState.EDIT_AWAIT_REPAIR: handle_await_repair,
        PcState.EDIT_REVIEW: handle_review,
        PcState.EDIT_REVERTED: handle_reverted,
    }
