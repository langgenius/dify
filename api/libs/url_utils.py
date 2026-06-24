from urllib.parse import urlparse

from flask import request


def normalize_api_base_url(base_url: str) -> str:
    """Normalize a base URL to always end with /v1, avoiding double /v1 suffixes."""
    return base_url.rstrip("/").removesuffix("/v1").rstrip("/") + "/v1"


def get_request_base_url() -> str:
    """Resolve the client-facing base URL from the current HTTP request."""
    origin = request.headers.get("Origin")
    if origin:
        return origin.rstrip("/")

    referer = request.headers.get("Referer")
    if referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"

    return request.url_root.rstrip("/")
