"""Resolve external provider presentation data after execution reads close."""

from typing import Any

from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from models.workflow import WorkflowNodeExecutionModel
from services.tools.provider_queries import ToolProviderIcons


def node_execution_extras(
    execution: WorkflowNodeExecutionModel, *, tool_providers: ToolProviderIcons
) -> dict[str, Any]:
    from core.trigger.trigger_manager import TriggerManager
    from services.tools.tool_manager import ToolManager

    extras: dict[str, Any] = {}
    execution_metadata = execution.execution_metadata_dict
    if execution_metadata:
        if execution.node_type == BuiltinNodeTypes.TOOL and "tool_info" in execution_metadata:
            tool_info: dict[str, Any] = execution_metadata["tool_info"]
            extras["icon"] = ToolManager.get_tool_icon(
                tenant_id=execution.tenant_id,
                provider_type=tool_info["provider_type"],
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
                extras["icon"] = TriggerManager.get_trigger_plugin_icon(
                    tenant_id=execution.tenant_id,
                    provider_id=provider_id,
                )
    return extras
