from typing import Any, cast

import httpx

from core.helper import ssrf_proxy
from models.api_based_extension import APIBasedExtensionPoint


class APIBasedExtensionRequestor:
    timeout: httpx.Timeout = httpx.Timeout(60.0, connect=5.0)
    """timeout for request connect and read"""

    def __init__(self, api_endpoint: str, api_key: str):
        self.api_endpoint = api_endpoint
        self.api_key = api_key

    def request(self, point: APIBasedExtensionPoint, params: dict[str, Any]) -> dict[str, Any]:
        """
        Request the api.

        :param point: the api point
        :param params: the request params
        :return: the response json
        """
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}

        try:
            response = ssrf_proxy.make_request(
                "POST",
                self.api_endpoint,
                max_retries=0,
                timeout=self.timeout,
                ssl_verify=True,
                json={"point": point.value, "params": params},
                headers=headers,
            )
        except httpx.TimeoutException as e:
            raise ValueError("request timeout") from e
        except httpx.RequestError as e:
            raise ValueError("request connection error") from e

        if response.status_code != 200:
            raise ValueError(f"request error, status_code: {response.status_code}, content: {response.text[:100]}")

        return cast(dict[str, Any], response.json())
