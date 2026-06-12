from models.agent_config_entities import AgentSoulConfig


def agent_soul_has_model(agent_soul: AgentSoulConfig) -> bool:
    """Return whether the Agent Soul has the minimum model config required for runtime."""
    return agent_soul.model is not None
