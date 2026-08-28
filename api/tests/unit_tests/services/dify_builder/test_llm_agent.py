from core.dify_builder.models import Diagnosis
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.ports import DifyBuilderAgent
from services.dify_builder.agent import llm_agent
from services.dify_builder.agent.llm_agent import LlmBuilderAgent


def test_is_dify_builder_agent():
    assert isinstance(LlmBuilderAgent("t1", None), DifyBuilderAgent)


def test_delegates_build_methods_to_placeholder():
    agent = LlmBuilderAgent("t1", {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}})
    canned = PlaceholderAgent()
    assert agent.analyze_goal("summarize a PDF") == canned.analyze_goal("summarize a PDF")
    assert agent.propose_plan_v1({"x": 1}) == canned.propose_plan_v1({"x": 1})
    assert agent.learn_from_build("g", {}, [], []) == canned.learn_from_build("g", {}, [], [])


def test_delegates_fix_methods_to_placeholder():
    agent = LlmBuilderAgent("t1", None)
    canned = PlaceholderAgent()
    diag = Diagnosis(culprit_node_id="llm", root_cause="x", severity="high")
    assert agent.propose_repair(diag, {}) == canned.propose_repair(diag, {})


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
