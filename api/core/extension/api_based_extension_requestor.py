from typing import cast

import httpx

from configs import dify_config
from models.api_based_extension import APIBasedExtensionPoint


class APIBasedExtensionRequestor:
    timeout: httpx.Timeout = httpx.Timeout(60.0, connect=5.0)
    """timeout for request connect and read"""

    def __init__(self, api_endpoint: str, api_key: str):
        self.api_endpoint = api_endpoint
        self.api_key = api_key

    def request(self, point: APIBasedExtensionPoint, params: dict):
        """
        Request the api.

        :param point: the api point
        :param params: the request params
        :return: the response json
        """
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"}

        url = self.api_endpoint

        try:
            mounts: dict[str, httpx.BaseTransport] | None = None
            if dify_config.SSRF_PROXY_HTTP_URL and dify_config.SSRF_PROXY_HTTPS_URL:
                mounts = {
                    "http://": httpx.HTTPTransport(proxy=dify_config.SSRF_PROXY_HTTP_URL),
                    "https://": httpx.HTTPTransport(proxy=dify_config.SSRF_PROXY_HTTPS_URL),
                }

            with httpx.Client(mounts=mounts, timeout=self.timeout) as client:
                response = client.request(
                    method="POST",
                    url=url,
                    json={"point": point.value, "params": params},
                    headers=headers,
                )
        except httpx.TimeoutException:
            raise ValueError("request timeout")
        except httpx.RequestError:
            raise ValueError("request connection error")

        if response.status_code != 200:
            raise ValueError(f"request error, status_code: {response.status_code}, content: {response.text[:100]}")

        return cast(dict, response.json())
