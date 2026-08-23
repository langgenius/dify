"""Fix-flow handlers: pure ``(env, turn, session, fc) -> StepResult`` steps.

Port of dify-enterprise/server/pkg/enterprise/biz/copilot/handlers_fix.go —
both the run-fix subset (``handlers_fix.go:9-270,316-347``, Task 6) and the
checklist subset + merged registry (``handlers_fix.go:18-36,72,272,303``,
Task 7). ``checklist.propose`` deliberately reuses ``handle_propose`` (as Go
does) rather than defining a duplicate handler.

Deltas from the Go source (per the P1 port plan's Global Constraints / ADR):

- ``turn.Auth`` (Go's ``ForwardAuth``) becomes ``turn.actor``; the app id
  comes from ``session.app_id`` (``s.AppID`` in Go — same field, just
  ``snake_case``).
- Go's ``*string`` run-id sink has no Python equivalent (see
  ``runner.py``'s module docstring): a plain ``str`` field can't be mutated
  in place through a pointer. ``handle_verify`` therefore mints the verify
  run's id itself (so it can set ``fc.verify_run_id`` directly, matching
  what Go achieves via ``runIDSink: &fc.VerifyRunID`` aliasing the same
  struct field) and *also* reports it via ``StepResult.run_id_sink`` so the
  generic runner's write-back (``run_id_sink[0] = run.id``) stays a
  harmless no-op rather than silently doing nothing.
- Go returns ``(*StepResult, error)``; Python raises instead (handlers let
  ``NotFoundError`` / other port errors propagate uncaught, mirroring how
  Go's ``if err != nil { return nil, err }`` guards were a straight
  passthrough).
"""

import uuid
from typing import Any

from core.workflow_copilot.contract import (
    AssistantTurnItem,
    ChangeSetCard,
    DecisionItem,
    NoticeItem,
    SummaryCard,
    TestResultCard,
    Trace,
)
from core.workflow_copilot.models import (
    ChangeSet,
    ChecklistError,
    ConversationItem,
    CopilotContext,
    NodeOutput,
    Run,
    Session,
    Snapshot,
    TestInput,
    Turn,
)
from core.workflow_copilot.runner import Env, Handler, StepResult
from core.workflow_copilot.state import PcState

__all__ = [
    "action_string",
    "append_card",
    "append_item",
    "decode_checklist_errors",
    "first_failed_node",
    "fix_registry",
    "handle_apply",
    "handle_await_approval",
    "handle_await_decision",
    "handle_await_recheck",
    "handle_await_testdata",
    "handle_await_verify",
    "handle_checklist_diagnose",
    "handle_diagnose",
    "handle_propose",
    "handle_publish",
    "handle_verify",
    "perform_revert",
]


# ---- helpers ---------------------------------------------------------------


def append_item(fc: CopilotContext, kind: str, payload: dict[str, Any]) -> list[ConversationItem]:
    """Append a conversation item stamped with the next sequence number.

    ``fc.next_seq`` is the seq authority (port of ``handlers_fix.go:9-13``):
    every call stamps the current value then increments it, so a caller that
    forgets to route through here will collide with
    ``InMemoryRepository.compare_and_advance``'s ``(session_id, seq)``
    uniqueness guard.
    """
    item = ConversationItem(seq=fc.next_seq, kind=kind, payload=payload)
    fc.next_seq += 1
    return [item]


def append_card(fc: CopilotContext, card) -> list[ConversationItem]:
    """Stamp a typed card into the conversation at the next seq (mirrors
    append_item's seq authority; at_version preserved as the prior code's 0).
    """
    item = card.to_item(seq=fc.next_seq, at_version=0)
    fc.next_seq += 1
    return [item]


def action_string(turn: Turn, key: str) -> tuple[str, bool]:
    """Read a string field out of ``turn.action.payload``, Go-style ``(v, ok)``."""
    if turn.action is None:
        return "", False
    value = turn.action.payload.get(key)
    if isinstance(value, str):
        return value, True
    return "", False


def perform_revert(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> None:
    """Shared revert primitive (Slice 4). Emits the revert_checkpoint canvas
    signal; then, if an active checkpoint exists, restores the pre-change draft
    from its snapshot, invalidates the approval cards emitted since the
    checkpoint (assistant_turns with seq >= fc.checkpoint_seq), and clears the
    active restore point. A revert with no checkpoint (fc.checkpoint_id == "")
    emits the signal but changes no draft -- the pre-Slice-4 record-intent-only
    behavior, now centralized."""
    if env.emit_canvas is not None:
        env.emit_canvas({"event": "revert_checkpoint"})
    if not fc.checkpoint_id:
        return
    _cp, snap = env.repo.get_checkpoint(fc.checkpoint_id)
    fc.last_snapshot_hash = env.dify.restore_graph(s.app_id, turn.actor, snap.graph)
    env.repo.invalidate_conversation_items(s.id, fc.checkpoint_seq)
    fc.checkpoint_id = ""


def first_failed_node(nodes: list[NodeOutput]) -> str:
    for n in nodes:
        if n.status == "failed":
            return n.node_id
    return ""


def _mode_or_default(mode: str) -> str:
    return mode or "upload"


# ---- handlers ---------------------------------------------------------------


def handle_diagnose(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(working) Read the failed run's node outputs, diagnose, capture the
    pre-repair checkpoint. Port of ``handlers_fix.go:38``."""
    fc.checkpoint_seq = fc.next_seq
    failed = env.repo.get_run(fc.failed_run_id)
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    outputs = env.dify.node_outputs(s.app_id, turn.actor, failed.dify_run_id)
    diagnosis = env.agent.diagnose(failed, graph, outputs)
    fc.diagnosis = diagnosis
    fc.last_snapshot_hash = graph_hash

    items = append_card(
        fc,
        SummaryCard(
            variant="context",
            title="Diagnosis",
            items=[
                f"Root cause: {diagnosis.root_cause}",
                f"Culprit node: {diagnosis.culprit_node_id}",
                f"Severity: {diagnosis.severity}",
            ],
        ),
    )
    return StepResult(
        next=PcState.FIX_PROPOSE,
        context=fc,
        items=items,
        checkpoint=Snapshot(session_id=s.id, hash=graph_hash, graph=graph),
    )


def handle_propose(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(working) Ask the agent for repair intents + risk, stage them, branch
    on risk. Port of ``handlers_fix.go:97``. Also serves as
    ``checklist.propose`` (Task 7 reuses this handler, as Go does)."""
    graph, _ = env.dify.read_graph(s.app_id, turn.actor)
    intents, risk = env.agent.propose_repair(fc.diagnosis, graph)
    fc.staged_repair = intents
    fc.risk = risk

    next_state = PcState.FIX_APPLY
    if risk.level == "high" or risk.has_external_side_effect:
        next_state = PcState.FIX_AWAIT_APPROVAL

    items = append_card(
        fc,
        AssistantTurnItem(
            turn_id=str(uuid.uuid4()),
            stage_id="fix.propose",
            trace=Trace(status="completed", steps=[]),
            reply_text=f"Proposed repair (risk: {risk.level}, {len(intents)} change(s))",
            cards=[],
        ),
    )
    return StepResult(next=next_state, context=fc, items=items)


def handle_await_approval(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) High-risk gate. Only an explicit ``approve_repair`` advances
    to ``fix.apply``; any other/absent action kind is a no-op that stays at
    the gate. Port of ``handlers_fix.go:123``."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind == "approve_repair":
        return StepResult(next=PcState.FIX_APPLY, context=fc)
    if kind == "reject_repair":
        items = append_card(fc, DecisionItem(text="Rejected the proposed repair"))
        return StepResult(next=PcState.FIX_AWAIT_DECISION, context=fc, items=items)
    # unknown / absent action: do not auto-apply a high-risk repair; stay at the gate.
    return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=fc)


def handle_apply(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(working) Apply the staged repair to the real draft. The next state
    branches on ``fc.source``: the run-fix path always lands at
    ``fix.await_verify``; the checklist-fix path lands at
    ``checklist.await_recheck``. Port of ``handlers_fix.go:146``."""
    result = env.dify.apply_repair(s.app_id, turn.actor, fc.staged_repair, on_canvas=env.emit_canvas)
    fc.last_snapshot_hash = result.new_hash
    # Adapters that don't compute a real diff (e.g. FakeDifyPort in tests)
    # leave changes/scope empty -- fall back to the old changed_nodes/
    # "configuration" behavior so those callers stay green.
    changes = list(result.changes) if result.changes else list(result.changed_nodes)
    scope = result.scope or "configuration"
    fc.change_set = ChangeSet(changed_nodes=result.changed_nodes, diff="; ".join(changes) or "config edit")
    items = append_card(
        fc,
        ChangeSetCard(
            count=len(changes),
            changes=changes,
            scope=scope,
            full_diff_open=False,
        ),
    )

    next_state = PcState.FIX_AWAIT_VERIFY
    if fc.source == "checklist":
        next_state = PcState.CHECKLIST_AWAIT_RECHECK
    return StepResult(next=next_state, context=fc, items=items)


def handle_await_verify(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) The user runs verification or undoes. Port of
    ``handlers_fix.go:163``."""
    if turn.action is not None and turn.action.kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.FIX_AWAIT_DECISION, context=fc, items=items)
    # run_verify: if we have prepared inputs, go verify; else prepare test data.
    if fc.test_input_ref == "":
        return StepResult(next=PcState.FIX_AWAIT_TESTDATA, context=fc)
    return StepResult(next=PcState.FIX_VERIFY, context=fc)


def handle_await_testdata(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) Prepare inputs for the verify run. Port of
    ``handlers_fix.go:176``."""
    mode, _ = action_string(turn, "mode")
    inputs: dict[str, Any] = {}
    if mode == "mock":
        inputs = env.agent.generate_mock_inputs({}, {})
    else:
        # upload / reuse: payload carries the inputs directly for the slice.
        if turn.action is not None:
            raw = turn.action.payload.get("inputs")
            if isinstance(raw, dict):
                inputs = raw

    ti = TestInput(session_id=s.id, source=_mode_or_default(mode), inputs=inputs)
    env.repo.save_test_input(ti)
    fc.test_input_ref = ti.id
    return StepResult(next=PcState.FIX_VERIFY, context=fc)


def handle_verify(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(working) Run the repaired draft, mint a NEW immutable Run. Advances
    to ``fix.await_decision`` on both pass and fail; never touches the
    original failed run. Port of ``handlers_fix.go:206``."""
    inputs: dict[str, Any] = {}
    if fc.test_input_ref != "":
        ti = env.repo.get_test_input(fc.test_input_ref)
        inputs = ti.inputs

    emit = env.emit if env.emit is not None else (lambda _event: None)
    result = env.dify.run_draft(s.app_id, turn.actor, inputs, emit)

    # Python has no equivalent to Go's `runIDSink: &fc.VerifyRunID` pointer
    # aliasing (see runner.py's module docstring), so this handler mints the
    # run id itself and threads the SAME value into both the Run and
    # fc.verify_run_id directly; run_id_sink is still populated so the
    # runner's generic write-back stays consistent (a no-op, since the id
    # already matches).
    run = Run(
        id=str(uuid.uuid4()),
        kind="verify",
        dify_run_id=result.dify_run_id,
        status=result.status,
        per_node=result.per_node,
        inputs_ref=fc.test_input_ref,
        immutable=True,
    )
    if result.status != "succeeded":
        run.culprit_node_id = first_failed_node(result.per_node)

    fc.verify_run_id = run.id
    items = append_card(
        fc,
        TestResultCard(
            title="Validation",
            subtitle="",
            tone=("success" if result.status == "succeeded" else "error"),
            stats=[],
            run_ids=[run.id],
        ),
    )
    return StepResult(
        next=PcState.FIX_AWAIT_DECISION,
        context=fc,
        items=items,
        run=run,
        run_id_sink=[run.id],
    )


def handle_await_decision(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) Terminal choice. Port of ``handlers_fix.go:239``."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind == "publish":
        return StepResult(next=PcState.FIX_PUBLISH, context=fc)
    if kind == "re_fix":
        fc.diagnosis = None
        fc.staged_repair = []
        fc.risk = None
        fc.change_set = None
        fc.test_input_ref = ""
        fc.verify_run_id = ""
        return StepResult(next=PcState.FIX_DIAGNOSE, context=fc)
    if kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.SUCCESS, context=fc, items=items)
    # default: keep_draft
    items = append_card(fc, DecisionItem(text="Kept the draft"))
    return StepResult(next=PcState.SUCCESS, context=fc, items=items)


def handle_publish(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(working) Publish the repaired workflow. Port of
    ``handlers_fix.go:316``."""
    env.dify.publish(s.app_id, turn.actor)
    items = append_card(fc, DecisionItem(text="Published the fix"))
    return StepResult(next=PcState.SUCCESS, context=fc, items=items)


# ---- checklist handlers -----------------------------------------------------


def handle_checklist_diagnose(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(working) Mirrors ``handle_diagnose`` but diagnoses from the
    pre-publish checklist's config errors instead of a failed run's node
    outputs — there is no ``fc.failed_run_id`` on this path, so no run
    lookup. Port of ``handlers_fix.go:72``."""
    fc.checkpoint_seq = fc.next_seq
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    diagnosis = env.agent.diagnose_checklist(fc.checklist_errors, graph)
    fc.diagnosis = diagnosis
    fc.last_snapshot_hash = graph_hash

    items = append_card(
        fc,
        SummaryCard(
            variant="context",
            title="Diagnosis",
            items=[
                f"Root cause: {diagnosis.root_cause}",
                f"Culprit node: {diagnosis.culprit_node_id}",
                "Source: checklist",
            ],
        ),
    )
    return StepResult(
        next=PcState.CHECKLIST_PROPOSE,
        context=fc,
        items=items,
        checkpoint=Snapshot(session_id=s.id, hash=graph_hash, graph=graph),
    )


def handle_await_recheck(env: Env, turn: Turn, s: Session, fc: CopilotContext) -> StepResult:
    """(waiting) The checklist-fix counterpart of ``handle_await_verify``:
    instead of running the workflow, the caller re-runs the pre-publish
    checklist and reports the result via a ``"recheck"`` action. On ``undo``
    the flow ends (recorded intent only, matching ``handle_await_decision``'s
    undo). If the checklist now passes, hand off to the shared
    ``fix.await_decision`` gate (publish / keep / re-fix / undo). Otherwise
    the caller supplies the still-failing entries in
    ``payload["remaining"]``, which replace ``fc.checklist_errors``, and the
    flow loops back to ``checklist.diagnose`` to re-fix. Port of
    ``handlers_fix.go:272``."""
    if turn.action is not None and turn.action.kind == "undo":
        perform_revert(env, turn, s, fc)
        items = append_card(fc, DecisionItem(text="Requested a revert"))
        return StepResult(next=PcState.SUCCESS, context=fc, items=items)

    passed = False
    if turn.action is not None:
        value = turn.action.payload.get("passed")
        if isinstance(value, bool):
            passed = value
    if passed:
        items = append_card(
            fc, TestResultCard(title="Validation", subtitle="checklist", tone="success", stats=[], run_ids=[])
        )
        return StepResult(next=PcState.FIX_AWAIT_DECISION, context=fc, items=items)

    # residual checklist errors: reload them and loop back to re-diagnose.
    if turn.action is not None:
        raw = turn.action.payload.get("remaining")
        if isinstance(raw, list):
            fc.checklist_errors = decode_checklist_errors(raw)
    fc.diagnosis, fc.staged_repair, fc.risk, fc.change_set = None, [], None, None
    items = append_card(fc, NoticeItem(text="Checklist still failing, re-diagnosing", tone="neutral"))
    return StepResult(next=PcState.CHECKLIST_DIAGNOSE, context=fc, items=items)


def decode_checklist_errors(raw: list) -> list[ChecklistError]:
    """Decode a checklist-recheck action's loosely-typed ``remaining``
    payload (JSON objects decoded as ``list[dict]``, mirroring Go's
    ``[]any``/``map[string]any``) into ``list[ChecklistError]`` — the same
    JSON round-trip Go's ``decodeChecklistErrors`` (``handlers_fix.go:303``)
    does via ``json.Marshal``/``json.Unmarshal``, mirroring how the ent layer
    maps JSON columns onto typed structs. A checklist recheck action is
    best-effort user input, not a persisted commit: like Go's
    ``json.Unmarshal`` failing the whole decode on the first type mismatch
    it hits, any entry that isn't a well-typed ``ChecklistError`` drops the
    ENTIRE batch (returns ``[]``) rather than raising or partially decoding.
    """
    out: list[ChecklistError] = []
    for entry in raw:
        if not isinstance(entry, dict):
            return []
        node_id = entry.get("node_id", "")
        node_type = entry.get("node_type", "")
        title = entry.get("title", "")
        messages = entry.get("messages", [])
        unconnected = entry.get("unconnected", False)
        plugin_missing = entry.get("plugin_missing", False)
        if (
            not isinstance(node_id, str)
            or not isinstance(node_type, str)
            or not isinstance(title, str)
            or not isinstance(messages, list)
            or not all(isinstance(m, str) for m in messages)
            or not isinstance(unconnected, bool)
            or not isinstance(plugin_missing, bool)
        ):
            return []
        out.append(
            ChecklistError(
                node_id=node_id,
                node_type=node_type,
                title=title,
                messages=list(messages),
                unconnected=unconnected,
                plugin_missing=plugin_missing,
            )
        )
    return out


def fix_registry() -> dict[PcState, Handler]:
    """The handler table for the Fix flow — the nine Fix states plus the
    checklist-fix states, which feed into the same
    propose/apply/verify/publish flow via a shared ``fc.source`` branch in
    ``handle_apply``. Port of Go ``FixRegistry`` (``handlers_fix.go:18-36``).
    """
    return {
        PcState.FIX_DIAGNOSE: handle_diagnose,
        PcState.FIX_PROPOSE: handle_propose,
        PcState.FIX_AWAIT_APPROVAL: handle_await_approval,
        PcState.FIX_APPLY: handle_apply,
        PcState.FIX_AWAIT_VERIFY: handle_await_verify,
        PcState.FIX_AWAIT_TESTDATA: handle_await_testdata,
        PcState.FIX_VERIFY: handle_verify,
        PcState.FIX_AWAIT_DECISION: handle_await_decision,
        PcState.FIX_PUBLISH: handle_publish,
        PcState.CHECKLIST_DIAGNOSE: handle_checklist_diagnose,
        PcState.CHECKLIST_PROPOSE: handle_propose,
        PcState.CHECKLIST_AWAIT_RECHECK: handle_await_recheck,
    }
