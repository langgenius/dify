from abc import ABC, abstractmethod
from collections.abc import Mapping
from copy import deepcopy
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional, Union

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic_core.core_schema import ValidationInfo

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolIdentity,
    ToolInvokeFrom,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
    ToolRuntimeImageVariable,
    ToolRuntimeVariable,
    ToolRuntimeVariablePool,
)
from core.tools.tool_file_manager import ToolFileManager
from core.tools.utils.tool_parameter_converter import ToolParameterConverter

if TYPE_CHECKING:
    from core.file.file_obj import FileVar


class Tool(BaseModel, ABC):
    identity: Optional[ToolIdentity] = None
    parameters: Optional[list[ToolParameter]] = None
    description: Optional[ToolDescription] = None
    is_team_authorization: bool = False

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @field_validator("parameters", mode="before")
    @classmethod
    def set_parameters(cls, v, validation_info: ValidationInfo) -> list[ToolParameter]:
        return v or []

    class Runtime(BaseModel):
        """
        Meta data of a tool call processing
        """

        def __init__(self, **data: Any):
            super().__init__(**data)
            if not self.runtime_parameters:
                self.runtime_parameters = {}

        tenant_id: Optional[str] = None
        tool_id: Optional[str] = None
        invoke_from: Optional[InvokeFrom] = None
        tool_invoke_from: Optional[ToolInvokeFrom] = None
        credentials: Optional[dict[str, Any]] = None
        runtime_parameters: Optional[dict[str, Any]] = None

    runtime: Optional[Runtime] = None
    variables: Optional[ToolRuntimeVariablePool] = None

    def __init__(self, **data: Any):
        super().__init__(**data)

    class VariableKey(Enum):
        IMAGE = "image"

    def fork_tool_runtime(self, runtime: dict[str, Any]) -> "Tool":
        """
        fork a new tool with meta data

        :param meta: the meta data of a tool call processing, tenant_id is required
        :return: the new tool
        """
        return self.__class__(
            identity=self.identity.model_copy() if self.identity else None,
            parameters=self.parameters.copy() if self.parameters else None,
            description=self.description.model_copy() if self.description else None,
            runtime=Tool.Runtime(**runtime),
        )

    @abstractmethod
    def tool_provider_type(self) -> ToolProviderType:
        """
        get the tool provider type

        :return: the tool provider type
        """

    def load_variables(self, variables: ToolRuntimeVariablePool):
        """
        load variables from database

        :param conversation_id: the conversation id
        """
        self.variables = variables

    def set_image_variable(self, variable_name: str, image_key: str) -> None:
        """
        set an image variable
        """
        if not self.variables:
            return

        self.variables.set_file(self.identity.name, variable_name, image_key)

    def set_text_variable(self, variable_name: str, text: str) -> None:
        """
        set a text variable
        """
        if not self.variables:
            return

        self.variables.set_text(self.identity.name, variable_name, text)

    def get_variable(self, name: Union[str, Enum]) -> Optional[ToolRuntimeVariable]:
        """
        get a variable

        :param name: the name of the variable
        :return: the variable
        """
        if not self.variables:
            return None

        if isinstance(name, Enum):
            name = name.value

        for variable in self.variables.pool:
            if variable.name == name:
                return variable

        return None

    def get_default_image_variable(self) -> Optional[ToolRuntimeVariable]:
        """
        get the default image variable

        :return: the image variable
        """
        if not self.variables:
            return None

        return self.get_variable(self.VariableKey.IMAGE)

    def get_variable_file(self, name: Union[str, Enum]) -> Optional[bytes]:
        """
        get a variable file

        :param name: the name of the variable
        :return: the variable file
        """
        variable = self.get_variable(name)
        if not variable:
            return None

        if not isinstance(variable, ToolRuntimeImageVariable):
            return None

        message_file_id = variable.value
        # get file binary
        file_binary = ToolFileManager.get_file_binary_by_message_file_id(message_file_id)
        if not file_binary:
            return None

        return file_binary[0]

    def list_variables(self) -> list[ToolRuntimeVariable]:
        """
        list all variables

        :return: the variables
        """
        if not self.variables:
            return []

        return self.variables.pool

    def list_default_image_variables(self) -> list[ToolRuntimeVariable]:
        """
        list all image variables

        :return: the image variables
        """
        if not self.variables:
            return []

        result = []

        for variable in self.variables.pool:
            if variable.name.startswith(self.VariableKey.IMAGE.value):
                result.append(variable)

        return result

    def invoke(self, user_id: str, tool_parameters: Mapping[str, Any]) -> list[ToolInvokeMessage]:
        # update tool_parameters
        # TODO: Fix type error.
        if self.runtime.runtime_parameters:
            tool_parameters.update(self.runtime.runtime_parameters)

        # try parse tool parameters into the correct type
        tool_parameters = self._transform_tool_parameters_type(tool_parameters)

        result = self._invoke(
            user_id=user_id,
            tool_parameters=tool_parameters,
        )

        if not isinstance(result, list):
            result = [result]

        return result

    def _transform_tool_parameters_type(self, tool_parameters: Mapping[str, Any]) -> dict[str, Any]:
        """
        Transform tool parameters type
        """
        # Temp fix for the issue that the tool parameters will be converted to empty while validating the credentials
        result = deepcopy(tool_parameters)
        for parameter in self.parameters or []:
            if parameter.name in tool_parameters:
                result[parameter.name] = ToolParameterConverter.cast_parameter_by_type(
                    tool_parameters[parameter.name], parameter.type
                )

        return result

    @abstractmethod
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        pass

    def validate_credentials(self, credentials: dict[str, Any], parameters: dict[str, Any]) -> None:
        """
        validate the credentials

        :param credentials: the credentials
        :param parameters: the parameters
        """
        pass

    def get_runtime_parameters(self) -> list[ToolParameter]:
        """
        get the runtime parameters

        interface for developer to dynamic change the parameters of a tool depends on the variables pool

        :return: the runtime parameters
        """
        return self.parameters or []

    def get_all_runtime_parameters(self) -> list[ToolParameter]:
        """
        get all runtime parameters

        :return: all runtime parameters
        """
        parameters = self.parameters or []
        parameters = parameters.copy()
        user_parameters = self.get_runtime_parameters() or []
        user_parameters = user_parameters.copy()

        # override parameters
        for parameter in user_parameters:
            # check if parameter in tool parameters
            found = False
            for tool_parameter in parameters:
                if tool_parameter.name == parameter.name:
                    found = True
                    break

            if found:
                # override parameter
                tool_parameter.type = parameter.type
                tool_parameter.form = parameter.form
                tool_parameter.required = parameter.required
                tool_parameter.default = parameter.default
                tool_parameter.options = parameter.options
                tool_parameter.llm_description = parameter.llm_description
            else:
                # add new parameter
                parameters.append(parameter)

        return parameters

    def create_image_message(self, image: str, save_as: str = "") -> ToolInvokeMessage:
        """
        create an image message

        :param image: the url of the image
        :return: the image message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.IMAGE, message=image, save_as=save_as)

    def create_file_var_message(self, file_var: "FileVar") -> ToolInvokeMessage:
        return ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.FILE_VAR, message="", meta={"file_var": file_var}, save_as=""
        )

    def create_link_message(self, link: str, save_as: str = "") -> ToolInvokeMessage:
        """
        create a link message

        :param link: the url of the link
        :return: the link message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.LINK, message=link, save_as=save_as)

    def create_text_message(self, text: str, save_as: str = "") -> ToolInvokeMessage:
        """
        create a text message

        :param text: the text
        :return: the text message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.TEXT, message=text, save_as=save_as)

    def create_blob_message(self, blob: bytes, meta: dict = None, save_as: str = "") -> ToolInvokeMessage:
        """
        create a blob message

        :param blob: the blob
        :return: the blob message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.BLOB, message=blob, meta=meta, save_as=save_as)

    def create_json_message(self, object: dict) -> ToolInvokeMessage:
        """
        create a json message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.JSON, message=object)
