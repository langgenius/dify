import logging

from core.dify_builder.models import Diagnosis
from core.dify_builder.ports import DifyBuilderAgent
from services.dify_builder.agent import build as build_mod
from services.dify_builder.agent import edit as edit_mod
from services.dify_builder.agent import fix as fix_mod
from services.dify_builder.agent import llm_agent
from services.dify_builder.agent.llm_agent import LlmBuilderAgent


def test_is_dify_builder_agent():
    assert isinstance(LlmBuilderAgent("t1", None), DifyBuilderAgent)


def test_llm_agent_build_methods_delegate_to_build(monkeypatch):
    from services.dify_builder.agent import build

    monkeypatch.setattr(
        build,
        "analyze_goal",
        lambda _m, _g: {"fields": [{"key": "k", "label": "K", "type": "text"}], "values": {}},
    )
    agent = LlmBuilderAgent("t1", {})
    assert agent.analyze_goal("goal")["fields"][0]["key"] == "k"


def test_build_methods_call_build_module_with_resolved_model(monkeypatch):
    seen = {}

    def mock_analyze_goal(model, _goal_text):
        seen["m"] = model
        return {"fields": [], "values": {}}

    monkeypatch.setattr(build_mod, "analyze_goal", mock_analyze_goal)
    agent = LlmBuilderAgent("t1", {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}})
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")
    agent.analyze_goal("goal")
    assert seen["m"] == "MODEL"


def test_remaining_build_methods_thread_model_and_tenant_args(monkeypatch):
    """Mirrors test_build_methods_call_build_module_with_resolved_model for
    analyze_goal: pins that propose_plan_v1/discover_resources/bind_resources/
    build_nodes/learn_from_build each call the corresponding build.* with the
    resolved model threaded through (build_nodes takes no model -- it threads
    self._tenant_id/self._model_config directly instead)."""
    seen = {}

    def mock_propose_plan_v1(model, requirements):
        seen["propose_plan_v1"] = (model, requirements)
        return []

    def mock_discover_resources(model, tenant_id, plan_items):
        seen["discover_resources"] = (model, tenant_id, plan_items)
        return []

    def mock_bind_resources(model, tenant_id, plan_items, resource_ids, conflict_policy):
        seen["bind_resources"] = (model, tenant_id, plan_items, resource_ids, conflict_policy)
        return []

    def mock_build_nodes(tenant_id, model_config, plan_items):
        seen["build_nodes"] = (tenant_id, model_config, plan_items)
        return []

    def mock_learn_from_build(model, goal_text, requirements, plan_items, built_node_ids):
        seen["learn_from_build"] = (model, goal_text, requirements, plan_items, built_node_ids)
        return "skill"

    monkeypatch.setattr(build_mod, "propose_plan_v1", mock_propose_plan_v1)
    monkeypatch.setattr(build_mod, "discover_resources", mock_discover_resources)
    monkeypatch.setattr(build_mod, "bind_resources", mock_bind_resources)
    monkeypatch.setattr(build_mod, "build_nodes", mock_build_nodes)
    monkeypatch.setattr(build_mod, "learn_from_build", mock_learn_from_build)

    model_config = {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}}
    agent = LlmBuilderAgent("t1", model_config)
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")

    agent.propose_plan_v1({"x": 1})
    assert seen["propose_plan_v1"] == ("MODEL", {"x": 1})

    agent.discover_resources(["step"])
    assert seen["discover_resources"] == ("MODEL", "t1", ["step"])

    agent.bind_resources(["step"], ["rid"], "audited")
    assert seen["bind_resources"] == ("MODEL", "t1", ["step"], ["rid"], "audited")

    agent.build_nodes(["step"])
    assert seen["build_nodes"] == ("t1", model_config, ["step"])

    agent.learn_from_build("goal", {"x": 1}, ["step"], ["n1"])
    assert seen["learn_from_build"] == ("MODEL", "goal", {"x": 1}, ["step"], ["n1"])


def test_fix_methods_degrade_without_model():
    """Fix methods call fix.* which degrades gracefully when model_config is None."""
    agent = LlmBuilderAgent("t1", None)
    diag = Diagnosis(culprit_node_id="llm", root_cause="x", severity="high")
    intents, risk = agent.propose_repair(diag, {})
    assert intents == []  # degraded response: no fix
    assert risk.level == "high"  # degraded response: high risk


def test_model_is_resolved_lazily_and_memoized(monkeypatch):
    calls = {"n": 0}

    def fake_resolve(tenant_id, model_config):  # noqa: ARG001
        calls["n"] += 1
        return "INSTANCE"

    monkeypatch.setattr(llm_agent, "resolve_model_instance", fake_resolve)
    agent = LlmBuilderAgent("t1", {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}})
    assert calls["n"] == 0  # not resolved at construction
    assert agent._model() == "INSTANCE"
    assert agent._model() == "INSTANCE"
    assert calls["n"] == 1  # memoized


def test_fix_methods_call_fix_module_with_resolved_model(monkeypatch):
    seen = {}

    def mock_diagnose(model, fr, g, no):  # noqa: ARG001
        seen["m"] = model
        return "DIAG"

    monkeypatch.setattr(fix_mod, "diagnose", mock_diagnose)
    agent = LlmBuilderAgent("t1", {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}})
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")
    assert agent.diagnose("run", {"nodes": []}, []) == "DIAG"
    assert seen["m"] == "MODEL"


def test_model_or_none_swallows_resolution_error(monkeypatch):
    seen = {}
    monkeypatch.setattr(fix_mod, "propose_repair", lambda model, d, g: seen.setdefault("m", model) or ([], None))  # noqa: ARG005
    agent = LlmBuilderAgent("t1", None)

    def boom():
        raise RuntimeError("no default model")

    monkeypatch.setattr(agent, "_model", boom)
    agent.propose_repair("diag", {"nodes": []})
    assert seen["m"] is None  # a resolution error -> None passed to fix (degrade path)


def test_llm_agent_generate_mock_inputs_delegates(monkeypatch):
    from services.dify_builder.agent import mock_inputs
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    monkeypatch.setattr(mock_inputs, "generate", lambda _m, _s, _p: {"q": "x"})
    assert LlmBuilderAgent("t1", {}).generate_mock_inputs({"variables": []}, {}) == {"q": "x"}


def test_llm_agent_edit_methods_delegate_to_edit(monkeypatch):
    monkeypatch.setattr(
        edit_mod,
        "analyze_impact",
        lambda _m, _g, _graph: {"fields": [], "values": {}, "target_node_ids": []},
    )
    monkeypatch.setattr(edit_mod, "build_edit_intents", lambda _m, _r, _graph: [])
    agent = LlmBuilderAgent("t1", {})
    assert agent.analyze_impact("g", {"nodes": [], "edges": []}) == {
        "fields": [],
        "values": {},
        "target_node_ids": [],
    }
    assert agent.build_edit_intents({}, {"nodes": [], "edges": []}) == []


def test_edit_methods_call_edit_module_with_resolved_model(monkeypatch):
    """Mirrors test_remaining_build_methods_thread_model_and_tenant_args for the
    Edit trio: analyze_impact/propose_edit_plan/build_edit_intents each call the
    corresponding edit.* with the resolved model threaded through."""
    seen = {}

    def mock_analyze_impact(model, goal_text, graph):
        seen["analyze_impact"] = (model, goal_text, graph)
        return {"fields": [], "values": {}, "target_node_ids": []}

    def mock_propose_edit_plan(model, edit_rules, graph):
        seen["propose_edit_plan"] = (model, edit_rules, graph)
        return ["step"]

    def mock_build_edit_intents(model, edit_rules, graph):
        seen["build_edit_intents"] = (model, edit_rules, graph)
        return []

    monkeypatch.setattr(edit_mod, "analyze_impact", mock_analyze_impact)
    monkeypatch.setattr(edit_mod, "propose_edit_plan", mock_propose_edit_plan)
    monkeypatch.setattr(edit_mod, "build_edit_intents", mock_build_edit_intents)

    agent = LlmBuilderAgent("t1", {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}})
    monkeypatch.setattr(agent, "_model", lambda: "MODEL")

    graph = {"nodes": [], "edges": []}
    agent.analyze_impact("goal", graph)
    assert seen["analyze_impact"] == ("MODEL", "goal", graph)

    agent.propose_edit_plan({"tone": "formal"}, graph)
    assert seen["propose_edit_plan"] == ("MODEL", {"tone": "formal"}, graph)

    agent.build_edit_intents({"tone": "formal"}, graph)
    assert seen["build_edit_intents"] == ("MODEL", {"tone": "formal"}, graph)


def test_model_or_none_logs_resolution_failure_once(caplog):
    def _raise():
        raise RuntimeError("no credentials")

    agent = LlmBuilderAgent("t1", {"provider": "p", "name": "m", "mode": "chat", "completion_params": {}})
    agent._model = _raise  # type: ignore[method-assign]  # force resolution to fail

    with caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.llm_agent"):
        first = agent._model_or_none()
        second = agent._model_or_none()

    assert first is None
    assert second is None
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "model resolution failed" in warnings[0].getMessage()
    assert warnings[0].exc_info is not None
