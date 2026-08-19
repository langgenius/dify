from core.workflow_copilot.placeholder_agent import PlaceholderAgent
from core.workflow_copilot.ports import CopilotAgent
from services.workflow_copilot.agent_factory import build_copilot_agent, set_copilot_agent_factory


def test_default_factory_returns_placeholder():
    agent = build_copilot_agent()
    assert isinstance(agent, PlaceholderAgent)
    assert isinstance(agent, CopilotAgent)  # runtime_checkable Protocol


def test_override_factory_is_used_then_reset():
    class _Stub:
        def diagnose(self, *a, **k): ...
        def propose_repair(self, *a, **k): ...
        def diagnose_checklist(self, *a, **k): ...
        def generate_mock_inputs(self, *a, **k): ...

    sentinel = _Stub()
    set_copilot_agent_factory(lambda: sentinel)
    try:
        assert build_copilot_agent() is sentinel
    finally:
        set_copilot_agent_factory(None)
    assert isinstance(build_copilot_agent(), PlaceholderAgent)
