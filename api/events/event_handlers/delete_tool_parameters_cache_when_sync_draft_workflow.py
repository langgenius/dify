from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolParameterConfigurationManager
from core.workflow.nodes import NodeType
from core.workflow.nodes.tool.entities import ToolEntity
from events.app_event import app_draft_workflow_was_synced


@app_draft_workflow_was_synced.connect
def handle(sender, **kwargs):
    app = sender
    synced_draft_workflow = kwargs.get("synced_draft_workflow")
    if synced_draft_workflow is None:
        return
    for node_data in synced_draft_workflow.graph_dict.get("nodes", []):
        if node_data.get("data", {}).get("type") == NodeType.TOOL:
            try:
                tool_entity = ToolEntity.model_validate(node_data["data"])
                tool_runtime = ToolManager.get_tool_runtime(
                    provider_type=tool_entity.provider_type,
                    provider_id=tool_entity.provider_id,
                    tool_name=tool_entity.tool_name,
                    tenant_id=app.tenant_id,
                    credential_id=tool_entity.credential_id,
                )
                manager = ToolParameterConfigurationManager(
                    tenant_id=app.tenant_id,
                    tool_runtime=tool_runtime,
                    provider_name=tool_entity.provider_name,
                    provider_type=tool_entity.provider_type,
                    identity_id=f"WORKFLOW.{app.id}.{node_data.get('id')}",
                )
                manager.delete_tool_parameters_cache()
            except:
                # tool dose not exist
                pass
