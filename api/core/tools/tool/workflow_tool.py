from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.tool.tool import Tool


class WorkflowTool(Tool):
    workflow_app_id: str

    """
    Workflow tool.
    """
    def tool_provider_type(self) -> ToolProviderType:
        """
            get the tool provider type

            :return: the tool provider type
        """
        return ToolProviderType.WORKFLOW_BASED
    
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) \
        -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke the tool
        """
        pass

    def fork_tool_runtime(self, meta: dict[str, Any]) -> 'WorkflowTool':
        """
            fork a new tool with meta data

            :param meta: the meta data of a tool call processing, tenant_id is required
            :return: the new tool
        """
        return self.__class__(
            identity=self.identity.copy() if self.identity else None,
            parameters=self.parameters.copy() if self.parameters else None,
            description=self.description.copy() if self.description else None,
            runtime=Tool.Runtime(**meta),
            workflow_app_id=self.workflow_app_id,
        )