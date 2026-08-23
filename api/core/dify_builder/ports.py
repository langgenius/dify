"""Dify Builder outbound ports.

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/ports.go.

Deltas from the Go source (per the P1 port plan's Global Constraints / ADR):

- ``ForwardAuth`` is dropped entirely. ``DifyPort`` methods take
  ``actor: Actor`` instead of a forwarded console token — the fake used in
  P1 ignores it; the real adapter (P2) uses it to call ``WorkflowService``.
- Method names are ``snake_case``.
- The value types Go defines in this file (``Diagnosis``, ``Risk``,
  ``MutationIntent``, ``ChangeSet``, ``NodeEvent``, ``ApplyResult``) live in
  ``models.py`` instead, alongside the rest of the domain dataclasses —
  ``DifyBuilderContext`` embeds several of them directly, and defining them here
  (where the models are imported) would create a models<->ports import
  cycle. They are re-exported from here for convenience.
- ``interface`` becomes ``typing.Protocol``, marked ``@runtime_checkable`` so
  conformance can be asserted with ``isinstance`` in tests (see
  ``seam_test.go``'s ``TestSeam_AnyConformingAgent_DrivesFlowToTerminal``).
"""

from collections.abc import Callable
from typing import Any, Protocol, runtime_checkable

from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import (
    Actor,
    ApplyResult,
    ChangeSet,
    ChecklistError,
    Checkpoint,
    ConversationItem,
    Diagnosis,
    DifyBuilderContext,
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
from core.dify_builder.state import PcState

__all__ = [
    "ApplyResult",
    "ChangeSet",
    "Diagnosis",
    "DifyBuilderAgent",
    "DifyPort",
    "MutationIntent",
    "NodeEvent",
    "Repository",
    "Risk",
]


@runtime_checkable
class DifyBuilderAgent(Protocol):
    """The cognitive seam.

    The current implementation is a canned stub (``PlaceholderAgent``); real
    agent cognition is future work.
    """

    def diagnose(self, failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> Diagnosis: ...

    def diagnose_checklist(self, errors: list[ChecklistError], graph: Graph) -> Diagnosis: ...

    def propose_repair(self, diagnosis: Diagnosis, graph: Graph) -> tuple[list[MutationIntent], Risk]: ...

    def generate_mock_inputs(self, schema: StartSchema, prior_failed: Inputs) -> Inputs: ...

    # -- Build cognition (Slice 2; canned in PlaceholderAgent) --

    def analyze_goal(self, goal_text: str) -> dict[str, Any]: ...

    def propose_plan_v1(self, requirements: dict[str, Any]) -> list[str]: ...

    def discover_resources(self, plan_items: list[str]) -> list[ResourceOption]: ...

    def bind_resources(
        self, plan_items: list[str], resource_ids: list[str], conflict_policy: str
    ) -> list[str]: ...

    def build_nodes(self, plan_items: list[str]) -> list[MutationIntent]: ...

    def propose_build_repair(self, built_node_ids: list[str]) -> list[MutationIntent]: ...

    def learn_from_build(
        self,
        goal_text: str,
        requirements: dict[str, Any],
        plan_items: list[str],
        built_node_ids: list[str],
    ) -> str: ...

    # -- Edit cognition (Slice 3; canned in PlaceholderAgent) --

    def analyze_impact(self, goal_text: str, graph: Graph) -> dict[str, Any]: ...

    def propose_edit_plan(self, edit_rules: dict[str, Any], graph: Graph) -> list[str]: ...

    def build_edit_intents(self, edit_rules: dict[str, Any], graph: Graph) -> list[MutationIntent]: ...


@runtime_checkable
class DifyPort(Protocol):
    """The outbound port to Dify.

    Implemented by the token-forwarding adapter in P2. ``actor`` identifies
    who is driving the call (Go: ``auth ForwardAuth``).
    """

    def read_graph(self, app_id: str, actor: Actor) -> tuple[Graph, str]: ...

    def node_outputs(self, app_id: str, actor: Actor, run_id: str) -> list[NodeOutput]: ...

    def apply_repair(
        self,
        app_id: str,
        actor: Actor,
        intents: list[MutationIntent],
        on_canvas: Callable[[dict], None] | None = None,
    ) -> ApplyResult: ...

    def run_draft(self, app_id: str, actor: Actor, inputs: Inputs, on_event: Callable[[NodeEvent], None]) -> Run: ...

    def publish(self, app_id: str, actor: Actor) -> None: ...

    def restore_graph(self, app_id: str, actor: Actor, graph: Graph) -> str: ...

    def structural_fingerprint(self, graph: Graph) -> str:
        """Stable hash of the graph's structure (node identity+type + edges),
        excluding config -- the core-visible primitive backing recovery (C-1).
        The adapter delegates to ``graph_ops.structural_fingerprint``."""
        ...

    def graph_node_ids(self, graph: Graph) -> list[str]:
        """The ids of every node in ``graph`` -- backs recovery's
        target-presence check. Delegates to ``graph_ops.node_ids``."""
        ...


@runtime_checkable
class Repository(Protocol):
    """The durable store.

    ``compare_and_advance`` is the single concurrency primitive: it appends a
    commit and advances the session version iff the current version equals
    ``base_version``, else raises ``ConflictError``.
    """

    def create_session(
        self, session: Session, initial_fc: DifyBuilderContext, items: list[ConversationItem]
    ) -> None: ...

    def get_session(self, id: str) -> tuple[Session, DifyBuilderContext]: ...

    def compare_and_advance(
        self,
        session_id: str,
        base_version: int,
        next: PcState,
        fc: DifyBuilderContext,
        items: list[ConversationItem],
    ) -> int: ...

    def create_checkpoint(self, cp: Checkpoint, snap: Snapshot) -> None: ...

    def get_checkpoint(self, id: str) -> tuple[Checkpoint, Snapshot]: ...

    def save_run(self, session_id: str, run: Run) -> None:
        """Persist a run.

        Implementations MUST preserve a caller-supplied non-empty ``run.id``
        (do not regenerate it): ``handle_verify`` pre-generates the id and sets
        ``fc.verify_run_id`` to the same value, so a regenerated id would
        silently desync the persisted row from the session context (surfacing
        later as a wrong-run / not-found lookup). If ``run.id`` is empty the
        implementation assigns one.
        """
        ...

    def get_run(self, id: str) -> Run: ...

    def save_test_input(self, ti: TestInput) -> None: ...

    def get_test_input(self, id: str) -> TestInput: ...

    def list_conversation(self, session_id: str) -> list[ConversationItem]: ...

    def invalidate_conversation_items(self, session_id: str, from_seq: int) -> None: ...
