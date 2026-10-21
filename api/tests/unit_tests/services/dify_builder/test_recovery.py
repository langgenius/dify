from datetime import datetime
from typing import override

import pytest

from core.dify_builder.contract import FormCard, SessionView, UserItem
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Graph, Session, Turn
from core.dify_builder.state import PcState
from services.dify_builder.application.handlers_edit import edit_registry
from services.dify_builder.application.runner import Env, Runner
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent
from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock, resolve_submitted_action

type EditFlow = tuple[DifyBuilderService, InMemoryRepository, FakeDifyPort, ImpactAgent, Session, Actor]


class ImpactAgent(StubAgent):
    def __init__(self) -> None:
        super().__init__()
        self.impact_calls: list[tuple[str, Graph]] = []

    @override
    def analyze_impact(self, goal_text: str, graph: Graph, *, reply_language: object = None) -> dict[str, object]:
        self.impact_calls.append((goal_text, graph))
        return {
            "fields": [{"key": "tone", "label": "Tone", "type": "text"}],
            "values": {"tone": "formal"},
            "target_node_ids": ["llm"],
        }


@pytest.fixture
def edit_flow() -> EditFlow:
    repo = InMemoryRepository()
    dify = FakeDifyPort()
    dify.graph = {"nodes": [{"id": "llm", "data": {"type": "llm", "title": "Updated LLM"}}], "edges": []}
    dify.hash = "current-draft"
    agent = ImpactAgent()
    actor = Actor(account_id="account", tenant_id="tenant")
    session = Session(
        app_id="app",
        tenant_id=actor.tenant_id,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_IMPACT_ANALYSIS,
    )
    context = DifyBuilderContext(
        goal_text="Make the response formal",
        reply_language="zh-Hans",
        edit_rules={"tone": "casual"},
        form_fields=[{"key": "tone", "label": "Tone", "type": "text"}],
        edit_target_node_ids=["llm"],
        plan_items=["Old plan"],
        checkpoint_id="old-checkpoint",
        last_snapshot_hash="previous-draft",
        last_structure_fingerprint=dify.structural_fingerprint(dify.graph),
    )
    repo.create_session(
        session,
        context,
        [
            UserItem(text=context.goal_text, turn_id="opening-goal").to_item(seq=0, at_version=1),
            FormCard(variant="edit_rules", title="Edit rules", values=context.edit_rules).to_item(seq=1, at_version=1),
        ],
    )
    repository = repo
    runner = Runner(
        Env(dify=dify, agent=agent, repo=repository, now=lambda: datetime.min),
        edit_registry(),
    )
    lock = FakeSessionLock()

    def enqueue(session_id: str, action: Action, actor: Actor, _token: str) -> None:
        try:
            runner.advance(session_id, Turn(action=action, actor=actor))
        finally:
            lock.release(session_id, _token)

    service = DifyBuilderService(
        repository,
        lock,
        enqueue,
        get_app_revision_fn=lambda _app_id, _actor: dify.hash,
    )
    return service, repo, dify, agent, session, actor


def _choose(service: DifyBuilderService, session: Session, actor: Actor, option_id: str) -> SessionView:
    view = service.get_session_view(session.id, actor)
    assert view.app_revision is not None
    payload = {"option_id": option_id}
    return service.submit_action(
        session.id,
        actor,
        Action(
            kind=resolve_submitted_action("confirm", payload),
            payload=payload,
            base_version=view.version,
            base_app_revision=view.app_revision.current,
            command_id=f"command-{option_id}",
        ),
    )


def test_conflict_restart_reanalyzes_saved_edit_goal_without_a_send_choice(edit_flow: EditFlow) -> None:
    service, repo, dify, agent, session, actor = edit_flow
    conflicted = service.get_session_view(session.id, actor)
    assert conflicted.app_revision is not None
    assert conflicted.app_revision.conflicted
    assert [action.id for action in conflicted.actions] == ["check_recovery"]

    recovery = _choose(service, session, actor, "check_recovery")
    assert recovery.recovery is not None
    assert recovery.decision is not None
    assert recovery.recovery.recovery_class == "config_only"
    assert [option.id for option in recovery.decision.options] == ["recovery_continue", "restart"]

    resumed = _choose(service, session, actor, "restart")

    assert resumed.state == PcState.EDIT_IMPACT_ANALYSIS
    assert resumed.run_status == "waiting_input"
    assert [action.id for action in resumed.actions] == ["submit_edit_rules"]
    assert resumed.decision is None
    assert resumed.active_interaction is not None
    assert resumed.active_interaction.card.payload["values"] == {"tone": "formal"}
    assert resumed.active_interaction.valid_at_version == resumed.version
    assert resumed.app_revision is not None
    assert not resumed.app_revision.conflicted
    assert resumed.recovery is None
    assert resumed.last_command_id == "command-restart"
    assert agent.impact_calls == [("Make the response formal", dify.graph)]
    assert dify.applied == []
    assert not dify.published

    _stored, context = repo.get_session(session.id)
    assert context.goal_text == "Make the response formal"
    assert context.reply_language == "zh-Hans"
    assert context.last_snapshot_hash == dify.hash
    assert context.edit_target_node_ids == ["llm"]
    assert context.plan_items == []
    assert context.checkpoint_id == ""
    items = repo.list_conversation(session.id)
    assert [item.payload["text"] for item in items if item.kind == "user"] == [context.goal_text]
    choices = [item for item in items if item.kind == "interaction_response"]
    assert [item.payload["submitted_data"] for item in choices] == [
        {"option_id": "check_recovery"},
        {"option_id": "restart"},
    ]
    assert [item.seq for item in items] == list(range(len(items)))
    assert items[-1].at_version == resumed.version


def test_conflict_continue_preserves_the_current_edit_input_gate(edit_flow: EditFlow) -> None:
    service, repo, dify, agent, session, actor = edit_flow
    _choose(service, session, actor, "check_recovery")

    resumed = _choose(service, session, actor, "recovery_continue")

    assert resumed.state == PcState.EDIT_IMPACT_ANALYSIS
    assert resumed.active_interaction is not None
    assert resumed.active_interaction.card.seq == 1
    assert resumed.active_interaction.card.payload["values"] == {"tone": "casual"}
    assert resumed.decision is None
    assert agent.impact_calls == []
    assert dify.applied == []
    _stored, context = repo.get_session(session.id)
    assert context.plan_items == ["Old plan"]
    assert context.checkpoint_id == "old-checkpoint"
    assert context.last_snapshot_hash == dify.hash


def test_conflict_continue_at_edit_entry_reanalyzes_the_saved_goal(edit_flow: EditFlow) -> None:
    service, repo, dify, agent, session, actor = edit_flow
    stored, context = repo.get_session(session.id)
    repo.compare_and_advance(session.id, stored.version, PcState.EDIT_CAPABILITY_CHECK, context, [])
    _choose(service, session, actor, "check_recovery")

    resumed = _choose(service, session, actor, "recovery_continue")

    assert resumed.state == PcState.EDIT_IMPACT_ANALYSIS
    assert [action.id for action in resumed.actions] == ["submit_edit_rules"]
    assert resumed.decision is None
    assert agent.impact_calls == [("Make the response formal", dify.graph)]
    assert len([item for item in repo.list_conversation(session.id) if item.kind == "user"]) == 1
