import asyncio
import logging

from collections.abc import Mapping
from typing import Any

from pydantic.fields import FieldInfo
from .http_request import http_request
logger = logging.getLogger(__name__)

from configs.remote_settings_sources.base import RemoteSettingsSource

from .utils import _parse_config

        #         .access_key(os.getenv('DIFY_ENV_NACOS_ACCESS_KEY'))
        #         .secret_key(os.getenv('DIFY_ENV_NACOS_SECRET_KEY'))
         #        .server_address(os.getenv('DIFY_ENV_NACOS_NACOS_SERVER_ADDR', 'localhost:8848'))

class NacosSettingsSource(RemoteSettingsSource):
    def __init__(self, configs: Mapping[str, Any]):
        self.configs = configs
        self.remote_configs=None
        loop = asyncio.get_event_loop()
        loop.run_until_complete(self.async_init())

    async def async_init(self):
        data_id = "com.alibaba.nacos.test.config"
        group = "DEFAULT_GROUP"
        server_ip="127.0.0.1:8848"
        url = "http://{}/nacos/v1/cs/configs?dataId={}&group={}&tenant={}".format(
            server_ip, data_id, group, "")

        try:
            content = http_request(url)
            self.remote_configs = self._parse_config(content)
        except Exception as e:
            raise RuntimeError(f"Failed to get config from Nacos: {e}")
    def _parse_config(self, content: str) -> dict:
        if not content:
            return {}
        try:
            return _parse_config(self, content)
        except Exception as e:
            raise RuntimeError(f"Failed to parse config: {e}")
    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:

        if not isinstance(self.remote_configs, dict):
            raise ValueError(f"remote configs is not dict, but {type(self.remote_configs)}")

        field_value = self.remote_configs.get(field_name)
        if field_value is None:
            return None, field_name, False

        return field_value, field_name, False