from __future__ import annotations

import base64
import json

import httpx
import pytest

from dify_agent.agent_stub.client._back_proxy import (
    BackProxyClientError,
    BackProxyHTTPError,
    BackProxyTransferError,
    BackProxyValidationError,
    connect_back_proxy_sync,
    download_file_bytes_from_signed_url_sync,
    request_back_proxy_file_download_sync,
    request_back_proxy_file_upload_sync,
    upload_file_to_signed_url_sync,
)
from dify_agent.agent_stub.protocol.back_proxy import BackProxyFileMapping


def _reference(record_id: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"record_id": record_id}, separators=(",", ":")).encode()).decode()
    return f"dify-file-ref:{payload}"


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


def test_request_back_proxy_file_upload_sync_posts_upload_request() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://agent.example.com/back-proxy/files/upload-request"
        assert json.loads(request.content) == {"filename": "report.pdf", "mimetype": "application/pdf"}
        return httpx.Response(200, json={"upload_url": "https://files.example.com/upload"})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        response = request_back_proxy_file_upload_sync(
            base_url="https://agent.example.com/back-proxy",
            auth_jwe="test-jwe",
            filename="report.pdf",
            mimetype="application/pdf",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert response.upload_url == "https://files.example.com/upload"


def test_request_back_proxy_file_download_sync_posts_download_request() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://agent.example.com/back-proxy/files/download-request"
        assert json.loads(request.content) == {
            "file": {"transfer_method": "tool_file", "reference": _reference("tool-file-1")}
        }
        return httpx.Response(
            200,
            json={
                "filename": "report.pdf",
                "mime_type": "application/pdf",
                "size": 123,
                "download_url": "https://files.example.com/download",
            },
        )

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        response = request_back_proxy_file_download_sync(
            base_url="https://agent.example.com/back-proxy",
            auth_jwe="test-jwe",
            file=BackProxyFileMapping(transfer_method="tool_file", reference=_reference("tool-file-1")),
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert response.download_url == "https://files.example.com/download"


def test_upload_file_to_signed_url_sync_posts_multipart_file() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://files.example.com/upload"
        assert b"report.pdf" in request.content
        return httpx.Response(201, json={"id": "tool-file-1", "name": "report.pdf", "size": 9})

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        from io import BytesIO

        payload = upload_file_to_signed_url_sync(
            upload_url="https://files.example.com/upload",
            filename="report.pdf",
            file_obj=BytesIO(b"contents!"),
            mimetype="application/pdf",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert payload["id"] == "tool-file-1"


def test_download_file_bytes_from_signed_url_sync_returns_bytes() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"payload")

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        payload = download_file_bytes_from_signed_url_sync(
            download_url="https://files.example.com/download",
            sync_http_client=http_client,
        )
    finally:
        http_client.close()

    assert payload == b"payload"


def test_download_file_bytes_from_signed_url_sync_maps_timeout_to_transfer_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("boom")

    http_client = httpx.Client(transport=httpx.MockTransport(handler))
    try:
        with pytest.raises(BackProxyTransferError, match="download timed out"):
            _ = download_file_bytes_from_signed_url_sync(
                download_url="https://files.example.com/download",
                sync_http_client=http_client,
            )
    finally:
        http_client.close()
