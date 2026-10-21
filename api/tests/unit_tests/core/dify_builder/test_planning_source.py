"""Source fidelity and refusal through real Build handlers and Runner persistence."""

import copy
from dataclasses import asdict
from datetime import datetime
from typing import override

import pytest

from core.dify_builder.contract import ProgressEventData, ResourceOption
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, MutationIntent, Session, Turn
from core.dify_builder.state import PcState
from services.dify_builder.application.handlers_build import build_registry
from services.dify_builder.application.runner import Env, Runner
from services.dify_builder.plan import WorkflowPlan
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

GOAL = "Generate a real presentation file, then POST it to the supplied endpoint. " + "保留原始目标。" * 1800
REQUIREMENTS = {"endpoint": "https://example.test/upload", "output": {"format": "pptx", "slides": 12}}


class RecordingAgent(StubAgent):
    def __init__(self, plan: list[str]) -> None:
        self.plan = (
            WorkflowPlan(
                title="Generate and deliver a presentation",
                input_summary="The requested presentation content.",
                output_summary="A presentation file delivered to the supplied endpoint.",
                items=plan,
            )
            if plan
            else None
        )
        self.calls = []

    @override
    def propose_plan_v1(self, requirements: dict[str, object], *, goal_text: str) -> WorkflowPlan | None:
        self.calls.append(("plan", goal_text, copy.deepcopy(requirements)))
        return self.plan

    @override
    def discover_resources(
        self, plan_items: list[str], *, goal_text: str, requirements: dict[str, object]
    ) -> list[ResourceOption]:
        self.calls.append(("resources", goal_text, copy.deepcopy(requirements)))
        return []

    @override
    def assess_capability_gap(
        self, plan_items: list[str], options: list[ResourceOption], *, goal_text: str, requirements: dict[str, object]
    ) -> str:
        self.calls.append(("gap", goal_text, copy.deepcopy(requirements)))
        return ""


def _advance(
    state: PcState, plan: list[str]
) -> tuple[
    Session,
    DifyBuilderContext,
    DifyBuilderContext,
    RecordingAgent,
    InMemoryRepository,
    list[dict[str, object]],
    list[ProgressEventData],
]:
    agent = RecordingAgent(plan)
    repo = InMemoryRepository()
    canvas: list[dict[str, object]] = []
    progress: list[ProgressEventData] = []
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
        plan_title="Prior accepted title",
        plan_input_summary="Prior accepted input",
        plan_output_summary="Prior accepted output",
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
    # Review's button now collects input; exercise its submitted adjustment at
    # the existing requirements gate. Button routing has dedicated handler tests.
    if state == PcState.BUILD_REVIEW:
        session.current_state = PcState.BUILD_GOAL_ANALYSIS
        context.form_fields.append({"key": "__builder_adjustment_request", "type": "text", "required": True})
        context.requirements["__builder_adjustment_request"] = ""
    before = copy.deepcopy(context)
    repo.create_session(session, context, [])
    if state == PcState.BUILD_INITIAL_PLAN:
        action = None
    else:
        action = Action(
            kind="submit_requirements" if state in {PcState.BUILD_GOAL_ANALYSIS, PcState.BUILD_REVIEW} else "re_fix",
            payload={
                "currency": "USD" if state == PcState.BUILD_REVIEW else "EUR",
                "junk": "discard",
                **({"__builder_adjustment_request": "Improve the summary"} if state == PcState.BUILD_REVIEW else {}),
            },
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
def test_runtime_cognition_receives_full_original_goal_and_confirmed_requirements(state: PcState) -> None:
    # Dropping/deriving the original goal, or passing stale requirements to
    # any cognitive boundary, loses an action absent from the requirements.
    out, stored, _, agent, _, _, _ = _advance(state, ["A condensed plan without source details"])
    confirmed = {**REQUIREMENTS, "currency": "EUR" if state == PcState.BUILD_GOAL_ANALYSIS else "USD"}
    if state == PcState.BUILD_REVIEW:
        confirmed["__builder_adjustment_request"] = "Improve the summary"
    expected_calls = [] if state == PcState.BUILD_INITIAL_PLAN else [("plan", GOAL, confirmed)]
    expected_calls += [("resources", GOAL, confirmed), ("gap", GOAL, confirmed)]
    assert agent.calls == expected_calls
    assert stored.requirements == confirmed
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    if state != PcState.BUILD_INITIAL_PLAN:
        assert stored.plan_title == "Generate and deliver a presentation"
        assert stored.plan_input_summary == "The requested presentation content."
        assert stored.plan_output_summary == "A presentation file delivered to the supplied endpoint."


@pytest.mark.parametrize(
    ("state", "failed_step"),
    [
        (PcState.BUILD_GOAL_ANALYSIS, "build-draft-plan"),
        (PcState.BUILD_REVIEW, "build-draft-plan"),
        (PcState.BUILD_REVERTED, "build-restart-plan"),
    ],
)
def test_empty_plan_preserves_context_and_stays_at_its_waiting_gate(state: PcState, failed_step: str) -> None:
    # Accepting [] must not replace the prior plan, invalidate evidence/repair,
    # emit success cards, or begin discovery/canvas/checkpoint work.
    out, stored, before, agent, repo, canvas, progress = _advance(state, [])
    assert out.current_state == (PcState.BUILD_GOAL_ANALYSIS if state == PcState.BUILD_REVIEW else state)
    stored_fields, before_fields = asdict(stored), asdict(before)
    for name in (
        "plan_items",
        "plan_title",
        "plan_input_summary",
        "plan_output_summary",
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
        assert stored_fields[name] == before_fields[name], name
    confirmed = {**REQUIREMENTS, "currency": "EUR" if state == PcState.BUILD_GOAL_ANALYSIS else "USD"}
    if state == PcState.BUILD_REVIEW:
        confirmed["__builder_adjustment_request"] = "Improve the summary"
    assert stored.requirements == confirmed
    assert agent.calls == [("plan", GOAL, confirmed)]
    assert canvas == []
    assert repo._checkpoints == {}
    items = repo.list_conversation(out.id)
    assert not {"plan", "resource_select"} & {item.kind for item in items}
    requirements_forms = [
        item for item in items if item.kind == "form" and item.payload.get("variant") == "build_requirements"
    ]
    if state in {PcState.BUILD_GOAL_ANALYSIS, PcState.BUILD_REVIEW}:
        assert len(requirements_forms) == 1
        assert requirements_forms[0].payload["values"] == confirmed
    else:
        assert requirements_forms == []
    assert not any(item.kind == "notice" for item in items)
    assert progress[-1].status == "error"
    failed = [event.activity for event in progress if event.activity is not None and event.activity.state == "failed"]
    assert [activity.id for activity in failed] == [failed_step]
    assistant = next(item for item in items if item.kind == "assistant_turn")
    assert len([item for item in items if item.kind == "assistant_turn"]) == 1
    reply = english_text(assistant.payload["reply_text"])
    assert "couldn't" in reply.lower()
    assert "plan" in reply.lower()
    assert assistant.payload["reply_mode"] == "complete"
    assert assistant.payload["execution"]["status"] == "error"
