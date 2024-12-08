from typing import Optional

from pydantic import Field

from .apollo import ApolloConfigSourceInfo
from .base import RemoteConfigSource
from .enums import RemoteConfigSourceName


class RemoteConfigSourceInfo(ApolloConfigSourceInfo):
    REMOTE_CONFIG_SOURCE_NAME: Optional[RemoteConfigSourceName] = Field(
        description="name of remote config source",
        default=None,
    )


__all__ = ["RemoteConfigSourceInfo", "RemoteConfigSourceName", "RemoteConfigSource"]
