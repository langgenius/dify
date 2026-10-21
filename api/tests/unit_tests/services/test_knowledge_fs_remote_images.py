"""Unit tests for SSRF-safe KnowledgeFS remote-image loading."""

import socket
from unittest.mock import MagicMock, patch

import httpx
import pytest

from core.helper.ssrf_proxy import MaxRetriesExceededError, ResponseTooLargeError, UnsupportedResponseEncodingError
from core.tools.errors import ToolSSRFError
from services.knowledge_fs.remote_images import (
    KNOWLEDGE_FS_REMOTE_IMAGE_MAX_BYTES,
    KnowledgeFSRemoteImageError,
    load_remote_image,
)


def _response(status: int, body: bytes = b"", headers: dict[str, str] | None = None) -> httpx.Response:
    return httpx.Response(
        status,
        content=body,
        headers=headers,
        request=httpx.Request("GET", "https://cdn.example.test/image"),
    )


@patch("services.knowledge_fs.remote_images.remote_fetcher.make_request")
def test_load_remote_image_uses_ssrf_fetcher_and_sniffs_supported_content(
    make_request: MagicMock,
) -> None:
    body = b"\x89PNG\r\n\x1a\nimage"
    make_request.return_value = _response(200, body, {"content-type": "application/octet-stream"})

    result = load_remote_image("https://cdn.example.test/image")

    assert result.body == body
    assert result.mime_type == "image/png"
    assert result.sha256 == "3c7474b4239ada3342d87f25ec8849eb8473ee35c5471452482686098b49e81b"
    make_request.assert_called_once_with(
        "GET",
        "https://cdn.example.test/image",
        follow_redirects=True,
        headers={
            "Accept": "image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
            "Accept-Encoding": "identity",
        },
        max_retries=1,
        stream_response=True,
    )


@pytest.mark.parametrize(
    ("body", "mime_type"),
    [
        (b"\xff\xd8\xffimage", "image/jpeg"),
        (b"GIF89aimage", "image/gif"),
        (b"RIFF\x00\x00\x00\x00WEBPimage", "image/webp"),
    ],
)
@patch("services.knowledge_fs.remote_images.remote_fetcher.make_request")
def test_load_remote_image_sniffs_other_supported_formats(
    make_request: MagicMock,
    body: bytes,
    mime_type: str,
) -> None:
    make_request.return_value = _response(200, body, {"content-length": "invalid"})

    assert load_remote_image("https://cdn.example.test/image").mime_type == mime_type


@pytest.mark.parametrize(
    "url",
    [
        "",
        "https://user:secret@cdn.example.test/private.png",
        "file:///etc/passwd",
        "data:image/png;base64,AQ==",
        "relative.png",
        "https://cdn.example.test/" + "x" * 8_192,
    ],
)
def test_load_remote_image_rejects_non_http_urls(url: str) -> None:
    with pytest.raises(KnowledgeFSRemoteImageError) as exc_info:
        load_remote_image(url)

    assert exc_info.value.code == "REMOTE_IMAGE_URL_INVALID"
    assert exc_info.value.retryable is False


@pytest.mark.parametrize(
    ("status", "code", "retryable"),
    [
        (404, "REMOTE_IMAGE_NOT_FOUND", False),
        (400, "REMOTE_IMAGE_REQUEST_REJECTED", False),
        (429, "REMOTE_IMAGE_RATE_LIMITED", True),
        (503, "REMOTE_IMAGE_UPSTREAM_UNAVAILABLE", True),
    ],
)
@patch("services.knowledge_fs.remote_images.remote_fetcher.make_request")
def test_load_remote_image_classifies_upstream_statuses(
    make_request: MagicMock,
    status: int,
    code: str,
    retryable: bool,
) -> None:
    make_request.return_value = _response(status)

    with pytest.raises(KnowledgeFSRemoteImageError) as exc_info:
        load_remote_image("https://cdn.example.test/image.png")

    assert exc_info.value.code == code
    assert exc_info.value.retryable is retryable


@patch("services.knowledge_fs.remote_images.remote_fetcher.make_request")
def test_load_remote_image_rejects_oversized_and_unsupported_bodies(make_request: MagicMock) -> None:
    make_request.return_value = _response(
        200,
        b"x",
        {"content-length": str(KNOWLEDGE_FS_REMOTE_IMAGE_MAX_BYTES + 1)},
    )
    with pytest.raises(KnowledgeFSRemoteImageError) as too_large:
        load_remote_image("https://cdn.example.test/large.png")
    assert too_large.value.code == "REMOTE_IMAGE_TOO_LARGE"

    make_request.return_value = _response(200, b"not-an-image")
    with pytest.raises(KnowledgeFSRemoteImageError) as unsupported:
        load_remote_image("https://cdn.example.test/not-image")
    assert unsupported.value.code == "REMOTE_IMAGE_CONTENT_UNSUPPORTED"

    make_request.return_value = _response(200, b"", {"content-length": "-1"})
    with pytest.raises(KnowledgeFSRemoteImageError) as empty:
        load_remote_image("https://cdn.example.test/empty.png")
    assert empty.value.code == "REMOTE_IMAGE_EMPTY"


@patch("services.knowledge_fs.remote_images.ssrf_proxy.buffer_response")
@patch("services.knowledge_fs.remote_images.remote_fetcher.make_request")
def test_load_remote_image_maps_stream_limit_and_ssrf_rejections(
    make_request: MagicMock,
    buffer_response: MagicMock,
) -> None:
    make_request.return_value = _response(200, b"pending")
    buffer_response.side_effect = ResponseTooLargeError("large")
    with pytest.raises(KnowledgeFSRemoteImageError) as too_large:
        load_remote_image("https://cdn.example.test/large.png")
    assert too_large.value.code == "REMOTE_IMAGE_TOO_LARGE"

    make_request.side_effect = ToolSSRFError("blocked")
    with pytest.raises(KnowledgeFSRemoteImageError) as blocked:
        load_remote_image("http://127.0.0.1/private.png")
    assert blocked.value.code == "REMOTE_IMAGE_BLOCKED"
    assert blocked.value.retryable is False

    make_request.return_value = _response(200, b"pending")
    make_request.side_effect = None
    buffer_response.side_effect = UnsupportedResponseEncodingError("gzip")
    with pytest.raises(KnowledgeFSRemoteImageError) as unsupported_encoding:
        load_remote_image("https://cdn.example.test/compressed.png")
    assert unsupported_encoding.value.code == "REMOTE_IMAGE_CONTENT_UNSUPPORTED"


@patch("services.knowledge_fs.remote_images.remote_fetcher.make_request")
def test_load_remote_image_maps_transport_timeouts(make_request: MagicMock) -> None:
    make_request.side_effect = httpx.ReadTimeout("stalled")

    with pytest.raises(KnowledgeFSRemoteImageError) as unavailable:
        load_remote_image("https://cdn.example.test/stalled.png")

    assert unavailable.value.code == "REMOTE_IMAGE_UPSTREAM_UNAVAILABLE"
    assert unavailable.value.retryable is True


@pytest.mark.parametrize(
    "dns_error_code",
    [
        socket.EAI_NONAME,
        *([socket.EAI_NODATA] if hasattr(socket, "EAI_NODATA") and socket.EAI_NODATA != socket.EAI_NONAME else []),
        *([socket.EAI_FAIL] if socket.EAI_FAIL != socket.EAI_NONAME else []),
    ],
)
@patch("services.knowledge_fs.remote_images.remote_fetcher.make_request")
def test_load_remote_image_maps_permanent_dns_failures_to_not_found(
    make_request: MagicMock,
    dns_error_code: int,
) -> None:
    dns_error = socket.gaierror(dns_error_code, "host not found")
    connect_error = httpx.ConnectError(
        "host lookup failed",
        request=httpx.Request("GET", "https://missing.example.test/image.png"),
    )
    connect_error.__cause__ = dns_error
    retry_error = MaxRetriesExceededError("maximum retries reached")
    retry_error.__cause__ = connect_error
    make_request.side_effect = retry_error

    with pytest.raises(KnowledgeFSRemoteImageError) as unavailable:
        load_remote_image("https://missing.example.test/image.png")

    assert unavailable.value.code == "REMOTE_IMAGE_HOST_NOT_FOUND"
    assert unavailable.value.retryable is False


@patch("services.knowledge_fs.remote_images.remote_fetcher.make_request")
def test_load_remote_image_keeps_temporary_dns_failures_retryable(make_request: MagicMock) -> None:
    dns_error = socket.gaierror(socket.EAI_AGAIN, "temporary lookup failure")
    connect_error = httpx.ConnectError(
        "host lookup failed",
        request=httpx.Request("GET", "https://flaky.example.test/image.png"),
    )
    connect_error.__cause__ = dns_error
    retry_error = MaxRetriesExceededError("maximum retries reached")
    retry_error.__cause__ = connect_error
    make_request.side_effect = retry_error

    with pytest.raises(KnowledgeFSRemoteImageError) as unavailable:
        load_remote_image("https://flaky.example.test/image.png")

    assert unavailable.value.code == "REMOTE_IMAGE_UPSTREAM_UNAVAILABLE"
    assert unavailable.value.retryable is True


@patch("services.knowledge_fs.remote_images.remote_fetcher.make_request")
def test_load_remote_image_does_not_treat_proxy_dns_failures_as_missing_remote_hosts(
    make_request: MagicMock,
) -> None:
    dns_error = socket.gaierror(socket.EAI_NONAME, "proxy host not found")
    proxy_error = httpx.ProxyError(
        "proxy lookup failed",
        request=httpx.Request("GET", "https://cdn.example.test/image.png"),
    )
    proxy_error.__cause__ = dns_error
    retry_error = MaxRetriesExceededError("maximum retries reached")
    retry_error.__cause__ = proxy_error
    make_request.side_effect = retry_error

    with pytest.raises(KnowledgeFSRemoteImageError) as unavailable:
        load_remote_image("https://cdn.example.test/image.png")

    assert unavailable.value.code == "REMOTE_IMAGE_UPSTREAM_UNAVAILABLE"
    assert unavailable.value.retryable is True
