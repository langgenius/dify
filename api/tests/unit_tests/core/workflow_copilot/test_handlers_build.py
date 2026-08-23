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
        repo,
        PcState.BUILD_GOAL_ANALYSIS,
        requirements={"currency": "USD", "metrics": "revenue"},
    )
    turn = Turn(
        action=Action(
            kind="submit_requirements",
            payload={"currency": "EUR", "audience": "board", "junk": "x"},
            base_version=1,
        ),
        actor=_actor(),
    )
    res = handle_goal_analysis(
        env, turn, repo.get_session(s.id)[0], repo.get_session(s.id)[1]
    )

    assert res.next == PcState.BUILD_INITIAL_PLAN
    assert res.context.requirements["currency"] == "EUR"  # payload overrides
    assert res.context.requirements["audience"] == "board"  # new listed key merged
    assert (
        res.context.requirements["metrics"] == "revenue"
    )  # untouched key survives (not blind-overwrite)
    assert "junk" not in res.context.requirements  # non-listed key excluded
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


def test_resource_recommendation_confirm_creates_checkpoint_and_plan_v2():
    from core.workflow_copilot.handlers_build import handle_resource_recommendation
    from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(
        repo, PcState.BUILD_RESOURCE_RECOMMENDATION, plan_items=["Retrieve", "Summarize"], plan_version_tag="v1"
    )
    turn = Turn(
        action=Action(
            kind="confirm_resources",
            payload={"resource_ids": ["kb-company"], "conflict_policy": "audited"},
            base_version=1,
        ),
        actor=_actor(),
    )
    res = handle_resource_recommendation(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.BUILD_PLAN_APPROVAL
    assert res.context.plan_version_tag == "v2"
    assert res.context.resource_selection == {"resource_ids": ["kb-company"], "conflict_policy": "audited"}
    assert res.context.checkpoint_id
    cp, _snap = repo.get_checkpoint(res.context.checkpoint_id)
    assert cp.session_id == s.id
    checkpoint_card = next(i for i in res.items if i.kind == "checkpoint")
    assert checkpoint_card.payload["checkpoint_id"] == res.context.checkpoint_id
    assert {i.kind for i in res.items} >= {"decision", "plan", "checkpoint", "assistant_turn"}


def test_plan_approval_approve_builds_graph_and_reveals_nodes():
    from core.workflow_copilot.handlers_build import handle_plan_approval
    from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort

    events: list[dict] = []
    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_build_session(
        repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve", "Summarize"], plan_version_tag="v2"
    )
    # approve_plan resolves (via service.resolve_action_kind) to "approve_repair".
    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())
    res = handle_plan_approval(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.BUILD_EXECUTION
    assert res.context.built_node_ids == ["start", "knowledge_retrieval", "llm", "end"]
    assert len(dify.graph["nodes"]) == 4
    assert len(dify.graph["edges"]) == 3
    names = [e["event"] for e in events]
    assert names[0] == "create_checkpoint"
    assert [n for n in names if n.startswith("add_")] == [
        "add_start_node",
        "add_knowledge_node",
        "add_llm_node",
        "add_output_node",
    ]
    change_set = next(i for i in res.items if i.kind == "change_set")
    assert change_set.payload["scope"] == "structure"
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert len(assistant.payload["trace"]["steps"]) == 4


def test_plan_approval_ignores_non_approve_action():
    from core.workflow_copilot.handlers_build import handle_plan_approval
    from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve"], plan_version_tag="v2")
    turn = Turn(action=Action(kind="message", base_version=1), actor=_actor())
    res = handle_plan_approval(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_PLAN_APPROVAL


def test_execution_run_test_advances_to_test_and_repair():
    from core.workflow_copilot.handlers_build import handle_execution

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_EXECUTION, built_node_ids=["start", "llm", "end"])
    turn = Turn(action=Action(kind="run_test", base_version=1), actor=_actor())
    res = handle_execution(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_TEST_AND_REPAIR
    assert {"event": "start_test_run"} in events


def test_execution_revert_records_intent_only():
    from core.workflow_copilot.handlers_build import handle_execution

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_EXECUTION, built_node_ids=["start", "llm", "end"])
    turn = Turn(action=Action(kind="undo", base_version=1), actor=_actor())  # revert -> undo
    res = handle_execution(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_REVERTED
    assert any(i.kind == "decision" for i in res.items)
    assert {"event": "revert_checkpoint"} in events
