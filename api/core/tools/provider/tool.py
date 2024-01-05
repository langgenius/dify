from pydantic import BaseModel

from typing import List, Dict, Any, Union
from abc import abstractmethod, ABC

from core.tools.entities.tool_entities import ToolIdentity, AssistantAppMessage,\
    ToolParamter, ToolDescription
from core.model_runtime.entities.message_entities import PromptMessage

class Tool(BaseModel, ABC):
    identity: ToolIdentity = None
    parameters: List[ToolParamter] = None
    description: ToolDescription = None
    is_team_authorization: bool = False

    def invoke(self, tool_paramters: Dict[str, Any],
        credentials: Dict[str, Any],
        prompt_messages: List[PromptMessage]
    ) -> List[AssistantAppMessage]:
        result = self._invoke(
            tool_paramters=tool_paramters,
            credentials=credentials,
            prompt_messages=prompt_messages
        )

        if isinstance(result, list):
            return result
        
        return [result]

    @abstractmethod
    def _invoke(self, tool_paramters: Dict[str, Any],
        credentials: Dict[str, Any],
        prompt_messages: List[PromptMessage]
    ) -> Union[AssistantAppMessage, List[AssistantAppMessage]]:
        pass

    def create_image_message(self, image: str) -> AssistantAppMessage:
        """
            create an image message

            :param image: the url of the image
            :return: the image message
        """
        return AssistantAppMessage(type=AssistantAppMessage.MessageType.IMAGE, message=image)
    
    def create_link_message(self, link: str) -> AssistantAppMessage:
        """
            create a link message

            :param link: the url of the link
            :return: the link message
        """
        return AssistantAppMessage(type=AssistantAppMessage.MessageType.LINK, message=link)
    
    def create_text_message(self, text: str) -> AssistantAppMessage:
        """
            create a text message

            :param text: the text
            :return: the text message
        """
        return AssistantAppMessage(type=AssistantAppMessage.MessageType.TEXT, message=text)