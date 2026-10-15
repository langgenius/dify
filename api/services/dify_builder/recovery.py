"""Recovery command orchestration and re-entry using durable session inputs."""

from core.dify_builder.contract import RecoveryClass
from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Action, ConversationItem, DifyBuilderContext, Session, Turn
from core.dify_builder.ports import DifyPort
from core.dify_builder.recovery import apply_recovery_action, classify
from core.dify_builder.state import PcState, is_terminal, is_waiting


def prepare_recovery_step(
    dify: DifyPort, turn: Turn, session: Session, context: DifyBuilderContext
) -> tuple[PcState, list[ConversationItem], Turn, bool]:
    """Prepare the recovery commit and consume its action before re-entry.

    Edit sessions persist their goal before the initial dispatch. Re-entering
    their waiting entry handler therefore needs an internal send_edit_goal,
    rather than another user choice or a duplicated user message.
    The final flag tells the runner to settle instead of executing a handler.
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
    if action.kind == "recovery_continue" and context.recovery_class:
        # A cached recovery offer needs fresh classification. An interrupted
        # retry without an offer is already admitted against an unchanged
        # baseline; the rebase below still has to match its revision token.
        graph, revision = dify.read_graph(session.app_id, turn.actor)
        if action.base_app_revision and revision != action.base_app_revision:
            raise ConflictError(f"stale app revision for app {session.app_id}")
        current_class = classify(
            revision,
            dify.structural_fingerprint(graph),
            dify.graph_node_ids(graph),
            context,
            session.entry_mode,
        )
        if current_class == RecoveryClass.STRUCTURAL_INVALIDATING:
            # The offer may predate another editor's structural changes. Show
            # the current classification without rebasing or running a handler.
            context.recovery_class = str(current_class)
            return session.current_state, [response_item] if response_item else [], Turn(actor=turn.actor), True
    next_state, items = apply_recovery_action(dify, turn, session, context)
    if (
        action.kind in {"recovery_continue", "recovery_restart"}
        and action.base_app_revision
        and context.last_snapshot_hash != action.base_app_revision
    ):
        # The recovery owner reads again when rebasing. Fence that read too:
        # a later patch must never treat unacknowledged drift as its baseline.
        raise ConflictError(f"stale app revision for app {session.app_id}")
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
    # A check only classifies drift, even when the interrupted state is a
    # working handler. Execution requires a separate continue/restart choice.
    settled = action.kind == "check_recovery" or (
        (is_waiting(next_state) or is_terminal(next_state)) and followup.action is None
    )
    return next_state, items, followup, settled
