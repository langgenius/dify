import logging

from core.tools.entities.tool_entities import ToolProviderType
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.workflow.human_input_adapter import adapt_node_config_for_graph
from events.app_event import app_draft_workflow_was_synced
from graphon.nodes import BuiltinNodeTypes
from graphon.nodes.tool.entities import ToolEntity

logger = logging.getLogger(__name__)


@app_draft_workflow_was_synced.connect
def handle(sender, **kwargs):
    app = sender
    synced_draft_workflow = kwargs.get("synced_draft_workflow")
    if synced_draft_workflow is None:
        return
    for node_data in synced_draft_workflow.graph_dict.get("nodes", []):
        if node_data.get("data", {}).get("type") == BuiltinNodeTypes.TOOL:
            try:
                adapted_node_data = adapt_node_config_for_graph(node_data)
                tool_entity = ToolEntity.model_validate(adapted_node_data["data"])
                provider_type = ToolProviderType(tool_entity.provider_type.value)
                tool_runtime = ToolManager.get_tool_runtime(
                    provider_type=provider_type,
                    provider_id=tool_entity.provider_id,
                    tool_name=tool_entity.tool_name,
                    tenant_id=app.tenant_id,
                    credential_id=tool_entity.credential_id,
                )
                manager = ToolParameterConfigurationManager(
                    tenant_id=app.tenant_id,
                    tool_runtime=tool_runtime,
                    provider_name=tool_entity.provider_name,
                    provider_type=provider_type,
                    identity_id=f"WORKFLOW.{app.id}.{node_data.get('id')}",
                )
                manager.delete_tool_parameters_cache()
            except Exception:
                # tool dose not exist
                logger.exception(
                    "Failed to delete tool parameters cache for workflow %s node %s",
                    app.id,
                    node_data.get("id"),
                )
