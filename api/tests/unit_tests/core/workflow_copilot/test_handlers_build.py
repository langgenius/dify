"""Tests for the Build-flow handlers + build_registry() (Slice 2)."""

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
from tests.unit_tests.core.workflow_copilot.fakes import FakeDifyPort, InMemoryRepository


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _new_env(dify=None, emit_canvas=None) -> tuple[Env, InMemoryRepository]:
    repo = InMemoryRepository()
    env = Env(
        dify=dify or FakeDifyPort(),
        agent=PlaceholderAgent(),
        repo=repo,
        now=lambda: datetime.min,
        emit_canvas=emit_canvas,
    )
    return env, repo


def _seed_build_session(repo: InMemoryRepository, state: PcState, **fc_kwargs) -> Session:
    s = Session(
        app_id="app",
        tenant_id="tenant-1",
        owner_account_id="acc-1",
        entry_mode=EntryMode.BUILD,
        current_state=state,
    )
    fc = CopilotContext(goal_text="Build a quarterly report workflow", **fc_kwargs)
    repo.create_session(s, fc, [ConversationItem(kind="user", seq=0)])
    return s


def test_capability_check_send_goal_advances_to_goal_analysis():
    from core.workflow_copilot.handlers_build import build_registry

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)

    runner = Runner(env, build_registry())
    out = runner.advance(
        s.id, Turn(action=Action(kind="send_goal", payload={"text": "Build it"}, base_version=1), actor=_actor())
    )

    assert out.current_state == PcState.BUILD_GOAL_ANALYSIS
    _, fc = repo.get_session(s.id)
    assert fc.goal_text == "Build it"
    assert fc.requirements  # analyze_goal populated the requirements
    kinds = [i.kind for i in repo.list_conversation(s.id)]
    assert "form" in kinds
    assert "challenge" in kinds
    assert "assistant_turn" in kinds
    assert {"event": "reset_build_canvas"} in events


def test_build_registry_maps_capability_check():
    from core.workflow_copilot.handlers_build import build_registry, handle_capability_check

    assert build_registry()[PcState.BUILD_CAPABILITY_CHECK] is handle_capability_check


def test_goal_analysis_submit_requirements_advances_to_initial_plan_with_plan_v1():
    from core.workflow_copilot.handlers_build import handle_goal_analysis

    env, repo = _new_env()
    s = _seed_build_session(
        repo, PcState.BUILD_GOAL_ANALYSIS, requirements={"currency": "USD"}
    )
    turn = Turn(
        action=Action(
            kind="submit_requirements",
            payload={"currency": "EUR", "audience": "board"},
            base_version=1,
        ),
        actor=_actor(),
    )
    res = handle_goal_analysis(
        env, turn, repo.get_session(s.id)[0], repo.get_session(s.id)[1]
    )

    assert res.next == PcState.BUILD_INITIAL_PLAN
    assert res.context.requirements["currency"] == "EUR"
    assert res.context.requirements["audience"] == "board"
    assert res.context.plan_version_tag == "v1"
    assert res.context.plan_items
    kinds = [i.kind for i in res.items]
    assert "decision" in kinds
    assert "plan" in kinds
    assert "assistant_turn" in kinds


def test_initial_plan_find_resources_advances_to_resource_recommendation():
    from core.workflow_copilot.handlers_build import handle_initial_plan

    env, repo = _new_env()
    s = _seed_build_session(
        repo,
        PcState.BUILD_INITIAL_PLAN,
        plan_items=["Retrieve", "Summarize"],
        plan_version_tag="v1",
    )
    turn = Turn(action=Action(kind="find_resources", base_version=1), actor=_actor())
    res = handle_initial_plan(
        env, turn, repo.get_session(s.id)[0], repo.get_session(s.id)[1]
    )

    assert res.next == PcState.BUILD_RESOURCE_RECOMMENDATION
    rs = next(i for i in res.items if i.kind == "resource_select")
    assert rs.payload["recommended"][0]["readiness"] == "ready"
    assert len(rs.payload["conflict_policy_options"]) == 2
