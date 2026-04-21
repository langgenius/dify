from collections.abc import Iterator

import pytest
from pytest_mock import MockerFixture

from core.helper.download import download_with_size_limit


class _StubResponse:
    def __init__(self, status_code: int, chunks: list[bytes]) -> None:
        self.status_code = status_code
        self._chunks = chunks

    def iter_bytes(self) -> Iterator[bytes]:
        return iter(self._chunks)


def test_download_with_size_limit_returns_content(mocker: MockerFixture) -> None:
    response = _StubResponse(status_code=200, chunks=[b"ab", b"cd", b"ef"])
    mock_get = mocker.patch("core.helper.download.ssrf_proxy.get", return_value=response)

    content = download_with_size_limit("https://example.com/a.txt", max_download_size=6, timeout=10)

    assert content == b"abcdef"
    mock_get.assert_called_once_with("https://example.com/a.txt", follow_redirects=True, timeout=10)


def test_download_with_size_limit_raises_for_404(mocker: MockerFixture) -> None:
    mocker.patch("core.helper.download.ssrf_proxy.get", return_value=_StubResponse(status_code=404, chunks=[]))

    with pytest.raises(ValueError, match="file not found"):
        download_with_size_limit("https://example.com/missing.txt", max_download_size=10)


def test_download_with_size_limit_raises_when_size_exceeds_limit(
    mocker: MockerFixture,
) -> None:
    response = _StubResponse(status_code=200, chunks=[b"abc", b"de"])
    mocker.patch("core.helper.download.ssrf_proxy.get", return_value=response)

    with pytest.raises(ValueError, match="Max file size reached"):
        download_with_size_limit("https://example.com/large.bin", max_download_size=4)


def test_download_with_size_limit_accepts_content_equal_to_limit(
    mocker: MockerFixture,
) -> None:
    response = _StubResponse(status_code=200, chunks=[b"ab", b"cd"])
    mocker.patch("core.helper.download.ssrf_proxy.get", return_value=response)

    content = download_with_size_limit("https://example.com/exact.bin", max_download_size=4)

    assert content == b"abcd"
