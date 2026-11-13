"""
Helper module for Creators Platform integration.

Uploads application packages and generates redirect URLs with claim codes
and optional OAuth authorization codes.
"""

from typing import BinaryIO
from urllib.parse import urlencode

import httpx
from yarl import URL

from configs import dify_config
from core.helper import ssrf_proxy

_CREATORS_REQUEST_TIMEOUT = httpx.Timeout(30.0, connect=5.0)


def upload_package(source: BinaryIO, *, filename: str) -> str:
    url = str(URL(str(dify_config.CREATORS_PLATFORM_API_URL)) / "api/v1/templates/anonymous-upload")
    response = ssrf_proxy.post(
        url,
        files={"file": (filename, source, "application/octet-stream")},
        timeout=_CREATORS_REQUEST_TIMEOUT,
        max_retries=0,
    )
    response.raise_for_status()
    data = response.json().get("data")
    claim_code = data.get("claim_code") if isinstance(data, dict) else None
    if not isinstance(claim_code, str) or not claim_code:
        raise ValueError("Creators Platform did not return a valid claim_code")
    return claim_code


def get_redirect_url(claim_code: str, *, oauth_code: str | None = None) -> str:
    base_url = str(dify_config.CREATORS_PLATFORM_API_URL).rstrip("/")
    params: dict[str, str] = {"dsl_claim_code": claim_code}
    if oauth_code:
        params["oauth_code"] = oauth_code
    return f"{base_url}?{urlencode(params)}"
