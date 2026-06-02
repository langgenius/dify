from __future__ import annotations

import json

import httpx
import pytest

from dify_agent.client._back_proxy import (
    BackProxyClientError,
    BackProxyHTTPError,
    BackProxyValidationError,
    connect_back_proxy_sync,
)


def test_connect_back_proxy_sync_posts_connections_request_with_authorization() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://agent.example.com/back-proxy/connections"
        assert request.headers["Authorization"] == "Bearer test-jwe"
        assert json.loads(request.content) == {
            "protocol_version": 1,
            "argv": ["connect", "--", "echo", "hello"],
            "metadata": {},
        }
        return httpx.Response(200, json={"connection_id": "conn-1", "status": "connected"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        response = connect_back_proxy_sync(
            base_url="https://agent.example.com/back-proxy/",
            auth_jwe="test-jwe",
            argv=["connect", "--", "echo", "hello"],
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert response.connection_id == "conn-1"
    assert response.status == "connected"


def test_connect_back_proxy_sync_rejects_invalid_base_url() -> None:
    with pytest.raises(BackProxyValidationError, match="invalid back proxy base URL"):
        _ = connect_back_proxy_sync(
            base_url="https://agent.example.com/back-proxy?x=1",
            auth_jwe="test-jwe",
            argv=["connect"],
        )


def test_connect_back_proxy_sync_maps_non_2xx_response_to_http_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"detail": "invalid token"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(BackProxyHTTPError, match="401") as exc_info:
            _ = connect_back_proxy_sync(
                base_url="https://agent.example.com/back-proxy",
                auth_jwe="test-jwe",
                argv=["connect"],
                sync_http_client=http_client,
            )
    finally:
        http_client.close()

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "invalid token"


def test_connect_back_proxy_sync_maps_malformed_json_response_to_client_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="not-json", headers={"Content-Type": "application/json"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(BackProxyClientError, match="invalid JSON"):
            _ = connect_back_proxy_sync(
                base_url="https://agent.example.com/back-proxy",
                auth_jwe="test-jwe",
                argv=["connect"],
                sync_http_client=http_client,
            )
    finally:
        http_client.close()


def test_connect_back_proxy_sync_maps_schema_invalid_success_payload_to_validation_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"connection_id": 123, "status": "unexpected"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(BackProxyValidationError, match="invalid back proxy connection response"):
            _ = connect_back_proxy_sync(
                base_url="https://agent.example.com/back-proxy",
                auth_jwe="test-jwe",
                argv=["connect"],
                sync_http_client=http_client,
            )
    finally:
        http_client.close()
