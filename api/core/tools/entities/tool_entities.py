from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional, List, Dict, Any, Union

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

class AssistantAppMessage(BaseModel):
    class MessageType(Enum):
        TEXT = "text"
        IMAGE = "image"
        LINK = "link"

    type: MessageType = MessageType.TEXT
    """
        plain text, image url or link url
    """
    message: str = None

class ToolParamterOption(BaseModel):
    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")

class ToolParamter(BaseModel):
    class ToolParameterType(Enum):
        STRING = "string"
        NUMBER = "number"
        BOOLEAN = "boolean"
        SELECT = "select"

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
    icon: str = Field(..., description="The icon of the tool")

class ToolCredentialsOption(BaseModel):
    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")

class ToolProviderCredentials(BaseModel):
    class CredentialsType(Enum):
        SECRET_INPUT = "secret-input"
        TEXT_INPUT = "text-input"
        SELECT = "select"

        @classmethod
        def value_of(cls, value: str) -> 'CredentialsType':
            """
            Get value of given mode.

            :param value: mode value
            :return: mode
            """
            for mode in cls:
                if mode.value == value:
                    return mode
            raise ValueError(f'invalid mode value {value}')

    name: str = Field(..., description="The name of the credentials")
    type: CredentialsType = Field(..., description="The type of the credentials")
    required: bool = False
    default: Optional[str] = None
    options: Optional[List[ToolCredentialsOption]] = None
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
            'url': self.url,
            'placeholder': self.placeholder.to_dict() if self.placeholder else None,
        }