import json
from collections.abc import Generator
from typing import TypeVar

import requests
from pydantic import BaseModel
from yarl import URL

from configs import dify_config

plugin_daemon_inner_api_baseurl = dify_config.PLUGIN_API_URL
plugin_daemon_inner_api_key = dify_config.INNER_API_KEY_FOR_PLUGIN

T = TypeVar("T", bound=(BaseModel | dict))


class BasePluginManager:
    def _request(self, method: str, path: str, headers: dict, data: bytes, stream: bool = False) -> requests.Response:
        """
        Make a request to the plugin daemon inner API.
        """
        url = URL(str(plugin_daemon_inner_api_baseurl)) / path
        headers["X-Api-Key"] = plugin_daemon_inner_api_key
        response = requests.request(method=method, url=str(url), headers=headers, data=data, stream=stream)
        return response

    def _stream_request(self, method: str, path: str, headers: dict, data: bytes) -> Generator[bytes, None, None]:
        """
        Make a stream request to the plugin daemon inner API
        """
        response = self._request(method, path, headers, data, stream=True)
        yield from response.iter_lines()

    def _stream_request_with_model(
        self, method: str, path: str, headers: dict, data: bytes, type: type[T]
    ) -> Generator[T, None, None]:
        """
        Make a stream request to the plugin daemon inner API and yield the response as a model.
        """
        for line in self._stream_request(method, path, headers, data):
            yield type(**json.loads(line))

    def _request_with_model(self, method: str, path: str, headers: dict, data: bytes, type: type[T]) -> T:
        """
        Make a request to the plugin daemon inner API and return the response as a model.
        """
        response = self._request(method, path, headers, data)
        return type(**response.json())
