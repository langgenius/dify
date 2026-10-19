"""Shared HTTP client for plugin daemon requests."""

import httpx

from core.helper.http_client_pooling import get_pooled_http_client


def get_client() -> httpx.Client:
    return get_pooled_http_client(
        "plugin_daemon",
        lambda: httpx.Client(limits=httpx.Limits(max_keepalive_connections=50, max_connections=100), trust_env=False),
    )
