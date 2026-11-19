"""Resolve external provider presentation data after execution reads close."""

from typing import Any

from constants.trigger import TRIGGER_PLUGIN_NODE_TYPE
from core.tools.entities.tool_entities import ToolProviderType
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from models.workflow import WorkflowNodeExecutionModel
from services.tools.provider_queries import ToolProviderIcons


def node_execution_extras(
    execution: WorkflowNodeExecutionModel, *, tool_providers: ToolProviderIcons
) -> dict[str, Any]:
    from core.plugin.impl.trigger import PluginTriggerClient
    from models.provider_ids import TriggerProviderID
    from models.utils.trigger_endpoint import generate_trigger_plugin_icon_url
    from services.tools.tool_manager import ToolManager

    extras: dict[str, Any] = {}
    execution_metadata = execution.execution_metadata_dict
    if execution_metadata:
        if execution.node_type == BuiltinNodeTypes.TOOL and "tool_info" in execution_metadata:
            tool_info: dict[str, Any] = execution_metadata["tool_info"]
            provider_type = ToolProviderType(tool_info["provider_type"])
            if provider_type == ToolProviderType.WORKFLOW:
                extras["workflow_tool"] = True
            extras["icon"] = ToolManager.get_tool_icon(
                tenant_id=execution.tenant_id,
                provider_type=provider_type,
                provider_id=tool_info["provider_id"],
                tool_providers=tool_providers,
            )
        elif execution.node_type == BuiltinNodeTypes.DATASOURCE and "datasource_info" in execution_metadata:
            datasource_info = execution_metadata["datasource_info"]
            extras["icon"] = datasource_info.get("icon")
        elif (
            execution.node_type == TRIGGER_PLUGIN_NODE_TYPE
            and WorkflowNodeExecutionMetadataKey.TRIGGER_INFO in execution_metadata
        ):
            trigger_info = execution_metadata[WorkflowNodeExecutionMetadataKey.TRIGGER_INFO] or {}
            provider_id = trigger_info.get("provider_id")
            if provider_id:
                provider = PluginTriggerClient().fetch_trigger_provider(execution.tenant_id, TriggerProviderID(provider_id))
                extras["icon"] = generate_trigger_plugin_icon_url(execution.tenant_id, provider.declaration.identity.icon)
    return extras
