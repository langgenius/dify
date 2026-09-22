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

from core.dify_builder.contract import (
    DecisionItem,
    FormCard,
    NoticeItem,
    PlanCard,
    TestResultCard,
)
from core.dify_builder.handlers_fix import (
    UNKNOWN_TEST_OUTCOME_NOTICE,
    action_kind,
    action_string,
    append_assistant,
    append_card,
    build_change_set,
    build_form_fields,
    emit_canvas,
    first_failed_node,
    is_input_failure,
    launch_error_text,
    merge_known_keys,
    mint_checkpoint,
    model_config_error_text,
    perform_revert,
    start_schema,
    test_failure_reason,
    testdata_form_fields,
)
from core.dify_builder.models import Diagnosis, DifyBuilderContext, NodeEvent, Risk, Run, Session, TestInput, Turn
from core.dify_builder.progress import ProgressReporter
from core.dify_builder.runner import Env, Handler, StepResult
from core.dify_builder.state import PcState

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

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("edit-inspect-workflow", "Inspect the current workflow"),
            ("edit-analyze-impact", "Analyze the requested change"),
            ("edit-prepare-impact", "Prepare the impact summary"),
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
            title="Review the change rules",
            description="Adjust any values before Builder applies the change plan.",
            fields=build_form_fields(fc.form_fields),
            values=dict(fc.edit_rules),
            frozen=False,
        ),
    )
    execution = progress.finish()
    target_text = ", ".join(fc.edit_target_node_ids) or "none identified"
    turn_items = append_assistant(
        env,
        s,
        fc,
        f"I inspected {node_count} node(s) and {edge_count} connection(s). "
        f"Affected nodes: {target_text}. These rules may change branching or output; review them before applying.",
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
    edit.plan_approval."""
    kind = action_kind(turn)
    if kind != "submit_edit_rules":
        return StepResult(next=PcState.EDIT_IMPACT_ANALYSIS, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("edit-review-rules", "Review confirmed edit rules"),
            ("edit-draft-plan", "Draft the change plan"),
            ("edit-create-checkpoint", "Create a pre-edit checkpoint"),
        ],
    )
    progress.activate("edit-review-rules")
    fc.checkpoint_seq = fc.next_seq

    if turn.action is not None and isinstance(turn.action.payload, dict):
        keys = [f["key"] for f in fc.form_fields if isinstance(f, dict) and f.get("key")]
        fc.edit_rules = merge_known_keys(fc.edit_rules, turn.action.payload, keys)

    progress.activate("edit-draft-plan")
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    fc.plan_items = env.agent.propose_edit_plan(dict(fc.edit_rules), graph)

    progress.activate("edit-create-checkpoint")
    mint_checkpoint(env, s, fc, graph, graph_hash, PcState.EDIT_PLAN_APPROVAL)

    decision_items = append_card(fc, DecisionItem(text="Submitted edit rules"))
    plan_items = append_card(fc, PlanCard(title="Change plan", items=list(fc.plan_items)))
    execution = progress.finish()
    turn_items = append_assistant(
        env,
        s,
        fc,
        "The final change plan is ready for approval.",
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
    ("edit-prepare", "Prepare canvas changes"),
    ("edit-highlight", "Highlight edit targets"),
    ("edit-apply", "Apply the change plan"),
]


def handle_plan_approval(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) THE EDIT. Only ``approve_repair`` (resolved from approve_plan)
    applies: read the current graph, get the canned set_node_config intents,
    highlight the targets, apply once (on_canvas=None -- Edit narrates its own
    coarse apply_edit_plan rather than the Fix-flavored per-intent apply_error_
    fix), summarize the applied changes in assistant text, and transition to
    edit.apply_changes. The checkpoint stays backend-only.

    Naturally idempotent on loop-back re-approve: re-applying the same
    set_node_config value overwrites the node's data (no ValueError, unlike
    Build's create_node); a re-approve simply yields an empty diff."""
    kind = action_kind(turn)
    if kind != "approve_repair":
        return StepResult(next=PcState.EDIT_PLAN_APPROVAL, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=_EDIT_EXECUTION_STEPS,
    )
    progress.activate("edit-prepare")
    emit_canvas(env, "create_checkpoint")
    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
    intents = env.agent.build_edit_intents(dict(fc.edit_rules), graph)
    fc.staged_repair = list(intents)

    progress.activate("edit-highlight")
    for node_id in fc.edit_target_node_ids:
        emit_canvas(env, "highlight_edit_target", node_id=node_id)

    progress.activate("edit-apply")
    result = env.dify.apply_repair(
        s.app_id, turn.actor, intents, on_canvas=None, expected_revision=fc.last_snapshot_hash
    )
    fc.last_snapshot_hash = result.new_hash
    fc.last_structure_fingerprint = result.structure_fingerprint
    emit_canvas(env, "apply_edit_plan")

    changes, scope, fc.change_set = build_change_set(result, default_scope="configuration", fallback_diff="no changes")

    decision_items = append_card(fc, DecisionItem(text="Approved the change plan"))
    execution = progress.finish()
    change_lines = "\n".join(f"- {change}" for change in changes) or "- No effective changes"
    turn_items = append_assistant(
        env,
        s,
        fc,
        f"Applied {len(changes)} change(s) to the canvas ({scope}).\n{change_lines}",
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
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    if kind == "run_affected_tests":
        if fc.test_input_ref == "":
            graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
            form_items = append_card(
                fc,
                FormCard(
                    variant="testdata",
                    title="Provide test data",
                    description="Review the inputs Builder will use for this run.",
                    fields=testdata_form_fields(start_schema(graph)),
                    values={},
                    frozen=False,
                ),
            )
            turn_items = append_assistant(
                env,
                s,
                fc,
                "Provide test inputs (or use mock data) to run the affected-path test.",
                cards=["form"],
            )
            return StepResult(next=PcState.EDIT_AWAIT_TESTDATA, context=fc, items=[*form_items, *turn_items])
        emit_canvas(env, "start_test_run")
        items = append_card(fc, DecisionItem(text="Run affected-path tests"))
        return StepResult(next=PcState.EDIT_TEST_AFFECTED_PATHS, context=fc, items=items)
    return StepResult(next=PcState.EDIT_APPLY_CHANGES, context=fc)


def handle_await_testdata(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Prepare inputs for the affected-path test. mock -> schema-shaped
    generate_mock_inputs; provide/upload -> the payload's inputs dict (may carry
    file refs). Persists a TestInput and advances to edit.test_affected_paths."""
    mode, _ = action_string(turn, "mode")
    if mode == "mock":
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            stage_id=str(s.current_state),
            steps=[("edit-generate-test-inputs", "Generate affected-path test inputs")],
        )
        progress.activate("edit-generate-test-inputs")
        graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
        inputs = env.agent.generate_mock_inputs(start_schema(graph), {})
        progress.finish()
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
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("edit-prepare-test", "Prepare affected-path tests"),
            ("edit-run-test", "Run affected workflow paths"),
            ("edit-evaluate-test", "Evaluate the test result"),
        ],
    )
    progress.activate("edit-prepare-test")
    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
    if fc.test_input_ref:
        inputs = env.repo.get_test_input(fc.test_input_ref).inputs
    else:  # defensive: the gate normally prepares inputs first
        inputs = env.agent.generate_mock_inputs(start_schema(graph), {})
        ti = TestInput(session_id=s.id, source="mock", inputs=inputs)
        env.repo.save_test_input(ti)
        fc.test_input_ref = ti.id

    progress.activate("edit-run-test")

    def emit(event: NodeEvent) -> None:
        progress.observe_node("edit-run-test", event)

    try:
        raw = env.dify.run_draft(s.app_id, turn.actor, inputs, emit, on_workflow_event=env.emit_workflow)
        status, per_node, dify_run_id, run_error = raw.status, raw.per_node, raw.dify_run_id, ""
    except Exception as exc:
        # Never crash the advance; capture the launch error (log + store) instead
        # of swallowing it, so diagnose/routing have something to act on.
        logger.exception("dify_builder verify run failed to launch (session=%s, app=%s)", s.id, s.app_id)
        status, per_node, dify_run_id, run_error = "failed", [], "", launch_error_text(exc)

    if status == "succeeded":
        progress.complete("edit-run-test")
    else:
        progress.fail_step("edit-run-test")
    progress.activate("edit-evaluate-test")

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

    if status == "succeeded":
        emit_canvas(env, "mark_test_success", dify_run_id=run.dify_run_id)
        test_items = append_card(
            fc,
            TestResultCard(
                status="succeeded",
                dify_run_id=run.dify_run_id,
            ),
        )
        emit_canvas(env, "mark_review_ready")
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            "Affected-path tests passed; the edit is ready for review.",
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
        execution = progress.finish()
        notice_items = append_assistant(
            env,
            s,
            fc,
            UNKNOWN_TEST_OUTCOME_NOTICE,
            execution=execution,
            turn_id=progress.operation_id,
        )
        return StepResult(
            next=PcState.EDIT_APPLY_CHANGES,
            context=fc,
            items=notice_items,
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
                status="failed",
                failure_reason=test_failure_reason(run),
                dify_run_id=run.dify_run_id,
            ),
        )
        form_items = append_card(
            fc,
            FormCard(
                variant="testdata",
                title="Provide test data",
                description="Review the inputs Builder will use for this run.",
                fields=testdata_form_fields(start_schema(graph)),
                values={},
                frozen=False,
            ),
        )
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            "The run failed on its inputs — provide test data and retry.",
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
                status="failed",
                failure_reason=model_error,
                dify_run_id=run.dify_run_id,
            ),
        )
        execution = progress.finish()
        turn_items = append_assistant(
            env,
            s,
            fc,
            root_cause,
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
            ("edit-diagnose-failure", "Diagnose the failed path"),
            ("edit-prepare-repair", "Prepare a safe repair"),
        ]
    )
    progress.activate("edit-diagnose-failure")
    diagnosis = env.agent.diagnose(run, graph, per_node)
    progress.activate("edit-prepare-repair")
    intents, risk = env.agent.propose_repair(diagnosis, graph)
    fc.diagnosis = diagnosis
    fc.staged_repair = list(intents)
    fc.risk = risk
    test_items = append_card(
        fc,
        TestResultCard(
            status="failed",
            failure_reason=test_failure_reason(run),
            dify_run_id=run.dify_run_id,
        ),
    )
    proposed = [f"{i.op} {i.args.get('node_id', '')}".strip() for i in intents]
    execution = progress.finish()
    proposal_text = "\n".join(f"- {change}" for change in proposed)
    reply_text = diagnosis.root_cause or "The run failed."
    reply_text += (
        f"\n\nProposed fix:\n{proposal_text}"
        if intents
        else "\n\nNo safe automatic fix was found; edit the workflow or keep the draft."
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
            items = append_card(
                fc,
                NoticeItem(text="No fix is staged for this failure -- keep the draft or revert."),
            )
            return StepResult(next=PcState.EDIT_AWAIT_REPAIR, context=fc, items=items)
        progress = ProgressReporter.for_session(
            emit=env.emit_progress,
            operation_id=env.operation_id,
            session=s,
            stage_id=str(s.current_state),
            steps=[
                ("edit-apply-repair", "Apply the approved repair"),
                ("edit-prepare-retest", "Prepare to retest affected paths"),
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
            )
        except ValueError as exc:
            # Same stale-intent window as Build's gate: apply_repair
            # re-validates against the draft as it is NOW, and a bad intent
            # must not kill the session (ESQ1-271).
            logger.warning("Dify Builder: staged repair no longer applies for app %s: %s", s.app_id, exc)
            fc.staged_repair = []
            execution = progress.finish()
            items = append_assistant(
                env,
                s,
                fc,
                f"Couldn't apply the fix. The proposed fix no longer applies to the current draft: {exc}",
                execution=execution,
                turn_id=progress.operation_id,
            )
            return StepResult(next=PcState.EDIT_AWAIT_REPAIR, context=fc, items=items)
        fc.last_snapshot_hash = result.new_hash
        fc.last_structure_fingerprint = result.structure_fingerprint
        fc.staged_repair = []
        changes, scope, fc.change_set = build_change_set(result, default_scope="configuration", fallback_diff="repair")
        progress.activate("edit-prepare-retest")
        decision_items = append_card(fc, DecisionItem(text="Applied the fix; ready to retest"))
        execution = progress.finish()
        change_lines = "\n".join(f"- {change}" for change in changes) or "- Repair applied"
        turn_items = append_assistant(
            env,
            s,
            fc,
            f"Applied {len(changes)} repair change(s) ({scope}).\n{change_lines}",
            execution=execution,
            turn_id=progress.operation_id,
        )
        return StepResult(next=PcState.EDIT_APPLY_CHANGES, context=fc, items=[*decision_items, *turn_items])
    if kind == "keep_draft":
        items = append_card(fc, DecisionItem(text="Kept the draft despite the failure"))
        return StepResult(next=PcState.EDIT_REVIEW, context=fc, items=items)
    if kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.EDIT_AWAIT_REPAIR, context=fc)


def handle_review(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) Final user decision before publish or completion."""
    kind = action_kind(turn)
    if kind == "publish_workflow":
        return StepResult(
            next=PcState.EDIT_PUBLISH,
            context=fc,
            items=append_card(fc, DecisionItem(text="Chose to publish")),
        )
    if kind == "keep_draft":
        emit_canvas(env, "cancel_publish")
        decision_items = append_card(fc, DecisionItem(text="Kept the draft"))
        turn_items = append_assistant(
            env,
            s,
            fc,
            f"Edit complete and kept as a draft. Changes: {'; '.join(fc.plan_items) or 'configuration edit'}.",
        )
        return StepResult(next=PcState.EDIT_COMPLETE, context=fc, items=[*decision_items, *turn_items])
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
                variant="edit_rules",
                title="Review the change rules",
                description="Adjust any values before Builder applies the change plan.",
                fields=build_form_fields(fc.form_fields),
                values=dict(fc.edit_rules),
                frozen=False,
            ),
        )
        target_text = ", ".join(fc.edit_target_node_ids) or "none identified"
        turn_items = append_assistant(
            env,
            s,
            fc,
            f"Let's adjust the change. Affected nodes: {target_text}. "
            "The rules may change branching or output, so review them before applying.",
            cards=["form"],
        )
        return StepResult(
            next=PcState.EDIT_IMPACT_ANALYSIS,
            context=fc,
            items=[*decision_items, *form_items, *turn_items],
        )
    if kind == "undo":  # revert
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.EDIT_REVIEW, context=fc)


def handle_publish(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(working, auto) Publish the updated workflow and close the edit flow."""
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[("edit-publish-workflow", "Publish the updated workflow")],
    )
    progress.activate("edit-publish-workflow")
    published = env.dify.publish(s.app_id, turn.actor)
    emit_canvas(env, "publish_workflow")
    execution = progress.finish()
    items = append_assistant(
        env,
        s,
        fc,
        f"Published workflow version {published.version_name} ({published.status}). Edit complete.",
        execution=execution,
        turn_id=progress.operation_id,
    )
    return StepResult(next=PcState.EDIT_COMPLETE, context=fc, items=items)


def handle_reverted(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """(waiting) After a revert. ``retry_after_revert`` (resolved to re_fix)
    re-proposes the change plan, self-mints a fresh pre-edit checkpoint, and
    returns to edit.plan_approval (spec §7.2)."""
    kind = action_kind(turn)
    if kind != "re_fix":
        return StepResult(next=PcState.EDIT_REVERTED, context=fc)

    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("edit-rebuild-plan", "Rebuild the change plan"),
            ("edit-create-checkpoint", "Create a new pre-edit checkpoint"),
        ],
    )
    progress.activate("edit-rebuild-plan")
    fc.checkpoint_seq = fc.next_seq
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    fc.plan_items = env.agent.propose_edit_plan(dict(fc.edit_rules), graph)
    fc.test_input_ref = ""
    fc.verify_run_id = ""
    progress.activate("edit-create-checkpoint")
    mint_checkpoint(env, s, fc, graph, graph_hash, PcState.EDIT_PLAN_APPROVAL)
    plan_items = append_card(fc, PlanCard(title="Change plan", items=list(fc.plan_items)))
    execution = progress.finish()
    turn_items = append_assistant(
        env,
        s,
        fc,
        "Re-approve to apply the change.",
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
