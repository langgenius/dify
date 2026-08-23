"""Edit-flow handlers: pure ``(env, turn, session, fc) -> StepResult`` steps.

Mirrors ``handlers_build.py`` for the Edit entry mode (spec: docs/superpowers/
specs/2026-08-23-workflow-copilot-slice3-edit-design.md). Cards for a state are
emitted by the handler transitioning INTO it; ``edit.test_affected_paths`` is a
working state that auto-advances; the edit itself rides on
``handle_plan_approval`` (approve_plan) and the publish rides on
``handle_review`` (publish_workflow) because ``edit.apply_changes`` is a waiting
state and ``edit.publish`` is terminal (no handler). Per the product mock
(02-edit.txt:36-39) publish AND keep_draft both finish the task at edit.publish.
"""

import uuid

from core.workflow_copilot.contract import (
    AssistantTurnItem,
    ChallengeCard,
    ChangeSetCard,
    CheckpointCard,
    DecisionItem,
    FormCard,
    FormField,
    PlanCard,
    PublishCard,
    SummaryCard,
    SummaryRow,
    TestResultCard,
    TestStat,
    Trace,
    TraceStep,
)
from core.workflow_copilot.handlers_fix import action_string, append_card
from core.workflow_copilot.models import ChangeSet, Checkpoint, CopilotContext, Session, Snapshot, Turn
from core.workflow_copilot.runner import Env, Handler, StepResult
from core.workflow_copilot.state import PcState

__all__ = [
    "edit_registry",
    "handle_apply_changes",
    "handle_capability_check",
    "handle_impact_analysis",
    "handle_plan_approval",
    "handle_reverted",
    "handle_review",
    "handle_test_affected_paths",
]


def _emit_canvas(env: Env, event: str, **extra) -> None:
    """Fire a granular canvas event iff the caller wired ``env.emit_canvas``
    (opt-in; None is a no-op, mirroring how apply_repair treats on_canvas)."""
    if env.emit_canvas is not None:
        env.emit_canvas({"event": event, **extra})


_EDIT_RULE_FIELDS = [
    FormField(key="risk_threshold", label="Risk threshold", type="text"),
    FormField(key="review_team", label="Review team", type="select", options=["compliance", "legal", "engineering"]),
    FormField(key="timeout_behavior", label="Timeout behavior", type="select", options=["fail_open", "fail_closed"]),
    FormField(key="preserve_summary", label="Preserve summary", type="bool"),
]

_EDIT_RULE_KEYS = ("risk_threshold", "review_team", "timeout_behavior", "preserve_summary")


def handle_capability_check(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) Entry state. On ``send_edit_goal`` read the existing graph,
    emit a read-only context summary, analyze impact into edit_rules + target
    nodes (highlighting them), and transition to edit.impact_analysis emitting
    its form + challenge + change_set(preview). The canvas is read only here,
    after the goal is sent (mock 02-edit.txt:3,9)."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind != "send_edit_goal":
        return StepResult(next=PcState.EDIT_CAPABILITY_CHECK, context=fc)

    text, ok = action_string(turn, "text")
    if ok and text:
        fc.goal_text = text

    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
    node_count = len(graph.get("nodes", []))
    edge_count = len(graph.get("edges", []))

    impact = env.agent.analyze_impact(fc.goal_text, graph)
    fc.edit_rules = dict(impact.get("edit_rules", {}))
    fc.edit_target_node_ids = list(impact.get("target_node_ids", []))

    for node_id in fc.edit_target_node_ids:
        _emit_canvas(env, "highlight_edit_target", node_id=node_id)

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
        FormCard(variant="edit_rules", fields=list(_EDIT_RULE_FIELDS), values=dict(fc.edit_rules), frozen=False),
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


def handle_impact_analysis(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) On ``submit_edit_rules`` merge the form payload, propose the
    change plan, self-mint the pre-edit checkpoint (so the CheckpointCard at
    plan_approval carries a real id -- mirrors Build's handle_resource_
    recommendation), and transition to edit.plan_approval."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind != "submit_edit_rules":
        return StepResult(next=PcState.EDIT_IMPACT_ANALYSIS, context=fc)

    if turn.action is not None and isinstance(turn.action.payload, dict):
        merged = dict(fc.edit_rules)
        for key in _EDIT_RULE_KEYS:
            if key in turn.action.payload:
                merged[key] = turn.action.payload[key]
        fc.edit_rules = merged

    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    fc.plan_items = env.agent.propose_edit_plan(dict(fc.edit_rules), graph)
    fc.plan_version_tag = "v1"

    checkpoint = Checkpoint(id=str(uuid.uuid4()), session_id=s.id, state=PcState.EDIT_PLAN_APPROVAL)
    env.repo.create_checkpoint(checkpoint, Snapshot(session_id=s.id, hash=graph_hash, graph=graph))
    fc.checkpoint_id = checkpoint.id
    fc.last_snapshot_hash = graph_hash

    decision_items = append_card(fc, DecisionItem(text="Submitted edit rules"))
    plan_items = append_card(fc, PlanCard(title="Change plan", version_tag="v1", items=list(fc.plan_items)))
    checkpoint_items = append_card(
        fc, CheckpointCard(checkpoint_id=checkpoint.id, label="Pre-edit checkpoint", created_at="")
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


def handle_plan_approval(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) THE EDIT. Only ``approve_repair`` (resolved from approve_plan)
    applies: read the current graph, get the canned set_node_config intents,
    highlight the targets, apply once (on_canvas=None -- Edit narrates its own
    coarse apply_edit_plan rather than the Fix-flavored per-intent apply_error_
    fix), emit the real change_set + checkpoint + assistant_turn, transition to
    edit.apply_changes.

    Naturally idempotent on loop-back re-approve: re-applying the same
    set_node_config value overwrites the node's data (no ValueError, unlike
    Build's create_node); a re-approve simply yields an empty diff."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind != "approve_repair":
        return StepResult(next=PcState.EDIT_PLAN_APPROVAL, context=fc)

    _emit_canvas(env, "create_checkpoint")
    graph, _hash = env.dify.read_graph(s.app_id, turn.actor)
    intents = env.agent.build_edit_intents(dict(fc.edit_rules), graph)
    fc.staged_repair = list(intents)

    for node_id in fc.edit_target_node_ids:
        _emit_canvas(env, "highlight_edit_target", node_id=node_id)

    result = env.dify.apply_repair(s.app_id, turn.actor, intents, on_canvas=None)
    fc.last_snapshot_hash = result.new_hash
    _emit_canvas(env, "apply_edit_plan")

    changes = list(result.changes) if result.changes else list(result.changed_nodes)
    scope = result.scope or "configuration"
    fc.change_set = ChangeSet(changed_nodes=result.changed_nodes, diff="; ".join(changes) or "no changes")

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


def handle_apply_changes(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) At rest after the edit. ``run_affected_tests`` -> edit.test_
    affected_paths; ``revert`` (resolved to ``undo``) -> edit.reverted (intent
    only)."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind == "undo":
        _emit_canvas(env, "revert_checkpoint")
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    if kind == "run_affected_tests":
        _emit_canvas(env, "start_test_run")
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


def handle_test_affected_paths(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(working, auto) Canned affected-path test: emit a success test_result +
    the review summary + change_set, transition to edit.review. No live
    run_draft (spec: canned)."""
    _emit_canvas(env, "mark_test_success")
    test_result_items = append_card(
        fc,
        TestResultCard(
            title="Affected-path tests",
            subtitle="All checks passed",
            tone="success",
            stats=[TestStat(value="1", label="runs"), TestStat(value="0", label="errors")],
            run_ids=[],
        ),
    )
    changed = list(fc.change_set.changed_nodes) if fc.change_set else []
    change_set_items = append_card(
        fc,
        ChangeSetCard(
            count=len(changed),
            changes=[f"edited {nid}" for nid in changed],
            scope="configuration",
            full_diff_open=False,
        ),
    )
    _emit_canvas(env, "mark_review_ready")
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
            cards=["test_result", "change_set", "summary"],
        ),
    )
    return StepResult(
        next=PcState.EDIT_REVIEW,
        context=fc,
        items=[*test_result_items, *change_set_items, *summary_items, *turn_items],
    )


def _completion_rows(fc: CopilotContext, status: str) -> list[SummaryRow]:
    return [
        SummaryRow(label="Change", value="; ".join(fc.plan_items) or "config edit"),
        SummaryRow(label="Status", value=status),
    ]


def handle_review(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) Terminal decision. Mock 02-edit.txt:36-39: publish_workflow AND
    keep_draft both = Task Completed -> edit.publish (terminal). Because edit.
    publish runs no handler, this handler emits its cards before returning.
    continue_adjusting (resolved re_fix) -> edit.impact_analysis (re-analyze);
    revert (undo) -> edit.reverted (intent only)."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind == "publish_workflow":
        env.dify.publish(s.app_id, turn.actor)
        _emit_canvas(env, "publish_workflow")
        decision_items = append_card(fc, DecisionItem(text="Chose to publish"))
        publish_items = append_card(fc, PublishCard(version="2.1", badge="live"))
        summary_items = append_card(
            fc, SummaryCard(variant="completion", title="Edit published", rows=_completion_rows(fc, "Published"))
        )
        return StepResult(
            next=PcState.EDIT_PUBLISH, context=fc, items=[*decision_items, *publish_items, *summary_items]
        )
    if kind == "keep_draft":
        _emit_canvas(env, "cancel_publish")
        decision_items = append_card(fc, DecisionItem(text="Kept the draft"))
        summary_items = append_card(
            fc, SummaryCard(variant="completion", title="Draft kept", rows=_completion_rows(fc, "Draft kept"))
        )
        return StepResult(next=PcState.EDIT_PUBLISH, context=fc, items=[*decision_items, *summary_items])
    if kind == "re_fix":  # continue_adjusting -> re-analyze impact
        _emit_canvas(env, "cancel_publish")
        for node_id in fc.edit_target_node_ids:
            _emit_canvas(env, "highlight_edit_target", node_id=node_id)
        decision_items = append_card(fc, DecisionItem(text="Continue adjusting"))
        form_items = append_card(
            fc, FormCard(variant="edit_rules", fields=list(_EDIT_RULE_FIELDS), values=dict(fc.edit_rules), frozen=False)
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
        _emit_canvas(env, "revert_checkpoint")
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.EDIT_REVERTED, context=fc, items=items)
    return StepResult(next=PcState.EDIT_REVIEW, context=fc)


def handle_reverted(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) After a revert. ``retry_after_revert`` (resolved to re_fix)
    re-proposes the change plan, self-mints a fresh pre-edit checkpoint, and
    returns to edit.plan_approval (spec §7.2)."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind != "re_fix":
        return StepResult(next=PcState.EDIT_REVERTED, context=fc)
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    fc.plan_items = env.agent.propose_edit_plan(dict(fc.edit_rules), graph)
    fc.plan_version_tag = "v1"
    checkpoint = Checkpoint(id=str(uuid.uuid4()), session_id=s.id, state=PcState.EDIT_PLAN_APPROVAL)
    env.repo.create_checkpoint(checkpoint, Snapshot(session_id=s.id, hash=graph_hash, graph=graph))
    fc.checkpoint_id = checkpoint.id
    fc.last_snapshot_hash = graph_hash
    plan_items = append_card(fc, PlanCard(title="Change plan", version_tag="v1", items=list(fc.plan_items)))
    checkpoint_items = append_card(
        fc, CheckpointCard(checkpoint_id=checkpoint.id, label="Pre-edit checkpoint", created_at="")
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
        PcState.EDIT_TEST_AFFECTED_PATHS: handle_test_affected_paths,
        PcState.EDIT_REVIEW: handle_review,
        PcState.EDIT_REVERTED: handle_reverted,
    }
