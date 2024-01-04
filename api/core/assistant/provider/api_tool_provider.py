from typing import Any, Dict, List
from core.assistant.entities.assistant_entities import AssistantAppMessage, AssistantAppType
from core.assistant.provider.assistant_tool import AssistantTool
from core.assistant.provider.tool_provider import AssistantToolProvider
from core.model_runtime.entities.message_entities import PromptMessage

class ApiBasedToolProvider(AssistantToolProvider):
    @property
    def app_type(self) -> AssistantAppType:
        return AssistantAppType.API_BASED
    
    def invoke(self, 
               tool_id: int, tool_name: str, 
               tool_paramters: Dict[str, Any], 
               credentials: Dict[str, Any], 
               prompt_messages: List[PromptMessage]
        ) -> List[AssistantAppMessage]:
        """
            invoke app based assistant

            tool_name: the name of the tool, defined in `get_tools`
            tool_paramters: the parameters of the tool
            credentials: the credentials of the tool
            prompt_messages: the prompt messages that the tool can use

            :return: the messages that the tool wants to send to the user
        """
        return []

    def validate_credentials(self, tool_name: str, credentials: Dict[str, Any]) -> None:
        pass

    def validate_parameters(self, tool_name: str, tool_parameters: Dict[str, Any]) -> None:
        pass

    def get_tools(self) -> List[AssistantTool]:
        return []