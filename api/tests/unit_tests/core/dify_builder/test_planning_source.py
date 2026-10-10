"""Source fidelity and refusal through real Build handlers and Runner persistence."""

import copy
from datetime import datetime

import pytest

from core.dify_builder import strings
from core.dify_builder.handlers_build import build_registry
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, MutationIntent, Session, Turn
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository

GOAL = "Generate a real presentation file, then POST it to the supplied endpoint. " + "保留原始目标。" * 1800
REQUIREMENTS = {"endpoint": "https://example.test/upload", "output": {"format": "pptx", "slides": 12}}


class RecordingAgent(PlaceholderAgent):
    def __init__(self, plan):
        self.plan = plan
        self.calls = []

    def propose_plan_v1(self, requirements, *, goal_text):
        self.calls.append(("plan", goal_text, copy.deepcopy(requirements)))
        return self.plan

    def discover_resources(self, _plan_items, *, goal_text, requirements):
        self.calls.append(("resources", goal_text, copy.deepcopy(requirements)))
        return []

    def assess_capability_gap(self, _plan_items, _options, *, goal_text, requirements):
        self.calls.append(("gap", goal_text, copy.deepcopy(requirements)))
        return ""


def _advance(state, plan):
    agent = RecordingAgent(plan)
    repo = InMemoryRepository()
    canvas, progress = [], []
    env = Env(
        agent=agent,
        dify=FakeDifyPort(),
        repo=repo,
        now=lambda: datetime.min,
        emit_canvas=canvas.append,
        emit_progress=progress.append,
    )
    session = Session(
        app_id="app", tenant_id="tenant", owner_account_id="account", entry_mode=EntryMode.BUILD, current_state=state
    )
    context = DifyBuilderContext(
        goal_text=GOAL,
        requirements={**REQUIREMENTS, "currency": "USD"},
        form_fields=[{"key": "currency", "label": "Currency", "type": "text"}],
        plan_items=["Prior accepted plan"],
        plan_version_tag="v2",
        resource_selection={"ids": ["existing-tool"]},
        built_node_ids=["existing-node"],
        checkpoint_id="existing-checkpoint",
        test_input_ref="prior-input",
        verify_run_id="prior-run",
        repair_attempts=3,
        last_repair_error="last-failure",
        unknown_outcome_count=2,
        staged_repair=[MutationIntent(op="set_node_config", args={"node_id": "existing-node", "config": {"a": 1}})],
    )
    before = copy.deepcopy(context)
    repo.create_session(session, context, [])
    if state == PcState.BUILD_INITIAL_PLAN:
        action = None
    else:
        action = Action(
            kind="submit_requirements" if state == PcState.BUILD_GOAL_ANALYSIS else "re_fix",
            payload={"currency": "EUR", "junk": "discard"},
            base_version=1,
        )
    out = Runner(env, build_registry()).advance(
        session.id, Turn(actor=Actor(account_id="account", tenant_id="tenant"), action=action)
    )
    _, stored = repo.get_session(session.id)
    return out, stored, before, agent, repo, canvas, progress


@pytest.mark.parametrize(
    "state",
    [PcState.BUILD_GOAL_ANALYSIS, PcState.BUILD_REVIEW, PcState.BUILD_REVERTED, PcState.BUILD_INITIAL_PLAN],
)
def test_runtime_cognition_receives_full_original_goal_and_confirmed_requirements(state):
    # Dropping/deriving the original goal, or passing stale requirements to
    # any cognitive boundary, loses an action absent from the requirements.
    out, stored, _, agent, _, _, _ = _advance(state, ["A condensed plan without source details"])
    confirmed = {**REQUIREMENTS, "currency": "EUR" if state == PcState.BUILD_GOAL_ANALYSIS else "USD"}
    expected_calls = [] if state == PcState.BUILD_INITIAL_PLAN else [("plan", GOAL, confirmed)]
    expected_calls += [("resources", GOAL, confirmed), ("gap", GOAL, confirmed)]
    assert agent.calls == expected_calls
    assert stored.requirements == confirmed
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION


@pytest.mark.parametrize(
    ("state", "failed_step"),
    [
        (PcState.BUILD_GOAL_ANALYSIS, "build-draft-plan"),
        (PcState.BUILD_REVIEW, "build-revise-plan"),
        (PcState.BUILD_REVERTED, "build-restart-plan"),
    ],
)
def test_empty_plan_preserves_context_and_stays_at_its_waiting_gate(state, failed_step):
    # Accepting [] must not replace the prior plan, invalidate evidence/repair,
    # emit success cards, or begin discovery/canvas/checkpoint work.
    out, stored, before, agent, repo, canvas, progress = _advance(state, [])
    assert out.current_state == state
    for name in (
        "plan_items",
        "plan_version_tag",
        "resource_selection",
        "built_node_ids",
        "checkpoint_id",
        "test_input_ref",
        "verify_run_id",
        "repair_attempts",
        "last_repair_error",
        "unknown_outcome_count",
        "staged_repair",
    ):
        assert getattr(stored, name) == getattr(before, name), name
    confirmed = {**REQUIREMENTS, "currency": "EUR" if state == PcState.BUILD_GOAL_ANALYSIS else "USD"}
    assert stored.requirements == confirmed
    assert agent.calls == [("plan", GOAL, confirmed)]
    assert canvas == []
    assert repo._checkpoints == {}
    items = repo.list_conversation(out.id)
    assert not {"plan", "resource_select"} & {item.kind for item in items}
    requirements_forms = [
        item for item in items if item.kind == "form" and item.payload.get("variant") == "build_requirements"
    ]
    if state == PcState.BUILD_GOAL_ANALYSIS:
        assert len(requirements_forms) == 1
        assert requirements_forms[0].payload["values"] == confirmed
    else:
        assert requirements_forms == []
    notices = [item.payload["text"] for item in items if item.kind == "notice"]
    assert notices
    assert all(text in strings.PLAIN for text in notices)
    assert all("couldn't" in text.lower() and "plan" in text.lower() for text in notices)
    assert progress[-1].status == "error"
    failed = [event.activity for event in progress if event.activity is not None and event.activity.state == "failed"]
    assert [activity.id for activity in failed] == [failed_step]
    assistant = next(item for item in items if item.kind == "assistant_turn")
    assert assistant.payload["execution"]["status"] == "error"
