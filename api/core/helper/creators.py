"""
Helper module for Creators Platform integration.

Generates redirect URLs with claim codes and optional OAuth authorization codes.
"""

from urllib.parse import urlencode

from configs import dify_config


def get_redirect_url(claim_code: str, *, oauth_code: str | None = None) -> str:
    base_url = str(dify_config.CREATORS_PLATFORM_API_URL).rstrip("/")
    params: dict[str, str] = {"dsl_claim_code": claim_code}
    if oauth_code:
        params["oauth_code"] = oauth_code
    return f"{base_url}?{urlencode(params)}"
