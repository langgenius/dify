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


class ApolloSettingsSource(RemoteSettingsSource):
    def __init__(self, configs: Mapping[str, Any]):
        self.client = ApolloClient(
            app_id=configs["APOLLO_APP_ID"],
            cluster=configs["APOLLO_CLUSTER"],
            config_url=configs["APOLLO_CONFIG_URL"],
            start_hot_update=False,
            _notification_map={configs["APOLLO_NAMESPACE"]: -1},
        )
        self.namespace = configs["APOLLO_NAMESPACE"]
        self.remote_configs = self.client.get_all_dicts(self.namespace)

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        if not isinstance(self.remote_configs, dict):
            raise ValueError(f"remote configs is not dict, but {type(self.remote_configs)}")
        field_value = self.remote_configs.get(field_name)
        return field_value, field_name, False
