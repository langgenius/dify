from typing import Any, Dict, List, Union
from core.model_runtime.entities.message_entities import PromptMessage
from core.tools.entities.tool_bundle import ApiBasedToolBundle
from core.tools.entities.tool_entities import AssistantAppMessage
from core.tools.provider.tool import Tool
from core.tools.errors import ToolProviderCredentialValidationError

class ApiTool(Tool):
    api_bundle: ApiBasedToolBundle
    """
    Api tool
    """

    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        """
            validate the credentials for Api tool
        """
        pass
    
    def _invoke(self, tool_paramters: Dict[str, Any], credentials: Dict[str, Any], prompt_messages: List[PromptMessage]) \
        -> AssistantAppMessage | List[AssistantAppMessage]:
        pass