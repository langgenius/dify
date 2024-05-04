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