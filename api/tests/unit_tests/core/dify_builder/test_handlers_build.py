"""Tests for the Build-flow handlers + build_registry() (Slice 2)."""

from datetime import datetime

from core.dify_builder.models import (
    Action,
    Actor,
    BuildNodesResult,
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


def test_a_session_carrying_a_goal_needs_no_send_action():
    """Task 4: the capability_check gate is on the GOAL, not the action. A
    session whose composer already carried the goal in (fc.goal_text set at
    creation) proceeds on ANY turn, even one with no action at all -- only a
    goal-less (create-from-blank) session still needs send_goal."""
    from core.dify_builder.handlers_build import handle_capability_check

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_CAPABILITY_CHECK)
    fc = DifyBuilderContext(goal_text="Build a quarterly report workflow")

    result = handle_capability_check(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_GOAL_ANALYSIS
    assert result.context.goal_text == "Build a quarterly report workflow"


def test_a_goal_less_session_still_waits_for_one():
    """A create-from-blank session (no goal yet) is unaffected: with no
    action and no goal_text, it must keep waiting at capability_check."""
    from core.dify_builder.handlers_build import handle_capability_check

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_CAPABILITY_CHECK)
    fc = DifyBuilderContext(goal_text="")

    result = handle_capability_check(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_CAPABILITY_CHECK


def test_submitting_requirements_goes_straight_to_resources():
    """The decision-free find_resources gate at build.initial_plan is gone --
    submit_requirements now tail-calls the shared discovery helper directly,
    so the resource card arrives in the SAME step and no plan card is shown
    (the plan is still computed internally; it just isn't displayed until
    build.resource_recommendation confirms it, per task 3's renumbering)."""
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
    res = handle_goal_analysis(env, turn, repo.get_session(s.id)[0], repo.get_session(s.id)[1])

    assert res.next == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert res.context.requirements["currency"] == "EUR"  # payload overrides
    assert res.context.requirements["audience"] == "board"  # new listed key merged
    assert res.context.requirements["metrics"] == "revenue"  # untouched key survives (not blind-overwrite)
    assert "junk" not in res.context.requirements  # non-listed key excluded
    assert res.context.plan_version_tag == "v1"
    assert res.context.plan_items  # the plan is still drafted internally
    kinds = [i.kind for i in res.items]
    assert "decision" in kinds
    assert "resource_select" in kinds
    assert "assistant_turn" in kinds
    assert "plan" not in kinds  # no plan card is shown a second time


def test_submitting_requirements_progress_is_one_operation_with_monotonic_revisions():
    """Regression: handle_goal_analysis used to build its own ProgressReporter
    (build-review-requirements/build-draft-plan), finish() it, then
    tail-call _discover_and_offer_resources, which built a SECOND reporter
    under the SAME env.operation_id -- restarting `revision` at 1.
    ProgressEventData's docstring (contract.py) requires revision to be
    monotonic within an operation_id, and every other handler in this file
    uses exactly one ProgressReporter per step. The straight-through path
    (requirements submitted) must emit ONE operation_id with strictly
    increasing revisions across all four progress steps (review-requirements,
    draft-plan, discover-resources, prepare-resource-options)."""
    from core.dify_builder.handlers_build import build_registry

    events: list = []
    env, repo = _new_env()
    env.emit_progress = events.append
    s = _seed_build_session(
        repo,
        PcState.BUILD_GOAL_ANALYSIS,
        requirements={"currency": "USD"},
        form_fields=[{"key": "currency", "label": "Currency", "type": "text"}],
    )
    runner = Runner(env, build_registry())
    turn = Turn(action=Action(kind="submit_requirements", payload={"currency": "USD"}, base_version=1), actor=_actor())
    runner.advance(s.id, turn)

    assert events, "expected progress events to be emitted"
    operation_ids = {e.operation_id for e in events}
    assert len(operation_ids) == 1, f"expected a single operation_id across the whole step, got {operation_ids}"
    revisions = [e.revision for e in events]
    assert revisions == sorted(revisions), f"revision must be non-decreasing, got {revisions}"
    assert len(revisions) == len(set(revisions)), f"revision must not repeat, got {revisions}"
    # all four progress steps actually fired (review, draft, discover, prepare)
    activity_ids = {a.id for e in events for a in e.execution.activities}
    assert {
        "build-review-requirements",
        "build-draft-plan",
        "build-discover-resources",
        "build-prepare-resource-options",
    } <= activity_ids


def test_continue_adjusting_still_reaches_resource_discovery():
    """handle_initial_plan is now reachable only via the continue_adjusting/
    retry_after_revert loop-back (build.initial_plan has no straight-through
    entry and no projected UI action -- see test_initial_plan_state_offers_no_
    actions in test_service.py). It is a working/pass-through state (state.py)
    now, not a waiting one, so the runner drives it unconditionally with the
    action already consumed -- NO find_resources action is sent or required;
    a bare actor-only turn must still reach the resource card via the shared
    discovery helper. (The end-to-end regression that this genuinely unwedges
    the continue_adjusting loop-back through the Runner is
    test_continue_adjusting_reaches_resources_without_find_resources_action.)"""
    from core.dify_builder.handlers_build import handle_initial_plan

    env, repo = _new_env()
    s = _seed_build_session(
        repo,
        PcState.BUILD_INITIAL_PLAN,
        plan_items=["Retrieve", "Summarize"],
        plan_version_tag="v1",
    )
    turn = Turn(actor=_actor())  # no action -- the runner consumes it before driving a pass-through state
    res = handle_initial_plan(env, turn, repo.get_session(s.id)[0], repo.get_session(s.id)[1])

    assert res.next == PcState.BUILD_RESOURCE_RECOMMENDATION
    rs = next(i for i in res.items if i.kind == "resource_select")
    assert rs.payload["recommended"][0]["readiness"] == "ready"
    assert "conflict_policy_options" not in rs.payload


def test_continue_adjusting_reaches_resources_without_find_resources_action():
    """End-to-end regression for the fix that made build.initial_plan a
    working/pass-through state (state.py) instead of a waiting one: before
    that fix, continue_adjusting landed a session on build.initial_plan with
    NO projected UI action (task 2) AND a handler that still gated on
    find_resources (task 2's original state) -- a dead end the loop-back
    could never escape. Drive the Runner from build.review with ONLY
    continue_adjusting (resolved to re_fix); it must fall straight through
    build.initial_plan's unconditional discovery, in the SAME advance() call,
    and settle at build.resource_recommendation with a resource_select card
    -- no find_resources action is ever sent."""
    from core.dify_builder.handlers_build import build_registry

    env, repo = _new_env()
    s = _seed_build_session(
        repo,
        PcState.BUILD_REVIEW,
        requirements={"currency": "USD"},
        built_node_ids=["start", "llm", "end"],
    )
    runner = Runner(env, build_registry())

    re_fix_turn = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    out = runner.advance(s.id, re_fix_turn)

    # Settled straight at the resource gate -- never stopped at (or needed an
    # action to leave) build.initial_plan.
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    kinds = [i.kind for i in repo.list_conversation(s.id)]
    assert "resource_select" in kinds


def test_resource_recommendation_confirm_creates_checkpoint_and_plan_v1():
    from core.dify_builder.handlers_build import handle_resource_recommendation
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(
        repo, PcState.BUILD_RESOURCE_RECOMMENDATION, plan_items=["Retrieve", "Summarize"], plan_version_tag="v1"
    )
    turn = Turn(
        action=Action(
            kind="confirm_resources",
            payload={"resource_ids": ["kb-company"]},
            base_version=1,
        ),
        actor=_actor(),
    )
    res = handle_resource_recommendation(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.BUILD_PLAN_APPROVAL
    # Task 3: the only plan card a build emits is now v1 -- the duplicate
    # "v2" card that used to redisplay the same plan under a second version
    # number is gone (collapsed into task 2's straight-through path).
    assert res.context.plan_version_tag == "v1"
    assert res.context.resource_selection == {"resource_ids": ["kb-company"]}
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
        repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve", "Summarize"], plan_version_tag="v1"
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
    assert len(assistant.payload["execution"]["activities"]) == 3


def test_plan_approval_ignores_non_approve_action():
    from core.dify_builder.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve"], plan_version_tag="v1")
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
    # generation produced nothing, WITH a specific reason (the real generator returns
    # e.g. "UNRESOLVED_REFERENCE: ..." / a provider error). The error card must carry it.
    env.agent.build_nodes = lambda _plan, _rids=None: BuildNodesResult(
        intents=[], error="UNRESOLVED_REFERENCE: Reference {#node4.x#} not declared"
    )
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])

    res = handle_plan_approval(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)

    assert res.next == PcState.BUILD_PLAN_APPROVAL  # retryable, NOT advanced to execution
    assert {n["id"] for n in env.dify.graph["nodes"]} == {"start"}  # placeholder kept; nothing deleted/added
    error = next(i for i in res.items if i.kind == "error")  # honest error surfaced
    assert "UNRESOLVED_REFERENCE" in error.payload["body"]  # the SPECIFIC reason, not a generic fallback
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert assistant.payload["reply_text"] != "Workflow built on the canvas."  # no false success claim


def test_plan_approval_error_card_carries_diagnostics_into_the_item_payload():
    """Pod logs vanish on restart, so the generator's structured diagnostics must
    ride in the ErrorCard's item payload -- that payload is what the streamed
    conversation item (and therefore the exported debug log) preserves."""
    from core.dify_builder.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.graph = {
        "nodes": [{"id": "start", "data": {"type": "start", "title": "Old", "variables": []}}],
        "edges": [],
    }
    diag = [
        {
            "at": "2026-09-17T20:22:45.123456+00:00",
            "source": "workflow-generator",
            "attempt": 1,
            "message": "Reference {#node2.response#} not declared on node 'node2'",
            "codes": ["UNRESOLVED_REFERENCE"],
            "errors": [{"code": "UNRESOLVED_REFERENCE", "detail": "...", "node_id": "node2"}],
        }
    ]
    env.agent.build_nodes = lambda _plan, _rids=None: BuildNodesResult(
        intents=[], error="Reference {#node2.response#} not declared on node 'node2'", diagnostics=diag
    )
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])

    res = handle_plan_approval(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)

    error = next(i for i in res.items if i.kind == "error")
    payload_diag = error.payload["diagnostics"]
    assert payload_diag == diag  # verbatim: server timestamp, codes and node ids all survive
    assert payload_diag[0]["errors"][0]["node_id"] == "node2"  # the offending node is identifiable
    assert payload_diag[0]["at"].endswith("+00:00")  # UTC, so pod logs can be searched around it


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
    env.agent.build_nodes = lambda _plan, _rids=None: BuildNodesResult(
        intents=[
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
    )
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
    env.agent.build_nodes = lambda _plan, _rids=None: BuildNodesResult(
        intents=[
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
    )
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


def test_a_passing_test_shows_what_the_workflow_produced():
    """A passing test's card carries what the run actually produced, not just
    a bare "All checks passed" -- and it must show it even though
    FakeDifyPort's per-node status spelling ("success") differs from the
    Run-level one ("succeeded"): status-agnostic, per the terminal-output
    helper's contract."""
    from core.dify_builder.handlers_build import handle_test_and_repair

    env, _ = _new_env()  # default FakeDifyPort; verify_pass=True by default
    env.dify.run_outputs = {"result": "42"}
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert result.next == PcState.BUILD_REVIEW
    test_result = next(i for i in result.items if i.kind == "test_result")
    assert '"result": "42"' in test_result.payload["output"]


def test_a_passing_test_caps_an_oversized_output_with_a_marker():
    """Node outputs are only truncated upstream at ~100,000 chars per string,
    so an uncapped render (e.g. a report-generating workflow, the Builder's
    showcase case) could push hundreds of KB of JSON into the card, the SSE
    frame, and the localizer walk on every successful build. The card must
    cap the rendered output instead, with a visible truncation marker."""
    from core.dify_builder.handlers_build import _MAX_TERMINAL_OUTPUT_CHARS, handle_test_and_repair

    env, _ = _new_env()  # default FakeDifyPort; verify_pass=True by default
    env.dify.run_outputs = {"report": "x" * 50_000}  # far beyond the cap once JSON-rendered
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    test_result = next(i for i in result.items if i.kind == "test_result")
    output = test_result.payload["output"]
    assert len(output) < _MAX_TERMINAL_OUTPUT_CHARS + 100  # capped, not the ~50KB payload
    assert "truncated" in output


def test_a_passing_test_with_no_output_shows_none():
    """No output produced -> the card's output is "", not a stale/placeholder
    value -- a passing test that shows nothing is not evidence of anything,
    but it also mustn't lie about what ran."""
    from core.dify_builder.handlers_build import handle_test_and_repair

    env, _ = _new_env()  # run_outputs defaults to {}
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    test_result = next(i for i in result.items if i.kind == "test_result")
    assert test_result.payload["output"] == ""


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
    # The canvas event carries the Dify run id so a client can open the
    # failed run on the graph, not just colour the node red.
    assert {"event": "mark_test_error", "dify_run_id": "build-run-1"} in events


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
    assert assistant.payload["stage_id"] == "build.test_and_repair"


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


def test_test_and_repair_model_config_failure_surfaces_without_repair():
    """A model-config failure (the workflow references a model that isn't
    configured/available) must be surfaced -- NOT sent through diagnose+repair,
    which would thrash proposing node-structure changes. No repair is staged."""
    from core.dify_builder.handlers_build import handle_test_and_repair
    from core.dify_builder.models import TestInput
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, _ = _new_env(agent=StubAgent())  # StubAgent WOULD propose a repair if diagnose ran
    env.dify = FakeBuildDifyPort()
    env.dify.verify_pass = False
    env.dify.fail_error = "Model gpt-5.6 does not exist."  # model-config error, not a logic bug
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.context.staged_repair == []  # NO node-mutation repair proposed (no thrashing)
    kinds = [i.kind for i in result.items]
    assert "change_set" not in kinds  # no repair change-set offered
    error = next(i for i in result.items if i.kind == "error")
    assert "model" in error.payload["body"].lower()  # diagnosis names the model-config issue


def test_test_and_repair_running_status_is_not_treated_as_failure():
    """A truncated-stream run (status="running" -- the outcome is genuinely
    unknown, per Run.status's third value) must NOT be diagnosed or repaired:
    it returns to build.execution (re-runnable) with a neutral notice
    instead of the failure path."""
    from core.dify_builder.handlers_build import handle_test_and_repair
    from core.dify_builder.models import Run
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    diagnose_calls: list[object] = []
    agent = StubAgent()
    agent.diagnose = lambda *a, **kw: diagnose_calls.append((a, kw))
    env, _ = _new_env(agent=agent)
    env.dify = FakeBuildDifyPort()
    env.dify.run_draft = lambda *_a, **_k: Run(
        dify_run_id="",
        status="running",
        per_node=[],
        error="the workflow run's progress stream ended before the run did, so its outcome is unknown",
    )
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_EXECUTION
    assert result.run is not None
    assert result.run.status == "running"
    assert not diagnose_calls  # diagnose must NOT be called for an unknown outcome
    assert result.context.staged_repair == []
    assert result.context.diagnosis is None
    kinds = [i.kind for i in result.items]
    assert "notice" in kinds
    assert "test_result" not in kinds  # not labeled pass/fail
    assert "error" not in kinds
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["notice"]


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


def test_test_and_repair_run_draft_raises_captures_error_on_run():
    """Regression: a launch-time exception must be captured on run.error
    (logged + stored), not silently discarded into a blank failed stub. A
    non-input error still routes to the config-repair gate."""
    from core.dify_builder.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.run_draft = lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("kaboom-provider"))
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.run is not None
    assert "kaboom-provider" in (result.run.error or "")


def test_test_and_repair_run_draft_raises_input_error_routes_to_testdata_gate():
    """A launch-time exception whose message is an input-validation error
    (stale test inputs no longer match the current start node) must route back
    to the testdata gate -- not the blind config-repair loop -- and the real
    error must be captured on the run."""
    from core.dify_builder.handlers_build import handle_test_and_repair
    from core.dify_builder.models import TestInput
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.run_draft = lambda *_a, **_k: (_ for _ in ()).throw(ValueError("query is required in input form"))
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(built_node_ids=["llm"], test_input_ref="ti-1")

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_TESTDATA
    assert result.context.test_input_ref == ""  # stale input cleared
    assert result.run is not None
    assert "in input form" in (result.run.error or "")


def test_await_repair_approve_applies_and_waits_for_retest():
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
    assert result.next == PcState.BUILD_EXECUTION
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
    """The plan is drafted (fc.plan_items/plan_version_tag) but NOT shown as
    a card here: build.initial_plan (next) falls straight through to
    build.resource_recommendation, which shows the ONE plan card for this
    pass (v1, resources bound). Showing it here too would be the same
    duplicate-card task 2 already removed from the straight-through path."""
    from core.dify_builder.handlers_build import handle_review

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_REVIEW, requirements={"currency": "USD"}, built_node_ids=["start"])
    re_fix_turn = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res = handle_review(env, re_fix_turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_INITIAL_PLAN
    assert res.context.plan_version_tag == "v1"
    assert res.context.plan_items  # drafted internally
    assert not any(i.kind == "plan" for i in res.items)  # not shown yet
    assert any(i.kind == "decision" for i in res.items)


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
    """Same duplicate-card removal as handle_review's re_fix branch: the plan
    is drafted but not shown here -- build.initial_plan (next) falls
    straight through to build.resource_recommendation, which shows the ONE
    plan card for this pass."""
    from core.dify_builder.handlers_build import handle_reverted

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_REVERTED, requirements={"currency": "USD"})
    res = handle_reverted(
        env, Turn(action=Action(kind="re_fix", base_version=1), actor=_actor()), *repo.get_session(s.id)
    )
    assert res.next == PcState.BUILD_INITIAL_PLAN
    assert res.context.plan_version_tag == "v1"
    assert res.context.plan_items  # drafted internally
    assert not any(i.kind == "plan" for i in res.items)  # not shown yet


def test_re_fix_branches_clear_stale_test_input_ref_and_verify_run_id():
    """Both re-plan/revert escape paths (review's continue_adjusting and
    reverted's retry_after_revert) must clear fc.test_input_ref and
    fc.verify_run_id -- otherwise the retest after a rebuild reuses the
    FIRST build's stale mock inputs instead of regenerating fresh
    schema-shaped ones. The repair-loop counters go with them: a re-planned
    build must not inherit the previous one's repeat count."""
    from core.dify_builder.handlers_build import handle_reverted, handle_review

    env, repo = _new_env()
    s = _seed_build_session(
        repo,
        PcState.BUILD_REVIEW,
        requirements={"currency": "USD"},
        built_node_ids=["start"],
        test_input_ref="ti-old",
        verify_run_id="run-old",
        repair_attempts=4,
        last_repair_error="boom",
    )
    turn = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res = handle_review(env, turn, *repo.get_session(s.id))
    assert res.context.test_input_ref == ""
    assert res.context.verify_run_id == ""
    assert res.context.repair_attempts == 0
    assert res.context.last_repair_error == ""

    env2, repo2 = _new_env()
    s2 = _seed_build_session(
        repo2,
        PcState.BUILD_REVERTED,
        requirements={"currency": "USD"},
        test_input_ref="ti-old",
        verify_run_id="run-old",
        repair_attempts=4,
        last_repair_error="boom",
    )
    turn2 = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res2 = handle_reverted(env2, turn2, *repo2.get_session(s2.id))
    assert res2.context.test_input_ref == ""
    assert res2.context.verify_run_id == ""
    assert res2.context.repair_attempts == 0
    assert res2.context.last_repair_error == ""


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

    # 2) submit_requirements -> build.resource_recommendation directly (the
    # decision-free find_resources gate at build.initial_plan is gone --
    # handle_goal_analysis tail-calls the shared discovery helper itself)
    reqs_action = Action(kind="submit_requirements", payload={"currency": "USD"}, base_version=out.version)
    out = runner.advance(s.id, Turn(action=reqs_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION

    # 3) confirm_resources -> build.plan_approval
    confirm_payload = {"resource_ids": ["kb-company"]}
    confirm_action = Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version)
    out = runner.advance(s.id, Turn(action=confirm_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_PLAN_APPROVAL

    # 4) approve_plan (-> approve_repair) -> THE BUILD -> build.execution
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_EXECUTION
    # the graph was actually built.
    graph, _hash = dify.read_graph("app", _actor())
    assert len(graph["nodes"]) == 4
    assert len(graph["edges"]) == 3

    # 5) run_test -> the testdata form arrives PRE-FILLED with mock values and
    # rests at build.await_testdata, so the user can see and edit what will be
    # tested. Submitting it (one click, nothing to type) -> build.test_and_repair
    # (working, auto) -> rests at build.review.
    out = runner.advance(s.id, Turn(action=Action(kind="run_test", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_AWAIT_TESTDATA
    out = runner.advance(
        s.id,
        Turn(
            action=Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version),
            actor=_actor(),
        ),
    )
    assert out.current_state == PcState.BUILD_REVIEW

    # 6) publish_workflow -> build.publish (auto) -> governance_feedback (auto)
    # -> rests at build.await_learning (default policy "ask")
    publish_action = Action(kind="publish_workflow", base_version=out.version)
    out = runner.advance(s.id, Turn(action=publish_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_AWAIT_LEARNING
    assert dify.published is True

    # 7) skip_learning -> build.complete
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


def test_full_build_flow_file_schema_routes_through_testdata_gate_via_fsm():
    """End-to-end FSM coverage for the OTHER branch of handle_execution's
    conditional gate (needs_upload_inputs): a built graph whose Start node
    declares a file variable must still stop at BUILD_AWAIT_TESTDATA with a
    testdata form shown, and a real provide_testdata action submitted
    through the Runner (not a direct handler call) must be what unsticks
    it. test_full_build_flow_goal_to_complete is the complementary case --
    its generated graph declares no file variable, so run_test there
    bypasses the gate and lands straight at build.review; together the two
    tests exercise both branches of the conditional through the real state
    machine, not via disconnected direct-handler-call fragments."""
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
    confirm_payload = {"resource_ids": ["kb-company"]}
    confirm_action = Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version)
    out = runner.advance(s.id, Turn(action=confirm_action, actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_EXECUTION

    # Give THIS test's built graph a file-declaring Start node -- mutating
    # the fake's already-built graph directly, not the shared default
    # config the other full-flow tests rely on.
    start_node = next(n for n in dify.graph["nodes"] if n.get("data", {}).get("type") == "start")
    start_node["data"]["variables"] = [{"variable": "doc", "type": "file"}]

    # run_test -> the file variable can't be mocked -> build.await_testdata,
    # with a testdata form card actually emitted.
    out = runner.advance(s.id, Turn(action=Action(kind="run_test", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_AWAIT_TESTDATA
    items = repo.list_conversation(s.id)
    form_cards = [i for i in items if i.kind == "form" and i.payload.get("variant") == "testdata"]
    assert form_cards
    assert form_cards[-1].payload["fields"][0]["type"] == "file"

    # provide_testdata, submitted through the real Runner -> unsticks the
    # gate and the run proceeds to build.review.
    testdata_action = Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version)
    out = runner.advance(s.id, Turn(action=testdata_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_REVIEW


def test_full_build_flow_keep_draft_reaches_complete_without_publish():
    from core.dify_builder.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    goal_action = Action(kind="send_goal", payload={"text": "Build it"}, base_version=1)
    out = runner.advance(s.id, Turn(action=goal_action, actor=_actor()))
    # submit_requirements now goes straight to build.resource_recommendation
    # (the decision-free find_resources gate at build.initial_plan is gone).
    reqs_action = Action(kind="submit_requirements", base_version=out.version)
    out = runner.advance(s.id, Turn(action=reqs_action, actor=_actor()))
    confirm_payload = {"resource_ids": ["kb-company"]}
    confirm_action = Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version)
    out = runner.advance(s.id, Turn(action=confirm_action, actor=_actor()))
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    # No file/file-list start variable -> mocked inline, no gate.
    out = runner.advance(s.id, Turn(action=Action(kind="run_test", base_version=out.version), actor=_actor()))
    # the testdata form arrives pre-filled; submitting it is one click
    out = runner.advance(
        s.id,
        Turn(
            action=Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version),
            actor=_actor(),
        ),
    )
    assert out.current_state == PcState.BUILD_REVIEW

    out = runner.advance(s.id, Turn(action=Action(kind="keep_draft", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_AWAIT_LEARNING  # default policy "ask"

    out = runner.advance(s.id, Turn(action=Action(kind="skip_learning", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_COMPLETE
    assert dify.published is False  # keep_draft skips publish
    assert not any(i.kind == "publish" for i in repo.list_conversation(s.id))


def test_review_continue_adjusting_then_reapprove_is_idempotent():
    """Final-review fix (Important #1): looping back from build.review via
    continue_adjusting (resolved re_fix) — which now falls straight through
    build.initial_plan's unconditional resource discovery to
    build.resource_recommendation in the SAME advance() call, since
    build.initial_plan is a working/pass-through state (state.py) — and
    re-walking confirm_resources -> approve_plan must NOT crash on the second
    build. build_nodes() always emits create_node with the SAME fixed node
    ids (start/knowledge_retrieval/llm/end); without idempotency the second
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
    # submit_requirements now goes straight to build.resource_recommendation
    # (the decision-free find_resources gate at build.initial_plan is gone).
    reqs_action = Action(kind="submit_requirements", base_version=out.version)
    out = runner.advance(s.id, Turn(action=reqs_action, actor=_actor()))
    confirm_payload = {"resource_ids": ["kb-company"]}
    confirm_action = Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version)
    out = runner.advance(s.id, Turn(action=confirm_action, actor=_actor()))

    # first build: applies all 7 intents.
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_EXECUTION
    assert len(dify.graph["nodes"]) == 4
    assert len(dify.graph["edges"]) == 3

    # No file/file-list start variable -> mocked inline, no gate.
    out = runner.advance(s.id, Turn(action=Action(kind="run_test", base_version=out.version), actor=_actor()))
    # the testdata form arrives pre-filled; submitting it is one click
    out = runner.advance(
        s.id,
        Turn(
            action=Action(kind="provide_testdata", payload={"mode": "mock"}, base_version=out.version),
            actor=_actor(),
        ),
    )
    assert out.current_state == PcState.BUILD_REVIEW

    # loop back: continue_adjusting (-> re_fix) -> build.initial_plan (re-plan)
    # -> falls straight through (working/pass-through, no action needed) to
    # build.resource_recommendation, all within this one advance() call.
    plan_cards_before_loop_back = sum(1 for i in repo.list_conversation(s.id) if i.kind == "plan")
    out = runner.advance(s.id, Turn(action=Action(kind="re_fix", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    # re_fix must NOT show the plan card a second time -- it drafts fc.plan_items
    # but defers display to confirm_resources below, exactly like the
    # straight-through path (task 2's duplicate-card removal).
    assert sum(1 for i in repo.list_conversation(s.id) if i.kind == "plan") == plan_cards_before_loop_back

    # confirm_resources -> approve_plan
    confirm_action_2 = Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version)
    out = runner.advance(s.id, Turn(action=confirm_action_2, actor=_actor()))
    assert out.current_state == PcState.BUILD_PLAN_APPROVAL
    # exactly ONE plan card for this whole loop-back pass (re_fix + discovery
    # + confirm_resources): the same "v1, resources bound" card the
    # straight-through path shows, not two under different version tags.
    plan_cards_after_confirm = [i for i in repo.list_conversation(s.id) if i.kind == "plan"]
    assert len(plan_cards_after_confirm) == plan_cards_before_loop_back + 1
    assert plan_cards_after_confirm[-1].payload["version_tag"] == "v1"

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


def test_run_test_prefills_the_form_with_mock_values():
    """The user never has to invent test data -- but they do get to see and
    edit it. Inventing the values is the cost item 5 removed; confirming them
    with one click is not, and a green check produced by inputs nobody saw is
    weak evidence about the workflow."""
    from core.dify_builder.handlers_build import handle_execution
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.graph = {
        "nodes": [
            {
                "id": "start",
                "data": {"type": "start", "variables": [{"variable": "topic", "type": "text-input"}]},
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
    assert form.payload["frozen"] is False  # editable, not a read-only receipt
    assert form.payload["values"]  # pre-filled from the mock, not an empty form


def test_run_test_still_asks_when_a_file_is_declared_among_other_variables():
    """Mixed schema: text can be mocked, but the file variable cannot -- the
    gate must still fire so a human can supply the upload."""
    from core.dify_builder.handlers_build import handle_execution
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.dify = FakeBuildDifyPort()
    env.dify.graph = {
        "nodes": [
            {
                "id": "start",
                "data": {
                    "type": "start",
                    "variables": [
                        {"variable": "topic", "type": "text-input"},
                        {"variable": "doc", "type": "file"},
                    ],
                },
            }
        ],
        "edges": [],
    }
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_EXECUTION)
    fc = DifyBuilderContext(test_input_ref="")
    result = handle_execution(env, Turn(actor=_actor(), action=Action(kind="run_test")), s, fc)
    assert result.next == PcState.BUILD_AWAIT_TESTDATA
    assert result.context.test_input_ref == ""
    form = next(i for i in result.items if i.kind == "form")
    assert [f["type"] for f in form.payload["fields"]] == ["text-input", "file"]


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
    loop (handle_reverted's re_fix), not continue_adjusting. re_fix lands on
    build.initial_plan, which is a working/pass-through state (state.py) that
    falls straight through to build.resource_recommendation in the same
    advance() call, with no find_resources action needed."""
    from core.dify_builder.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    out = runner.advance(
        s.id, Turn(action=Action(kind="send_goal", payload={"text": "Build it"}, base_version=1), actor=_actor())
    )
    # submit_requirements now goes straight to build.resource_recommendation
    # (the decision-free find_resources gate at build.initial_plan is gone).
    out = runner.advance(
        s.id, Turn(action=Action(kind="submit_requirements", base_version=out.version), actor=_actor())
    )
    confirm_payload = {"resource_ids": ["kb-company"]}
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

    # retry_after_revert (-> re_fix) -> build.initial_plan (re-plan) -> falls
    # straight through to build.resource_recommendation in this one call.
    out = runner.advance(s.id, Turn(action=Action(kind="re_fix", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION

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


def test_recovery_continue_reruns_interrupted_publish_step():
    """An interrupted build.publish recovered via recovery_continue must re-run
    handle_publish (the runner falls through because build.publish is a working
    state) and advance to build.governance_feedback -- not stay wedged."""
    from core.dify_builder.handlers_build import build_registry
    from core.dify_builder.runner import Runner
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_build_session(repo, PcState.BUILD_PUBLISH, plan_items=["x"], built_node_ids=["start_1"])
    runner = Runner(env, build_registry())

    runner.advance(s.id, Turn(action=Action(kind="recovery_continue", base_version=s.version), actor=_actor()))

    reloaded, _fc = repo.get_session(s.id)
    assert reloaded.current_state != PcState.BUILD_PUBLISH  # advanced, not wedged
    assert dify.published is True  # handle_publish re-ran (FakeBuildDifyPort records publish)


def test_recovery_restart_resets_interrupted_step_to_entry_state():
    from core.dify_builder.handlers_build import build_registry
    from core.dify_builder.models import EntryMode
    from core.dify_builder.recovery import entry_state_for
    from core.dify_builder.runner import Runner
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(repo, PcState.BUILD_PUBLISH, plan_items=["x"], staged_repair=[object()])
    Runner(env, build_registry()).advance(
        s.id, Turn(action=Action(kind="recovery_restart", base_version=s.version), actor=_actor())
    )
    reloaded, fc = repo.get_session(s.id)
    assert reloaded.current_state == entry_state_for(EntryMode.BUILD)  # back at the flow entry
    assert fc.staged_repair == []  # working fields reset


class _NamingAgent(PlaceholderAgent):
    """Placeholder cognition plus a model that has an opinion about the name."""

    def __init__(self, proposal: str = "Expense reimbursement approval") -> None:
        self.proposal = proposal
        self.calls: list[tuple[str, dict]] = []

    def propose_app_name(self, goal_text, requirements):
        self.calls.append((goal_text, dict(requirements)))
        return self.proposal


def _run_capability_check(agent, *, app_name_auto: bool, rename_app=None):
    from core.dify_builder.handlers_build import build_registry

    env, repo = _new_env(agent=agent)
    env.rename_app = rename_app
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK, app_name_auto=app_name_auto)
    runner = Runner(env, build_registry())
    runner.advance(s.id, Turn(action=Action(kind="send_goal", payload={"text": "x"}, base_version=1), actor=_actor()))
    _session_after, fc = repo.get_session(s.id)
    return fc


class _Renamer:
    """Stands in for the service-layer rename, reporting back what it stored."""

    def __init__(self, stored: str | None = None) -> None:
        self.stored = stored
        self.calls: list[str] = []

    def __call__(self, proposed: str) -> str:
        self.calls.append(proposed)
        return self.stored if self.stored is not None else proposed


def test_goal_analysis_renames_an_app_still_carrying_its_derived_name():
    agent = _NamingAgent()
    renamer = _Renamer()
    fc = _run_capability_check(agent, app_name_auto=True, rename_app=renamer)

    assert renamer.calls == ["Expense reimbursement approval"]
    # The goal and the just-analyzed requirements are both handed to the model.
    assert agent.calls[0][0] == "x"
    assert agent.calls[0][1] == fc.requirements
    # Cleared, so a later advance through this state never renames again.
    assert fc.app_name_auto is False
    # Recorded, so the build-complete card can say it (spec N4).
    assert fc.app_name == "Expense reimbursement approval"


def test_the_context_records_the_name_the_database_actually_took():
    # The service normalizes before storing, so the engine must not assume its
    # proposal is what landed.
    agent = _NamingAgent(proposal='  "Expense approval"  ')
    fc = _run_capability_check(agent, app_name_auto=True, rename_app=_Renamer(stored="Expense approval"))

    assert fc.app_name == "Expense approval"


def test_a_rename_that_stored_nothing_leaves_the_context_name_alone():
    fc = _run_capability_check(_NamingAgent(), app_name_auto=True, rename_app=_Renamer(stored=""))

    assert fc.app_name == ""


def test_an_app_named_by_its_user_is_never_renamed():
    agent = _NamingAgent()
    renamer = _Renamer()
    fc = _run_capability_check(agent, app_name_auto=False, rename_app=renamer)

    assert renamer.calls == []
    assert agent.calls == []
    assert fc.app_name_auto is False


def test_a_model_with_no_proposal_leaves_the_derived_name_alone():
    agent = _NamingAgent(proposal="   ")
    renamer = _Renamer()
    fc = _run_capability_check(agent, app_name_auto=True, rename_app=renamer)

    assert renamer.calls == []
    # Still consumed: one shot per session, whether or not it produced anything.
    assert fc.app_name_auto is False


def test_no_rename_callback_wired_costs_no_model_call():
    agent = _NamingAgent()
    fc = _run_capability_check(agent, app_name_auto=True, rename_app=None)

    assert agent.calls == []
    assert fc.app_name_auto is False


def _approve_plan(**fc_kwargs):
    from core.dify_builder.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(
        repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve"], plan_version_tag="v1", **fc_kwargs
    )
    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())
    res = handle_plan_approval(env, turn, *repo.get_session(s.id))
    return next(i for i in res.items if i.kind == "plan"), res


def test_the_built_card_names_the_app():
    # Spec N4: "Refund approval is ready" -- the app is named here and only here.
    plan, _res = _approve_plan(app_name="Refund approval")

    assert plan.payload["title"] == "Refund approval is ready"


def test_the_built_card_keeps_a_generic_title_when_the_name_is_unknown():
    plan, _res = _approve_plan()

    assert plan.payload["title"] == "Build plan"


def test_the_completion_receipt_never_repeats_the_name():
    # Spec N4: 记录卡上不出现 -- the name is said once, in the card above.
    from core.dify_builder.handlers_build import _emit_completion

    fc = DifyBuilderContext(app_name="Refund approval", built_node_ids=["a", "b"])
    items = _emit_completion(fc)

    assert all("Refund approval" not in str(item.payload) for item in items)


def test_the_built_card_title_is_localizable():
    # The headline is interpolated, so it only survives localization if the
    # static-string catalog knows the shape.
    from core.dify_builder import strings

    plan, _res = _approve_plan(app_name="Refund approval")
    matched = strings.match_template(plan.payload["title"])

    assert matched is not None
    assert matched[1]["name"] == "Refund approval"


class _ResourceAgent(PlaceholderAgent):
    def __init__(self, options) -> None:
        self.options = options

    def discover_resources(self, _plan_items):
        return self.options


def _find_resources(options):
    from core.dify_builder.handlers_build import handle_initial_plan

    env, repo = _new_env(agent=_ResourceAgent(options))
    s = _seed_build_session(repo, PcState.BUILD_INITIAL_PLAN, plan_items=["Send a notification"])
    turn = Turn(action=Action(kind="find_resources", base_version=1), actor=_actor())
    return handle_initial_plan(env, turn, *repo.get_session(s.id))


def test_an_empty_recommendation_is_explained_rather_than_shown_blank():
    res = _find_resources([])

    card = next(i for i in res.items if i.kind == "resource_select")
    assert card.payload["recommended"] == []
    notice = next(i for i in res.items if i.kind == "notice")
    assert "No workspace resources matched" in notice.payload["text"]


def test_the_card_is_still_emitted_when_nothing_matched():
    # The confirm gate resolves its active interaction from the latest
    # resource_select card; dropping the card would let a later pass inherit a
    # stale one.
    res = _find_resources([])

    assert any(i.kind == "resource_select" for i in res.items)


def test_a_real_recommendation_carries_no_such_notice():
    from core.dify_builder.contract import ResourceOption

    res = _find_resources([ResourceOption(id="kb-1", label="KB", meta="", kind="knowledge", readiness="ready")])

    card = next(i for i in res.items if i.kind == "resource_select")
    assert [r["id"] for r in card.payload["recommended"]] == ["kb-1"]
    assert all("No workspace resources matched" not in str(i.payload) for i in res.items)


def test_the_empty_recommendation_notice_is_localizable():
    from core.dify_builder import strings

    res = _find_resources([])
    notice = next(i for i in res.items if i.kind == "notice")

    assert notice.payload["text"] in strings.PLAIN


class _GapAgent(PlaceholderAgent):
    def __init__(self, options, gap) -> None:
        self.options = options
        self.gap = gap

    def discover_resources(self, _plan_items):
        return self.options

    def assess_capability_gap(self, _plan_items, _options):
        return self.gap


def _find_resources_with_agent(agent):
    from core.dify_builder.handlers_build import handle_initial_plan

    env, repo = _new_env(agent=agent)
    s = _seed_build_session(repo, PcState.BUILD_INITIAL_PLAN, plan_items=["Send a notification"])
    turn = Turn(action=Action(kind="find_resources", base_version=1), actor=_actor())
    return handle_initial_plan(env, turn, *repo.get_session(s.id))


def test_a_named_capability_gap_is_surfaced_as_a_notice():
    from core.dify_builder.contract import ResourceOption

    options = [ResourceOption(id="kb-1", label="KB", meta="", kind="knowledge", readiness="ready")]
    res = _find_resources_with_agent(_GapAgent(options, "Nothing installed can send email."))

    notice = next(i for i in res.items if i.kind == "notice")
    assert notice.payload["text"] == "Nothing installed can send email."


def test_a_capability_gap_and_the_empty_recommendation_notice_both_appear():
    # The two notices are independent -- an empty recommendation AND an
    # unnamed capability gap can both be true of the same plan.
    res = _find_resources_with_agent(_GapAgent([], "Nothing installed can send email."))

    notices = [i.payload["text"] for i in res.items if i.kind == "notice"]
    assert "No workspace resources matched this plan — continuing without any." in notices
    assert "Nothing installed can send email." in notices


def test_no_gap_notice_when_the_agent_reports_no_gap():
    from core.dify_builder.contract import ResourceOption

    options = [ResourceOption(id="kb-1", label="KB", meta="", kind="knowledge", readiness="ready")]
    res = _find_resources_with_agent(_GapAgent(options, ""))

    assert not any(i.kind == "notice" for i in res.items)


def test_a_missing_config_tool_still_lets_the_gap_agent_report_a_gap():
    # readiness is threaded through to the agent unmodified -- the handler
    # itself makes no readiness judgment, it only relays what the agent says.
    from core.dify_builder.contract import ResourceOption

    options = [ResourceOption(id="tool-1", label="Slack", meta="", kind="plugin", readiness="missing_config")]
    res = _find_resources_with_agent(_GapAgent(options, "Nothing installed can send a Slack message."))

    notice = next(i for i in res.items if i.kind == "notice")
    assert notice.payload["text"] == "Nothing installed can send a Slack message."


def test_the_test_result_card_names_the_dify_run_so_the_canvas_is_reachable_later():
    """``run_ids`` holds BUILDER run ids, which resolve to nothing outside the
    engine. Reopening the run on the canvas needs the DIFY run id, and it has
    to ride the persisted card: the SSE frames that also carry it are gone
    after a page reload."""
    from core.dify_builder.handlers_build import handle_test_and_repair

    env, _ = _new_env()  # default FakeDifyPort; verify_pass=True
    s_ = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])

    result = handle_test_and_repair(env, Turn(actor=_actor()), s_, fc)

    card = next(i for i in result.items if i.kind == "test_result")
    assert card.payload["dify_run_id"] == "dify-run-1"
    # and it is NOT the Builder run id the card already carried
    assert card.payload["dify_run_id"] not in card.payload["run_ids"]


def test_await_repair_refuses_to_apply_an_empty_staged_repair():
    """ESQ1-291: approving a zero-intent repair re-tested and re-offered
    forever. With nothing staged there is nothing to approve."""
    from core.dify_builder.handlers_build import handle_await_repair

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_AWAIT_REPAIR)
    fc = DifyBuilderContext()
    fc.staged_repair = []

    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())
    out = handle_await_repair(env, turn, s, fc)

    assert out.next == PcState.BUILD_AWAIT_REPAIR
    assert out.context.repair_attempts == 0
    assert "notice" in [item.kind for item in out.items]


def test_await_repair_surfaces_a_stale_intent_instead_of_failing_the_session():
    """ESQ1-271: apply_repair re-validates against the draft as it is NOW, so
    a path that was applicable at propose time can raise at approve time. An
    uncaught ValueError reaches the runner and drives the session to FAILED."""
    from core.dify_builder.handlers_build import handle_await_repair
    from core.dify_builder.models import MutationIntent
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    class _StaleDifyPort(FakeBuildDifyPort):
        def apply_repair(self, *_args, **_kwargs):
            raise ValueError("path 'memory.window.size': no key 'memory' at memory")

    env, repo = _new_env()
    env.dify = _StaleDifyPort()
    s = _seed_build_session(repo, PcState.BUILD_AWAIT_REPAIR)
    fc = DifyBuilderContext(
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "m.w", "value": 1})]
    )

    out = handle_await_repair(env, Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor()), s, fc)

    assert out.next == PcState.BUILD_AWAIT_REPAIR  # not a dead session
    error = next(i for i in out.items if i.kind == "error")
    assert error.payload["title"] == "Couldn't apply the fix"
    assert "no key 'memory'" in error.payload["body"]
    assert out.context.staged_repair == []  # engages the empty-repair guard


def test_repair_counter_tracks_consecutive_repeats_of_the_same_error():
    """The counter is per-failure, not a global budget: an interleaved
    A -> B -> B must NOT trip the guard, because B has survived one repair."""
    from core.dify_builder.handlers_build import _note_repair_error, _repair_is_repeating

    fc = DifyBuilderContext()
    _note_repair_error(fc, _failed_run("node1", "Invalid actual value type: number"))
    assert fc.repair_attempts == 0
    assert _repair_is_repeating(fc) is False

    _note_repair_error(fc, _failed_run("node2", "Variable not found"))  # progress -> restart
    assert fc.repair_attempts == 0
    _note_repair_error(fc, _failed_run("node2", "Variable not found"))
    assert fc.repair_attempts == 1
    assert _repair_is_repeating(fc) is False  # survived ONE repair, not two


def test_repeated_failure_stops_offering_a_repair():
    """The guard must be REACHED, not merely defined: a third identical
    failure clears the staged repair instead of proposing a fourth."""
    from core.dify_builder.handlers_build import _MAX_REPEATED_REPAIRS, _note_repair_error, _repair_is_repeating

    fc = DifyBuilderContext()
    failure = _failed_run("node1", "Invalid actual value type: number")
    for _ in range(_MAX_REPEATED_REPAIRS + 1):
        _note_repair_error(fc, failure)
    assert fc.repair_attempts == _MAX_REPEATED_REPAIRS
    assert _repair_is_repeating(fc) is True

    # a NEW failure means progress -- keep repairing
    _note_repair_error(fc, _failed_run("node1", "Variable not found"))
    assert _repair_is_repeating(fc) is False


def test_repair_counter_is_cleared_on_recovery_reentry():
    """A fresh build that inherited repair_attempts >= the ceiling would
    decline a repair on its first failure, one nobody ever approved."""
    from core.dify_builder.recovery import _reset_working_fields

    fc = DifyBuilderContext(repair_attempts=5, last_repair_error="boom")
    _reset_working_fields(fc)
    assert fc.repair_attempts == 0
    assert fc.last_repair_error == ""


def test_test_and_repair_stops_offering_a_repair_through_the_handler():
    """Integration coverage for the OFFER-time wiring: drive the repeated-
    failure branch through handle_test_and_repair itself (not by calling
    _repair_is_repeating directly), so a regression that re-disconnects the
    guard from the handler (e.g. the dead-on-reload bug fixed in
    services/dify_builder/serde.py) would show up here even if the unit
    tests for _repair_is_repeating still pass in isolation."""
    from core.dify_builder.handlers_build import _MAX_REPEATED_REPAIRS, handle_test_and_repair
    from core.dify_builder.models import TestInput
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, _ = _new_env(agent=StubAgent())  # StubAgent.diagnose always returns the same root_cause
    env.dify = FakeBuildDifyPort()
    env.dify.verify_pass = False  # default error "boom" -> config, not input
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(
        test_input_ref="ti-1",
        # The ENGINE signature FakeBuildDifyPort's failing run produces, NOT the
        # agent's prose -- the guard keys on the engine (see _failure_signature).
        last_repair_error="llm|boom",
        repair_attempts=_MAX_REPEATED_REPAIRS,
    )

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.context.staged_repair == []  # cleared -- no repair offered on the 3rd identical failure
    error = next(i for i in result.items if i.kind == "error")
    assert error.payload["title"] == "Repeated failure"
    # the run still has to be persisted: every sibling exit returns it, and
    # fc.verify_run_id already points at it (a dangling pointer otherwise).
    assert result.run is not None
    assert result.run_id_sink == [result.run.id]
    assert result.context.verify_run_id == result.run.id


# --- the repeated-repair breaker keys on ENGINE output, not LLM prose --------
#
# Production bug found live 2026-09-21: the breaker keyed on
# ``diagnosis.root_cause``, which is LLM prose regenerated on every diagnosis
# call -- observed rewording across four turns of one session, one of them
# switching to Chinese. Exact string equality therefore never held, the counter
# reset forever, and the guard was unreachable. A session burned 9 failed runs
# and 8 repair approvals with the guard in place.
#
# The pre-existing tests all fed the SAME literal string twice, so they encoded
# the very premise that is false in production. Every test below instead varies
# the wording while holding the engine failure fixed.


def _failed_run(node_id: str, error: str, launch_error: str = ""):
    from core.dify_builder.models import NodeOutput, Run

    return Run(
        id="r-1",
        status="failed",
        per_node=[NodeOutput(node_id=node_id, status="failed", error=error)] if node_id else [],
        error=launch_error,
    )


def test_failure_signature_is_stable_across_reworded_diagnoses():
    """Two runs that failed the SAME way must produce the SAME signature,
    whatever the diagnosing LLM happens to call it this turn."""
    from core.dify_builder.handlers_build import _failure_signature

    a = _failed_run("node3", "Variable #node3.output# not found")
    b = _failed_run("node3", "Variable #node3.output# not found")
    assert _failure_signature(a) == _failure_signature(b)
    assert _failure_signature(a) != ""


def test_failure_signature_separates_different_errors_on_one_node():
    """Same culprit node is NOT enough: two different faults on one node are
    real progress, and must restart the count rather than trip the guard."""
    from core.dify_builder.handlers_build import _failure_signature

    a = _failed_run("node3", "Variable #node3.output# not found")
    b = _failed_run("node3", "Invalid actual value type: number")
    assert _failure_signature(a) != _failure_signature(b)


def test_failure_signature_separates_the_same_error_on_different_nodes():
    from core.dify_builder.handlers_build import _failure_signature

    a = _failed_run("node3", "Variable not found")
    b = _failed_run("node7", "Variable not found")
    assert _failure_signature(a) != _failure_signature(b)


def test_failure_signature_falls_back_to_the_launch_error():
    """A run that threw before any node executed has no per_node rows; the
    engine's launch error is then the only stable thing available."""
    from core.dify_builder.handlers_build import _failure_signature

    a = _failed_run("", "", launch_error="draft has no start node")
    b = _failed_run("", "", launch_error="draft has no start node")
    assert _failure_signature(a) == _failure_signature(b)
    assert _failure_signature(a) != ""
    assert _failure_signature(_failed_run("", "", launch_error="something else")) != _failure_signature(a)


def test_failure_signature_is_whitespace_insensitive():
    from core.dify_builder.handlers_build import _failure_signature

    a = _failed_run("node3", "Variable  #node3.output#\n not found")
    b = _failed_run("node3", "Variable #node3.output# not found")
    assert _failure_signature(a) == _failure_signature(b)


def test_breaker_fires_through_the_handler_although_diagnoses_are_reworded():
    """THE regression test for the live bug, driven through the real handler.

    The engine fails identically every turn while the diagnosing agent rewords
    its root_cause each call -- exactly what production does, including the
    mid-session switch to Chinese. Against the prose-keyed implementation the
    counter never increments and this never trips, which is precisely how a
    real session burned 9 runs and 8 approvals."""
    from core.dify_builder.handlers_build import _MAX_REPEATED_REPAIRS, handle_test_and_repair
    from core.dify_builder.models import Diagnosis, TestInput
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    wordings = [
        "The output node references a variable that does not exist yet.",
        "The 'Output' node is misconfigured: it requires 'metrics' before it is produced.",
        "输出节点引用的变量不存在，导致运行失败。",
    ]

    class RewordingAgent(StubAgent):
        def __init__(self) -> None:
            super().__init__()
            self.calls = 0

        def diagnose(self, _failed_run, _graph, _node_outputs) -> Diagnosis:
            wording = wordings[min(self.calls, len(wordings) - 1)]
            self.calls += 1
            return Diagnosis(culprit_node_id="output", root_cause=wording, severity="high")

    env, _ = _new_env(agent=RewordingAgent())
    env.dify = FakeBuildDifyPort()
    env.dify.verify_pass = False  # the engine fails the same way every time
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    result = None
    for _ in range(_MAX_REPEATED_REPAIRS + 1):
        result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
        fc = result.context

    assert fc.repair_attempts >= _MAX_REPEATED_REPAIRS
    assert fc.staged_repair == []  # no fourth repair offered
    error = next(i for i in result.items if i.kind == "error")
    assert error.payload["title"] == "Repeated failure"


def test_breaker_restarts_when_the_engine_failure_actually_changes():
    """A genuinely different failure means the last repair achieved something,
    so the count must restart even though it is still failing."""
    from core.dify_builder.handlers_build import _note_repair_error, _repair_is_repeating

    fc = DifyBuilderContext()
    _note_repair_error(fc, _failed_run("node3", "Variable not found"))
    _note_repair_error(fc, _failed_run("node3", "Variable not found"))
    assert fc.repair_attempts == 1
    _note_repair_error(fc, _failed_run("node3", "Invalid actual value type: number"))
    assert fc.repair_attempts == 0
    assert _repair_is_repeating(fc) is False


# --- a first build that applies nothing must not claim success --------------
#
# Found live 2026-09-21: starting a NEW Build session on an app whose draft
# already holds a previous build's graph silently did nothing and still
# reported "graph built". _already_present matches a create_node by node id
# ALONE, and the generator always emits node1, node2, ... -- so a new plan
# whose node2 is a parameter-extractor was filtered out against an existing
# node2 that is an llm. to_apply became empty, apply_repair([]) no-oped, and
# change_set fell back to "graph built" over an untouched canvas.
#
# The id filter itself is deliberate and must stay: it is what makes a
# loop-back re-approve (continue_adjusting / revert) idempotent instead of
# raising on a colliding id. Only the FIRST build of a session is affected,
# which is exactly what this guard keys on.


def _graph_with(*nodes) -> dict:
    return {"nodes": [{"id": nid, "data": {"type": ntype}} for nid, ntype in nodes], "edges": []}


def _stub_agent_building(intents):
    from tests.unit_tests.core.dify_builder.fakes import StubAgent

    class _Agent(StubAgent):
        def build_nodes(self, _plan_items, _resource_ids=None):
            return BuildNodesResult(intents=list(intents))

    return _Agent()


def _create(node_id: str, node_type: str):
    from core.dify_builder.models import MutationIntent

    return MutationIntent(op="create_node", args={"node_id": node_id, "node_type": node_type, "config": {}})


def test_first_build_that_applies_nothing_reports_honestly():
    """A new session over an app that already holds node1/node2 from an earlier
    build must NOT say "graph built" while leaving the canvas untouched."""
    from core.dify_builder.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env(agent=_stub_agent_building([_create("node1", "start"), _create("node2", "llm")]))
    env.dify = FakeBuildDifyPort()
    # the app already carries a PREVIOUS build under the same generated ids
    env.dify.graph = _graph_with(("node1", "start"), ("node2", "parameter-extractor"))
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])  # built_node_ids empty -> FIRST build

    result = handle_plan_approval(env, Turn(action=Action(kind="approve_repair"), actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_PLAN_APPROVAL  # not advanced to execution
    error = next(i for i in result.items if i.kind == "error")
    assert "already" in error.payload["body"].lower()
    assert not any(i.kind == "change_set" for i in result.items)  # no "graph built" claim


def test_loop_back_reapprove_is_still_idempotent():
    """The guard must NOT fire on the loop-back it exists to protect: a
    re-approve after continue_adjusting has built_node_ids set, so applying
    nothing is correct and must still advance."""
    from core.dify_builder.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env(agent=_stub_agent_building([_create("node1", "start"), _create("node2", "llm")]))
    env.dify = FakeBuildDifyPort()
    env.dify.graph = _graph_with(("node1", "start"), ("node2", "llm"))
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"], built_node_ids=["node1", "node2"])  # THIS session built them

    result = handle_plan_approval(env, Turn(action=Action(kind="approve_repair"), actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_EXECUTION


# The Run the port now produces for the ESQ1-302 error frame (Tasks 1-2): no
# rows, no run id, the pydantic text (whitespace-collapsed, code appended).
_ESQ1_302_LAUNCH_ERROR = (
    "2 validation errors for HttpRequestNodeData body.data.0.type Field required [type=missing, "
    "input_value={'value': '{{#node3.text#}}', 'key': 'slides'}, input_type=dict] For further "
    "information visit https://errors.pydantic.dev/2.12/v/missing [invalid_param]"
)


def _esq1_302_launch_failed_run(*_a, **_k):
    from core.dify_builder.models import Run

    return Run(
        kind="verify", immutable=True, dify_run_id="", status="failed", per_node=[], error=_ESQ1_302_LAUNCH_ERROR
    )


def test_a_launch_error_frame_reaches_diagnose_and_trips_the_breaker_on_the_third_repeat():
    """THE ESQ1-302 regression, driven through the real handler with the Run the
    port now produces for the trace's error frame. Before this fix the handler
    threw ``Run.error`` away (``run_error = ""``), so a launch failure had no
    signature and the breaker could never fire on it."""
    from core.dify_builder.handlers_build import _MAX_REPEATED_REPAIRS, _failure_signature, handle_test_and_repair
    from core.dify_builder.models import TestInput
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, _ = _new_env(agent=StubAgent())
    env.dify = FakeBuildDifyPort()
    env.dify.run_draft = _esq1_302_launch_failed_run
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    results = []
    snapshots = []  # the handler mutates the SAME context object in place; snapshot per call
    for _ in range(_MAX_REPEATED_REPAIRS + 1):
        res = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
        fc = res.context
        results.append(res)
        snapshots.append((fc.repair_attempts, len(fc.staged_repair), fc.last_repair_error))

    signature = _failure_signature(_esq1_302_launch_failed_run())
    assert signature.startswith("|2 validation errors")
    for res, (_attempts, staged, last) in zip(results[:-1], snapshots[:-1]):
        assert res.next == PcState.BUILD_AWAIT_REPAIR
        assert res.run.error == _ESQ1_302_LAUNCH_ERROR  # kept on the persisted Run
        assert "notice" not in [i.kind for i in res.items]  # NOT the unknown-outcome bounce
        assert staged == 1  # diagnosed, a repair staged at the gate
        assert last == signature
    assert [attempts for attempts, _, _ in snapshots] == [0, 1, 2]
    final = results[-1]
    assert final.context.staged_repair == []
    assert next(i for i in final.items if i.kind == "error").payload["title"] == "Repeated failure"
