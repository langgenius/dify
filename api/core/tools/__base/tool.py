from abc import ABC, abstractmethod
from collections.abc import Generator
from copy import deepcopy
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from models.model import File

from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)


class Tool(ABC):
    """
    The base class of a tool
    """

    entity: ToolEntity
    runtime: ToolRuntime

    def __init__(self, entity: ToolEntity, runtime: ToolRuntime) -> None:
        self.entity = entity
        self.runtime = runtime

    def fork_tool_runtime(self, runtime: ToolRuntime) -> "Tool":
        """
        fork a new tool with metadata
        :return: the new tool
        """
        return self.__class__(
            entity=self.entity.model_copy(),
            runtime=runtime,
        )

    @abstractmethod
    def tool_provider_type(self) -> ToolProviderType:
        """
        get the tool provider type

        :return: the tool provider type
        """

    def invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage]:
        if self.runtime and self.runtime.runtime_parameters:
            tool_parameters.update(self.runtime.runtime_parameters)

        # try parse tool parameters into the correct type
        tool_parameters = self._transform_tool_parameters_type(tool_parameters)

        result = self._invoke(
            user_id=user_id,
            tool_parameters=tool_parameters,
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        )

        if isinstance(result, ToolInvokeMessage):

            def single_generator() -> Generator[ToolInvokeMessage, None, None]:
                yield result

            return single_generator()
        elif isinstance(result, list):

            def generator() -> Generator[ToolInvokeMessage, None, None]:
                yield from result

            return generator()
        else:
            return result

    def _transform_tool_parameters_type(self, tool_parameters: dict[str, Any]) -> dict[str, Any]:
        """
        Transform tool parameters type
        """
        # Temp fix for the issue that the tool parameters will be converted to empty while validating the credentials
        result = deepcopy(tool_parameters)
        for parameter in self.entity.parameters or []:
            if parameter.name in tool_parameters:
                result[parameter.name] = parameter.type.cast_value(tool_parameters[parameter.name])

        return result

    @abstractmethod
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> ToolInvokeMessage | list[ToolInvokeMessage] | Generator[ToolInvokeMessage, None, None]:
        pass

    def get_runtime_parameters(
        self,
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> list[ToolParameter]:
        """
        get the runtime parameters

        interface for developer to dynamic change the parameters of a tool depends on the variables pool

        :return: the runtime parameters
        """
        return self.entity.parameters

    def get_merged_runtime_parameters(
        self,
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> list[ToolParameter]:
        """
        get merged runtime parameters

        :return: merged runtime parameters
        """
        parameters = self.entity.parameters
        parameters = parameters.copy()
        user_parameters = self.get_runtime_parameters() or []
        user_parameters = user_parameters.copy()

        # override parameters
        for parameter in user_parameters:
            # check if parameter in tool parameters
            for tool_parameter in parameters:
                if tool_parameter.name == parameter.name:
                    # override parameter
                    tool_parameter.type = parameter.type
                    tool_parameter.form = parameter.form
                    tool_parameter.required = parameter.required
                    tool_parameter.default = parameter.default
                    tool_parameter.options = parameter.options
                    tool_parameter.llm_description = parameter.llm_description
                    break
            else:
                # add new parameter
                parameters.append(parameter)

        return parameters

    def create_image_message(
        self,
        image: str,
    ) -> ToolInvokeMessage:
        """
        create an image message

        :param image: the url of the image
        :return: the image message
        """
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.IMAGE, message=ToolInvokeMessage.TextMessage(text=image)
        )

    def create_file_message(self, file: "File") -> ToolInvokeMessage:
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.FILE,
            message=ToolInvokeMessage.FileMessage(),
            meta={"file": file},
        )

    def create_link_message(self, link: str) -> ToolInvokeMessage:
        """
        create a link message

        :param link: the url of the link
        :return: the link message
        """
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.LINK, message=ToolInvokeMessage.TextMessage(text=link)
        )

    def create_text_message(self, text: str) -> ToolInvokeMessage:
        """
        create a text message

        :param text: the text
        :return: the text message
        """
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.TEXT,
            message=ToolInvokeMessage.TextMessage(text=text),
        )

    def create_blob_message(self, blob: bytes, meta: Optional[dict] = None) -> ToolInvokeMessage:
        """
        create a blob message

        :param blob: the blob
        :param meta: the meta info of blob object
        :return: the blob message
        """
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB,
            message=ToolInvokeMessage.BlobMessage(blob=blob),
            meta=meta,
        )

    def create_json_message(self, object: dict) -> ToolInvokeMessage:
        """
        create a json message
        """
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.JSON, message=ToolInvokeMessage.JsonMessage(json_object=object)
        )
