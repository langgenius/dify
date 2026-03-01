from core.workflow.nodes.http_request import build_http_request_config


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
