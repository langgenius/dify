"""Factory for the dify_builder's LLM-backed ``DifyBuilderAgent``.

An installed override (used by tests or an enterprise extension) wins.
Production always constructs ``LlmBuilderAgent`` with the session's model
choice; there is no runtime placeholder mode.
"""

from collections.abc import Callable
from typing import Any

from core.dify_builder.ports import DifyBuilderAgent

__all__ = ["build_dify_builder_agent", "set_dify_builder_agent_factory"]

_factory: Callable[[], DifyBuilderAgent] | None = None


def set_dify_builder_agent_factory(factory: Callable[[], DifyBuilderAgent] | None) -> None:
    """Install an override factory (enterprise / tests), or ``None`` to reset."""
    global _factory
    _factory = factory


def build_dify_builder_agent(tenant_id: str = "", model_config: dict[str, Any] | None = None) -> DifyBuilderAgent:
    """Return the LLM-backed agent for one advance."""
    if _factory is not None:
        return _factory()
    # Keep the model-runtime dependency chain lazy for modules that only
    # install or type the factory override.
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    return LlmBuilderAgent(tenant_id, model_config)
