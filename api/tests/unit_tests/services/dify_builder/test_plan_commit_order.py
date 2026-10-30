"""Discovery must observe an abstract plan through a separately committed SQL read."""

from datetime import datetime
from typing import override

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, Turn
from core.dify_builder.state import PcState
from models.base import Base
from services.dify_builder.application.handlers_build import build_registry
from services.dify_builder.application.runner import Env, Runner
from services.dify_builder.plan import WorkflowPlan
from services.dify_builder.repository import SqlDifyBuilderRepository
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, StubAgent


@pytest.mark.parametrize("clarify", [False, True])
def test_discovery_reads_committed_abstract_plan(clarify: bool) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repo = SqlDifyBuilderRepository(sessionmaker(bind=engine))
    session = Session(
        app_id="app",
        tenant_id="tenant",
        owner_account_id="account",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_GOAL_ANALYSIS if clarify else PcState.BUILD_CAPABILITY_CHECK,
    )
    fc = DifyBuilderContext(
        goal_text="Preserve the original task",
        requirements={"format": "csv"},
        form_fields=[{"key": "format", "type": "text", "label": "Format"}],
    )
    repo.create_session(session, fc, [])

    class Agent(StubAgent):
        @override
        def analyze_goal(self, goal_text: str, *, reply_language: str | None = None) -> dict[str, object]:
            del goal_text, reply_language
            return {"fields": [], "values": {"format": "csv"}}

        @override
        def propose_plan_v1(
            self, requirements: dict[str, object], *, goal_text: str, reply_language: str | None = None
        ) -> WorkflowPlan:
            del requirements, goal_text, reply_language
            return WorkflowPlan(title="Export", input_summary="Records", output_summary="CSV", items=["Export CSV"])

        @override
        def discover_resources(
            self,
            plan_items: list[str],
            *,
            goal_text: str,
            requirements: dict[str, object],
            reply_language: str | None = None,
        ) -> list[ResourceOption]:
            del plan_items, goal_text, requirements, reply_language
            durable, context = repo.get_session(session.id)
            assert durable.current_state == PcState.BUILD_INITIAL_PLAN
            assert context.plan_items == ["Export CSV"]
            assert context.goal_text == "Preserve the original task"
            assert context.requirements == {"format": "csv"}
            return []

    runner = Runner(Env(dify=FakeDifyPort(), agent=Agent(), repo=repo, now=lambda: datetime.min), build_registry())
    runner.advance(
        session.id,
        Turn(
            actor=Actor(account_id="account", tenant_id="tenant"),
            action=Action(
                kind="submit_requirements" if clarify else "start_build", payload={"format": "csv"}, base_version=1
            ),
        ),
    )
    assert repo.get_session(session.id)[0].current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    engine.dispose()


@pytest.mark.parametrize("oversized", ["steps", "step", "title", "total"])
def test_plan_response_has_explicit_finite_storage_budgets(oversized: str) -> None:
    from services.dify_builder.plan import parse_plan_response

    data = {"title": "Export", "input_summary": "Records", "output_summary": "CSV", "plan": ["Export records"]}
    if oversized == "steps":
        data["plan"] = ["Step"] * 31
    elif oversized == "step":
        data["plan"] = ["a" * 2001]
    elif oversized == "title":
        data["title"] = "a" * 201
    else:
        data["plan"] = ["a" * 1000] * 30
    with pytest.raises(ValueError, match="limit"):
        parse_plan_response(data)


def test_oversized_plan_reply_is_rejected_before_json_repair() -> None:
    import json

    from services.dify_builder.agent import build
    from tests.unit_tests.services.dify_builder.test_build_cognition import _FakeInstance, _plan_reply

    data = json.loads(_plan_reply(["Export records"]))
    data["irrelevant_metadata"] = "a" * 64001
    model = _FakeInstance([json.dumps(data)])
    assert build.propose_plan_v1(model, {}, goal_text="Export records") is None
    assert len(model.calls) == 1
