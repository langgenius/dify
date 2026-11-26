"""Approved replans update owned configuration without replacing the canvas."""

import copy
from datetime import datetime
from typing import override

import pytest

from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import (
    Action,
    Actor,
    BuildNodesResult,
    DifyBuilderContext,
    EntryMode,
    Inputs,
    MutationIntent,
    Session,
    Turn,
)
from core.dify_builder.state import PcState
from services.dify_builder.agent.graph_translate import to_intents
from services.dify_builder.application.handlers_build import build_registry, handle_plan_approval
from services.dify_builder.application.placeholder_agent import PlaceholderAgent
from services.dify_builder.application.runner import Runner
from services.dify_builder.credentials import REDACTED
from services.dify_builder.initial_draft import build_intents_for_draft
from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, FixtureEnv, InMemoryRepository
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

_ACTOR = Actor(account_id="account", tenant_id="tenant")
_OLD_CODE = 'def main():\n    return {"result": "before"}'
_NEW_CODE = 'def main():\n    return {"result": "after"}'


def _intents(code: str) -> list[MutationIntent]:
    return to_intents(
        {
            "nodes": [
                {"id": "node1", "data": {"type": "start", "variables": []}},
                {
                    "id": "node2",
                    "data": {
                        "type": "code",
                        "title": "Generated title",
                        "desc": "Generated description",
                        "code": code,
                        "code_language": "python3",
                        "variables": [],
                        "outputs": {"result": {"type": "string", "children": None}},
                    },
                },
                {"id": "node3", "data": {"type": "end", "outputs": []}},
            ],
            "edges": [{"source": "node1", "target": "node2"}, {"source": "node2", "target": "node3"}],
        }
    )


class _Agent(PlaceholderAgent):
    intents: list[MutationIntent]

    def __init__(self, intents: list[MutationIntent]) -> None:
        self.intents = intents

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
        return BuildNodesResult(intents=copy.deepcopy(self.intents))


def _fixture() -> tuple[FixtureEnv, InMemoryRepository, FakeBuildDifyPort, Session, DifyBuilderContext, _Agent]:
    port = FakeBuildDifyPort()
    port.apply_repair("app", _ACTOR, _intents(_OLD_CODE))
    code = port.graph["nodes"][1]
    code.update(position={"x": 812, "y": 140}, width=400, selected=True)
    code["data"].update(
        title="My title", desc="My description", selected=True, _editing=True, retry_config={"enabled": True}
    )
    port.applied.clear()
    repo = InMemoryRepository()
    agent = _Agent(_intents(_NEW_CODE))
    env = FixtureEnv(dify=port, agent=agent, repo=repo, now=lambda: datetime.min)
    session = Session(
        app_id="app",
        tenant_id="tenant",
        owner_account_id="account",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_REVIEW,
    )
    context = DifyBuilderContext(
        goal_text="Generate a report",
        plan_items=["Produce the revised report"],
        built_node_ids=["node1", "node2", "node3"],
        last_snapshot_hash="h1",
    )
    repo.create_session(session, context, [])
    return env, repo, port, session, context, agent


def test_changed_owned_code_applies_only_after_fresh_plan_approval_and_reapproval_is_noop() -> None:
    env, repo, port, session, _, _ = _fixture()
    before = copy.deepcopy(port.graph)
    runner = Runner(env, build_registry())
    out = runner.advance(session.id, Turn(actor=_ACTOR, action=Action(kind="re_fix", base_version=1)))
    assert out.current_state == PcState.BUILD_GOAL_ANALYSIS
    assert port.graph == before
    out = runner.advance(
        session.id,
        Turn(
            actor=_ACTOR,
            action=Action(
                kind="submit_requirements",
                payload={"__builder_adjustment_request": "Revise the report output"},
                base_version=out.version,
            ),
        ),
    )
    assert out.current_state == PcState.BUILD_RESOURCE_RECOMMENDATION
    assert port.graph == before
    out = runner.advance(
        session.id,
        Turn(
            actor=_ACTOR,
            action=Action(kind="confirm_resources", payload={"resource_ids": []}, base_version=out.version),
        ),
    )
    assert out.current_state == PcState.BUILD_PLAN_APPROVAL
    assert port.graph == before
    out = runner.advance(session.id, Turn(actor=_ACTOR, action=Action(kind="approve_repair", base_version=out.version)))
    assert out.current_state == PcState.BUILD_EXECUTION
    assert port.graph["nodes"][1]["data"]["code"] == _NEW_CODE
    expected = copy.deepcopy(before)
    expected["nodes"][1]["data"]["code"] = _NEW_CODE
    assert port.graph == expected  # layout, descriptions, unmentioned config, IDs and edges survive
    assert [intent.op for intent in port.applied] == ["set_node_config"]
    assert port.expected_revision == "h1"
    assert repo.get_session(session.id)[1].built_node_ids == ["node1", "node2", "node3"]

    port.applied.clear()
    _, context = repo.get_session(session.id)
    result = handle_plan_approval(env, Turn(actor=_ACTOR, action=Action(kind="approve_repair")), session, context)
    assert result.next == PcState.BUILD_EXECUTION
    assert port.graph == expected
    assert port.applied == []


@pytest.mark.parametrize("unsupported", ["foreign", "type", "parent", "flow_type", "containment"])
def test_replan_collision_refuses_the_whole_batch_before_writing(unsupported: str) -> None:
    env, _, port, session, context, agent = _fixture()
    if unsupported == "foreign":
        context.built_node_ids.remove("node2")
    elif unsupported == "type":
        agent.intents[1].args["node_type"] = "llm"
    elif unsupported == "parent":
        agent.intents[1].args["parent_id"] = "another-container"
    elif unsupported == "flow_type":
        agent.intents[1].args["flow_type"] = "custom-note"
    else:
        agent.intents[1].args["config"]["iteration_id"] = "another-container"
    # A preceding valid update must not leak from a rejected generated batch.
    agent.intents[0].args["config"]["variables"] = [{"variable": "new_input", "type": "text-input"}]
    before = copy.deepcopy(port.graph)
    result = handle_plan_approval(env, Turn(actor=_ACTOR, action=Action(kind="approve_repair")), session, context)
    assert result.next == PcState.BUILD_PLAN_APPROVAL
    assert port.graph == before
    assert port.applied == []
    assistant = next(item for item in result.items if item.kind == "assistant_turn")
    assert "node2" in english_text(assistant.payload["reply_text"])
    assert assistant.payload["execution"]["status"] == "error"


def test_replan_uses_creation_defaults_and_authoritative_node_type_for_generated_fields() -> None:
    port = FakeBuildDifyPort()
    port.graph = {
        "nodes": [
            {
                "id": "owned",
                "type": "custom",
                "data": {"type": "llm", "model": {"provider": "old", "name": "old"}, "unmentioned": "retain"},
            }
        ],
        "edges": [],
    }
    generated = [
        MutationIntent(
            op="create_node",
            args={
                "node_id": "owned",
                "node_type": "llm",
                "config": {"type": "stale-type", "model": {"provider": "configured", "name": "chosen"}},
            },
        )
    ]
    before = copy.deepcopy(port.graph)
    original_intents = copy.deepcopy(generated)
    patches = build_intents_for_draft(port.graph, generated, mode="workflow", built_node_ids=["owned"])
    assert port.graph == before
    assert generated == original_intents
    port.apply_repair("app", _ACTOR, patches)
    assert port.graph["nodes"][0]["data"] == {
        "type": "llm",
        "unmentioned": "retain",
        "model": {
            "provider": "configured",
            "name": "chosen",
            "mode": "chat",
            "completion_params": {"temperature": 0.7},
        },
    }
    assert build_intents_for_draft(port.graph, generated, mode="workflow", built_node_ids=["owned"]) == []


def test_replan_cannot_write_a_redacted_generated_value() -> None:
    env, _, port, session, context, agent = _fixture()
    agent.intents[1].args["config"]["code"] = REDACTED
    before = copy.deepcopy(port.graph)
    result = handle_plan_approval(env, Turn(actor=_ACTOR, action=Action(kind="approve_repair")), session, context)
    assert result.next == PcState.BUILD_PLAN_APPROVAL
    assert port.graph == before
    assert port.applied == []
