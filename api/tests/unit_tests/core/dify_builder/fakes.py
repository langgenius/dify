"""In-memory fakes for the Dify Builder engine's outbound ports.

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/fakes_test.go
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

from __future__ import annotations

import copy
import threading
import uuid
from collections.abc import Callable, Mapping
from dataclasses import replace
from datetime import datetime
from typing import Unpack, override

from typing_extensions import TypedDict

from core.dify_builder import node_defaults
from core.dify_builder.contract import ConversationPage, ResourceOption
from core.dify_builder.errors import ConflictError, NotFoundError
from core.dify_builder.models import (
    Actor,
    ApplyResult,
    BuildNodesResult,
    ChangeSet,
    ChecklistError,
    Checkpoint,
    ConversationItem,
    Diagnosis,
    DifyBuilderContext,
    EntryMode,
    Graph,
    Inputs,
    MutationIntent,
    NodeEvent,
    NodeOutput,
    PublishResult,
    Risk,
    Run,
    RunVerification,
    Session,
    Snapshot,
    StartSchema,
    TestInput,
)
from core.dify_builder.state import PcState
from graphon.enums import BuiltinNodeTypes
from services.dify_builder.application.execution_policy import (
    BuilderExecutionPolicyError,
    HttpFixtureSetV1,
    HttpResponseFixtureV1,
)
from services.dify_builder.application.ports import DifyBuilderAgent, DifyPort, Repository
from services.dify_builder.application.runner import Env
from services.dify_builder.effect_disclosure import EffectDisclosure
from services.dify_builder.graph_ops import (
    apply_connect,
    apply_create_node,
    apply_delete_node,
    apply_insert_between,
    apply_set_node_config,
    diff_graphs,
    validate_intent_args,
)
from services.dify_builder.graph_ops import (
    node_ids as _graph_node_ids,
)
from services.dify_builder.graph_ops import (
    structural_fingerprint as _structural_fingerprint,
)
from services.dify_builder.plan import WorkflowPlan

__all__ = ["FakeBuildDifyPort", "FakeDifyPort", "FakeEditDifyPort", "InMemoryRepository", "StubAgent"]


# ---- in-memory Repository ----------------------------------------------


class InMemoryRepository(Repository):
    """A thread-safe, in-process ``Repository``.

    ``compare_and_advance`` is the sole seq authority: appends only commit
    once the version CAS succeeds *and* every incoming item's ``seq`` is
    unique for the session.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, Session] = {}
        self._contexts: dict[str, DifyBuilderContext] = {}
        self._commits: dict[str, list[int]] = {}
        self._checkpoints: dict[str, Checkpoint] = {}
        self._snapshots: dict[str, Snapshot] = {}
        self._runs: dict[str, Run] = {}
        self._items: dict[str, list[ConversationItem]] = {}
        self._used_seqs: dict[str, set[int]] = {}
        self._test_inputs: dict[str, TestInput] = {}

    # -- sessions --

    @override
    def create_session(self, session: Session, initial_fc: DifyBuilderContext, items: list[ConversationItem]) -> None:
        with self._lock:
            if not session.id:
                session.id = str(uuid.uuid4())
            session.version = 1
            for item in items:
                item.at_version = 1

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

    @override
    def get_session(self, id: str) -> tuple[Session, DifyBuilderContext]:
        with self._lock:
            session = self._sessions.get(id)
            if session is None:
                raise NotFoundError(f"session {id} not found")
            return copy.deepcopy(session), copy.deepcopy(self._contexts[id])

    @override
    def compare_and_advance(
        self,
        session_id: str,
        base_version: int,
        next: PcState,
        fc: DifyBuilderContext,
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

    @override
    def create_checkpoint(self, cp: Checkpoint, snap: Snapshot) -> None:
        with self._lock:
            if not snap.id:
                snap.id = str(uuid.uuid4())
            if not cp.id:
                cp.id = str(uuid.uuid4())
            cp.snapshot_id = snap.id
            self._snapshots[snap.id] = copy.deepcopy(snap)
            self._checkpoints[cp.id] = copy.deepcopy(cp)

    @override
    def get_checkpoint(self, id: str) -> tuple[Checkpoint, Snapshot]:
        with self._lock:
            cp = self._checkpoints.get(id)
            if cp is None:
                raise NotFoundError(f"checkpoint {id} not found")
            snap = self._snapshots[cp.snapshot_id]
            return copy.deepcopy(cp), copy.deepcopy(snap)

    # -- runs --

    @override
    def save_run(self, session_id: str, run: Run) -> None:
        run.session_id = session_id
        with self._lock:
            if not run.id:
                run.id = str(uuid.uuid4())
            existing = self._runs.get(run.id)
            if existing is not None and existing.immutable:
                raise ValueError(f"run {run.id} is immutable")
            self._runs[run.id] = copy.deepcopy(run)

    @override
    def get_run(self, id: str) -> Run:
        with self._lock:
            run = self._runs.get(id)
            if run is None:
                raise NotFoundError(f"run {id} not found")
            return copy.deepcopy(run)

    # -- test inputs --

    @override
    def save_test_input(self, ti: TestInput) -> None:
        with self._lock:
            if not ti.id:
                ti.id = str(uuid.uuid4())
            self._test_inputs[ti.id] = copy.deepcopy(ti)

    @override
    def get_test_input(self, id: str) -> TestInput:
        with self._lock:
            ti = self._test_inputs.get(id)
            if ti is None:
                raise NotFoundError(f"test input {id} not found")
            return copy.deepcopy(ti)

    # -- conversation --

    @override
    def list_conversation(self, session_id: str) -> list[ConversationItem]:
        with self._lock:
            return copy.deepcopy(self._items.get(session_id, []))

    @override
    def list_recent_conversation(self, session_id: str, *, limit: int) -> list[ConversationItem]:
        if limit < 1:
            raise ValueError("limit must be positive")
        with self._lock:
            items = [item for item in self._items.get(session_id, []) if item.kind != "notice"]
            return copy.deepcopy(items[-limit:])

    @override
    def get_conversation_turn_kinds(self, session_id: str, turn_id: str) -> frozenset[str]:
        with self._lock:
            return frozenset(
                item.kind
                for item in self._items.get(session_id, [])
                if item.kind in {"user", "assistant_turn"} and item.payload.get("turn_id") == turn_id
            )

    @override
    def list_conversation_page(
        self,
        session_id: str,
        *,
        limit: int,
        before_seq: int | None = None,
        after_seq: int | None = None,
    ) -> ConversationPage:
        # The production repository streams bounded SQL rows. This in-memory
        # fake favors a small, exact implementation for engine/service tests.
        from services.dify_builder.repository import _conversation_groups_forward

        with self._lock:
            items = copy.deepcopy(self._items.get(session_id, []))
        if before_seq is not None:
            items = [item for item in items if item.seq < before_seq]
        if after_seq is not None:
            items = [item for item in items if item.seq > after_seq]
        groups = list(_conversation_groups_forward(items))
        if after_seq is not None:
            selected = groups[:limit]
            has_more = len(groups) > limit
        else:
            selected = groups[-limit:]
            has_more = len(groups) > limit
        page_items = [item for group in selected for item in group]
        return ConversationPage(
            data=page_items,
            has_more=has_more,
            first_seq=page_items[0].seq if page_items else None,
            last_seq=page_items[-1].seq if page_items else None,
        )

    @override
    def get_latest_conversation_item(self, session_id: str, kinds: frozenset[str]) -> ConversationItem | None:
        with self._lock:
            items = self._items.get(session_id, [])
            item = next((item for item in reversed(items) if item.kind in kinds), None)
            return copy.deepcopy(item)

    @override
    def invalidate_conversation_items(self, session_id: str, from_seq: int) -> None:
        with self._lock:
            for item in self._items.get(session_id, []):
                if item.seq >= from_seq and item.kind == "assistant_turn":
                    item.payload = {**item.payload, "card_state": "invalidated"}


# ---- fake DifyPort -------------------------------------------------------


class FakeDifyPort(DifyPort):
    """A canned ``DifyPort``.

    ``verify_pass`` is mutable so a test can seed "fails first, succeeds
    after apply": set it ``False`` for an initial ``run_draft`` (or seed
    it directly), flip it to ``True`` once the repair is applied, and
    call ``run_draft`` again.
    """

    def __init__(self) -> None:
        self.app_mode: str = "workflow"
        self.graph: Graph = {"nodes": []}
        self.hash: str = "h0"
        self.applied: list[MutationIntent] = []
        self.published: bool = False
        self.verify_pass: bool = True
        self.run_draft_inputs: Inputs = {}
        # Settable outputs seeded onto the success-path NodeOutput's `outputs`,
        # so a passing run_draft has something for a caller (e.g. the test
        # result card) to show. Empty by default -- most tests don't care.
        self.run_outputs: Inputs = {}
        self.workflow_events: list[dict[str, object]] = []
        # Settable Test Run effect disclosure; empty means nothing to confirm.
        self.effect_disclosure = EffectDisclosure()
        self.run_draft_effect_confirmation: dict[str, str] = {}

    @override
    def get_app_mode(self, app_id: str, actor: Actor) -> str:
        return self.app_mode

    def prepare_code_risks(self, _app_id, _actor, *, session_id, inputs, context):
        del session_id, inputs
        # This canned fake has no reasoning/runtime implementation; Code tests
        # use the real adapter with an explicit deterministic reasoner.
        return dict(context.code_risk_assessments)

    def disclose_effects(
        self, _app_id: str, _actor: Actor, *, inputs: Mapping[str, object] | None = None, code_risk_context=None
    ) -> EffectDisclosure:
        del inputs, code_risk_context
        return self.effect_disclosure

    @override
    def stamp_http_fixtures(
        self, app_id: str, actor: Actor, *, base_app_revision: str, fixtures: tuple[HttpResponseFixtureV1, ...]
    ) -> HttpFixtureSetV1:
        if base_app_revision != self.hash:
            raise BuilderExecutionPolicyError("stale_http_fixtures")
        return HttpFixtureSetV1(execution_revision=self.hash, fixtures=fixtures)

    @override
    def read_graph(self, app_id: str, actor: Actor) -> tuple[Graph, str]:
        return copy.deepcopy(self.graph), self.hash

    @override
    def node_outputs(self, app_id: str, actor: Actor, run_id: str) -> list[NodeOutput]:
        return [NodeOutput(node_id="output", status="failed", error="missing metrics")]

    @override
    def apply_repair(
        self,
        app_id: str,
        actor: Actor,
        intents: list[MutationIntent],
        on_canvas: Callable[[dict[str, object]], None] | None = None,
        *,
        expected_revision: str = "",
        failed_run_id: str | None = None,
    ) -> ApplyResult:
        self.expected_revision = expected_revision
        self.last_repair_run_id = failed_run_id
        self.applied = copy.deepcopy(intents)
        self.hash = "h1"
        changed = [intent.args["node_id"] for intent in intents if isinstance(intent.args.get("node_id"), str)]
        if on_canvas is not None:
            for node_id in changed:
                on_canvas({"event": "apply_error_fix", "node_id": node_id})
        return ApplyResult(
            changed_nodes=changed,
            new_hash=self.hash,
            structure_fingerprint=_structural_fingerprint(self.graph),
        )

    @override
    def run_draft(
        self,
        app_id: str,
        actor: Actor,
        inputs: Inputs,
        on_event: Callable[[NodeEvent], None],
        *,
        session_id: str,
        test_input_id: str,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None = None,
        effect_confirmation: Mapping[str, str] | None = None,
        confirmed_consent_id: str | None = None,
        command_id: str | None = None,
    ) -> Run:
        self.run_draft_identity = (session_id, test_input_id)
        self.run_draft_inputs = copy.deepcopy(inputs)
        self.run_draft_effect_confirmation = dict(effect_confirmation or {})
        if on_workflow_event is not None:
            for event in self.workflow_events:
                on_workflow_event(event)
        on_event(NodeEvent(node_id="output", status="running"))
        if self.verify_pass:
            on_event(NodeEvent(node_id="output", status="success"))
            return Run(
                dify_run_id="dify-run-1",
                verification=successful_verification(self),
                status="succeeded",
                per_node=[NodeOutput(node_id="output", status="success", outputs=dict(self.run_outputs))],
            )
        on_event(NodeEvent(node_id="output", status="failed", error="still broken"))
        return Run(
            dify_run_id="dify-run-1",
            status="failed",
            verification=failed_verification(self),
            per_node=[NodeOutput(node_id="output", status="failed", error="still broken")],
        )

    @override
    def publish(
        self, app_id: str, actor: Actor, *, expected_revision: str, expected_graph_revision: str
    ) -> PublishResult:
        assert expected_revision == self.hash
        assert expected_graph_revision == self.graph_revision(self.graph)
        self.published = True
        return PublishResult(version_name="# 1", status="live")

    @override
    def restore_graph(self, app_id: str, actor: Actor, graph: Graph, *, expected_revision: str = "") -> str:
        self.expected_revision = expected_revision
        self.graph = copy.deepcopy(graph)
        self.hash = "h-restored"
        return self.hash

    @override
    def graph_revision(self, graph: Graph) -> str:
        from services.dify_builder.revision import executable_graph_revision

        return executable_graph_revision(graph)

    @override
    def structural_fingerprint(self, graph: Graph) -> str:
        return _structural_fingerprint(graph)

    @override
    def graph_node_ids(self, graph: Graph) -> list[str]:
        return _graph_node_ids(graph)


# ---- stub DifyBuilderAgent ----------------------------------------------------


class StubAgent(DifyBuilderAgent):
    """A minimal canned ``DifyBuilderAgent`` for handler/runner tests.

    Its values are chosen to make handler tests easy to assert against; it is
    not a candidate runtime implementation.
    """

    def __init__(self, risk_level: str = "low") -> None:
        self.risk_level = risk_level
        self.edit_intent_calls: list[tuple[list[str], str | None]] = []

    @override
    def diagnose(self, failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> Diagnosis:
        return Diagnosis(culprit_node_id="output", root_cause="Output node requires 'metrics'", severity="high")

    @override
    def diagnose_checklist(self, errors: list[ChecklistError], graph: Graph) -> Diagnosis:
        if not errors:
            return Diagnosis()
        first = errors[0]
        return Diagnosis(culprit_node_id=first.node_id, root_cause="Checklist error", severity="high")

    @override
    def propose_repair(self, diagnosis: Diagnosis, graph: Graph) -> tuple[list[MutationIntent], Risk]:
        intents = [
            MutationIntent(
                op="set_node_config",
                args={"node_id": diagnosis.culprit_node_id, "field": "metrics", "value": "[]"},
            )
        ]
        return intents, Risk(level=self.risk_level, reason="config-only fix", has_external_side_effect=False)

    @override
    def generate_mock_inputs(self, schema: StartSchema, prior_failed: Inputs) -> Inputs:
        return {"report_pdf": "mock.pdf"}

    @override
    def analyze_goal(self, goal_text: str, *, reply_language: str | None = None) -> dict[str, object]:
        return {}

    @override
    def propose_app_name(self, goal_text: str, requirements: dict[str, object]) -> str:
        return ""

    @override
    def propose_plan_v1(self, requirements: dict[str, object], *, goal_text: str) -> WorkflowPlan | None:
        return None

    @override
    def discover_resources(
        self, plan_items: list[str], *, goal_text: str, requirements: dict[str, object]
    ) -> list[ResourceOption]:
        return []

    @override
    def assess_capability_gap(
        self, plan_items: list[str], options: list[ResourceOption], *, goal_text: str, requirements: dict[str, object]
    ) -> str:
        return ""

    @override
    def bind_resources(self, plan_items: list[str], resource_ids: list[str]) -> list[str]:
        return []

    @override
    def build_nodes(
        self, plan_items: list[str], resource_ids: list[str] | None = None, *, trusted_text: str = ""
    ) -> BuildNodesResult:
        return BuildNodesResult(intents=[])

    @override
    def learn_from_build(
        self, goal_text: str, requirements: dict[str, object], plan_items: list[str], built_node_ids: list[str]
    ) -> str:
        self.learn_calls = getattr(self, "learn_calls", 0) + 1
        return "stub-skill"

    def analyze_impact(self, _goal_text, _graph, *, reply_language=None):  # noqa: ARG002
        return {"edit_rules": {}, "target_node_ids": []}

    def propose_edit_plan(self, _edit_rules, _graph, **_kwargs):
        return []

    def build_edit_intents(
        self,
        _edit_rules,
        _graph,
        *,
        edit_target_node_ids=(),
        last_edit_rejection=None,
        approved_plan=None,  # noqa: ARG002
    ):
        self.edit_intent_calls = getattr(self, "edit_intent_calls", [])
        self.edit_intent_calls.append((list(edit_target_node_ids), last_edit_rejection))
        return []

    @override
    def respond_to_message(
        self,
        state: PcState,
        context: DifyBuilderContext,
        history: list[ConversationItem],
        graph: Graph,
        text: str,
        on_delta: Callable[[str], None] | None = None,
    ) -> str:
        reply = f"reply {len(history)}: {text}"
        if on_delta is not None:
            on_delta(reply)
        return reply

    @override
    def model_or_none(self) -> None:
        return None


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


def _fake_canvas_payload(intent: MutationIntent, changed: list[str]) -> dict[str, object]:
    """Replicate services.dify_builder.dify_port._canvas_payload without
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


class FakeBuildDifyPort(DifyPort):
    """A ``DifyPort`` that genuinely applies Build's verbs to an accumulating
    in-memory graph via the pure ``graph_ops`` helpers and emits the same
    per-intent canvas payloads the real adapter does. Distinct from
    ``FakeDifyPort`` (which records intents without applying them) so Build
    tests can assert the graph was actually built and the reveal fired."""

    def __init__(self) -> None:
        self.workflow_events: list[dict[str, object]] = []
        self.run_outputs: Inputs = {}
        self.app_mode: str = "workflow"
        self.graph: Graph = {"nodes": [], "edges": []}
        self.hash: str = "h0"
        self.applied: list[MutationIntent] = []
        self.published: bool = False
        self.verify_pass: bool = True
        self.run_draft_inputs: Inputs = {}
        self.fail_error: str = "boom"
        self.effect_disclosure = EffectDisclosure()
        self.run_draft_effect_confirmation: dict[str, str] = {}

    @override
    def get_app_mode(self, app_id: str, actor: Actor) -> str:
        return self.app_mode

    def prepare_code_risks(self, _app_id, _actor, *, session_id, inputs, context):
        del session_id, inputs
        # This canned fake has no reasoning/runtime implementation; Code tests
        # use the real adapter with an explicit deterministic reasoner.
        return dict(context.code_risk_assessments)

    def disclose_effects(
        self, _app_id: str, _actor: Actor, *, inputs: Mapping[str, object] | None = None, code_risk_context=None
    ) -> EffectDisclosure:
        del inputs, code_risk_context
        return self.effect_disclosure

    @override
    def stamp_http_fixtures(
        self, app_id: str, actor: Actor, *, base_app_revision: str, fixtures: tuple[HttpResponseFixtureV1, ...]
    ) -> HttpFixtureSetV1:
        if base_app_revision != self.hash:
            raise BuilderExecutionPolicyError("stale_http_fixtures")
        return HttpFixtureSetV1(execution_revision=self.hash, fixtures=fixtures)

    @override
    def read_graph(self, app_id: str, actor: Actor) -> tuple[Graph, str]:
        return copy.deepcopy(self.graph), self.hash

    @override
    def node_outputs(self, app_id: str, actor: Actor, run_id: str) -> list[NodeOutput]:
        return []

    @override
    def apply_repair(
        self,
        app_id: str,
        actor: Actor,
        intents: list[MutationIntent],
        on_canvas: Callable[[dict[str, object]], None] | None = None,
        *,
        expected_revision: str = "",
        failed_run_id: str | None = None,
    ) -> ApplyResult:
        self.expected_revision = expected_revision
        self.last_repair_run_id = failed_run_id
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
                changed_nodes=[],
                new_hash=self.hash,
                changes=[],
                scope="",
                structure_fingerprint=_structural_fingerprint(self.graph),
            )
        changes, scope = diff_graphs(before, graph)
        return ApplyResult(
            changed_nodes=changed_nodes,
            new_hash=self.hash,
            changes=changes,
            scope=scope,
            structure_fingerprint=_structural_fingerprint(self.graph),
        )

    @override
    def run_draft(
        self,
        app_id: str,
        actor: Actor,
        inputs: Inputs,
        on_event: Callable[[NodeEvent], None],
        *,
        session_id: str,
        test_input_id: str,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None = None,
        effect_confirmation: Mapping[str, str] | None = None,
        confirmed_consent_id: str | None = None,
        command_id: str | None = None,
    ) -> Run:
        self.run_draft_identity = (session_id, test_input_id)
        self.run_draft_inputs = copy.deepcopy(inputs)
        self.run_draft_effect_confirmation = dict(effect_confirmation or {})
        if on_workflow_event is not None:
            for event in self.workflow_events:
                on_workflow_event(event)
        on_event(NodeEvent(node_id="llm", status="running"))
        if self.verify_pass:
            on_event(NodeEvent(node_id="llm", status="success"))
            return Run(
                verification=successful_verification(self),
                dify_run_id="build-run-1",
                status="succeeded",
                per_node=[NodeOutput(node_id="llm", status="success")],
            )
        on_event(NodeEvent(node_id="llm", status="failed", error=self.fail_error))
        return Run(
            dify_run_id="build-run-1",
            status="failed",
            verification=failed_verification(self),
            per_node=[NodeOutput(node_id="llm", status="failed", error=self.fail_error)],
        )

    @override
    def publish(
        self, app_id: str, actor: Actor, *, expected_revision: str, expected_graph_revision: str
    ) -> PublishResult:
        assert expected_revision == self.hash
        assert expected_graph_revision == self.graph_revision(self.graph)
        self.published = True
        return PublishResult(version_name="# 1", status="live")

    @override
    def restore_graph(self, app_id: str, actor: Actor, graph: Graph, *, expected_revision: str = "") -> str:
        self.expected_revision = expected_revision
        self.graph = copy.deepcopy(graph)
        self.hash = "h-restored"
        return self.hash

    @override
    def graph_revision(self, graph: Graph) -> str:
        from services.dify_builder.revision import executable_graph_revision

        return executable_graph_revision(graph)

    @override
    def structural_fingerprint(self, graph: Graph) -> str:
        return _structural_fingerprint(graph)

    @override
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
            "config": {**node_defaults.default_config(BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL), "dataset_ids": []},
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
            "config": {**node_defaults.default_config(BuiltinNodeTypes.END), "outputs": []},
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


def successful_verification(dify: FakeDifyPort | FakeBuildDifyPort, *, no_output: bool = False) -> RunVerification:
    """Unit policy fixture only; never evidence of a composed native execution."""
    from services.dify_builder.application.execution_policy import ExecutionEvidenceSummary

    return RunVerification(
        execution_evidence=ExecutionEvidenceSummary(
            request_id="unit-request",
            mode="restricted",
            sealed=True,
            safety_outcome="restricted_execution_completed",
            sandbox_profile="disabled",
            fixture_digest="a" * 64,
            native_run_id="build-run-1" if isinstance(dify, FakeBuildDifyPort) else "dify-run-1",
        ),
        execution_revision=dify.hash,
        executed_graph_revision=dify.graph_revision(dify.graph),
        terminal_outputs=dict(dify.run_outputs),
        output_findings=[],
        executed_node_ids=[],
        no_output_dead_branch=no_output,
    )


def seed_verified_run(repo: InMemoryRepository, session: Session, dify: FakeDifyPort | FakeBuildDifyPort) -> None:
    """Seed the initial persisted context of a positive publication fixture."""
    run = Run(
        id=str(uuid.uuid4()),
        session_id=session.id,
        kind="verify",
        status="succeeded",
        immutable=True,
        verification=successful_verification(dify),
        dify_run_id="build-run-1" if isinstance(dify, FakeBuildDifyPort) else "dify-run-1",
    )
    repo.save_run(session.id, run)
    repo._contexts[session.id].verify_run_id = run.id


def saved_test_context(repo: Repository, session_id: str, **overrides: Unpack[ContextOverrides]) -> DifyBuilderContext:
    """Give verification-focused tests a saved input identity, including empty inputs."""
    test_input = TestInput(session_id=session_id, source="mock", inputs={})
    repo.save_test_input(test_input)
    return replace(DifyBuilderContext(test_input_ref=test_input.id), **overrides)


def failed_verification(dify: FakeDifyPort | FakeBuildDifyPort) -> RunVerification:
    """Complete business-failure evidence for unit routing only, not native execution proof."""
    evidence = successful_verification(dify)
    assert evidence.execution_evidence is not None
    evidence.execution_evidence = evidence.execution_evidence.model_copy(update={"safety_outcome": "native_failed"})
    return evidence


class SessionOverrides(TypedDict, total=False, closed=True):
    id: str
    app_id: str
    tenant_id: str
    owner_account_id: str
    entry_mode: EntryMode
    current_state: PcState
    version: int
    created_at: datetime
    updated_at: datetime


class ContextOverrides(TypedDict, total=False, closed=True):
    failed_run_id: str
    diagnosis: Diagnosis | None
    staged_repair: list[MutationIntent]
    repair_attempts: int
    last_repair_error: str
    unknown_outcome_count: int
    risk: Risk | None
    change_set: ChangeSet | None
    checkpoint_id: str
    verify_run_id: str
    test_input_ref: str
    last_snapshot_hash: str
    next_seq: int
    source: str
    checklist_errors: list[ChecklistError]
    goal_text: str
    reply_language: str
    requirements: dict[str, object]
    plan_items: list[str]
    plan_title: str
    plan_input_summary: str
    plan_output_summary: str
    plan_version_tag: str
    resource_selection: dict[str, object]
    built_node_ids: list[str]
    form_fields: list[Graph]
    app_name: str
    app_name_auto: bool
    edit_rules: dict[str, object]
    edit_target_node_ids: list[str]
    last_edit_rejection: str
    paused: bool
    checkpoint_seq: int
    last_structure_fingerprint: str
    recovery_class: str
    last_command_id: str
    confirmed_consent_id: str
    confirmed_command_id: str
    skill_learning_policy: str
    model_config: dict[str, object]


class FixtureEnv(Env):
    """Expose the in-memory port used by engine test assertions."""

    @property
    def fake_dify(self) -> FakeDifyPort | FakeBuildDifyPort:
        assert isinstance(self.dify, (FakeDifyPort, FakeBuildDifyPort))
        return self.dify

    @fake_dify.setter
    def fake_dify(self, value: DifyPort) -> None:
        self.dify = value
