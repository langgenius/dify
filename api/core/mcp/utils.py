from typing import Any
from urllib.parse import urljoin, urlparse

import httpx


def create_mcp_http_client(
    headers: dict[str, str] | None = None,
    timeout: httpx.Timeout | None = None,
) -> httpx.Client:
    kwargs: dict[str, Any] = {
        "follow_redirects": True,
    }

    # Handle timeout
    if timeout is None:
        kwargs["timeout"] = httpx.Timeout(30.0)
    else:
        kwargs["timeout"] = timeout

    # Handle headers
    if headers is not None:
        kwargs["headers"] = headers
    return httpx.Client(**kwargs)


def remove_request_params(url: str) -> str:
    return urljoin(url, urlparse(url).path)
