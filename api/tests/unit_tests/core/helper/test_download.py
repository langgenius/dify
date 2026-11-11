from collections.abc import Iterator

import pytest
from pytest_mock import MockerFixture

from core.helper.download import download_with_size_limit
from core.helper.ssrf_proxy import MaxRetriesExceededError


class _StubResponse:
    def __init__(self, status_code: int, chunks: list[bytes]) -> None:
        self.status_code = status_code
        self.iter_bytes_called = False
        self._chunks = chunks

    def iter_bytes(self) -> Iterator[bytes]:
        self.iter_bytes_called = True
        return iter(self._chunks)


def test_download_with_size_limit_returns_content(mocker: MockerFixture) -> None:
    response = _StubResponse(status_code=200, chunks=[b"ab", b"cd", b"ef"])
    mock_get = mocker.patch("core.file.remote_fetcher.make_request", return_value=response)

    content = download_with_size_limit("https://example.com/a.txt", max_download_size=6, timeout=10)

    assert content == b"abcdef"
    mock_get.assert_called_once_with("GET", "https://example.com/a.txt", follow_redirects=True, timeout=10)


def test_download_with_size_limit_raises_for_404(mocker: MockerFixture) -> None:
    response = _StubResponse(status_code=404, chunks=[])
    mocker.patch("core.file.remote_fetcher.make_request", return_value=response)

    with pytest.raises(ValueError, match="file not found"):
        download_with_size_limit("https://example.com/missing.txt", max_download_size=10)

    assert not response.iter_bytes_called


@pytest.mark.parametrize("status_code", [403, 429, 500, 503])
def test_download_with_size_limit_raises_for_error_status(mocker: MockerFixture, status_code: int) -> None:
    response = _StubResponse(status_code=status_code, chunks=[b"<html>error page</html>"])
    mocker.patch("core.file.remote_fetcher.make_request", return_value=response)

    with pytest.raises(ValueError, match=f"HTTP {status_code}"):
        download_with_size_limit("https://marketplace.example.com/api/v1/plugins/download-url", max_download_size=1024)

    assert not response.iter_bytes_called


@pytest.mark.parametrize("status_code", [429, 503])
def test_download_with_size_limit_reports_an_exhausted_status(mocker: MockerFixture, status_code: int) -> None:
    mocker.patch(
        "core.file.remote_fetcher.make_request",
        side_effect=MaxRetriesExceededError("Reached maximum retries (3) for URL u", status_code=status_code),
    )

    with pytest.raises(ValueError, match=f"HTTP {status_code}"):
        download_with_size_limit("https://marketplace.example.com/api/v1/plugins/download-url", max_download_size=1024)


def test_download_with_size_limit_keeps_a_transport_failure(mocker: MockerFixture) -> None:
    mocker.patch(
        "core.file.remote_fetcher.make_request",
        side_effect=MaxRetriesExceededError("Reached maximum retries (3) for URL u"),
    )

    with pytest.raises(MaxRetriesExceededError):
        download_with_size_limit("https://marketplace.example.com/api/v1/plugins/download-url", max_download_size=1024)


def test_download_with_size_limit_raises_when_size_exceeds_limit(
    mocker: MockerFixture,
) -> None:
    response = _StubResponse(status_code=200, chunks=[b"abc", b"de"])
    mocker.patch("core.file.remote_fetcher.make_request", return_value=response)

    with pytest.raises(ValueError, match="Max file size reached"):
        download_with_size_limit("https://example.com/large.bin", max_download_size=4)


def test_download_with_size_limit_accepts_content_equal_to_limit(
    mocker: MockerFixture,
) -> None:
    response = _StubResponse(status_code=200, chunks=[b"ab", b"cd"])
    mocker.patch("core.file.remote_fetcher.make_request", return_value=response)

    content = download_with_size_limit("https://example.com/exact.bin", max_download_size=4)

    assert content == b"abcd"
