"""Redirect URI rules for OAuth clients."""

from urllib.parse import urlsplit

HTTPS_SCHEME = "https"
HTTP_SCHEME = "http"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


def is_valid_redirect_uri(uri: str) -> bool:
    try:
        parts = urlsplit(uri)
        host = parts.hostname
    except ValueError:
        return False
    if parts.fragment or "#" in uri:
        return False
    if not host:
        return False
    if any(char.isspace() for char in uri):
        return False
    if parts.scheme == HTTPS_SCHEME:
        return True
    return parts.scheme == HTTP_SCHEME and host in LOOPBACK_HOSTS
