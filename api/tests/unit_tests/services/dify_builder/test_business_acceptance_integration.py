"""Explicit test-data contracts must gate publication through the existing flows."""

from dataclasses import dataclass
from datetime import datetime
from typing import NoReturn, NotRequired, TypedDict, override

import pytest
from pydantic import JsonValue

from core.dify_builder.errors import BadRequestError
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Graph, Session, Turn
from core.dify_builder.state import PcState
from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
from services.dify_builder.application.runner import Env, Handler
from services.dify_builder.revision import executable_graph_revision
from services.dify_builder.serde import context_from_dict, context_to_dict
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text


class AcceptancePort(FakeDifyPort):
    @override
    def graph_revision(self, graph: Graph) -> str:
        return executable_graph_revision(graph)


@dataclass(frozen=True)
class AcceptanceSetup:
    env: Env
    session: Session
    context: DifyBuilderContext
    actor: Actor
    dify: AcceptancePort
    repo: InMemoryRepository


class CheckPayload(TypedDict):
    path: list[str]
    operator: str
    expected: NotRequired[JsonValue]


class CasePayload(TypedDict):
    id: str
    inputs: dict[str, JsonValue]
    checks: list[CheckPayload]
    forbidden_node_types: NotRequired[list[str]]


class ContractPayload(TypedDict):
    task_id: NotRequired[str | None]
    source_digest: NotRequired[str | None]
    confirmed: bool
    cases: list[CasePayload]


@pytest.fixture
def setup() -> AcceptanceSetup:
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
    env = Env(dify=dify, repo=repo, agent=StubAgent(), now=lambda: datetime.min)
    s = Session(id="s", app_id="app", entry_mode=EntryMode.FIX, current_state=PcState.FIX_AWAIT_TESTDATA)
    fc = DifyBuilderContext(goal_text="Paid orders report", checkpoint_seq=7)
    actor = Actor(account_id="a", tenant_id="t")
    return AcceptanceSetup(env, s, fc, actor, dify, repo)


def explicit_contract(s: Session, fc: DifyBuilderContext) -> ContractPayload:
    from services.dify_builder.business_acceptance import current_source_digest, current_task_id

    return {
        "task_id": current_task_id(s, fc),
        "source_digest": current_source_digest(fc),
        "confirmed": True,
        "cases": [
            {
                "id": "paid",
                "inputs": {"orders": "valid-orders"},
                "checks": [
                    {"path": ["paid_count"], "operator": "equals", "expected": 2},
                    {"path": ["paid_total"], "operator": "equals", "expected": 350},
                ],
            },
            {
                "id": "invalid",
                "inputs": {"orders": "not-json"},
                "checks": [{"path": ["error"], "operator": "nonnull"}],
                "forbidden_node_types": ["tool", "llm"],
            },
        ],
    }


FLOWS = [
    (handlers_fix.handle_await_testdata, handlers_fix.handle_verify),
    (handlers_build.handle_await_testdata, handlers_build.handle_test_and_repair),
    (handlers_edit.handle_await_testdata, handlers_edit.handle_test_affected_paths),
]


@pytest.mark.parametrize(("prepare_handler", "test_handler"), FLOWS)
def test_contract_metadata_stays_out_of_start_inputs_and_invalid_only_cannot_publish(
    setup: AcceptanceSetup, prepare_handler: Handler, test_handler: Handler
) -> None:
    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    payload = {
        "inputs": {"orders": "not-json"},
        "business_acceptance_contract": explicit_contract(s, fc),
        "acceptance_case_id": "invalid",
    }
    turn = Turn(actor=actor, action=Action(kind="provide_testdata", payload=payload))
    prepared = prepare_handler(env, turn, s, fc)
    assert prepared.context is not None
    ti = setup.repo.get_test_input(fc.test_input_ref)
    assert ti.inputs == {"orders": "not-json"}
    setup.dify.run_outputs = {"error": "Invalid JSON"}
    result = test_handler(env, turn, s, fc)
    assert result.run is not None
    assert result.run.verification is not None
    setup.repo.save_run(s.id, result.run)
    finding = result.run.verification.business_acceptance
    assert finding["state"] == "passed"
    assert finding["execution_state"] == "succeeded"
    assert fc.business_acceptance_run_refs == {"invalid": result.run.id}
    decision = handlers_fix.publication_for_context(env, turn, s, fc)
    assert not decision.allowed
    assert decision.reason == "business_acceptance_unverified"
    assert not setup.dify.published
    cards = [item for item in result.items if item.kind == "test_result"]
    assert cards[0].payload["business_acceptance_state"] == "passed"
    assert cards[0].payload["business_acceptance_case_id"] == "invalid"
    from services.dify_builder.service import DifyBuilderService

    service = object.__new__(DifyBuilderService)
    service._repo = setup.repo
    service._get_verification_identity_fn = lambda _app_id, _actor: (
        setup.dify.hash,
        setup.dify.graph_revision(setup.dify.graph),
    )
    assert not service._publication_for_session(s, fc, actor).allowed


@pytest.mark.parametrize("mutation", ["task", "source", "sample", "unconfirmed", "null_task", "null_source"])
def test_explicit_contract_cannot_bind_foreign_task_source_or_sample(setup: AcceptanceSetup, mutation: str) -> None:
    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    c = explicit_contract(s, fc)
    if mutation == "task":
        c["task_id"] = "another-task"
    elif mutation == "source":
        c["source_digest"] = "b" * 64
    elif mutation == "unconfirmed":
        c["confirmed"] = False
    elif mutation == "null_task":
        c["task_id"] = None
    elif mutation == "null_source":
        c["source_digest"] = None
    inputs = {"orders": "wrong" if mutation == "sample" else "valid-orders"}
    turn = Turn(
        actor=actor,
        action=Action(
            kind="provide_testdata",
            payload={"inputs": inputs, "business_acceptance_contract": c, "acceptance_case_id": "paid"},
        ),
    )
    with pytest.raises(BadRequestError):
        handlers_fix.handle_await_testdata(env, turn, s, fc)
    assert fc.test_input_ref == ""
    assert not fc.business_acceptance_contract
    assert not setup.dify.run_draft_inputs


def test_all_confirmed_cases_required_and_stale_or_replaced_task_cannot_publish(setup: AcceptanceSetup) -> None:
    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    c = explicit_contract(s, fc)
    turn = Turn(actor=actor)
    for case, inputs, outputs in [
        ("invalid", {"orders": "not-json"}, {"error": "Invalid JSON"}),
        ("paid", {"orders": "valid-orders"}, {"paid_count": 2, "paid_total": 350}),
    ]:
        turn = Turn(
            actor=actor,
            action=Action(
                kind="provide_testdata",
                payload={"inputs": inputs, "business_acceptance_contract": c, "acceptance_case_id": case},
            ),
        )
        handlers_fix.handle_await_testdata(env, turn, s, fc)
        setup.dify.run_outputs = outputs
        result = handlers_fix.handle_verify(env, turn, s, fc)
        assert result.run is not None
        assert result.run.verification is not None
        setup.repo.save_run(s.id, result.run)
    assert handlers_fix.publication_for_context(env, turn, s, fc).allowed
    # Publication inspection reuses immutable evidence and does not execute cases.
    last_input_identity = setup.dify.run_draft_identity
    assert handlers_fix.publication_for_context(env, turn, s, fc).allowed
    assert setup.dify.run_draft_identity == last_input_identity
    setup.dify.hash = "changed"
    assert not handlers_fix.publication_for_context(env, turn, s, fc).allowed
    setup.dify.hash = "h0"
    fc.checkpoint_seq += 1
    assert handlers_fix.publication_for_context(env, turn, s, fc).allowed
    handlers_fix.handle_await_testdata(env, turn, s, fc)
    assert len(fc.business_acceptance_contract["cases"]) == 2
    assert len(fc.business_acceptance_run_refs) == 2
    fc.goal_text = "Different task source"
    assert not handlers_fix.publication_for_context(env, turn, s, fc).allowed


def test_acceptance_context_and_run_evidence_survive_persisted_json(setup: AcceptanceSetup) -> None:
    from models.dify_builder import DifyBuilderRun
    from services.dify_builder.repository import SqlDifyBuilderRepository

    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    turn = Turn(
        actor=actor,
        action=Action(
            kind="provide_testdata",
            payload={
                "inputs": {"orders": "not-json"},
                "business_acceptance_contract": explicit_contract(s, fc),
                "acceptance_case_id": "invalid",
            },
        ),
    )
    handlers_fix.handle_await_testdata(env, turn, s, fc)
    setup.dify.run_outputs = {"error": "Invalid JSON"}
    result = handlers_fix.handle_verify(env, turn, s, fc)
    restored = context_from_dict(context_to_dict(fc))
    assert restored.business_acceptance_contract == fc.business_acceptance_contract
    assert restored.business_acceptance_run_refs == fc.business_acceptance_run_refs
    assert restored.business_acceptance_case_id == "invalid"
    from dataclasses import asdict

    run = result.run
    assert run is not None
    assert run.verification is not None
    # Match the persistent row's JSON boundary rather than using a structural double.
    row = DifyBuilderRun(
        id=run.id,
        session_id=run.session_id,
        kind=run.kind,
        dify_run_id=run.dify_run_id,
        status=run.status,
        per_node=[asdict(node) for node in run.per_node],
        verification={
            **asdict(run.verification),
            "execution_evidence": run.verification.execution_evidence.model_dump(mode="json")
            if run.verification.execution_evidence
            else None,
        },
        culprit_node_id=run.culprit_node_id,
        error=run.error,
        inputs_ref=run.inputs_ref,
        tokens=run.tokens,
        elapsed_ms=run.elapsed_ms,
        immutable=run.immutable,
    )
    decoded = SqlDifyBuilderRepository._to_domain_run(row)
    assert decoded.id == run.id
    assert decoded.inputs_ref == run.inputs_ref
    assert decoded.verification is not None
    assert decoded.verification.business_acceptance == run.verification.business_acceptance
    assert context_from_dict({}).business_acceptance_contract == {}


def test_no_contract_retains_execution_only_review_without_inferred_business_truth(setup: AcceptanceSetup) -> None:
    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    turn = Turn(actor=actor, action=Action(kind="provide_testdata", payload={"inputs": {"orders": "not-json"}}))
    handlers_fix.handle_await_testdata(env, turn, s, fc)
    setup.dify.run_outputs = {"error": "Invalid JSON"}
    result = handlers_fix.handle_verify(env, turn, s, fc)
    assert result.run is not None
    assert result.run.verification is not None
    setup.repo.save_run(s.id, result.run)
    assert result.run.verification.business_acceptance == {}
    assert handlers_fix.publication_for_context(env, turn, s, fc).allowed
    card = next(item for item in result.items if item.kind == "test_result")
    assert "goal acceptance were not verified" in english_text(card.payload["review_note"])


def test_continuing_task_clears_prior_business_authority() -> None:
    from tests.unit_tests.services.dify_builder.test_conversation_tasks import continue_task, setup_task

    env, repo, session = setup_task()
    _, context = repo.get_session(session.id)
    context.business_acceptance_contract = {"prior": "contract"}
    context.business_acceptance_case_id = "paid"
    context.business_acceptance_run_refs = {"paid": "old-run"}
    repo.compare_and_advance(session.id, session.version, session.current_state, context, [])
    session, _ = repo.get_session(session.id)
    continue_task(env, session)
    _, current = repo.get_session(session.id)
    assert current.business_acceptance_contract == {}
    assert current.business_acceptance_case_id == ""
    assert current.business_acceptance_run_refs == {}


def test_action_proposal_needs_no_private_task_or_source_identifiers(setup: AcceptanceSetup) -> None:
    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    proposal = explicit_contract(s, fc)
    proposal.pop("task_id")
    proposal.pop("source_digest")
    turn = Turn(
        actor=actor,
        action=Action(
            kind="provide_testdata",
            payload={
                "inputs": {"orders": "valid-orders"},
                "business_acceptance_contract": proposal,
                "acceptance_case_id": "paid",
            },
        ),
    )
    handlers_fix.handle_await_testdata(env, turn, s, fc)
    assert fc.business_acceptance_contract["task_id"] == "s:7"
    assert len(fc.business_acceptance_contract["source_digest"]) == 64
    assert setup.repo.get_test_input(fc.test_input_ref).inputs == {"orders": "valid-orders"}


def test_failed_forbidden_tool_on_handled_branch_blocks_shared_publication(setup: AcceptanceSetup) -> None:
    from core.dify_builder.models import NodeOutput
    from services.dify_builder.business_acceptance import record_run_acceptance

    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    setup.dify.graph["nodes"].append(
        {"id": "forbidden", "data": {"type": "tool", "provider_id": "real/provider", "tool_name": "send"}}
    )
    turn = Turn(
        actor=actor,
        action=Action(
            kind="provide_testdata",
            payload={
                "inputs": {"orders": "not-json"},
                "business_acceptance_contract": explicit_contract(s, fc),
                "acceptance_case_id": "invalid",
            },
        ),
    )
    handlers_fix.handle_await_testdata(env, turn, s, fc)
    setup.dify.run_outputs = {"error": "Invalid JSON"}
    result = handlers_fix.handle_verify(env, turn, s, fc)
    run = result.run
    assert run is not None
    assert run.verification is not None
    run.per_node.append(NodeOutput(node_id="forbidden", status="failed"))
    run.verification.executed_node_ids.append("forbidden")
    record_run_acceptance(s, fc, run, setup.repo.get_test_input(fc.test_input_ref), setup.dify.graph, setup.dify.hash)
    setup.repo.save_run(s.id, run)
    assert run.status == "succeeded"
    assert run.verification.business_acceptance["state"] == "failed"
    assert handlers_fix.publication_for_context(env, turn, s, fc).reason == "business_acceptance_failed"


def test_nonfinite_contract_is_rejected_before_native_execution(setup: AcceptanceSetup) -> None:
    from services.dify_builder.application.runner import Runner

    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    setup.repo.create_session(s, fc, [])
    c = explicit_contract(s, fc)
    c["cases"][0]["checks"][0]["expected"] = float("nan")
    turn = Turn(
        actor=actor,
        action=Action(
            kind="provide_testdata",
            base_version=s.version,
            payload={
                "inputs": {"orders": "valid-orders"},
                "business_acceptance_contract": c,
                "acceptance_case_id": "paid",
            },
        ),
    )
    with pytest.raises(BadRequestError):
        Runner(env, handlers_fix.fix_registry()).advance(s.id, turn)
    assert not setup.dify.run_draft_inputs
    _, current = setup.repo.get_session(s.id)
    assert not current.verify_run_id
    assert not current.business_acceptance_contract


def test_invalid_annotation_preserves_completed_native_run_and_blocks_publication(setup: AcceptanceSetup) -> None:
    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    turn = Turn(
        actor=actor,
        action=Action(
            kind="provide_testdata",
            payload={
                "inputs": {"orders": "valid-orders"},
                "business_acceptance_contract": explicit_contract(s, fc),
                "acceptance_case_id": "paid",
            },
        ),
    )
    handlers_fix.handle_await_testdata(env, turn, s, fc)
    # Malformed persisted metadata is an annotation problem, never permission to replay.
    fc.business_acceptance_contract["cases"][0]["checks"][0]["expected"] = float("nan")
    setup.dify.run_outputs = {"paid_count": 2, "paid_total": 350}
    result = handlers_fix.handle_verify(env, turn, s, fc)
    assert result.run is not None
    assert result.run.verification is not None
    assert result.run.status == "succeeded"
    assert fc.verify_run_id == result.run.id
    assert result.run.verification.business_acceptance["state"] == "unverified"
    setup.repo.save_run(s.id, result.run)
    assert setup.repo.get_run(result.run.id).dify_run_id == "dify-run-1"
    assert not handlers_fix.publication_for_context(env, turn, s, fc).allowed


def test_confirmed_completed_run_is_retained_without_post_effect_graph_read(
    setup: AcceptanceSetup, monkeypatch: pytest.MonkeyPatch
) -> None:
    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    turn = Turn(
        actor=actor,
        action=Action(
            kind="provide_testdata",
            payload={
                "inputs": {"orders": "valid-orders"},
                "business_acceptance_contract": explicit_contract(s, fc),
                "acceptance_case_id": "paid",
            },
        ),
    )
    handlers_fix.handle_await_testdata(env, turn, s, fc)
    fc.confirmed_consent_id = "consent"
    fc.confirmed_command_id = "command"

    def unavailable(*_args: object) -> NoReturn:
        raise RuntimeError("Graph became unavailable after the real effect")

    monkeypatch.setattr(env.dify, "read_graph", unavailable)
    result = handlers_fix.confirmed_tool_test(
        env, turn, s, fc, review_state=PcState.FIX_AWAIT_DECISION, step_prefix="fix"
    )
    assert result.run is not None
    assert result.run.verification is not None
    assert result.run.status == "succeeded"
    assert fc.verify_run_id == result.run.id
    assert result.run.verification.business_acceptance["state"] == "unverified"
    assert result.run.verification.terminal_outputs is None
    assert setup.dify.run_draft_inputs == {"orders": "valid-orders"}
    setup.repo.save_run(s.id, result.run)
    assert setup.repo.get_run(result.run.id).dify_run_id == "dify-run-1"


@pytest.mark.parametrize("owner", ["build", "edit"])
def test_confirmed_new_request_source_clears_prior_acceptance_authority(setup: AcceptanceSetup, owner: str) -> None:
    env, s, fc, actor = setup.env, setup.session, setup.context, setup.actor
    fc.form_fields = [{"key": "format", "label": "Format", "type": "text"}]
    fc.requirements = {"format": "old"}
    fc.edit_rules = {"format": "old"}
    turn = Turn(
        actor=actor,
        action=Action(
            kind="provide_testdata",
            payload={
                "inputs": {"orders": "valid-orders"},
                "business_acceptance_contract": explicit_contract(s, fc),
                "acceptance_case_id": "paid",
            },
        ),
    )
    handlers_fix.handle_await_testdata(env, turn, s, fc)
    fc.business_acceptance_run_refs = {"paid": "historical-run"}
    if owner == "build":
        handlers_build.handle_goal_analysis(
            env, Turn(actor=actor, action=Action(kind="submit_requirements", payload={"format": "new"})), s, fc
        )
    else:
        handlers_edit.handle_impact_analysis(
            env, Turn(actor=actor, action=Action(kind="submit_edit_rules", payload={"format": "new"})), s, fc
        )
    assert fc.business_acceptance_contract == {}
    assert fc.business_acceptance_task_id == ""
    assert fc.business_acceptance_case_id == ""
    assert fc.business_acceptance_run_refs == {}
