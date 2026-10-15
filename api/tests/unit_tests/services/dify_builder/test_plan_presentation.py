"""Plan overviews stay bound to their steps across persistence and replanning."""

import json
from datetime import datetime

import pytest

from core.dify_builder.handlers_build import build_registry
from core.dify_builder.handlers_edit import edit_registry
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.runner import Env, Runner
from core.dify_builder.state import PcState
from services.dify_builder.agent import build
from services.dify_builder.plan import WorkflowPlan
from services.dify_builder.serde import context_from_dict, context_to_dict
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository


class PlanningAgent(PlaceholderAgent):
    def __init__(self):
        self.plan = WorkflowPlan(
            title="为客服答复增加引用来源",
            input_summary="用户提交的问题和附件。",
            output_summary="结合知识库生成并附带引用来源的答复。",
            items=["Retrieve relevant knowledge", "Generate an answer with references"],
        )

    def propose_plan_v1(self, _requirements, *, goal_text):  # noqa: ARG002
        return self.plan

    def propose_edit_plan(self, _edit_rules, _graph):
        return self.plan

    def bind_resources(self, plan_items, _resource_ids):
        return [f"{item} (using selected resources)" for item in plan_items]


@pytest.mark.parametrize(
    ("mode", "state", "action"),
    [
        (EntryMode.BUILD, PcState.BUILD_GOAL_ANALYSIS, "submit_requirements"),
        (EntryMode.BUILD, PcState.BUILD_REVIEW, "re_fix"),
        (EntryMode.BUILD, PcState.BUILD_REVERTED, "re_fix"),
        (EntryMode.EDIT, PcState.EDIT_IMPACT_ANALYSIS, "submit_edit_rules"),
        (EntryMode.EDIT, PcState.EDIT_REVERTED, "re_fix"),
    ],
)
def test_plan_overview_is_saved_with_its_final_steps(mode, state, action):
    agent = PlanningAgent()
    repo = InMemoryRepository()
    env = Env(agent=agent, repo=repo, dify=FakeDifyPort(), now=lambda: datetime.min)
    session = Session(app_id="app", entry_mode=mode, current_state=state)
    context = DifyBuilderContext(
        goal_text="Add references to support answers",
        plan_title="Previous title",
        plan_input_summary="Previous inputs",
        plan_output_summary="Previous outputs",
        plan_items=["Previous step"],
    )
    repo.create_session(session, context, [])
    runner = Runner(env, build_registry() if mode == EntryMode.BUILD else edit_registry())
    actor = Actor(account_id="account", tenant_id="tenant")
    result = runner.advance(session.id, Turn(actor=actor, action=Action(kind=action, base_version=1)))

    # Restoring a commit between planning and resource confirmation must preserve
    # its overview rather than replacing it with empty or stale display fields.
    _, stored = repo.get_session(session.id)
    restored = context_from_dict(json.loads(json.dumps(context_to_dict(stored))))
    assert restored.plan_title == agent.plan.title
    assert restored.plan_input_summary == agent.plan.input_summary
    assert restored.plan_output_summary == agent.plan.output_summary
    assert restored.plan_items == agent.plan.items

    if mode == EntryMode.BUILD:
        result = runner.advance(
            session.id,
            Turn(
                actor=actor,
                action=Action(kind="confirm_resources", payload={"resource_ids": []}, base_version=result.version),
            ),
        )
    assert result.current_state == (
        PcState.BUILD_PLAN_APPROVAL if mode == EntryMode.BUILD else PcState.EDIT_PLAN_APPROVAL
    )
    card = next(item for item in repo.list_conversation(session.id) if item.kind == "plan")
    _, final_context = repo.get_session(session.id)
    assert card.payload["title"] == agent.plan.title
    assert card.payload["input_summary"] == agent.plan.input_summary
    assert card.payload["output_summary"] == agent.plan.output_summary
    assert card.payload["items"] == final_context.plan_items
    assert len(card.payload["items"]) == 2

    agent.plan.title = "A later plan"
    agent.plan.output_summary = "A later output"
    agent.plan.items.append("A later step")
    saved_card = next(item for item in repo.list_conversation(session.id) if item.kind == "plan")
    assert saved_card.payload == card.payload


@pytest.mark.parametrize("field", ["title", "input_summary", "output_summary"])
@pytest.mark.parametrize("invalid", [None, "", "   ", 7])
def test_incomplete_overview_retries_without_accepting_the_steps(monkeypatch, field, invalid):
    response = {
        "title": "Summarize documents",
        "input_summary": "Source documents.",
        "output_summary": "A summary report.",
        "plan": ["Read documents", "Return the summary"],
    }
    response[field] = invalid
    calls = []

    def invoke_text(_model, *, system, user, on_reasoning=None):  # noqa: ARG001
        calls.append(user)
        return json.dumps(response)

    monkeypatch.setattr(build.llm, "invoke_text", invoke_text)
    assert build.propose_plan_v1(object(), {}, goal_text="Summarize my documents") is None
    assert len(calls) == 2
    assert calls[0] in calls[1]
    assert field in calls[1]
