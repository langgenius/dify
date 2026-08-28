"""Factory for the dify_builder's DifyBuilderAgent.

Selection order: an installed override (set_dify_builder_agent_factory, used by
tests/enterprise) wins; otherwise DIFY_BUILDER_AGENT_MODE picks the OSS agent —
"llm" -> the real LlmBuilderAgent shell (constructed with the session's model
choice), else the canned PlaceholderAgent. The Celery advance task calls
build_dify_builder_agent(tenant_id, model_config) per run.
"""

from collections.abc import Callable
from typing import Any

from configs import dify_config
from core.dify_builder.placeholder_agent import PlaceholderAgent
from core.dify_builder.ports import DifyBuilderAgent

__all__ = ["build_dify_builder_agent", "set_dify_builder_agent_factory"]

_factory: Callable[[], DifyBuilderAgent] | None = None


def set_dify_builder_agent_factory(factory: Callable[[], DifyBuilderAgent] | None) -> None:
    """Install an override factory (enterprise / tests), or ``None`` to reset."""
    global _factory
    _factory = factory


def build_dify_builder_agent(tenant_id: str = "", model_config: dict[str, Any] | None = None) -> DifyBuilderAgent:
    """Return the agent for one advance.

    tenant_id + model_config are the session's model choice (empty == tenant default);
    they matter only in "llm" mode. Default mode is "placeholder" (unchanged behavior).
    """
    if _factory is not None:
        return _factory()
    if dify_config.DIFY_BUILDER_AGENT_MODE == "llm":
        # Local import keeps the model-runtime chain out of module load for the
        # many places that import this factory.
        from services.dify_builder.agent.llm_agent import LlmBuilderAgent

        return LlmBuilderAgent(tenant_id, model_config)
    return PlaceholderAgent()
