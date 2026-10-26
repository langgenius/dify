"""Redirect URI rules for OAuth clients."""

from collections.abc import Sequence
from urllib.parse import urlsplit

HTTPS_SCHEME = "https"
HTTP_SCHEME = "http"
LOOPBACK_IP_LITERALS = frozenset({"127.0.0.1", "::1"})
LOOPBACK_HOSTS = LOOPBACK_IP_LITERALS | {"localhost"}


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


def is_valid_logo_uri(uri: str) -> bool:
    try:
        parts = urlsplit(uri)
        host = parts.hostname
    except ValueError:
        return False
    if parts.scheme != HTTPS_SCHEME:
        return False
    if not host:
        return False
    if parts.fragment or "#" in uri:
        return False
    return not any(char.isspace() for char in uri)


def _loopback_ip_port_stripped(uri: str) -> tuple[str, str, str, str] | None:
    """Return (scheme, host, path, query) for an http loopback IP literal URI, else None."""
    # urlsplit cleans its input (lowercases scheme, strips control chars, drops an empty "?"), so check the raw text.
    if not uri.startswith(f"{HTTP_SCHEME}://"):
        return None
    if any(char.isspace() or not char.isprintable() for char in uri):
        return None
    try:
        parts = urlsplit(uri)
        host = parts.hostname
        _ = parts.port  # raises ValueError on an invalid port
    except ValueError:
        return None
    if host not in LOOPBACK_IP_LITERALS:
        return None
    if parts.fragment or "#" in uri or "@" in parts.netloc:
        return None
    if "?" in uri and not parts.query:
        return None
    return parts.scheme, host, parts.path, parts.query


def redirect_uri_allowed(requested: str, registered: Sequence[str]) -> bool:
    if requested in registered:
        return True
    requested_loopback = _loopback_ip_port_stripped(requested)
    if requested_loopback is None:
        return False
    return any(_loopback_ip_port_stripped(uri) == requested_loopback for uri in registered)


def is_loopback_only(registered: Sequence[str]) -> bool:
    if not registered:
        return False
    return all(redirect_host(uri) in LOOPBACK_HOSTS for uri in registered)


def redirect_host(uri: str) -> str:
    try:
        return urlsplit(uri).hostname or ""
    except ValueError:
        return ""
