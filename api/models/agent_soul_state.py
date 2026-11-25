"""Build and inspect Agent Soul configuration without application or persistence dependencies."""

import logging
import uuid

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


def backfill_cli_tool_ids(agent_soul: AgentSoulConfig | None) -> None:
    """Mint stable ids for CLI tools that predate the id field (ENG-616).

    `[§cli_tool:<id>§]` mentions resolve by id so renames never break references;
    the frontend mints ids for new entries, and save backfills legacy ones. Runs
    before validation so duplicate-id checks see the final state. Save-only — the
    validate endpoint must not mutate the payload.
    """
    if agent_soul is None:
        return
    seen_ids = {cli_tool.id for cli_tool in agent_soul.tools.cli_tools if cli_tool.id}
    for cli_tool in agent_soul.tools.cli_tools:
        if not cli_tool.id:
            minted = uuid.uuid4().hex[:12]
            while minted in seen_ids:
                minted = uuid.uuid4().hex[:12]
            cli_tool.id = minted
            seen_ids.add(minted)
