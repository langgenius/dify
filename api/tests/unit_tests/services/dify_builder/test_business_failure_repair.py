"""Only current explicitly failed business cases may enter the existing repair path."""

import json
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime
from typing import NoReturn

import pytest
from pydantic import JsonValue

from core.dify_builder.models import (
    Action,
    Actor,
    Diagnosis,
    DifyBuilderContext,
    EntryMode,
    Graph,
    MutationIntent,
    NodeOutput,
    Risk,
    Run,
    Session,
    Turn,
)
from core.dify_builder.state import PcState
from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
from services.dify_builder.application.runner import Env, Handler
from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository, StubAgent
from tests.unit_tests.services.dify_builder.test_business_acceptance_integration import (
    AcceptancePort,
    AcceptanceSetup,
    explicit_contract,
)


class EvidenceAgent(StubAgent):
    def __init__(self) -> None:
        super().__init__(risk_level="high")
        self.diagnosed: list[tuple[str, str, dict[str, JsonValue]]] = []
        self.proposed: list[dict[str, JsonValue]] = []

    def diagnose_with_evidence(
        self, run: Run, graph: Graph, outputs: list[NodeOutput], evidence: dict[str, JsonValue]
    ) -> Diagnosis:
        del graph, outputs
        self.diagnosed.append((run.id, run.status, deepcopy(evidence)))
        return Diagnosis(culprit_node_id="output", root_cause="The confirmed paid total is unmet.", severity="high")

    def propose_with_evidence(
        self, diagnosis: Diagnosis, current: Graph, safe_graph: Graph, redact_text: Callable[[str], str]
    ) -> tuple[list[MutationIntent], Risk]:
        del current, safe_graph, redact_text
        assert diagnosis.condition_evidence is not None
        self.proposed.append(deepcopy(diagnosis.condition_evidence))
        return [], Risk(level="high", reason="Manual review required", has_external_side_effect=False)


@pytest.fixture
def case() -> tuple[AcceptanceSetup, EvidenceAgent]:
    dify = AcceptancePort()
    dify.graph = {
        "nodes": [
            {
                "id": "start",
                "data": {
                    "type": "start",
                    "variables": [{"variable": "orders", "label": "Orders", "type": "paragraph", "required": True}],
                },
            },
            {"id": "output", "data": {"type": "end"}},
        ],
        "edges": [],
    }
    repo = InMemoryRepository()
    agent = EvidenceAgent()
    env = Env(dify=dify, repo=repo, agent=agent, now=lambda: datetime.min)
    session = Session(id="s", app_id="app", entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_AWAIT_TESTDATA)
    context = DifyBuilderContext(goal_text="Count paid orders only and return paid total 350.", checkpoint_seq=7)
    return AcceptanceSetup(env, session, context, Actor(account_id="a", tenant_id="t"), dify, repo), agent


def prepare(fixture: AcceptanceSetup) -> Turn:
    turn = Turn(
        actor=fixture.actor,
        action=Action(
            kind="provide_testdata",
            payload={
                "inputs": {"orders": "valid-orders"},
                "business_acceptance_contract": explicit_contract(fixture.session, fixture.context),
                "acceptance_case_id": "paid",
            },
        ),
    )
    handlers_fix.handle_await_testdata(fixture.env, turn, fixture.session, fixture.context)
    fixture.dify.run_outputs = {"paid_count": 2, "paid_total": 440}
    return turn


@pytest.mark.parametrize(
    ("handler", "expected_state"),
    [
        (handlers_build.handle_test_and_repair, PcState.BUILD_AWAIT_REPAIR),
        (handlers_edit.handle_test_affected_paths, PcState.EDIT_AWAIT_REPAIR),
    ],
)
def test_native_success_with_current_business_failure_reaches_existing_repair_gate(
    case: tuple[AcceptanceSetup, EvidenceAgent], handler: Handler, expected_state: PcState
) -> None:
    fixture, agent = case
    turn = prepare(fixture)
    result = handler(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    assert result.run.verification is not None
    assert result.run.status == "succeeded"
    assert result.run.verification.business_acceptance["state"] == "failed"
    assert result.next == expected_state
    result_card = next(item for item in result.items if item.kind == "test_result")
    assert result_card.payload["status"] == "succeeded"
    assert result_card.payload.get("failure_reason") is None
    assert len(agent.diagnosed) == len(agent.proposed) == 1
    business = agent.diagnosed[0][2]["business_failure"]
    assert isinstance(business, dict)
    assert business["goal_text"] == fixture.context.goal_text
    assert business["case_id"] == "paid"
    assert business["checks"] == [
        {"path": ["paid_total"], "operator": "equals", "expected": 350, "present": True, "actual": 440}
    ]
    assert agent.diagnosed[0][1] == "succeeded"
    assert agent.proposed[0]["business_failure"] == business
    fixture.repo.save_run(fixture.session.id, result.run)
    assert not handlers_fix.publication_for_context(fixture.env, turn, fixture.session, fixture.context).allowed
    assert fixture.context.staged_repair == []
    assert result.checkpoint is None
    assert not fixture.dify.published


def test_explicit_fix_again_uses_latest_business_run_and_retains_owned_sample(
    case: tuple[AcceptanceSetup, EvidenceAgent], monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture, agent = case
    turn = prepare(fixture)
    original = Run(id="original", session_id="s", kind="original-failed", status="failed", dify_run_id="old-native")
    fixture.repo.save_run("s", original)
    fixture.context.failed_run_id = original.id
    result = handlers_fix.handle_verify(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    fixture.repo.save_run("s", result.run)
    historical = deepcopy(result.run)
    saved_input = fixture.context.test_input_ref
    assert not agent.diagnosed
    decision = handlers_fix.handle_await_decision(
        fixture.env, Turn(actor=fixture.actor, action=Action(kind="re_fix")), fixture.session, fixture.context
    )
    assert decision.next == PcState.FIX_DIAGNOSE
    assert fixture.context.failed_run_id == result.run.id
    assert fixture.context.retained_test_input_ref == saved_input
    assert fixture.context.business_acceptance_case_id == "paid"

    def no_replay(*_args: object, **_kwargs: object) -> NoReturn:
        raise AssertionError("Diagnosis/proposal must not replay native execution")

    monkeypatch.setattr(fixture.dify, "run_draft", no_replay)
    diagnosed = handlers_fix.handle_diagnose(fixture.env, turn, fixture.session, fixture.context)
    assert diagnosed.next == PcState.FIX_PROPOSE
    handlers_fix.handle_propose(fixture.env, turn, fixture.session, fixture.context)
    assert agent.diagnosed[0][:2] == (result.run.id, "succeeded")
    assert agent.proposed[0]["business_failure"] == agent.diagnosed[0][2]["business_failure"]
    assert fixture.repo.get_run(result.run.id) == historical
    assert fixture.repo.get_run(original.id) == original


def test_same_unmet_case_uses_existing_repeat_breaker_across_revisions_and_run_ids(
    case: tuple[AcceptanceSetup, EvidenceAgent],
) -> None:
    fixture, agent = case
    signatures = []
    run_ids = []
    for attempt in range(3):
        fixture.dify.hash = f"revision-{attempt}"
        turn = prepare(fixture)
        result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
        assert result.run is not None
        run_ids.append(result.run.id)
        signatures.append(fixture.context.last_repair_error)
    assert len(set(run_ids)) == 3
    assert signatures[0]
    assert len(set(signatures)) == 1
    assert fixture.context.repair_attempts == handlers_fix.MAX_REPEATED_REPAIRS
    assert len(agent.proposed) == 2
    assert fixture.context.staged_repair == []


@pytest.mark.parametrize("mutation", ["no_contract", "changed_source", "unverified"])
def test_unverified_or_absent_expectations_do_not_trigger_business_repair(
    case: tuple[AcceptanceSetup, EvidenceAgent], mutation: str
) -> None:
    fixture, agent = case
    turn = prepare(fixture)
    if mutation == "no_contract":
        fixture.context.business_acceptance_contract = {}
    elif mutation == "changed_source":
        fixture.context.goal_text = "A different task"
    else:
        # A file without owned bytes is unverified, not a failed oracle.
        fixture.context.business_acceptance_contract["cases"][0]["checks"] = [
            {"path": ["document"], "operator": "file", "file_type": "docx"}
        ]
        fixture.dify.run_outputs = {"document": {"filename": "report.docx"}}
    result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    assert not agent.diagnosed
    assert not agent.proposed


def test_diagnostic_projection_redacts_before_model_boundary_and_keeps_oracle_immutable(
    case: tuple[AcceptanceSetup, EvidenceAgent],
) -> None:
    fixture, agent = case
    secret = "fixture-private-api-key"
    fixture.dify.graph["nodes"][0]["data"]["api_key"] = secret
    fixture.context.goal_text += " " + secret
    fixture.context.requirements = {"api_key": secret, "audience": "Operations"}
    turn = prepare(fixture)
    contract_before = deepcopy(fixture.context.business_acceptance_contract)
    result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    assert len(agent.diagnosed) == len(agent.proposed) == 1
    assert secret not in json.dumps(agent.diagnosed + agent.proposed)
    assert fixture.context.business_acceptance_contract == contract_before
    assert fixture.context.requirements["api_key"] == secret


def test_valid_explicit_null_is_not_reported_as_a_business_mismatch(
    case: tuple[AcceptanceSetup, EvidenceAgent],
) -> None:
    fixture, agent = case
    turn = prepare(fixture)
    fixture.context.business_acceptance_contract["cases"][0]["checks"].append(
        {"path": ["optional"], "operator": "equals", "expected": None}
    )
    fixture.dify.run_outputs["optional"] = None
    handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    business = agent.diagnosed[0][2]["business_failure"]
    assert isinstance(business, dict)
    checks = business["checks"]
    assert isinstance(checks, list)
    assert all(isinstance(check, dict) and check["path"] != ["optional"] for check in checks)


def test_progress_to_a_different_failing_path_resets_existing_repeat_counter(
    case: tuple[AcceptanceSetup, EvidenceAgent],
) -> None:
    fixture, _agent = case
    turn = prepare(fixture)
    fixture.dify.run_outputs = {"paid_count": 3, "paid_total": 350}
    handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    first = fixture.context.last_repair_error
    turn = prepare(fixture)
    handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert fixture.context.last_repair_error != first
    assert fixture.context.repair_attempts == 0


def test_business_proposal_stops_if_task_source_changes_after_diagnosis(
    case: tuple[AcceptanceSetup, EvidenceAgent],
) -> None:
    from services.dify_builder.condition_evidence import propose_failure

    fixture, agent = case
    turn = prepare(fixture)
    result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    assert fixture.context.diagnosis is not None
    fixture.context.goal_text = "An unrelated new source"
    intents, risk = propose_failure(
        fixture.env,
        fixture.session.app_id,
        fixture.actor,
        result.run,
        fixture.context.diagnosis,
        fixture.dify.graph,
        task=(fixture.session, fixture.context, fixture.dify.hash),
    )
    assert intents == []
    assert risk.level == "high"
    assert len(agent.proposed) == 1


@pytest.mark.parametrize(
    "mutation", ["stale_revision", "stale_graph", "foreign_run", "changed_contract", "simulated", "oversized_goal"]
)
def test_business_context_does_not_reuse_unbound_or_unavailable_findings(
    case: tuple[AcceptanceSetup, EvidenceAgent], mutation: str
) -> None:
    from services.dify_builder.business_acceptance import business_failure_context

    fixture, _agent = case
    turn = prepare(fixture)
    result = handlers_fix.handle_verify(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    assert result.run.verification is not None
    run = result.run
    assert run.verification is not None
    revision = fixture.dify.hash
    graph_revision = fixture.dify.graph_revision(fixture.dify.graph)
    if mutation == "stale_revision":
        revision = "new-execution"
    elif mutation == "stale_graph":
        graph_revision = "new-graph"
    elif mutation == "foreign_run":
        run.session_id = "foreign-session"
    elif mutation == "changed_contract":
        fixture.context.business_acceptance_contract["cases"][0]["checks"][1]["expected"] = 440
    elif mutation == "simulated":
        assert run.verification.execution_evidence is not None
        run.verification.execution_evidence = run.verification.execution_evidence.model_copy(
            update={"simulated_node_ids": ("output",)}
        )
    else:
        fixture.context.goal_text = "g" * 17_000
        from services.dify_builder.business_acceptance import current_source_digest

        digest = current_source_digest(fixture.context)
        fixture.context.business_acceptance_contract["source_digest"] = digest
        run.verification.business_acceptance["source_digest"] = digest
        from services.dify_builder.business_acceptance import BusinessAcceptanceContract, contract_digest

        run.verification.business_acceptance["contract_digest"] = contract_digest(
            BusinessAcceptanceContract.model_validate(fixture.context.business_acceptance_contract)
        )
    before = deepcopy(run.verification.business_acceptance)
    assert (
        business_failure_context(
            run, fixture.session, fixture.context, current_revision=revision, current_graph_revision=graph_revision
        )
        is None
    )
    assert run.verification.business_acceptance == before


def test_real_fix_prompt_boundary_receives_goal_oracle_and_native_success_kind(
    case: tuple[AcceptanceSetup, EvidenceAgent], monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.model_manager import ModelInstance
    from core.workflow.generator.prompts.builder_prompts import TOOL_OUTPUT_SEMANTICS_RULES
    from services.dify_builder.agent import fix
    from tests.unit_tests.core.model_fixtures import make_model_config

    fixture, agent = case
    turn = prepare(fixture)
    result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    config = make_model_config(provider="openai", model="fixture", mode="chat")
    model = ModelInstance(provider_model_bundle=config.provider_model_bundle, model=config.model, credentials={})
    prompts: list[tuple[str, str]] = []

    def invoke_json(_model: ModelInstance, *, system: str, user: str, **_kwargs: object) -> dict[str, object]:
        prompts.append((system, user))
        if len(prompts) == 1:
            return {"culprit_node_id": "output", "root_cause": "Count paid orders only.", "severity": "high"}
        return {"intents": [], "risk": {"level": "high", "reason": "Manual review", "has_external_side_effect": False}}

    monkeypatch.setattr(fix.llm, "invoke_json", invoke_json)
    diagnosis = fix.diagnose(model, result.run, fixture.dify.graph, result.run.per_node, evidence=agent.diagnosed[0][2])
    fix.propose_repair(model, diagnosis, fixture.dify.graph)
    assert len(prompts) >= 2
    assert "native execution succeeded" in prompts[0][0]
    for system, user in prompts:
        assert TOOL_OUTPUT_SEMANTICS_RULES in system
        assert fixture.context.goal_text in user
        assert '"expected":350' in user
        assert '"actual":440' in user
        assert "business_failure" in user
    assert "never modify the acceptance contract" in prompts[1][1]


def test_fix_business_failure_uses_same_bounded_proposal_breaker(case: tuple[AcceptanceSetup, EvidenceAgent]) -> None:
    fixture, agent = case
    for _attempt in range(3):
        turn = prepare(fixture)
        verified = handlers_fix.handle_verify(fixture.env, turn, fixture.session, fixture.context)
        assert verified.run is not None
        fixture.repo.save_run("s", verified.run)
        handlers_fix.handle_await_decision(
            fixture.env, Turn(actor=fixture.actor, action=Action(kind="re_fix")), fixture.session, fixture.context
        )
        result = handlers_fix.handle_diagnose(fixture.env, turn, fixture.session, fixture.context)
        if result.next == PcState.FIX_PROPOSE:
            handlers_fix.handle_propose(fixture.env, turn, fixture.session, fixture.context)
    assert result.next == PcState.FIX_AWAIT_APPROVAL
    assert fixture.context.repair_attempts == handlers_fix.MAX_REPEATED_REPAIRS
    assert len(agent.proposed) == 2
    assert fixture.context.staged_repair == []


def test_real_llm_builder_proposal_vets_a_current_business_code_repair(
    case: tuple[AcceptanceSetup, EvidenceAgent], monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.model_manager import ModelInstance
    from services.dify_builder.agent import fix, llm_agent
    from tests.unit_tests.core.model_fixtures import make_model_config

    fixture, _recording_agent = case
    original = 'def main(orders: str) -> dict:\n    return {"paid_count": 2, "paid_total": 440}'
    repaired = (
        "def main(orders: str) -> dict:\n"
        "    import json\n"
        '    paid = [o for o in json.loads(orders) if o["status"] == "paid"]\n'
        '    return {"paid_count": len(paid), "paid_total": sum(o["amount"] for o in paid)}'
    )
    fixture.dify.graph["nodes"].insert(
        1,
        {
            "id": "stats",
            "data": {
                "type": "code",
                "title": "Statistics",
                "code_language": "python3",
                "code": original,
                "variables": [{"variable": "orders", "value_selector": ["start", "orders"]}],
                "outputs": {
                    "paid_count": {"type": "number", "children": None},
                    "paid_total": {"type": "number", "children": None},
                },
            },
        },
    )
    fixture.dify.graph["nodes"][-1]["data"]["outputs"] = [
        {"variable": name, "value_selector": ["stats", name]} for name in ("paid_count", "paid_total")
    ]
    fixture.dify.graph["edges"] = [{"source": "start", "target": "stats"}, {"source": "stats", "target": "output"}]
    config = make_model_config(provider="openai", model="fixture", mode="chat")
    model = ModelInstance(provider_model_bundle=config.provider_model_bundle, model=config.model, credentials={})

    def resolve(_tenant: str, _config: dict[str, object]) -> ModelInstance:
        return model

    def invoke_json(_model: ModelInstance, *, system: str, user: str, **_kwargs: object) -> dict[str, object]:
        assert "business_failure" in user
        if "debugging assistant" in system:
            return {"culprit_node_id": "stats", "root_cause": "Cancelled orders must be excluded.", "severity": "high"}
        return {
            "intents": [{"op": "set_node_config", "args": {"node_id": "stats", "path": "code", "value": repaired}}],
            "risk": {"level": "high", "reason": "Review filter correction", "has_external_side_effect": False},
        }

    monkeypatch.setattr(llm_agent, "resolve_model_instance", resolve)
    monkeypatch.setattr(fix.llm, "invoke_json", invoke_json)
    fixture.env.agent = llm_agent.LlmBuilderAgent("t")
    turn = prepare(fixture)
    result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    assert result.run.status == "succeeded"
    assert len(fixture.context.staged_repair) == 1
    assert fixture.context.staged_repair[0].args["value"] == repaired


def test_business_diagnosis_uses_bounded_successful_upstream_native_observations(
    case: tuple[AcceptanceSetup, EvidenceAgent],
) -> None:
    from services.dify_builder.condition_evidence import diagnose_failure, propose_failure

    fixture, agent = case
    fixture.dify.graph["nodes"][1:1] = [
        {"id": "parse", "data": {"type": "tool"}},
        {"id": "stats", "data": {"type": "code", "variables": [{"value_selector": ["parse", "json"]}]}},
        {"id": "irrelevant", "data": {"type": "tool"}},
        {"id": "report", "data": {"type": "llm"}},
    ]
    fixture.dify.graph["nodes"][-1]["data"]["outputs"] = [
        {"variable": "paid_total", "value_selector": ["stats", "paid_total"]}
    ]
    turn = prepare(fixture)
    result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    assert result.run.verification is not None
    result.run.per_node = [
        NodeOutput(
            node_id="parse",
            status="success",
            outputs_available=True,
            outputs={
                "json": [{"data": []}],
                "text": '[{"status":"paid","amount":350}]',
                "files": [{"url": "https://private.example/docx"}],
                "api_key": "secret-business-key",
            },
        ),
        NodeOutput(
            node_id="stats",
            status="success",
            outputs_available=True,
            inputs={"orders": [{"data": []}]},
            outputs={"paid_total": 440},
        ),
        NodeOutput(node_id="irrelevant", status="success", outputs_available=True, outputs={"text": "UNRELATED"}),
        NodeOutput(node_id="report", status="success", outputs_available=True, outputs={"text": "LONGREPORT" * 5000}),
    ]
    result.run.verification.executed_node_ids = [row.node_id for row in result.run.per_node]
    diagnosis = diagnose_failure(
        fixture.env,
        "app",
        fixture.actor,
        result.run,
        fixture.dify.graph,
        task=(fixture.session, fixture.context, fixture.dify.hash),
    )
    propose_failure(
        fixture.env,
        "app",
        fixture.actor,
        result.run,
        diagnosis,
        fixture.dify.graph,
        task=(fixture.session, fixture.context, fixture.dify.hash),
    )
    observations = agent.diagnosed[-1][2]["business_observations"]
    assert isinstance(observations, list)
    assert [row["node_id"] for row in observations if isinstance(row, dict)] == ["parse", "stats"]
    rendered = json.dumps(observations)
    assert "paid" in rendered
    assert "data" in rendered
    parser = observations[0]
    assert isinstance(parser, dict)
    outputs = parser["outputs"]
    assert isinstance(outputs, dict)
    fields = outputs["fields"]
    assert isinstance(fields, dict)
    json_channel = fields["json"]
    assert isinstance(json_channel, dict)
    items = json_channel["items"]
    assert isinstance(items, list)
    envelope = items[0]
    assert isinstance(envelope, dict)
    envelope_fields = envelope["fields"]
    assert isinstance(envelope_fields, dict)
    assert envelope_fields["data"] == {"type": "array", "length": 0}
    assert "orders" in rendered
    assert all(
        secret not in rendered for secret in ("private.example", "secret-business-key", "UNRELATED", "LONGREPORT")
    )
    assert len(rendered.encode()) < 8000
    assert agent.proposed[-1]["business_observations"] == observations


def test_legacy_fix_again_does_not_read_graph_for_absent_business_contract(
    case: tuple[AcceptanceSetup, EvidenceAgent], monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture, _agent = case
    fixture.context.verify_run_id = "legacy"

    def reject_read(_app: str, _actor: Actor) -> NoReturn:
        pytest.fail("legacy re_fix must retain its existing no-read transition")

    monkeypatch.setattr(fixture.dify, "read_graph", reject_read)
    result = handlers_fix.handle_await_decision(
        fixture.env, Turn(actor=fixture.actor, action=Action(kind="re_fix")), fixture.session, fixture.context
    )
    assert result.next == PcState.FIX_DIAGNOSE


def test_business_diagnosis_keeps_successful_native_run_and_uses_no_failed_run_lookup(
    case: tuple[AcceptanceSetup, EvidenceAgent], monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.condition_evidence import diagnose_failure

    fixture, agent = case
    turn = prepare(fixture)
    result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None

    def reject_read(_app: str, _actor: Actor, _native_run: str) -> NoReturn:
        pytest.fail("A native success must use immutable saved observations, not failed-run lookup")

    monkeypatch.setattr(fixture.dify, "node_outputs", reject_read)
    diagnose_failure(
        fixture.env,
        "app",
        fixture.actor,
        result.run,
        fixture.dify.graph,
        task=(fixture.session, fixture.context, fixture.dify.hash),
    )
    assert agent.diagnosed[-1][1] == "succeeded"
    assert result.run.error == ""


@pytest.mark.parametrize("change", ["noop", "routing", "if_semantics", "stale_graph"])
def test_business_proposal_retains_noop_routing_and_unknown_if_guards(
    case: tuple[AcceptanceSetup, EvidenceAgent], change: str
) -> None:
    from services.dify_builder.condition_evidence import repair_evidence_rejections

    fixture, agent = case
    if change == "if_semantics":
        fixture.dify.graph["nodes"].insert(1, {"id": "condition", "data": {"type": "if-else", "cases": []}})
    turn = prepare(fixture)
    handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    evidence = agent.proposed[-1]
    before = deepcopy(fixture.dify.graph)
    after = deepcopy(before)
    touched: set[str] = set()
    if change == "routing":
        after["edges"] = [{"source": "start", "target": "output"}]
    elif change == "if_semantics":
        after["nodes"][1]["data"]["cases"] = [{"case_id": "new", "conditions": []}]
        touched.add("condition")
    elif change == "stale_graph":
        before["nodes"][0]["data"]["title"] = "New graph"
        after["nodes"][0]["data"]["title"] = "Candidate"
    assert repair_evidence_rejections(before, after, touched, evidence)


@pytest.mark.parametrize("unusable", ["failed", "skip", "duplicate", "unavailable", "not_executed"])
def test_business_observations_do_not_promote_unusable_native_rows(
    case: tuple[AcceptanceSetup, EvidenceAgent], unusable: str
) -> None:
    from services.dify_builder.condition_evidence import diagnose_failure

    fixture, agent = case
    fixture.dify.graph["nodes"].insert(1, {"id": "stats", "data": {"type": "code"}})
    fixture.dify.graph["nodes"][-1]["data"]["outputs"] = [
        {"variable": "paid_total", "value_selector": ["stats", "paid_total"]}
    ]
    turn = prepare(fixture)
    result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    assert result.run.verification is not None
    row = NodeOutput(node_id="stats", status="success", outputs_available=True, outputs={"paid_total": 440})
    if unusable in {"failed", "skip"}:
        row.status = unusable
    if unusable == "unavailable":
        row.outputs_available = False
    result.run.per_node = [row, deepcopy(row)] if unusable == "duplicate" else [row]
    result.run.verification.executed_node_ids = [] if unusable == "not_executed" else ["stats"]
    diagnose_failure(
        fixture.env,
        "app",
        fixture.actor,
        result.run,
        fixture.dify.graph,
        task=(fixture.session, fixture.context, fixture.dify.hash),
    )
    assert agent.diagnosed[-1][2]["business_observations"] == []


@pytest.mark.parametrize("mode", ["build", "edit", "fix"])
def test_explicit_approval_forwards_builder_business_run_identity_without_native_failure_authority(
    case: tuple[AcceptanceSetup, EvidenceAgent], mode: str
) -> None:
    fixture, _agent = case
    turn = prepare(fixture)
    result = handlers_build.handle_test_and_repair(fixture.env, turn, fixture.session, fixture.context)
    assert result.run is not None
    fixture.repo.save_run(fixture.session.id, result.run)
    fixture.context.staged_repair = [
        MutationIntent(
            op="set_node_config",
            args={
                "node_id": "output",
                "path": "title",
                "value": "Reviewed output",
            },
        )
    ]
    fixture.context.last_snapshot_hash = fixture.dify.hash
    approval = Turn(actor=fixture.actor, action=Action(kind="approve_repair"))
    if mode == "build":
        handlers_build.handle_await_repair(fixture.env, approval, fixture.session, fixture.context)
    elif mode == "edit":
        handlers_edit.handle_await_repair(fixture.env, approval, fixture.session, fixture.context)
    else:
        fixture.context.failed_run_id = result.run.id
        handlers_fix.handle_apply(fixture.env, approval, fixture.session, fixture.context)
    assert fixture.dify.last_business_failure_run_id == result.run.id
    assert fixture.dify.last_repair_run_id is None
    assert fixture.context.business_acceptance_contract
    assert result.run.status == "succeeded"
    assert not fixture.dify.published


@pytest.mark.parametrize("mode", ["build", "edit"])
def test_repair_checkpoint_restores_pre_repair_graph_and_preserves_run_oracle(
    case: tuple[AcceptanceSetup, EvidenceAgent], monkeypatch: pytest.MonkeyPatch, mode: str
) -> None:
    from dataclasses import asdict

    from services.dify_builder.application.runner import Runner
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    fixture, agent = case
    port = FakeBuildDifyPort()
    port.graph = deepcopy(fixture.dify.graph)
    port.run_outputs = {"paid_count": 2, "paid_total": 440}
    env = Env(dify=port, repo=fixture.repo, agent=agent, now=lambda: datetime.min)
    handlers_fix.mint_checkpoint(
        env,
        fixture.session,
        fixture.context,
        {"nodes": [], "edges": []},
        "pre-generation",
        PcState.BUILD_PLAN_APPROVAL,
    )
    old_checkpoint = fixture.context.checkpoint_id
    fixture.context.checkpoint_seq = 1
    fixture.context.last_snapshot_hash = port.hash
    fixture.context.next_seq = 20
    turn = prepare(fixture)
    before_graph = deepcopy(port.graph)
    before_oracle = deepcopy(fixture.context.business_acceptance_contract)

    def proposal(
        _diagnosis: Diagnosis, _current: Graph, _safe: Graph, _redact: Callable[[str], str]
    ) -> tuple[list[MutationIntent], Risk]:
        return [
            MutationIntent(op="set_node_config", args={"node_id": "output", "path": "title", "value": "Reviewed"})
        ], Risk(level="high", has_external_side_effect=False)

    monkeypatch.setattr(agent, "propose_with_evidence", proposal)
    fixture.session.current_state = (
        PcState.BUILD_TEST_AND_REPAIR if mode == "build" else PcState.EDIT_TEST_AFFECTED_PATHS
    )
    fixture.repo.create_session(fixture.session, fixture.context, [])
    registry = handlers_build.build_registry() if mode == "build" else handlers_edit.edit_registry()
    runner = Runner(env, registry)
    assert turn.action is not None
    turn.action.base_version = fixture.repo.get_session(fixture.session.id)[0].version
    runner.advance(fixture.session.id, turn)
    session, context = fixture.repo.get_session(fixture.session.id)
    assert context.checkpoint_id != old_checkpoint
    checkpoint, snapshot = fixture.repo.get_checkpoint(context.checkpoint_id)
    assert checkpoint.session_id == session.id
    assert snapshot.graph == before_graph
    assert snapshot.hash == port.hash
    assert context.checkpoint_seq == 20
    assert context.last_snapshot_hash == port.hash
    original_run = asdict(fixture.repo.get_run(context.verify_run_id))
    approval = Turn(actor=fixture.actor, action=Action(kind="approve_repair"))
    apply = handlers_build.handle_await_repair if mode == "build" else handlers_edit.handle_await_repair
    applied = apply(env, approval, session, context)
    assert port.graph != before_graph
    assert applied.context is not None
    reverted = apply(env, Turn(actor=fixture.actor, action=Action(kind="undo")), session, applied.context)
    assert port.graph == before_graph
    assert asdict(fixture.repo.get_run(context.verify_run_id)) == original_run
    assert reverted.context is not None
    assert reverted.context.business_acceptance_contract == before_oracle
    assert reverted.context.checkpoint_id == ""
