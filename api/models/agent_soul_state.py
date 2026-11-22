"""Build and inspect Agent Soul configuration without application or persistence dependencies."""

import logging

from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig
from models.provider_ids import ModelProviderID

logger = logging.getLogger(__name__)


def agent_soul_has_model(agent_soul: AgentSoulConfig) -> bool:
    """Return whether the Agent Soul has the minimum model config required for runtime."""
    return agent_soul.model is not None


def build_initial_agent_soul(tenant_id: str, default_model: tuple[str, str] | None) -> AgentSoulConfig | None:
    """Build an initial Soul from a provider/model pair, or return None for an absent or invalid selection."""
    if default_model is None:
        return None
    agent_provider, agent_model = default_model
    try:
        provider_id = ModelProviderID(agent_provider)
    except ValueError:
        logger.warning("Invalid Agent default model, tenant_id: %s", tenant_id, exc_info=True)
        return None
    return AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id=provider_id.plugin_id,
            model_provider=str(provider_id),
            model=agent_model,
        )
    )
