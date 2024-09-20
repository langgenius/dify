from enum import Enum
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=(BaseModel | dict | bool))


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