"""Redirect URI rules for OAuth clients."""

from collections.abc import Sequence
from typing import NamedTuple
from urllib.parse import SplitResult, urlsplit

HTTPS_SCHEME = "https"
HTTP_SCHEME = "http"
WEB_SCHEMES = frozenset({HTTPS_SCHEME, HTTP_SCHEME})
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})
# A browser runs or reads these itself instead of handing them to an app (RFC 8252 §7.1).
BROWSER_SCHEMES = frozenset({"javascript", "data", "vbscript", "file", "blob", "about"})


class _SchemeHost(NamedTuple):
    scheme: str
    host: str


def _parsed(uri: str) -> SplitResult | None:
    """The parts of a URI that parses and has no fragment or whitespace, else None."""
    if "#" in uri:
        return None
    if any(char.isspace() for char in uri):
        return None
    try:
        parts = urlsplit(uri)
        _ = parts.hostname  # raises ValueError on a malformed IPv6 host
    except ValueError:
        return None
    return parts


def _scheme_host(uri: str) -> _SchemeHost | None:
    """Scheme and host of a URI that parses, has a host, and has no fragment or whitespace, else None."""
    parts = _parsed(uri)
    if parts is None or not parts.hostname:
        return None
    return _SchemeHost(scheme=parts.scheme, host=parts.hostname)


def _is_app_scheme(parts: SplitResult) -> bool:
    """A native app's own scheme, such as ``cursor://`` or ``com.example.app:/cb``."""
    if not parts.scheme:
        return False
    if parts.scheme in WEB_SCHEMES or parts.scheme in BROWSER_SCHEMES:
        return False
    return bool(parts.netloc or parts.path)


def is_valid_redirect_uri(uri: str) -> bool:
    parts = _parsed(uri)
    if parts is None:
        return False
    if parts.scheme == HTTPS_SCHEME:
        return bool(parts.hostname)
    if parts.scheme == HTTP_SCHEME:
        return parts.hostname in LOOPBACK_HOSTS
    return _is_app_scheme(parts)


def is_valid_logo_uri(uri: str) -> bool:
    checked = _scheme_host(uri)
    if checked is None:
        return False
    return checked.scheme == HTTPS_SCHEME


def _loopback_port_stripped(uri: str) -> tuple[str, str, str, str] | None:
    """Return (scheme, host, path, query) for an http loopback URI, else None.

    ``localhost`` counts too: Claude Code and Codex register ``http://localhost/callback``
    and listen on a random port.
    """
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
    if host not in LOOPBACK_HOSTS:
        return None
    if parts.fragment:
        return None
    if "#" in uri:
        return None
    if "@" in parts.netloc:
        return None
    if "?" in uri and not parts.query:
        return None
    return parts.scheme, host, parts.path, parts.query


def redirect_uri_allowed(requested: str, registered: Sequence[str]) -> bool:
    if requested in registered:
        return True
    requested_loopback = _loopback_port_stripped(requested)
    if requested_loopback is None:
        return False
    return any(_loopback_port_stripped(uri) == requested_loopback for uri in registered)


def is_loopback_only(registered: Sequence[str]) -> bool:
    if not registered:
        return False
    return all(redirect_host(uri) in LOOPBACK_HOSTS for uri in registered)


def redirect_host(uri: str) -> str:
    """Where the redirect goes, as the consent page shows it: a web URI's host, an app URI's scheme and host."""
    try:
        parts = urlsplit(uri)
        host = parts.hostname or ""
    except ValueError:
        return ""
    if parts.scheme in WEB_SCHEMES or not parts.scheme:
        return host
    return f"{parts.scheme}://{host}" if host else f"{parts.scheme}:"
