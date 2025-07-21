from collections.abc import Mapping
from typing import Any, Optional

from pydantic import Field
from pydantic.fields import FieldInfo
from pydantic_settings import BaseSettings

from configs.remote_settings_sources.base import RemoteSettingsSource

from .client import ApolloClient


class ApolloSettingsSourceInfo(BaseSettings):
    """
    Packaging build information
    """

    APOLLO_APP_ID: Optional[str] = Field(
        description="apollo app_id",
        default=None,
    )

    APOLLO_CLUSTER: Optional[str] = Field(
        description="apollo cluster",
        default=None,
    )

    APOLLO_CONFIG_URL: Optional[str] = Field(
        description="apollo config url",
        default=None,
    )

    APOLLO_NAMESPACE: Optional[str] = Field(
        description="apollo namespace",
        default=None,
    )

    APOLLO_NAMESPACES: Optional[str] = Field(
        description="apollo namespaces",
        default=None,
    )

    APOLLO_HOT_UPDATE: Optional[bool] = Field(
        description="apollo hot update",
        default=False,
    )

class ApolloSettingsSource(RemoteSettingsSource):
    def __init__(self, configs: Mapping[str, Any], change_listener=None):
        configs = {k:configs[k] for k in ApolloSettingsSourceInfo.model_fields if k in configs}
        config = ApolloSettingsSourceInfo.model_validate(configs)
        self.namespaces = (config.APOLLO_NAMESPACES or config.APOLLO_NAMESPACE or '').strip().split(",")
        self.client = ApolloClient(
            app_id=config.APOLLO_APP_ID,
            cluster=config.APOLLO_CLUSTER,
            config_url=config.APOLLO_CONFIG_URL,
            start_hot_update=config.APOLLO_HOT_UPDATE,
            _notification_map=dict.fromkeys(self.namespaces, -1),
            change_listener=change_listener,
        )
        self.remote_configs = {}
        for ns in self.namespaces:
            self.remote_configs.update(self.client.get_all_dicts(ns))

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        if not isinstance(self.remote_configs, dict):
            raise ValueError(f"remote configs is not dict, but {type(self.remote_configs)}")
        field_value = self.remote_configs.get(field_name)
        return field_value, field_name, False
