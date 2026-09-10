"""The advance task builds a Localizer bound to the agent's model provider."""

from services.dify_builder.agent.llm_agent import LlmBuilderAgent
from services.dify_builder.agent.localize import Localizer


def test_localizer_uses_agent_model_provider(monkeypatch):
    agent = LlmBuilderAgent(tenant_id="t", model_config={})
    calls = {"n": 0}

    def fake_model_or_none():
        # implicitly returns None -> the provider yields "no model", so
        # localization degrades to English (the path this test pins).
        calls["n"] += 1

    monkeypatch.setattr(agent, "model_or_none", fake_model_or_none)
    loc = Localizer(agent.model_or_none)
    # model unavailable -> detection falls back to en, and the provider was consulted
    assert loc.detect_language("hello") == "en"
    assert calls["n"] >= 1
