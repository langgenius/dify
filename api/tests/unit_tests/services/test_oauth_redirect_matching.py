import pytest

from services.oauth_redirect import is_loopback_only, redirect_host, redirect_uri_allowed


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
