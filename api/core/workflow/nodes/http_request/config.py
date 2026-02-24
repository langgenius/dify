from collections.abc import Mapping

from .entities import HTTP_REQUEST_CONFIG_FILTER_KEY, HttpRequestNodeConfig


def build_http_request_config() -> HttpRequestNodeConfig:
    return HttpRequestNodeConfig(
        max_connect_timeout=10,
        max_read_timeout=600,
        max_write_timeout=600,
        max_binary_size=10 * 1024 * 1024,
        max_text_size=1 * 1024 * 1024,
        ssl_verify=True,
        ssrf_default_max_retries=3,
    )


def resolve_http_request_config(filters: Mapping[str, object] | None) -> HttpRequestNodeConfig:
    if not filters:
        raise ValueError("http_request_config is required to build HTTP request default config")
    config = filters.get(HTTP_REQUEST_CONFIG_FILTER_KEY)
    if not isinstance(config, HttpRequestNodeConfig):
        raise ValueError("http_request_config must be an HttpRequestNodeConfig instance")
    return config
