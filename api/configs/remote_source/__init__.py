from typing import Optional

from pydantic import Field

from .apollo import ApolloConfig
from .enums import RemoteSource


class RemoteConfigSource(ApolloConfig):
    REMOTE_CONFIG_SOURCE_NAME: Optional[RemoteSource] = Field(
        description="name of remote config source",
        default=None,
    )


__all__ = ["RemoteConfigSource", "RemoteSource"]
