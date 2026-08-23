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
from graphon.enums import BuiltinNodeTypes
from services.workflow_copilot import node_defaults
from services.workflow_copilot.graph_ops import (
    apply_connect,
    apply_create_node,
    apply_delete_node,
    apply_insert_between,
    apply_set_node_config,
    diff_graphs,
    validate_intent_args,
)
from services.workflow_copilot.graph_ops import (
    node_ids as _graph_node_ids,
)
from services.workflow_copilot.graph_ops import (
    structural_fingerprint as _structural_fingerprint,
)

__all__ = ["FakeBuildDifyPort", "FakeDifyPort", "FakeEditDifyPort", "InMemoryRepository", "StubAgent"]


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

    def invalidate_conversation_items(self, session_id: str, from_seq: int) -> None:
        with self._lock:
            for item in self._items.get(session_id, []):
                if item.seq >= from_seq and item.kind == "assistant_turn":
                    item.payload = {**item.payload, "card_state": "invalidated"}


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
        return ApplyResult(
            changed_nodes=changed, new_hash=self.hash,
            structure_fingerprint=_structural_fingerprint(self.graph),
        )

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

    def restore_graph(self, _app_id: str, _actor: Actor, graph: Graph) -> str:
        self.graph = copy.deepcopy(graph)
        self.hash = "h-restored"
        return self.hash

    def structural_fingerprint(self, graph: Graph) -> str:
        return _structural_fingerprint(graph)

    def graph_node_ids(self, graph: Graph) -> list[str]:
        return _graph_node_ids(graph)


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

    def analyze_impact(self, _goal_text, _graph):
        return {"edit_rules": {}, "target_node_ids": []}

    def propose_edit_plan(self, _edit_rules, _graph):
        return []

    def build_edit_intents(self, _edit_rules, _graph):
        return []


# ---- fake DifyPort that actually builds the graph -------------------------

_BUILD_APPLY_FNS = {
    "set_node_config": apply_set_node_config,
    "create_node": apply_create_node,
    "delete_node": apply_delete_node,
    "connect": apply_connect,
    "insert_between": apply_insert_between,
}

_ADD_NODE_EVENTS = {
    "start": "add_start_node",
    "knowledge-retrieval": "add_knowledge_node",
    "llm": "add_llm_node",
    "end": "add_output_node",
}


def _fake_canvas_payload(intent: MutationIntent, changed: list[str]) -> dict:
    """Replicate services.workflow_copilot.dify_port._canvas_payload without
    importing that (SQLAlchemy-heavy) module into the core test fakes."""
    if intent.op == "create_node":
        event = _ADD_NODE_EVENTS.get(str(intent.args.get("node_type", "")), "apply_edit_plan")
        return {"event": event, "node_id": changed[0] if changed else None}
    if intent.op == "connect":
        return {
            "event": "apply_edit_plan",
            "edge": {"source": intent.args.get("from_node"), "target": intent.args.get("to_node")},
        }
    if intent.op == "set_node_config":
        return {"event": "apply_error_fix", "node_id": intent.args.get("node_id")}
    if intent.op == "delete_node":
        return {"event": "apply_edit_plan", "node_id": intent.args.get("node_id")}
    return {"event": "apply_edit_plan", "node_id": changed[0] if changed else None}


class FakeBuildDifyPort:
    """A ``DifyPort`` that genuinely applies Build's verbs to an accumulating
    in-memory graph via the pure ``graph_ops`` helpers and emits the same
    per-intent canvas payloads the real adapter does. Distinct from
    ``FakeDifyPort`` (which records intents without applying them) so Build
    tests can assert the graph was actually built and the reveal fired."""

    def __init__(self) -> None:
        self.graph: Graph = {"nodes": [], "edges": []}
        self.hash: str = "h0"
        self.applied: list[MutationIntent] = []
        self.published: bool = False

    def read_graph(self, _app_id: str, _actor: Actor) -> tuple[Graph, str]:
        return copy.deepcopy(self.graph), self.hash

    def node_outputs(self, _app_id: str, _actor: Actor, _run_id: str) -> list[NodeOutput]:
        return []

    def apply_repair(
        self,
        _app_id: str,
        _actor: Actor,
        intents: list[MutationIntent],
        on_canvas: Callable[[dict], None] | None = None,
    ) -> ApplyResult:
        self.applied.extend(copy.deepcopy(intents))
        before = copy.deepcopy(self.graph)
        graph = self.graph
        changed_nodes: list[str] = []
        for intent in intents:
            validate_intent_args(intent)
            apply_fn = _BUILD_APPLY_FNS[intent.op]
            graph, changed = apply_fn(graph, **intent.args)
            changed_nodes.extend(changed)
            if on_canvas is not None:
                on_canvas(_fake_canvas_payload(intent, changed))
        self.graph = graph
        self.hash = "h1"
        if not changed_nodes:
            return ApplyResult(
                changed_nodes=[], new_hash=self.hash, changes=[], scope="",
                structure_fingerprint=_structural_fingerprint(self.graph),
            )
        changes, scope = diff_graphs(before, graph)
        return ApplyResult(
            changed_nodes=changed_nodes, new_hash=self.hash, changes=changes, scope=scope,
            structure_fingerprint=_structural_fingerprint(self.graph),
        )

    def run_draft(
        self, _app_id: str, _actor: Actor, _inputs: Inputs, _on_event: Callable[[NodeEvent], None]
    ) -> Run:
        return Run(dify_run_id="build-run-1", status="succeeded")

    def publish(self, _app_id: str, _actor: Actor) -> None:
        self.published = True

    def restore_graph(self, _app_id: str, _actor: Actor, graph: Graph) -> str:
        self.graph = copy.deepcopy(graph)
        self.hash = "h-restored"
        return self.hash

    def structural_fingerprint(self, graph: Graph) -> str:
        return _structural_fingerprint(graph)

    def graph_node_ids(self, graph: Graph) -> list[str]:
        return _graph_node_ids(graph)


# ---- fake DifyPort pre-seeded with an existing graph (for Edit) -----------

_EDIT_SEED_INTENTS = [
    MutationIntent(
        op="create_node",
        args={
            "node_type": BuiltinNodeTypes.START,
            "config": node_defaults.default_config(BuiltinNodeTypes.START),
            "node_id": "start",
        },
    ),
    MutationIntent(
        op="create_node",
        args={
            "node_type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
            "config": node_defaults.default_config(BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL),
            "node_id": "knowledge_retrieval",
        },
    ),
    MutationIntent(op="connect", args={"from_node": "start", "to_node": "knowledge_retrieval"}),
    MutationIntent(
        op="create_node",
        args={
            "node_type": BuiltinNodeTypes.LLM,
            "config": node_defaults.default_config(BuiltinNodeTypes.LLM),
            "node_id": "llm",
        },
    ),
    MutationIntent(op="connect", args={"from_node": "knowledge_retrieval", "to_node": "llm"}),
    MutationIntent(
        op="create_node",
        args={
            "node_type": BuiltinNodeTypes.END,
            "config": node_defaults.default_config(BuiltinNodeTypes.END),
            "node_id": "end",
        },
    ),
    MutationIntent(op="connect", args={"from_node": "llm", "to_node": "end"}),
]


def _seeded_edit_graph() -> Graph:
    graph: Graph = {"nodes": [], "edges": []}
    for intent in _EDIT_SEED_INTENTS:
        validate_intent_args(intent)
        graph, _changed = _BUILD_APPLY_FNS[intent.op](graph, **intent.args)
    return graph


class FakeEditDifyPort(FakeBuildDifyPort):
    """A FakeBuildDifyPort pre-seeded with a real Start->Knowledge->LLM->End
    graph, so Edit's set_node_config edits have existing target nodes (Fix/Build
    fakes start empty). Reuses FakeBuildDifyPort.apply_repair/diff unchanged;
    only the initial graph differs."""

    def __init__(self) -> None:
        super().__init__()
        self.graph = _seeded_edit_graph()
