"""Tests for the Build-flow handlers + build_registry() (Slice 2)."""

from datetime import datetime

from core.dify_builder.models import (
    Action,
    Actor,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    Session,
    Turn,
)
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _session(**overrides) -> Session:
    fields: dict = {
        "app_id": "app",
        "tenant_id": "tenant-1",
        "owner_account_id": "acc-1",
        "entry_mode": EntryMode.BUILD,
        "current_state": PcState.BUILD_CAPABILITY_CHECK,
    }
    fields.update(overrides)
    return Session(**fields)


def _new_env(dify=None, emit_canvas=None, agent=None) -> tuple[Env, InMemoryRepository]:
    repo = InMemoryRepository()
    env = Env(
        dify=dify or FakeDifyPort(),
        agent=agent or PlaceholderAgent(),
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
    fc = DifyBuilderContext(goal_text="Build a quarterly report workflow", **fc_kwargs)
    repo.create_session(s, fc, [ConversationItem(kind="user", seq=0)])
    return s


def test_build_form_fields_whitelists_and_coerces_type():
    from core.dify_builder.handlers_fix import build_form_fields

    fields = build_form_fields(
        [
            {"key": "a", "label": "A", "type": "select", "options": ["x"], "junk": 1},
            {"key": "b", "label": "B", "type": "weird"},
        ]
    )
    assert [f.key for f in fields] == ["a", "b"]
    assert fields[0].type == "select"
    assert fields[0].options == ["x"]
    assert fields[1].type == "text"  # unknown type coerced to text


def test_capability_check_renders_agent_fields():
    # StubAgent.analyze_goal returns dynamic fields; the form card and
    # fc.form_fields must reflect them (not a hardcoded constant).
    from core.dify_builder.handlers_build import handle_capability_check

    env, _ = _new_env()
    env.agent.analyze_goal = lambda _g: {
        "fields": [{"key": "categories", "label": "Categories", "type": "text"}],
        "values": {"categories": "billing, refunds"},
    }
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_CAPABILITY_CHECK)
    fc = DifyBuilderContext(goal_text="triage support tickets")
    result = handle_capability_check(
        env, Turn(actor=_actor(), action=Action(kind="send_goal", payload={"text": "triage"})), s, fc
    )
    assert result.context.form_fields == [{"key": "categories", "label": "Categories", "type": "text"}]
    assert result.context.requirements == {"categories": "billing, refunds"}


def test_capability_check_send_goal_advances_to_goal_analysis():
    from core.dify_builder.handlers_build import build_registry

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
    from core.dify_builder.handlers_build import build_registry, handle_capability_check

    assert build_registry()[PcState.BUILD_CAPABILITY_CHECK] is handle_capability_check


def test_goal_analysis_submit_requirements_advances_to_initial_plan_with_plan_v1():
    from core.dify_builder.handlers_build import handle_goal_analysis

    env, repo = _new_env()
    s = _seed_build_session(
        repo,
        PcState.BUILD_GOAL_ANALYSIS,
        requirements={"currency": "USD", "metrics": "revenue"},
        form_fields=[
            {"key": "currency", "label": "Currency", "type": "text"},
            {"key": "audience", "label": "Audience", "type": "text"},
            {"key": "metrics", "label": "Metrics", "type": "text"},
        ],
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
    from core.dify_builder.handlers_build import handle_initial_plan

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
    from core.dify_builder.handlers_build import handle_resource_recommendation
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

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
    assert res.context.last_structure_fingerprint != ""
    cp, _snap = repo.get_checkpoint(res.context.checkpoint_id)
    assert cp.session_id == s.id
    checkpoint_card = next(i for i in res.items if i.kind == "checkpoint")
    assert checkpoint_card.payload["checkpoint_id"] == res.context.checkpoint_id
    assert {i.kind for i in res.items} >= {"decision", "plan", "checkpoint", "assistant_turn"}


def test_plan_approval_approve_builds_graph_and_reveals_nodes():
    from core.dify_builder.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

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
    assert res.context.last_structure_fingerprint != ""
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
    from core.dify_builder.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve"], plan_version_tag="v2")
    turn = Turn(action=Action(kind="message", base_version=1), actor=_actor())
    res = handle_plan_approval(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_PLAN_APPROVAL


def test_execution_run_test_advances_to_test_and_repair():
    from core.dify_builder.handlers_build import handle_execution

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_EXECUTION, built_node_ids=["start", "llm", "end"])
    turn = Turn(action=Action(kind="run_test", base_version=1), actor=_actor())
    res = handle_execution(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_TEST_AND_REPAIR
    assert {"event": "start_test_run"} in events


def test_execution_revert_records_intent_only():
    from core.dify_builder.handlers_build import handle_execution

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_EXECUTION, built_node_ids=["start", "llm", "end"])
    turn = Turn(action=Action(kind="undo", base_version=1), actor=_actor())  # revert -> undo
    res = handle_execution(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_REVERTED
    assert any(i.kind == "decision" for i in res.items)
    assert {"event": "revert_checkpoint"} in events


def test_test_and_repair_finds_and_fixes_then_reaches_review():
    from core.dify_builder.handlers_build import handle_plan_approval, handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

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
    assert res.context.last_structure_fingerprint != ""
    kinds = [i.kind for i in res.items]
    assert kinds.count("error") == 1
    assert "change_set" in kinds
    assert "test_result" in kinds
    summary = next(i for i in res.items if i.kind == "summary")
    assert summary.payload["variant"] == "review"
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["error", "change_set", "test_result", "summary"]
    names = [e["event"] for e in events]
    assert "mark_test_error" in names
    assert "apply_error_fix" in names
    assert "mark_test_success" in names
    assert "mark_review_ready" in names
    # the repair actually mutated the llm node's prompt_template.
    llm = next(n for n in dify.graph["nodes"] if n["id"] == "llm")
    assert llm["data"]["prompt_template"][0]["text"] == "You are a financial report assistant."


def test_test_and_repair_neutral_when_repair_empty():
    from core.dify_builder.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.agent.propose_build_repair = lambda _ids: []
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert result.next == PcState.BUILD_REVIEW
    assert env.dify.applied == []  # no repair applied when propose_build_repair returns []
    kinds = [i.kind for i in result.items]
    assert "error" not in kinds
    assert "change_set" not in kinds
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["test_result", "summary"]  # no error/change_set attached
    summary = next(i for i in result.items if i.kind == "summary")
    assert "No issues found" in summary.payload["items"]


def test_review_publish_advances_to_publish():
    from core.dify_builder.handlers_build import handle_review

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_REVIEW, built_node_ids=["start", "llm", "end"])
    publish_turn = Turn(action=Action(kind="publish_workflow", base_version=1), actor=_actor())
    res = handle_review(env, publish_turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_PUBLISH
    assert any(i.kind == "decision" for i in res.items)


def test_review_keep_draft_skips_publish_to_governance():
    from core.dify_builder.handlers_build import handle_review

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_REVIEW, built_node_ids=["start", "llm", "end"])
    keep_draft_turn = Turn(action=Action(kind="keep_draft", base_version=1), actor=_actor())
    res = handle_review(env, keep_draft_turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_GOVERNANCE_FEEDBACK
    assert {"event": "cancel_publish"} in events


def test_review_continue_adjusting_returns_to_initial_plan_with_fresh_plan():
    from core.dify_builder.handlers_build import handle_review

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_REVIEW, requirements={"currency": "USD"}, built_node_ids=["start"])
    re_fix_turn = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res = handle_review(env, re_fix_turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_INITIAL_PLAN
    assert res.context.plan_version_tag == "v1"
    assert any(i.kind == "plan" for i in res.items)


def test_review_revert_records_intent_only():
    from core.dify_builder.handlers_build import handle_review

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_REVIEW, built_node_ids=["start", "llm", "end"])
    res = handle_review(env, Turn(action=Action(kind="undo", base_version=1), actor=_actor()), *repo.get_session(s.id))
    assert res.next == PcState.BUILD_REVERTED
    assert {"event": "revert_checkpoint"} in events


def test_publish_calls_dify_and_advances_to_governance_feedback():
    from core.dify_builder.handlers_build import handle_publish
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

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


def test_governance_automatic_learns_and_reaches_complete():
    from core.dify_builder.handlers_build import handle_governance_feedback
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, repo = _new_env(dify=FakeBuildDifyPort(), agent=StubAgent())
    s = _seed_build_session(
        repo,
        PcState.BUILD_GOVERNANCE_FEEDBACK,
        skill_learning_policy="automatic",
        built_node_ids=["a", "b"],
    )
    res = handle_governance_feedback(env, Turn(actor=_actor()), *repo.get_session(s.id))
    assert res.next == PcState.BUILD_COMPLETE
    kinds = [i.kind for i in res.items]
    assert "build_learning" in kinds
    assert "summary" in kinds
    assert "notice" in kinds
    assert env.agent.learn_calls == 1  # seam called for automatic


def test_governance_disabled_skips_and_reaches_complete():
    from core.dify_builder.handlers_build import handle_governance_feedback
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, repo = _new_env(dify=FakeBuildDifyPort(), agent=StubAgent())
    s = _seed_build_session(
        repo,
        PcState.BUILD_GOVERNANCE_FEEDBACK,
        skill_learning_policy="disabled",
        built_node_ids=["a"],
    )
    res = handle_governance_feedback(env, Turn(actor=_actor()), *repo.get_session(s.id))
    assert res.next == PcState.BUILD_COMPLETE
    # build_learning present with state skipped; seam NOT called
    bl = [i for i in res.items if i.kind == "build_learning"][0]
    assert bl.payload["state"] == "skipped"
    assert getattr(env.agent, "learn_calls", 0) == 0


def test_governance_ask_rests_at_await_learning_with_pending_card():
    from core.dify_builder.handlers_build import handle_governance_feedback
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, repo = _new_env(dify=FakeBuildDifyPort(), agent=StubAgent())
    s = _seed_build_session(
        repo,
        PcState.BUILD_GOVERNANCE_FEEDBACK,
        skill_learning_policy="ask",
        built_node_ids=["a"],
    )
    res = handle_governance_feedback(env, Turn(actor=_actor()), *repo.get_session(s.id))
    assert res.next == PcState.BUILD_AWAIT_LEARNING
    bl = [i for i in res.items if i.kind == "build_learning"][0]
    assert bl.payload["policy"] == "ask"
    assert bl.payload["state"] == "pending"
    assert getattr(env.agent, "learn_calls", 0) == 0  # not learned until accepted


def test_await_learning_accept_learns_and_completes():
    from core.dify_builder.handlers_build import handle_await_learning
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, repo = _new_env(dify=FakeBuildDifyPort(), agent=StubAgent())
    s = _seed_build_session(
        repo,
        PcState.BUILD_AWAIT_LEARNING,
        skill_learning_policy="ask",
        built_node_ids=["a"],
    )
    res = handle_await_learning(
        env, Turn(action=Action(kind="accept_learning", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.BUILD_COMPLETE
    kinds = [i.kind for i in res.items]
    assert "decision" in kinds
    assert "summary" in kinds
    assert "notice" in kinds
    assert env.agent.learn_calls == 1


def test_await_learning_skip_completes_without_learning():
    from core.dify_builder.handlers_build import handle_await_learning
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, repo = _new_env(dify=FakeBuildDifyPort(), agent=StubAgent())
    s = _seed_build_session(
        repo,
        PcState.BUILD_AWAIT_LEARNING,
        skill_learning_policy="ask",
        built_node_ids=["a"],
    )
    res = handle_await_learning(
        env, Turn(action=Action(kind="skip_learning", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.BUILD_COMPLETE
    assert getattr(env.agent, "learn_calls", 0) == 0


def test_reverted_retry_returns_to_initial_plan():
    from core.dify_builder.handlers_build import handle_reverted

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_REVERTED, requirements={"currency": "USD"})
    res = handle_reverted(
        env, Turn(action=Action(kind="re_fix", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.BUILD_INITIAL_PLAN
    assert res.context.plan_version_tag == "v1"
    assert any(i.kind == "plan" for i in res.items)


def test_build_registry_covers_all_non_terminal_build_states():
    from core.dify_builder.handlers_build import build_registry

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
        PcState.BUILD_AWAIT_LEARNING,
        PcState.BUILD_REVERTED,
    }
    assert PcState.BUILD_COMPLETE not in build_registry()  # terminal: no handler


def test_full_build_flow_goal_to_complete():
    from core.dify_builder.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

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

    # 7) publish_workflow -> build.publish (auto) -> governance_feedback (auto)
    # -> rests at build.await_learning (default policy "ask")
    publish_action = Action(kind="publish_workflow", base_version=out.version)
    out = runner.advance(s.id, Turn(action=publish_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_AWAIT_LEARNING
    assert dify.published is True

    # 8) skip_learning -> build.complete
    out = runner.advance(s.id, Turn(action=Action(kind="skip_learning", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_COMPLETE

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
    from core.dify_builder.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

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
    assert out.current_state == PcState.BUILD_AWAIT_LEARNING  # default policy "ask"

    out = runner.advance(s.id, Turn(action=Action(kind="skip_learning", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_COMPLETE
    assert dify.published is False  # keep_draft skips publish
    assert not any(i.kind == "publish" for i in repo.list_conversation(s.id))


def test_review_continue_adjusting_then_reapprove_is_idempotent():
    """Final-review fix (Important #1): looping back from build.review via
    continue_adjusting (resolved re_fix) and re-walking find_resources ->
    confirm_resources -> approve_plan must NOT crash on the second build.
    build_nodes() always emits create_node with the SAME fixed node ids
    (start/knowledge_retrieval/llm/end); without idempotency the second
    apply_repair raises ValueError on the colliding node id and the session
    dead-ends at build.plan_approval. handle_plan_approval must filter out
    intents that already exist in the current draft graph before applying."""
    from core.dify_builder.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

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

    # first build: applies all 7 intents.
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_EXECUTION
    assert len(dify.graph["nodes"]) == 4
    assert len(dify.graph["edges"]) == 3

    out = runner.advance(s.id, Turn(action=Action(kind="run_test", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_REVIEW

    # loop back: continue_adjusting (-> re_fix) -> build.initial_plan (re-plan)
    out = runner.advance(s.id, Turn(action=Action(kind="re_fix", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_INITIAL_PLAN

    # re-walk find_resources -> confirm_resources -> approve_plan
    out = runner.advance(s.id, Turn(action=Action(kind="find_resources", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    confirm_action_2 = Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version)
    out = runner.advance(s.id, Turn(action=confirm_action_2, actor=_actor()))
    assert out.current_state == PcState.BUILD_PLAN_APPROVAL

    # THE re-approve: must not raise ValueError, must reach build.execution,
    # and must not double the graph (idempotent -- everything already exists).
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_EXECUTION
    assert len(dify.graph["nodes"]) == 4
    assert len(dify.graph["edges"]) == 3
    _, fc = repo.get_session(s.id)
    # built_node_ids reflects the full set (all 4 exist), not an empty/partial
    # subset just because nothing new was actually applied this time.
    assert set(fc.built_node_ids) == {"start", "knowledge_retrieval", "llm", "end"}


def test_execution_revert_then_retry_after_revert_reapprove_is_idempotent():
    """Same idempotency path via the revert -> reverted -> retry_after_revert
    loop (handle_reverted's re_fix), not continue_adjusting."""
    from core.dify_builder.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    out = runner.advance(
        s.id, Turn(action=Action(kind="send_goal", payload={"text": "Build it"}, base_version=1), actor=_actor())
    )
    out = runner.advance(
        s.id, Turn(action=Action(kind="submit_requirements", base_version=out.version), actor=_actor())
    )
    out = runner.advance(s.id, Turn(action=Action(kind="find_resources", base_version=out.version), actor=_actor()))
    confirm_payload = {"resource_ids": ["kb-company"], "conflict_policy": "audited"}
    out = runner.advance(
        s.id,
        Turn(
            action=Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version),
            actor=_actor(),
        ),
    )
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_EXECUTION
    assert len(dify.graph["nodes"]) == 4

    # revert (intent only -- doesn't mutate the fake's graph) -> build.reverted
    out = runner.advance(s.id, Turn(action=Action(kind="undo", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_REVERTED

    # retry_after_revert (-> re_fix) -> build.initial_plan (re-plan)
    out = runner.advance(s.id, Turn(action=Action(kind="re_fix", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_INITIAL_PLAN

    out = runner.advance(s.id, Turn(action=Action(kind="find_resources", base_version=out.version), actor=_actor()))
    out = runner.advance(
        s.id,
        Turn(
            action=Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version),
            actor=_actor(),
        ),
    )
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_EXECUTION
    assert len(dify.graph["nodes"]) == 4
    assert len(dify.graph["edges"]) == 3
