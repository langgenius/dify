from unittest.mock import Mock

from configs import dify_config
from core.dify_builder.ports import DifyBuilderAgent
from services.dify_builder.agent.llm_agent import LlmBuilderAgent
from services.dify_builder.agent_factory import build_dify_builder_agent, set_dify_builder_agent_factory


def test_default_factory_returns_llm_agent():
    agent = build_dify_builder_agent(tenant_id="t1", model_config=None)
    assert isinstance(agent, LlmBuilderAgent)
    assert isinstance(agent, DifyBuilderAgent)  # runtime_checkable Protocol


def test_override_factory_is_used_then_reset():
    sentinel = Mock(spec=DifyBuilderAgent)
    set_dify_builder_agent_factory(lambda: sentinel)
    try:
        assert build_dify_builder_agent() is sentinel
    finally:
        set_dify_builder_agent_factory(None)
    assert isinstance(build_dify_builder_agent(), LlmBuilderAgent)


def test_legacy_agent_mode_setting_is_not_exposed():
    assert not hasattr(dify_config, "DIFY_BUILDER_AGENT_MODE")


def test_default_factory_threads_the_acting_account_to_the_agent(monkeypatch):
    from services.dify_builder.agent import build as build_mod

    seen = {}

    def bind_resources(model, tenant_id, plan_items, resource_ids, **kwargs):  # noqa: ARG001
        seen["account_id"] = kwargs.get("account_id")
        return []

    monkeypatch.setattr(build_mod, "bind_resources", bind_resources)
    agent = build_dify_builder_agent(tenant_id="t1", model_config=None, account_id="acct-a")
    monkeypatch.setattr(agent, "model_or_none", lambda: None)

    agent.bind_resources(["step"], ["rid"])

    assert seen["account_id"] == "acct-a"
