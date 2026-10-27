import pytest

from services.oauth_redirect import (
    is_loopback_only,
    is_valid_logo_uri,
    is_valid_redirect_uri,
    redirect_host,
    redirect_uri_allowed,
)


@pytest.mark.parametrize(
    "uri",
    [
        "https://example.com/callback",
        "https://example.com:8443/cb?x=1",
        "http://127.0.0.1/callback",
        "http://127.0.0.1:8123/callback",
        "http://[::1]:9000/callback",
        "http://localhost:3000/callback",
    ],
)
def test_accepts_valid_redirects(uri: str) -> None:
    assert is_valid_redirect_uri(uri) is True


@pytest.mark.parametrize(
    "uri",
    [
        "",
        "http://example.com/callback",
        "http://127.0.0.2/callback",
        "https:///callback",
        "https://example.com/cb#frag",
        "http://localhost/cb#frag",
        "ftp://example.com/cb",
        "javascript:alert(1)",
        "myapp://callback",
        "example.com/callback",
        "https://exa mple.com/cb",
    ],
)
def test_rejects_invalid_redirects(uri: str) -> None:
    assert is_valid_redirect_uri(uri) is False


@pytest.mark.parametrize("uri", ["https://example.com/x.png", "https://cdn.example.com:8443/l.svg"])
def test_accepts_https_logo(uri: str) -> None:
    assert is_valid_logo_uri(uri) is True


@pytest.mark.parametrize(
    "uri",
    [
        "",
        "http://example.com/x.png",
        "http://127.0.0.1/x.png",
        "https:///x.png",
        "https://e.com/x#f",
        "javascript:alert(1)",
    ],
)
def test_rejects_invalid_logo(uri: str) -> None:
    assert is_valid_logo_uri(uri) is False


@pytest.mark.parametrize(
    ("requested", "registered"),
    [
        ("http://127.0.0.1:53111/cb", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1/cb", ["http://127.0.0.1/cb"]),
        ("http://[::1]:40000/cb", ["http://[::1]/cb"]),
        ("http://127.0.0.1:1/cb?x=1", ["http://127.0.0.1:2/cb?x=1"]),
        ("https://app.example.com/cb", ["https://other.example.com/cb", "https://app.example.com/cb"]),
        ("http://localhost:5/cb", ["http://localhost:5/cb"]),
    ],
)
def test_allowed(requested: str, registered: list[str]) -> None:
    assert redirect_uri_allowed(requested, registered)


@pytest.mark.parametrize(
    ("requested", "registered"),
    [
        ("http://localhost:5/cb", ["http://localhost/cb"]),
        ("http://localhost/cb", ["http://localhost:5/cb"]),
        ("https://app.example.com/cb/", ["https://app.example.com/cb"]),
        ("https://APP.example.com/cb", ["https://app.example.com/cb"]),
        ("https://app.example.com/CB", ["https://app.example.com/cb"]),
        ("https://app.example.com/cb?x=1", ["https://app.example.com/cb"]),
        ("https://app.example.com:8443/cb", ["https://app.example.com/cb"]),
        ("https://app.example.com/cb#f", ["https://app.example.com/cb"]),
        ("http://127.0.0.1:53111/other", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1:53111/cb?x=1", ["http://127.0.0.1/cb"]),
        ("https://127.0.0.1:53111/cb", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.2:53111/cb", ["http://127.0.0.1/cb"]),
        ("http://[::1]:5/cb", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1:5/cb#f", ["http://127.0.0.1/cb"]),
        ("http://user@127.0.0.1:5/cb", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1:99999/cb", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1:abc/cb", ["http://127.0.0.1/cb"]),
        ("https://app.example.com:5/cb", ["https://app.example.com/cb"]),
        ("HTTP://127.0.0.1:5/cb", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1:5/c\nb", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1:5/c\tb", ["http://127.0.0.1/cb"]),
        (" http://127.0.0.1:5/cb", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1:5/cb?", ["http://127.0.0.1/cb"]),
        ("http://127.0.0.1:5/cb\x00", ["http://127.0.0.1/cb"]),
        ("", []),
        ("http://127.0.0.1:5/cb", []),
    ],
)
def test_rejected(requested: str, registered: list[str]) -> None:
    assert not redirect_uri_allowed(requested, registered)


def test_is_loopback_only() -> None:
    assert is_loopback_only(["http://127.0.0.1/cb", "http://[::1]/cb", "http://localhost/cb"])
    assert not is_loopback_only(["http://127.0.0.1/cb", "https://app.example.com/cb"])
    assert not is_loopback_only([])
    assert not is_loopback_only(["not a uri"])


def test_redirect_host() -> None:
    assert redirect_host("https://app.example.com:8443/cb") == "app.example.com"
    assert redirect_host("http://[::1]:5/cb") == "::1"
    assert redirect_host("http://[bad/cb") == ""
    assert redirect_host("/relative") == ""
