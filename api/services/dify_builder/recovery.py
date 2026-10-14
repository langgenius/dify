"""Recovery command orchestration and re-entry using durable session inputs."""

from core.dify_builder.models import Action, ConversationItem, DifyBuilderContext, Session, Turn
from core.dify_builder.ports import DifyPort
from core.dify_builder.recovery import apply_recovery_action
from core.dify_builder.state import PcState


def prepare_recovery_step(
    dify: DifyPort, turn: Turn, session: Session, context: DifyBuilderContext
) -> tuple[PcState, list[ConversationItem], Turn]:
    """Prepare the recovery commit and consume its action before re-entry.

    Edit sessions persist their goal before the initial dispatch. Re-entering
    their waiting entry handler therefore needs an internal send_edit_goal,
    rather than another user choice or a duplicated user message.
    """
    action = turn.action
    assert action is not None
    # Recovery invalidates a reserved real call; a later call needs fresh consent.
    context.confirmed_consent_id = ""
    context.confirmed_command_id = ""
    response_item = None
    if action.interaction_response is not None:
        response_item = ConversationItem(
            seq=context.next_seq,
            kind="interaction_response",
            payload=action.interaction_response,
            at_version=session.version + 1,
        )
        context.next_seq += 1
    next_state, items = apply_recovery_action(dify, turn, session, context)
    if response_item is not None:
        items.insert(0, response_item)

    followup = Turn(actor=turn.actor)
    if action.kind in {"recovery_continue", "recovery_restart"} and next_state == PcState.EDIT_CAPABILITY_CHECK:
        followup.action = Action(
            kind="send_edit_goal",
            payload={"text": context.goal_text},
            base_version=session.version + 1,
            base_app_revision=context.last_snapshot_hash,
            command_id=action.command_id,
        )
    return next_state, items, followup
