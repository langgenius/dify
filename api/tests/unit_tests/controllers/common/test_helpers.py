import urllib.parse

import pytest

from controllers.common.helpers import decode_remote_url


@pytest.mark.parametrize(
    ("url", "query_string", "expected"),
    [
        (
            urllib.parse.quote("https://example.com/report.txt", safe=""),
            b"download=1",
            "https://example.com/report.txt?download=1",
        ),
        (
            urllib.parse.quote("https://example.com/report.txt?version=1", safe=""),
            "download=1",
            "https://example.com/report.txt?version=1&download=1",
        ),
        ("https://example.com/report.txt?", "download=1", "https://example.com/report.txt?download=1"),
        ("https://example.com/report.txt", b"", "https://example.com/report.txt"),
    ],
)
def test_decode_remote_url(url: str, query_string: bytes | str, expected: str) -> None:
    assert decode_remote_url(url, query_string) == expected


def test_decode_remote_url_defers_invalid_url_validation() -> None:
    assert decode_remote_url("http://[invalid", "download=1") == "http://[invalid?download=1"
