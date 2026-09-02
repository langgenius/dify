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


def test_plan_approval_empty_build_surfaces_error_and_keeps_canvas():
    """If build_nodes yields no create_node intents (generation ultimately failed),
    the handler must NOT delete the placeholder start, must NOT claim a successful
    build, and must stay in plan_approval -- otherwise the canvas is emptied while
    the assistant reports 'Workflow built on the canvas.'"""
    from core.dify_builder.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.graph = {
        "nodes": [{"id": "start", "data": {"type": "start", "title": "Old", "variables": []}}],
        "edges": [],
    }
    env.agent.build_nodes = lambda _plan: []  # generation produced nothing
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])

    res = handle_plan_approval(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)

    assert res.next == PcState.BUILD_PLAN_APPROVAL  # retryable, NOT advanced to execution
    assert {n["id"] for n in env.dify.graph["nodes"]} == {"start"}  # placeholder kept; nothing deleted/added
    assert any(i.kind == "error" for i in res.items)  # honest error surfaced
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert assistant.payload["reply_text"] != "Workflow built on the canvas."  # no false success claim


def test_plan_approval_deletes_pre_existing_start_on_from_scratch_build():
    from core.dify_builder.handlers_build import handle_plan_approval
    from core.dify_builder.models import MutationIntent
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    # seed a draft that already has a start node with id "start"
    env.dify.graph = {
        "nodes": [{"id": "start", "data": {"type": "start", "title": "Old", "variables": []}}],
        "edges": [],
    }
    # generator returns a graph whose start id is "node1" (a document variable)
    env.agent.build_nodes = lambda _plan: [
        MutationIntent(
            op="create_node",
            args={
                "node_type": "start",
                "node_id": "node1",
                "config": {"title": "Start", "variables": [{"variable": "document", "type": "file"}]},
            },
        ),
        MutationIntent(op="create_node", args={"node_type": "end", "node_id": "node2", "config": {}}),
        MutationIntent(op="connect", args={"from_node": "node1", "to_node": "node2"}),
    ]
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])
    handle_plan_approval(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)
    ids = {n["id"] for n in env.dify.graph["nodes"]}
    types = {(n.get("data") or {}).get("type") for n in env.dify.graph["nodes"]}
    assert "start" not in ids
    assert "node1" in ids  # old start gone, generator's start kept
    assert types == {"start", "end"}  # exactly one start


def test_plan_approval_survives_generator_reusing_the_deleted_placeholder_start_id():
    """M2 fix (final review, Minor/latent): on a from-scratch build, delete_intents
    drops the draft's placeholder start(s) by id, and _already_present filters
    generator creates against the PRE-delete existing_node_ids. If the generator's
    create_node happens to reuse a just-deleted placeholder id, the old code path
    would see that id in existing_node_ids and drop the create -- delete with no
    re-create, so the node silently vanishes from the final graph. The deleted
    ids must be excluded from the _already_present comparison set."""
    from core.dify_builder.handlers_build import handle_plan_approval
    from core.dify_builder.models import MutationIntent
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    # seed a draft whose placeholder start id is "start"
    env.dify.graph = {
        "nodes": [{"id": "start", "data": {"type": "start", "title": "Old", "variables": []}}],
        "edges": [],
    }
    # generator reuses the SAME id ("start") for its own start node
    env.agent.build_nodes = lambda _plan: [
        MutationIntent(
            op="create_node",
            args={
                "node_type": "start",
                "node_id": "start",
                "config": {"title": "Start", "variables": [{"variable": "document", "type": "file"}]},
            },
        ),
        MutationIntent(op="create_node", args={"node_type": "end", "node_id": "node2", "config": {}}),
        MutationIntent(op="connect", args={"from_node": "start", "to_node": "node2"}),
    ]
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])
    handle_plan_approval(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)

    ids = {n["id"] for n in env.dify.graph["nodes"]}
    types = {(n.get("data") or {}).get("type") for n in env.dify.graph["nodes"]}
    assert "start" in ids, "the create_node reusing the deleted placeholder's id must survive"
    assert "node2" in ids
    assert types == {"start", "end"}  # exactly one start, no vanished node
    assert len(env.dify.graph["edges"]) == 1


def test_execution_run_test_advances_to_test_and_repair():
    from core.dify_builder.handlers_build import handle_execution

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    # test_input_ref already prepared -- run_test must skip the testdata gate.
    s = _seed_build_session(
        repo, PcState.BUILD_EXECUTION, built_node_ids=["start", "llm", "end"], test_input_ref="ti-1"
    )
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


def test_test_and_repair_pass_goes_to_review_with_real_run():
    from core.dify_builder.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    events: list[dict] = []
    env, _ = _new_env(emit_canvas=events.append)
    env.dify = FakeBuildDifyPort()  # verify_pass=True by default
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert result.next == PcState.BUILD_REVIEW
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


def test_test_and_repair_fail_routes_to_await_repair_with_staged_repair():
    from core.dify_builder.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    events: list[dict] = []
    env, _ = _new_env(agent=StubAgent(), emit_canvas=events.append)
    env.dify = FakeBuildDifyPort()
    env.dify.verify_pass = False
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert result.next == PcState.BUILD_AWAIT_REPAIR
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
    assert {"event": "mark_test_error"} in events


def test_test_and_repair_fail_with_no_proposed_repair_still_routes_to_gate():
    """When propose_repair finds no safe fix (empty intents), the fail path
    must still route to the gate, but WITHOUT a change_set card, and with the
    "no safe automatic fix" reply_text variant -- the `if intents` branch the
    handler takes to decide between the two card/reply-text shapes."""
    from core.dify_builder.handlers_build import handle_test_and_repair
    from core.dify_builder.models import Risk
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.verify_pass = False
    env.agent.propose_repair = lambda _diagnosis, _graph: (
        [],
        Risk(level="high", reason="no fix", has_external_side_effect=False),
    )
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.context.staged_repair == []
    kinds = [i.kind for i in result.items]
    assert "change_set" not in kinds
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["test_result", "error"]
    assert assistant.payload["reply_text"] == "Test failed — no safe automatic fix; edit or keep draft."


def test_test_and_repair_reuses_persisted_inputs_on_retest():
    from core.dify_builder.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"], test_input_ref="")
    handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    ref = fc.test_input_ref
    handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert fc.test_input_ref == ref  # reused, not regenerated


def test_test_and_repair_reuses_gate_prepared_input_ref():
    """When the testdata gate already prepared a TestInput (fc.test_input_ref
    set), handle_test_and_repair must read that ref straight from the repo --
    not derive a fresh mock inline. run_draft must see exactly those inputs."""
    from core.dify_builder.handlers_build import handle_test_and_repair
    from core.dify_builder.models import TestInput
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    ti = TestInput(session_id=s.id, source="upload", inputs={"document": "gate-prepared.pdf"})
    env.repo.save_test_input(ti)
    fc = DifyBuilderContext(built_node_ids=["llm"], test_input_ref=ti.id)

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.context.test_input_ref == ti.id  # the gate's ref, not a new one
    assert env.dify.run_draft_inputs == {"document": "gate-prepared.pdf"}


def test_test_and_repair_input_failure_routes_to_testdata_gate():
    """An INPUT-caused run failure (missing/invalid test data, per
    is_input_failure's signal match) must clear the stale input ref and route
    back to the testdata gate -- not the config-repair gate."""
    from core.dify_builder.handlers_build import handle_test_and_repair
    from core.dify_builder.models import TestInput
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.verify_pass = False
    env.dify.fail_error = "File variable not found for selector: ['start', 'document']"
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_TESTDATA
    assert result.context.test_input_ref == ""  # stale input cleared
    assert result.context.verify_run_id == ""
    kinds = [i.kind for i in result.items]
    assert "form" in kinds
    assert "change_set" not in kinds  # gate, not repair
    test_result = next(i for i in result.items if i.kind == "test_result")
    assert test_result.payload["tone"] == "error"
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["stage_id"] == "build.await_testdata"


def test_test_and_repair_config_failure_still_routes_to_repair_gate():
    """A config-caused run failure (the fake's default error, which matches no
    input-failure signal) must still route to the config-repair gate,
    unchanged."""
    from core.dify_builder.handlers_build import handle_test_and_repair
    from core.dify_builder.models import TestInput
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, _ = _new_env(agent=StubAgent())
    env.dify = FakeBuildDifyPort()
    env.dify.verify_pass = False  # default error "boom" -> config, not input
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.context.staged_repair  # StubAgent proposes a repair
    assert result.context.test_input_ref == "ti-1"  # untouched on the config path


def test_test_and_repair_run_draft_raises_routes_to_await_repair_failed():
    """run_draft raising must not crash the advance -- the try/except degrade
    path converts the exception into a failed run and still routes to the
    build.await_repair gate."""
    from core.dify_builder.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.run_draft = lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom"))
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.run is not None
    assert result.run.status == "failed"


def test_await_repair_approve_applies_and_retests():
    from core.dify_builder.handlers_build import handle_await_repair
    from core.dify_builder.models import MutationIntent
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.graph = {"nodes": [{"id": "llm", "data": {}}], "edges": []}  # target node must pre-exist
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_AWAIT_REPAIR)
    fc = DifyBuilderContext(
        staged_repair=[
            MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "prompt_template", "value": []})
        ],
        test_input_ref="ti-1",
    )
    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)
    assert result.next == PcState.BUILD_TEST_AND_REPAIR
    assert env.dify.applied  # the staged repair was applied
    assert result.context.staged_repair == []  # cleared after apply


def test_await_repair_keep_draft_goes_to_review():
    from core.dify_builder.handlers_build import handle_await_repair

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_AWAIT_REPAIR)
    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="keep_draft")), s, DifyBuilderContext())
    assert result.next == PcState.BUILD_REVIEW


def test_await_repair_undo_reverts():
    from core.dify_builder.handlers_build import handle_await_repair

    events: list[dict] = []
    env, repo = _new_env(emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_AWAIT_REPAIR, built_node_ids=["start", "llm", "end"])
    turn = Turn(action=Action(kind="undo", base_version=1), actor=_actor())
    res = handle_await_repair(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_REVERTED
    assert any(i.kind == "decision" for i in res.items)
    assert {"event": "revert_checkpoint"} in events


def test_await_repair_ignores_unknown_action():
    from core.dify_builder.handlers_build import handle_await_repair

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_AWAIT_REPAIR, built_node_ids=["llm"])
    turn = Turn(action=Action(kind="message", base_version=1), actor=_actor())
    res = handle_await_repair(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_AWAIT_REPAIR


def test_build_await_repair_is_waiting_and_projected():
    from core.dify_builder.state import PcState, is_waiting
    from services.dify_builder.service import Phase, _actions_for, _phase_for

    assert is_waiting(PcState.BUILD_AWAIT_REPAIR)
    assert _phase_for(PcState.BUILD_AWAIT_REPAIR) == Phase.TEST
    assert [a.id for a in _actions_for(PcState.BUILD_AWAIT_REPAIR)]  # non-empty buttons


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


def test_re_fix_branches_clear_stale_test_input_ref_and_verify_run_id():
    """Both re-plan/revert escape paths (review's continue_adjusting and
    reverted's retry_after_revert) must clear fc.test_input_ref and
    fc.verify_run_id -- otherwise the retest after a rebuild reuses the
    FIRST build's stale mock inputs instead of regenerating fresh
    schema-shaped ones."""
    from core.dify_builder.handlers_build import handle_reverted, handle_review

    env, repo = _new_env()
    s = _seed_build_session(
        repo,
        PcState.BUILD_REVIEW,
        requirements={"currency": "USD"},
        built_node_ids=["start"],
        test_input_ref="ti-old",
        verify_run_id="run-old",
    )
    turn = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res = handle_review(env, turn, *repo.get_session(s.id))
    assert res.context.test_input_ref == ""
    assert res.context.verify_run_id == ""

    env2, repo2 = _new_env()
    s2 = _seed_build_session(
        repo2,
        PcState.BUILD_REVERTED,
        requirements={"currency": "USD"},
        test_input_ref="ti-old",
        verify_run_id="run-old",
    )
    turn2 = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res2 = handle_reverted(env2, turn2, *repo2.get_session(s2.id))
    assert res2.context.test_input_ref == ""
    assert res2.context.verify_run_id == ""


def test_build_registry_covers_all_non_terminal_build_states():
    from core.dify_builder.handlers_build import build_registry

    assert set(build_registry().keys()) == {
        PcState.BUILD_CAPABILITY_CHECK,
        PcState.BUILD_GOAL_ANALYSIS,
        PcState.BUILD_INITIAL_PLAN,
        PcState.BUILD_RESOURCE_RECOMMENDATION,
        PcState.BUILD_PLAN_APPROVAL,
        PcState.BUILD_EXECUTION,
        PcState.BUILD_AWAIT_TESTDATA,
        PcState.BUILD_TEST_AND_REPAIR,
        PcState.BUILD_AWAIT_REPAIR,
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

    # 6) run_test -> build.await_testdata (gate; no test input prepared yet)
    out = runner.advance(s.id, Turn(action=Action(kind="run_test", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_AWAIT_TESTDATA

    # 6b) provide_testdata (mock) -> build.test_and_repair (working, auto) -> rest at build.review
    testdata_action = Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version)
    out = runner.advance(s.id, Turn(action=testdata_action, actor=_actor()))
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
    # No "error" kind here: the live test_and_repair run passes (FakeBuildDifyPort
    # defaults verify_pass=True), so no diagnosis/error card is ever staged.
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
    assert out.current_state == PcState.BUILD_AWAIT_TESTDATA
    testdata_action = Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version)
    out = runner.advance(s.id, Turn(action=testdata_action, actor=_actor()))
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
    assert out.current_state == PcState.BUILD_AWAIT_TESTDATA
    testdata_action = Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version)
    out = runner.advance(s.id, Turn(action=testdata_action, actor=_actor()))
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


def test_run_test_routes_to_testdata_gate_when_no_input():
    from core.dify_builder.handlers_build import handle_execution
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.graph = {
        "nodes": [
            {
                "id": "start",
                "data": {"type": "start", "variables": [{"variable": "document", "type": "file"}]},
            }
        ],
        "edges": [],
    }
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_EXECUTION)
    fc = DifyBuilderContext(test_input_ref="")
    result = handle_execution(env, Turn(actor=_actor(), action=Action(kind="run_test")), s, fc)
    assert result.next == PcState.BUILD_AWAIT_TESTDATA
    form = next(i for i in result.items if i.kind == "form")
    assert form.payload["variant"] == "testdata"
    assert form.payload["fields"][0]["type"] == "file"


def test_run_test_skips_gate_when_input_prepared():
    from core.dify_builder.handlers_build import handle_execution
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_EXECUTION)
    result = handle_execution(
        env, Turn(actor=_actor(), action=Action(kind="run_test")), s, DifyBuilderContext(test_input_ref="ti-1")
    )
    assert result.next == PcState.BUILD_TEST_AND_REPAIR


def test_await_testdata_mock_prepares_input_and_advances():
    from core.dify_builder.handlers_build import handle_await_testdata
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.agent.generate_mock_inputs = lambda _schema, _prior: {"topic": "hi"}
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_AWAIT_TESTDATA)
    fc = DifyBuilderContext()
    result = handle_await_testdata(
        env, Turn(actor=_actor(), action=Action(kind="provide_testdata", payload={"mode": "mock"})), s, fc
    )
    assert result.next == PcState.BUILD_TEST_AND_REPAIR
    assert result.context.test_input_ref  # persisted
    assert env.repo.get_test_input(result.context.test_input_ref).inputs == {"topic": "hi"}


def test_await_testdata_provided_inputs_used():
    from core.dify_builder.handlers_build import handle_await_testdata
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_AWAIT_TESTDATA)
    fc = DifyBuilderContext()
    result = handle_await_testdata(
        env,
        Turn(
            actor=_actor(),
            action=Action(kind="provide_testdata", payload={"inputs": {"document": {"upload_file_id": "f-1"}}}),
        ),
        s,
        fc,
    )
    assert env.repo.get_test_input(result.context.test_input_ref).inputs == {"document": {"upload_file_id": "f-1"}}


def test_build_await_testdata_is_waiting_and_projected():
    from core.dify_builder.state import PcState, is_waiting
    from services.dify_builder.service import Phase, _actions_for, _phase_for

    assert is_waiting(PcState.BUILD_AWAIT_TESTDATA)
    assert _phase_for(PcState.BUILD_AWAIT_TESTDATA) == Phase.TEST
    assert [a.id for a in _actions_for(PcState.BUILD_AWAIT_TESTDATA)] == ["provide_testdata"]


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
