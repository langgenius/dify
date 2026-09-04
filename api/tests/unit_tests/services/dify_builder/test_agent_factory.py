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
