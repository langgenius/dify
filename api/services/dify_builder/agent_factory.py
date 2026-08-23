"""Factory for the dify_builder's DifyBuilderAgent, the OSS↔enterprise split point.

OSS returns the canned PlaceholderAgent. Enterprise calls
``set_dify_builder_agent_factory`` at startup to inject a licensed ProAgent behind
the same ``core.dify_builder.ports.DifyBuilderAgent`` Protocol. The Celery
advance task calls ``build_dify_builder_agent()`` per run.
"""

from collections.abc import Callable

from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.ports import DifyBuilderAgent

__all__ = ["build_dify_builder_agent", "set_dify_builder_agent_factory"]

_factory: Callable[[], DifyBuilderAgent] | None = None


def set_dify_builder_agent_factory(factory: Callable[[], DifyBuilderAgent] | None) -> None:
    """Install an override factory (enterprise ProAgent), or ``None`` to reset."""
    global _factory
    _factory = factory


def build_dify_builder_agent() -> DifyBuilderAgent:
    """Return the agent for one advance. Default: the OSS PlaceholderAgent."""
    if _factory is not None:
        return _factory()
    return PlaceholderAgent()
