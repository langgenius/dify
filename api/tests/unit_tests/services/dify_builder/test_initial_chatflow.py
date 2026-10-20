"""Initial Chatflow recognition, generation and approved draft replacement."""

import copy
import json
from dataclasses import asdict
from datetime import datetime
from typing import cast, override
from unittest.mock import Mock

import pytest

from core.app.app_config.entities import ModelConfig
from core.dify_builder.models import (
    Action,
    Actor,
    BuildNodesResult,
    DifyBuilderContext,
    EntryMode,
    Graph,
    MutationIntent,
    Session,
    Turn,
)
from core.dify_builder.state import PcState
from services.app.console_gateway import _CHATFLOW_STARTER_GRAPH
from services.dify_builder.agent import build, resources
from services.dify_builder.agent.graph_translate import to_intents
from services.dify_builder.agent.llm_agent import LlmBuilderAgent
from services.dify_builder.application.handlers_build import (
    handle_execution,
    handle_plan_approval,
    handle_resource_recommendation,
)
from services.dify_builder.application.placeholder_agent import PlaceholderAgent
from services.dify_builder.application.ports import DifyPort, Repository
from services.dify_builder.application.runner import Env
from services.dify_builder.initial_draft import build_intents_for_draft, is_initial_chatflow
from tests.unit_tests.core.dify_builder.fakes import FakeBuildDifyPort, InMemoryRepository


@pytest.fixture
def initial_graph() -> Graph:
    return copy.deepcopy(_CHATFLOW_STARTER_GRAPH)


def test_recognizes_the_console_starter_graph(initial_graph: Graph) -> None:
    assert is_initial_chatflow(initial_graph, mode="advanced-chat")
    assert not is_initial_chatflow(initial_graph, mode="workflow")


def test_recognition_ignores_automatic_model_and_canvas_initialization(initial_graph: Graph) -> None:
    llm = initial_graph["nodes"][1]
    llm["data"]["model"].update(provider="openai", name="gpt-4o")
    llm["data"]["memory"]["role_prefix"] = {"user": "", "assistant": ""}
    llm["data"].update(selected=True, desc="", _connectedSourceHandleIds=["source"])
    llm["position"] = {"x": -300, "y": 100}
    initial_graph["nodes"][0]["id"] = "input-123"
    initial_graph["edges"][0]["source"] = "input-123"
    initial_graph["nodes"][0]["data"]["title"] = "用户输入"
    initial_graph["nodes"].reverse()
    initial_graph["edges"].reverse()
    assert is_initial_chatflow(initial_graph, mode="advanced-chat")


@pytest.mark.parametrize(
    ("index", "patch"),
    [
        (0, {"variables": [{"variable": "topic", "type": "text-input"}]}),
        (1, {"prompt_template": [{"role": "system", "text": "Summarize"}]}),
        (
            1,
            {
                "prompt_template": [
                    {"role": "system", "text": "", "edition_type": "jinja2", "jinja2_text": "{{ topic }}"}
                ]
            },
        ),
        (1, {"context": {"enabled": True, "variable_selector": ["knowledge", "result"]}}),
        (1, {"model": {"mode": "chat", "completion_params": {"temperature": 0.3}}}),
        (1, {"model_selector": ["env", "model"]}),
        (1, {"vision": {"enabled": True}}),
        (1, {"retry_config": {"retry_enabled": True}}),
        (1, {"memory": {"window": {"enabled": True, "size": 3}, "query_prompt_template": "{{#sys.query#}}"}}),
        (2, {"answer": "Hello"}),
    ],
)
def test_configured_drafts_are_never_replaced_as_initial_templates(
    initial_graph: Graph, index: int, patch: dict[str, object]
) -> None:
    initial_graph["nodes"][index]["data"].update(patch)
    assert not is_initial_chatflow(initial_graph, mode="advanced-chat")
    assert not any(
        intent.op == "delete_node" for intent in build_intents_for_draft(initial_graph, [], mode="advanced-chat")
    )


@pytest.mark.parametrize("change", ["rewired", "missing edge", "branch handle", "extra node", "nested"])
def test_modified_topology_is_not_an_initial_template(initial_graph: Graph, change: str) -> None:
    if change == "rewired":
        initial_graph["edges"][0]["target"] = "answer"
    elif change == "missing edge":
        initial_graph["edges"].pop()
    elif change == "branch handle":
        initial_graph["edges"][0]["sourceHandle"] = "true"
    elif change == "extra node":
        initial_graph["nodes"].append({"id": "code", "data": {"type": "code"}})
    else:
        initial_graph["nodes"][1]["parentId"] = "iteration"
    assert not is_initial_chatflow(initial_graph, mode="advanced-chat")


def _generated_chatflow(initial_graph: Graph) -> Graph:
    graph = copy.deepcopy(initial_graph)
    graph["nodes"][1]["data"]["model"].update(provider="openai", name="gpt-4o")
    graph["nodes"][1]["data"]["prompt_template"] = [{"role": "system", "text": "Help with support requests"}]
    return graph


@pytest.fixture
def generator(monkeypatch: pytest.MonkeyPatch, initial_graph: Graph) -> Mock:
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda *_a, **_kw: resources.TenantResources(models=[], datasets=[], tools=[]),
    )
    monkeypatch.setattr(
        build,
        "_generator_model_config",
        lambda *_a: ModelConfig.model_validate(
            {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}
        ),
    )
    generate = Mock(return_value={"graph": _generated_chatflow(initial_graph), "error": "", "errors": []})
    monkeypatch.setattr(build.WorkflowGeneratorService, "generate_workflow_graph", generate)
    return generate


def test_chatflow_generation_accepts_answer_and_uses_the_actual_mode(generator: Mock) -> None:
    result = build.build_nodes("tenant", {}, ["Reply to the user"], mode="advanced-chat")
    assert result.error == ""
    assert [i.args["node_type"] for i in result.intents if i.op == "create_node"] == ["start", "llm", "answer"]
    assert generator.call_args is not None
    assert generator.call_args.kwargs["mode"] == "advanced-chat"
    assert "'answer' node" in generator.call_args.kwargs["instruction"]
    assert "Do NOT use 'end' nodes" in generator.call_args.kwargs["instruction"]


def test_chatflow_retry_rejects_a_workflow_terminal(generator: Mock, initial_graph: Graph) -> None:
    wrong = _generated_chatflow(initial_graph)
    wrong["nodes"][2]["data"] = {"type": "end", "title": "End", "outputs": []}
    errors: list[dict[str, str]] = []
    generator.side_effect = [
        {"graph": wrong, "error": "", "errors": errors},
        {"graph": _generated_chatflow(initial_graph), "error": "", "errors": errors},
    ]
    result = build.build_nodes("tenant", {}, ["Reply"], mode="advanced-chat")
    assert result.intents
    assert generator.call_count == 2
    assert all(call.kwargs["mode"] == "advanced-chat" for call in generator.call_args_list)
    assert generator.call_args is not None
    retry = generator.call_args.kwargs["instruction"]
    assert "answer" in retry
    assert "Do NOT use 'end' nodes" in retry


class _GeneratedAgent(PlaceholderAgent):
    def __init__(self, intents: list[MutationIntent]) -> None:
        self._intents = intents

    @override
    def build_nodes(
        self, plan_items: list[str], resource_ids: list[str] | None = None, *, trusted_text: str = ""
    ) -> BuildNodesResult:
        del plan_items, resource_ids, trusted_text
        return BuildNodesResult(intents=copy.deepcopy(self._intents))


def _build_env(
    initial_graph: Graph, intents: list[MutationIntent]
) -> tuple[Env, FakeBuildDifyPort, Actor, Session, DifyBuilderContext]:
    port = FakeBuildDifyPort()
    port.app_mode = "advanced-chat"
    port.graph = copy.deepcopy(initial_graph)
    agent = _GeneratedAgent(intents)
    repo = InMemoryRepository()
    # The shared fakes use underscored parameter names; these handlers call them positionally.
    env = Env(dify=cast(DifyPort, port), agent=agent, repo=cast(Repository, repo), now=lambda: datetime.min)
    actor = Actor(account_id="account", tenant_id="tenant")
    session = Session(
        app_id="app",
        tenant_id="tenant",
        owner_account_id="account",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_RESOURCE_RECOMMENDATION,
    )
    fc = DifyBuilderContext(goal_text="Build a support assistant", plan_items=["Reply"])
    repo.create_session(session, fc, [])
    checkpoint = handle_resource_recommendation(
        env, Turn(actor=actor, action=Action(kind="confirm_resources")), session, fc
    )
    session.current_state = checkpoint.next
    assert checkpoint.context is not None
    return env, port, actor, session, checkpoint.context


@pytest.mark.parametrize("reuse_ids", [False, True])
def test_approved_build_replaces_the_whole_template_and_remains_revertible(
    initial_graph: Graph, reuse_ids: bool
) -> None:
    generated = _generated_chatflow(initial_graph)
    if not reuse_ids:
        for node in generated["nodes"]:
            node["id"] += "-built"
        for edge in generated["edges"]:
            edge["source"] += "-built"
            edge["target"] += "-built"
        generated["nodes"][2]["data"]["answer"] = "{{#llm-built.text#}}"
    env, port, actor, session, fc = _build_env(initial_graph, to_intents(generated))
    assert port.graph == initial_graph  # checkpoint/requirements do not clear the canvas
    result = handle_plan_approval(env, Turn(actor=actor, action=Action(kind="approve_repair")), session, fc)
    assert result.next == PcState.BUILD_EXECUTION
    assert result.context is not None
    assert {n["id"] for n in port.graph["nodes"]} == {n["id"] for n in generated["nodes"]}
    assert len(port.graph["edges"]) == 2
    assert port.graph["nodes"][1]["data"]["prompt_template"][0]["text"] == "Help with support requests"
    assert [i.args["node_id"] for i in port.applied if i.op == "delete_node"] == ["start", "llm", "answer"]
    assert port.expected_revision == "h0"
    assert not build_intents_for_draft(port.graph, to_intents(generated), mode="advanced-chat")
    reverted = handle_execution(env, Turn(actor=actor, action=Action(kind="undo")), session, result.context)
    assert reverted.next == PcState.BUILD_REVERTED
    assert port.graph == initial_graph


def test_failed_generation_keeps_the_initial_template(initial_graph: Graph) -> None:
    env, port, actor, session, fc = _build_env(initial_graph, [])
    result = handle_plan_approval(env, Turn(actor=actor, action=Action(kind="approve_repair")), session, fc)
    assert result.next == PcState.BUILD_PLAN_APPROVAL
    assert port.graph == initial_graph
    assert not port.applied


def test_chatflow_mode_reaches_planning_capability_checks_and_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    planner, gap, generate = Mock(return_value=None), Mock(return_value=""), Mock(return_value=BuildNodesResult())
    monkeypatch.setattr(build, "propose_plan_v1", planner)
    monkeypatch.setattr(build, "assess_capability_gap", gap)
    monkeypatch.setattr(build, "build_nodes", generate)
    monkeypatch.setattr(build, "ready_tool_catalogue", lambda *_a, **_kw: [])
    agent = LlmBuilderAgent("tenant", {}, app_mode="advanced-chat")
    monkeypatch.setattr(agent, "model_or_none", lambda: None)
    agent.propose_plan_v1({}, goal_text="Reply")
    agent.assess_capability_gap(["Reply"], [], goal_text="Reply", requirements={})
    agent.build_nodes(["Reply"])
    assert planner.call_args is not None
    assert gap.call_args is not None
    assert generate.call_args is not None
    assert (
        planner.call_args.kwargs["mode"]
        == gap.call_args.kwargs["mode"]
        == generate.call_args.kwargs["mode"]
        == "advanced-chat"
    )


def test_chatflow_planning_and_capability_prompts_use_answer_nodes(monkeypatch: pytest.MonkeyPatch) -> None:
    planner = Mock(
        return_value=json.dumps(
            {
                "title": "Chat assistant",
                "input_summary": "A message",
                "output_summary": "A reply",
                "plan": ["answer node replies to the user"],
            }
        )
    )
    gap = Mock(return_value={"gap": ""})
    monkeypatch.setattr(build.llm, "invoke_text", planner)
    monkeypatch.setattr(build.llm, "invoke_json", gap)
    assert build.propose_plan_v1(object(), {}, goal_text="Reply", mode="advanced-chat") is not None
    assert build.assess_capability_gap(object(), ["Reply"], [], mode="advanced-chat") == ""
    for call in (planner.call_args, gap.call_args):
        assert call is not None
        assert '- "answer"' in call.kwargs["system"]
        assert '- "end"' not in call.kwargs["system"]


def test_worker_resolves_the_persisted_app_mode_before_constructing_the_agent(
    monkeypatch: pytest.MonkeyPatch, initial_graph: Graph
) -> None:
    import tasks.dify_builder_advance_task as task

    port = FakeBuildDifyPort()
    port.app_mode = "advanced-chat"
    port.graph = initial_graph
    repo = InMemoryRepository()
    actor = Actor(account_id="account", tenant_id="tenant")
    session = Session(
        app_id="app",
        tenant_id="tenant",
        owner_account_id="account",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_CAPABILITY_CHECK,
    )
    repo.create_session(session, DifyBuilderContext(goal_text="Build a chat assistant"), [])
    factory = Mock(wraps=task.build_dify_builder_agent)
    events: list[dict[str, object]] = []
    monkeypatch.setattr(task, "_build_repo", lambda: repo)
    monkeypatch.setattr(task, "WorkflowServiceDifyPort", lambda: port)
    monkeypatch.setattr(task, "build_dify_builder_agent", factory)
    monkeypatch.setattr(LlmBuilderAgent, "model_or_none", lambda _self: None)
    monkeypatch.setattr(task.session_lock, "activate", lambda *_a: "worker")
    monkeypatch.setattr(task.session_lock, "release", lambda *_a: None)
    monkeypatch.setattr(task.progress_snapshot, "save", lambda *_a, **_kw: None)
    monkeypatch.setattr(task.progress_bus, "publish", lambda _sid, event: events.append(event))
    task.advance_session(
        session.id, asdict(Action(kind="start_build", base_version=session.version)), asdict(actor), "token"
    )
    assert factory.call_args is not None
    assert factory.call_args.kwargs["app_mode"] == "advanced-chat"
    assert repo.get_session(session.id)[0].current_state == PcState.BUILD_GOAL_ANALYSIS
    assert events[-1]["kind"] == "command_finished"


def test_rejected_generated_graph_keeps_the_initial_template(
    monkeypatch: pytest.MonkeyPatch, initial_graph: Graph
) -> None:
    from core.dify_builder.errors import DraftWouldNotStartError

    env, port, actor, session, fc = _build_env(initial_graph, to_intents(_generated_chatflow(initial_graph)))

    def reject(*_args: object, **_kwargs: object) -> None:
        raise DraftWouldNotStartError("Invalid generated configuration")

    monkeypatch.setattr(port, "apply_repair", reject)
    result = handle_plan_approval(env, Turn(actor=actor, action=Action(kind="approve_repair")), session, fc)
    assert result.next == PcState.BUILD_PLAN_APPROVAL
    assert port.graph == initial_graph
