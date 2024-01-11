from pydantic import BaseModel

from typing import List, Dict, Any, Union
from abc import abstractmethod, ABC

from core.tools.entities.tool_entities import ToolIdentity, ToolInvokeMessage,\
    ToolParamter, ToolDescription
from core.model_runtime.entities.message_entities import PromptMessage

class Tool(BaseModel, ABC):
    identity: ToolIdentity = None
    parameters: List[ToolParamter] = None
    description: ToolDescription = None
    is_team_authorization: bool = False

    def invoke(self, 
        user_id: str,
        tool_paramters: Dict[str, Any]
    ) -> List[ToolInvokeMessage]:
        result = self._invoke(
            user_id=user_id,
            tool_paramters=tool_paramters,
        )

        if isinstance(result, list):
            return result
        
        return [result]

    @abstractmethod
    def _invoke(self, user_id: str, tool_paramters: Dict[str, Any]) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        pass
    
    @abstractmethod
    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        """
            validate the credentials

            :param credentails: the credentials
            :param parameters: the parameters
        """
        pass

    def create_image_message(self, image: str) -> ToolInvokeMessage:
        """
            create an image message

            :param image: the url of the image
            :return: the image message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.IMAGE, message=image)
    
    def create_link_message(self, link: str) -> ToolInvokeMessage:
        """
            create a link message

            :param link: the url of the link
            :return: the link message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.LINK, message=link)
    
    def create_text_message(self, text: str) -> ToolInvokeMessage:
        """
            create a text message

            :param text: the text
            :return: the text message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.TEXT, message=text)
    
    def create_blob_message(self, blob: bytes, meta: dict = None) -> ToolInvokeMessage:
        """
            create a blob message

            :param blob: the blob
            :return: the blob message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.BLOB, message=blob, meta=meta)