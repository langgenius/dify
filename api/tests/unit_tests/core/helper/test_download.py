from collections.abc import Iterator
from unittest.mock import call

import httpx
import pytest
from pytest_mock import MockerFixture

from core.helper.download import DownloadSizeLimitExceededError, download_with_size_limit


class _StubResponse:
    def __init__(self, status_code: int, chunks: list[bytes], headers: dict[str, str] | None = None) -> None:
        self.status_code = status_code
        self._chunks = chunks
        self.headers = headers or {}
        self.closed = False

    def iter_bytes(self) -> Iterator[bytes]:
        return iter(self._chunks)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "request failed",
                request=httpx.Request("GET", "https://example.com"),
                response=httpx.Response(self.status_code),
            )

    def close(self) -> None:
        self.closed = True


def test_download_with_size_limit_returns_content(mocker: MockerFixture) -> None:
    head_response = _StubResponse(status_code=200, chunks=[])
    get_response = _StubResponse(status_code=200, chunks=[b"ab", b"cd", b"ef"])
    mock_request = mocker.patch(
        "core.file.remote_fetcher.make_request",
        side_effect=[head_response, get_response],
    )

    content = download_with_size_limit("https://example.com/a.txt", max_download_size=6, timeout=10)

    assert content == b"abcdef"
    assert mock_request.call_args_list == [
        call("HEAD", "https://example.com/a.txt", follow_redirects=True, timeout=10),
        call("GET", "https://example.com/a.txt", stream=True, follow_redirects=True, timeout=10),
    ]
    assert head_response.closed
    assert get_response.closed


def test_download_with_size_limit_raises_for_404(mocker: MockerFixture) -> None:
    mocker.patch(
        "core.file.remote_fetcher.make_request",
        return_value=_StubResponse(status_code=404, chunks=[]),
    )

    with pytest.raises(ValueError, match="file not found"):
        download_with_size_limit("https://example.com/missing.txt", max_download_size=10)


def test_download_with_size_limit_raises_when_size_exceeds_limit(
    mocker: MockerFixture,
) -> None:
    head_response = _StubResponse(status_code=200, chunks=[])
    get_response = _StubResponse(status_code=200, chunks=[b"abc", b"de"])
    mocker.patch("core.file.remote_fetcher.make_request", side_effect=[head_response, get_response])

    with pytest.raises(DownloadSizeLimitExceededError, match="Max file size reached"):
        download_with_size_limit("https://example.com/large.bin", max_download_size=4)


def test_download_with_size_limit_rejects_oversized_content_length(
    mocker: MockerFixture,
) -> None:
    mock_request = mocker.patch(
        "core.file.remote_fetcher.make_request",
        return_value=_StubResponse(status_code=200, chunks=[], headers={"content-length": "5"}),
    )

    with pytest.raises(DownloadSizeLimitExceededError, match="Max file size reached"):
        download_with_size_limit("https://example.com/large.bin", max_download_size=4)

    mock_request.assert_called_once_with("HEAD", "https://example.com/large.bin", follow_redirects=True)


def test_download_with_size_limit_accepts_content_equal_to_limit(
    mocker: MockerFixture,
) -> None:
    mocker.patch(
        "core.file.remote_fetcher.make_request",
        side_effect=[
            _StubResponse(status_code=200, chunks=[]),
            _StubResponse(status_code=200, chunks=[b"ab", b"cd"]),
        ],
    )

    content = download_with_size_limit("https://example.com/exact.bin", max_download_size=4)

    assert content == b"abcd"
