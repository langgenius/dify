from enum import Enum
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel

from core.tools.entities.tool_entities import ToolProviderEntityWithPlugin

T = TypeVar("T", bound=(BaseModel | dict | list | bool))


class PluginDaemonBasicResponse(BaseModel, Generic[T]):
    """
    Basic response from plugin daemon.
    """

    code: int
    message: str
    data: Optional[T]


class InstallPluginMessage(BaseModel):
    """
    Message for installing a plugin.
    """
    class Event(Enum):
        Info = "info"
        Done = "done"
        Error = "error"

    event: Event
    data: str


class PluginToolProviderEntity(BaseModel):
    provider: str
    plugin_unique_identifier: str
    plugin_id: str
    declaration: ToolProviderEntityWithPlugin


class PluginBasicBooleanResponse(BaseModel):
    """
    Basic boolean response from plugin daemon.
    """
    result: bool