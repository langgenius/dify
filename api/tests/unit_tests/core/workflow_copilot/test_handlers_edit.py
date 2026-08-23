"""Tests for the Edit-flow handlers + edit_registry() (Slice 3)."""

from datetime import datetime

from core.workflow_copilot.models import (
    Action,
    Actor,
    ConversationItem,
    CopilotContext,
    EntryMode,
    Session,
    Turn,
)
from core.workflow_copilot.placeholder_agent import PlaceholderAgent
from core.workflow_copilot.runner import Env, Runner
from core.workflow_copilot.state import PcState
from tests.unit_tests.core.workflow_copilot.fakes import FakeEditDifyPort, InMemoryRepository


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _new_env(dify=None, emit_canvas=None) -> tuple[Env, InMemoryRepository]:
    repo = InMemoryRepository()
    env = Env(
        dify=dify or FakeEditDifyPort(),
        agent=PlaceholderAgent(),
        repo=repo,
        now=lambda: datetime.min,
        emit_canvas=emit_canvas,
    )
    return env, repo


def _seed_edit_session(repo: InMemoryRepository, state: PcState, **fc_kwargs) -> Session:
    s = Session(
        app_id="app",
        tenant_id="tenant-1",
        owner_account_id="acc-1",
        entry_mode=EntryMode.EDIT,
        current_state=state,
    )
    fc = CopilotContext(goal_text="Tighten risk handling", **fc_kwargs)
    repo.create_session(s, fc, [ConversationItem(kind="user", seq=0)])
    return s


def test_capability_check_send_edit_goal_advances_to_impact_analysis():
    from core.workflow_copilot.handlers_edit import edit_registry

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK)

    runner = Runner(env, edit_registry())
    out = runner.advance(
        s.id,
        Turn(
            action=Action(kind="send_edit_goal", payload={"text": "Add a review gate"}, base_version=1),
            actor=_actor(),
        ),
    )

    assert out.current_state == PcState.EDIT_IMPACT_ANALYSIS
    _, fc = repo.get_session(s.id)
    assert fc.goal_text == "Add a review gate"
    assert fc.edit_rules  # analyze_impact populated the rules
    assert "llm" in fc.edit_target_node_ids
    kinds = [i.kind for i in repo.list_conversation(s.id)]
    assert "summary" in kinds  # context summary
    assert "form" in kinds
    assert "challenge" in kinds
    assert "change_set" in kinds
    assert any(e["event"] == "highlight_edit_target" for e in events)


def test_capability_check_ignores_non_goal_action():
    from core.workflow_copilot.handlers_edit import handle_capability_check

    env, repo = _new_env()
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK)
    res = handle_capability_check(
        env, Turn(action=Action(kind="message", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_CAPABILITY_CHECK


def test_impact_analysis_submit_rules_advances_to_plan_approval_with_checkpoint():
    from core.workflow_copilot.handlers_edit import handle_impact_analysis

    env, repo = _new_env()
    s = _seed_edit_session(
        repo,
        PcState.EDIT_IMPACT_ANALYSIS,
        edit_rules={"risk_threshold": "medium", "review_team": "compliance"},
        edit_target_node_ids=["llm"],
    )
    turn = Turn(
        action=Action(
            kind="submit_edit_rules",
            payload={"risk_threshold": "high", "junk": "x"},
            base_version=1,
        ),
        actor=_actor(),
    )
    res = handle_impact_analysis(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.EDIT_PLAN_APPROVAL
    assert res.context.edit_rules["risk_threshold"] == "high"  # payload overrides
    assert res.context.edit_rules["review_team"] == "compliance"  # untouched key survives
    assert "junk" not in res.context.edit_rules  # non-listed key excluded
    assert res.context.plan_items
    assert res.context.checkpoint_id
    cp, _snap = repo.get_checkpoint(res.context.checkpoint_id)
    assert cp.session_id == s.id
    checkpoint_card = next(i for i in res.items if i.kind == "checkpoint")
    assert checkpoint_card.payload["checkpoint_id"] == res.context.checkpoint_id
    assert {i.kind for i in res.items} >= {"decision", "plan", "checkpoint", "assistant_turn"}


def test_edit_registry_maps_capability_check_and_impact_analysis():
    from core.workflow_copilot.handlers_edit import (
        edit_registry,
        handle_capability_check,
        handle_impact_analysis,
    )

    reg = edit_registry()
    assert reg[PcState.EDIT_CAPABILITY_CHECK] is handle_capability_check
    assert reg[PcState.EDIT_IMPACT_ANALYSIS] is handle_impact_analysis
