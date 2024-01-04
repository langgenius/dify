from pydantic import BaseModel, Field
from enum import Enum

from core.assistant.entities.common_entities import I18nObject

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

class AssistantToolParamter(BaseModel):
    pass

class AssistantToolProviderIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    description: I18nObject = Field(..., description="The description of the tool")
    icon: str = Field(..., description="The icon of the tool")
    label: I18nObject = Field(..., description="The label of the tool")

class AssistantToolIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    name: str = Field(..., description="The name of the tool")
    label: I18nObject = Field(..., description="The label of the tool")
    description: I18nObject = Field(..., description="The description of the tool")
    icon: str = Field(..., description="The icon of the tool")