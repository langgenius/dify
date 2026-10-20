"""Typing/seam smoke tests for the outbound ports.

Port of the conformance idea behind
dify-enterprise/server/pkg/enterprise/biz/dify_builder/seam_test.go (a trivial
conforming implementation satisfies the interface) plus struct-shape
assertions for the value types Go defines in ports.go. There is no
ports_test.go / errors_test.go in the Go source — ports.go / errors.go carry
no behavior of their own, so this file only asserts the typing seam and the
value-type defaults.
"""

from collections.abc import Callable, Mapping, Sequence
from typing import override

from core.dify_builder.contract import ConversationPage, ResourceOption
from core.dify_builder.errors import BusyError, ConflictError, NotFoundError
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
    Session,
    Snapshot,
    StartSchema,
    TestInput,
)
from core.dify_builder.state import PcState
from services.dify_builder.application.execution_policy import HttpFixtureSetV1, HttpResponseFixtureV1
from services.dify_builder.application.ports import DifyBuilderAgent, DifyPort, Repository
from services.dify_builder.effect_disclosure import EffectDisclosure
from services.dify_builder.plan import WorkflowPlan


def test_diagnosis_defaults_and_construction() -> None:
    d = Diagnosis()
    assert d.culprit_node_id == ""
    assert d.root_cause == ""
    assert d.severity == ""

    d2 = Diagnosis(culprit_node_id="n1", root_cause="Code node raised at runtime", severity="high")
    assert d2.culprit_node_id == "n1"
    assert d2.severity == "high"


def test_risk_defaults_and_construction() -> None:
    r = Risk()
    assert r.level == ""
    assert r.reason == ""
    assert r.has_external_side_effect is False

    r2 = Risk(level="low", reason="config-only fix")
    assert r2.level == "low"
    assert r2.has_external_side_effect is False


def test_mutation_intent_defaults_and_args_not_shared() -> None:
    m1 = MutationIntent(op="set_node_config")
    m2 = MutationIntent(op="set_node_config")
    assert m1.args == {}
    m1.args["path"] = "code"
    assert m2.args == {}


def test_change_set_defaults_and_changed_nodes_not_shared() -> None:
    c1 = ChangeSet()
    c2 = ChangeSet()
    assert c1.changed_nodes == []
    assert c1.diff == ""
    c1.changed_nodes.append("n1")
    assert c2.changed_nodes == []


def test_node_event_defaults_and_construction() -> None:
    e = NodeEvent()
    assert e.node_id == ""
    assert e.title == ""
    assert e.status == ""
    assert e.error == ""

    e2 = NodeEvent(node_id="n1", title="Code", status="failed", error="missing metrics")
    assert e2.status == "failed"
    assert e2.error == "missing metrics"


def test_apply_result_defaults_and_changed_nodes_not_shared() -> None:
    a1 = ApplyResult()
    a2 = ApplyResult()
    assert a1.changed_nodes == []
    assert a1.new_hash == ""
    a1.changed_nodes.append("n1")
    assert a2.changed_nodes == []


def test_fix_context_embeds_the_tightened_value_types() -> None:
    fc = DifyBuilderContext(
        diagnosis=Diagnosis(culprit_node_id="n1"),
        staged_repair=[MutationIntent(op="set_node_config")],
        risk=Risk(level="low"),
        change_set=ChangeSet(changed_nodes=["n1"]),
    )
    assert isinstance(fc.diagnosis, Diagnosis)
    assert isinstance(fc.staged_repair[0], MutationIntent)
    assert isinstance(fc.risk, Risk)
    assert isinstance(fc.change_set, ChangeSet)


class _StubAgent(DifyBuilderAgent):
    """A trivial conforming DifyBuilderAgent, in the spirit of seam_test.go's NoopAgent."""

    @override
    def diagnose(self, failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> Diagnosis:
        return Diagnosis(culprit_node_id="output", root_cause="n/a", severity="low")

    @override
    def diagnose_checklist(self, errors: list[ChecklistError], graph: Graph) -> Diagnosis:
        return Diagnosis(culprit_node_id="output", root_cause="n/a", severity="low")

    @override
    def propose_repair(self, diagnosis: Diagnosis, graph: Graph) -> tuple[list[MutationIntent], Risk]:
        return [MutationIntent(op="set_node_config", args={"node_id": "output"})], Risk(level="low")

    @override
    def generate_mock_inputs(self, schema: StartSchema, prior_failed: Inputs) -> Inputs:
        return {}

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
        return "stub"

    def analyze_impact(self, _goal_text, _graph, *, reply_language=None):  # noqa: ARG002
        return {"edit_rules": {}, "target_node_ids": []}

    def propose_edit_plan(self, _edit_rules, _graph, **_kwargs):
        return []

    @override
    def build_edit_intents(
        self,
        edit_rules: dict[str, object],
        graph: Graph,
        *,
        edit_target_node_ids: Sequence[str] = (),
        last_edit_rejection: str | None = None,
        approved_plan: WorkflowPlan | None = None,
    ) -> list[MutationIntent]:
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
        reply = f"reply: {text}"
        if on_delta is not None:
            on_delta(reply)
        return reply

    @override
    def model_or_none(self) -> object | None:
        return None


class _StubDifyPort(DifyPort):
    """A trivial conforming DifyPort. Takes `actor`, never ForwardAuth."""

    @override
    def get_app_mode(self, app_id: str, actor: Actor) -> str:
        return "workflow"

    @override
    def stamp_http_fixtures(
        self, app_id: str, actor: Actor, *, base_app_revision: str, fixtures: tuple[HttpResponseFixtureV1, ...]
    ) -> HttpFixtureSetV1:
        raise NotImplementedError

    @override
    def read_graph(self, app_id: str, actor: Actor) -> tuple[Graph, str]:
        return {}, "hash-1"

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
        expected_revision: str,
        failed_run_id: str | None = None,
    ) -> ApplyResult:
        return ApplyResult(changed_nodes=[], new_hash="hash-2")

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
        confirmed_consent_id: str | None = None,
        command_id: str | None = None,
        effect_confirmation: Mapping[str, str] | None = None,
    ) -> Run:
        return Run()

    def prepare_code_risks(self, _app_id, _actor, *, session_id, inputs, context):  # noqa: ARG002
        return {}

    def disclose_effects(self, _app_id, _actor, *, inputs=None, code_risk_context=None):  # noqa: ARG002
        return EffectDisclosure()

    @override
    def publish(
        self, app_id: str, actor: Actor, *, expected_revision: str, expected_graph_revision: str
    ) -> PublishResult:
        return PublishResult()

    @override
    def restore_graph(self, app_id: str, actor: Actor, graph: Graph, *, expected_revision: str) -> str:
        return "hash-restored"

    @override
    def graph_revision(self, graph: Graph) -> str:
        return "graph"

    @override
    def structural_fingerprint(self, graph: Graph) -> str:
        return "fp-stub"

    @override
    def graph_node_ids(self, graph: Graph) -> list[str]:
        return []


class _StubRepository(Repository):
    """A trivial conforming Repository."""

    @override
    def create_session(self, session: Session, initial_fc: DifyBuilderContext, items: list[ConversationItem]) -> None:
        return None

    @override
    def get_session(self, id: str) -> tuple[Session, DifyBuilderContext]:
        # Return a minimal value; these seam tests inspect structural conformance.
        return (Session(entry_mode=EntryMode.FIX, current_state=PcState.FIX_DIAGNOSE), DifyBuilderContext())

    @override
    def compare_and_advance(
        self, session_id: str, base_version: int, next: PcState, fc: DifyBuilderContext, items: list[ConversationItem]
    ) -> int:
        return base_version + 1

    @override
    def create_checkpoint(self, cp: Checkpoint, snap: Snapshot) -> None:
        return None

    @override
    def get_checkpoint(self, id: str) -> tuple[Checkpoint, Snapshot]:
        return (Checkpoint(state=PcState.FIX_APPLY), Snapshot())

    @override
    def save_run(self, session_id: str, run: Run) -> None:
        return None

    @override
    def get_run(self, id: str) -> Run:
        return Run()

    @override
    def save_test_input(self, ti: TestInput) -> None:
        return None

    @override
    def get_test_input(self, id: str) -> TestInput:
        return TestInput()

    @override
    def list_conversation(self, session_id: str) -> list[ConversationItem]:
        return []

    @override
    def list_recent_conversation(self, session_id: str, *, limit: int) -> list[ConversationItem]:
        _ = limit
        return []

    @override
    def get_conversation_turn_kinds(self, session_id: str, turn_id: str) -> frozenset[str]:
        return frozenset()

    @override
    def list_conversation_page(
        self, session_id: str, *, limit: int, before_seq: int | None = None, after_seq: int | None = None
    ) -> ConversationPage:
        _ = (limit, before_seq, after_seq)
        return ConversationPage(data=[], has_more=False, first_seq=None, last_seq=None)

    @override
    def get_latest_conversation_item(self, session_id: str, kinds: frozenset[str]) -> ConversationItem | None:
        return None

    @override
    def invalidate_conversation_items(self, session_id: str, from_seq: int) -> None:
        return None


def test_stub_agent_satisfies_dify_builder_agent_protocol() -> None:
    assert isinstance(_StubAgent(), DifyBuilderAgent)


def test_stub_dify_port_satisfies_dify_port_protocol() -> None:
    assert isinstance(_StubDifyPort(), DifyPort)


def test_dify_port_has_graph_primitive_methods() -> None:
    # Protocol conformance: a stub missing these two methods is NOT a DifyPort.
    class _MissingPrimitives:
        def read_graph(self, app_id: str, actor: Actor) -> tuple[Graph, str]:
            _ = app_id, actor
            return {}, "h"

        def node_outputs(self, app_id: str, actor: Actor, run_id: str) -> list[NodeOutput]:
            _ = app_id, actor, run_id
            return []

        def apply_repair(
            self,
            app_id: str,
            actor: Actor,
            intents: list[MutationIntent],
            on_canvas: Callable[[dict[str, object]], None] | None = None,
        ) -> None:
            _ = app_id, actor, intents, on_canvas

        def run_draft(self, app_id: str, actor: Actor, inputs: Inputs, on_event: Callable[[NodeEvent], None]) -> None:
            _ = app_id, actor, inputs, on_event

        def publish(self, app_id: str, actor: Actor) -> None:
            _ = app_id, actor

        def restore_graph(self, app_id: str, actor: Actor, graph: Graph) -> str:
            _ = app_id, actor, graph
            return "h"

    assert not isinstance(_MissingPrimitives(), DifyPort)


def test_stub_repository_satisfies_repository_protocol() -> None:
    assert isinstance(_StubRepository(), Repository)


def test_actor_replaces_forward_auth_on_dify_port_methods() -> None:
    # Structural check: DifyPort methods take `actor`, not a ForwardAuth
    # token — exercised end-to-end via the stub above; here we just confirm
    # Actor itself carries no auth-shaped fields (mirrors test_models.py).
    actor = Actor(account_id="acc-1", tenant_id="tenant-1")
    assert not hasattr(actor, "auth")
    assert not hasattr(actor, "bearer")


def test_errors_are_exception_subclasses() -> None:
    assert issubclass(ConflictError, Exception)
    assert issubclass(NotFoundError, Exception)
    assert issubclass(BusyError, Exception)

    for cls in (ConflictError, NotFoundError, BusyError):
        with_message = cls("boom")
        assert str(with_message) == "boom"


def test_pcstate_is_the_state_module_type_used_by_compare_and_advance() -> None:
    # compare_and_advance's `next` parameter is typed PcState; sanity-check
    # the import path ports.py takes matches state.py's canonical enum.
    assert PcState.FIX_DIAGNOSE == "fix.diagnose"


def test_agent_missing_learn_from_build_is_not_a_dify_builder_agent() -> None:
    from services.dify_builder.application.ports import DifyBuilderAgent

    class _Missing:  # a former-complete agent lacking only learn_from_build
        def diagnose(self, *a): ...
        def diagnose_checklist(self, *a): ...
        def propose_repair(self, *a): ...
        def generate_mock_inputs(self, *a): ...
        def analyze_goal(self, *a): ...
        def propose_plan_v1(self, *a): ...
        def discover_resources(self, *a): ...
        def bind_resources(self, *a): ...
        def build_nodes(self, *a): ...
        def analyze_impact(self, *a, **kwargs): ...
        def propose_edit_plan(self, *a): ...
        def build_edit_intents(self, *a): ...
        def respond_to_message(self, *a): ...

    assert not isinstance(_Missing(), DifyBuilderAgent)
