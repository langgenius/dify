import logging
import time
from collections.abc import Mapping
from typing import Any

import requests
from requests.exceptions import HTTPError

logger = logging.getLogger(__name__)


class GetImgAIApp:
    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key
        self.base_url = base_url or "https://api.getimg.ai/v1"
        if not self.api_key:
            raise ValueError("API key is required")

    def _prepare_headers(self):
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}
        return headers

    def _request(
        self,
        method: str,
        url: str,
        data: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        retries: int = 3,
        backoff_factor: float = 0.3,
    ) -> Mapping[str, Any] | None:
        for i in range(retries):
            try:
                response = requests.request(method, url, json=data, headers=headers)
                response.raise_for_status()
                return response.json()
            except requests.exceptions.RequestException as e:
                if i < retries - 1 and isinstance(e, HTTPError) and e.response.status_code >= 500:
                    time.sleep(backoff_factor * (2**i))
                else:
                    raise
        return None

    def text2image(self, mode: str, **kwargs):
        data = kwargs["params"]
        if not data.get("prompt"):
            raise ValueError("Prompt is required")

        endpoint = f"{self.base_url}/{mode}/text-to-image"
        headers = self._prepare_headers()
        logger.debug(f"Send request to {endpoint=} body={data}")
        response = self._request("POST", endpoint, data, headers)
        if response is None:
            raise HTTPError("Failed to initiate getimg.ai after multiple retries")
        return response
