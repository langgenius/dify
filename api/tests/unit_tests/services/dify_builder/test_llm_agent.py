import logging
from collections.abc import Callable, Sequence
from typing import Never

import pytest

from core.dify_builder.contract import ResourceOption
from core.dify_builder.models import ConversationItem, Diagnosis, DifyBuilderContext, Graph, Inputs, NodeOutput, Run
from core.dify_builder.ports import DifyBuilderAgent, ReasoningStreamingAgent
from core.dify_builder.state import PcState
from services.dify_builder.agent import build as build_mod
from services.dify_builder.agent import chat as chat_mod
from services.dify_builder.agent import edit as edit_mod
from services.dify_builder.agent import fix as fix_mod
from services.dify_builder.agent import llm_agent
from services.dify_builder.agent.llm_agent import LlmBuilderAgent


def test_is_dify_builder_agent() -> None:
    agent = LlmBuilderAgent("t1", None)
    assert isinstance(agent, DifyBuilderAgent)
    assert isinstance(agent, ReasoningStreamingAgent)


def test_llm_agent_build_methods_delegate_to_build(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import build

    monkeypatch.setattr(
        build,
        "analyze_goal",
        lambda _m, _g, _reasoning=None, *, reply_language=None: {  # noqa: ARG005
            "fields": [{"key": "k", "label": "K", "type": "text"}],
            "values": {},
        },
    )
    agent = LlmBuilderAgent("t1", {})
    assert agent.analyze_goal("goal")["fields"][0]["key"] == "k"


def test_build_methods_call_build_module_with_resolved_model(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def mock_analyze_goal(
        model: object,
        _goal_text: str,
        _reasoning: Callable[[str], None] | None = None,
        *,
        reply_language: str | None = None,
    ) -> Graph:
        seen["m"] = model
        seen["reply_language"] = reply_language
        return {"fields": [], "values": {}}

    monkeypatch.setattr(build_mod, "analyze_goal", mock_analyze_goal)
    agent = LlmBuilderAgent("t1", {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}})
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")
    agent.analyze_goal("goal", reply_language="es-ES")
    assert seen["m"] == "MODEL"
    assert seen["reply_language"] == "es-ES"


def test_remaining_build_methods_thread_model_and_tenant_args(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mirrors test_build_methods_call_build_module_with_resolved_model for
    analyze_goal: pins that propose_plan_v1/discover_resources/
    assess_capability_gap/bind_resources/build_nodes/learn_from_build each call
    the corresponding build.* with the
    resolved model threaded through (build_nodes takes no model -- it threads
    self._tenant_id/self._model_config directly instead)."""
    seen: dict[str, tuple[object, ...]] = {}

    def mock_propose_plan_v1(
        model: object,
        requirements: Inputs,
        _reasoning: Callable[[str], None] | None = None,
        *,
        tools: Sequence[object] = (),
        goal_text: str,
        mode: str,
    ) -> list[object]:
        assert mode == "workflow"
        seen["propose_plan_v1"] = (model, requirements, list(tools), goal_text)
        return []

    def mock_discover_resources(
        model: object,
        tenant_id: str,
        plan_items: list[str],
        _reasoning: Callable[[str], None] | None = None,
        *,
        goal_text: str,
        requirements: Inputs,
        account_id: str | None = None,  # noqa: ARG001
    ) -> list[object]:
        seen["discover_resources"] = (model, tenant_id, plan_items, goal_text, requirements)
        return []

    def mock_assess_capability_gap(
        model: object,
        plan_items: list[str],
        options: list[ResourceOption],
        *,
        goal_text: str,
        requirements: Inputs,
        mode: str,
    ) -> str:
        assert mode == "workflow"
        seen["assess_capability_gap"] = (model, plan_items, options, goal_text, requirements)
        return ""

    def mock_bind_resources(
        model: object,
        tenant_id: str,
        plan_items: list[str],
        resource_ids: Sequence[str],
        *,
        account_id: str | None = None,  # noqa: ARG001
    ) -> list[object]:
        seen["bind_resources"] = (model, tenant_id, plan_items, resource_ids)
        return []

    def mock_build_nodes(
        tenant_id: str,
        model_config: Inputs | None,
        plan_items: list[str],
        resource_ids: Sequence[str] = (),
        *,
        mode: str,
        trusted_text: str = "",
        account_id: str | None = None,  # noqa: ARG001
    ) -> list[object]:
        assert mode == "workflow"
        seen["build_nodes"] = (tenant_id, model_config, plan_items, resource_ids, trusted_text)
        return []

    def mock_learn_from_build(
        model: object,
        goal_text: str,
        requirements: Inputs,
        plan_items: list[str],
        built_node_ids: list[str],
        _reasoning: Callable[[str], None] | None = None,
    ) -> str:
        seen["learn_from_build"] = (model, goal_text, requirements, plan_items, built_node_ids)
        return "skill"

    monkeypatch.setattr(build_mod, "propose_plan_v1", mock_propose_plan_v1)
    # The wrapper now hands the planner the tenant's READY tools (Plan 3 Task 2);
    # stub the listing so this test never reaches the plugin daemon.
    monkeypatch.setattr(build_mod, "ready_tool_catalogue", lambda _tenant_id, **_kwargs: ["catalogue-stub"])
    monkeypatch.setattr(build_mod, "discover_resources", mock_discover_resources)
    monkeypatch.setattr(build_mod, "assess_capability_gap", mock_assess_capability_gap)
    monkeypatch.setattr(build_mod, "bind_resources", mock_bind_resources)
    monkeypatch.setattr(build_mod, "build_nodes", mock_build_nodes)
    monkeypatch.setattr(build_mod, "learn_from_build", mock_learn_from_build)

    model_config: Graph = {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}}
    agent = LlmBuilderAgent("t1", model_config)
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")

    goal = "Upload the real file. " + "原始目标。" * 1800
    requirements = {"format": "pptx", "endpoint": {"url": "https://example.test"}}
    agent.propose_plan_v1(requirements, goal_text=goal)
    assert seen["propose_plan_v1"] == ("MODEL", requirements, ["catalogue-stub"], goal)
    assert seen["propose_plan_v1"][1] is requirements

    agent.discover_resources(["step"], goal_text=goal, requirements=requirements)
    assert seen["discover_resources"] == ("MODEL", "t1", ["step"], goal, requirements)
    assert seen["discover_resources"][4] is requirements

    agent.assess_capability_gap(["step"], [], goal_text=goal, requirements=requirements)
    assert seen["assess_capability_gap"] == ("MODEL", ["step"], [], goal, requirements)
    assert seen["assess_capability_gap"][4] is requirements

    agent.bind_resources(["step"], ["rid"])
    assert seen["bind_resources"] == ("MODEL", "t1", ["step"], ["rid"])

    agent.build_nodes(["step"])
    assert seen["build_nodes"] == ("t1", model_config, ["step"], (), "")

    # trusted_text forwards through the wrapper unchanged (ESQ1-302/S5b: the
    # handler threads the user's own goal+requirements text down to
    # build.build_nodes so it can tell a supplied endpoint from an invented one).
    agent.build_nodes(["step"], trusted_text="goal text and requirements")
    assert seen["build_nodes"] == ("t1", model_config, ["step"], (), "goal text and requirements")

    agent.learn_from_build("goal", {"x": 1}, ["step"], ["n1"])
    assert seen["learn_from_build"] == ("MODEL", "goal", {"x": 1}, ["step"], ["n1"])


def test_fix_methods_degrade_without_model() -> None:
    """Fix methods call fix.* which degrades gracefully when model_config is None."""
    agent = LlmBuilderAgent("t1", None)
    diag = Diagnosis(culprit_node_id="llm", root_cause="x", severity="high")
    intents, risk = agent.propose_repair(diag, {})
    assert intents == []  # degraded response: no fix
    assert risk.level == "high"  # degraded response: high risk


def test_model_is_resolved_lazily_and_memoized(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def fake_resolve(tenant_id: str, model_config: Inputs | None) -> str:  # noqa: ARG001
        calls["n"] += 1
        return "INSTANCE"

    monkeypatch.setattr(llm_agent, "resolve_model_instance", fake_resolve)
    agent = LlmBuilderAgent("t1", {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}})
    assert calls["n"] == 0  # not resolved at construction
    assert agent._model() == "INSTANCE"
    assert agent._model() == "INSTANCE"
    assert calls["n"] == 1  # memoized


def test_fix_methods_call_fix_module_with_resolved_model(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def mock_diagnose(
        model: object,
        _fr: Run,
        _g: Graph,
        _no: list[NodeOutput],
        _reasoning: Callable[[str], None] | None = None,
    ) -> str:
        seen["m"] = model
        return "DIAG"

    monkeypatch.setattr(fix_mod, "diagnose", mock_diagnose)
    agent = LlmBuilderAgent("t1", {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}})
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")
    assert agent.diagnose("run", {"nodes": []}, []) == "DIAG"
    assert seen["m"] == "MODEL"


def test_model_or_none_swallows_resolution_error(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: Graph = {}
    monkeypatch.setattr(
        fix_mod,
        "propose_repair",
        lambda model, d, g, _reasoning=None: seen.setdefault("m", model) or ([], None),  # noqa: ARG005
    )
    agent = LlmBuilderAgent("t1", None)

    def boom() -> Never:
        raise RuntimeError("no default model")

    monkeypatch.setattr(agent, "_model", boom)
    agent.propose_repair("diag", {"nodes": []})
    assert seen["m"] is None  # a resolution error -> None passed to fix (degrade path)


def test_llm_agent_generate_mock_inputs_delegates(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import mock_inputs
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    monkeypatch.setattr(mock_inputs, "generate", lambda _m, _s, _p, _reasoning=None: {"q": "x"})
    assert LlmBuilderAgent("t1", {}).generate_mock_inputs({"variables": []}, {}) == {"q": "x"}


def test_llm_agent_edit_methods_delegate_to_edit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        edit_mod,
        "analyze_impact",
        lambda _m, _g, _graph, _reasoning=None: {
            "fields": [],
            "values": {},
            "target_node_ids": [],
        },
    )
    monkeypatch.setattr(edit_mod, "build_edit_intents", lambda _m, _r, _graph, _reasoning=None, **_kw: [])
    agent = LlmBuilderAgent("t1", {})
    assert agent.analyze_impact("g", {"nodes": [], "edges": []}) == {
        "fields": [],
        "values": {},
        "target_node_ids": [],
    }
    assert agent.build_edit_intents({}, {"nodes": [], "edges": []}) == []


def test_edit_methods_call_edit_module_with_resolved_model(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mirrors test_remaining_build_methods_thread_model_and_tenant_args for the
    Edit trio: analyze_impact/propose_edit_plan/build_edit_intents each call the
    corresponding edit.* with the resolved model threaded through."""
    seen: dict[str, object] = {}

    def mock_analyze_impact(
        model: object, goal_text: str, graph: Graph, _reasoning: Callable[[str], None] | None = None
    ) -> Graph:
        seen["analyze_impact"] = (model, goal_text, graph)
        return {"fields": [], "values": {}, "target_node_ids": []}

    def mock_propose_edit_plan(
        model: object, edit_rules: Inputs, graph: Graph, _reasoning: Callable[[str], None] | None = None
    ) -> list[str]:
        seen["propose_edit_plan"] = (model, edit_rules, graph)
        return ["step"]

    def mock_build_edit_intents(
        model: object,
        edit_rules: Inputs,
        graph: Graph,
        _reasoning: Callable[[str], None] | None = None,
        **kwargs: object,
    ) -> list[object]:
        seen["build_edit_intents"] = (model, edit_rules, graph)
        seen["build_edit_intents_kwargs"] = kwargs
        return []

    monkeypatch.setattr(edit_mod, "analyze_impact", mock_analyze_impact)
    monkeypatch.setattr(edit_mod, "propose_edit_plan", mock_propose_edit_plan)
    monkeypatch.setattr(edit_mod, "build_edit_intents", mock_build_edit_intents)

    agent = LlmBuilderAgent("t1", {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}})
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")

    graph: Graph = {"nodes": [], "edges": []}
    agent.analyze_impact("goal", graph)
    assert seen["analyze_impact"] == ("MODEL", "goal", graph)

    agent.propose_edit_plan({"tone": "formal"}, graph)
    assert seen["propose_edit_plan"] == ("MODEL", {"tone": "formal"}, graph)

    agent.build_edit_intents({"tone": "formal"}, graph, edit_target_node_ids=["n1"])
    assert seen["build_edit_intents"] == ("MODEL", {"tone": "formal"}, graph)
    assert seen["build_edit_intents_kwargs"] == {"edit_target_node_ids": ["n1"], "last_edit_rejection": None}


def test_model_or_none_logs_resolution_failure_once(caplog: pytest.LogCaptureFixture) -> None:
    def _raise() -> Never:
        raise RuntimeError("no credentials")

    agent = LlmBuilderAgent("t1", {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}})
    agent._model = _raise  # type: ignore[method-assign]  # force resolution to fail

    with caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.llm_agent"):
        first = agent.model_or_none()
        second = agent.model_or_none()

    assert first is None
    assert second is None
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "model resolution failed" in warnings[0].getMessage()
    assert warnings[0].exc_info is not None


def test_message_reply_delegates_stream_callback(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def mock_respond(
        model: object,
        model_config: Inputs | None,
        state: PcState,
        context: DifyBuilderContext,
        history: list[ConversationItem],
        graph: Graph,
        text: str,
        on_delta: Callable[[str], None],
        on_reasoning: Callable[[str], None] | None,
    ) -> str:
        seen["args"] = (model, model_config, state, context, history, graph, text)
        assert on_reasoning is None
        on_delta("first ")
        on_delta("second")
        return "first second"

    monkeypatch.setattr(chat_mod, "respond", mock_respond)
    model_config: Graph = {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}}
    agent = LlmBuilderAgent("t1", model_config)
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")
    deltas: list[str] = []

    reply = agent.respond_to_message(
        PcState.FIX_AWAIT_APPROVAL,
        DifyBuilderContext(),
        [ConversationItem(kind="user", payload={"text": "history"})],
        {"nodes": [], "edges": []},
        "question",
        deltas.append,
    )

    assert reply == "first second"
    assert deltas == ["first ", "second"]
    assert seen["args"] == (
        "MODEL",
        model_config,
        PcState.FIX_AWAIT_APPROVAL,
        DifyBuilderContext(),
        [ConversationItem(kind="user", payload={"text": "history"})],
        {"nodes": [], "edges": []},
        "question",
    )


# ---- ENG-1191: the acting account and the request reach tool readiness -------


def _capture_tool_owners(monkeypatch: pytest.MonkeyPatch) -> Graph:
    seen: Graph = {}

    def ready_tool_catalogue(tenant_id: str, **kwargs: object) -> list[object]:
        seen["ready_tool_catalogue"] = (tenant_id, kwargs)
        return []

    def discover_resources(
        model: object,  # noqa: ARG001
        tenant_id: str,
        plan_items: list[str],  # noqa: ARG001
        _reasoning: Callable[[str], None] | None = None,
        **kwargs: object,
    ) -> list[object]:
        seen["discover_resources"] = (tenant_id, kwargs)
        return []

    def bind_resources(
        _model: object,
        tenant_id: str,
        _plan_items: list[str],
        _resource_ids: Sequence[str],
        **kwargs: object,
    ) -> list[object]:
        seen["bind_resources"] = (tenant_id, kwargs)
        return []

    def build_nodes(
        tenant_id: str,
        model_config: Inputs | None,  # noqa: ARG001
        plan_items: list[str],  # noqa: ARG001
        resource_ids: Sequence[str] = (),  # noqa: ARG001
        **kwargs: object,
    ) -> list[object]:
        seen["build_nodes"] = (tenant_id, kwargs)
        return []

    monkeypatch.setattr(build_mod, "propose_plan_v1", lambda *_a, **_k: [])
    monkeypatch.setattr(build_mod, "ready_tool_catalogue", ready_tool_catalogue)
    monkeypatch.setattr(build_mod, "discover_resources", discover_resources)
    monkeypatch.setattr(build_mod, "bind_resources", bind_resources)
    monkeypatch.setattr(build_mod, "build_nodes", build_nodes)
    return seen


def test_planner_tool_catalogue_is_ranked_against_the_goal_and_requirements(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_tool_owners(monkeypatch)
    agent = LlmBuilderAgent("t1", {})
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")

    agent.propose_plan_v1({"channel": "#oncall"}, goal_text="Page the on-call responders")

    tenant_id, kwargs = seen["ready_tool_catalogue"]
    assert tenant_id == "t1"
    query = " ".join(str(value) for value in kwargs.values())
    assert "Page the on-call responders" in query
    assert "#oncall" in query


def test_every_tool_owner_receives_the_acting_account(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_tool_owners(monkeypatch)
    agent = LlmBuilderAgent("t1", {}, account_id="acct-a")
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")

    agent.propose_plan_v1({}, goal_text="goal")
    agent.discover_resources(["step"], goal_text="goal", requirements={})
    agent.bind_resources(["step"], ["rid"])
    agent.build_nodes(["step"])

    for owner in ("ready_tool_catalogue", "discover_resources", "bind_resources", "build_nodes"):
        assert seen[owner][0] == "t1"
        assert seen[owner][1].get("account_id") == "acct-a", owner


def test_an_agent_without_an_actor_passes_none_rather_than_inventing_one(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _capture_tool_owners(monkeypatch)
    agent = LlmBuilderAgent("t1", {})
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")

    agent.bind_resources(["step"], ["rid"])

    assert seen["bind_resources"][1].get("account_id") is None
