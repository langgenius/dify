"""HTTP client abstraction for OAuth requests"""

from abc import ABC, abstractmethod
from typing import Optional, Union

import requests


class OAuthHTTPClientProtocol(ABC):
    """Abstract interface for OAuth HTTP operations"""

    @abstractmethod
    def post(
        self, url: str, data: dict[str, Union[str, int]], headers: Optional[dict[str, str]] = None
    ) -> dict[str, Union[str, int, dict, list]]:
        """Make a POST request"""
        pass

    @abstractmethod
    def get(self, url: str, headers: Optional[dict[str, str]] = None) -> dict[str, Union[str, int, dict, list]]:
        """Make a GET request"""
        pass


class OAuthHTTPClient(OAuthHTTPClientProtocol):
    """Default implementation using requests library"""

    def post(
        self, url: str, data: dict[str, Union[str, int]], headers: Optional[dict[str, str]] = None
    ) -> dict[str, Union[str, int, dict, list]]:
        """Make a POST request"""
        response = requests.post(url, data=data, headers=headers or {})
        return {
            "status_code": response.status_code,
            "json": response.json() if response.headers.get("content-type", "").startswith("application/json") else {},
            "text": response.text,
            "headers": dict(response.headers),
        }

    def get(self, url: str, headers: Optional[dict[str, str]] = None) -> dict[str, Union[str, int, dict, list]]:
        """Make a GET request"""
        response = requests.get(url, headers=headers or {})
        response.raise_for_status()
        json_data = response.json()
        return dict(json_data)
