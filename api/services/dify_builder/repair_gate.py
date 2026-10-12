"""Stage Fix proposals and distinguish repair approval from an empty proposal."""

from typing import cast

from core.dify_builder.contract import Action, ActionKind, DecisionItem
from core.dify_builder.handlers_fix import action_kind, append_assistant, append_card
from core.dify_builder.models import Diagnosis, DifyBuilderContext, Session, Turn
from core.dify_builder.progress import ProgressReporter
from core.dify_builder.runner import Env, StepResult
from core.dify_builder.state import PcState

NO_REPAIR_REPLY = "No automatic fix found — try again or finish this session."
NO_REPAIR_REASON = "No safe automatic fix found — try again or finish this session."
NO_REPAIR_DECISION_COPY = ("No repair available", "Try again to find a repair, or finish this session.")
RETRY_REPAIR_TEXT = "Retrying the repair"
FINISH_REPAIR_TEXT = "Finished the repair attempt"
NO_REPAIR_ACTIONS = (
    Action(id="retry_repair", label="Try again", kind=ActionKind.PRIMARY),
    Action(id="finish_repair", label="Finish", kind=ActionKind.SECONDARY, next_state=str(PcState.SUCCESS)),
)
STATIC_COPY = frozenset(
    {
        NO_REPAIR_REPLY,
        NO_REPAIR_REASON,
        *NO_REPAIR_DECISION_COPY,
        RETRY_REPAIR_TEXT,
        FINISH_REPAIR_TEXT,
        *(action.label for action in NO_REPAIR_ACTIONS),
    }
)


def handle_propose(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """Stage a proposed repair; empty proposals always wait for retry or finish.

    Shared by run failures and checklist failures. A usable low-risk repair
    may still apply automatically; high-risk repairs require approval.
    """
    progress = ProgressReporter.for_session(
        emit=env.emit_progress,
        operation_id=env.operation_id,
        session=s,
        stage_id=str(s.current_state),
        steps=[
            ("fix-prepare-context", "Prepare repair context"),
            ("fix-propose-repair", "Propose a safe repair"),
            ("fix-assess-risk", "Assess repair risk"),
        ],
    )
    progress.activate("fix-prepare-context")
    graph, _ = env.dify.read_graph(s.app_id, turn.actor)
    progress.activate("fix-propose-repair")
    # Both proposal states are entered after their diagnosis has committed.
    intents, risk = env.agent.propose_repair(cast(Diagnosis, fc.diagnosis), graph)
    fc.staged_repair = intents
    fc.risk = risk

    progress.activate("fix-assess-risk")
    next_state = PcState.FIX_APPLY
    if not intents or risk.level == "high" or risk.has_external_side_effect:
        next_state = PcState.FIX_AWAIT_APPROVAL

    if intents:
        proposed_changes = "\n".join(f"- `{intent.op}`" for intent in intents)
        reply_text = f"Proposed repair (risk: {risk.level}, {len(intents)} change(s)).\n{proposed_changes}" + (
            f"\nRisk note: {risk.reason}" if risk.reason else ""
        )
    else:
        reply_text = NO_REPAIR_REPLY
        if risk.reason and risk.reason != NO_REPAIR_REASON:
            reply_text += f"\nReason: {risk.reason}"
    items = append_assistant(
        env,
        s,
        fc,
        reply_text,
        execution=progress.finish(),
        turn_id=progress.operation_id,
    )
    return StepResult(next=next_state, context=fc, items=items)


def handle_await_approval(env: Env, turn: Turn, s: Session, fc: DifyBuilderContext) -> StepResult:
    """Approve/reject an actual repair, or retry/finish when nothing is staged.

    Retry diagnoses the original source again. Finish completes the session
    without applying a repair, running validation, publishing, or reverting.
    """
    kind = action_kind(turn)
    if not fc.staged_repair:
        if kind == "retry_repair":
            fc.diagnosis = None
            fc.risk = None
            fc.change_set = None
            fc.test_input_ref = ""
            fc.verify_run_id = ""
            fc.unknown_outcome_count = 0
            next_state = PcState.CHECKLIST_DIAGNOSE if fc.source == "checklist" else PcState.FIX_DIAGNOSE
            return StepResult(next=next_state, context=fc, items=append_card(fc, DecisionItem(text=RETRY_REPAIR_TEXT)))
        if kind == "finish_repair":
            return StepResult(
                next=PcState.SUCCESS, context=fc, items=append_card(fc, DecisionItem(text=FINISH_REPAIR_TEXT))
            )
    else:
        if kind == "approve_repair":
            return StepResult(next=PcState.FIX_APPLY, context=fc)
        if kind == "reject_repair":
            items = append_card(fc, DecisionItem(text="Rejected the proposed repair"))
            return StepResult(next=PcState.FIX_AWAIT_DECISION, context=fc, items=items)
    return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=fc)
