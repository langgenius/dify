from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Generator
from copy import deepcopy
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover
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

    def __init__(self, entity: ToolEntity, runtime: ToolRuntime):
        self.entity = entity
        self.runtime = runtime

    def fork_tool_runtime(self, runtime: ToolRuntime) -> Tool:
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
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
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
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> ToolInvokeMessage | list[ToolInvokeMessage] | Generator[ToolInvokeMessage, None, None]:
        pass

    def get_runtime_parameters(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> list[ToolParameter]:
        """
        get the runtime parameters

        interface for developer to dynamic change the parameters of a tool depends on the variables pool

        :return: the runtime parameters
        """
        return self.entity.parameters

    def get_merged_runtime_parameters(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> list[ToolParameter]:
        """
        Get the effective parameter declarations for this tool.

        Runtime parameters override declared parameters by name and append new
        parameters, but the returned list is always detached from the tool's
        cached declarations so callers can safely mutate it while building
        downstream schemas.

        :return: merged runtime parameters
        """
        parameters = [deepcopy(parameter) for parameter in self.entity.parameters or []]
        user_parameters = [
            deepcopy(parameter)
            for parameter in self.get_runtime_parameters(
                conversation_id=conversation_id,
                app_id=app_id,
                message_id=message_id,
            )
            or []
        ]

        parameter_indexes = {parameter.name: index for index, parameter in enumerate(parameters)}

        for parameter in user_parameters:
            existing_index = parameter_indexes.get(parameter.name)
            if existing_index is None:
                parameter_indexes[parameter.name] = len(parameters)
                parameters.append(parameter)
                continue
            parameters[existing_index] = parameter

        return parameters

    def get_llm_parameters_json_schema(
        self,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> dict[str, Any]:
        """Build the model-visible JSON schema from effective tool parameters.

        Hidden/manual parameters stay available for invocation preparation on the
        API side, but are intentionally omitted from the LLM-facing schema.
        """
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {},
            "required": [],
        }

        for parameter in self.get_merged_runtime_parameters(
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        ):
            if parameter.form != ToolParameter.ToolParameterForm.LLM:
                continue

            if parameter.type in {
                ToolParameter.ToolParameterType.SYSTEM_FILES,
                ToolParameter.ToolParameterType.FILE,
                ToolParameter.ToolParameterType.FILES,
            }:
                continue

            parameter_schema: dict[str, Any] = (
                {
                    "type": parameter.type.as_normal_type(),
                    "description": parameter.llm_description or "",
                }
                if parameter.input_schema is None
                else deepcopy(parameter.input_schema)
            )
            parameter_schema.setdefault("description", parameter.llm_description or "")

            if parameter.type == ToolParameter.ToolParameterType.SELECT and parameter.options:
                parameter_schema["enum"] = [option.value for option in parameter.options]

            schema["properties"][parameter.name] = parameter_schema
            if parameter.required:
                schema["required"].append(parameter.name)

        return schema

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

    def create_file_message(self, file: File) -> ToolInvokeMessage:
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.FILE,
            message=ToolInvokeMessage.FileMessage(file_marker="file_marker"),
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

    def create_blob_message(self, blob: bytes, meta: dict[str, Any] | None = None) -> ToolInvokeMessage:
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

    def create_json_message(self, object: dict[str, Any], suppress_output: bool = False) -> ToolInvokeMessage:
        """
        create a json message
        """
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.JSON,
            message=ToolInvokeMessage.JsonMessage(json_object=object, suppress_output=suppress_output),
        )

    def create_variable_message(
        self, variable_name: str, variable_value: Any, stream: bool = False
    ) -> ToolInvokeMessage:
        """
        create a variable message
        """
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.VARIABLE,
            message=ToolInvokeMessage.VariableMessage(
                variable_name=variable_name, variable_value=variable_value, stream=stream
            ),
        )
