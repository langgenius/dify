import pytest

from libs.url_utils import normalize_api_base_url


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://api.example.com", "https://api.example.com/v1"),
        ("https://api.example.com/", "https://api.example.com/v1"),
        ("https://api.example.com/v1", "https://api.example.com/v1"),
        ("https://api.example.com/v1/", "https://api.example.com/v1"),
        ("https://api.example.com/api", "https://api.example.com/api/v1"),
        ("https://api.example.com/api/", "https://api.example.com/api/v1"),
        ("http://localhost:8080", "http://localhost:8080/v1"),
        ("http://localhost:8080/v1", "http://localhost:8080/v1"),
        # A query string or fragment belongs to the URL, not to the appended path.
        ("https://api.example.com?timeout=30", "https://api.example.com/v1?timeout=30"),
        ("https://api.example.com/v1?timeout=30", "https://api.example.com/v1?timeout=30"),
        ("https://api.example.com/api?timeout=30", "https://api.example.com/api/v1?timeout=30"),
        ("https://api.example.com#section", "https://api.example.com/v1#section"),
        ("https://api.example.com/v1#section", "https://api.example.com/v1#section"),
        ("https://api.example.com/v1/?timeout=30#section", "https://api.example.com/v1?timeout=30#section"),
        # Surrounding whitespace is ignored instead of being embedded in the URL.
        ("https://api.example.com ", "https://api.example.com/v1"),
        ("  https://api.example.com/v1  ", "https://api.example.com/v1"),
        ("\thttps://api.example.com/api\n", "https://api.example.com/api/v1"),
    ],
)
def test_normalize_api_base_url(raw: str, expected: str) -> None:
    assert normalize_api_base_url(raw) == expected


def test_normalize_api_base_url_is_idempotent() -> None:
    for raw in ("https://api.example.com", "https://api.example.com/api/", "https://api.example.com?timeout=30"):
        once = normalize_api_base_url(raw)
        assert normalize_api_base_url(once) == once
