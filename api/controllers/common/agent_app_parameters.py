from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.apps.agent_app.app_feature_projection import merge_agent_app_features
from core.app.apps.agent_app.app_variable_projection import agent_app_variables_to_user_input_form
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from models.agent import Agent, AgentConfigSnapshot, AgentStatus
from models.agent_config_entities import AgentSoulConfig
from models.model import App, load_annotation_reply_config


def get_published_agent_app_feature_dict_and_user_input_form(
    app_model: App,
    *,
    session: Session,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return public Agent App parameters backed by the published Agent Soul."""
    app_model_config = app_model.app_model_config_with_session(session=session)

    agent_id = app_model.bound_agent_id
    if not agent_id:
        raise AgentAppGeneratorError("Agent App has no bound Agent")

    agent = session.scalar(
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
    # active_config_is_published means the draft has no unpublished edits; the public app
    # can still read parameters from the active snapshot while a newer draft is pending.
    if not agent.active_config_snapshot_id:
        raise AgentAppNotPublishedError("Agent has not been published")

    snapshot = session.scalar(
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
    annotation_reply = load_annotation_reply_config(session, app_model.id) if app_model_config else None
    features_dict = merge_agent_app_features(
        agent_soul=agent_soul,
        app_model_config=app_model_config,
        annotation_reply=annotation_reply,
    )
    return features_dict, agent_app_variables_to_user_input_form(agent_soul.app_variables)
