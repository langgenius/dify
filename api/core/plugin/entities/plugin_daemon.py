from typing import Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=(BaseModel | dict))


class PluginDaemonBasicResponse(BaseModel, Generic[T]):
    """
    Basic response from plugin daemon.
    """

    code: int
    message: str
    data: Optional[T]
