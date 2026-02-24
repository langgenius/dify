from collections.abc import Mapping

from configs import dify_config

from .entities import HTTP_REQUEST_CONFIG_FILTER_KEY, HttpRequestNodeConfig


def build_http_request_config() -> HttpRequestNodeConfig:
    return HttpRequestNodeConfig(
        max_connect_timeout=dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT,
        max_read_timeout=dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT,
        max_write_timeout=dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT,
        max_binary_size=dify_config.HTTP_REQUEST_NODE_MAX_BINARY_SIZE,
        max_text_size=dify_config.HTTP_REQUEST_NODE_MAX_TEXT_SIZE,
        ssl_verify=dify_config.HTTP_REQUEST_NODE_SSL_VERIFY,
        ssrf_default_max_retries=dify_config.SSRF_DEFAULT_MAX_RETRIES,
    )


def resolve_http_request_config(filters: Mapping[str, object] | None) -> HttpRequestNodeConfig:
    if not filters:
        raise ValueError("http_request_config is required to build HTTP request default config")
    config = filters.get(HTTP_REQUEST_CONFIG_FILTER_KEY)
    if not isinstance(config, HttpRequestNodeConfig):
        raise ValueError("http_request_config must be an HttpRequestNodeConfig instance")
    return config
