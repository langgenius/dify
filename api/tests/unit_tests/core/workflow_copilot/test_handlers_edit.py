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


def test_plan_approval_approve_edits_graph_and_emits_canvas():
    from core.workflow_copilot.handlers_edit import handle_plan_approval

    events: list[dict] = []
    dify = FakeEditDifyPort()
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_edit_session(
        repo,
        PcState.EDIT_PLAN_APPROVAL,
        edit_rules={"risk_threshold": "high", "timeout_behavior": "fail_closed"},
        edit_target_node_ids=["llm"],
        checkpoint_id="cp-1",
    )
    # approve_plan resolves (via service.resolve_action_kind) to "approve_repair".
    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())
    res = handle_plan_approval(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.EDIT_APPLY_CHANGES
    # the existing llm node was actually reconfigured.
    llm = next(n for n in dify.graph["nodes"] if n["id"] == "llm")
    assert llm["data"]["risk_threshold"] == "high"
    # Edit narrates its own canvas events (no per-intent apply_error_fix leak).
    names = [e["event"] for e in events]
    assert "create_checkpoint" in names
    assert "highlight_edit_target" in names
    assert "apply_edit_plan" in names
    assert "apply_error_fix" not in names
    change_set = next(i for i in res.items if i.kind == "change_set")
    assert change_set.payload["scope"] == "configuration"
    assert change_set.payload["count"] >= 1
    assert {i.kind for i in res.items} >= {"change_set", "checkpoint", "decision", "assistant_turn"}


def test_plan_approval_ignores_non_approve_action():
    from core.workflow_copilot.handlers_edit import handle_plan_approval

    env, repo = _new_env()
    s = _seed_edit_session(repo, PcState.EDIT_PLAN_APPROVAL, edit_target_node_ids=["llm"])
    res = handle_plan_approval(
        env, Turn(action=Action(kind="message", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_PLAN_APPROVAL


def test_apply_changes_run_affected_tests_advances_to_test():
    from core.workflow_copilot.handlers_edit import handle_apply_changes

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_APPLY_CHANGES, edit_target_node_ids=["llm"])
    turn = Turn(action=Action(kind="run_affected_tests", base_version=1), actor=_actor())
    res = handle_apply_changes(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.EDIT_TEST_AFFECTED_PATHS
    assert {"event": "start_test_run"} in events


def test_apply_changes_revert_records_intent_only():
    from core.workflow_copilot.handlers_edit import handle_apply_changes

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_APPLY_CHANGES, edit_target_node_ids=["llm"])
    turn = Turn(action=Action(kind="undo", base_version=1), actor=_actor())  # revert -> undo
    res = handle_apply_changes(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.EDIT_REVERTED
    assert any(i.kind == "decision" for i in res.items)
    assert {"event": "revert_checkpoint"} in events


def test_test_affected_paths_emits_result_and_reaches_review():
    from core.workflow_copilot.handlers_edit import handle_test_affected_paths

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_TEST_AFFECTED_PATHS, edit_target_node_ids=["llm"])
    res = handle_test_affected_paths(env, Turn(actor=_actor()), *repo.get_session(s.id))

    assert res.next == PcState.EDIT_REVIEW
    kinds = [i.kind for i in res.items]
    assert "test_result" in kinds
    summary = next(i for i in res.items if i.kind == "summary")
    assert summary.payload["variant"] == "review"
    names = [e["event"] for e in events]
    assert "mark_test_success" in names
    assert "mark_review_ready" in names


def test_review_publish_reaches_terminal_edit_publish_with_publish_card():
    from core.workflow_copilot.handlers_edit import handle_review

    dify = FakeEditDifyPort()
    events: list[dict] = []
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_REVIEW, plan_items=["Tighten threshold"])
    res = handle_review(
        env, Turn(action=Action(kind="publish_workflow", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_PUBLISH
    assert dify.published is True
    kinds = {i.kind for i in res.items}
    assert "publish" in kinds
    assert any(i.kind == "summary" and i.payload["variant"] == "completion" for i in res.items)
    assert {"event": "publish_workflow"} in events


def test_review_keep_draft_reaches_terminal_without_publish_card():
    from core.workflow_copilot.handlers_edit import handle_review

    dify = FakeEditDifyPort()
    events: list[dict] = []
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_REVIEW, plan_items=["Tighten threshold"])
    res = handle_review(
        env, Turn(action=Action(kind="keep_draft", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_PUBLISH  # same terminal, mock: keep_draft = Task Completed
    assert dify.published is False  # but no real publish
    assert not any(i.kind == "publish" for i in res.items)  # and no publish card
    assert any(i.kind == "summary" and i.payload["variant"] == "completion" for i in res.items)
    assert {"event": "cancel_publish"} in events


def test_review_continue_adjusting_returns_to_impact_analysis():
    from core.workflow_copilot.handlers_edit import handle_review

    env, repo = _new_env()
    s = _seed_edit_session(
        repo, PcState.EDIT_REVIEW, edit_rules={"risk_threshold": "high"}, edit_target_node_ids=["llm"]
    )
    res = handle_review(
        env, Turn(action=Action(kind="re_fix", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_IMPACT_ANALYSIS
    kinds = {i.kind for i in res.items}
    assert {"form", "challenge", "change_set"} <= kinds


def test_review_revert_records_intent_only():
    from core.workflow_copilot.handlers_edit import handle_review

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_REVIEW, edit_target_node_ids=["llm"])
    res = handle_review(env, Turn(action=Action(kind="undo", base_version=1), actor=_actor()), *repo.get_session(s.id))
    assert res.next == PcState.EDIT_REVERTED
    assert {"event": "revert_checkpoint"} in events


def test_reverted_retry_returns_to_plan_approval_with_fresh_checkpoint():
    from core.workflow_copilot.handlers_edit import handle_reverted

    env, repo = _new_env()
    s = _seed_edit_session(repo, PcState.EDIT_REVERTED, edit_rules={"risk_threshold": "high"})
    res = handle_reverted(
        env, Turn(action=Action(kind="re_fix", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_PLAN_APPROVAL
    assert res.context.plan_version_tag == "v1"
    assert res.context.checkpoint_id
    assert {i.kind for i in res.items} >= {"plan", "checkpoint", "assistant_turn"}


def test_edit_registry_covers_all_non_terminal_edit_states():
    from core.workflow_copilot.handlers_edit import edit_registry

    assert set(edit_registry().keys()) == {
        PcState.EDIT_CAPABILITY_CHECK,
        PcState.EDIT_IMPACT_ANALYSIS,
        PcState.EDIT_PLAN_APPROVAL,
        PcState.EDIT_APPLY_CHANGES,
        PcState.EDIT_TEST_AFFECTED_PATHS,
        PcState.EDIT_REVIEW,
        PcState.EDIT_REVERTED,
    }
    assert PcState.EDIT_PUBLISH not in edit_registry()  # terminal: no handler


def test_full_edit_flow_goal_to_publish():
    from core.workflow_copilot.handlers_edit import edit_registry

    dify = FakeEditDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK)
    runner = Runner(env, edit_registry())

    # 1) send_edit_goal -> edit.impact_analysis
    out = runner.advance(
        s.id,
        Turn(action=Action(kind="send_edit_goal", payload={"text": "Tighten risk"}, base_version=1), actor=_actor()),
    )
    assert out.current_state == PcState.EDIT_IMPACT_ANALYSIS

    # 2) submit_edit_rules -> edit.plan_approval
    out = runner.advance(
        s.id,
        Turn(
            action=Action(
                kind="submit_edit_rules",
                payload={"risk_threshold": "high"},
                base_version=out.version,
            ),
            actor=_actor(),
        ),
    )
    assert out.current_state == PcState.EDIT_PLAN_APPROVAL

    # 3) approve_plan (-> approve_repair) -> THE EDIT -> edit.apply_changes
    out = runner.advance(
        s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor())
    )
    assert out.current_state == PcState.EDIT_APPLY_CHANGES
    # the existing llm node was reconfigured with the submitted rule value.
    graph, _hash = dify.read_graph("app", _actor())
    llm = next(n for n in graph["nodes"] if n["id"] == "llm")
    assert llm["data"]["risk_threshold"] == "high"

    # 4) run_affected_tests -> edit.test_affected_paths (working, auto) -> rest at edit.review
    out = runner.advance(
        s.id, Turn(action=Action(kind="run_affected_tests", base_version=out.version), actor=_actor())
    )
    assert out.current_state == PcState.EDIT_REVIEW

    # 5) publish_workflow -> edit.publish (terminal)
    out = runner.advance(
        s.id, Turn(action=Action(kind="publish_workflow", base_version=out.version), actor=_actor())
    )
    assert out.current_state == PcState.EDIT_PUBLISH
    assert dify.published is True

    items = repo.list_conversation(s.id)
    kinds = [i.kind for i in items]
    expected_kinds = [
        "user",
        "summary",
        "form",
        "challenge",
        "change_set",
        "plan",
        "checkpoint",
        "test_result",
        "publish",
    ]
    for expected in expected_kinds:
        assert expected in kinds, f"missing card kind {expected}"
    seqs = [i.seq for i in items]
    assert seqs == sorted(seqs)
    assert any(i.kind == "summary" and i.payload.get("variant") == "completion" for i in items)


def test_full_edit_flow_keep_draft_completes_without_publish():
    from core.workflow_copilot.handlers_edit import edit_registry

    dify = FakeEditDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK)
    runner = Runner(env, edit_registry())

    out = runner.advance(
        s.id, Turn(action=Action(kind="send_edit_goal", payload={"text": "x"}, base_version=1), actor=_actor())
    )
    out = runner.advance(s.id, Turn(action=Action(kind="submit_edit_rules", base_version=out.version), actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="run_affected_tests", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_REVIEW

    out = runner.advance(s.id, Turn(action=Action(kind="keep_draft", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_PUBLISH  # terminal, Task Completed
    assert dify.published is False  # keep_draft does not publish
    assert not any(i.kind == "publish" for i in repo.list_conversation(s.id))


def test_continue_adjusting_then_reapprove_is_idempotent():
    """Loop back from edit.review via continue_adjusting (-> re_fix) to edit.
    impact_analysis, re-submit rules, re-approve. Re-applying the same
    set_node_config value overwrites (no crash); the flow reaches edit.apply_
    changes again."""
    from core.workflow_copilot.handlers_edit import edit_registry

    dify = FakeEditDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK)
    runner = Runner(env, edit_registry())

    out = runner.advance(
        s.id, Turn(action=Action(kind="send_edit_goal", payload={"text": "x"}, base_version=1), actor=_actor())
    )
    out = runner.advance(s.id, Turn(action=Action(kind="submit_edit_rules", base_version=out.version), actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="run_affected_tests", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_REVIEW

    # continue_adjusting (-> re_fix) -> edit.impact_analysis
    out = runner.advance(s.id, Turn(action=Action(kind="re_fix", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_IMPACT_ANALYSIS

    # re-submit + re-approve: must not raise, reaches edit.apply_changes again.
    out = runner.advance(s.id, Turn(action=Action(kind="submit_edit_rules", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_PLAN_APPROVAL
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_APPLY_CHANGES
    assert len(dify.graph["nodes"]) == 4  # no duplicate nodes; config-only edits


def test_revert_then_retry_after_revert_reapprove_is_idempotent():
    """Loop back via the revert -> reverted -> retry_after_revert (handle_
    reverted's re_fix -> edit.plan_approval) path, then re-approve."""
    from core.workflow_copilot.handlers_edit import edit_registry

    dify = FakeEditDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK)
    runner = Runner(env, edit_registry())

    out = runner.advance(
        s.id, Turn(action=Action(kind="send_edit_goal", payload={"text": "x"}, base_version=1), actor=_actor())
    )
    out = runner.advance(s.id, Turn(action=Action(kind="submit_edit_rules", base_version=out.version), actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_APPLY_CHANGES

    # revert (intent only) -> edit.reverted
    out = runner.advance(s.id, Turn(action=Action(kind="undo", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_REVERTED

    # retry_after_revert (-> re_fix) -> edit.plan_approval
    out = runner.advance(s.id, Turn(action=Action(kind="re_fix", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_PLAN_APPROVAL

    # re-approve: idempotent, reaches edit.apply_changes.
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_APPLY_CHANGES
    assert len(dify.graph["nodes"]) == 4
