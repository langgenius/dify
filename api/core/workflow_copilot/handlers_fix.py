"""Run-fix handlers: pure ``(env, turn, session, fc) -> StepResult`` steps.

Port of the run-fix subset of
dify-enterprise/server/pkg/enterprise/biz/copilot/handlers_fix.go
(``handlers_fix.go:9-270,316-347``). The checklist handlers
(``handle_checklist_diagnose`` / ``handle_await_recheck`` /
``decode_checklist_errors``) and the merged ``fix_registry()`` are Task 7 —
deliberately not included here.

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

from core.workflow_copilot.models import (
    ChangeSet,
    ConversationItem,
    FixContext,
    NodeOutput,
    Run,
    Session,
    Snapshot,
    TestInput,
    Turn,
)
from core.workflow_copilot.runner import Env, StepResult
from core.workflow_copilot.state import PcState

__all__ = [
    "action_string",
    "append_item",
    "first_failed_node",
    "handle_apply",
    "handle_await_approval",
    "handle_await_decision",
    "handle_await_testdata",
    "handle_await_verify",
    "handle_diagnose",
    "handle_propose",
    "handle_publish",
    "handle_verify",
]


# ---- helpers ---------------------------------------------------------------


def append_item(fc: FixContext, kind: str, payload: dict[str, Any]) -> list[ConversationItem]:
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


def action_string(turn: Turn, key: str) -> tuple[str, bool]:
    """Read a string field out of ``turn.action.payload``, Go-style ``(v, ok)``."""
    if turn.action is None:
        return "", False
    value = turn.action.payload.get(key)
    if isinstance(value, str):
        return value, True
    return "", False


def first_failed_node(nodes: list[NodeOutput]) -> str:
    for n in nodes:
        if n.status == "failed":
            return n.node_id
    return ""


def _mode_or_default(mode: str) -> str:
    return mode or "upload"


# ---- handlers ---------------------------------------------------------------


def handle_diagnose(env: Env, turn: Turn, s: Session, fc: FixContext) -> StepResult:
    """(working) Read the failed run's node outputs, diagnose, capture the
    pre-repair checkpoint. Port of ``handlers_fix.go:38``."""
    failed = env.repo.get_run(fc.failed_run_id)
    graph, graph_hash = env.dify.read_graph(s.app_id, turn.actor)
    outputs = env.dify.node_outputs(s.app_id, turn.actor, failed.dify_run_id)
    diagnosis = env.agent.diagnose(failed, graph, outputs)
    fc.diagnosis = diagnosis
    fc.last_snapshot_hash = graph_hash

    items = append_item(
        fc,
        "diagnosis",
        {
            "culprit_node_id": diagnosis.culprit_node_id,
            "root_cause": diagnosis.root_cause,
            "severity": diagnosis.severity,
        },
    )
    return StepResult(
        next=PcState.FIX_PROPOSE,
        context=fc,
        items=items,
        checkpoint=Snapshot(session_id=s.id, hash=graph_hash, graph=graph),
    )


def handle_propose(env: Env, turn: Turn, s: Session, fc: FixContext) -> StepResult:
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

    items = append_item(fc, "assistant-turn", {"stage": "propose", "risk": risk.level, "changed": len(intents)})
    return StepResult(next=next_state, context=fc, items=items)


def handle_await_approval(env: Env, turn: Turn, s: Session, fc: FixContext) -> StepResult:
    """(waiting) High-risk gate. Only an explicit ``approve_repair`` advances
    to ``fix.apply``; any other/absent action kind is a no-op that stays at
    the gate. Port of ``handlers_fix.go:123``."""
    kind = turn.action.kind if turn.action is not None else ""
    if kind == "approve_repair":
        return StepResult(next=PcState.FIX_APPLY, context=fc)
    if kind == "reject_repair":
        items = append_item(fc, "notice", {"text": "repair rejected"})
        return StepResult(next=PcState.FIX_AWAIT_DECISION, context=fc, items=items)
    # unknown / absent action: do not auto-apply a high-risk repair; stay at the gate.
    return StepResult(next=PcState.FIX_AWAIT_APPROVAL, context=fc)


def handle_apply(env: Env, turn: Turn, s: Session, fc: FixContext) -> StepResult:
    """(working) Apply the staged repair to the real draft. The next state
    branches on ``fc.source``: the run-fix path always lands at
    ``fix.await_verify``; the checklist-fix path lands at
    ``checklist.await_recheck``. Port of ``handlers_fix.go:146``."""
    result = env.dify.apply_repair(s.app_id, turn.actor, fc.staged_repair)
    fc.last_snapshot_hash = result.new_hash
    fc.change_set = ChangeSet(changed_nodes=result.changed_nodes, diff="config edit")
    items = append_item(fc, "change-set", {"changed": result.changed_nodes})

    next_state = PcState.FIX_AWAIT_VERIFY
    if fc.source == "checklist":
        next_state = PcState.CHECKLIST_AWAIT_RECHECK
    return StepResult(next=next_state, context=fc, items=items)


def handle_await_verify(env: Env, turn: Turn, s: Session, fc: FixContext) -> StepResult:
    """(waiting) The user runs verification or undoes. Port of
    ``handlers_fix.go:163``."""
    if turn.action is not None and turn.action.kind == "undo":
        items = append_item(fc, "notice", {"text": "revert requested"})
        return StepResult(next=PcState.FIX_AWAIT_DECISION, context=fc, items=items)
    # run_verify: if we have prepared inputs, go verify; else prepare test data.
    if fc.test_input_ref == "":
        return StepResult(next=PcState.FIX_AWAIT_TESTDATA, context=fc)
    return StepResult(next=PcState.FIX_VERIFY, context=fc)


def handle_await_testdata(env: Env, turn: Turn, s: Session, fc: FixContext) -> StepResult:
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


def handle_verify(env: Env, turn: Turn, s: Session, fc: FixContext) -> StepResult:
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
    items = append_item(fc, "verify-result", {"passed": result.status == "succeeded"})
    return StepResult(
        next=PcState.FIX_AWAIT_DECISION,
        context=fc,
        items=items,
        run=run,
        run_id_sink=[run.id],
    )


def handle_await_decision(env: Env, turn: Turn, s: Session, fc: FixContext) -> StepResult:
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
        # The real draft-restore on undo (re-sync the checkpoint snapshot
        # through the adapter) is not yet implemented — this records the
        # intent only; the append-only commit + terminal transition still
        # hold.
        items = append_item(fc, "notice", {"text": "revert requested"})
        return StepResult(next=PcState.SUCCESS, context=fc, items=items)
    # default: keep_draft
    items = append_item(fc, "notice", {"text": "draft kept"})
    return StepResult(next=PcState.SUCCESS, context=fc, items=items)


def handle_publish(env: Env, turn: Turn, s: Session, fc: FixContext) -> StepResult:
    """(working) Publish the repaired workflow. Port of
    ``handlers_fix.go:316``."""
    env.dify.publish(s.app_id, turn.actor)
    items = append_item(fc, "notice", {"text": "published"})
    return StepResult(next=PcState.SUCCESS, context=fc, items=items)
