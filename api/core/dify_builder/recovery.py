"""Structure-fingerprint recovery (C-1).

Detect a canvas hand-edit made while a dify_builder session waited, classify the
drift, and drive continue-vs-restart. Triggered by three free-string action
ids (``check_recovery`` / ``recovery_continue`` / ``recovery_restart``) that
the runner short-circuits on, exactly like ``stop`` / ``resume``.

Core-only: imports ``contract`` / ``models`` / ``ports`` / ``state`` and NEVER
``runner`` / ``handlers_fix`` / ``services`` -- the runner imports this module,
so importing back would cycle. For the same reason the recovery ``NoticeItem``
is stamped inline via the ``fc.next_seq`` protocol rather than reusing
``handlers_fix.append_card``.
"""

from core.dify_builder.contract import NoticeItem, RecoveryClass, RecoveryRef
from core.dify_builder.models import ConversationItem, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.ports import DifyPort
from core.dify_builder.state import PcState

__all__ = [
    "apply_recovery_action",
    "classify",
    "entry_state_for",
    "recovery_ref_for",
    "target_node_ids",
]

_ENTRY_STATE: dict[EntryMode, PcState] = {
    EntryMode.FIX: PcState.FIX_DIAGNOSE,
    EntryMode.FIX_CHECKLIST: PcState.CHECKLIST_DIAGNOSE,
    EntryMode.BUILD: PcState.BUILD_CAPABILITY_CHECK,
    EntryMode.EDIT: PcState.EDIT_CAPABILITY_CHECK,
}

_RECOVERY_MESSAGE: dict[RecoveryClass, str] = {
    RecoveryClass.UNCHANGED: "No changes since you last left — resuming where you were.",
    RecoveryClass.CONFIG_ONLY: "Only node settings changed since you left — continue or restart.",
    RecoveryClass.STRUCTURAL_COMPATIBLE: (
        "The workflow structure changed, but the nodes this task targets are still present — continue or restart."
    ),
    RecoveryClass.STRUCTURAL_INVALIDATING: (
        "The nodes this task was working on are no longer in the workflow — restart to work from the current draft."
    ),
}


def entry_state_for(entry_mode: EntryMode) -> PcState:
    """The state a fresh session of this mode starts in. Mirrors
    ``service.create_*_session``; a parity test guards drift."""
    return _ENTRY_STATE[entry_mode]


def recovery_ref_for(recovery_class: str) -> RecoveryRef | None:
    """Build the SessionView recovery offer from a stored class string.
    ``None`` when there is no active recovery (``recovery_class == ""``).
    can_continue is false only for a structural-invalidating drift; can_restart
    is false only when nothing changed."""
    if not recovery_class:
        return None
    return RecoveryRef(
        recovery_class=recovery_class,
        can_continue=recovery_class != RecoveryClass.STRUCTURAL_INVALIDATING,
        can_restart=recovery_class != RecoveryClass.UNCHANGED,
        message=_RECOVERY_MESSAGE.get(recovery_class, ""),
    )


def target_node_ids(fc: DifyBuilderContext, entry_mode: EntryMode) -> list[str]:
    """The node ids this task is about -- used to tell a structural edit that
    LEAVES the targets intact (compatible) from one that removes them
    (invalidating)."""
    if entry_mode == EntryMode.BUILD:
        return list(fc.built_node_ids)
    if entry_mode == EntryMode.EDIT:
        return list(fc.edit_target_node_ids)
    ids: list[str] = []
    if entry_mode == EntryMode.FIX_CHECKLIST:
        ids = [e.node_id for e in fc.checklist_errors if e.node_id]
    if fc.diagnosis is not None and fc.diagnosis.culprit_node_id and fc.diagnosis.culprit_node_id not in ids:
        ids.append(fc.diagnosis.culprit_node_id)
    return ids


def classify(
    cur_hash: str,
    cur_fingerprint: str,
    present_node_ids: list[str],
    fc: DifyBuilderContext,
    entry_mode: EntryMode,
) -> RecoveryClass:
    """Four-way drift classification (C-1)."""
    if cur_hash == fc.last_snapshot_hash:
        return RecoveryClass.UNCHANGED
    if cur_fingerprint == fc.last_structure_fingerprint:
        return RecoveryClass.CONFIG_ONLY
    if set(target_node_ids(fc, entry_mode)) <= set(present_node_ids):
        return RecoveryClass.STRUCTURAL_COMPATIBLE
    return RecoveryClass.STRUCTURAL_INVALIDATING


def _append_notice(fc: DifyBuilderContext, text: str) -> ConversationItem:
    """Stamp one NoticeItem via the fc.next_seq protocol (see module docstring
    for why this is inlined rather than using handlers_fix.append_card)."""
    item = NoticeItem(text=text).to_item(seq=fc.next_seq, at_version=0)
    fc.next_seq += 1
    return item


def _reset_working_fields(fc: DifyBuilderContext) -> None:
    """Clear per-flow working state for a clean re-entry. Preserves the
    conversation, next_seq, and the mode's durable inputs (goal_text,
    requirements, edit_rules, checklist_errors, failed_run_id, source)."""
    fc.diagnosis = None
    fc.staged_repair = []
    fc.risk = None
    fc.change_set = None
    fc.checkpoint_id = ""
    fc.checkpoint_seq = 0
    fc.verify_run_id = ""
    fc.test_input_ref = ""
    fc.plan_items = []
    fc.plan_version_tag = ""
    fc.resource_selection = {}
    fc.built_node_ids = []
    fc.edit_target_node_ids = []
    fc.last_snapshot_hash = ""
    fc.last_structure_fingerprint = ""
    fc.paused = False


def apply_recovery_action(
    dify: DifyPort, turn: Turn, s: Session, fc: DifyBuilderContext
) -> tuple[PcState, list[ConversationItem]]:
    """Handle check_recovery / recovery_continue / recovery_restart. Returns
    ``(next_state, items)`` for the runner to commit in a single CAS step.
    The runner guarantees ``turn.action.kind`` is one of the three."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind == "check_recovery":
        graph, cur_hash = dify.read_graph(s.app_id, turn.actor)
        cur_fp = dify.structural_fingerprint(graph)
        present = dify.graph_node_ids(graph)
        cls = classify(cur_hash, cur_fp, present, fc, s.entry_mode)
        fc.recovery_class = str(cls)
        return s.current_state, [_append_notice(fc, _RECOVERY_MESSAGE[cls])]
    if kind == "recovery_continue":
        graph, cur_hash = dify.read_graph(s.app_id, turn.actor)
        fc.last_snapshot_hash = cur_hash
        fc.last_structure_fingerprint = dify.structural_fingerprint(graph)
        fc.recovery_class = ""
        return s.current_state, [_append_notice(fc, "Continuing on the current plan.")]
    if kind == "recovery_restart":
        fc.recovery_class = ""
        _reset_working_fields(fc)
        graph, cur_hash = dify.read_graph(s.app_id, turn.actor)
        fc.last_snapshot_hash = cur_hash
        fc.last_structure_fingerprint = dify.structural_fingerprint(graph)
        return entry_state_for(s.entry_mode), [_append_notice(fc, "Restarted from the current draft.")]
    return s.current_state, []  # defensive: unreachable given the runner's guard
