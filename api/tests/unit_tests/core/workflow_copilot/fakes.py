"""In-memory fakes for the workflow copilot engine's outbound ports.

Port of dify-enterprise/server/pkg/enterprise/biz/copilot/fakes_test.go
(``memRepo``, ``FakeDify``, ``StubAgent``). These fakes back every
downstream test in this package (runner, handlers, full fix-flow) exactly
the way the Go fakes back ``runner_test.go`` / ``handlers_fix_test.go`` /
the full-flow acceptance test.

Deltas from the Go source:

- **Real ``(session_id, seq)`` uniqueness.** The Go ``memRepo`` never
  actually checked that appended conversation-item ``seq`` values were
  unique or advancing — ``CompareAndAdvance`` just blindly appended
  whatever ``items`` it was given. That silently hid a bug (a caller could
  double-append the same seq and the fake wouldn't notice). This port adds
  a genuine uniqueness guard: any item whose ``seq`` collides with one
  already stored for the session (either from a prior commit or from
  elsewhere in the same batch) raises :class:`ConflictError` and applies
  nothing.
- **Deep-copied graphs.** ``FakeDifyPort.read_graph`` and the
  checkpoint/snapshot store deep-copy their ``Graph`` payloads on both
  write and read. A fake that shared references would make
  checkpoint-restore untestable: mutating a graph after reading it would
  silently corrupt "stored" state, and a checkpoint-restore test wouldn't
  be able to tell a real restore from an aliased no-op.
- **Getters raise, they don't return ``None``.** ``get_session`` /
  ``get_checkpoint`` / ``get_run`` / ``get_test_input`` raise
  :class:`NotFoundError` when the id doesn't exist, matching the
  ``Repository`` Protocol's always-succeeding return types (``ports.py``
  types these as plain tuples/values, never ``| None``).
"""

import copy
import threading
import uuid
from collections.abc import Callable

from core.workflow_copilot.errors import ConflictError, NotFoundError
from core.workflow_copilot.models import (
    Actor,
    ApplyResult,
    ChecklistError,
    Checkpoint,
    ConversationItem,
    CopilotContext,
    Diagnosis,
    Graph,
    Inputs,
    MutationIntent,
    NodeEvent,
    NodeOutput,
    Risk,
    Run,
    Session,
    Snapshot,
    StartSchema,
    TestInput,
)
from core.workflow_copilot.state import PcState

__all__ = ["FakeDifyPort", "InMemoryRepository", "StubAgent"]


# ---- in-memory Repository ----------------------------------------------


class InMemoryRepository:
    """A thread-safe, in-process ``Repository``.

    ``compare_and_advance`` is the sole seq authority: appends only commit
    once the version CAS succeeds *and* every incoming item's ``seq`` is
    unique for the session.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}
        self._contexts: dict[str, CopilotContext] = {}
        self._commits: dict[str, list[int]] = {}
        self._checkpoints: dict[str, Checkpoint] = {}
        self._snapshots: dict[str, Snapshot] = {}
        self._runs: dict[str, Run] = {}
        self._items: dict[str, list[ConversationItem]] = {}
        self._used_seqs: dict[str, set[int]] = {}
        self._test_inputs: dict[str, TestInput] = {}

    # -- sessions --

    def create_session(self, session: Session, initial_fc: CopilotContext, items: list[ConversationItem]) -> None:
        with self._lock:
            if not session.id:
                session.id = str(uuid.uuid4())
            session.version = 1

            seqs = {item.seq for item in items}
            if len(seqs) != len(items):
                raise ConflictError(f"duplicate conversation item seq in seed items for session {session.id}")

            # compare_and_advance is the single seq authority; advance
            # next_seq past the seeded items so the first append-driven
            # insert doesn't collide with them (mirrors a real
            # unique(session_id, seq) index).
            if initial_fc.next_seq < len(items):
                initial_fc.next_seq = len(items)

            self._sessions[session.id] = copy.deepcopy(session)
            self._contexts[session.id] = copy.deepcopy(initial_fc)
            self._commits[session.id] = [1]
            self._items[session.id] = copy.deepcopy(items)
            self._used_seqs[session.id] = seqs

    def get_session(self, id: str) -> tuple[Session, CopilotContext]:
        with self._lock:
            session = self._sessions.get(id)
            if session is None:
                raise NotFoundError(f"session {id} not found")
            return copy.deepcopy(session), copy.deepcopy(self._contexts[id])

    def compare_and_advance(
        self,
        session_id: str,
        base_version: int,
        next: PcState,
        fc: CopilotContext,
        items: list[ConversationItem],
    ) -> int:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise NotFoundError(f"session {session_id} not found")
            if session.version != base_version:
                raise ConflictError(
                    f"stale base_version {base_version} for session {session_id} (current {session.version})"
                )

            existing_seqs = self._used_seqs.setdefault(session_id, set())
            batch_seqs: set[int] = set()
            for item in items:
                if item.seq in existing_seqs or item.seq in batch_seqs:
                    raise ConflictError(f"conversation item seq {item.seq} already used for session {session_id}")
                batch_seqs.add(item.seq)

            new_version = base_version + 1
            session.version = new_version
            session.current_state = next
            self._contexts[session_id] = copy.deepcopy(fc)
            self._items.setdefault(session_id, []).extend(copy.deepcopy(items))
            existing_seqs.update(batch_seqs)
            self._commits.setdefault(session_id, []).append(new_version)
            return new_version

    # -- checkpoints --

    def create_checkpoint(self, cp: Checkpoint, snap: Snapshot) -> None:
        with self._lock:
            if not snap.id:
                snap.id = str(uuid.uuid4())
            if not cp.id:
                cp.id = str(uuid.uuid4())
            cp.snapshot_id = snap.id
            self._snapshots[snap.id] = copy.deepcopy(snap)
            self._checkpoints[cp.id] = copy.deepcopy(cp)

    def get_checkpoint(self, id: str) -> tuple[Checkpoint, Snapshot]:
        with self._lock:
            cp = self._checkpoints.get(id)
            if cp is None:
                raise NotFoundError(f"checkpoint {id} not found")
            snap = self._snapshots[cp.snapshot_id]
            return copy.deepcopy(cp), copy.deepcopy(snap)

    # -- runs --

    def save_run(self, _session_id: str, run: Run) -> None:
        with self._lock:
            if not run.id:
                run.id = str(uuid.uuid4())
            existing = self._runs.get(run.id)
            if existing is not None and existing.immutable:
                raise ValueError(f"run {run.id} is immutable")
            self._runs[run.id] = copy.deepcopy(run)

    def get_run(self, id: str) -> Run:
        with self._lock:
            run = self._runs.get(id)
            if run is None:
                raise NotFoundError(f"run {id} not found")
            return copy.deepcopy(run)

    # -- test inputs --

    def save_test_input(self, ti: TestInput) -> None:
        with self._lock:
            if not ti.id:
                ti.id = str(uuid.uuid4())
            self._test_inputs[ti.id] = copy.deepcopy(ti)

    def get_test_input(self, id: str) -> TestInput:
        with self._lock:
            ti = self._test_inputs.get(id)
            if ti is None:
                raise NotFoundError(f"test input {id} not found")
            return copy.deepcopy(ti)

    # -- conversation --

    def list_conversation(self, session_id: str) -> list[ConversationItem]:
        with self._lock:
            return copy.deepcopy(self._items.get(session_id, []))


# ---- fake DifyPort -------------------------------------------------------


class FakeDifyPort:
    """A canned ``DifyPort``.

    ``verify_pass`` is mutable so a test can seed "fails first, succeeds
    after apply": set it ``False`` for an initial ``run_draft`` (or seed
    it directly), flip it to ``True`` once the repair is applied, and
    call ``run_draft`` again.
    """

    def __init__(self) -> None:
        self.graph: Graph = {"nodes": []}
        self.hash: str = "h0"
        self.applied: list[MutationIntent] = []
        self.published: bool = False
        self.verify_pass: bool = True
        self.run_draft_inputs: Inputs = {}

    def read_graph(self, _app_id: str, _actor: Actor) -> tuple[Graph, str]:
        return copy.deepcopy(self.graph), self.hash

    def node_outputs(self, _app_id: str, _actor: Actor, _run_id: str) -> list[NodeOutput]:
        return [NodeOutput(node_id="output", status="failed", error="missing metrics")]

    def apply_repair(
        self,
        _app_id: str,
        _actor: Actor,
        intents: list[MutationIntent],
        on_canvas: Callable[[dict], None] | None = None,
    ) -> ApplyResult:
        self.applied = copy.deepcopy(intents)
        self.hash = "h1"
        changed = [intent.args["node_id"] for intent in intents if isinstance(intent.args.get("node_id"), str)]
        if on_canvas is not None:
            for node_id in changed:
                on_canvas({"event": "apply_error_fix", "node_id": node_id})
        return ApplyResult(changed_nodes=changed, new_hash=self.hash)

    def run_draft(
        self,
        _app_id: str,
        _actor: Actor,
        inputs: Inputs,
        on_event: Callable[[NodeEvent], None],
    ) -> Run:
        self.run_draft_inputs = copy.deepcopy(inputs)
        on_event(NodeEvent(node_id="output", status="running"))
        if self.verify_pass:
            on_event(NodeEvent(node_id="output", status="success"))
            return Run(
                dify_run_id="dify-run-1",
                status="succeeded",
                per_node=[NodeOutput(node_id="output", status="success")],
            )
        on_event(NodeEvent(node_id="output", status="failed", error="still broken"))
        return Run(
            dify_run_id="dify-run-1",
            status="failed",
            per_node=[NodeOutput(node_id="output", status="failed", error="still broken")],
        )

    def publish(self, _app_id: str, _actor: Actor) -> None:
        self.published = True


# ---- stub CopilotAgent ----------------------------------------------------


class StubAgent:
    """A minimal canned ``CopilotAgent`` for handler/runner tests.

    Distinct from the production ``PlaceholderAgent`` (Task 8): this is a
    deliberately dumb fixture whose values are chosen to make handler
    tests easy to assert against, not a candidate implementation.
    """

    def __init__(self, risk_level: str = "low") -> None:
        self.risk_level = risk_level

    def diagnose(self, _failed_run: Run, _graph: Graph, _node_outputs: list[NodeOutput]) -> Diagnosis:
        return Diagnosis(culprit_node_id="output", root_cause="Output node requires 'metrics'", severity="high")

    def diagnose_checklist(self, errors: list[ChecklistError], _graph: Graph) -> Diagnosis:
        if not errors:
            return Diagnosis()
        first = errors[0]
        return Diagnosis(culprit_node_id=first.node_id, root_cause="Checklist error", severity="high")

    def propose_repair(self, diagnosis: Diagnosis, _graph: Graph) -> tuple[list[MutationIntent], Risk]:
        intents = [
            MutationIntent(
                op="set_node_config",
                args={"node_id": diagnosis.culprit_node_id, "field": "metrics", "value": "[]"},
            )
        ]
        return intents, Risk(level=self.risk_level, reason="config-only fix", has_external_side_effect=False)

    def generate_mock_inputs(self, _schema: StartSchema, _prior_failed: Inputs) -> Inputs:
        return {"report_pdf": "mock.pdf"}

    def analyze_goal(self, _goal_text):
        return {}

    def propose_plan_v1(self, _requirements):
        return []

    def discover_resources(self, _plan_items):
        return []

    def bind_resources(self, _plan_items, _resource_ids, _conflict_policy):
        return []

    def build_nodes(self, _plan_items):
        return []

    def propose_build_repair(self, _built_node_ids):
        return []
