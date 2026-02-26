import pytest

from core.workflow.nodes.http_request import build_http_request_config
from core.workflow.nodes.http_request.config import resolve_http_request_config
from core.workflow.nodes.http_request.entities import HTTP_REQUEST_CONFIG_FILTER_KEY


def test_build_http_request_config_uses_literal_defaults():
    config = build_http_request_config()

    assert config.max_connect_timeout == 10
    assert config.max_read_timeout == 600
    assert config.max_write_timeout == 600
    assert config.max_binary_size == 10 * 1024 * 1024
    assert config.max_text_size == 1 * 1024 * 1024
    assert config.ssl_verify is True
    assert config.ssrf_default_max_retries == 3


def test_build_http_request_config_supports_explicit_overrides():
    config = build_http_request_config(
        max_connect_timeout=5,
        max_read_timeout=30,
        max_write_timeout=40,
        max_binary_size=2048,
        max_text_size=1024,
        ssl_verify=False,
        ssrf_default_max_retries=8,
    )

    assert config.max_connect_timeout == 5
    assert config.max_read_timeout == 30
    assert config.max_write_timeout == 40
    assert config.max_binary_size == 2048
    assert config.max_text_size == 1024
    assert config.ssl_verify is False
    assert config.ssrf_default_max_retries == 8


@pytest.mark.parametrize("filters", [None, {}])
def test_resolve_http_request_config_requires_filters(filters):
    with pytest.raises(ValueError, match="http_request_config is required"):
        resolve_http_request_config(filters)


def test_resolve_http_request_config_requires_http_request_node_config_instance():
    with pytest.raises(ValueError, match="must be an HttpRequestNodeConfig instance"):
        resolve_http_request_config({HTTP_REQUEST_CONFIG_FILTER_KEY: {"invalid": True}})


def test_resolve_http_request_config_returns_config_from_filters():
    config = build_http_request_config(max_connect_timeout=12)

    resolved = resolve_http_request_config({HTTP_REQUEST_CONFIG_FILTER_KEY: config})

    assert resolved is config
