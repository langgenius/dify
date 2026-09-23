"""Tests for the Edit-flow handlers + edit_registry() (Slice 3)."""

from datetime import datetime

from core.dify_builder.models import (
    Action,
    Actor,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    MutationIntent,
    Session,
    Turn,
)
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import FakeEditDifyPort, InMemoryRepository, StubAgent


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _new_env(dify=None, emit_canvas=None, agent=None) -> tuple[Env, InMemoryRepository]:
    repo = InMemoryRepository()
    env = Env(
        dify=dify or FakeEditDifyPort(),
        agent=agent or PlaceholderAgent(),
        repo=repo,
        now=lambda: datetime.min,
        emit_canvas=emit_canvas,
    )
    return env, repo


def _session(**overrides) -> Session:
    fields: dict = {
        "app_id": "app",
        "tenant_id": "tenant-1",
        "owner_account_id": "acc-1",
        "entry_mode": EntryMode.EDIT,
        "current_state": PcState.EDIT_CAPABILITY_CHECK,
    }
    fields.update(overrides)
    return Session(**fields)


def _seed_edit_session(repo: InMemoryRepository, state: PcState, **fc_kwargs) -> Session:
    s = Session(
        app_id="app",
        tenant_id="tenant-1",
        owner_account_id="acc-1",
        entry_mode=EntryMode.EDIT,
        current_state=state,
    )
    fc = DifyBuilderContext(goal_text="Tighten risk handling", **fc_kwargs)
    repo.create_session(s, fc, [ConversationItem(kind="user", seq=0)])
    return s


def test_capability_check_send_edit_goal_advances_to_impact_analysis():
    from core.dify_builder.handlers_edit import edit_registry

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
    assert fc.last_snapshot_hash
    assert fc.last_structure_fingerprint
    kinds = [i.kind for i in repo.list_conversation(s.id)]
    assert "summary" in kinds  # context summary
    assert "form" in kinds
    assert "challenge" in kinds
    assert "change_set" in kinds
    assert any(e["event"] == "highlight_edit_target" for e in events)


def test_edit_capability_check_renders_agent_fields():
    # PlaceholderAgent.analyze_impact returns dynamic fields/values/targets;
    # the form card and fc.form_fields/edit_rules/edit_target_node_ids must
    # reflect them (not the old hardcoded _EDIT_RULE_FIELDS constant).
    from core.dify_builder.handlers_edit import handle_capability_check

    env, _ = _new_env()
    env.agent.analyze_impact = lambda _g, _graph: {
        "fields": [{"key": "tone", "label": "Tone", "type": "select", "options": ["formal", "casual"]}],
        "values": {"tone": "formal"},
        "target_node_ids": ["llm"],
    }
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_CAPABILITY_CHECK)
    fc = DifyBuilderContext(goal_text="make it formal")
    result = handle_capability_check(
        env, Turn(actor=_actor(), action=Action(kind="send_edit_goal", payload={"text": "formal"})), s, fc
    )
    assert result.context.form_fields[0]["key"] == "tone"
    assert result.context.edit_rules == {"tone": "formal"}
    assert result.context.edit_target_node_ids == ["llm"]
    change_set = next(item for item in result.items if item.kind == "change_set")
    assert change_set.payload["changes"] == []
    assert change_set.payload["nodes"][0]["node_id"] == "llm"
    assert change_set.payload["nodes"][0]["title"]


def test_capability_check_ignores_non_goal_action():
    from core.dify_builder.handlers_edit import handle_capability_check

    env, repo = _new_env()
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK)
    res = handle_capability_check(
        env, Turn(action=Action(kind="message", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_CAPABILITY_CHECK


def test_impact_analysis_submit_rules_advances_to_plan_approval_with_checkpoint():
    from core.dify_builder.handlers_edit import handle_impact_analysis

    env, repo = _new_env()
    s = _seed_edit_session(
        repo,
        PcState.EDIT_IMPACT_ANALYSIS,
        edit_rules={"risk_threshold": "medium", "review_team": "compliance"},
        edit_target_node_ids=["llm"],
        form_fields=[
            {"key": "risk_threshold", "label": "Risk threshold", "type": "text"},
            {"key": "review_team", "label": "Review team", "type": "text"},
        ],
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
    assert res.context.last_structure_fingerprint != ""
    cp, _snap = repo.get_checkpoint(res.context.checkpoint_id)
    assert cp.session_id == s.id
    checkpoint_card = next(i for i in res.items if i.kind == "checkpoint")
    assert checkpoint_card.payload["checkpoint_id"] == res.context.checkpoint_id
    assert {i.kind for i in res.items} >= {"decision", "plan", "checkpoint", "assistant_turn"}


def test_edit_registry_maps_capability_check_and_impact_analysis():
    from core.dify_builder.handlers_edit import (
        edit_registry,
        handle_capability_check,
        handle_impact_analysis,
    )

    reg = edit_registry()
    assert reg[PcState.EDIT_CAPABILITY_CHECK] is handle_capability_check
    assert reg[PcState.EDIT_IMPACT_ANALYSIS] is handle_impact_analysis


def test_plan_approval_approve_edits_graph_and_emits_canvas():
    from core.dify_builder.handlers_edit import handle_plan_approval

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
    from core.dify_builder.handlers_edit import handle_plan_approval

    env, repo = _new_env()
    s = _seed_edit_session(repo, PcState.EDIT_PLAN_APPROVAL, edit_target_node_ids=["llm"])
    res = handle_plan_approval(
        env, Turn(action=Action(kind="message", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_PLAN_APPROVAL


def test_apply_changes_run_affected_tests_advances_to_test():
    from core.dify_builder.handlers_edit import handle_apply_changes

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    # test_input_ref already prepared -- run_affected_tests must skip the testdata gate.
    s = _seed_edit_session(repo, PcState.EDIT_APPLY_CHANGES, edit_target_node_ids=["llm"], test_input_ref="ti-1")
    turn = Turn(action=Action(kind="run_affected_tests", base_version=1), actor=_actor())
    res = handle_apply_changes(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.EDIT_TEST_AFFECTED_PATHS
    assert {"event": "start_test_run"} in events


def test_apply_changes_revert_records_intent_only():
    from core.dify_builder.handlers_edit import handle_apply_changes

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_APPLY_CHANGES, edit_target_node_ids=["llm"])
    turn = Turn(action=Action(kind="undo", base_version=1), actor=_actor())  # revert -> undo
    res = handle_apply_changes(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.EDIT_REVERTED
    assert any(i.kind == "decision" for i in res.items)
    assert {"event": "revert_checkpoint"} in events


def test_edit_test_pass_goes_to_review_with_real_run():
    from core.dify_builder.handlers_edit import handle_test_affected_paths

    events: list[dict] = []
    env, _ = _new_env(emit_canvas=events.append)  # FakeEditDifyPort.verify_pass True by default
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    fc = DifyBuilderContext(edit_target_node_ids=["llm"])
    result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.EDIT_REVIEW
    assert result.run is not None
    assert result.run.status == "succeeded"
    assert result.context.test_input_ref  # inputs generated + persisted
    test_result = next(i for i in result.items if i.kind == "test_result")
    assert test_result.payload["tone"] == "success"
    summary = next(i for i in result.items if i.kind == "summary")
    assert summary.payload["variant"] == "review"
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["test_result", "summary"]
    names = [e["event"] for e in events]
    assert "mark_test_success" in names
    assert "mark_review_ready" in names


def test_edit_test_fail_routes_to_await_repair():
    from core.dify_builder.handlers_edit import handle_test_affected_paths

    events: list[dict] = []
    env, _ = _new_env(agent=StubAgent(), emit_canvas=events.append)
    env.dify.verify_pass = False
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    fc = DifyBuilderContext(edit_target_node_ids=["llm"])
    result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.EDIT_AWAIT_REPAIR
    assert result.run is not None
    assert result.run.status == "failed"
    # StubAgent.propose_repair returns a repair -> staged
    assert result.context.staged_repair
    # card content: a red test_result, an error card carrying the real
    # diagnosis (StubAgent.diagnose's culprit/root_cause), and a change_set
    # since a repair was proposed -- the assistant_turn's cards list reflects
    # exactly that trio.
    test_result = next(i for i in result.items if i.kind == "test_result")
    assert test_result.payload["tone"] == "error"
    error_card = next(i for i in result.items if i.kind == "error")
    assert error_card.payload["body"] == "Output node requires 'metrics'"
    assert error_card.payload["node_id"] == "output"
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["test_result", "error", "change_set"]
    # The canvas event carries the Dify run id so a client can open the
    # failed run on the graph, not just colour the node red.
    assert {"event": "mark_test_error", "dify_run_id": "build-run-1"} in events


def test_edit_test_fail_with_no_proposed_repair_still_routes_to_gate():
    """When propose_repair finds no safe fix (empty intents), the fail path
    must still route to the gate, but WITHOUT a change_set card, and with the
    "no safe automatic fix" reply_text variant -- the `if intents` branch the
    handler takes to decide between the two card/reply-text shapes."""
    from core.dify_builder.handlers_edit import handle_test_affected_paths
    from core.dify_builder.models import Risk

    env, _ = _new_env()
    env.dify.verify_pass = False
    env.agent.propose_repair = lambda _diagnosis, _graph: (
        [],
        Risk(level="high", reason="no fix", has_external_side_effect=False),
    )
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    fc = DifyBuilderContext(edit_target_node_ids=["llm"])
    result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.EDIT_AWAIT_REPAIR
    assert result.context.staged_repair == []
    kinds = [i.kind for i in result.items]
    assert "change_set" not in kinds
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["test_result", "error"]
    assert assistant.payload["reply_text"] == "Test failed — no safe automatic fix; edit or keep draft."


def test_edit_test_reuses_persisted_inputs_on_retest():
    from core.dify_builder.handlers_edit import handle_test_affected_paths

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    fc = DifyBuilderContext(edit_target_node_ids=["llm"], test_input_ref="")
    handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)
    ref = fc.test_input_ref
    handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)
    assert fc.test_input_ref == ref  # reused, not regenerated


def test_edit_test_run_draft_raises_routes_to_await_repair_failed():
    """run_draft raising must not crash the advance -- the try/except degrade
    path converts the exception into a failed run and still routes to the
    edit.await_repair gate."""
    from core.dify_builder.handlers_edit import handle_test_affected_paths

    env, _ = _new_env()
    env.dify.run_draft = lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom"))
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    fc = DifyBuilderContext(edit_target_node_ids=["llm"])

    result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.EDIT_AWAIT_REPAIR
    assert result.run is not None
    assert result.run.status == "failed"


def test_edit_test_run_draft_raises_captures_error_on_run():
    """Regression: a launch-time exception must be captured on run.error, not
    silently discarded. A non-input error still routes to the config-repair gate."""
    from core.dify_builder.handlers_edit import handle_test_affected_paths

    env, _ = _new_env()
    env.dify.run_draft = lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("kaboom-provider"))
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    fc = DifyBuilderContext(edit_target_node_ids=["llm"])

    result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.EDIT_AWAIT_REPAIR
    assert result.run is not None
    assert "kaboom-provider" in (result.run.error or "")


def test_edit_test_run_draft_raises_input_error_routes_to_testdata_gate():
    """A launch-time exception whose message is an input-validation error must
    route back to the testdata gate, and the real error must be captured on
    the run."""
    from core.dify_builder.handlers_edit import handle_test_affected_paths
    from core.dify_builder.models import TestInput

    env, _ = _new_env()
    env.dify.run_draft = lambda *_a, **_k: (_ for _ in ()).throw(ValueError("query is required in input form"))
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(edit_target_node_ids=["llm"], test_input_ref="ti-1")

    result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.EDIT_AWAIT_TESTDATA
    assert result.context.test_input_ref == ""  # stale input cleared
    assert result.run is not None
    assert "in input form" in (result.run.error or "")


def test_edit_test_input_failure_routes_to_testdata_gate():
    """An INPUT-caused run failure (missing/invalid test data, per
    is_input_failure's signal match) must clear the stale input ref and route
    back to the testdata gate -- not the config-repair gate."""
    from core.dify_builder.handlers_edit import handle_test_affected_paths
    from core.dify_builder.models import TestInput

    env, _ = _new_env()
    env.dify.verify_pass = False
    env.dify.fail_error = "File variable not found for selector: ['start', 'document']"
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(edit_target_node_ids=["llm"], test_input_ref="ti-1")

    result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.EDIT_AWAIT_TESTDATA
    assert result.context.test_input_ref == ""  # stale input cleared
    assert result.context.verify_run_id == ""
    kinds = [i.kind for i in result.items]
    assert "form" in kinds
    assert "change_set" not in kinds  # gate, not repair
    test_result = next(i for i in result.items if i.kind == "test_result")
    assert test_result.payload["tone"] == "error"
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["stage_id"] == "edit.test_affected_paths"


def test_edit_test_config_failure_still_routes_to_repair_gate():
    """A config-caused run failure (the fake's default error, which matches no
    input-failure signal) must still route to the config-repair gate,
    unchanged."""
    from core.dify_builder.handlers_edit import handle_test_affected_paths
    from core.dify_builder.models import TestInput

    env, _ = _new_env(agent=StubAgent())
    env.dify.verify_pass = False  # default error "boom" -> config, not input
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(edit_target_node_ids=["llm"], test_input_ref="ti-1")

    result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.EDIT_AWAIT_REPAIR
    assert result.context.staged_repair  # StubAgent proposes a repair
    assert result.context.test_input_ref == "ti-1"  # untouched on the config path


def test_edit_test_model_config_failure_surfaces_without_repair():
    """A model-config failure must be surfaced (no diagnose/propose_repair
    thrash); no node-mutation repair is staged."""
    from core.dify_builder.handlers_edit import handle_test_affected_paths
    from core.dify_builder.models import TestInput

    env, _ = _new_env(agent=StubAgent())
    env.dify.verify_pass = False
    env.dify.fail_error = "Provider openai does not exist."  # model-config error
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(edit_target_node_ids=["llm"], test_input_ref="ti-1")

    result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.EDIT_AWAIT_REPAIR
    assert result.context.staged_repair == []  # no node-mutation repair proposed
    kinds = [i.kind for i in result.items]
    assert "change_set" not in kinds
    error = next(i for i in result.items if i.kind == "error")
    assert "model" in error.payload["body"].lower()


def test_review_publish_enters_working_publish_before_side_effect():
    from core.dify_builder.handlers_edit import handle_publish, handle_review

    dify = FakeEditDifyPort()
    events: list[dict] = []
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_REVIEW, plan_items=["Tighten threshold"])
    res = handle_review(
        env, Turn(action=Action(kind="publish_workflow", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_PUBLISH
    assert dify.published is False
    assert [item.kind for item in res.items] == ["decision"]

    s.current_state = PcState.EDIT_PUBLISH
    publish = handle_publish(env, Turn(actor=_actor()), s, res.context)
    assert publish.next == PcState.EDIT_COMPLETE
    assert dify.published is True
    assert any(item.kind == "publish" for item in publish.items)
    assert any(item.kind == "summary" and item.payload["variant"] == "completion" for item in publish.items)
    assert {"event": "publish_workflow"} in events


def test_review_keep_draft_reaches_terminal_without_publish_card():
    from core.dify_builder.handlers_edit import handle_review

    dify = FakeEditDifyPort()
    events: list[dict] = []
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_REVIEW, plan_items=["Tighten threshold"])
    res = handle_review(
        env, Turn(action=Action(kind="keep_draft", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_COMPLETE
    assert dify.published is False  # but no real publish
    assert not any(i.kind == "publish" for i in res.items)  # and no publish card
    assert any(i.kind == "summary" and i.payload["variant"] == "completion" for i in res.items)
    assert {"event": "cancel_publish"} in events


def test_review_continue_adjusting_returns_to_impact_analysis():
    from core.dify_builder.handlers_edit import handle_review

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
    change_set = next(item for item in res.items if item.kind == "change_set")
    assert change_set.payload["changes"] == []
    assert change_set.payload["nodes"][0]["node_id"] == "llm"
    assert change_set.payload["nodes"][0]["title"]


def test_review_revert_records_intent_only():
    from core.dify_builder.handlers_edit import handle_review

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_REVIEW, edit_target_node_ids=["llm"])
    res = handle_review(env, Turn(action=Action(kind="undo", base_version=1), actor=_actor()), *repo.get_session(s.id))
    assert res.next == PcState.EDIT_REVERTED
    assert {"event": "revert_checkpoint"} in events


def test_reverted_retry_returns_to_plan_approval_with_fresh_checkpoint():
    from core.dify_builder.handlers_edit import handle_reverted

    env, repo = _new_env()
    s = _seed_edit_session(repo, PcState.EDIT_REVERTED, edit_rules={"risk_threshold": "high"})
    res = handle_reverted(
        env, Turn(action=Action(kind="re_fix", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.EDIT_PLAN_APPROVAL
    assert res.context.plan_version_tag == "v1"
    assert res.context.checkpoint_id
    assert {i.kind for i in res.items} >= {"plan", "checkpoint", "assistant_turn"}


def test_re_fix_branches_clear_stale_test_input_ref_and_verify_run_id():
    """Both re-plan/revert escape paths (review's continue_adjusting and
    reverted's retry_after_revert) must clear fc.test_input_ref and
    fc.verify_run_id -- otherwise the retest after a rebuild reuses the
    FIRST build's stale mock inputs instead of regenerating fresh
    schema-shaped ones. They must also reset the repair breaker's counter
    (fc.repair_attempts / fc.last_repair_error), same as Build's parallel
    handlers -- otherwise a count left over from an earlier repair cycle
    survives into the next adjustment and the breaker can trip one round
    early. The unknown-outcome count resets too: after the cap (2) ->
    keep_draft -> review -> re_fix, the new cycle's FIRST unknown outcome
    would otherwise re-cap with "twice in a row"."""
    from core.dify_builder.handlers_edit import handle_reverted, handle_review

    env, repo = _new_env()
    s = _seed_edit_session(
        repo,
        PcState.EDIT_REVIEW,
        edit_rules={"risk_threshold": "high"},
        edit_target_node_ids=["llm"],
        test_input_ref="ti-old",
        verify_run_id="run-old",
        repair_attempts=1,
        last_repair_error="llm|boom",
        unknown_outcome_count=2,
    )
    turn = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res = handle_review(env, turn, *repo.get_session(s.id))
    assert res.context.test_input_ref == ""
    assert res.context.verify_run_id == ""
    assert res.context.repair_attempts == 0
    assert res.context.last_repair_error == ""
    assert res.context.unknown_outcome_count == 0

    env2, repo2 = _new_env()
    s2 = _seed_edit_session(
        repo2,
        PcState.EDIT_REVERTED,
        edit_rules={"risk_threshold": "high"},
        test_input_ref="ti-old",
        verify_run_id="run-old",
        repair_attempts=1,
        last_repair_error="llm|boom",
        unknown_outcome_count=2,
    )
    turn2 = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res2 = handle_reverted(env2, turn2, *repo2.get_session(s2.id))
    assert res2.context.test_input_ref == ""
    assert res2.context.verify_run_id == ""
    assert res2.context.repair_attempts == 0
    assert res2.context.last_repair_error == ""
    assert res2.context.unknown_outcome_count == 0


def test_edit_await_repair_approve_applies_and_waits_for_retest():
    from core.dify_builder.handlers_edit import handle_await_repair

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_AWAIT_REPAIR)
    fc = DifyBuilderContext(
        staged_repair=[
            MutationIntent(
                op="set_node_config",
                args={"node_id": "llm", "path": "prompt_template", "value": []},
            )
        ],
        test_input_ref="ti-1",
    )
    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)
    assert result.next == PcState.EDIT_APPLY_CHANGES
    assert result.context.staged_repair == []


def test_edit_await_repair_refuses_to_apply_an_empty_staged_repair():
    """ESQ1-291 in Edit: the model-config branch stages NO repair and still
    routes here, so approving would apply nothing, retest, and re-offer the
    identical failure forever."""
    from core.dify_builder.handlers_edit import handle_await_repair

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_AWAIT_REPAIR)
    fc = DifyBuilderContext(staged_repair=[], test_input_ref="ti-1")

    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)

    assert result.next == PcState.EDIT_AWAIT_REPAIR
    assert "notice" in [item.kind for item in result.items]


def test_edit_await_repair_surfaces_a_stale_intent_instead_of_failing_the_session():
    """ESQ1-271: a staged intent that went stale between propose and approve
    must degrade to an error card, not an uncaught ValueError."""
    from core.dify_builder.handlers_edit import handle_await_repair

    env, _ = _new_env()

    def _stale(*_args, **_kwargs):
        raise ValueError("node not found: llm")

    env.dify.apply_repair = _stale  # type: ignore[method-assign]
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_AWAIT_REPAIR)
    fc = DifyBuilderContext(
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "code", "value": ""})],
        test_input_ref="ti-1",
    )

    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)

    assert result.next == PcState.EDIT_AWAIT_REPAIR
    error = next(i for i in result.items if i.kind == "error")
    assert error.payload["title"] == "Couldn't apply the fix"
    assert result.context.staged_repair == []


def test_edit_await_repair_says_a_fix_that_would_not_start_is_not_a_stale_fix():
    """A fix the preflight rejected applied fine; it would leave a draft that
    fails at Graph.init. Same recovery as a stale intent, true reason."""
    from core.dify_builder.errors import DraftWouldNotStartError
    from core.dify_builder.handlers_edit import handle_await_repair

    env, _ = _new_env()

    def _would_not_start(*_args, **_kwargs):
        raise DraftWouldNotStartError("the draft would not start: node 'llm' (llm): 1 validation error")

    env.dify.apply_repair = _would_not_start  # type: ignore[method-assign]
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_AWAIT_REPAIR)
    fc = DifyBuilderContext(
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "code", "value": ""})],
        test_input_ref="ti-1",
    )

    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)

    assert result.next == PcState.EDIT_AWAIT_REPAIR
    error = next(i for i in result.items if i.kind == "error")
    assert error.payload["title"] == "The workflow can't start"
    assert error.payload["body"] == (
        "The proposed fix would leave a workflow that fails before its first node: "
        "the draft would not start: node 'llm' (llm): 1 validation error"
    )
    assert result.context.staged_repair == []


def test_edit_await_repair_keep_draft_goes_to_review():
    from core.dify_builder.handlers_edit import handle_await_repair

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_AWAIT_REPAIR)
    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="keep_draft")), s, DifyBuilderContext())
    assert result.next == PcState.EDIT_REVIEW


def test_edit_await_repair_undo_reverts():
    from core.dify_builder.handlers_edit import handle_await_repair

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_AWAIT_REPAIR, edit_target_node_ids=["llm"])
    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="undo")), *repo.get_session(s.id))
    assert result.next == PcState.EDIT_REVERTED
    assert any(i.kind == "decision" for i in result.items)


def test_edit_await_repair_default_stays():
    from core.dify_builder.handlers_edit import handle_await_repair

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_AWAIT_REPAIR)
    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="message")), s, DifyBuilderContext())
    assert result.next == PcState.EDIT_AWAIT_REPAIR


def test_edit_await_repair_is_waiting_and_projected():
    from core.dify_builder.state import PcState, is_waiting
    from services.dify_builder.service import Phase, _actions_for, _phase_for

    assert is_waiting(PcState.EDIT_AWAIT_REPAIR)
    assert _phase_for(PcState.EDIT_AWAIT_REPAIR) == Phase.TEST
    assert [a.id for a in _actions_for(PcState.EDIT_AWAIT_REPAIR)]


def test_edit_registry_covers_all_non_terminal_edit_states():
    from core.dify_builder.handlers_edit import edit_registry

    assert set(edit_registry().keys()) == {
        PcState.EDIT_CAPABILITY_CHECK,
        PcState.EDIT_IMPACT_ANALYSIS,
        PcState.EDIT_PLAN_APPROVAL,
        PcState.EDIT_APPLY_CHANGES,
        PcState.EDIT_AWAIT_TESTDATA,
        PcState.EDIT_TEST_AFFECTED_PATHS,
        PcState.EDIT_AWAIT_REPAIR,
        PcState.EDIT_REVIEW,
        PcState.EDIT_PUBLISH,
        PcState.EDIT_REVERTED,
    }
    assert PcState.EDIT_COMPLETE not in edit_registry()


def test_full_edit_flow_goal_to_publish():
    from core.dify_builder.handlers_edit import edit_registry

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
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_APPLY_CHANGES
    # the existing llm node was reconfigured with the submitted rule value.
    graph, _hash = dify.read_graph("app", _actor())
    llm = next(n for n in graph["nodes"] if n["id"] == "llm")
    assert llm["data"]["risk_threshold"] == "high"

    # 4) run_affected_tests -> edit.await_testdata (gate; no test input prepared yet)
    out = runner.advance(s.id, Turn(action=Action(kind="run_affected_tests", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_AWAIT_TESTDATA

    # 4b) provide_testdata (mock) -> edit.test_affected_paths (working, auto) -> rest at edit.review
    testdata_action = Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version)
    out = runner.advance(s.id, Turn(action=testdata_action, actor=_actor()))
    assert out.current_state == PcState.EDIT_REVIEW

    # 5) publish_workflow -> edit.publish (working) -> edit.complete (terminal)
    out = runner.advance(s.id, Turn(action=Action(kind="publish_workflow", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_COMPLETE
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
    from core.dify_builder.handlers_edit import edit_registry

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
    assert out.current_state == PcState.EDIT_AWAIT_TESTDATA  # gate; no test input prepared yet
    testdata_action = Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version)
    out = runner.advance(s.id, Turn(action=testdata_action, actor=_actor()))
    assert out.current_state == PcState.EDIT_REVIEW

    out = runner.advance(s.id, Turn(action=Action(kind="keep_draft", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_COMPLETE
    assert dify.published is False  # keep_draft does not publish
    assert not any(i.kind == "publish" for i in repo.list_conversation(s.id))


def test_continue_adjusting_then_reapprove_is_idempotent():
    """Loop back from edit.review via continue_adjusting (-> re_fix) to edit.
    impact_analysis, re-submit rules, re-approve. Re-applying the same
    set_node_config value overwrites (no crash); the flow reaches edit.apply_
    changes again."""
    from core.dify_builder.handlers_edit import edit_registry

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
    assert out.current_state == PcState.EDIT_AWAIT_TESTDATA  # gate; no test input prepared yet
    testdata_action = Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version)
    out = runner.advance(s.id, Turn(action=testdata_action, actor=_actor()))
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


def test_run_affected_tests_routes_to_testdata_gate_when_no_input():
    from core.dify_builder.handlers_edit import handle_apply_changes

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_APPLY_CHANGES)
    result = handle_apply_changes(
        env,
        Turn(actor=_actor(), action=Action(kind="run_affected_tests")),
        s,
        DifyBuilderContext(test_input_ref=""),
    )
    assert result.next == PcState.EDIT_AWAIT_TESTDATA
    assert any(i.kind == "form" and i.payload["variant"] == "testdata" for i in result.items)


def test_edit_await_testdata_mock_prepares_and_advances():
    from core.dify_builder.handlers_edit import handle_await_testdata

    env, _ = _new_env()
    env.agent.generate_mock_inputs = lambda _schema, _prior: {"q": "x"}
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_AWAIT_TESTDATA)
    result = handle_await_testdata(
        env,
        Turn(actor=_actor(), action=Action(kind="provide_testdata", payload={"mode": "mock"})),
        s,
        DifyBuilderContext(),
    )
    assert result.next == PcState.EDIT_TEST_AFFECTED_PATHS
    assert result.context.test_input_ref


def _endpoint_graph() -> dict:
    """What ``_ground_placeholder_endpoints`` leaves of the ESQ1-302 draft: its
    invented ``https://api.example.com/ppt/generate`` re-pointed at a required
    start variable."""
    return {
        "nodes": [
            {
                "id": "s",
                "data": {
                    "type": "start",
                    "variables": [
                        {"variable": "topic", "type": "text-input", "required": True},
                        {"variable": "h_url", "type": "text-input", "required": True, "max_length": 2048},
                    ],
                },
            },
            {"id": "h", "data": {"type": "http-request", "title": "Call PPT API", "url": "{{#s.h_url#}}"}},
            {"id": "e", "data": {"type": "end", "outputs": []}},
        ],
        "edges": [],
    }


def _mock_with_an_invented_endpoint(_schema, _prior):
    return {"topic": "quarterly report", "h_url": "https://api.example.com/ppt/generate"}


def test_edit_await_testdata_mock_leaves_the_endpoint_for_the_form():
    """A mocked endpoint URL is accepted at launch and fails on connection -- a
    config failure that feeds the repair loop (ESQ1-302). Left out, the missing
    required key fails the launch as an input the form then asks for."""
    from core.dify_builder.handlers_edit import handle_await_testdata

    env, _ = _new_env()
    env.dify.graph = _endpoint_graph()
    env.agent.generate_mock_inputs = _mock_with_an_invented_endpoint
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_AWAIT_TESTDATA)

    result = handle_await_testdata(
        env,
        Turn(actor=_actor(), action=Action(kind="provide_testdata", payload={"mode": "mock"})),
        s,
        DifyBuilderContext(),
    )

    assert result.next == PcState.EDIT_TEST_AFFECTED_PATHS
    assert env.repo.get_test_input(result.context.test_input_ref).inputs == {"topic": "quarterly report"}


def test_edit_test_affected_paths_defensive_mock_leaves_the_endpoint_for_the_form():
    from core.dify_builder.handlers_edit import handle_test_affected_paths

    env, _ = _new_env()
    env.dify.graph = _endpoint_graph()
    env.agent.generate_mock_inputs = _mock_with_an_invented_endpoint
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)

    result = handle_test_affected_paths(
        env, Turn(actor=_actor()), s, DifyBuilderContext(edit_target_node_ids=["h"], test_input_ref="")
    )

    assert env.dify.run_draft_inputs == {"topic": "quarterly report"}
    assert env.repo.get_test_input(result.context.test_input_ref).inputs == {"topic": "quarterly report"}


def test_edit_await_testdata_is_waiting_and_projected():
    from core.dify_builder.state import PcState, is_waiting
    from services.dify_builder.service import Phase, _actions_for, _phase_for

    assert is_waiting(PcState.EDIT_AWAIT_TESTDATA)
    assert _phase_for(PcState.EDIT_AWAIT_TESTDATA) == Phase.TEST
    assert [a.id for a in _actions_for(PcState.EDIT_AWAIT_TESTDATA)] == ["provide_testdata"]


def test_revert_then_retry_after_revert_reapprove_is_idempotent():
    """Loop back via the revert -> reverted -> retry_after_revert (handle_
    reverted's re_fix -> edit.plan_approval) path, then re-approve."""
    from core.dify_builder.handlers_edit import edit_registry

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


def test_a_launch_error_frame_is_diagnosed_not_bounced_as_unknown():
    """Edit discarded ``Run.error`` exactly like Build did. With the port now
    reporting the ESQ1-302 error frame as a failed Run, the failure must reach
    diagnose and the repair gate, carrying its error."""
    from core.dify_builder.handlers_edit import handle_test_affected_paths
    from core.dify_builder.models import Run, TestInput

    launch_error = "node 'node4' (http-request): body.data.0.type Field required [invalid_param]"

    def launch_failed(*_a, **_k) -> Run:
        return Run(kind="verify", immutable=True, dify_run_id="", status="failed", per_node=[], error=launch_error)

    env, repo = _new_env(agent=StubAgent())
    env.dify.run_draft = launch_failed
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))

    res = handle_test_affected_paths(env, Turn(actor=_actor()), s, DifyBuilderContext(test_input_ref="ti-1"))

    assert res.next == PcState.EDIT_AWAIT_REPAIR
    assert res.run.status == "failed"
    assert res.run.error == launch_error
    assert "notice" not in [i.kind for i in res.items]


def test_plan_approval_surfaces_an_edit_that_would_not_start_instead_of_crashing():
    """Same preflight rejection as Build's: ``apply_repair`` raises a
    ``DraftWouldNotStartError`` for an edit whose result would fail at
    Graph.init. The edit session must survive it as a card and stay at the
    plan gate."""
    from core.dify_builder.errors import DraftWouldNotStartError
    from core.dify_builder.handlers_edit import handle_plan_approval

    dify = FakeEditDifyPort()

    def would_not_start(*_a, **_k):
        raise DraftWouldNotStartError("the draft would not start: node 'llm' (llm): 1 validation error for LLMNodeData")

    dify.apply_repair = would_not_start
    env, repo = _new_env(dify=dify)
    s = _seed_edit_session(
        repo,
        PcState.EDIT_PLAN_APPROVAL,
        edit_rules={"risk_threshold": "high"},
        edit_target_node_ids=["llm"],
        checkpoint_id="cp-1",
    )
    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())

    res = handle_plan_approval(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.EDIT_PLAN_APPROVAL
    error = next(i for i in res.items if i.kind == "error")
    assert error.payload["title"] == "The workflow can't start"
    assert "node 'llm' (llm)" in error.payload["body"]
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert assistant.payload["reply_text"] == (
        "I didn't apply the change: the workflow would fail before its first node. "
        "Continue adjusting to change the rules, approve again, or discard the plan."
    )


def test_plan_approval_does_not_call_an_unapplicable_edit_a_workflow_that_cannot_start():
    """A graph_ops rejection ("node not found") never reached the startability
    check -- the edit intents just did not apply. Same recovery as the
    preflight card (nothing written, plan still approvable), honest reason."""
    from core.dify_builder.handlers_edit import handle_plan_approval

    dify = FakeEditDifyPort()

    def does_not_apply(*_a, **_k):
        raise ValueError("node not found: x")

    dify.apply_repair = does_not_apply
    env, repo = _new_env(dify=dify)
    s = _seed_edit_session(
        repo,
        PcState.EDIT_PLAN_APPROVAL,
        edit_rules={"risk_threshold": "high"},
        edit_target_node_ids=["llm"],
        checkpoint_id="cp-1",
    )
    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())

    res = handle_plan_approval(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.EDIT_PLAN_APPROVAL
    assert res.context.staged_repair == []
    error = next(i for i in res.items if i.kind == "error")
    assert error.payload["title"] == "Couldn't apply the workflow"
    assert error.payload["body"] == "The generated workflow couldn't be applied to the draft: node not found: x"
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert assistant.payload["execution"]["status"] == "error"
    assert assistant.payload["reply_text"] == (
        "I couldn't apply the change -- see the error above. "
        "Continue adjusting to change the rules, approve again, or discard the plan."
    )


def test_a_succeeded_affected_path_run_that_reached_no_end_is_not_a_pass():
    from core.dify_builder.handlers_edit import handle_test_affected_paths
    from core.dify_builder.models import NodeOutput, Run, TestInput

    dify = FakeEditDifyPort()
    dify.graph = {
        "nodes": [
            {"id": "node1", "data": {"type": "start", "title": "Start", "variables": []}},
            {
                "id": "node2",
                "data": {"type": "question-classifier", "title": "Route", "classes": [{"id": "1", "name": "A"}]},
            },
            {"id": "node6", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [
            {"source": "node1", "target": "node2"},
            {"source": "node2", "target": "node6", "sourceHandle": "billing"},
        ],
    }
    dify.run_draft = lambda *_a, **_k: Run(
        kind="verify",
        immutable=True,
        dify_run_id="run-e",
        status="succeeded",
        per_node=[NodeOutput(node_id="node1", status="succeeded"), NodeOutput(node_id="node2", status="succeeded")],
    )
    env, repo = _new_env(dify=dify)
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))

    res = handle_test_affected_paths(env, Turn(actor=_actor()), s, DifyBuilderContext(test_input_ref="ti-1"))

    assert res.next == PcState.EDIT_AWAIT_REPAIR
    assert res.context.staged_repair == []
    assert next(i for i in res.items if i.kind == "test_result").payload["subtitle"] == "Finished without output"
    assert next(i for i in res.items if i.kind == "error").payload["node_id"] == "node2"


def test_a_second_consecutive_unknown_outcome_stops_at_the_edit_gate():
    from core.dify_builder.handlers_edit import handle_test_affected_paths
    from core.dify_builder.models import Diagnosis, Run, TestInput
    from services.dify_builder.run_mapping import TRUNCATED_STREAM_ERROR

    env, repo = _new_env()
    env.dify.run_draft = lambda *_a, **_k: Run(
        kind="verify", immutable=True, status="running", per_node=[], error=TRUNCATED_STREAM_ERROR
    )
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    # A diagnosis + staged repair left over from an earlier failure: the gate
    # the cap lands on must not offer to apply a fix for a run it never saw.
    fc = DifyBuilderContext(
        test_input_ref="ti-1",
        diagnosis=Diagnosis(culprit_node_id="llm", root_cause="old failure"),
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "code", "value": ""})],
    )

    first = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)
    assert first.next == PcState.EDIT_APPLY_CHANGES
    second = handle_test_affected_paths(env, Turn(actor=_actor()), s, first.context)

    assert second.next == PcState.EDIT_AWAIT_REPAIR
    assert second.context.unknown_outcome_count == 2
    assert second.context.staged_repair == []
    assert second.context.diagnosis is None
    assert next(i for i in second.items if i.kind == "error").payload["title"] == "Test outcome unknown"


def test_the_same_failing_affected_path_test_trips_the_breaker_on_the_third_repeat():
    """Edit had no repair breaker at all: the same engine failure could be
    diagnosed, repaired and re-run indefinitely. It now shares Build's."""
    from core.dify_builder.handlers_edit import handle_test_affected_paths
    from core.dify_builder.handlers_fix import MAX_REPEATED_REPAIRS
    from core.dify_builder.models import TestInput

    dify = FakeEditDifyPort()
    dify.verify_pass = False  # the engine fails the same way every time
    env, repo = _new_env(dify=dify, agent=StubAgent())
    s = _session(entry_mode=EntryMode.EDIT, current_state=PcState.EDIT_TEST_AFFECTED_PATHS)
    repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    snapshots = []  # the handler mutates the SAME context object; snapshot per call
    result = None
    for _ in range(MAX_REPEATED_REPAIRS + 1):
        result = handle_test_affected_paths(env, Turn(actor=_actor()), s, fc)
        fc = result.context
        snapshots.append((fc.repair_attempts, len(fc.staged_repair)))

    assert snapshots == [(0, 1), (1, 1), (2, 0)]
    assert result.next == PcState.EDIT_AWAIT_REPAIR
    assert next(i for i in result.items if i.kind == "error").payload["title"] == "Repeated failure"


def test_sending_a_new_edit_goal_resets_the_breaker():
    from core.dify_builder.handlers_edit import handle_capability_check

    env, repo = _new_env()
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK, repair_attempts=3, last_repair_error="llm|boom")
    turn = Turn(
        action=Action(kind="send_edit_goal", payload={"text": "Make it faster"}, base_version=1), actor=_actor()
    )

    res = handle_capability_check(env, turn, *repo.get_session(s.id))

    assert res.context.repair_attempts == 0
    assert res.context.last_repair_error == ""


def test_plan_approval_threads_edit_targets_into_build_edit_intents():
    """The nodes impact analysis named reach the cognition.

    Without them ``build_edit_intents`` cannot show the model the config it is
    about to rewrite, and the model regenerates whole arrays from scratch --
    triage ``edit-branch-failure-2026-09-22`` cause (c).
    """
    from core.dify_builder.handlers_edit import handle_plan_approval

    seen: dict = {}

    class _RecordingAgent(PlaceholderAgent):
        def build_edit_intents(
            self,
            edit_rules,
            graph,
            *,
            edit_target_node_ids=(),
            last_edit_rejection=None,  # noqa: ARG002
        ):
            seen["targets"] = list(edit_target_node_ids)
            return super().build_edit_intents(edit_rules, graph)

    env, repo = _new_env(agent=_RecordingAgent())
    s = _seed_edit_session(
        repo,
        PcState.EDIT_PLAN_APPROVAL,
        edit_rules={"risk_threshold": "high"},
        edit_target_node_ids=["llm"],
        checkpoint_id="cp-1",
    )
    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())
    handle_plan_approval(env, turn, *repo.get_session(s.id))

    assert seen["targets"] == ["llm"]


# ---- a refused edit tells the next attempt what the engine said -------------
#
# Triage edit-branch-failure-2026-09-22, "Why every retry is blind": the gate
# re-reads an unchanged draft, so ``edit_rules`` and ``graph`` are byte-identical
# on every re-approval. The live user approved the same plan three times and got
# a byte-identical card each time because nothing recorded WHY the write was
# refused.

_PREFLIGHT_PREFIX = "the draft would not start: node 'node2' (if-else): 1 validation error for IfElseNodeData\n"
_KLINGON = (
    _PREFLIGHT_PREFIX + "cases.0.conditions.0.comparison_operator\n"
    "  Input should be 'is', '=', '≥' [type=literal_error, input_value='klingon', input_type=str]"
)
_MARTIAN = (
    _PREFLIGHT_PREFIX + "cases.0.conditions.0.comparison_operator\n"
    "  Input should be 'is', '=', '≥' [type=literal_error, input_value='martian', input_type=str]"
)


class _RejectionRecordingAgent(PlaceholderAgent):
    """Records the ``last_edit_rejection`` each ``build_edit_intents`` call got."""

    def __init__(self):
        self.rejections: list = []

    def build_edit_intents(self, edit_rules, graph, *, edit_target_node_ids=(), last_edit_rejection=None):
        self.rejections.append(last_edit_rejection)
        return super().build_edit_intents(edit_rules, graph, edit_target_node_ids=edit_target_node_ids)


def _refusing_port(*errors):
    """A ``FakeEditDifyPort`` whose ``apply_repair`` raises ``errors`` in turn."""
    dify = FakeEditDifyPort()
    remaining = list(errors)

    def refuse(*_a, **_k):
        raise remaining.pop(0)

    dify.apply_repair = refuse
    return dify


def _approve(env, session, fc):
    from core.dify_builder.handlers_edit import handle_plan_approval

    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())
    return handle_plan_approval(env, turn, session, fc)


def test_a_refused_edit_remembers_the_engines_own_reason():
    from core.dify_builder.errors import DraftWouldNotStartError

    env, repo = _new_env(dify=_refusing_port(DraftWouldNotStartError(_KLINGON)))
    s = _seed_edit_session(
        repo, PcState.EDIT_PLAN_APPROVAL, edit_rules={"risk_threshold": "high"}, edit_target_node_ids=["node2"]
    )

    res = _approve(env, *repo.get_session(s.id))

    assert res.context.staged_repair == []
    # verbatim, engine-sourced -- no summary, no model prose
    assert res.context.last_edit_rejection == _KLINGON


def test_an_edit_that_simply_did_not_apply_is_remembered_too():
    """A ``graph_ops`` refusal never reached the startability check, but it is
    just as blind on re-approval, so it is carried forward the same way."""
    env, repo = _new_env(dify=_refusing_port(ValueError("node not found: x")))
    s = _seed_edit_session(
        repo, PcState.EDIT_PLAN_APPROVAL, edit_rules={"risk_threshold": "high"}, edit_target_node_ids=["node2"]
    )

    res = _approve(env, *repo.get_session(s.id))

    assert res.context.last_edit_rejection == "node not found: x"


def test_the_next_approval_shows_the_agent_what_the_engine_said():
    agent = _RejectionRecordingAgent()
    env, repo = _new_env(dify=FakeEditDifyPort(), agent=agent)
    s = _seed_edit_session(
        repo,
        PcState.EDIT_PLAN_APPROVAL,
        edit_rules={"risk_threshold": "high"},
        edit_target_node_ids=["llm"],
        last_edit_rejection=_KLINGON,
    )

    _approve(env, *repo.get_session(s.id))

    assert agent.rejections == [_KLINGON]


def test_a_first_approval_passes_no_rejection_at_all():
    agent = _RejectionRecordingAgent()
    env, repo = _new_env(dify=FakeEditDifyPort(), agent=agent)
    s = _seed_edit_session(
        repo, PcState.EDIT_PLAN_APPROVAL, edit_rules={"risk_threshold": "high"}, edit_target_node_ids=["llm"]
    )

    _approve(env, *repo.get_session(s.id))

    assert agent.rejections == [None]  # "" would read as a refusal with no text


def test_a_second_refusal_at_the_same_location_replaces_the_first():
    """The case the dry run's own key cannot cover.

    ``preflight.new_preflight_problems`` is keyed on pydantic error LOCATIONS,
    so a second attempt that leaves the culprit invalid at the SAME location
    with a DIFFERENT bad value is not a new problem to it. The engine's text is
    the only record fine enough to tell the two apart, so it is stored
    unconditionally: attempt 2 is told about ``klingon``, attempt 3 about
    ``martian``. Were the store deduplicated or written only once, attempt 3
    would be re-prompted about a value it had already stopped writing.
    """
    from core.dify_builder.errors import DraftWouldNotStartError

    agent = _RejectionRecordingAgent()
    env, repo = _new_env(
        dify=_refusing_port(DraftWouldNotStartError(_KLINGON), DraftWouldNotStartError(_MARTIAN)), agent=agent
    )
    s = _seed_edit_session(
        repo, PcState.EDIT_PLAN_APPROVAL, edit_rules={"risk_threshold": "high"}, edit_target_node_ids=["node2"]
    )

    session, fc = repo.get_session(s.id)
    first = _approve(env, session, fc)
    second = _approve(env, session, first.context)

    assert agent.rejections == [None, _KLINGON]  # attempt 2 was told about klingon...
    assert second.context.last_edit_rejection == _MARTIAN  # ...and attempt 3 will hear about martian
    assert "klingon" not in second.context.last_edit_rejection


def test_an_applied_edit_forgets_the_engines_earlier_refusal():
    env, repo = _new_env(dify=FakeEditDifyPort())
    s = _seed_edit_session(
        repo,
        PcState.EDIT_PLAN_APPROVAL,
        edit_rules={"risk_threshold": "high"},
        edit_target_node_ids=["llm"],
        checkpoint_id="cp-1",
        last_edit_rejection=_KLINGON,
    )

    res = _approve(env, *repo.get_session(s.id))

    assert res.next == PcState.EDIT_APPLY_CHANGES
    assert res.context.last_edit_rejection == ""


def test_a_new_edit_goal_forgets_a_refusal_from_the_previous_one():
    from core.dify_builder.handlers_edit import edit_registry

    env, repo = _new_env()
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK, last_edit_rejection=_KLINGON)

    Runner(env, edit_registry()).advance(
        s.id,
        Turn(
            action=Action(kind="send_edit_goal", payload={"text": "Add a review gate"}, base_version=1),
            actor=_actor(),
        ),
    )

    _, fc = repo.get_session(s.id)
    assert fc.last_edit_rejection == ""


def test_a_recovery_reset_forgets_the_refusal_of_a_batch_that_is_gone():
    from core.dify_builder.recovery import _reset_working_fields

    fc = DifyBuilderContext(last_edit_rejection=_KLINGON)

    _reset_working_fields(fc)

    assert fc.last_edit_rejection == ""


def test_a_huge_refusal_is_capped_before_it_is_persisted_and_re_prompted():
    """A batch refusal concatenates one message per node, and this text is both
    stored in the session context blob and prepended to the next prompt."""
    from core.dify_builder.errors import DraftWouldNotStartError
    from core.dify_builder.handlers_edit import _MAX_REJECTION_CHARS, _REJECTION_TRUNCATED_MARKER

    env, repo = _new_env(dify=_refusing_port(DraftWouldNotStartError("x" * (_MAX_REJECTION_CHARS + 500))))
    s = _seed_edit_session(
        repo, PcState.EDIT_PLAN_APPROVAL, edit_rules={"risk_threshold": "high"}, edit_target_node_ids=["node2"]
    )

    res = _approve(env, *repo.get_session(s.id))

    assert res.context.last_edit_rejection == "x" * _MAX_REJECTION_CHARS + _REJECTION_TRUNCATED_MARKER


# -- Task 7: the plan gate is no longer a one-button dead end ------------------


def _gate_turn(kind: str) -> Turn:
    return Turn(action=Action(kind=kind, base_version=1), actor=_actor())


def test_a_refused_edit_can_be_adjusted_instead_of_only_re_approved():
    """The dead end this closes: a refused approval left the user at the gate
    with ``approve_plan`` as the only move, while the card told them to adjust
    (triage edit-branch-failure-2026-09-22)."""
    from core.dify_builder.errors import DraftWouldNotStartError
    from core.dify_builder.handlers_edit import handle_plan_approval

    env, repo = _new_env(dify=_refusing_port(DraftWouldNotStartError(_KLINGON)))
    s = _seed_edit_session(
        repo,
        PcState.EDIT_PLAN_APPROVAL,
        edit_rules={"risk_threshold": "high"},
        edit_target_node_ids=["node2"],
        form_fields=[{"key": "risk_threshold", "label": "Risk threshold", "type": "text"}],
    )
    session, fc = repo.get_session(s.id)
    refused = handle_plan_approval(env, _gate_turn("approve_repair"), session, fc)
    assert refused.next == PcState.EDIT_PLAN_APPROVAL
    assert refused.context.last_edit_rejection == _KLINGON

    res = handle_plan_approval(env, _gate_turn("re_fix"), session, refused.context)

    assert res.next == PcState.EDIT_IMPACT_ANALYSIS
    form = next(i for i in res.items if i.kind == "form")
    assert form.payload["variant"] == "edit_rules"
    assert form.payload["values"] == {"risk_threshold": "high"}  # repopulated, not blank
    assert [f["key"] for f in form.payload["fields"]] == ["risk_threshold"]
    assert form.payload["frozen"] is False  # editable, which is the whole point


def test_routing_back_to_the_form_does_not_forget_the_refusal():
    """Offering the form is not editing it: the user may change nothing and
    resubmit, and until they do, the engine's text still describes exactly what
    the next approval would try. Only handle_impact_analysis, which owns the
    mutation of fc.edit_rules, may clear it."""
    from core.dify_builder.handlers_edit import handle_plan_approval, handle_review

    env, repo = _new_env()
    at_gate = _seed_edit_session(
        repo,
        PcState.EDIT_PLAN_APPROVAL,
        edit_rules={"risk_threshold": "high"},
        edit_target_node_ids=["llm"],
        last_edit_rejection=_KLINGON,
    )
    at_review = _seed_edit_session(
        repo,
        PcState.EDIT_REVIEW,
        edit_rules={"risk_threshold": "high"},
        edit_target_node_ids=["llm"],
        last_edit_rejection=_KLINGON,
    )

    from_gate = handle_plan_approval(env, _gate_turn("re_fix"), *repo.get_session(at_gate.id))
    from_review = handle_review(env, _gate_turn("re_fix"), *repo.get_session(at_review.id))

    assert from_gate.next == PcState.EDIT_IMPACT_ANALYSIS
    assert from_gate.context.last_edit_rejection == _KLINGON
    assert from_review.next == PcState.EDIT_IMPACT_ANALYSIS
    assert from_review.context.last_edit_rejection == _KLINGON


def _refuse_once_then_apply(error):
    """A ``FakeEditDifyPort`` that refuses the first ``apply_repair`` and then
    behaves normally -- the shape of the loop these sequences live in."""
    dify = FakeEditDifyPort()
    real_apply = dify.apply_repair
    refused: list[bool] = []

    def apply(*args, **kwargs):
        if not refused:
            refused.append(True)
            raise error
        return real_apply(*args, **kwargs)

    dify.apply_repair = apply
    return dify


def _refused_at_the_gate(agent):
    """Drive a real Edit session to a refused approval parked at the gate."""
    from core.dify_builder.errors import DraftWouldNotStartError
    from core.dify_builder.handlers_edit import edit_registry

    env, repo = _new_env(dify=_refuse_once_then_apply(DraftWouldNotStartError(_KLINGON)), agent=agent)
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK)
    runner = Runner(env, edit_registry())
    out = runner.advance(
        s.id, Turn(action=Action(kind="send_edit_goal", payload={"text": "x"}, base_version=1), actor=_actor())
    )
    out = runner.advance(s.id, Turn(action=Action(kind="submit_edit_rules", base_version=out.version), actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_PLAN_APPROVAL  # refused, nothing written
    _s, fc = repo.get_session(s.id)
    assert fc.last_edit_rejection == _KLINGON
    return runner, repo, s, out


def _submit(runner, s, out, kind, payload=None):
    return runner.advance(
        s.id, Turn(action=Action(kind=kind, payload=payload or {}, base_version=out.version), actor=_actor())
    )


def test_a_gate_revert_keeps_the_refusal_its_retry_still_needs():
    """The ONE path that reaches edit.reverted carrying a refusal. A revert
    taken at the plan gate wrote nothing, so the restored draft IS the refused
    draft and the rules are unchanged -- and edit.reverted offers only Retry,
    which re-proposes the identical plan. Clearing here would guarantee the
    identical refusal and throw away the whole point of remembering it."""
    agent = _RejectionRecordingAgent()
    runner, repo, s, out = _refused_at_the_gate(agent)

    out = _submit(runner, s, out, "undo")
    assert out.current_state == PcState.EDIT_REVERTED
    out = _submit(runner, s, out, "re_fix")  # Retry, the only action offered there
    assert out.current_state == PcState.EDIT_PLAN_APPROVAL

    _s, fc = repo.get_session(s.id)
    assert fc.last_edit_rejection == _KLINGON

    _submit(runner, s, out, "approve_repair")
    assert agent.rejections == [None, _KLINGON]  # the retry was told what the engine said


def test_changing_the_rules_forgets_the_refusal_the_old_ones_earned():
    """The mirror case: once the rules the engine refused are gone, its
    complaint describes nothing the next approval will try."""
    agent = _RejectionRecordingAgent()
    runner, repo, s, out = _refused_at_the_gate(agent)

    out = _submit(runner, s, out, "re_fix")  # continue adjusting
    assert out.current_state == PcState.EDIT_IMPACT_ANALYSIS
    _s, fc = repo.get_session(s.id)
    assert fc.last_edit_rejection == _KLINGON  # routed to the form, rules untouched
    assert fc.edit_rules["risk_threshold"] == "medium"

    out = _submit(runner, s, out, "submit_edit_rules", {"risk_threshold": "critical"})

    assert out.current_state == PcState.EDIT_PLAN_APPROVAL
    _s, fc = repo.get_session(s.id)
    assert fc.edit_rules["risk_threshold"] == "critical"
    assert fc.last_edit_rejection == ""

    _submit(runner, s, out, "approve_repair")
    assert agent.rejections == [None, None]  # nothing stale quoted at the new rules


def test_resubmitting_the_very_same_rules_keeps_the_refusal():
    """Reaching the form and pressing submit without editing anything leaves
    the inputs byte-identical, so the refusal still describes them."""
    agent = _RejectionRecordingAgent()
    runner, repo, s, out = _refused_at_the_gate(agent)

    out = _submit(runner, s, out, "re_fix")
    out = _submit(runner, s, out, "submit_edit_rules", {"risk_threshold": "medium"})

    assert out.current_state == PcState.EDIT_PLAN_APPROVAL
    _s, fc = repo.get_session(s.id)
    assert fc.last_edit_rejection == _KLINGON


def test_the_plan_gate_reverts_through_the_checkpoint_it_already_minted():
    """No second revert path: the gate reuses perform_revert against the
    checkpoint handle_impact_analysis mints when it proposes the plan."""
    from core.dify_builder.handlers_edit import edit_registry

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_edit_session(repo, PcState.EDIT_CAPABILITY_CHECK)
    runner = Runner(env, edit_registry())

    out = runner.advance(
        s.id, Turn(action=Action(kind="send_edit_goal", payload={"text": "x"}, base_version=1), actor=_actor())
    )
    out = runner.advance(s.id, Turn(action=Action(kind="submit_edit_rules", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_PLAN_APPROVAL
    _s, fc = repo.get_session(s.id)
    assert fc.checkpoint_id  # the restore point the gate's Revert uses

    out = runner.advance(s.id, Turn(action=Action(kind="undo", base_version=out.version), actor=_actor()))

    assert out.current_state == PcState.EDIT_REVERTED
    _s, fc = repo.get_session(s.id)
    assert fc.checkpoint_id == ""  # consumed by perform_revert
    assert any(e["event"] == "revert_checkpoint" for e in events)
    # and edit.reverted's own Retry still leads back to the gate
    out = runner.advance(s.id, Turn(action=Action(kind="re_fix", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.EDIT_PLAN_APPROVAL
