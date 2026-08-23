"""Build-flow handlers: pure ``(env, turn, session, fc) -> StepResult`` steps.

Mirrors ``handlers_fix.py`` for the Build entry mode (spec: docs/superpowers/
specs/2026-08-22-workflow-copilot-slice2-build-design.md). Cards for a state
are emitted by the handler transitioning INTO it; working states auto-advance;
the build itself rides on ``handle_plan_approval`` (approve_plan) because
``build.execution`` is a waiting state. ``build.complete`` is terminal and has
no handler -- its completion summary is emitted by ``handle_governance_feedback``.
"""

import uuid

from core.workflow_copilot.contract import (
    AssistantTurnItem,
    ChallengeCard,
    ConflictPolicyOption,
    DecisionItem,
    FormCard,
    FormField,
    PlanCard,
    ResourceSelectCard,
    Trace,
)
from core.workflow_copilot.handlers_fix import action_string, append_card
from core.workflow_copilot.models import CopilotContext, Session, Turn
from core.workflow_copilot.runner import Env, Handler, StepResult
from core.workflow_copilot.state import PcState

__all__ = ["build_registry", "handle_capability_check", "handle_goal_analysis", "handle_initial_plan"]


def _emit_canvas(env: Env, event: str, **extra) -> None:
    """Fire a granular canvas event iff the caller wired ``env.emit_canvas``
    (opt-in; None is a no-op, mirroring how apply_repair treats on_canvas)."""
    if env.emit_canvas is not None:
        env.emit_canvas({"event": event, **extra})


_REQUIREMENT_FIELDS = [
    FormField(key="report_types", label="Report types", type="text"),
    FormField(key="audience", label="Audience", type="text"),
    FormField(key="currency", label="Currency", type="text"),
    FormField(key="metrics", label="Metrics", type="text"),
    FormField(key="output", label="Output", type="textarea"),
    FormField(key="prefer_audited", label="Prefer audited sources", type="bool"),
]


def handle_capability_check(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) Entry state. On ``send_goal`` reset the canvas, analyze the
    goal into requirements, and transition to build.goal_analysis emitting its
    form + challenge cards."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind != "send_goal":
        return StepResult(next=PcState.BUILD_CAPABILITY_CHECK, context=fc)

    text, ok = action_string(turn, "text")
    if ok and text:
        fc.goal_text = text
    _emit_canvas(env, "reset_build_canvas")
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


def handle_goal_analysis(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) On ``submit_requirements`` merge the form payload, propose
    plan v1, and transition to build.initial_plan emitting the plan card."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind != "submit_requirements":
        return StepResult(next=PcState.BUILD_GOAL_ANALYSIS, context=fc)

    if turn.action is not None and isinstance(turn.action.payload, dict):
        merged = dict(fc.requirements)
        for key in _REQUIREMENT_KEYS:
            if key in turn.action.payload:
                merged[key] = turn.action.payload[key]
        fc.requirements = merged

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


def handle_initial_plan(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) On ``find_resources`` discover the (canned, ready) resource
    and transition to build.resource_recommendation."""
    kind = turn.action.kind if turn.action is not None else ""
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


def build_registry() -> dict[PcState, Handler]:
    """The Build handler table. Grows across Slice 2 tasks; ``build.complete``
    is terminal and intentionally absent (the loop returns before lookup)."""
    return {
        PcState.BUILD_CAPABILITY_CHECK: handle_capability_check,
        PcState.BUILD_GOAL_ANALYSIS: handle_goal_analysis,
        PcState.BUILD_INITIAL_PLAN: handle_initial_plan,
    }
