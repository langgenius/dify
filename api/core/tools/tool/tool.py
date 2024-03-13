from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Optional, Union

from pydantic import BaseModel

from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolRuntimeImageVariable,
    ToolRuntimeVariable,
    ToolRuntimeVariablePool,
)
from core.tools.tool_file_manager import ToolFileManager


class Tool(BaseModel, ABC):
    identity: ToolIdentity = None
    parameters: Optional[list[ToolParameter]] = None
    description: ToolDescription = None
    is_team_authorization: bool = False
    agent_callback: Optional[DifyAgentCallbackHandler] = None
    use_callback: bool = False

    class Runtime(BaseModel):
        """
            Meta data of a tool call processing
        """
        def __init__(self, **data: Any):
            super().__init__(**data)
            if not self.runtime_parameters:
                self.runtime_parameters = {}

        tenant_id: str = None
        tool_id: str = None
        credentials: dict[str, Any] = None
        runtime_parameters: dict[str, Any] = None

    runtime: Runtime = None
    variables: ToolRuntimeVariablePool = None

    def __init__(self, **data: Any):
        super().__init__(**data)

        if not self.agent_callback:
            self.use_callback = False
        else:
            self.use_callback = True

    class VARIABLE_KEY(Enum):
        IMAGE = 'image'

    def fork_tool_runtime(self, meta: dict[str, Any], agent_callback: DifyAgentCallbackHandler = None) -> 'Tool':
        """
            fork a new tool with meta data

            :param meta: the meta data of a tool call processing, tenant_id is required
            :return: the new tool
        """
        return self.__class__(
            identity=self.identity.copy() if self.identity else None,
            parameters=self.parameters.copy() if self.parameters else None,
            description=self.description.copy() if self.description else None,
            runtime=Tool.Runtime(**meta),
            agent_callback=agent_callback
        )
    
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
        
        return self.get_variable(self.VARIABLE_KEY.IMAGE)
    
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
            if variable.name.startswith(self.VARIABLE_KEY.IMAGE.value):
                result.append(variable)

        return result

    def invoke(self, user_id: str, tool_parameters: Union[dict[str, Any], str]) -> list[ToolInvokeMessage]:
        # check if tool_parameters is a string
        if isinstance(tool_parameters, str):
            # check if this tool has only one parameter
            parameters = [parameter for parameter in self.parameters if parameter.form == ToolParameter.ToolParameterForm.LLM]
            if parameters and len(parameters) == 1:
                tool_parameters = {
                    parameters[0].name: tool_parameters
                }
            else:
                raise ValueError(f"tool_parameters should be a dict, but got a string: {tool_parameters}")

        # update tool_parameters
        if self.runtime.runtime_parameters:
            tool_parameters.update(self.runtime.runtime_parameters)

        # hit callback
        if self.use_callback:
            self.agent_callback.on_tool_start(
                tool_name=self.identity.name,
                tool_inputs=tool_parameters
            )

        try:
            result = self._invoke(
                user_id=user_id,
                tool_parameters=tool_parameters,
            )
        except Exception as e:
            if self.use_callback:
                self.agent_callback.on_tool_error(e)
            raise e

        if not isinstance(result, list):
            result = [result]

        # hit callback
        if self.use_callback:
            self.agent_callback.on_tool_end(
                tool_name=self.identity.name,
                tool_inputs=tool_parameters,
                tool_outputs=self._convert_tool_response_to_str(result)
            )
        
        return result
    
    def _convert_tool_response_to_str(self, tool_response: list[ToolInvokeMessage]) -> str:
        """
        Handle tool response
        """
        result = ''
        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.TEXT:
                result += response.message
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                result += f"result link: {response.message}. please tell user to check it."
            elif response.type == ToolInvokeMessage.MessageType.IMAGE_LINK or \
                 response.type == ToolInvokeMessage.MessageType.IMAGE:
                result += "image has been created and sent to user already, you should tell user to check it now."
            elif response.type == ToolInvokeMessage.MessageType.BLOB:
                if len(response.message) > 114:
                    result += str(response.message[:114]) + '...'
                else:
                    result += str(response.message)
            else:
                result += f"tool response: {response.message}."

        return result

    @abstractmethod
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
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
        return self.parameters
    
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
    
    def is_tool_available(self) -> bool:
        """
            check if the tool is available

            :return: if the tool is available
        """
        return True

    def create_image_message(self, image: str, save_as: str = '') -> ToolInvokeMessage:
        """
            create an image message

            :param image: the url of the image
            :return: the image message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.IMAGE, 
                                 message=image, 
                                 save_as=save_as)
    
    def create_link_message(self, link: str, save_as: str = '') -> ToolInvokeMessage:
        """
            create a link message

            :param link: the url of the link
            :return: the link message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.LINK, 
                                 message=link, 
                                 save_as=save_as)
    
    def create_text_message(self, text: str, save_as: str = '') -> ToolInvokeMessage:
        """
            create a text message

            :param text: the text
            :return: the text message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.TEXT, 
                                 message=text,
                                 save_as=save_as
                                 )
    
    def create_blob_message(self, blob: bytes, meta: dict = None, save_as: str = '') -> ToolInvokeMessage:
        """
            create a blob message

            :param blob: the blob
            :return: the blob message
        """
        return ToolInvokeMessage(type=ToolInvokeMessage.MessageType.BLOB, 
                                 message=blob, meta=meta,
                                 save_as=save_as
                                 )