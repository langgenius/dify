from typing import Any

from models.agent_config_entities import AgentSoulConfig


def merge_agent_app_features(
    *,
    agent_soul: AgentSoulConfig,
    app_model_config: Any | None,
) -> dict[str, Any]:
    """Project public Agent App features from legacy config plus Agent Soul.

    The hidden backing app may still carry legacy presentation fields such as
    opening statements. Agent Soul is the source of truth for Agent-owned
    features like file upload, so Soul fields override same-named legacy keys.
    """
    features: dict[str, Any] = dict(app_model_config.to_dict()) if app_model_config else {}
    soul_features = agent_soul.app_features.model_dump(mode="json", exclude_none=True)
    features.update(soul_features)
    return features


__all__ = ["merge_agent_app_features"]
