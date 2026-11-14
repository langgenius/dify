"""Load workspace Dify tool candidates at the plugin boundary."""

import logging
from typing import Any

logger = logging.getLogger(__name__)


def list_workspace_dify_tools(*, tenant_id: str, user_id: str) -> list[dict[str, Any]]:
    """Workspace Dify Plugin tools, same source as the tool selector.

    A plugin-daemon outage must degrade the slash menu to an empty tools
    tab, not break the whole candidates endpoint.
    """
    from services.tools.builtin_tools_manage_service import BuiltinToolManageService

    try:
        providers = BuiltinToolManageService.list_builtin_tools(user_id, tenant_id)
    except Exception:
        logger.warning("candidates: failed to list workspace tools for tenant %s", tenant_id, exc_info=True)
        return []
    tools: list[dict[str, Any]] = []
    for provider in providers:
        provider_tools = provider.tools or []
        # Provider-level entry first: selecting it means "all tools of this
        # provider" (a provider hosts many tools, like an MCP server). Its
        # ``id`` is also the mention id (``[§tool:<provider>/*§]``); the
        # write-back is one ``tools.dify_tools`` entry with ``tool_name``
        # omitted.
        tools.append(
            {
                "id": f"{provider.name}/*",
                "granularity": "provider",
                "name": provider.label.en_US if provider.label else provider.name,
                "description": provider.description.en_US if provider.description else None,
                "provider": provider.name,
                "plugin_id": provider.plugin_id or None,
                "tools_count": len(provider_tools),
            }
        )
        for tool in provider_tools:
            tools.append(
                {
                    "id": f"{provider.name}/{tool.name}",
                    "granularity": "tool",
                    "name": tool.name,
                    "description": tool.label.en_US if tool.label else tool.name,
                    "provider": provider.name,
                    "plugin_id": provider.plugin_id or None,
                }
            )
    return tools
