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


def test_decode_remote_url_preserves_percent_encoded_query() -> None:
    """An already decoded URL must not have its encoded query decoded a second time."""
    url = "https://example.com/report.txt?name=a%26b&token=x%3Dy"
    assert decode_remote_url(url, b"download=1") == "https://example.com/report.txt?name=a%26b&token=x%3Dy&download=1"


def test_decode_remote_url_preserves_percent_encoded_path() -> None:
    """Percent-encoded bytes in an already decoded URL path must survive."""
    url = "https://example.com/files/report%20final.csv"
    assert decode_remote_url(url, b"") == "https://example.com/files/report%20final.csv"


def test_decode_remote_url_does_not_turn_encoded_hash_into_fragment() -> None:
    """A %23 inside the query must not be decoded into a fragment marker."""
    url = "https://example.com/f?tag=a%23b"
    assert decode_remote_url(url, b"") == "https://example.com/f?tag=a%23b"


def test_decode_remote_url_decodes_fully_encoded_url_once() -> None:
    """Regression: a fully percent-encoded URL is still decoded, nested escape included."""
    encoded = urllib.parse.quote("https://example.com/f?token=a%26b", safe="")
    assert decode_remote_url(encoded, b"") == "https://example.com/f?token=a%26b"
