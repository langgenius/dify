"""Factory for the copilot's CopilotAgent, the OSS↔enterprise split point.

OSS returns the canned PlaceholderAgent. Enterprise calls
``set_copilot_agent_factory`` at startup to inject a licensed ProAgent behind
the same ``core.workflow_copilot.ports.CopilotAgent`` Protocol. The Celery
advance task calls ``build_copilot_agent()`` per run.
"""

from collections.abc import Callable

from core.workflow_copilot.placeholder_agent import PlaceholderAgent
from core.workflow_copilot.ports import CopilotAgent

__all__ = ["build_copilot_agent", "set_copilot_agent_factory"]

_factory: Callable[[], CopilotAgent] | None = None


def set_copilot_agent_factory(factory: Callable[[], CopilotAgent] | None) -> None:
    """Install an override factory (enterprise ProAgent), or ``None`` to reset."""
    global _factory
    _factory = factory


def build_copilot_agent() -> CopilotAgent:
    """Return the agent for one advance. Default: the OSS PlaceholderAgent."""
    if _factory is not None:
        return _factory()
    return PlaceholderAgent()
