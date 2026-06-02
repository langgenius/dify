from __future__ import annotations

import pytest

from dify_agent.protocol.back_proxy import back_proxy_connections_url, normalize_back_proxy_base_url


def test_back_proxy_connections_url_handles_trailing_slash_and_no_trailing_slash() -> None:
    assert back_proxy_connections_url("https://agent.example.com/back-proxy") == (
        "https://agent.example.com/back-proxy/connections"
    )
    assert back_proxy_connections_url("https://agent.example.com/back-proxy/") == (
        "https://agent.example.com/back-proxy/connections"
    )


def test_normalize_back_proxy_base_url_rejects_query_and_fragment() -> None:
    with pytest.raises(ValueError, match="query string or fragment"):
        _ = normalize_back_proxy_base_url("https://agent.example.com/back-proxy?x=1")

    with pytest.raises(ValueError, match="query string or fragment"):
        _ = normalize_back_proxy_base_url("https://agent.example.com/back-proxy#fragment")


def test_normalize_back_proxy_base_url_rejects_non_http_urls_and_missing_host() -> None:
    with pytest.raises(ValueError, match="http or https"):
        _ = normalize_back_proxy_base_url("not-a-url")

    with pytest.raises(ValueError, match="http or https"):
        _ = normalize_back_proxy_base_url("ftp://agent.example.com/back-proxy")

    with pytest.raises(ValueError, match="include a host"):
        _ = normalize_back_proxy_base_url("https:///back-proxy")
