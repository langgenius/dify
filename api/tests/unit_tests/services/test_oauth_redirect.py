import pytest

from services.oauth_redirect import is_valid_redirect_uri


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
def test_accepts_valid_redirects(uri):
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
def test_rejects_invalid_redirects(uri):
    assert is_valid_redirect_uri(uri) is False
