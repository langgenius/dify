"""Enrich detached app and workflow previews through legacy tool and key providers.

The injected queries close their database sessions before this adapter calls tool,
plugin or credential providers. TODO: Retire the remaining tool bridge when its
providers have neutral boundaries. Legacy ToolManager still owns its internal
global-session and credential-refresh behavior; this adapter does not migrate it.
"""

from collections.abc import Sequence
from dataclasses import replace
from typing import cast, override

from core.agent.tool_configuration import mask_agent_tool_parameters
from core.plugin.plugin_service import PluginService
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool_manager import ToolManager
from core.workflow.environment_variables import load_environment_variables
from core.workflow.llm_environment_variable import dump_environment_variable
from models.model import AppMode
from models.provider_ids import GenericProviderID
from services.app_preview_details_service import (
    AppPreviewDeletedTool,
    AppPreviewDetail,
    AppPreviewDetails,
    AppPreviewDetailsQuery,
    AppPreviewObject,
    AppPreviewWorkflow,
)
from services.app_preview_query_service import AppPreviewRef


class AppPreviewDetailsRuntime(AppPreviewDetails):
    def __init__(self, *, details: AppPreviewDetailsQuery) -> None:
        self._details: AppPreviewDetailsQuery = details

    @override
    def get_detail(self, *, app: AppPreviewRef, account_id: str, active_workspace_id: str) -> AppPreviewDetail:
        record = self._details.get_detail(app=app, account_id=account_id)
        detail = record.detail
        configuration = detail.model_config
        agent_mode = cast(AppPreviewObject, configuration["agent_mode"]) if configuration is not None else None
        tools = tuple(cast(Sequence[AppPreviewObject], agent_mode.get("tools", []))) if agent_mode else ()
        # Preserve the response compatibility without the legacy model's App.mode
        # update and commit. A preview query must leave persisted values unchanged.
        mode = detail.mode
        if agent_mode and agent_mode.get("enabled", False) and agent_mode.get("strategy") in {"function_call", "react"}:
            mode = AppMode.AGENT_CHAT
        if mode == AppMode.AGENT_CHAT and agent_mode is not None and configuration is not None:
            configuration = {
                **configuration,
                "agent_mode": mask_agent_tool_parameters(
                    agent_mode=agent_mode,
                    app_id=app.app_id,
                    tenant_id=active_workspace_id,
                    user_id=account_id,
                ),
            }
        return replace(
            detail,
            mode=mode,
            model_config=configuration,
            deleted_tools=self._get_deleted_tools(
                tenant_id=app.tenant_id, tools=tools, existing_api_provider_ids=record.existing_api_provider_ids
            ),
        )

    @staticmethod
    def _get_deleted_tools(
        *, tenant_id: str, tools: Sequence[AppPreviewObject], existing_api_provider_ids: frozenset[str]
    ) -> tuple[AppPreviewDeletedTool, ...]:
        builtin_providers: dict[str, GenericProviderID] = {}
        for tool in tools:
            if len(tool) < 4 or tool.get("provider_type") != ToolProviderType.BUILT_IN:
                continue
            provider_id = tool.get("provider_id")
            if not isinstance(provider_id, str) or not provider_id:
                continue
            try:
                ToolManager.get_hardcoded_provider(provider_id)
            except KeyError:
                try:
                    builtin_providers[provider_id] = GenericProviderID(provider_id)
                except ValueError:
                    continue

        missing_builtin_ids: set[str] = set()
        if builtin_providers:
            existence = PluginService.check_tools_existence(tenant_id, list(builtin_providers.values()))
            missing_builtin_ids = {
                provider_id for provider_id, exists in zip(builtin_providers, existence, strict=True) if not exists
            }

        deleted: list[AppPreviewDeletedTool] = []
        for tool in tools:
            if len(tool) < 4:
                continue
            provider_type = tool.get("provider_type")
            if provider_type not in (ToolProviderType.API, ToolProviderType.BUILT_IN):
                continue
            provider_id = tool.get("provider_id")
            tool_name = tool.get("tool_name")
            if not isinstance(provider_id, str) or not provider_id or not isinstance(tool_name, str):
                continue
            if (provider_type == ToolProviderType.API and provider_id not in existing_api_provider_ids) or (
                provider_type == ToolProviderType.BUILT_IN and provider_id in missing_builtin_ids
            ):
                deleted.append(
                    AppPreviewDeletedTool(type=str(provider_type), tool_name=tool_name, provider_id=provider_id)
                )
        return tuple(deleted)

    @override
    def get_workflow(self, *, app: AppPreviewRef) -> AppPreviewWorkflow:
        record = self._details.get_workflow(app=app)
        variables = load_environment_variables(
            tenant_id=record.tenant_id, serialized_variables=record.environment_variables_json
        )
        return replace(
            record.workflow,
            environment_variables=tuple(
                cast(AppPreviewObject, dump_environment_variable(variable, mode="json")) for variable in variables
            ),
        )
