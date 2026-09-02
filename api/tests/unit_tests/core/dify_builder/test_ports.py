"""Typing/seam smoke tests for the outbound ports.

Port of the conformance idea behind
dify-enterprise/server/pkg/enterprise/biz/dify_builder/seam_test.go (a trivial
conforming implementation satisfies the interface) plus struct-shape
assertions for the value types Go defines in ports.go. There is no
ports_test.go / errors_test.go in the Go source — ports.go / errors.go carry
no behavior of their own, so this file only asserts the typing seam and the
value-type defaults.
"""

from core.dify_builder.errors import BusyError, ConflictError, NotFoundError
from core.dify_builder.models import (
    Actor,
    ApplyResult,
    ChangeSet,
    Diagnosis,
    DifyBuilderContext,
    MutationIntent,
    NodeEvent,
    Risk,
    Run,
)
from core.dify_builder.ports import DifyBuilderAgent, DifyPort, Repository
from core.dify_builder.state import PcState


def test_diagnosis_defaults_and_construction():
    d = Diagnosis()
    assert d.culprit_node_id == ""
    assert d.root_cause == ""
    assert d.severity == ""

    d2 = Diagnosis(culprit_node_id="n1", root_cause="Code node raised at runtime", severity="high")
    assert d2.culprit_node_id == "n1"
    assert d2.severity == "high"


def test_risk_defaults_and_construction():
    r = Risk()
    assert r.level == ""
    assert r.reason == ""
    assert r.has_external_side_effect is False

    r2 = Risk(level="low", reason="config-only fix")
    assert r2.level == "low"
    assert r2.has_external_side_effect is False


def test_mutation_intent_defaults_and_args_not_shared():
    m1 = MutationIntent(op="set_node_config")
    m2 = MutationIntent(op="set_node_config")
    assert m1.args == {}
    m1.args["path"] = "code"
    assert m2.args == {}


def test_change_set_defaults_and_changed_nodes_not_shared():
    c1 = ChangeSet()
    c2 = ChangeSet()
    assert c1.changed_nodes == []
    assert c1.diff == ""
    c1.changed_nodes.append("n1")
    assert c2.changed_nodes == []


def test_node_event_defaults_and_construction():
    e = NodeEvent()
    assert e.node_id == ""
    assert e.title == ""
    assert e.status == ""
    assert e.error == ""

    e2 = NodeEvent(node_id="n1", title="Code", status="failed", error="missing metrics")
    assert e2.status == "failed"
    assert e2.error == "missing metrics"


def test_apply_result_defaults_and_changed_nodes_not_shared():
    a1 = ApplyResult()
    a2 = ApplyResult()
    assert a1.changed_nodes == []
    assert a1.new_hash == ""
    a1.changed_nodes.append("n1")
    assert a2.changed_nodes == []


def test_fix_context_embeds_the_tightened_value_types():
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


class _StubAgent:
    """A trivial conforming DifyBuilderAgent, in the spirit of seam_test.go's NoopAgent."""

    def diagnose(self, _failed_run, _graph, _node_outputs):
        return Diagnosis(culprit_node_id="output", root_cause="n/a", severity="low")

    def diagnose_checklist(self, _errors, _graph):
        return Diagnosis(culprit_node_id="output", root_cause="n/a", severity="low")

    def propose_repair(self, _diagnosis, _graph):
        return [MutationIntent(op="set_node_config", args={"node_id": "output"})], Risk(level="low")

    def generate_mock_inputs(self, _schema, _prior_failed):
        return {}

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

    def learn_from_build(self, _goal_text, _requirements, _plan_items, _built_node_ids):
        return "stub"

    def analyze_impact(self, _goal_text, _graph):
        return {"edit_rules": {}, "target_node_ids": []}

    def propose_edit_plan(self, _edit_rules, _graph):
        return []

    def build_edit_intents(self, _edit_rules, _graph):
        return []

    def respond_to_message(self, _state, _context, _history, _graph, text, on_delta=None):
        reply = f"reply: {text}"
        if on_delta is not None:
            on_delta(reply)
        return reply


class _StubDifyPort:
    """A trivial conforming DifyPort. Takes `actor`, never ForwardAuth."""

    def read_graph(self, _app_id, _actor):
        return {}, "hash-1"

    def node_outputs(self, _app_id, _actor, _run_id):
        return []

    def apply_repair(self, _app_id, _actor, _intents, _on_canvas=None):
        return ApplyResult(changed_nodes=[], new_hash="hash-2")

    def run_draft(self, _app_id, _actor, _inputs, _on_event):
        return Run()

    def publish(self, _app_id, _actor):
        return None

    def restore_graph(self, _app_id, _actor, _graph):
        return "hash-restored"

    def structural_fingerprint(self, _graph):
        return "fp-stub"

    def graph_node_ids(self, _graph):
        return []


class _StubRepository:
    """A trivial conforming Repository."""

    def create_session(self, _session, _initial_fc, _items):
        return None

    def get_session(self, _id):
        # Protocol conformance is structural (method names/arity only); the
        # return value's shape doesn't matter for the isinstance check below.
        return None

    def compare_and_advance(self, _session_id, base_version, _next, _fc, _items):
        return base_version + 1

    def create_checkpoint(self, _cp, _snap):
        return None

    def get_checkpoint(self, _id):
        return None

    def save_run(self, _session_id, _run):
        return None

    def get_run(self, _id):
        return Run()

    def save_test_input(self, _ti):
        return None

    def get_test_input(self, _id):
        return None

    def list_conversation(self, _session_id):
        return []

    def invalidate_conversation_items(self, _session_id, _from_seq):
        return None


def test_stub_agent_satisfies_dify_builder_agent_protocol():
    assert isinstance(_StubAgent(), DifyBuilderAgent)


def test_stub_dify_port_satisfies_dify_port_protocol():
    assert isinstance(_StubDifyPort(), DifyPort)


def test_dify_port_has_graph_primitive_methods():
    # Protocol conformance: a stub missing these two methods is NOT a DifyPort.
    class _MissingPrimitives:
        def read_graph(self, _a, _b):
            return {}, "h"

        def node_outputs(self, _a, _b, _c):
            return []

        def apply_repair(self, _a, _b, _c, _d=None):
            return None

        def run_draft(self, _a, _b, _c, _d):
            return None

        def publish(self, _a, _b):
            return None

        def restore_graph(self, _a, _b, _c):
            return "h"

    assert not isinstance(_MissingPrimitives(), DifyPort)


def test_stub_repository_satisfies_repository_protocol():
    assert isinstance(_StubRepository(), Repository)


def test_actor_replaces_forward_auth_on_dify_port_methods():
    # Structural check: DifyPort methods take `actor`, not a ForwardAuth
    # token — exercised end-to-end via the stub above; here we just confirm
    # Actor itself carries no auth-shaped fields (mirrors test_models.py).
    actor = Actor(account_id="acc-1", tenant_id="tenant-1")
    assert not hasattr(actor, "auth")
    assert not hasattr(actor, "bearer")


def test_errors_are_exception_subclasses():
    assert issubclass(ConflictError, Exception)
    assert issubclass(NotFoundError, Exception)
    assert issubclass(BusyError, Exception)

    for cls in (ConflictError, NotFoundError, BusyError):
        with_message = cls("boom")
        assert str(with_message) == "boom"


def test_pcstate_is_the_state_module_type_used_by_compare_and_advance():
    # compare_and_advance's `next` parameter is typed PcState; sanity-check
    # the import path ports.py takes matches state.py's canonical enum.
    assert PcState.FIX_DIAGNOSE == "fix.diagnose"


def test_agent_missing_learn_from_build_is_not_a_dify_builder_agent():
    from core.dify_builder.ports import DifyBuilderAgent

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
        def analyze_impact(self, *a): ...
        def propose_edit_plan(self, *a): ...
        def build_edit_intents(self, *a): ...
        def respond_to_message(self, *a): ...

    assert not isinstance(_Missing(), DifyBuilderAgent)
