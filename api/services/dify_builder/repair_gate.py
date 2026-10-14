"""Stage Fix proposals and distinguish repair approval from an empty proposal."""

from typing import cast

from core.dify_builder.contract import Action, ActionKind, DecisionItem
from core.dify_builder.handlers_fix import action_kind, append_assistant, append_card
from core.dify_builder.models import Diagnosis, DifyBuilderContext, Session, Turn
from core.dify_builder.progress import ProgressReporter
from core.dify_builder.runner import Env, StepResult
from core.dify_builder.state import PcState
from services.dify_builder.copy_ids import BuilderCopyId
from services.dify_builder.presentation import copy_text, text_parts

NO_REPAIR_REPLY = copy_text(BuilderCopyId.REPLIES_NO_AUTOMATIC_FIX_FOUND_TRY_AGAIN_OR_FINISH_THIS_SESSION)
NO_REPAIR_REASON = "No safe automatic fix found — try again or finish this session."
NO_REPAIR_DECISION_COPY = (
    copy_text(BuilderCopyId.LABELS_NO_REPAIR_AVAILABLE),
    copy_text(BuilderCopyId.REPLIES_TRY_AGAIN_TO_FIND_A_REPAIR_OR_FINISH_THIS_SESSION),
)
RETRY_REPAIR_TEXT = copy_text(BuilderCopyId.LABELS_RETRYING_THE_REPAIR)
FINISH_REPAIR_TEXT = copy_text(BuilderCopyId.LABELS_FINISHED_THE_REPAIR_ATTEMPT)
NO_REPAIR_ACTIONS = (
    Action(id="retry_repair", label=copy_text(BuilderCopyId.ACTIONS_TRY_AGAIN), kind=ActionKind.PRIMARY),
    Action(
        id="finish_repair",
        label=copy_text(BuilderCopyId.ACTIONS_FINISH),
        kind=ActionKind.SECONDARY,
        next_state=str(PcState.SUCCESS),
    ),
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
        reply_language=fc.reply_language,
        stage_id=str(s.current_state),
        steps=[
            ("fix-prepare-context", copy_text(BuilderCopyId.PROGRESS_PREPARE_REPAIR_CONTEXT)),
            ("fix-propose-repair", copy_text(BuilderCopyId.PROGRESS_PROPOSE_A_SAFE_REPAIR)),
            ("fix-assess-risk", copy_text(BuilderCopyId.PROGRESS_ASSESS_REPAIR_RISK)),
        ],
    )
    progress.activate("fix-prepare-context")
    graph, _ = env.dify.read_graph(s.app_id, turn.actor)
    progress.activate("fix-propose-repair")
    # Both proposal states are entered after their diagnosis has committed.
    if fc.source != "checklist" and fc.failed_run_id:
        from services.dify_builder.condition_evidence import propose_failure

        intents, risk = propose_failure(
            env, s.app_id, turn.actor, env.repo.get_run(fc.failed_run_id), cast(Diagnosis, fc.diagnosis), graph
        )
    else:
        intents, risk = env.agent.propose_repair(cast(Diagnosis, fc.diagnosis), graph)
    fc.staged_repair = intents
    fc.risk = risk

    progress.activate("fix-assess-risk")
    next_state = PcState.FIX_APPLY
    if not intents or risk.level == "high" or risk.has_external_side_effect:
        next_state = PcState.FIX_AWAIT_APPROVAL

    if intents:
        proposed_changes = "\n".join(f"- `{intent.op}`" for intent in intents)
        reply_text = text_parts(
            copy_text(BuilderCopyId.REPAIR_PROPOSED, level=risk.level, count=len(intents)),
            ".\n",
            proposed_changes,
            (text_parts("\n", copy_text(BuilderCopyId.REPAIR_RISK_NOTE, reason=risk.reason)) if risk.reason else ""),
        )
    else:
        reply_text = NO_REPAIR_REPLY
        if risk.reason and risk.reason != NO_REPAIR_REASON:
            reply_text = text_parts(reply_text, "\n", copy_text(BuilderCopyId.REPAIR_REASON, reason=risk.reason))
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
            items = append_card(fc, DecisionItem(text=copy_text(BuilderCopyId.LABELS_REJECTED_THE_PROPOSED_REPAIR)))
            return StepResult(next=PcState.FIX_AWAIT_DECISION, context=fc, items=items)
    return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=fc)
