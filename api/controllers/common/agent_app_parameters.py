from typing import Any, cast

from sqlalchemy import select

from core.app.apps.agent_app.app_variable_projection import agent_app_variables_to_user_input_form
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from extensions.ext_database import db
from models.agent import Agent, AgentConfigSnapshot, AgentStatus
from models.agent_config_entities import AgentSoulConfig
from models.model import App


def get_published_agent_app_feature_dict_and_user_input_form(
    app_model: App,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return public Agent App parameters backed by the published Agent Soul."""
    app_model_config = app_model.app_model_config
    features_dict = cast(dict[str, Any], app_model_config.to_dict()) if app_model_config is not None else {}

    agent_id = app_model.bound_agent_id
    if not agent_id:
        raise AgentAppGeneratorError("Agent App has no bound Agent")

    agent = db.session.scalar(
        select(Agent)
        .where(
            Agent.tenant_id == app_model.tenant_id,
            Agent.id == agent_id,
            Agent.status == AgentStatus.ACTIVE,
        )
        .limit(1)
    )
    if agent is None:
        raise AgentAppGeneratorError("Agent App has no bound Agent")
    if not agent.active_config_snapshot_id or not agent.active_config_is_published:
        raise AgentAppNotPublishedError("Agent has not been published")

    snapshot = db.session.scalar(
        select(AgentConfigSnapshot)
        .where(
            AgentConfigSnapshot.tenant_id == app_model.tenant_id,
            AgentConfigSnapshot.agent_id == agent.id,
            AgentConfigSnapshot.id == agent.active_config_snapshot_id,
        )
        .limit(1)
    )
    if snapshot is None:
        raise AgentAppGeneratorError("Agent published version not found")

    agent_soul = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict)
    return features_dict, agent_app_variables_to_user_input_form(agent_soul.app_variables)
