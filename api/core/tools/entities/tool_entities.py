from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional, List, Dict, Any, Union, cast

from core.tools.entities.common_entities import I18nObject

class ToolProviderType(Enum):
    """
        Enum class for tool provider
    """
    BUILT_IN = "built-in"
    APP_BASED = "app-based"
    API_BASED = "api-based"

    @classmethod
    def value_of(cls, value: str) -> 'ToolProviderType':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f'invalid mode value {value}')
    
class ApiProviderSchemaType(Enum):
    """
    Enum class for api provider schema type.
    """
    OPENAPI = "openapi"
    SWAGGER = "swagger"
    OPENAI_PLUGIN = "openai_plugin"
    OPENAI_ACTIONS = "openai_actions"

    @classmethod
    def value_of(cls, value: str) -> 'ApiProviderSchemaType':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f'invalid mode value {value}')
    
class ApiProviderAuthType(Enum):
    """
    Enum class for api provider auth type.
    """
    NONE = "none"
    API_KEY = "api_key"

    @classmethod
    def value_of(cls, value: str) -> 'ApiProviderAuthType':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f'invalid mode value {value}')

class ToolInvokeMessage(BaseModel):
    class MessageType(Enum):
        TEXT = "text"
        IMAGE = "image"
        LINK = "link"
        BLOB = "blob"
        IMAGE_LINK = "image_link"

    type: MessageType = MessageType.TEXT
    """
        plain text, image url or link url
    """
    message: Union[str, bytes] = None
    meta: Dict[str, Any] = None
    save_as_variable: bool = False

class ToolInvokeMessageBinary(BaseModel):
    mimetype: str = Field(..., description="The mimetype of the binary")
    url: str = Field(..., description="The url of the binary")
    save_as_variable: bool = False

class ToolParamterOption(BaseModel):
    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")

class ToolParamter(BaseModel):
    class ToolParameterType(Enum):
        STRING = "string"
        NUMBER = "number"
        BOOLEAN = "boolean"
        SELECT = "select"
        MODEL = "model"

    class ToolParameterForm(Enum):
        SCHEMA = "schema" # should be set while adding tool
        FORM = "form"     # should be set before invoking tool
        LLM = "llm"       # will be set by LLM

    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    human_description: I18nObject = Field(..., description="The description presented to the user")
    type: ToolParameterType = Field(..., description="The type of the parameter")
    form: ToolParameterForm = Field(..., description="The form of the parameter, schema/form/llm")
    llm_description: Optional[str] = None
    required: Optional[bool] = False
    default: Optional[str] = None
    min: Optional[Union[float, int]] = None
    max: Optional[Union[float, int]] = None
    options: Optional[List[ToolParamterOption]] = None

class ToolProviderIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    description: I18nObject = Field(..., description="The description of the tool")
    icon: str = Field(..., description="The icon of the tool")
    label: I18nObject = Field(..., description="The label of the tool")

class ToolDescription(BaseModel):
    human: I18nObject = Field(..., description="The description presented to the user")
    llm: str = Field(..., description="The description presented to the LLM")

class ToolIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")

class ToolCredentialsOption(BaseModel):
    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")

class ToolProviderCredentials(BaseModel):
    class CredentialsType(Enum):
        SECRET_INPUT = "secret-input"
        TEXT_INPUT = "text-input"
        SELECT = "select"

        @classmethod
        def value_of(cls, value: str) -> "ToolProviderCredentials.CredentialsType":
            """
            Get value of given mode.

            :param value: mode value
            :return: mode
            """
            for mode in cls:
                if mode.value == value:
                    return mode
            raise ValueError(f'invalid mode value {value}')
        
        @staticmethod
        def defaut(value: str) -> str:
            return ""

    name: str = Field(..., description="The name of the credentials")
    type: CredentialsType = Field(..., description="The type of the credentials")
    required: bool = False
    default: Optional[str] = None
    options: Optional[List[ToolCredentialsOption]] = None
    label: Optional[I18nObject] = None
    help: Optional[I18nObject] = None
    url: Optional[str] = None
    placeholder: Optional[I18nObject] = None

    def to_dict(self) -> dict:
        return {
            'name': self.name,
            'type': self.type.value,
            'required': self.required,
            'default': self.default,
            'options': self.options,
            'help': self.help.to_dict() if self.help else None,
            'label': self.label.to_dict(),
            'url': self.url,
            'placeholder': self.placeholder.to_dict() if self.placeholder else None,
        }

class ToolRuntimeVariableType(Enum):
    TEXT = "text"
    IMAGE = "image"

class ToolRuntimeVariable(BaseModel):
    type: ToolRuntimeVariableType = Field(..., description="The type of the variable")
    name: str = Field(..., description="The name of the variable")
    position: int = Field(..., description="The position of the variable")
    tool_name: str = Field(..., description="The name of the tool")

class ToolRuntimeTextVariable(ToolRuntimeVariable):
    value: str = Field(..., description="The value of the variable")

class ToolRuntimeImageVariable(ToolRuntimeVariable):
    value: str = Field(..., description="The path of the image")

class ToolRuntimeVariablePool(BaseModel):
    conversation_id: str = Field(..., description="The conversation id")
    user_id: str = Field(..., description="The user id")
    tenant_id: str = Field(..., description="The tenant id of assistant")

    pool: List[ToolRuntimeVariable] = Field(..., description="The pool of variables")

    def dict(self) -> dict:
        return {
            'conversation_id': self.conversation_id,
            'user_id': self.user_id,
            'tenant_id': self.tenant_id,
            'pool': [variable.dict() for variable in self.pool],
        }
    
    def set_text(self, tool_name: str, name: str, value: str) -> None:
        """
            set a text variable
        """
        for variable in self.pool:
            if variable.name == name:
                if variable.type == ToolRuntimeVariableType.TEXT:
                    variable = cast(ToolRuntimeTextVariable, variable)
                    variable.value = value
                    return
                
        variable = ToolRuntimeTextVariable(
            type=ToolRuntimeVariableType.TEXT,
            name=name,
            position=len(self.pool),
            tool_name=tool_name,
            value=value,
        )

        self.pool.append(variable)

    def set_file(self, tool_name: str, value: str, name: str = None) -> None:
        """
            set an image variable

            :param tool_name: the name of the tool
            :param value: the id of the file
        """
        # check how many image variables are there
        image_variable_count = 0
        for variable in self.pool:
            if variable.type == ToolRuntimeVariableType.IMAGE:
                image_variable_count += 1

        if name is None:
            name = f"file_{image_variable_count}"

        for variable in self.pool:
            if variable.name == name:
                if variable.type == ToolRuntimeVariableType.IMAGE:
                    variable = cast(ToolRuntimeImageVariable, variable)
                    variable.value = value
                    return
                
        variable = ToolRuntimeImageVariable(
            type=ToolRuntimeVariableType.IMAGE,
            name=name,
            position=len(self.pool),
            tool_name=tool_name,
            value=value,
        )

        self.pool.append(variable)