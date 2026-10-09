"""Build agent tool configuration for responses without changing stored config."""

import logging
from collections.abc import Mapping
from copy import deepcopy
from typing import cast

from pydantic import JsonValue, ValidationError

from core.agent.entities import AgentToolEntity
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolParameterConfigurationManager

logger = logging.getLogger(__name__)


def mask_agent_tool_parameters(
    *, agent_mode: Mapping[str, JsonValue], app_id: str, tenant_id: str, user_id: str
) -> dict[str, JsonValue]:
    """Return a response copy, exposing parameters only after masking succeeds."""
    result = deepcopy(dict(agent_mode))
    for tool in cast(list[JsonValue], result.get("tools") or []):
        if not isinstance(tool, dict):
            continue
        unmasked_tool = dict(tool)
        if "tool_parameters" in tool:
            tool["tool_parameters"] = {}
        if len(unmasked_tool) <= 3:
            continue
        try:
            agent_tool = AgentToolEntity.model_validate(unmasked_tool)
        except ValidationError:
            continue
        try:
            tool_runtime = ToolManager.get_agent_tool_runtime(
                tenant_id=tenant_id, app_id=app_id, agent_tool=agent_tool, user_id=user_id
            )
            manager = ToolParameterConfigurationManager(
                tenant_id=tenant_id,
                tool_runtime=tool_runtime,
                provider_name=agent_tool.provider_id,
                provider_type=agent_tool.provider_type,
                identity_id=f"AGENT.{app_id}",
            )
            if agent_tool.tool_parameters:
                parameters = manager.decrypt_tool_parameters(agent_tool.tool_parameters)
                tool["tool_parameters"] = manager.mask_tool_parameters(parameters or {})
            else:
                tool["tool_parameters"] = {}
        except Exception:
            logger.exception("Failed to mask agent tool parameters for tool %s", agent_tool.tool_name)
    return result
