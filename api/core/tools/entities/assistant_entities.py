from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional, List, Dict, Any

from core.tools.entities.common_entities import I18nObject

class AssistantAppType(Enum):
    """
        Enum class for assistant app type.
    """
    BUILT_IN = "built-in"
    APP_BASED = "app-based"
    API_BASED = "api-based"

    @classmethod
    def value_of(cls, value: str) -> 'AssistantAppType':
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
    class AssistantAppMessageType(Enum):
        TEXT = "text"
        IMAGE = "image"
        LINK = "link"

    type: AssistantAppMessageType = AssistantAppMessageType.TEXT
    """
        plain text, image url or link url
    """
    message: str = None

class AssistantToolParamterOption(BaseModel):
    value: str = Field(..., description="The value of the option")
    label: I18nObject = Field(..., description="The label of the option")

class AssistantToolParamter(BaseModel):
    class AssistantToolParameterType(Enum):
        STRING = "string"
        NUMBER = "number"
        BOOLEAN = "boolean"
        SELECT = "select"

    class AssistantToolParameterForm(Enum):
        SCHEMA = "schema" # should be set while adding tool
        FORM = "form"     # should be set before invoking tool
        LLM = "llm"       # will be set by LLM

    name: str = Field(..., description="The name of the parameter")
    label: I18nObject = Field(..., description="The label presented to the user")
    human_description: I18nObject = Field(..., description="The description presented to the user")
    type: AssistantToolParameterType = Field(..., description="The type of the parameter")
    form: AssistantToolParameterForm = Field(..., description="The form of the parameter, schema/form/llm")
    llm_description: Optional[str] = None
    required: Optional[bool] = False
    default: Optional[str] = None
    options: Optional[List[AssistantToolParamterOption]] = None

class AssistantToolProviderIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    description: I18nObject = Field(..., description="The description of the tool")
    icon: str = Field(..., description="The icon of the tool")
    label: I18nObject = Field(..., description="The label of the tool")

class AssistantToolDescription(BaseModel):
    human: I18nObject = Field(..., description="The description presented to the user")
    llm: str = Field(..., description="The description presented to the LLM")

class AssistantToolIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    icon: str = Field(..., description="The icon of the tool")

class AssistantCredentials(BaseModel):
    class AssistantCredentialsType(BaseModel):
        SECRET_INPUT = "secret-input"
        TEXT_INPUT = "text-input"
        SELECT = "select"

    name: str = Field(..., description="The name of the credentials")
    type: AssistantCredentialsType = Field(..., description="The type of the credentials")
    required: Optional[bool] = False
    default: Optional[str] = None
    options: Optional[List[str]] = None
    help: Optional[I18nObject] = None
    placeholder: Optional[I18nObject] = None