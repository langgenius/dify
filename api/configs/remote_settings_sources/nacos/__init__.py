import logging
import os
from collections.abc import Mapping
from typing import Any

from pydantic.fields import FieldInfo

from .http_request import NacosHttpClient

logger = logging.getLogger(__name__)

from configs.remote_settings_sources.base import RemoteSettingsSource

from .utils import parse_config


class NacosSettingsSource(RemoteSettingsSource):
    def __init__(self, configs: Mapping[str, Any]):
        self.configs = configs
        self.remote_configs: dict[str, str] = {}
        self.async_init()

    def async_init(self) -> None:
        data_id = os.getenv("DIFY_ENV_NACOS_DATA_ID", "dify-api-env.properties")
        group = os.getenv("DIFY_ENV_NACOS_GROUP", "nacos-dify")
        tenant = os.getenv("DIFY_ENV_NACOS_NAMESPACE", "")

        params = {"dataId": data_id, "group": group, "tenant": tenant}
        try:
            content = NacosHttpClient().http_request("/nacos/v1/cs/configs", method="GET", headers={}, params=params)
            self.remote_configs = self._parse_config(content)
        except Exception:
            logger.exception("[get-access-token] exception occurred")
            raise

    def _parse_config(self, content: str) -> dict[str, str]:
        if not content:
            return {}
        try:
            return parse_config(content)
        except Exception as e:
            raise RuntimeError(f"Failed to parse config: {e}")

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        field_value = self.remote_configs.get(field_name)
        if field_value is None:
            return None, field_name, False

        return field_value, field_name, False
