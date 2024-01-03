from pydantic import BaseModel, Field
from abc import abstractmethod, ABC
from typing import List

class AssistantTool(BaseModel):
    pass

class AssistantToolIdentity(BaseModel):
    author: str = Field(..., description="The author of the tool")
    pass

class AssistantToolProvider(BaseModel, ABC):
    @abstractmethod
    def get_tools(self) -> List[AssistantTool]:
        """
            returns a list of tools that the provider can provide

            :return: list of tools
        """
        pass

    @abstractmethod
    @property
    def identity(self) -> AssistantToolIdentity:
        """
            returns the identity of the provider

            :return: identity of the provider
        """
        pass