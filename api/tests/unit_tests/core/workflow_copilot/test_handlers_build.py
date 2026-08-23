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


def test_test_and_repair_finds_and_fixes_then_reaches_review():
    from core.workflow_copilot.handlers_build import handle_plan_approval, handle_test_and_repair
    from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort

    events: list[dict] = []
    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    # first build the graph so the llm node exists for the repair to target.
    s = _seed_build_session(
        repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve", "Summarize"], plan_version_tag="v2"
    )
    approve_turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())
    built = handle_plan_approval(env, approve_turn, *repo.get_session(s.id))
    fc = built.context

    events.clear()
    res = handle_test_and_repair(env, Turn(actor=_actor()), repo.get_session(s.id)[0], fc)

    assert res.next == PcState.BUILD_REVIEW
    kinds = [i.kind for i in res.items]
    assert kinds.count("error") == 1
    assert "change_set" in kinds
    assert "test_result" in kinds
    summary = next(i for i in res.items if i.kind == "summary")
    assert summary.payload["variant"] == "review"
    names = [e["event"] for e in events]
    assert "mark_test_error" in names
    assert "apply_error_fix" in names
    assert "mark_test_success" in names
    assert "mark_review_ready" in names
    # the repair actually mutated the llm node's prompt_template.
    llm = next(n for n in dify.graph["nodes"] if n["id"] == "llm")
    assert llm["data"]["prompt_template"][0]["text"] == "You are a financial report assistant."


def test_review_publish_advances_to_publish():
    from core.workflow_copilot.handlers_build import handle_review

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_REVIEW, built_node_ids=["start", "llm", "end"])
    publish_turn = Turn(action=Action(kind="publish_workflow", base_version=1), actor=_actor())
    res = handle_review(env, publish_turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_PUBLISH
    assert any(i.kind == "decision" for i in res.items)


def test_review_keep_draft_skips_publish_to_governance():
    from core.workflow_copilot.handlers_build import handle_review

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_REVIEW, built_node_ids=["start", "llm", "end"])
    keep_draft_turn = Turn(action=Action(kind="keep_draft", base_version=1), actor=_actor())
    res = handle_review(env, keep_draft_turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_GOVERNANCE_FEEDBACK
    assert {"event": "cancel_publish"} in events


def test_review_continue_adjusting_returns_to_initial_plan_with_fresh_plan():
    from core.workflow_copilot.handlers_build import handle_review

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_REVIEW, requirements={"currency": "USD"}, built_node_ids=["start"])
    re_fix_turn = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res = handle_review(env, re_fix_turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_INITIAL_PLAN
    assert res.context.plan_version_tag == "v1"
    assert any(i.kind == "plan" for i in res.items)


def test_review_revert_records_intent_only():
    from core.workflow_copilot.handlers_build import handle_review

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_REVIEW, built_node_ids=["start", "llm", "end"])
    res = handle_review(env, Turn(action=Action(kind="undo", base_version=1), actor=_actor()), *repo.get_session(s.id))
    assert res.next == PcState.BUILD_REVERTED
    assert {"event": "revert_checkpoint"} in events


def test_publish_calls_dify_and_advances_to_governance_feedback():
    from core.workflow_copilot.handlers_build import handle_publish
    from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort

    events: list[dict] = []
    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_PUBLISH, built_node_ids=["start", "llm", "end"])
    res = handle_publish(env, Turn(actor=_actor()), *repo.get_session(s.id))
    assert res.next == PcState.BUILD_GOVERNANCE_FEEDBACK
    assert dify.published is True
    publish = next(i for i in res.items if i.kind == "publish")
    assert publish.payload["version"] == "1.0"
    assert {"event": "publish_workflow"} in events


def test_governance_feedback_emits_completion_summary_and_reaches_complete():
    from core.workflow_copilot.handlers_build import handle_governance_feedback

    env, repo = _new_env()
    s = _seed_build_session(
        repo,
        PcState.BUILD_GOVERNANCE_FEEDBACK,
        built_node_ids=["start", "knowledge_retrieval", "llm", "end"],
    )
    res = handle_governance_feedback(env, Turn(actor=_actor()), *repo.get_session(s.id))
    assert res.next == PcState.BUILD_COMPLETE
    summary = next(i for i in res.items if i.kind == "summary")
    assert summary.payload["variant"] == "completion"
    assert summary.payload["rows"]


def test_reverted_retry_returns_to_initial_plan():
    from core.workflow_copilot.handlers_build import handle_reverted

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_REVERTED, requirements={"currency": "USD"})
    res = handle_reverted(
        env, Turn(action=Action(kind="re_fix", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.BUILD_INITIAL_PLAN
    assert res.context.plan_version_tag == "v1"
    assert any(i.kind == "plan" for i in res.items)


def test_build_registry_covers_all_non_terminal_build_states():
    from core.workflow_copilot.handlers_build import build_registry

    assert set(build_registry().keys()) == {
        PcState.BUILD_CAPABILITY_CHECK,
        PcState.BUILD_GOAL_ANALYSIS,
        PcState.BUILD_INITIAL_PLAN,
        PcState.BUILD_RESOURCE_RECOMMENDATION,
        PcState.BUILD_PLAN_APPROVAL,
        PcState.BUILD_EXECUTION,
        PcState.BUILD_TEST_AND_REPAIR,
        PcState.BUILD_REVIEW,
        PcState.BUILD_PUBLISH,
        PcState.BUILD_GOVERNANCE_FEEDBACK,
        PcState.BUILD_REVERTED,
    }
    assert PcState.BUILD_COMPLETE not in build_registry()  # terminal: no handler


def test_full_build_flow_goal_to_complete():
    from core.workflow_copilot.handlers_build import build_registry
    from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    # 1) send_goal -> build.goal_analysis
    goal_action = Action(kind="send_goal", payload={"text": "Build it"}, base_version=1)
    out = runner.advance(s.id, Turn(action=goal_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_GOAL_ANALYSIS

    # 2) submit_requirements -> build.initial_plan
    reqs_action = Action(kind="submit_requirements", payload={"currency": "USD"}, base_version=out.version)
    out = runner.advance(s.id, Turn(action=reqs_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_INITIAL_PLAN

    # 3) find_resources -> build.resource_recommendation
    out = runner.advance(s.id, Turn(action=Action(kind="find_resources", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION

    # 4) confirm_resources -> build.plan_approval
    confirm_payload = {"resource_ids": ["kb-company"], "conflict_policy": "audited"}
    confirm_action = Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version)
    out = runner.advance(s.id, Turn(action=confirm_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_PLAN_APPROVAL

    # 5) approve_plan (-> approve_repair) -> THE BUILD -> build.execution
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_EXECUTION
    # the graph was actually built.
    graph, _hash = dify.read_graph("app", _actor())
    assert len(graph["nodes"]) == 4
    assert len(graph["edges"]) == 3

    # 6) run_test -> build.test_and_repair (working, auto) -> rest at build.review
    out = runner.advance(s.id, Turn(action=Action(kind="run_test", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_REVIEW

    # 7) publish_workflow -> build.publish (auto) -> governance_feedback (auto) -> build.complete
    publish_action = Action(kind="publish_workflow", base_version=out.version)
    out = runner.advance(s.id, Turn(action=publish_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_COMPLETE
    assert dify.published is True

    # ordered card stream: every Build card kind appears, seq-ordered.
    items = repo.list_conversation(s.id)
    kinds = [i.kind for i in items]
    expected_kinds = [
        "user",
        "form",
        "challenge",
        "plan",
        "resource_select",
        "checkpoint",
        "change_set",
        "error",
        "test_result",
        "summary",
        "publish",
    ]
    for expected in expected_kinds:
        assert expected in kinds, f"missing card kind {expected}"
    seqs = [i.seq for i in items]
    assert seqs == sorted(seqs)
    # the final completion summary is present.
    assert any(i.kind == "summary" and i.payload.get("variant") == "completion" for i in items)


def test_full_build_flow_keep_draft_reaches_complete_without_publish():
    from core.workflow_copilot.handlers_build import build_registry
    from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    goal_action = Action(kind="send_goal", payload={"text": "Build it"}, base_version=1)
    out = runner.advance(s.id, Turn(action=goal_action, actor=_actor()))
    reqs_action = Action(kind="submit_requirements", base_version=out.version)
    out = runner.advance(s.id, Turn(action=reqs_action, actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="find_resources", base_version=out.version), actor=_actor()))
    confirm_payload = {"resource_ids": ["kb-company"], "conflict_policy": "audited"}
    confirm_action = Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version)
    out = runner.advance(s.id, Turn(action=confirm_action, actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="run_test", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_REVIEW

    out = runner.advance(s.id, Turn(action=Action(kind="keep_draft", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_COMPLETE
    assert dify.published is False  # keep_draft skips publish
    assert not any(i.kind == "publish" for i in repo.list_conversation(s.id))
