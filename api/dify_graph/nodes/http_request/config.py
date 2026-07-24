from collections.abc import Mapping

from .entities import HTTP_REQUEST_CONFIG_FILTER_KEY, HttpRequestNodeConfig


def build_http_request_config(
    *,
    max_connect_timeout: int = 10,
    max_read_timeout: int = 600,
    max_write_timeout: int = 600,
    max_binary_size: int = 10 * 1024 * 1024,
    max_text_size: int = 1 * 1024 * 1024,
    ssl_verify: bool = True,
    ssrf_default_max_retries: int = 3,
) -> HttpRequestNodeConfig:
    return HttpRequestNodeConfig(
        max_connect_timeout=max_connect_timeout,
        max_read_timeout=max_read_timeout,
        max_write_timeout=max_write_timeout,
        max_binary_size=max_binary_size,
        max_text_size=max_text_size,
        ssl_verify=ssl_verify,
        ssrf_default_max_retries=ssrf_default_max_retries,
    )


def resolve_http_request_config(filters: Mapping[str, object] | None) -> HttpRequestNodeConfig:
    if not filters:
        raise ValueError("http_request_config is required to build HTTP request default config")
    config = filters.get(HTTP_REQUEST_CONFIG_FILTER_KEY)
    if not isinstance(config, HttpRequestNodeConfig):
        raise ValueError("http_request_config must be an HttpRequestNodeConfig instance")
    return config
