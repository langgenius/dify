from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.ports import DifyBuilderAgent
from services.dify_builder.agent_factory import build_dify_builder_agent, set_dify_builder_agent_factory


def test_default_factory_returns_placeholder():
    agent = build_dify_builder_agent()
    assert isinstance(agent, PlaceholderAgent)
    assert isinstance(agent, DifyBuilderAgent)  # runtime_checkable Protocol


def test_override_factory_is_used_then_reset():
    class _Stub:
        def diagnose(self, *a, **k): ...
        def propose_repair(self, *a, **k): ...
        def diagnose_checklist(self, *a, **k): ...
        def generate_mock_inputs(self, *a, **k): ...

    sentinel = _Stub()
    set_dify_builder_agent_factory(lambda: sentinel)
    try:
        assert build_dify_builder_agent() is sentinel
    finally:
        set_dify_builder_agent_factory(None)
    assert isinstance(build_dify_builder_agent(), PlaceholderAgent)
