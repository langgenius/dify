from typing import Any

from models.agent_config_entities import AgentSoulConfig
from models.model import AnnotationReplyConfig


def merge_agent_app_features(
    *,
    agent_soul: AgentSoulConfig,
    app_model_config: Any | None,
    annotation_reply: AnnotationReplyConfig | None,
) -> dict[str, Any]:
    """Project public Agent App features from legacy config plus Agent Soul.

    The hidden backing app may still carry legacy presentation fields such as
    opening statements. Agent Soul is the source of truth for Agent-owned
    features like file upload, so Soul fields override same-named legacy keys.
    """
    if app_model_config is None:
        features: dict[str, Any] = {}
    else:
        if annotation_reply is None:
            raise ValueError("Annotation reply config is required")
        features = dict(app_model_config.to_dict(annotation_reply=annotation_reply))
    soul_features = agent_soul.app_features.model_dump(mode="json", exclude_none=True)
    features.update(soul_features)
    return features


__all__ = ["merge_agent_app_features"]
