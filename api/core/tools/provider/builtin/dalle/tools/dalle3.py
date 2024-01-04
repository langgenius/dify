from typing import Any, Dict, List, Union
from core.tools.entities.assistant_entities import AssistantAppMessage
from core.tools.provider.tool_provider import AssistantTool
from core.model_runtime.entities.message_entities import PromptMessage

class DallE3Tool(AssistantTool):
    def _invoke(self, 
               tool_paramters: Dict[str, Any], 
               credentials: Dict[str, Any], 
               prompt_messages: List[PromptMessage]
        ) -> Union[AssistantAppMessage, List[AssistantAppMessage]]:
        """
            invoke tools
        """
        return self.create_image_message(image='https://images.openai.com/blob/b196df3a-6fea-4d86-87b2-f9bb50be64c7/leaf.png')