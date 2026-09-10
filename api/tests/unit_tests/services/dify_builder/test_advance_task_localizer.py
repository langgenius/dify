# tests/unit_tests/services/dify_builder/test_advance_task_localizer.py
"""The advance task builds a Localizer bound to the agent's model and wires Env."""

from services.dify_builder.agent.localize import Localizer
from services.dify_builder.agent.llm_agent import LlmBuilderAgent


def test_localizer_uses_agent_model_provider(monkeypatch):
    agent = LlmBuilderAgent(tenant_id="t", model_config={})
    calls = {"n": 0}

    def fake_model_or_none():
        calls["n"] += 1
        return None

    monkeypatch.setattr(agent, "_model_or_none", fake_model_or_none)
    loc = Localizer(agent._model_or_none)
    # model unavailable -> detection falls back to en, and the provider was consulted
    assert loc.detect_language("hello") == "en"
    assert calls["n"] >= 1
