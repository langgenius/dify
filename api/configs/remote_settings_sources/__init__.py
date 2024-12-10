from typing import Optional

from pydantic import Field

from .apollo import ApolloSettingsSourceInfo
from .base import RemoteSettingsSource
from .enums import RemoteSettingsSourceName


class RemoteSettingsSourceConfig(ApolloSettingsSourceInfo):
    REMOTE_SETTINGS_SOURCE_NAME: Optional[RemoteSettingsSourceName] = Field(
        description="name of remote config source",
        default=None,
    )


__all__ = ["RemoteSettingsSource", "RemoteSettingsSourceConfig", "RemoteSettingsSourceName"]
