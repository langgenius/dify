from core.tools.provider.tool_provider import AssistantTool
from core.tools.entities.assistant_entities import AssistantAppMessage, AssistantAppType
from core.model_runtime.entities.message_entities import PromptMessage

from typing import Any, Dict, List, Union

class GoogleSearchTool(AssistantTool):
    def _invoke(self, 
               tool_paramters: Dict[str, Any], 
               credentials: Dict[str, Any], 
               prompt_messages: List[PromptMessage]
        ) -> Union[AssistantAppMessage, List[AssistantAppMessage]]:
        """
            invoke tools
        """
        return self.create_link_message(link='https://www.google.com')