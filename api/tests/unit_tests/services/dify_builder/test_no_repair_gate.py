"""No proposed fix must offer usable retry and finish paths without rejection text."""

from datetime import datetime
from typing import override

import pytest

from core.dify_builder.errors import BadRequestError
from core.dify_builder.models import (
    Action,
    Actor,
    ChecklistError,
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
from services.dify_builder.application.handlers_fix import fix_registry, handle_propose
from services.dify_builder.application.runner import Env, Runner
from services.dify_builder.service import DifyBuilderService, resolve_submitted_action
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text
from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

ACTOR = Actor(account_id="owner", tenant_id="tenant")
REPAIR = MutationIntent(op="set_node_config", args={"node_id": "output", "path": "title", "value": "Fixed"})


class RetryingAgent(StubAgent):
    def __init__(self) -> None:
        super().__init__(risk_level="high")
        self.run_diagnoses = 0
        self.checklist_diagnoses = 0
        self.proposals = 0
        self.empty_risk_level: str | None = None
        self.proposal_contexts: list[tuple[Diagnosis, Graph]] = []

    @override
    def diagnose(self, failed_run: Run, graph: Graph, node_outputs: list[NodeOutput]) -> Diagnosis:
        self.run_diagnoses += 1
        return super().diagnose(failed_run, graph, node_outputs)

    @override
    def diagnose_checklist(self, errors: list[ChecklistError], graph: Graph) -> Diagnosis:
        self.checklist_diagnoses += 1
        return super().diagnose_checklist(errors, graph)

    @override
    def propose_repair(self, diagnosis: Diagnosis, graph: Graph) -> tuple[list[MutationIntent], Risk]:
        self.proposals += 1
        self.proposal_contexts.append((diagnosis, graph))
        if self.empty_risk_level is not None:
            return [], Risk(level=self.empty_risk_level, reason="No usable repair")
        return [REPAIR], Risk(level="high")


def _gate(
    source: str, *, staged: bool = False
) -> tuple[DifyBuilderService, Runner, InMemoryRepository, FakeDifyPort, RetryingAgent, Session]:
    repo = InMemoryRepository()
    dify = FakeDifyPort()
    agent = RetryingAgent()
    session = Session(
        app_id="app",
        tenant_id=ACTOR.tenant_id,
        owner_account_id=ACTOR.account_id,
        entry_mode=EntryMode.FIX_CHECKLIST if source == "checklist" else EntryMode.FIX,
        current_state=PcState.FIX_AWAIT_APPROVAL,
    )
    context = DifyBuilderContext(
        source=source,
        failed_run_id="failed" if source == "run" else "",
        checklist_errors=[ChecklistError(node_id="output", messages=["Select a start node"])]
        if source == "checklist"
        else [],
        diagnosis=Diagnosis(root_cause="Prior diagnosis"),
        staged_repair=[REPAIR] if staged else [],
        risk=Risk(level="high", reason="Prior assessment"),
        last_snapshot_hash=dify.hash,
    )
    repo.create_session(session, context, [])
    if source == "run":
        repo.save_run(session.id, Run(id="failed", dify_run_id="native-failed", status="failed", immutable=True))
    lock = FakeSessionLock()
    service = DifyBuilderService(repo, lock, lambda *_: None, get_app_revision_fn=lambda *_: dify.hash)
    runner = Runner(
        Env(
            repo=repo,
            dify=dify,
            agent=agent,
            now=lambda: datetime.min,
        ),
        fix_registry(),
    )
    return service, runner, repo, dify, agent, session


@pytest.mark.parametrize("source", ["run", "checklist"])
def test_empty_repair_offers_retry_and_finish_without_input(source: str) -> None:
    service, _, _, _, _, session = _gate(source)

    view = service.get_session_view(session.id, ACTOR)

    assert [action.id for action in view.actions] == ["retry_repair", "finish_repair"]
    assert view.decision is not None
    assert english_text(view.decision.title) == "No repair available"
    assert view.decision.default_option_id == "retry_repair"
    assert [option.id for option in view.decision.options] == ["retry_repair", "finish_repair"]
    assert all(option.input is None for option in view.decision.options)


@pytest.mark.parametrize("source", ["run", "checklist"])
@pytest.mark.parametrize("option_id", ["retry_repair", "finish_repair"])
def test_no_repair_choice_is_admitted_and_durably_performs_its_action(source: str, option_id: str) -> None:
    service, runner, repo, dify, agent, session = _gate(source)
    original_graph, original_hash = dify.read_graph(session.app_id, ACTOR)
    action = Action(
        kind=resolve_submitted_action("confirm", {"option_id": option_id}),
        payload={"option_id": option_id},
        base_version=session.version,
        base_app_revision=original_hash,
    )
    service._prepare_action(session.id, ACTOR, action)

    runner.advance(session.id, Turn(actor=ACTOR, action=action))

    reloaded = service.get_session_view(session.id, ACTOR)
    _, stored = repo.get_session(session.id)
    if option_id == "retry_repair":
        assert reloaded.state == str(PcState.FIX_AWAIT_APPROVAL)
        assert stored.diagnosis is not None
        assert stored.diagnosis.root_cause != "Prior diagnosis"
        assert stored.staged_repair == [REPAIR]
        assert stored.risk is not None
        assert stored.risk.reason != "Prior assessment"
        assert (agent.run_diagnoses, agent.checklist_diagnoses) == ((1, 0) if source == "run" else (0, 1))
        assert agent.proposals == 1
        assert [available.id for available in reloaded.actions] == ["approve_plan", "reject_repair"]
    else:
        assert reloaded.state == str(PcState.SUCCESS)
        assert reloaded.run_status == "complete"
        assert reloaded.decision is None
        assert reloaded.actions == []
        assert (agent.run_diagnoses, agent.checklist_diagnoses, agent.proposals) == (0, 0, 0)
    assert dify.read_graph(session.app_id, ACTOR) == (original_graph, original_hash)
    assert dify.applied == []
    assert dify.published is False
    assert dify.run_draft_inputs == {}
    responses = [item for item in repo.list_conversation(session.id) if item.kind == "interaction_response"]
    assert len(responses) == 1
    assert english_text(responses[0].payload["question"]) == "No repair available"
    assert responses[0].payload["submitted_data"] == {"option_id": option_id}


@pytest.mark.parametrize("option_id", ["retry_repair", "finish_repair"])
def test_no_repair_choices_are_refused_when_a_repair_is_staged(option_id: str) -> None:
    service, _, repo, dify, _, session = _gate("run", staged=True)

    with pytest.raises(BadRequestError, match="not allowed"):
        service._prepare_action(
            session.id,
            ACTOR,
            Action(kind=option_id, base_version=session.version, base_app_revision=dify.hash),
        )

    assert repo.get_session(session.id)[0].version == session.version


def test_staged_repair_rejection_submits_only_the_selected_option() -> None:
    service, runner, repo, dify, agent, session = _gate("run", staged=True)
    view = service.get_session_view(session.id, ACTOR)
    assert view.decision is not None
    reject = next(option for option in view.decision.options if option.id == "reject_repair")
    assert reject.input is None
    original_graph, original_hash = dify.read_graph(session.app_id, ACTOR)
    action = Action(
        kind=resolve_submitted_action("confirm", {"option_id": reject.id}),
        payload={"option_id": reject.id},
        base_version=session.version,
        base_app_revision=original_hash,
    )

    service._prepare_action(session.id, ACTOR, action)
    runner.advance(session.id, Turn(actor=ACTOR, action=action))

    reloaded = service.get_session_view(session.id, ACTOR)
    assert reloaded.state == str(PcState.FIX_AWAIT_DECISION)
    assert reloaded.run_status == "waiting_confirmation"
    assert dify.read_graph(session.app_id, ACTOR) == (original_graph, original_hash)
    assert dify.applied == []
    assert dify.published is False
    assert (agent.run_diagnoses, agent.checklist_diagnoses, agent.proposals) == (0, 0, 0)
    responses = [item for item in repo.list_conversation(session.id) if item.kind == "interaction_response"]
    assert len(responses) == 1
    assert english_text(responses[0].payload["answer"]) == "Reject"
    assert responses[0].payload["submitted_data"] == {"option_id": "reject_repair"}


def test_empty_repair_cannot_be_rejected() -> None:
    service, _, _, dify, _, session = _gate("checklist")

    with pytest.raises(BadRequestError, match="not allowed"):
        service._prepare_action(
            session.id,
            ACTOR,
            Action(kind="reject_repair", base_version=session.version, base_app_revision=dify.hash),
        )


@pytest.mark.parametrize("risk_level", ["low", "high"])
def test_empty_proposal_always_waits_for_retry_or_finish(risk_level: str) -> None:
    _, _, repo, dify, agent, session = _gate("checklist")
    agent.empty_risk_level = risk_level
    _, context = repo.get_session(session.id)
    env = Env(
        repo=repo,
        dify=dify,
        agent=agent,
        now=lambda: datetime.min,
    )

    result = handle_propose(env, Turn(actor=ACTOR), session, context)

    assert result.next == PcState.FIX_AWAIT_APPROVAL
    reply = english_text(result.items[-1].payload["reply_text"])
    assert "try again or finish" in reply
    assert "reject" not in reply
