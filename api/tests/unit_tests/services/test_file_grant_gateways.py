from collections.abc import Callable
from unittest.mock import patch

import httpx
import pytest

from services.errors.file import FileTooLargeError
from services.file_grant_gateways import FileGrantRemoteFileGateway


def test_remote_file_gateway_bounds_a_get_without_content_length(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(UPLOAD_FILE_SIZE_LIMIT=1)
    url = "https://example.com/report.pdf"
    head = httpx.Response(200, request=httpx.Request("HEAD", url))
    download = httpx.Response(
        200,
        content=b"0" * (1024 * 1024 + 1),
        request=httpx.Request("GET", url),
    )

    with patch("services.file_grant_gateways.remote_fetcher.make_request", side_effect=[head, download]) as request:
        with pytest.raises(FileTooLargeError):
            FileGrantRemoteFileGateway().fetch(url)

    assert request.call_args_list[1].kwargs["stream_response"] is True
    assert download.is_closed


def test_remote_file_gateway_uses_the_actual_body_size_when_content_length_is_incorrect(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(UPLOAD_FILE_SIZE_LIMIT=1)
    url = "https://example.com/report.pdf"
    head = httpx.Response(
        200,
        headers={"Content-Length": "1"},
        request=httpx.Request("HEAD", url),
    )
    download = httpx.Response(
        200,
        headers={"Content-Length": "1"},
        content=b"0" * (1024 * 1024 + 1),
        request=httpx.Request("GET", url),
    )

    with patch("services.file_grant_gateways.remote_fetcher.make_request", side_effect=[head, download]):
        with pytest.raises(FileTooLargeError):
            FileGrantRemoteFileGateway().fetch(url)

    assert download.is_closed


def test_remote_file_gateway_rejects_encoded_content_that_cannot_be_safely_bounded(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(UPLOAD_FILE_SIZE_LIMIT=1)
    url = "https://example.com/report.pdf"
    head = httpx.Response(200, request=httpx.Request("HEAD", url))
    download = httpx.Response(
        200,
        headers={"Content-Encoding": "gzip"},
        stream=httpx.ByteStream(b"compressed"),
        request=httpx.Request("GET", url),
    )

    with patch("services.file_grant_gateways.remote_fetcher.make_request", side_effect=[head, download]):
        assert FileGrantRemoteFileGateway().fetch(url) is None

    assert download.is_closed


def test_remote_file_gateway_returns_bounded_content(config_overrides: Callable[..., None]) -> None:
    config_overrides(UPLOAD_FILE_SIZE_LIMIT=1)
    url = "https://example.com/report.pdf"
    head = httpx.Response(
        200,
        headers={"Content-Length": "9", "Content-Type": "application/pdf"},
        request=httpx.Request("HEAD", url),
    )
    download = httpx.Response(200, content=b"pdf-bytes", request=httpx.Request("GET", url))

    with patch("services.file_grant_gateways.remote_fetcher.make_request", side_effect=[head, download]):
        file = FileGrantRemoteFileGateway().fetch(url)

    assert file is not None
    assert file.filename == "report.pdf"
    assert file.mimetype == "application/pdf"
    assert file.content == b"pdf-bytes"
