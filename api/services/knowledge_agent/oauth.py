"""OAuth 2.1 helpers for the knowledge-agent authorization server. Pure functions only."""

from __future__ import annotations

import base64
import hashlib
import re
from urllib.parse import urlsplit

from constants.oauth_bearer import Scope

KNOWLEDGE_AGENT_SCOPES: tuple[str, ...] = (Scope.KNOWLEDGE_READ.value,)
DEFAULT_KNOWLEDGE_AGENT_SCOPE = Scope.KNOWLEDGE_READ.value

ACCESS_TOKEN_TTL_SECONDS = 60 * 60
REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
AUTHORIZATION_CODE_TTL_SECONDS = 60
PERSONAL_TOKEN_DEFAULT_DAYS = 30
PERSONAL_TOKEN_MAX_DAYS = 90
MAX_GRANT_KNOWLEDGE_BASES = 100

ACCESS_TOKEN_PREFIX = "dfok_"
REFRESH_TOKEN_PREFIX = "dfokr_"
DCR_CLIENT_ID_PREFIX = "dfokc_"
# The `client_id` column of `oauth_access_tokens` for knowledge-agent rows; the connection itself
# (and its OAuth client, if any) is linked through `knowledge_agent_grant_id`.
TOKEN_ROW_CLIENT_ID = "knowledge-agent"

_PKCE_VERIFIER = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")
_PKCE_CHALLENGE = re.compile(r"^[A-Za-z0-9\-_]{43,128}$")
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "[::1]", "::1"})
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")


class KnowledgeAgentOAuthError(Exception):
    """An RFC 6749 error response (`{error, error_description}`)."""

    def __init__(self, error: str, description: str, status: int = 400) -> None:
        super().__init__(description)
        self.error = error
        self.description = description
        self.status = status


def parse_requested_scopes(raw: str | None) -> list[str]:
    """Supported scopes among the requested ones; nothing supported means the default."""
    requested = set((raw or "").split())
    granted = [scope for scope in KNOWLEDGE_AGENT_SCOPES if scope in requested]
    return granted or [DEFAULT_KNOWLEDGE_AGENT_SCOPE]


def is_pkce_challenge(value: object) -> bool:
    return isinstance(value, str) and bool(_PKCE_CHALLENGE.fullmatch(value))


def verify_pkce(verifier: object, challenge: str) -> bool:
    """RFC 7636 S256: BASE64URL(SHA256(verifier)) == challenge. Plain is never accepted."""
    if not isinstance(verifier, str) or not _PKCE_VERIFIER.fullmatch(verifier):
        return False
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii") == challenge


def _host(url: str) -> tuple[str, str, str]:
    parts = urlsplit(url)
    return parts.scheme, (parts.hostname or ""), parts.netloc


def is_loopback_url(url: str) -> bool:
    try:
        scheme, hostname, _ = _host(url)
    except ValueError:
        return False
    return scheme == "http" and (hostname in _LOOPBACK_HOSTS or f"[{hostname}]" in _LOOPBACK_HOSTS)


def validate_redirect_uri(raw: object) -> str | None:
    """HTTPS, or HTTP on a loopback host (native apps such as CLI agents, RFC 8252)."""
    if not isinstance(raw, str) or not raw or len(raw) > 2048:
        return None
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if parts.fragment or parts.username or parts.password or not parts.hostname:
        return None
    if parts.scheme != "https" and not is_loopback_url(raw):
        return None
    return raw


def redirect_uri_matches(registered: list[str], requested: str) -> bool:
    """Exact match, except a loopback redirect may use any port (RFC 8252 §7.3)."""
    if requested in registered:
        return True
    if not is_loopback_url(requested):
        return False
    target = urlsplit(requested)
    for candidate in registered:
        if not is_loopback_url(candidate):
            continue
        url = urlsplit(candidate)
        if url.hostname == target.hostname and url.path == target.path and url.query == target.query:
            return True
    return False


def same_resource(left: str, right: str) -> bool:
    return left.rstrip("/") == right.rstrip("/")


def is_client_metadata_url(client_id: str) -> bool:
    """Client ID Metadata Document URLs: HTTPS with a path, no fragment or credentials."""
    if not client_id.startswith("https://") or len(client_id) > 2048:
        return False
    try:
        parts = urlsplit(client_id)
    except ValueError:
        return False
    return len(parts.path) > 1 and not parts.fragment and not parts.username and not parts.password


def client_display_name(raw: object, fallback: str) -> str:
    name = _CONTROL_CHARACTERS.sub("", raw).strip() if isinstance(raw, str) else ""
    return (name or fallback)[:120]


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
