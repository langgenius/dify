from collections.abc import Generator
from typing import Any, Union

from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.plugin_tool_callback_handler import DifyPluginCallbackHandler
from core.model_runtime.entities.model_entities import ModelType
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.entities.node_entities import NodeType
from models.account import Tenant
from services.tools.tools_transform_service import ToolTransformService


class PluginInvokeService:
    @classmethod
    def invoke_tool(cls, user_id: str, invoke_from: InvokeFrom, tenant: Tenant, 
                    tool_provider_type: ToolProviderType, tool_provider: str, tool_name: str,
                    tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        """
        Invokes a tool with the given user ID and tool parameters.
        """
        tool_runtime = ToolManager.get_tool_runtime(tool_provider_type, provider_id=tool_provider, 
                                                    tool_name=tool_name, tenant_id=tenant.id, 
                                                    invoke_from=invoke_from)
        
        response = ToolEngine.plugin_invoke(tool_runtime, 
                                            tool_parameters, 
                                            user_id, 
                                            callback=DifyPluginCallbackHandler())
        response = ToolFileMessageTransformer.transform_tool_invoke_messages(response)
        return ToolTransformService.transform_messages_to_dict(response)
        
    @classmethod
    def invoke_model(cls, user_id: str, tenant: Tenant, 
                     model_provider: str, model_name: str, model_type: ModelType,
                     model_parameters: dict[str, Any]) -> Union[dict, Generator[ToolInvokeMessage]]:
        """
        Invokes a model with the given user ID and model parameters.
        """

    @classmethod
    def invoke_workflow_node(cls, user_id: str, tenant: Tenant, 
                              node_type: NodeType, node_data: dict[str, Any],
                              inputs: dict[str, Any]) -> Generator[ToolInvokeMessage]:
        """
        Invokes a workflow node with the given user ID and node parameters.
        """