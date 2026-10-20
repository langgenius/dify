"""App response enrichment through tool runtimes and plugin metadata."""

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import replace
from typing import cast

from pydantic import JsonValue

from core.agent.tool_configuration import mask_agent_tool_parameters
from core.plugin.plugin_service import PluginService
from core.tools.tool_manager import ToolManager
from machinery.context import RequestContext
from models.model import AppMode
from models.provider_ids import GenericProviderID
from services.entities.app_entities import AppRecord, AppToolReference


class AppResponseGateway:
    @staticmethod
    def find_deleted_tools(tenant_id: str, references: tuple[AppToolReference, ...]) -> list[dict[str, str]]:
        """Resolve builtin tool availability from detached references, without a database session."""
        providers: dict[str, GenericProviderID] = {}
        existence: dict[str, bool] = {}
        for ref in references:
            if ref.provider_type != "builtin" or ref.provider_id in providers:
                continue
            try:
                try:
                    ToolManager.get_hardcoded_provider(ref.provider_id)
                    is_hardcoded = True
                except Exception:
                    is_hardcoded = False
                providers[ref.provider_id] = GenericProviderID(ref.provider_id, is_hardcoded)
            except Exception:
                continue
            if is_hardcoded:
                existence[ref.provider_id] = True
        remote_providers = {key: provider for key, provider in providers.items() if not provider.is_hardcoded}
        if remote_providers:
            states = PluginService.check_tools_existence(tenant_id, list(remote_providers.values()))
            existence.update(zip(remote_providers, states, strict=True))
        return [
            {"type": ref.provider_type, "tool_name": ref.tool_name, "provider_id": ref.provider_id}
            for ref in references
            if (ref.provider_type == "api" and ref.exists is False)
            or (ref.provider_type == "builtin" and existence.get(ref.provider_id) is False)
        ]

    @staticmethod
    def mask_record(context: RequestContext, app: AppRecord) -> AppRecord:
        if app.mode_compatible_with_agent != AppMode.AGENT_CHAT or app.app_model_config is None:
            return app
        config = deepcopy(app.app_model_config)
        config["agent_mode"] = mask_agent_tool_parameters(
            agent_mode=cast(Mapping[str, JsonValue], config.get("agent_mode", {})),
            tenant_id=context.active_workspace_id,
            app_id=app.id,
            user_id=context.account_id,
        )
        return replace(app, app_model_config=config)
