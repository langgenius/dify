import pytest

from services.oauth_redirect import (
    is_loopback_only,
    is_valid_logo_uri,
    is_valid_redirect_uri,
    redirect_host,
    redirect_uri_allowed,
)


@pytest.mark.parametrize(
    ("uri", "valid"),
    [
        ("https://example.com/callback", True),
        ("http://127.0.0.1:8123/callback", True),
        ("http://[::1]:9000/callback", True),
        ("http://example.com/callback", False),
        ("https://example.com/cb#frag", False),
        ("javascript:alert(1)", False),
    ],
)
def test_is_valid_redirect_uri(uri: str, valid: bool) -> None:
    assert is_valid_redirect_uri(uri) is valid


@pytest.mark.parametrize(
    ("uri", "valid"),
    [("https://example.com/x.png", True), ("http://example.com/x.png", False), ("javascript:alert(1)", False)],
)
def test_is_valid_logo_uri(uri: str, valid: bool) -> None:
    assert is_valid_logo_uri(uri) is valid


@pytest.mark.parametrize(
    ("requested", "registered"),
    [
        ("http://127.0.0.1:53111/cb", ["http://127.0.0.1/cb"]),
        ("http://[::1]:40000/cb", ["http://[::1]/cb"]),
        ("https://app.example.com/cb", ["https://other.example.com/cb", "https://app.example.com/cb"]),
    ],
)
def test_allowed(requested: str, registered: list[str]) -> None:
    assert redirect_uri_allowed(requested, registered)


@pytest.mark.parametrize(
    ("requested", "registered"),
    [
        ("http://localhost:5/cb", ["http://localhost/cb"]),
        ("https://app.example.com/cb/", ["https://app.example.com/cb"]),
        ("https://app.example.com:8443/cb", ["https://app.example.com/cb"]),
        ("http://127.0.0.1:53111/other", ["http://127.0.0.1/cb"]),
        ("http://user@127.0.0.1:5/cb", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1:5/c\nb", ["http://127.0.0.1/cb"]),
    ],
)
def test_rejected(requested: str, registered: list[str]) -> None:
    assert not redirect_uri_allowed(requested, registered)


def test_is_loopback_only_and_redirect_host() -> None:
    assert is_loopback_only(["http://127.0.0.1/cb", "http://[::1]/cb", "http://localhost/cb"])
    assert not is_loopback_only(["http://127.0.0.1/cb", "https://app.example.com/cb"])
    assert redirect_host("https://app.example.com:8443/cb") == "app.example.com"
    assert redirect_host("http://[bad/cb") == ""
