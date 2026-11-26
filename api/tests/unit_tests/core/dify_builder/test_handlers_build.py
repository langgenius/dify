"""Tests for the Build-flow handlers + build_registry() (Slice 2)."""

from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from typing import NoReturn, Unpack, override

import pytest
import pytest_mock

from core.dify_builder.contract import ProgressEventData, ResourceOption
from core.dify_builder.models import (
    Action,
    Actor,
    ApplyResult,
    BuildNodesResult,
    ConversationItem,
    Diagnosis,
    DifyBuilderContext,
    EntryMode,
    Graph,
    Inputs,
    MutationIntent,
    NodeEvent,
    NodeOutput,
    Risk,
    Run,
    Session,
    StartSchema,
    Turn,
)
from core.dify_builder.state import PcState
from services.dify_builder.application.placeholder_agent import PlaceholderAgent
from services.dify_builder.application.ports import DifyBuilderAgent, DifyPort
from services.dify_builder.application.runner import Handler, Runner, StepResult
from tests.unit_tests.core.dify_builder.fakes import (
    ContextOverrides,
    FakeBuildDifyPort,
    FakeDifyPort,
    FixtureEnv,
    InMemoryRepository,
    SessionOverrides,
    StubAgent,
    failed_verification,
    successful_verification,
)
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text


class NativeFlowAgent(PlaceholderAgent):
    """Generic FSM fixtures do not request the unsupported knowledge capability."""

    @override
    def discover_resources(
        self,
        plan_items: list[str],
        *,
        goal_text: str,
        requirements: Inputs,
        reply_language: str | None = None,
    ) -> list[ResourceOption]:
        return []


def _actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="tenant-1")


def _session(**overrides: Unpack[SessionOverrides]) -> Session:
    return replace(
        Session(
            app_id="app",
            tenant_id="tenant-1",
            owner_account_id="acc-1",
            entry_mode=EntryMode.BUILD,
            current_state=PcState.BUILD_CAPABILITY_CHECK,
        ),
        **overrides,
    )


def _new_env(
    dify: DifyPort | None = None,
    emit_canvas: Callable[[dict[str, object]], None] | None = None,
    agent: DifyBuilderAgent | None = None,
) -> tuple[FixtureEnv, InMemoryRepository]:
    repo = InMemoryRepository()
    env = FixtureEnv(
        dify=dify or FakeDifyPort(),
        agent=agent or PlaceholderAgent(),
        repo=repo,
        now=lambda: datetime.min,
        emit_canvas=emit_canvas,
    )
    return env, repo


def _seed_build_session(repo: InMemoryRepository, state: PcState, **fc_kwargs: Unpack[ContextOverrides]) -> Session:
    s = Session(
        app_id="app",
        tenant_id="tenant-1",
        owner_account_id="acc-1",
        entry_mode=EntryMode.BUILD,
        current_state=state,
    )
    fc = replace(DifyBuilderContext(goal_text="Build a quarterly report workflow"), **fc_kwargs)
    repo.create_session(s, fc, [ConversationItem(kind="user", seq=0)])
    return s


@pytest.mark.parametrize("values", [{}, {"currency": "USD", "threshold": 100}])
def test_complete_goal_automatically_reaches_resources_without_a_requirements_submission(values: Inputs) -> None:
    from services.dify_builder.application.handlers_build import build_registry
    from services.dify_builder.plan import WorkflowPlan

    goal = "每天检查订单，金额超过 100 USD 时发出提醒，返回订单编号。"

    class CompleteGoalAgent(PlaceholderAgent):
        def __init__(self) -> None:
            self.calls: list[str] = []

        @override
        def analyze_goal(self, goal_text: str, *, reply_language: str | None = None) -> dict[str, object]:
            self.calls.append("analyze")
            assert goal_text == goal
            assert reply_language == "zh-Hans"
            return {"fields": [], "values": values}

        @override
        def propose_plan_v1(
            self, requirements: Inputs, *, goal_text: str, reply_language: str | None = None
        ) -> WorkflowPlan:
            self.calls.append("plan")
            assert goal_text == goal
            assert requirements == values
            assert reply_language == "zh-Hans"
            return super().propose_plan_v1(requirements, goal_text=goal_text, reply_language=reply_language)

        @override
        def discover_resources(
            self,
            plan_items: list[str],
            *,
            goal_text: str,
            requirements: Inputs,
            reply_language: str | None = None,
        ) -> list[ResourceOption]:
            self.calls.append("resources")
            assert plan_items
            assert goal_text == goal
            assert requirements == values
            assert reply_language == "zh-Hans"
            return super().discover_resources(
                plan_items, goal_text=goal_text, requirements=requirements, reply_language=reply_language
            )

    agent = CompleteGoalAgent()
    dify = FakeBuildDifyPort()
    events: list[dict[str, object]] = []
    env, repo = _new_env(agent=agent, dify=dify, emit_canvas=events.append)
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK, goal_text=goal, reply_language="zh-Hans")
    runner = Runner(env, build_registry())

    out = runner.advance(s.id, Turn(action=Action(kind="start_build", base_version=1), actor=_actor()))

    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    _, fc = repo.get_session(s.id)
    assert fc.goal_text == goal
    assert fc.requirements == values
    assert fc.reply_language == "zh-Hans"
    assert fc.plan_items
    assert fc.resource_selection == {
        "knowledge_source_unavailable": False,
        "knowledge_requires_clarification": False,
        "offered_knowledge_ids": ["kb-company"],
    }
    assert fc.built_node_ids == []
    assert agent.calls == ["analyze", "plan", "resources"]
    kinds = [item.kind for item in repo.list_conversation(s.id)]
    assert "resource_select" in kinds
    assert not {"form", "decision", "interaction_response", "plan", "test_result"}.intersection(kinds)
    assert events == []
    assert not dify.published
    assert runner.advance(s.id, Turn(actor=_actor())).current_state == PcState.BUILD_RESOURCE_RECOMMENDATION


def test_complete_goal_without_a_usable_plan_fails_explicitly_without_an_empty_form() -> None:
    from core.dify_builder.contract import RunStatus
    from services.dify_builder.application.handlers_build import build_registry
    from services.dify_builder.service import _actions_for, _run_status

    class UnavailablePlanAgent(StubAgent):
        def __init__(self) -> None:
            super().__init__()
            self.plan_attempts = 0

        @override
        def analyze_goal(self, goal_text: str, *, reply_language: str | None = None) -> dict[str, object]:
            return {"fields": [], "values": {"threshold": 100}}

        @override
        def propose_plan_v1(self, requirements: Inputs, *, goal_text: str, reply_language: str | None = None) -> None:
            self.plan_attempts += 1

    agent = UnavailablePlanAgent()
    dify = FakeBuildDifyPort()
    original_graph = dict(dify.graph)
    env, repo = _new_env(agent=agent, dify=dify)
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK, goal_text="Alert for orders above 100 USD")

    out = Runner(env, build_registry()).advance(
        s.id, Turn(action=Action(kind="start_build", base_version=1), actor=_actor())
    )

    assert out.current_state == PcState.FAILED
    assert _run_status(out.current_state) == RunStatus.FAILED
    _, fc = repo.get_session(s.id)
    assert fc.goal_text == "Alert for orders above 100 USD"
    assert fc.requirements == {"threshold": 100}
    assert fc.plan_items == []
    assert [action.id for action in _actions_for(out.current_state, fc)] == ["restart"]
    items = repo.list_conversation(s.id)
    assert not any(item.kind in {"form", "decision", "resource_select", "plan"} for item in items)
    assistant = next(item for item in items if item.kind == "assistant_turn")
    assert assistant.payload["execution"]["status"] == "error"
    assert "couldn't produce a usable" in english_text(assistant.payload["reply_text"])
    assert dify.graph == original_graph
    assert agent.plan_attempts == 1


def test_capability_check_rejects_a_session_without_a_persisted_goal() -> None:
    from services.dify_builder.application.handlers_build import handle_capability_check

    env, _ = _new_env()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_CAPABILITY_CHECK)
    fc = DifyBuilderContext(goal_text="")

    with pytest.raises(ValueError, match="build goal is required"):
        handle_capability_check(env, Turn(actor=_actor()), s, fc)


def test_submitting_requirements_progress_has_monotonic_revisions_for_each_committed_stage() -> None:
    """Planning and discovery each own one monotonic progress operation."""
    from services.dify_builder.application.handlers_build import build_registry

    events: list[ProgressEventData] = []
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
    assert len(operation_ids) == 2
    assert {event.stage_id for event in events} == {str(PcState.BUILD_GOAL_ANALYSIS), str(PcState.BUILD_INITIAL_PLAN)}
    for operation_id in operation_ids:
        revisions = [event.revision for event in events if event.operation_id == operation_id]
        assert revisions == sorted(revisions)
        assert len(revisions) == len(set(revisions))
    # all four progress steps actually fired (review, draft, discover, prepare)
    activity_ids = {e.activity.id for e in events if e.activity is not None}
    assert {
        "build-review-requirements",
        "build-draft-plan",
        "build-discover-resources",
        "build-prepare-resource-options",
    } <= activity_ids


def test_resource_recommendation_confirm_creates_internal_checkpoint_and_plan() -> None:
    from services.dify_builder.application.handlers_build import handle_resource_recommendation
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(
        repo,
        PcState.BUILD_RESOURCE_RECOMMENDATION,
        plan_items=["Retrieve", "Summarize"],
        plan_title="Summarize quarterly reports",
        plan_input_summary="Quarterly source reports.",
        plan_output_summary="An executive summary.",
        plan_version_tag="v1",
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
    assert res.context is not None
    assert res.context.resource_selection == {"resource_ids": ["kb-company"]}
    assert res.context.checkpoint_id
    assert res.context.last_structure_fingerprint != ""
    cp, _snap = repo.get_checkpoint(res.context.checkpoint_id)
    assert cp.session_id == s.id
    assert not any(i.kind == "checkpoint" for i in res.items)
    plan = next(i for i in res.items if i.kind == "plan")
    assert plan.payload["title"] == "Summarize quarterly reports"
    assert plan.payload["input_summary"] == "Quarterly source reports."
    assert plan.payload["output_summary"] == "An executive summary."
    assert plan.payload["items"] == res.context.plan_items
    assert "version_tag" not in plan.payload
    assert {i.kind for i in res.items} == {"decision", "plan", "assistant_turn"}


def test_plan_approval_approve_builds_graph_and_notifies_once() -> None:
    from services.dify_builder.application.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    events: list[dict[str, object]] = []
    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_build_session(
        repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve", "Summarize"], plan_version_tag="v1"
    )
    # approve_plan resolves (via service.resolve_action_kind) to "approve_repair".
    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())
    res = handle_plan_approval(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.BUILD_EXECUTION
    assert res.context is not None
    assert res.context.built_node_ids == ["start", "knowledge_retrieval", "llm", "end"]
    assert res.context.last_structure_fingerprint != ""
    assert len(dify.graph["nodes"]) == 4
    assert len(dify.graph["edges"]) == 3
    assert events == [{"event": "graph_changed", "cause": "apply"}]
    assert not any(i.kind in {"change_set", "plan"} for i in res.items)
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert "Workflow draft created" in english_text(assistant.payload["reply_text"])
    summary = english_text(assistant.payload["reply_text"])
    assert "Affected nodes:" in summary
    assert "Knowledge Retrieval" in summary
    assert "＋" not in summary
    assert "→" not in summary
    assert res.context.change_set is not None
    assert "＋ start" in res.context.change_set.diff
    assert len(assistant.payload["execution"]["activities"]) == 3


def test_plan_approval_ignores_non_approve_action() -> None:
    from services.dify_builder.application.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve"], plan_version_tag="v1")
    turn = Turn(action=Action(kind="message", base_version=1), actor=_actor())
    res = handle_plan_approval(env, turn, *repo.get_session(s.id))
    assert res.next == PcState.BUILD_PLAN_APPROVAL


def test_plan_approval_empty_build_surfaces_error_and_keeps_canvas(monkeypatch: pytest.MonkeyPatch) -> None:
    """If build_nodes yields no create_node intents (generation ultimately failed),
    the handler must NOT delete the placeholder start, must NOT claim a successful
    build, and must stay in plan_approval -- otherwise the canvas is emptied while
    the assistant reports 'Workflow draft created.'"""
    from services.dify_builder.application.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.graph = {
        "nodes": [{"id": "start", "data": {"type": "start", "title": "Old", "variables": []}}],
        "edges": [],
    }

    # Generation produced nothing, WITH a specific reason (the real generator returns
    # e.g. "UNRESOLVED_REFERENCE: ..." / a provider error). The assistant text must carry it.
    def build_nodes(
        plan_items: list[str],
        resource_ids: list[str] | None = None,
        *,
        trusted_text: str = "",
        plan_approved: bool = False,
        reply_language: str | None = None,
    ) -> BuildNodesResult:
        del plan_items, resource_ids, trusted_text, plan_approved, reply_language
        return BuildNodesResult(intents=[], error="UNRESOLVED_REFERENCE: Reference {#node4.x#} not declared")

    monkeypatch.setattr(env.agent, "build_nodes", build_nodes)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])

    res = handle_plan_approval(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)

    assert res.next == PcState.BUILD_PLAN_APPROVAL  # retryable, NOT advanced to execution
    assert {n["id"] for n in env.fake_dify.graph["nodes"]} == {"start"}  # placeholder kept; nothing deleted/added
    assert not any(i.kind == "error" for i in res.items)
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert "UNRESOLVED_REFERENCE" in english_text(assistant.payload["reply_text"])
    assert "Workflow draft created" not in english_text(assistant.payload["reply_text"])  # no false success claim


def test_plan_approval_deletes_pre_existing_start_on_from_scratch_build(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.dify_builder.models import MutationIntent
    from services.dify_builder.application.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    # seed a draft that already has a start node with id "start"
    env.fake_dify.graph = {
        "nodes": [{"id": "start", "data": {"type": "start", "title": "Old", "variables": []}}],
        "edges": [],
    }

    # generator returns a graph whose start id is "node1" (a document variable)
    def build_nodes(
        plan_items: list[str],
        resource_ids: list[str] | None = None,
        *,
        trusted_text: str = "",
        plan_approved: bool = False,
        reply_language: str | None = None,
    ) -> BuildNodesResult:
        del plan_items, resource_ids, trusted_text, plan_approved, reply_language
        return BuildNodesResult(
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

    monkeypatch.setattr(env.agent, "build_nodes", build_nodes)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])
    handle_plan_approval(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)
    ids = {n["id"] for n in env.fake_dify.graph["nodes"]}
    types = {(n.get("data") or {}).get("type") for n in env.fake_dify.graph["nodes"]}
    assert "start" not in ids
    assert "node1" in ids  # old start gone, generator's start kept
    assert types == {"start", "end"}  # exactly one start


def test_plan_approval_survives_generator_reusing_the_deleted_placeholder_start_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """M2 fix (final review, Minor/latent): on a from-scratch build, delete_intents
    drops the draft's placeholder start(s) by id, and _already_present filters
    generator creates against the PRE-delete existing_node_ids. If the generator's
    create_node happens to reuse a just-deleted placeholder id, the old code path
    would see that id in existing_node_ids and drop the create -- delete with no
    re-create, so the node silently vanishes from the final graph. The deleted
    ids must be excluded from the _already_present comparison set."""
    from core.dify_builder.models import MutationIntent
    from services.dify_builder.application.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    # seed a draft whose placeholder start id is "start"
    env.fake_dify.graph = {
        "nodes": [{"id": "start", "data": {"type": "start", "title": "Old", "variables": []}}],
        "edges": [],
    }

    # generator reuses the SAME id ("start") for its own start node
    def build_nodes(
        plan_items: list[str],
        resource_ids: list[str] | None = None,
        *,
        trusted_text: str = "",
        plan_approved: bool = False,
        reply_language: str | None = None,
    ) -> BuildNodesResult:
        del plan_items, resource_ids, trusted_text, plan_approved, reply_language
        return BuildNodesResult(
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

    monkeypatch.setattr(env.agent, "build_nodes", build_nodes)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])
    handle_plan_approval(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)

    ids = {n["id"] for n in env.fake_dify.graph["nodes"]}
    types = {(n.get("data") or {}).get("type") for n in env.fake_dify.graph["nodes"]}
    assert "start" in ids, "the create_node reusing the deleted placeholder's id must survive"
    assert "node2" in ids
    assert types == {"start", "end"}  # exactly one start, no vanished node
    assert len(env.fake_dify.graph["edges"]) == 1


def test_a_passing_test_does_not_expand_the_card_for_oversized_output() -> None:
    from services.dify_builder.application.handlers_build import handle_test_and_repair

    env, _ = _new_env()  # default FakeDifyPort; verify_pass=True by default
    env.fake_dify.run_outputs = {"report": "x" * 50_000}  # far beyond the cap once JSON-rendered
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    test_result = next(i for i in result.items if i.kind == "test_result")
    assert test_result.payload["status"] == "succeeded"
    assert test_result.payload["failure_reason"] is None


def test_test_and_repair_fail_routes_to_await_repair_with_staged_repair() -> None:
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    events: list[dict[str, object]] = []
    env, _ = _new_env(agent=StubAgent(), emit_canvas=events.append)
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.verify_pass = False
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.run is not None
    assert result.run.status == "failed"
    # StubAgent.propose_repair returns a repair -> staged
    assert result.context is not None
    assert result.context.staged_repair
    # The card carries only the failed status/reason; diagnosis and proposed
    # changes are streamed as assistant text.
    test_result = next(i for i in result.items if i.kind == "test_result")
    assert test_result.payload["status"] == "failed"
    assert english_text(test_result.payload["failure_reason"]) == "boom"
    assert not any(i.kind in {"error", "change_set"} for i in result.items)
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["test_result"]
    assert "Output node requires 'metrics'" in english_text(assistant.payload["reply_text"])
    assert "Proposed fix" in english_text(assistant.payload["reply_text"])
    assert test_result.payload["dify_run_id"] == result.run.dify_run_id
    assert events == []


@pytest.mark.parametrize(
    ("reason", "expected_reason"),
    [
        ("The missing API credential must be configured before this node can run.", True),
        ("No safe automatic fix found — try again or finish this session.", False),
        ("", False),
    ],
)
def test_test_and_repair_fail_with_no_proposed_repair_still_routes_to_gate(
    monkeypatch: pytest.MonkeyPatch, reason: str, expected_reason: bool
) -> None:
    """When propose_repair finds no safe fix (empty intents), the fail path
    must still route to the gate, but WITHOUT a change_set card, and with the
    "no safe automatic fix" reply_text variant -- the `if intents` branch the
    handler takes to decide between the two card/reply-text shapes."""
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.verify_pass = False

    def propose_repair(
        diagnosis: Diagnosis, graph: Graph, *, reply_language: str | None = None
    ) -> tuple[list[MutationIntent], Risk]:
        _ = diagnosis, graph, reply_language
        return ([], Risk(level="high", reason=reason, has_external_side_effect=False))

    monkeypatch.setattr(env.agent, "propose_repair", propose_repair)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.context is not None
    assert result.context.staged_repair == []
    kinds = [i.kind for i in result.items]
    assert "change_set" not in kinds
    assert "error" not in kinds
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["test_result"]
    reply = english_text(assistant.payload["reply_text"])
    assert reply.count("No safe automatic fix was found") == 1
    if expected_reason:
        assert reply.count(reason) == 1
        assert reply.index("No safe automatic fix was found") < reply.index(reason)
    else:
        assert "Reason:" not in reply
        if reason:
            assert reason not in reply
    assert result.checkpoint is None
    assert not env.fake_dify.applied


def test_test_and_repair_reuses_gate_prepared_input_ref() -> None:
    """When the testdata gate already prepared a TestInput (fc.test_input_ref
    set), handle_test_and_repair must read that ref straight from the repo --
    not derive a fresh mock inline. run_draft must see exactly those inputs."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    ti = TestInput(session_id=s.id, source="upload", inputs={"document": "gate-prepared.pdf"})
    env.repo.save_test_input(ti)
    fc = DifyBuilderContext(built_node_ids=["llm"], test_input_ref=ti.id)

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.context is not None
    assert result.context.test_input_ref == ti.id  # the gate's ref, not a new one
    assert env.fake_dify.run_draft_inputs == {"document": "gate-prepared.pdf"}


def test_test_and_repair_input_failure_routes_to_testdata_gate() -> None:
    """An INPUT-caused run failure (missing/invalid test data, per
    is_input_failure's signal match) must clear the stale input ref and route
    back to the testdata gate -- not the config-repair gate."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.verify_pass = False
    assert isinstance(env.fake_dify, FakeBuildDifyPort)
    env.fake_dify.fail_error = "File variable not found for selector: ['start', 'document']"
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_TESTDATA
    assert result.context is not None
    assert result.context.test_input_ref == ""  # stale input cleared
    assert result.run is not None
    assert result.context.verify_run_id == result.run.id
    kinds = [i.kind for i in result.items]
    assert "form" in kinds
    assert "change_set" not in kinds  # gate, not repair
    test_result = next(i for i in result.items if i.kind == "test_result")
    assert test_result.payload["status"] == "failed"
    assert "File variable not found" in english_text(test_result.payload["failure_reason"])
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["stage_id"] == "build.test_and_repair"


def test_test_and_repair_config_failure_still_routes_to_repair_gate() -> None:
    """A config-caused run failure (the fake's default error, which matches no
    input-failure signal) must still route to the config-repair gate,
    unchanged."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, _ = _new_env(agent=StubAgent())
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.verify_pass = False  # default error "boom" -> config, not input
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.context is not None
    assert result.context.staged_repair  # StubAgent proposes a repair
    assert result.context.test_input_ref == "ti-1"  # untouched on the config path


def test_test_and_repair_model_config_failure_surfaces_without_repair() -> None:
    """A model-config failure (the workflow references a model that isn't
    configured/available) must be surfaced -- NOT sent through diagnose+repair,
    which would thrash proposing node-structure changes. No repair is staged."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, _ = _new_env(agent=StubAgent())  # StubAgent WOULD propose a repair if diagnose ran
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.verify_pass = False
    assert isinstance(env.fake_dify, FakeBuildDifyPort)
    env.fake_dify.fail_error = "Model gpt-5.6 does not exist."  # model-config error, not a logic bug
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.context is not None
    assert result.context.staged_repair == []  # NO node-mutation repair proposed (no thrashing)
    kinds = [i.kind for i in result.items]
    assert "change_set" not in kinds  # no repair change-set offered
    assert "error" not in kinds
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert "model" in english_text(assistant.payload["reply_text"]).lower()


def test_missing_proof_running_result_stops_at_review(
    monkeypatch: pytest.MonkeyPatch,
    mocker: pytest_mock.MockerFixture,
) -> None:
    """A truncated verify result requires review and never enters diagnosis."""
    from core.dify_builder.models import Run
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    diagnose_calls: list[object] = []
    agent = StubAgent()
    mocker.patch.object(agent, "diagnose", side_effect=lambda *a, **kw: diagnose_calls.append((a, kw)))
    env, _ = _new_env(agent=agent)
    env.fake_dify = FakeBuildDifyPort()
    monkeypatch.setattr(
        env.fake_dify,
        "run_draft",
        lambda *_a, **_k: Run(
            dify_run_id="",
            status="running",
            per_node=[],
            error="the workflow run's progress stream ended before the run did, so its outcome is unknown",
        ),
    )
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.run is not None
    assert result.run.status == "running"
    assert not diagnose_calls  # diagnose must NOT be called for an unknown outcome
    assert result.context is not None
    assert result.context.staged_repair == []
    assert result.context.diagnosis is None
    kinds = [i.kind for i in result.items]
    assert "notice" not in kinds
    assert "test_result" in kinds
    assert "error" not in kinds
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert assistant.payload["cards"] == ["test_result"]
    assert "Execution safety requires review" in english_text(assistant.payload["reply_text"])


def test_test_and_repair_run_draft_raises_captures_error_on_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """Regression: a launch-time exception must be captured on run.error
    (logged + stored), not silently discarded into a blank failed stub. A
    non-input error still routes to the config-repair gate."""
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    monkeypatch.setattr(
        env.fake_dify, "run_draft", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("kaboom-provider"))
    )
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = DifyBuilderContext(built_node_ids=["llm"])

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.run is not None
    assert "kaboom-provider" in (result.run.error or "")


def test_launch_input_error_without_proof_stops_at_review(monkeypatch: pytest.MonkeyPatch) -> None:
    """Launch error text is preserved, but cannot authorize diagnosis or automatic retry."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    monkeypatch.setattr(
        env.fake_dify,
        "run_draft",
        lambda *_a, **_k: (_ for _ in ()).throw(ValueError("query is required in input form")),
    )
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(built_node_ids=["llm"], test_input_ref="ti-1")

    result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.context is not None
    assert result.context.test_input_ref == "ti-1"  # Missing proof retains inputs for review.
    assert result.run is not None
    assert "in input form" in (result.run.error or "")


def test_await_repair_approve_applies_and_waits_for_retest() -> None:
    from core.dify_builder.models import MutationIntent
    from services.dify_builder.application.handlers_build import handle_await_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.graph = {"nodes": [{"id": "llm", "data": {}}], "edges": []}  # target node must pre-exist
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_AWAIT_REPAIR)
    fc = DifyBuilderContext(
        staged_repair=[
            MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "prompt_template", "value": []})
        ],
        test_input_ref="ti-1",
    )
    result = handle_await_repair(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), s, fc)
    assert result.next == PcState.BUILD_EXECUTION
    assert env.fake_dify.applied  # the staged repair was applied
    assert result.context is not None
    assert result.context.staged_repair == []  # cleared after apply


@pytest.mark.parametrize("payload", [{}, {"__builder_adjustment_request": "  "}, {"__builder_adjustment_request": 42}])
def test_adjustment_submission_requires_new_text(payload: dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.application.handlers_build import handle_goal_analysis

    env, repo = _new_env()
    monkeypatch.setattr(env.agent, "propose_plan_v1", lambda *_a, **_k: pytest.fail("blank request must not plan"))
    s = _seed_build_session(
        repo,
        PcState.BUILD_GOAL_ANALYSIS,
        form_fields=[{"key": "__builder_adjustment_request", "type": "text", "required": True}],
        requirements={"currency": "USD", "__builder_adjustment_request": ""},
        plan_items=["Prior approved plan"],
    )
    res = handle_goal_analysis(
        env,
        Turn(action=Action(kind="submit_requirements", payload=payload, base_version=1), actor=_actor()),
        *repo.get_session(s.id),
    )
    assert res.next == PcState.BUILD_GOAL_ANALYSIS
    assert res.context is not None
    assert res.context.plan_items == ["Prior approved plan"]
    assert res.context.requirements == {"currency": "USD", "__builder_adjustment_request": ""}


def test_re_fix_branches_clear_stale_test_input_ref_and_verify_run_id() -> None:
    """Both re-plan/revert escape paths (review's continue_adjusting and
    reverted's retry_after_revert) must clear fc.test_input_ref and
    fc.verify_run_id -- otherwise the retest after a rebuild reuses the
    FIRST build's stale mock inputs instead of regenerating fresh
    schema-shaped ones. The repair-loop counters go with them: a re-planned
    build must not inherit the previous one's repeat count. Nor the
    unknown-outcome count: after the cap (2) -> keep_draft -> review ->
    re_fix, the new cycle's FIRST unknown outcome would otherwise re-cap
    with "twice in a row"."""
    from services.dify_builder.application.handlers_build import handle_reverted, handle_review

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
        unknown_outcome_count=2,
    )
    turn = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res = handle_review(env, turn, *repo.get_session(s.id))
    assert res.context is not None
    assert res.context.test_input_ref == ""
    assert res.context.verify_run_id == ""
    assert res.context.repair_attempts == 0
    assert res.context.last_repair_error == ""
    assert res.context.unknown_outcome_count == 0

    env2, repo2 = _new_env()
    s2 = _seed_build_session(
        repo2,
        PcState.BUILD_REVERTED,
        requirements={"currency": "USD"},
        test_input_ref="ti-old",
        verify_run_id="run-old",
        repair_attempts=4,
        last_repair_error="boom",
        unknown_outcome_count=2,
    )
    turn2 = Turn(action=Action(kind="re_fix", base_version=1), actor=_actor())
    res2 = handle_reverted(env2, turn2, *repo2.get_session(s2.id))
    assert res2.context is not None
    assert res2.context.test_input_ref == ""
    assert res2.context.verify_run_id == ""
    assert res2.context.repair_attempts == 0
    assert res2.context.last_repair_error == ""
    assert res2.context.unknown_outcome_count == 0


def test_full_build_flow_goal_to_complete() -> None:
    from services.dify_builder.application.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, agent=NativeFlowAgent())
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    # 1) internal start_build -> build.goal_analysis
    goal_action = Action(kind="start_build", base_version=1)
    out = runner.advance(s.id, Turn(action=goal_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_GOAL_ANALYSIS

    # 2) submit_requirements -> build.resource_recommendation directly (the
    # decision-free find_resources gate at build.initial_plan is gone --
    # handle_goal_analysis tail-calls the shared discovery helper itself)
    reqs_action = Action(
        kind="submit_requirements", payload=dict(repo.get_session(s.id)[1].requirements), base_version=out.version
    )
    out = runner.advance(s.id, Turn(action=reqs_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION

    # 3) confirm_resources -> build.plan_approval
    confirm_payload: dict[str, list[str]] = {"resource_ids": []}
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

    # 6) publish_workflow -> build.publish (auto) -> build.complete.
    publish_action = Action(kind="publish_workflow", base_version=out.version)
    out = runner.advance(s.id, Turn(action=publish_action, actor=_actor()))
    assert out.current_state == PcState.BUILD_COMPLETE
    assert dify.published is True

    # ordered card stream: every Build card kind appears, seq-ordered.
    # No "error" kind here: the live test_and_repair run passes (FakeBuildDifyPort
    # defaults verify_pass=True), so no diagnosis/error card is ever staged.
    items = repo.list_conversation(s.id)
    kinds = [i.kind for i in items]
    expected_kinds = ["user", "form", "plan", "resource_select", "test_result"]
    for expected in expected_kinds:
        assert expected in kinds, f"missing card kind {expected}"
    assert not ({"challenge", "checkpoint", "change_set", "summary", "publish", "build_learning"} & set(kinds))
    seqs = [i.seq for i in items]
    assert seqs == sorted(seqs)
    assert any(
        i.kind == "assistant_turn" and "Published workflow version" in english_text(i.payload["reply_text"])
        for i in items
    )


def test_full_build_flow_file_schema_routes_through_testdata_gate_via_fsm() -> None:
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
    from services.dify_builder.application.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, agent=NativeFlowAgent())
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    goal_action = Action(kind="start_build", base_version=1)
    out = runner.advance(s.id, Turn(action=goal_action, actor=_actor()))
    reqs_action = Action(
        kind="submit_requirements", payload=dict(repo.get_session(s.id)[1].requirements), base_version=out.version
    )
    out = runner.advance(s.id, Turn(action=reqs_action, actor=_actor()))
    confirm_payload: dict[str, list[str]] = {"resource_ids": []}
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


def test_full_build_flow_keep_draft_reaches_complete_without_publish() -> None:
    from services.dify_builder.application.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, agent=NativeFlowAgent())
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    goal_action = Action(kind="start_build", base_version=1)
    out = runner.advance(s.id, Turn(action=goal_action, actor=_actor()))
    # submit_requirements now goes straight to build.resource_recommendation
    # (the decision-free find_resources gate at build.initial_plan is gone).
    reqs_action = Action(
        kind="submit_requirements", payload=dict(repo.get_session(s.id)[1].requirements), base_version=out.version
    )
    out = runner.advance(s.id, Turn(action=reqs_action, actor=_actor()))
    confirm_payload: dict[str, list[str]] = {"resource_ids": []}
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
    assert out.current_state == PcState.BUILD_COMPLETE
    assert dify.published is False  # keep_draft skips publish
    assert not any(i.kind == "publish" for i in repo.list_conversation(s.id))


def test_review_continue_adjusting_then_reapprove_is_idempotent() -> None:
    """A fresh adjustment request and re-approval must preserve graph idempotence."""
    from services.dify_builder.application.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, agent=NativeFlowAgent())
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    goal_action = Action(kind="start_build", base_version=1)
    out = runner.advance(s.id, Turn(action=goal_action, actor=_actor()))
    # submit_requirements now goes straight to build.resource_recommendation
    # (the decision-free find_resources gate at build.initial_plan is gone).
    reqs_action = Action(
        kind="submit_requirements", payload=dict(repo.get_session(s.id)[1].requirements), base_version=out.version
    )
    out = runner.advance(s.id, Turn(action=reqs_action, actor=_actor()))
    confirm_payload: dict[str, list[str]] = {"resource_ids": []}
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

    # Continue adjusting collects new requirements before resource discovery.
    plan_cards_before_loop_back = sum(1 for i in repo.list_conversation(s.id) if i.kind == "plan")
    out = runner.advance(s.id, Turn(action=Action(kind="re_fix", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert len(dify.graph["nodes"]) == 4
    assert len(dify.graph["edges"]) == 3
    out = runner.advance(
        s.id,
        Turn(
            action=Action(
                kind="submit_requirements",
                payload={"__builder_adjustment_request": "Keep topology; improve the summary"},
                base_version=out.version,
            ),
            actor=_actor(),
        ),
    )
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    # The adjustment form and its submitted requirements must not duplicate
    # the plan card; resource confirmation below displays it once.
    assert sum(1 for i in repo.list_conversation(s.id) if i.kind == "plan") == plan_cards_before_loop_back

    # confirm_resources -> approve_plan
    confirm_action_2 = Action(kind="confirm_resources", payload=confirm_payload, base_version=out.version)
    out = runner.advance(s.id, Turn(action=confirm_action_2, actor=_actor()))
    assert out.current_state == PcState.BUILD_PLAN_APPROVAL
    # exactly ONE plan card for this whole loop-back pass (new input + discovery
    # + confirm_resources): the same "v1, resources bound" card the
    # straight-through path shows, not two under different version tags.
    plan_cards_after_confirm = [i for i in repo.list_conversation(s.id) if i.kind == "plan"]
    assert len(plan_cards_after_confirm) == plan_cards_before_loop_back + 1
    assert "version_tag" not in plan_cards_after_confirm[-1].payload

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


def test_run_test_prefill_omits_a_placeholder_endpoint_but_keeps_other_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    """ESQ1-302 fix round 1: ``_ground_placeholder_endpoints`` re-points a
    placeholder http-request URL at a required start variable, but the mock
    generator invents just as plausible a URL for a text-input as it does for
    anything else -- pre-filling that field hands the user another invented
    endpoint instead of asking for the real one. It must stay empty, like an
    upload field, while an ordinary text field is still pre-filled."""
    from services.dify_builder.application.handlers_build import handle_execution
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.graph = {
        "nodes": [
            {
                "id": "s",
                "data": {
                    "type": "start",
                    "variables": [
                        {"variable": "topic", "type": "text-input"},
                        {"variable": "h_url", "type": "text-input", "required": True, "max_length": 2048},
                    ],
                },
            },
            {
                "id": "h",
                "data": {"type": "http-request", "title": "Call PPT API", "url": "{{#s.h_url#}}"},
            },
        ],
        "edges": [],
    }

    def generate_mock_inputs(schema: StartSchema, prior_failed: Inputs, *, business_context: str = "") -> Inputs:
        _ = business_context
        _ = schema, prior_failed
        return {"topic": "quarterly report", "h_url": "https://api.example.com/invented"}

    monkeypatch.setattr(env.agent, "generate_mock_inputs", generate_mock_inputs)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_EXECUTION)
    fc = DifyBuilderContext(test_input_ref="")
    result = handle_execution(env, Turn(actor=_actor(), action=Action(kind="run_test")), s, fc)
    assert result.next == PcState.BUILD_AWAIT_TESTDATA
    form = next(i for i in result.items if i.kind == "form")
    assert form.payload["values"] == {"topic": "quarterly report"}  # h_url dropped, topic kept
    assert [f["type"] for f in form.payload["fields"]] == ["text-input", "text-input"]  # both still asked for


def test_run_test_prefill_omits_a_placeholder_credential_but_keeps_other_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The credential counterpart of the placeholder-endpoint prefill guard
    (Task 3): a mocked API key would let the run launch with an invented
    secret and fail deep inside the http-request node instead of at input
    validation -- so, like an invented URL, it must stay empty while an
    ordinary text field is still pre-filled."""
    from services.dify_builder.application.handlers_build import handle_execution
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.graph = {
        "nodes": [
            {
                "id": "s",
                "data": {
                    "type": "start",
                    "variables": [
                        {"variable": "topic", "type": "text-input"},
                        {"variable": "h_api_key", "type": "text-input", "required": True, "max_length": 2048},
                    ],
                },
            },
            {
                "id": "h",
                "data": {
                    "type": "http-request",
                    "title": "Call PPT API",
                    "url": "https://api.acme.com/v1/render",
                    "headers": "Authorization: Bearer {{#s.h_api_key#}}",
                    "params": "",
                    "authorization": {"type": "no-auth", "config": None},
                },
            },
        ],
        "edges": [],
    }

    def generate_mock_inputs(schema: StartSchema, prior_failed: Inputs, *, business_context: str = "") -> Inputs:
        _ = business_context
        _ = schema, prior_failed
        return {"topic": "quarterly report", "h_api_key": "sk-mock-invented"}

    monkeypatch.setattr(env.agent, "generate_mock_inputs", generate_mock_inputs)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_EXECUTION)
    fc = DifyBuilderContext(test_input_ref="")
    result = handle_execution(env, Turn(actor=_actor(), action=Action(kind="run_test")), s, fc)
    assert result.next == PcState.BUILD_AWAIT_TESTDATA
    form = next(i for i in result.items if i.kind == "form")
    assert form.payload["values"] == {"topic": "quarterly report"}  # h_api_key dropped, topic kept
    assert [f["type"] for f in form.payload["fields"]] == ["text-input", "text-input"]  # both still asked for


def test_run_test_still_asks_when_a_file_is_declared_among_other_variables() -> None:
    """Mixed schema: text can be mocked, but the file variable cannot -- the
    gate must still fire so a human can supply the upload."""
    from services.dify_builder.application.handlers_build import handle_execution
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.graph = {
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
    assert result.context is not None
    assert result.context.test_input_ref == ""
    form = next(i for i in result.items if i.kind == "form")
    assert [f["type"] for f in form.payload["fields"]] == ["text-input", "file"]


# ---- ESQ1-302: "mock data" must not invent the endpoint ------------------------


def _endpoint_graph() -> Graph:
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


def _mock_with_an_invented_endpoint(
    schema: StartSchema, prior_failed: Inputs, *, business_context: str = ""
) -> dict[str, str]:
    _ = business_context
    _ = schema, prior_failed
    return {"topic": "quarterly report", "h_url": "https://api.example.com/ppt/generate"}


class _EngineRunDraft:
    """``run_draft`` as the engine behaves on ``_endpoint_graph``: a missing
    required start variable is rejected at launch
    (``base_app_generator._validate_inputs``), while ANY supplied URL -- a mocked
    one included -- is accepted and the http-request node then fails on
    connection (``ssrf_proxy``'s retry error)."""

    def __init__(self, graph: Graph) -> None:
        start = next(n for n in graph["nodes"] if n["data"]["type"] == "start")
        self.required = [v["variable"] for v in start["data"]["variables"] if v.get("required")]
        self.seen_inputs: list[dict[str, object]] = []

    def __call__(
        self, app_id: str, actor: Actor, inputs: Inputs, on_event: Callable[[NodeEvent], None], **_kw: object
    ) -> Run:
        _ = app_id, actor, on_event
        from core.dify_builder.models import NodeOutput, Run

        self.seen_inputs.append(dict(inputs))
        for name in self.required:
            if inputs.get(name) is None:
                raise ValueError(f"{name} is required in input form")
        error = f"Reached maximum retries (3) for URL {inputs['h_url']}"
        return Run(
            dify_run_id="build-run-1",
            status="failed",
            per_node=[NodeOutput(node_id="h", status="failed", error=error)],
        )


def test_mock_inputs_route_a_missing_endpoint_back_to_the_testdata_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    """ESQ1-302's repair thrash: "use mock data" invented a URL for the endpoint
    variable, the engine accepted it, the node failed on connection, and
    ``is_input_failure`` (rightly) called that a config failure -- so the flow
    went to the config-repair gate, which cannot fix a host that does not
    exist. With the endpoint left out, the launch fails on the INPUT and the
    user is asked for the real URL."""
    from services.dify_builder.application.handlers_build import handle_await_testdata, handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env()
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.graph = _endpoint_graph()
    engine = _EngineRunDraft(env.fake_dify.graph)
    monkeypatch.setattr(env.fake_dify, "run_draft", engine)
    monkeypatch.setattr(env.agent, "generate_mock_inputs", _mock_with_an_invented_endpoint)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_AWAIT_TESTDATA)
    mocked = handle_await_testdata(
        env,
        Turn(actor=_actor(), action=Action(kind="provide_testdata", payload={"mode": "mock"})),
        s,
        DifyBuilderContext(built_node_ids=["s", "h", "e"]),
    )

    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    assert mocked.context is not None
    result = handle_test_and_repair(env, Turn(actor=_actor()), s, mocked.context)

    assert engine.seen_inputs == [{"topic": "quarterly report"}]
    assert result.next == PcState.BUILD_AWAIT_REPAIR
    assert result.run is not None
    assert "h_url is required in input form" in (result.run.error or "")
    assert result.context is not None
    assert result.context.staged_repair == []
    assert (
        next(i for i in result.items if i.kind == "test_result").payload["safety_outcome"]
        == "execution_evidence_unknown"
    )


def test_execution_revert_then_retry_after_revert_reapprove_is_idempotent() -> None:
    """Same idempotency path via the revert -> reverted -> retry_after_revert
    loop (handle_reverted's re_fix), not continue_adjusting. re_fix lands on
    build.initial_plan, which is a working/pass-through state (state.py) that
    falls straight through to build.resource_recommendation in the same
    advance() call, with no find_resources action needed."""
    from services.dify_builder.application.handlers_build import build_registry
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, agent=NativeFlowAgent())
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK)
    runner = Runner(env, build_registry())

    out = runner.advance(s.id, Turn(action=Action(kind="start_build", base_version=1), actor=_actor()))
    # submit_requirements now goes straight to build.resource_recommendation
    # (the decision-free find_resources gate at build.initial_plan is gone).
    out = runner.advance(
        s.id,
        Turn(
            action=Action(
                kind="submit_requirements",
                payload=dict(repo.get_session(s.id)[1].requirements),
                base_version=out.version,
            ),
            actor=_actor(),
        ),
    )
    confirm_payload: dict[str, list[str]] = {"resource_ids": []}
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


def test_recovery_continue_reruns_interrupted_publish_step() -> None:
    """An interrupted build.publish recovered via recovery_continue must re-run
    handle_publish (the runner falls through because build.publish is a working
    state) and advance to build.governance_feedback -- not stay wedged."""
    from services.dify_builder.application.handlers_build import build_registry
    from services.dify_builder.application.runner import Runner
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify)
    s = _seed_build_session(repo, PcState.BUILD_PUBLISH, plan_items=["x"], built_node_ids=["start_1"])
    from tests.unit_tests.core.dify_builder.fakes import seed_verified_run

    seed_verified_run(repo, s, env.fake_dify)
    runner = Runner(env, build_registry())

    runner.advance(s.id, Turn(action=Action(kind="recovery_continue", base_version=s.version), actor=_actor()))

    reloaded, _fc = repo.get_session(s.id)
    assert reloaded.current_state != PcState.BUILD_PUBLISH  # advanced, not wedged
    assert dify.published is True  # handle_publish re-ran (FakeBuildDifyPort records publish)


def test_recovery_restart_resets_interrupted_step_to_entry_state() -> None:
    from core.dify_builder.models import EntryMode
    from services.dify_builder.application.handlers_build import build_registry
    from services.dify_builder.application.recovery import entry_state_for
    from services.dify_builder.application.runner import Runner
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, repo = _new_env(dify=FakeBuildDifyPort())
    s = _seed_build_session(
        repo, PcState.BUILD_PUBLISH, plan_items=["x"], staged_repair=[MutationIntent(op="set_node_config")]
    )
    Runner(env, build_registry()).advance(
        s.id, Turn(action=Action(kind="recovery_restart", base_version=s.version), actor=_actor())
    )
    reloaded, fc = repo.get_session(s.id)
    assert entry_state_for(EntryMode.BUILD) == PcState.BUILD_CAPABILITY_CHECK
    assert reloaded.current_state == PcState.BUILD_GOAL_ANALYSIS  # automatic entry step already completed
    assert fc.staged_repair == []  # working fields reset


class _NamingAgent(PlaceholderAgent):
    """Placeholder cognition plus a model that has an opinion about the name."""

    def __init__(self, proposal: str = "Expense reimbursement approval") -> None:
        self.proposal = proposal
        self.calls: list[tuple[str, dict[str, object]]] = []

    @override
    def propose_app_name(self, goal_text: str, requirements: dict[str, object]) -> str:
        self.calls.append((goal_text, dict(requirements)))
        return self.proposal


def _run_capability_check(
    agent: DifyBuilderAgent, *, app_name_auto: bool, rename_app: Callable[[str], str] | None = None
) -> DifyBuilderContext:
    from services.dify_builder.application.handlers_build import build_registry

    env, repo = _new_env(agent=agent)
    env.rename_app = rename_app
    s = _seed_build_session(repo, PcState.BUILD_CAPABILITY_CHECK, goal_text="x", app_name_auto=app_name_auto)
    runner = Runner(env, build_registry())
    runner.advance(s.id, Turn(action=Action(kind="start_build", base_version=1), actor=_actor()))
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


def test_goal_analysis_renames_an_app_still_carrying_its_derived_name() -> None:
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


def test_an_app_named_by_its_user_is_never_renamed() -> None:
    agent = _NamingAgent()
    renamer = _Renamer()
    fc = _run_capability_check(agent, app_name_auto=False, rename_app=renamer)

    assert renamer.calls == []
    assert agent.calls == []
    assert fc.app_name_auto is False


class _ResourceAgent(PlaceholderAgent):
    def __init__(self, options: list[ResourceOption]) -> None:
        self.options = options

    @override
    def discover_resources(
        self,
        plan_items: list[str],
        *,
        goal_text: str,
        requirements: dict[str, object],
        reply_language: str | None = None,
    ) -> list[ResourceOption]:
        return self.options


def _find_resources(options: list[ResourceOption]) -> StepResult:
    from services.dify_builder.application.handlers_build import handle_initial_plan

    env, repo = _new_env(agent=_ResourceAgent(options))
    s = _seed_build_session(repo, PcState.BUILD_INITIAL_PLAN, plan_items=["Send a notification"])
    turn = Turn(action=Action(kind="find_resources", base_version=1), actor=_actor())
    return handle_initial_plan(env, turn, *repo.get_session(s.id))


def test_an_empty_recommendation_is_explained_rather_than_shown_blank() -> None:
    res = _find_resources([])

    card = next(i for i in res.items if i.kind == "resource_select")
    assert card.payload["recommended"] == []
    description = english_text(card.payload["description"])
    assert "No resource recommendations are available" in description
    assert "Confirm to continue" in description
    assert not any(i.kind == "notice" for i in res.items)


class _GapAgent(PlaceholderAgent):
    def __init__(self, options: list[ResourceOption], gap: str) -> None:
        self.options = options
        self.gap = gap

    @override
    def discover_resources(
        self,
        plan_items: list[str],
        *,
        goal_text: str,
        requirements: dict[str, object],
        reply_language: str | None = None,
    ) -> list[ResourceOption]:
        return self.options

    @override
    def assess_capability_gap(
        self, plan_items: list[str], options: list[ResourceOption], *, goal_text: str, requirements: dict[str, object]
    ) -> str:
        return self.gap


def _find_resources_with_agent(agent: DifyBuilderAgent) -> StepResult:
    from services.dify_builder.application.handlers_build import handle_initial_plan

    env, repo = _new_env(agent=agent)
    s = _seed_build_session(repo, PcState.BUILD_INITIAL_PLAN, plan_items=["Send a notification"])
    turn = Turn(action=Action(kind="find_resources", base_version=1), actor=_actor())
    return handle_initial_plan(env, turn, *repo.get_session(s.id))


def test_a_named_capability_gap_is_surfaced_in_the_reply() -> None:
    from core.dify_builder.contract import ResourceOption

    options = [ResourceOption(id="kb-1", label="KB", meta="", kind="knowledge", readiness="ready")]
    res = _find_resources_with_agent(_GapAgent(options, "Nothing installed can send email."))

    reply = next(i for i in res.items if i.kind == "assistant_turn")
    assert english_text(reply.payload["reply_text"]).endswith("Nothing installed can send email.")
    assert reply.payload["reply_mode"] == "complete"
    assert not any(i.kind == "notice" for i in res.items)


def test_a_missing_config_tool_still_lets_the_gap_agent_report_a_gap() -> None:
    # readiness is threaded through to the agent unmodified -- the handler
    # itself makes no readiness judgment, it only relays what the agent says.
    from core.dify_builder.contract import ResourceOption

    options = [ResourceOption(id="tool-1", label="Slack", meta="", kind="plugin", readiness="missing_config")]
    res = _find_resources_with_agent(_GapAgent(options, "Nothing installed can send a Slack message."))

    reply = next(i for i in res.items if i.kind == "assistant_turn")
    assert english_text(reply.payload["reply_text"]).endswith("Nothing installed can send a Slack message.")
    card = next(i for i in res.items if i.kind == "resource_select")
    assert card.payload["recommended"][0]["readiness"] == "missing_config"


def test_await_repair_refuses_to_apply_an_empty_staged_repair() -> None:
    """ESQ1-291: approving a zero-intent repair re-tested and re-offered
    forever. With nothing staged there is nothing to approve."""
    from services.dify_builder.application.handlers_build import handle_await_repair

    env, repo = _new_env()
    s = _seed_build_session(repo, PcState.BUILD_AWAIT_REPAIR)
    fc = DifyBuilderContext()
    fc.staged_repair = []

    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())
    out = handle_await_repair(env, turn, s, fc)

    assert out.next == PcState.BUILD_AWAIT_REPAIR
    assert out.context is not None
    assert out.context.repair_attempts == 0
    assert [item.kind for item in out.items] == ["assistant_turn"]
    assert out.items[0].payload["reply_mode"] == "complete"
    assert "No fix is staged" in english_text(out.items[0].payload["reply_text"])
    assert not env.fake_dify.applied


def test_await_repair_surfaces_a_stale_intent_instead_of_failing_the_session() -> None:
    """ESQ1-271: apply_repair re-validates against the draft as it is NOW, so
    a path that was applicable at propose time can raise at approve time. An
    uncaught ValueError reaches the runner and drives the session to FAILED."""
    from core.dify_builder.models import MutationIntent
    from services.dify_builder.application.handlers_build import handle_await_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    class _StaleDifyPort(FakeBuildDifyPort):
        @override
        def apply_repair(self, *_args: object, **_kwargs: object) -> ApplyResult:
            raise ValueError("path 'memory.window.size': no key 'memory' at memory")

    env, repo = _new_env()
    env.fake_dify = _StaleDifyPort()
    s = _seed_build_session(repo, PcState.BUILD_AWAIT_REPAIR)
    fc = DifyBuilderContext(
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "m.w", "value": 1})]
    )

    out = handle_await_repair(env, Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor()), s, fc)

    assert out.next == PcState.BUILD_AWAIT_REPAIR  # not a dead session
    assert not any(i.kind == "error" for i in out.items)
    assistant = next(i for i in out.items if i.kind == "assistant_turn")
    assert "Couldn't apply the fix" in english_text(assistant.payload["reply_text"])
    assert "no key 'memory'" in english_text(assistant.payload["reply_text"])
    assert out.context is not None
    assert out.context.staged_repair == []  # engages the empty-repair guard


def test_await_repair_says_a_fix_that_would_not_start_is_not_a_stale_fix() -> None:
    """The preflight rejects a fix that APPLIED fine but would leave a draft
    that fails at Graph.init. "The proposed fix no longer applies" is wrong
    for that -- nothing about the draft moved. Same recovery as a stale
    intent (nothing written, the fix dropped, stay at the gate), true reason."""
    from core.dify_builder.errors import DraftWouldNotStartError
    from core.dify_builder.models import MutationIntent
    from services.dify_builder.application.handlers_build import handle_await_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    class _WouldNotStartDifyPort(FakeBuildDifyPort):
        @override
        def apply_repair(self, *_args: object, **_kwargs: object) -> ApplyResult:
            raise DraftWouldNotStartError("the draft would not start: node 'llm' (llm): 1 validation error")

    env, repo = _new_env()
    env.fake_dify = _WouldNotStartDifyPort()
    s = _seed_build_session(repo, PcState.BUILD_AWAIT_REPAIR)
    fc = DifyBuilderContext(
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "llm", "path": "m.w", "value": 1})]
    )

    out = handle_await_repair(env, Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor()), s, fc)

    assert out.next == PcState.BUILD_AWAIT_REPAIR
    assistant = next(i for i in out.items if i.kind == "assistant_turn")
    assert "The workflow can't start" in english_text(assistant.payload["reply_text"])
    assert "the draft would not start: node 'llm' (llm): 1 validation error" in english_text(
        assistant.payload["reply_text"]
    )
    assert assistant.payload["execution"]["status"] == "error"
    assert out.context is not None
    assert out.context.staged_repair == []


def test_test_and_repair_stops_offering_a_repair_through_the_handler() -> None:
    """Integration coverage for the OFFER-time wiring: drive the repeated-
    failure branch through handle_test_and_repair itself (not by calling
    _repair_is_repeating directly), so a regression that re-disconnects the
    guard from the handler (e.g. the dead-on-reload bug fixed in
    services/dify_builder/serde.py) would show up here even if the unit
    tests for _repair_is_repeating still pass in isolation."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import _MAX_REPEATED_REPAIRS, handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, _ = _new_env(agent=StubAgent())  # StubAgent.diagnose always returns the same root_cause
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.verify_pass = False  # default error "boom" -> config, not input
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
    assert result.context is not None
    assert result.context.staged_repair == []  # cleared -- no repair offered on the 3rd identical failure
    assert not any(i.kind == "error" for i in result.items)
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert "stopped retrying" in english_text(assistant.payload["reply_text"])
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


def _failed_run(node_id: str, error: str, launch_error: str = "") -> Run:
    from core.dify_builder.models import NodeOutput, Run

    return Run(
        id="r-1",
        verification=failed_verification(FakeBuildDifyPort()),
        status="failed",
        per_node=[NodeOutput(node_id=node_id, status="failed", error=error)] if node_id else [],
        error=launch_error,
    )


def test_breaker_fires_through_the_handler_although_diagnoses_are_reworded() -> None:
    """THE regression test for the live bug, driven through the real handler.

    The engine fails identically every turn while the diagnosing agent rewords
    its root_cause each call -- exactly what production does, including the
    mid-session switch to Chinese. Against the prose-keyed implementation the
    counter never increments and this never trips, which is precisely how a
    real session burned 9 runs and 8 approvals."""
    from core.dify_builder.models import Diagnosis, TestInput
    from services.dify_builder.application.handlers_build import _MAX_REPEATED_REPAIRS, handle_test_and_repair
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

        @override
        def diagnose(
            self, failed_run: Run, graph: Graph, node_outputs: list[NodeOutput], *, reply_language: str | None = None
        ) -> Diagnosis:
            wording = wordings[min(self.calls, len(wordings) - 1)]
            self.calls += 1
            return Diagnosis(culprit_node_id="output", root_cause=wording, severity="high")

    env, _ = _new_env(agent=RewordingAgent())
    env.fake_dify = FakeBuildDifyPort()
    env.fake_dify.verify_pass = False  # the engine fails the same way every time
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    result = None
    for _ in range(_MAX_REPEATED_REPAIRS + 1):
        result = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
        assert result.context is not None
        fc = result.context

    assert fc.repair_attempts >= _MAX_REPEATED_REPAIRS
    assert fc.staged_repair == []  # no fourth repair offered
    assert result is not None
    assert not any(i.kind == "error" for i in result.items)
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert "stopped retrying" in english_text(assistant.payload["reply_text"])


def test_breaker_restarts_when_the_engine_failure_actually_changes() -> None:
    """A genuinely different failure means the last repair achieved something,
    so the count must restart even though it is still failing."""
    from services.dify_builder.application.handlers_build import _note_repair_error, _repair_is_repeating

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


def _graph_with(*nodes: tuple[str, str]) -> Graph:
    return {"nodes": [{"id": nid, "data": {"type": ntype}} for nid, ntype in nodes], "edges": []}


def _stub_agent_building(intents: list[MutationIntent]) -> StubAgent:
    from tests.unit_tests.core.dify_builder.fakes import StubAgent

    class _Agent(StubAgent):
        @override
        def build_nodes(
            self,
            plan_items: list[str],
            resource_ids: list[str] | None = None,
            *,
            trusted_text: str = "",
            plan_approved: bool = False,
            reply_language: str | None = None,
        ) -> BuildNodesResult:
            return BuildNodesResult(intents=list(intents))

    return _Agent()


def _create(node_id: str, node_type: str) -> MutationIntent:
    from core.dify_builder.models import MutationIntent

    return MutationIntent(op="create_node", args={"node_id": node_id, "node_type": node_type, "config": {}})


def test_first_build_that_applies_nothing_reports_honestly() -> None:
    """A new session over an app that already holds node1/node2 from an earlier
    build must NOT say "graph built" while leaving the canvas untouched."""
    from services.dify_builder.application.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    env, _ = _new_env(agent=_stub_agent_building([_create("node1", "start"), _create("node2", "llm")]))
    env.fake_dify = FakeBuildDifyPort()
    # the app already carries a PREVIOUS build under the same generated ids
    env.fake_dify.graph = _graph_with(("node1", "start"), ("node2", "parameter-extractor"))
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_PLAN_APPROVAL)
    fc = DifyBuilderContext(plan_items=["x"])  # built_node_ids empty -> FIRST build

    result = handle_plan_approval(env, Turn(action=Action(kind="approve_repair"), actor=_actor()), s, fc)

    assert result.next == PcState.BUILD_PLAN_APPROVAL  # not advanced to execution
    assert not any(i.kind == "error" for i in result.items)
    assistant = next(i for i in result.items if i.kind == "assistant_turn")
    assert "already" in english_text(assistant.payload["reply_text"]).lower()
    assert not any(i.kind == "change_set" for i in result.items)  # no "graph built" claim


# The Run the port now produces for the ESQ1-302 error frame (Tasks 1-2): no
# rows, no run id, the pydantic text (whitespace-collapsed, code appended).
_ESQ1_302_LAUNCH_ERROR = (
    "2 validation errors for HttpRequestNodeData body.data.0.type Field required [type=missing, "
    "input_value={'value': '{{#node3.text#}}', 'key': 'slides'}, input_type=dict] For further "
    "information visit https://errors.pydantic.dev/2.12/v/missing [invalid_param]"
)


def _esq1_302_launch_failed_run(*_a: object, **_k: object) -> Run:
    from core.dify_builder.models import Run

    return Run(
        kind="verify", immutable=True, dify_run_id="", status="failed", per_node=[], error=_ESQ1_302_LAUNCH_ERROR
    )


def test_launch_error_without_native_proof_never_stages_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    """Repeated launch errors retain their text and stay at review without diagnosis."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import (
        _MAX_REPEATED_REPAIRS,
        _failure_signature,
        handle_test_and_repair,
    )
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, StubAgent

    env, _ = _new_env(agent=StubAgent())
    env.fake_dify = FakeBuildDifyPort()
    monkeypatch.setattr(env.fake_dify, "run_draft", _esq1_302_launch_failed_run)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    results = []
    snapshots = []  # the handler mutates the SAME context object in place; snapshot per call
    for _ in range(_MAX_REPEATED_REPAIRS + 1):
        res = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
        assert res.context is not None
        fc = res.context
        results.append(res)
        snapshots.append((fc.repair_attempts, len(fc.staged_repair), fc.last_repair_error))

    signature = _failure_signature(_esq1_302_launch_failed_run())
    assert signature.startswith("|2 validation errors")
    for res, (_attempts, staged, last) in zip(results[:-1], snapshots[:-1], strict=True):
        assert res.next == PcState.BUILD_AWAIT_REPAIR
        assert res.run is not None
        assert res.run.error == _ESQ1_302_LAUNCH_ERROR  # kept on the persisted Run
        assert "notice" not in [i.kind for i in res.items]  # NOT the unknown-outcome bounce
        assert staged == 0  # Missing native proof cannot authorize repair.
        assert last == ""
    assert [attempts for attempts, _, _ in snapshots] == [0, 0, 0]
    final = results[-1]
    assert final.context is not None
    assert final.context.staged_repair == []
    assert "Execution safety requires review" in english_text(
        next(i for i in final.items if i.kind == "assistant_turn").payload["reply_text"]
    )


def test_plan_approval_surfaces_a_draft_that_would_not_start_instead_of_crashing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``apply_repair`` now dry-validates the graph it is about to write and
    raises ``PreflightError`` (a ``DraftWouldNotStartError``). Before this, the error left
    the handler uncaught and the advance died mid-step; now it is a reply and
    the plan stays approvable, so re-approving regenerates the graph.

    The rejected graph never commits, so there is no canvas change or
    checkpoint restore notification."""
    from core.dify_builder.errors import DraftWouldNotStartError
    from services.dify_builder.application.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()

    def would_not_start(*_a: object, **_k: object) -> NoReturn:
        raise DraftWouldNotStartError(
            "the draft would not start: node 'llm' (llm): 2 validation errors for LLMNodeData"
        )

    monkeypatch.setattr(dify, "apply_repair", would_not_start)
    events: list[dict[str, object]] = []
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_build_session(
        repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve", "Summarize"], plan_version_tag="v1"
    )
    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())

    res = handle_plan_approval(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.BUILD_PLAN_APPROVAL
    assert res.context is not None
    assert res.context.built_node_ids == []
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert assistant.payload["execution"]["status"] == "error"
    assert "The workflow can't start" in english_text(assistant.payload["reply_text"])
    assert "node 'llm' (llm)" in english_text(assistant.payload["reply_text"])
    # Rejected mutations emit no graph notification.
    assert events == []


def test_plan_approval_does_not_call_an_unapplicable_graph_a_workflow_that_cannot_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A graph_ops rejection ("node not found") is a ValueError too, but the
    draft was never checked for startability -- the generated intents just
    did not apply. Calling that "The workflow can't start" sends the user
    looking for a broken node that does not exist. Same recovery (nothing
    written, no canvas notification, plan still approvable), honest
    reason."""
    from services.dify_builder.application.handlers_build import handle_plan_approval
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()

    def does_not_apply(*_a: object, **_k: object) -> NoReturn:
        raise ValueError("node not found: x")

    monkeypatch.setattr(dify, "apply_repair", does_not_apply)
    events: list[dict[str, object]] = []
    env, repo = _new_env(dify=dify, emit_canvas=events.append)
    s = _seed_build_session(
        repo, PcState.BUILD_PLAN_APPROVAL, plan_items=["Retrieve", "Summarize"], plan_version_tag="v1"
    )
    turn = Turn(action=Action(kind="approve_repair", base_version=1), actor=_actor())

    res = handle_plan_approval(env, turn, *repo.get_session(s.id))

    assert res.next == PcState.BUILD_PLAN_APPROVAL
    assert res.context is not None
    assert res.context.built_node_ids == []
    assistant = next(i for i in res.items if i.kind == "assistant_turn")
    assert assistant.payload["execution"]["status"] == "error"
    assert "Couldn't apply the workflow" in english_text(assistant.payload["reply_text"])
    assert "node not found: x" in english_text(assistant.payload["reply_text"])
    assert events == []


# The ESQ1-303 shape: start -> if-else -> (two arms) -> end. With both if-else
# edges on undeclared handles the engine skips both arms, reaches no End, and
# reports ``succeeded`` with ``outputs={}`` -- which the handler called
# "All checks passed".
_BRANCHING_GRAPH: Graph = {
    "nodes": [
        {"id": "node1", "data": {"type": "start", "title": "Start", "variables": []}},
        {
            "id": "node2",
            "data": {"type": "if-else", "title": "Check", "cases": [{"case_id": "true", "conditions": []}]},
        },
        {"id": "node3", "data": {"type": "template-transform", "title": "A", "template": "a", "variables": []}},
        {"id": "node6", "data": {"type": "end", "title": "End", "outputs": []}},
    ],
    "edges": [
        {"source": "node1", "target": "node2", "sourceHandle": "source"},
        {"source": "node2", "target": "node3", "sourceHandle": "score_equals_60"},
        {"source": "node3", "target": "node6", "sourceHandle": "source"},
    ],
}


def _succeeded_run(per_node_ids: list[str]) -> Callable[..., Run]:
    from core.dify_builder.models import NodeOutput, Run

    def run_draft(*_a: object, **_k: object) -> Run:
        return Run(
            kind="verify",
            immutable=True,
            dify_run_id="run-303",
            verification=successful_verification(FakeBuildDifyPort(), no_output=per_node_ids == ["node1", "node2"]),
            status="succeeded",
            per_node=[NodeOutput(node_id=i, status="succeeded", outputs={}) for i in per_node_ids],
        )

    return run_draft


def test_a_succeeded_run_that_took_a_branch_and_reached_no_end_is_not_a_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    """ESQ1-303's silent false pass. The engine reported ``succeeded`` because
    nothing failed; only node1 and node2 ran. That is not "All checks passed"."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    events: list[dict[str, object]] = []
    dify = FakeBuildDifyPort()
    dify.graph = _BRANCHING_GRAPH
    monkeypatch.setattr(dify, "run_draft", _succeeded_run(["node1", "node2"]))
    env, _ = _new_env(dify=dify, emit_canvas=events.append)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))

    res = handle_test_and_repair(env, Turn(actor=_actor()), s, DifyBuilderContext(test_input_ref="ti-1"))

    assert res.next == PcState.BUILD_AWAIT_REPAIR
    assert res.context is not None
    assert res.context.staged_repair == []  # nothing to diagnose: the engine reported no error
    test_result = next(i for i in res.items if i.kind == "test_result")
    assert test_result.payload["status"] == "failed"
    assert "produced no terminal output" in english_text(test_result.payload["failure_reason"])
    assert res.run is not None
    assert res.run.culprit_node_id == "node2"  # the branch node that routed nowhere
    assert "All checks passed" not in english_text(
        next(i for i in res.items if i.kind == "assistant_turn").payload["reply_text"]
    )
    assert test_result.payload["dify_run_id"] == "run-303"
    assert events == []


# Fix round 1 (reviewer Important #1): a legitimate side-effect-only arm that
# ran to completion is NOT a dead end, even though it has no End node of its
# own -- its nodes show up in per_node, so the branch node (node2) did route
# somewhere. Two arms: node2 -> node3 -> node4 (side effect, no End) and
# node2 -> node5 (End).
_SIDE_EFFECT_ARM_GRAPH: Graph = {
    "nodes": [
        {"id": "node1", "data": {"type": "start", "title": "Start", "variables": []}},
        {
            "id": "node2",
            "data": {"type": "if-else", "title": "Check", "cases": [{"case_id": "true", "conditions": []}]},
        },
        {"id": "node3", "data": {"type": "template-transform", "title": "Prep", "template": "a", "variables": []}},
        {"id": "node4", "data": {"type": "http-request", "title": "Notify", "method": "get", "url": "https://x"}},
        {"id": "node5", "data": {"type": "end", "title": "End", "outputs": []}},
    ],
    "edges": [
        {"source": "node1", "target": "node2", "sourceHandle": "source"},
        {"source": "node2", "target": "node3", "sourceHandle": "true"},
        {"source": "node3", "target": "node4", "sourceHandle": "source"},
        {"source": "node2", "target": "node5", "sourceHandle": "false"},
    ],
}


def test_a_side_effect_only_arm_that_ran_to_completion_is_still_a_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reviewer Important #1: the run took node2's true-arm through to node4
    (a side-effect node with no End of its own) and never touched node5's End
    -- but node3/node4 DO appear in per_node, so node2 did not route nowhere.
    This must stay green, unlike the genuine ESQ1-303 dead end above."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()
    dify.graph = _SIDE_EFFECT_ARM_GRAPH
    monkeypatch.setattr(dify, "run_draft", _succeeded_run(["node1", "node2", "node3", "node4"]))
    env, _ = _new_env(dify=dify)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))

    res = handle_test_and_repair(env, Turn(actor=_actor()), s, DifyBuilderContext(test_input_ref="ti-1"))

    assert res.next == PcState.BUILD_REVIEW
    assert next(i for i in res.items if i.kind == "test_result").payload["status"] == "succeeded"


# Reviewer Important #2: error_strategy == "fail-branch" is not a router --
# a node that actually took its fail branch reports "exception", not
# "succeeded". A succeeded fail-branch node in an otherwise-linear graph must
# not be treated as a branch node at all.
_FAIL_BRANCH_LINEAR_GRAPH: Graph = {
    "nodes": [
        {"id": "node1", "data": {"type": "start", "title": "Start", "variables": []}},
        {"id": "node2", "data": {"type": "llm", "title": "LLM", "error_strategy": "fail-branch"}},
        {"id": "node6", "data": {"type": "end", "title": "End", "outputs": []}},
    ],
    "edges": [
        {"source": "node1", "target": "node2", "sourceHandle": "source"},
        {"source": "node2", "target": "node6", "sourceHandle": "source"},
    ],
}


def _unknown_outcome_run(*_a: object, **_k: object) -> Run:
    from core.dify_builder.models import Run
    from services.dify_builder.run_mapping import TRUNCATED_STREAM_ERROR

    return Run(
        kind="verify", immutable=True, dify_run_id="", status="running", per_node=[], error=TRUNCATED_STREAM_ERROR
    )


def test_unknown_outcome_requires_review_on_every_attempt(monkeypatch: pytest.MonkeyPatch) -> None:
    """Missing execution proof stops immediately at review on each attempt."""
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from services.dify_builder.application.handlers_fix import MAX_UNKNOWN_OUTCOMES
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    assert MAX_UNKNOWN_OUTCOMES == 2
    dify = FakeBuildDifyPort()
    monkeypatch.setattr(dify, "run_draft", _unknown_outcome_run)
    env, _ = _new_env(dify=dify)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))
    fc = DifyBuilderContext(test_input_ref="ti-1")

    first = handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert first.next == PcState.BUILD_AWAIT_REPAIR  # Missing proof stops immediately.
    assert first.context is not None
    assert first.context.unknown_outcome_count == 0
    assert "Execution safety requires review" in english_text(
        next(i for i in first.items if i.kind == "assistant_turn").payload["reply_text"]
    )

    assert first.context is not None
    second = handle_test_and_repair(env, Turn(actor=_actor()), s, first.context)
    assert second.next == PcState.BUILD_AWAIT_REPAIR
    assert second.context is not None
    assert second.context.unknown_outcome_count == 0
    assert second.context.staged_repair == []
    assert "Execution safety requires review" in english_text(
        next(i for i in second.items if i.kind == "assistant_turn").payload["reply_text"]
    )


def test_a_determinate_outcome_resets_the_unknown_outcome_count() -> None:
    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort

    dify = FakeBuildDifyPort()  # verify_pass=True: a real, determinate success
    env, _ = _new_env(dify=dify)
    s = _session(entry_mode=EntryMode.BUILD, current_state=PcState.BUILD_TEST_AND_REPAIR)
    env.repo.save_test_input(TestInput(id="ti-1", session_id=s.id, source="mock", inputs={}))

    res = handle_test_and_repair(
        env, Turn(actor=_actor()), s, DifyBuilderContext(test_input_ref="ti-1", unknown_outcome_count=1)
    )

    assert res.next == PcState.BUILD_REVIEW
    assert res.context is not None
    assert res.context.unknown_outcome_count == 0


def test_default_build_test_never_passes_consent_even_with_a_pending_reference(monkeypatch: pytest.MonkeyPatch) -> None:
    from collections.abc import Callable, Mapping

    from core.dify_builder.models import Inputs, NodeEvent, Run
    from services.dify_builder.application.handlers_build import handle_test_and_repair
    from tests.unit_tests.core.dify_builder.fakes import saved_test_context

    env, repo = _new_env()
    s = _session(current_state=PcState.BUILD_TEST_AND_REPAIR)
    fc = saved_test_context(repo, s.id, confirmed_consent_id="consent-1", confirmed_command_id="command-1")
    seen: list[tuple[str | None, str | None]] = []
    native = env.fake_dify.run_draft

    def recording_run_draft(
        app_id: str,
        actor: Actor,
        inputs: Inputs,
        on_event: Callable[[NodeEvent], None],
        *,
        session_id: str,
        test_input_id: str,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None = None,
        confirmed_consent_id: str | None = None,
        command_id: str | None = None,
        effect_confirmation: Mapping[str, str] | None = None,
    ) -> Run:
        seen.append((confirmed_consent_id, command_id))
        return native(
            app_id,
            actor,
            inputs,
            on_event,
            session_id=session_id,
            test_input_id=test_input_id,
            on_workflow_event=on_workflow_event,
            effect_confirmation=effect_confirmation,
        )

    monkeypatch.setattr(env.fake_dify, "run_draft", recording_run_draft)
    handle_test_and_repair(env, Turn(actor=_actor()), s, fc)
    assert seen == [(None, None)]


def test_failed_inventory_is_not_reported_as_no_matching_resources() -> None:
    from services.dify_builder.application.handlers_build import handle_initial_plan

    env, repo = _new_env(agent=_ResourceAgent([]))
    env.diagnostics.append({"code": "inventory_unavailable"})
    s = _seed_build_session(repo, PcState.BUILD_INITIAL_PLAN, plan_items=["Send a notification"])
    turn = Turn(action=Action(kind="find_resources", base_version=1), actor=_actor())
    res = handle_initial_plan(env, turn, *repo.get_session(s.id))
    card = next(i for i in res.items if i.kind == "resource_select")
    assert card.payload["description"]["id"] == "resources.catalogueUnavailable"


@pytest.mark.parametrize("entry", ["capability", "requirements", "resources", "reverted"])
def test_later_planner_questions_return_to_requirements_without_writes(
    monkeypatch: pytest.MonkeyPatch, entry: str
) -> None:
    from services.dify_builder.application import handlers_build
    from services.dify_builder.plan import BuildClarification

    clarification = BuildClarification(
        fields=[
            {
                "key": "missing_rate",
                "label": "Missing rate",
                "type": "select",
                "options": ["Reject", "Skip"],
                "required": True,
            }
        ],
        values={"missing_rate": "Reject"},
    )
    env, _ = _new_env(dify=FakeBuildDifyPort(), agent=NativeFlowAgent())
    monkeypatch.setattr(env.agent, "analyze_goal", lambda *_a, **_kw: {"fields": [], "values": {"currency": "USD"}})
    monkeypatch.setattr(env.agent, "propose_plan_v1", lambda *_a, **_kw: clarification)
    monkeypatch.setattr(env.agent, "reconcile_resource_plan", lambda *_a, **_kw: clarification)
    monkeypatch.setattr(env.agent, "build_nodes", lambda *_a, **_kw: pytest.fail("clarification must not generate"))
    fc = DifyBuilderContext(
        goal_text="Settle orders after approval",
        requirements={"currency": "USD"},
        confirmed_requirement_keys=["currency"],
        plan_items=["Previous plan"],
        resource_selection={"resource_ids": ["model:chosen"]},
    )
    handlers: dict[str, tuple[Handler, str, Inputs]] = {
        "capability": (handlers_build.handle_capability_check, "", {}),
        "requirements": (handlers_build.handle_goal_analysis, "submit_requirements", {}),
        "resources": (
            handlers_build.handle_resource_recommendation,
            "confirm_resources",
            {"resource_ids": ["model:chosen"]},
        ),
        "reverted": (handlers_build.handle_reverted, "re_fix", {}),
    }
    handler, kind, payload = handlers[entry]
    result = handler(env, Turn(action=Action(kind=kind, payload=payload), actor=_actor()), _session(), fc)

    assert result.next == PcState.BUILD_GOAL_ANALYSIS
    assert fc.goal_text == "Settle orders after approval"
    assert fc.requirements == {"currency": "USD", "missing_rate": "Reject"}
    assert fc.confirmed_requirement_keys == ([] if entry == "capability" else ["currency"])
    assert fc.resource_selection["resource_ids"] == ["model:chosen"]
    assert fc.plan_items == ["Previous plan"]
    assert fc.built_node_ids == []
    form = next(item.payload for item in result.items if item.kind == "form")
    assert form["values"]["missing_rate"] == "Reject"
    assert form["fields"][0]["required"] is True
    assert form["frozen"] is False


@pytest.mark.parametrize(
    "payload",
    [{}, {"policy": ""}, {"policy": "  "}, {"policy": "unknown"}, {"policy": []}, {"policy": {"x": "Reject"}}],
)
def test_invalid_requirement_submission_keeps_default_unconfirmed(
    monkeypatch: pytest.MonkeyPatch, payload: Inputs
) -> None:
    from services.dify_builder.application.handlers_build import handle_goal_analysis

    env, _ = _new_env()
    monkeypatch.setattr(env.agent, "propose_plan_v1", lambda *_a, **_kw: pytest.fail("invalid answers must not plan"))
    fc = DifyBuilderContext(
        goal_text="Settle orders",
        requirements={"currency": "USD", "policy": "Reject"},
        confirmed_requirement_keys=["currency"],
        form_fields=[
            {
                "key": "policy",
                "label": "Missing rate",
                "type": "select",
                "options": ["Reject", "Skip"],
                "required": True,
            }
        ],
    )
    result = handle_goal_analysis(
        env, Turn(action=Action(kind="submit_requirements", payload=payload), actor=_actor()), _session(), fc
    )
    assert result.next == PcState.BUILD_GOAL_ANALYSIS
    assert fc.requirements == {"currency": "USD", "policy": "Reject"}
    assert fc.confirmed_requirement_keys == ["currency"]


@pytest.mark.parametrize("answer", ["Reject", "Skip"])
def test_submitted_recommendation_or_edit_replans_preserving_prior_answers(
    monkeypatch: pytest.MonkeyPatch, answer: str
) -> None:
    from services.dify_builder.application.handlers_build import handle_goal_analysis, handle_plan_approval
    from services.dify_builder.plan import WorkflowPlan

    env, _ = _new_env(dify=FakeBuildDifyPort(), agent=NativeFlowAgent())
    calls: list[Inputs] = []

    def plan(requirements: Inputs, *, goal_text: str, reply_language: str | None = None) -> WorkflowPlan:
        assert goal_text == "Settle orders"
        assert reply_language is None
        calls.append(dict(requirements))
        return WorkflowPlan("Settlement", "Orders", "Totals", ["code node settles confirmed rules"])

    monkeypatch.setattr(env.agent, "propose_plan_v1", plan)
    monkeypatch.setattr(env.agent, "build_nodes", lambda *_a, **_kw: pytest.fail("fresh approval required"))
    fc = DifyBuilderContext(
        goal_text="Settle orders",
        requirements={"currency": "USD", "policy": "Reject"},
        confirmed_requirement_keys=["currency"],
        form_fields=[
            {
                "key": "policy",
                "label": "Missing rate",
                "type": "select",
                "options": ["Reject", "Skip"],
                "required": True,
            }
        ],
        resource_selection={"resource_ids": ["model:chosen"]},
    )
    result = handle_goal_analysis(
        env, Turn(action=Action(kind="submit_requirements", payload={"policy": answer}), actor=_actor()), _session(), fc
    )
    assert result.next == PcState.BUILD_INITIAL_PLAN
    assert calls == [{"currency": "USD", "policy": answer}]
    assert fc.confirmed_requirement_keys == ["currency", "policy"]
    assert fc.resource_selection["resource_ids"] == ["model:chosen"]
    assert fc.plan_items == ["code node settles confirmed rules"]
    assert fc.built_node_ids == []
    assert handle_plan_approval(env, Turn(actor=_actor()), _session(), fc).next == PcState.BUILD_PLAN_APPROVAL


def test_omitted_optional_input_remains_unconfirmed_and_preserves_its_value() -> None:
    from services.dify_builder.application.handlers_build import handle_goal_analysis

    env, _ = _new_env()
    fc = DifyBuilderContext(
        goal_text="Settle orders",
        requirements={"policy": "Reject"},
        confirmed_requirement_keys=[],
        form_fields=[{"key": "policy", "label": "Missing rate", "type": "text"}],
    )
    result = handle_goal_analysis(
        env, Turn(action=Action(kind="submit_requirements", payload={}), actor=_actor()), _session(), fc
    )
    assert result.next == PcState.BUILD_INITIAL_PLAN
    assert fc.confirmed_requirement_keys == []
    assert fc.requirements == {"policy": "Reject"}


@pytest.mark.parametrize(
    ("field_type", "value"),
    [("number", float("inf")), ("number", float("nan")), ("number", True), ("bool", "true"), ("text", ["answer"])],
)
def test_wrong_scalar_requirement_types_cannot_replan(
    monkeypatch: pytest.MonkeyPatch, field_type: str, value: object
) -> None:
    from services.dify_builder.application.handlers_build import handle_goal_analysis

    env, _ = _new_env()
    monkeypatch.setattr(env.agent, "propose_plan_v1", lambda *_a, **_kw: pytest.fail("invalid scalar must not plan"))
    fc = DifyBuilderContext(
        goal_text="Use the confirmed business limit",
        requirements={},
        confirmed_requirement_keys=[],
        form_fields=[{"key": "limit", "label": "Limit", "type": field_type, "required": True}],
    )
    result = handle_goal_analysis(
        env,
        Turn(action=Action(kind="submit_requirements", payload={"limit": value}), actor=_actor()),
        _session(),
        fc,
    )
    assert result.next == PcState.BUILD_GOAL_ANALYSIS
    assert fc.requirements == {}
    assert fc.confirmed_requirement_keys == []


def test_normalized_select_still_rejects_an_unoffered_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.application.handlers_build import handle_goal_analysis
    from services.dify_builder.application.handlers_fix import build_form_fields

    env, _ = _new_env()
    monkeypatch.setattr(env.agent, "propose_plan_v1", lambda *_a, **_kw: pytest.fail("invalid option must not plan"))
    fc = DifyBuilderContext(
        goal_text="Use the selected business rule",
        requirements={"choice": "1"},
        confirmed_requirement_keys=[],
        form_fields=[{"key": "choice", "type": "select", "options": [1, "2"], "required": True}],
    )
    assert build_form_fields(fc.form_fields)[0].options == ["1", "2"]
    result = handle_goal_analysis(
        env, Turn(action=Action(kind="submit_requirements", payload={"choice": "3"}), actor=_actor()), _session(), fc
    )
    assert result.next == PcState.BUILD_GOAL_ANALYSIS
    assert fc.requirements == {"choice": "1"}
    assert fc.confirmed_requirement_keys == []


def test_reverted_clarification_clears_old_attempt_before_fresh_build_and_testdata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from copy import deepcopy

    from core.dify_builder.models import TestInput
    from services.dify_builder.application.handlers_build import build_registry
    from services.dify_builder.plan import BuildClarification, WorkflowPlan

    dify = FakeBuildDifyPort()
    env, repo = _new_env(dify=dify, agent=NativeFlowAgent())
    s = _session(current_state=PcState.BUILD_REVERTED)
    context = DifyBuilderContext(
        goal_text="Settle records using the confirmed rules",
        requirements={"currency": "USD"},
        confirmed_requirement_keys=["currency"],
        resource_selection={"resource_ids": ["model:chosen"]},
        plan_items=["Prior plan"],
        test_input_ref="prior-input",
        verify_run_id="prior-run",
        repair_attempts=4,
        last_repair_error="old failure",
        unknown_outcome_count=2,
    )
    repo.create_session(s, context, [ConversationItem(kind="user", seq=0)])
    repo.save_test_input(TestInput(id="prior-input", session_id=s.id, inputs={"old_only": "stale"}))
    original_graph = deepcopy(dify.graph)
    outcomes = iter(
        [
            BuildClarification(
                fields=[
                    {
                        "key": "policy",
                        "label": "Missing value",
                        "type": "select",
                        "options": ["Reject", "Skip"],
                        "required": True,
                    }
                ],
                values={"policy": "Reject"},
            ),
            WorkflowPlan("Settlement", "Records", "Totals", ["code node applies confirmed business rules"]),
        ]
    )
    monkeypatch.setattr(env.agent, "propose_plan_v1", lambda *_a, **_kw: next(outcomes))
    runner = Runner(env, build_registry())
    out = runner.advance(s.id, Turn(action=Action(kind="re_fix", base_version=1), actor=_actor()))
    assert out.current_state == PcState.BUILD_GOAL_ANALYSIS
    _, fc = repo.get_session(s.id)
    assert fc.test_input_ref == ""
    assert fc.verify_run_id == ""
    assert fc.repair_attempts == 0
    assert fc.last_repair_error == ""
    assert fc.unknown_outcome_count == 0
    assert fc.goal_text == "Settle records using the confirmed rules"
    assert fc.requirements == {"currency": "USD", "policy": "Reject"}
    assert fc.confirmed_requirement_keys == ["currency"]
    assert fc.resource_selection == {"resource_ids": ["model:chosen"]}
    assert dify.graph == original_graph

    out = runner.advance(
        s.id,
        Turn(
            action=Action(kind="submit_requirements", payload={"policy": "Skip"}, base_version=out.version),
            actor=_actor(),
        ),
    )
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert dify.graph == original_graph
    out = runner.advance(
        s.id,
        Turn(
            action=Action(
                kind="confirm_resources", payload={"resource_ids": ["model:chosen"]}, base_version=out.version
            ),
            actor=_actor(),
        ),
    )
    assert out.current_state == PcState.BUILD_PLAN_APPROVAL
    assert dify.graph == original_graph
    out = runner.advance(s.id, Turn(action=Action(kind="approve_repair", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_EXECUTION
    _, fc = repo.get_session(s.id)
    assert fc.test_input_ref == ""
    assert fc.requirements == {"currency": "USD", "policy": "Skip"}
    assert fc.confirmed_requirement_keys == ["currency", "policy"]
    out = runner.advance(s.id, Turn(action=Action(kind="run_test", base_version=out.version), actor=_actor()))
    assert out.current_state == PcState.BUILD_AWAIT_TESTDATA
    form = next(item for item in reversed(repo.list_conversation(s.id)) if item.kind == "form")
    assert form.payload["variant"] == "testdata"
    assert "old_only" not in form.payload["values"]
    assert repo.get_test_input("prior-input").inputs == {"old_only": "stale"}


def test_reverted_planning_failure_retains_prior_attempt_context(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.application.handlers_build import handle_reverted

    env, _ = _new_env()
    monkeypatch.setattr(env.agent, "propose_plan_v1", lambda *_a, **_kw: None)
    fc = DifyBuilderContext(
        goal_text="Settle records",
        requirements={"currency": "USD"},
        test_input_ref="prior-input",
        verify_run_id="prior-run",
        repair_attempts=4,
        last_repair_error="old failure",
        unknown_outcome_count=2,
    )
    result = handle_reverted(env, Turn(action=Action(kind="re_fix"), actor=_actor()), _session(), fc)
    assert result.next == PcState.BUILD_REVERTED
    assert (
        fc.test_input_ref,
        fc.verify_run_id,
        fc.repair_attempts,
        fc.last_repair_error,
        fc.unknown_outcome_count,
    ) == (
        "prior-input",
        "prior-run",
        4,
        "old failure",
        2,
    )
