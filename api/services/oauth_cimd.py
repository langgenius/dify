"""OAuth Client ID Metadata Document clients (draft-ietf-oauth-client-id-metadata-document).

A client uses an https URL as its ``client_id``. Dify fetches the JSON document at that URL to learn the
client's name and redirect URIs. CIMD clients are never stored; only a validated copy is cached in Redis.
"""

import ipaddress
import json
import re
import socket
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import timedelta
from typing import Protocol
from urllib.parse import unquote, urlsplit

import httpx

from core.helper import ssrf_proxy
from core.helper.ssrf_proxy import ResponseLimitError
from core.tools.errors import ToolSSRFError
from enums.oauth_client import OAuthClientKind, TokenEndpointAuthMethod
from libs.oauth_bearer import sha256_hex
from services.oauth_client_metadata import (
    DEFAULT_GRANT_TYPES,
    MAX_CLIENT_NAME_LENGTH,
    InvalidClientMetadataError,
    RegistrationErrorCode,
    client_display_name,
    known_grant_types,
    optional_string,
    string_list,
    validated_logo_uri,
    validated_redirect_uris,
)
from services.oauth_clients import ResolvedClient
from services.oauth_redirect import HTTPS_SCHEME
from services.oauth_token_contracts import GrantType

CIMD_MAX_BYTES = 5 * 1024
CIMD_TIMEOUT_SECONDS = 5
CIMD_TOTAL_DEADLINE_SECONDS = 10
CIMD_STALE_SECONDS = 300
CIMD_CACHE_MIN_SECONDS = 60
CIMD_CACHE_MAX_SECONDS = 3600
CIMD_FETCH_INTERVAL_SECONDS = 10
FETCH_BUDGET_WINDOW_SECONDS = 60
UNLIMITED_FETCHES = 0
MAX_CLIENT_ID_URL_LENGTH = 2048
MAX_DNS_LABEL_LENGTH = 63
STORAGE_ID_PREFIX = "cimd:"
STORAGE_ID_HASH_LENGTH = 32
CACHE_KEY = "openapi_oauth:cimd:{digest}"
FETCH_THROTTLE_KEY = "openapi_oauth:cimd_fetch:{digest}"
FETCH_BUDGET_KEY = "openapi_oauth:cimd_fetch_budget:{window}"
HTTPS_PREFIX = f"{HTTPS_SCHEME}://"
DOT_SEGMENTS = frozenset({".", ".."})
FORBIDDEN_DOCUMENT_FIELDS = ("client_secret", "client_secret_expires_at")
LOCALHOST = "localhost"
FETCH_HEADERS = {"Accept-Encoding": "identity", "Accept": "application/json"}
NUMERIC_LABEL_PATTERN = re.compile(r"0x[0-9a-f]*|[0-9]+", re.IGNORECASE)
MAX_AGE_PATTERN = re.compile(r"(?:^|[\s,])max-age\s*=\s*\"?(\d+)\"?", re.IGNORECASE)


class CimdFetchError(Exception):
    """The document could not be reached or answered 5xx; a stale cached copy is served instead."""


class CimdRejectedError(Exception):
    """The document was reached and refused, or the host is not allowed; a cached copy must go."""


@dataclass(frozen=True)
class CimdResponse:
    body: bytes
    max_age: int | None


class CimdCache(Protocol):
    def get(self, name: str) -> str | bytes | None: ...

    def setex(self, name: str, time: timedelta | int, value: str) -> object: ...

    def delete(self, *names: str) -> object: ...

    def set(self, name: str, value: str, *, nx: bool, ex: int) -> object: ...

    def incr(self, name: str) -> int: ...

    def expire(self, name: str, time: int) -> object: ...


def cimd_storage_id(url: str) -> str:
    return STORAGE_ID_PREFIX + sha256_hex(url)[:STORAGE_ID_HASH_LENGTH]


def resolve_host_addresses(host: str) -> list[str]:
    return [str(info[4][0]) for info in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)]


def _max_age(headers: httpx.Headers) -> int | None:
    match = MAX_AGE_PATTERN.search(headers.get("cache-control", ""))
    if match is None:
        return None
    return int(match.group(1))


def fetch_client_metadata(url: str) -> CimdResponse:
    try:
        streamed = ssrf_proxy.make_request(
            "GET",
            url,
            max_retries=0,
            follow_redirects=False,
            timeout=CIMD_TIMEOUT_SECONDS,
            stream_response=True,
            ssl_verify=True,
            headers=FETCH_HEADERS,
        )
        response = ssrf_proxy.buffer_response(
            streamed, max_response_bytes=CIMD_MAX_BYTES, deadline_seconds=CIMD_TOTAL_DEADLINE_SECONDS
        )
    except (httpx.HTTPError, httpx.InvalidURL, ResponseLimitError, ToolSSRFError) as error:
        raise CimdFetchError(str(error)) from error
    if response.status_code >= httpx.codes.INTERNAL_SERVER_ERROR:
        raise CimdFetchError(f"metadata document answered {response.status_code}")
    if response.status_code != httpx.codes.OK:
        raise CimdRejectedError
    return CimdResponse(body=response.content, max_age=_max_age(response.headers))


def _client_id_host(client_id: str) -> str:
    """Return the host of a client id URL that follows the draft's rules, else raise."""
    if not client_id.startswith(HTTPS_PREFIX):
        raise CimdRejectedError
    if len(client_id) > MAX_CLIENT_ID_URL_LENGTH:
        raise CimdRejectedError
    if not client_id.isascii():
        raise CimdRejectedError
    if any(char.isspace() for char in client_id):
        raise CimdRejectedError
    if not client_id.isprintable():
        raise CimdRejectedError
    if "#" in client_id:
        raise CimdRejectedError
    try:
        parts = urlsplit(client_id)
        host = parts.hostname
        _ = parts.port
    except ValueError:
        raise CimdRejectedError from None
    if not host:
        raise CimdRejectedError
    if ":" not in host:
        for label in host.removesuffix(".").split("."):
            if not label:
                raise CimdRejectedError
            if len(label) > MAX_DNS_LABEL_LENGTH:
                raise CimdRejectedError
    if "@" in parts.netloc:
        raise CimdRejectedError
    if not parts.path:
        raise CimdRejectedError
    if any(unquote(segment) in DOT_SEGMENTS for segment in parts.path.split("/")):
        raise CimdRejectedError
    return host


def _is_public_address(raw: str) -> bool:
    try:
        address = ipaddress.ip_address(raw.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    if address.is_private:
        return False
    if address.is_loopback:
        return False
    if address.is_link_local:
        return False
    if address.is_reserved:
        return False
    if address.is_multicast:
        return False
    if address.is_unspecified:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.is_site_local:
        return False
    return address.is_global


def _check_host_is_public(host: str, resolve_host: Callable[[str], Sequence[str]]) -> None:
    name = host.rstrip(".").lower()
    if name == LOCALHOST:
        raise CimdRejectedError
    if name.endswith(f".{LOCALHOST}"):
        raise CimdRejectedError
    try:
        ipaddress.ip_address(name)
    except ValueError:
        pass
    else:
        if not _is_public_address(name):
            raise CimdRejectedError
        return
    # Resolvers and HTTP clients disagree on spellings like 2130706433, 0x7f.1 and 0177.0.0.1.
    if NUMERIC_LABEL_PATTERN.fullmatch(name.rsplit(".", 1)[-1]):
        raise CimdRejectedError
    try:
        addresses = resolve_host(name)
    except (OSError, UnicodeError):
        raise CimdRejectedError from None
    if not addresses:
        raise CimdRejectedError
    for address in addresses:
        if not _is_public_address(address):
            raise CimdRejectedError


def _grant_types(document: Mapping[str, object]) -> frozenset[GrantType]:
    values = string_list(document, "grant_types", code=RegistrationErrorCode.INVALID_CLIENT_METADATA)
    if values is None:
        return frozenset(DEFAULT_GRANT_TYPES)
    grants = frozenset(known_grant_types(values))
    if GrantType.AUTHORIZATION_CODE not in grants:
        raise CimdRejectedError
    return grants


def _check_auth_method(document: Mapping[str, object]) -> None:
    value = document.get("token_endpoint_auth_method")
    if value is None:
        return
    if value != TokenEndpointAuthMethod.NONE:
        raise CimdRejectedError


def _logo_uri(document: Mapping[str, object]) -> str | None:
    try:
        return validated_logo_uri(document)
    except InvalidClientMetadataError:
        return None


def _parse_document(url: str, host: str, body: bytes) -> ResolvedClient:
    try:
        document = json.loads(body)
    except ValueError:
        raise CimdRejectedError from None
    if not isinstance(document, dict):
        raise CimdRejectedError
    if document.get("client_id") != url:
        raise CimdRejectedError
    if any(field in document for field in FORBIDDEN_DOCUMENT_FIELDS):
        raise CimdRejectedError
    _check_auth_method(document)
    try:
        redirect_uris = validated_redirect_uris(document)
        client_name = optional_string(document, "client_name", max_length=MAX_CLIENT_NAME_LENGTH)
        grant_types = _grant_types(document)
    except InvalidClientMetadataError:
        raise CimdRejectedError from None
    return ResolvedClient(
        client_id=url,
        storage_client_id=cimd_storage_id(url),
        kind=OAuthClientKind.PUBLIC,
        display_name=client_display_name(client_name, fallback=host),
        logo_uri=_logo_uri(document),
        redirect_uris=redirect_uris,
        grant_types=grant_types,
        secret_hash=None,
    )


@dataclass(frozen=True)
class _CachedClient:
    client: ResolvedClient
    soft_expires_at: float


def _dump(client: ResolvedClient, *, soft_expires_at: float) -> str:
    return json.dumps(
        {
            "soft_expires_at": soft_expires_at,
            "display_name": client.display_name,
            "logo_uri": client.logo_uri,
            "redirect_uris": list(client.redirect_uris),
            "grant_types": sorted(grant.value for grant in client.grant_types),
        }
    )


def _load(url: str, raw: str | bytes) -> _CachedClient | None:
    try:
        data = json.loads(raw)
        client = ResolvedClient(
            client_id=url,
            storage_client_id=cimd_storage_id(url),
            kind=OAuthClientKind.PUBLIC,
            display_name=data["display_name"],
            logo_uri=data["logo_uri"],
            redirect_uris=tuple(data["redirect_uris"]),
            grant_types=frozenset(GrantType(value) for value in data["grant_types"]),
            secret_hash=None,
        )
        return _CachedClient(client=client, soft_expires_at=float(data["soft_expires_at"]))
    except (ValueError, KeyError, TypeError):
        return None


class CimdClientSource:
    """Resolves https client ids from their metadata documents.

    A cached client is fresh until its soft expiry, then stale for ``CIMD_STALE_SECONDS``. A stale client is
    served while another request holds the fetch throttle, when the refetch cannot reach the document, and when
    the server-wide fetch budget is spent. The budget caps outbound fetches per minute, so unknown client ids
    sent to the anonymous endpoints cannot make Dify fetch and cache documents without bound.
    """

    def __init__(
        self,
        *,
        cache: CimdCache,
        fetch: Callable[[str], CimdResponse],
        resolve_host: Callable[[str], Sequence[str]],
        fetch_limit_per_minute: int,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._cache = cache
        self._fetch = fetch
        self._resolve_host = resolve_host
        self._fetch_limit_per_minute = fetch_limit_per_minute
        self._now = now

    def resolve(self, client_id: str) -> ResolvedClient | None:
        try:
            host = _client_id_host(client_id)
        except CimdRejectedError:
            return None
        digest = sha256_hex(client_id)
        raw = self._cache.get(CACHE_KEY.format(digest=digest))
        cached = None if raw is None else _load(client_id, raw)
        if cached is not None:
            if self._now() < cached.soft_expires_at:
                return cached.client
        stale = None if cached is None else cached.client
        if not self._take_fetch_slot(digest):
            return stale
        if not self._take_fetch_budget():
            return stale
        return self._fetch_and_cache(client_id, host, digest, stale=stale)

    def _take_fetch_slot(self, digest: str) -> bool:
        key = FETCH_THROTTLE_KEY.format(digest=digest)
        return bool(self._cache.set(key, "1", nx=True, ex=CIMD_FETCH_INTERVAL_SECONDS))

    def _take_fetch_budget(self) -> bool:
        if self._fetch_limit_per_minute == UNLIMITED_FETCHES:
            return True
        key = FETCH_BUDGET_KEY.format(window=int(self._now() // FETCH_BUDGET_WINDOW_SECONDS))
        count = self._cache.incr(key)
        self._cache.expire(key, FETCH_BUDGET_WINDOW_SECONDS * 2)
        return count <= self._fetch_limit_per_minute

    def _fetch_and_cache(
        self, url: str, host: str, digest: str, *, stale: ResolvedClient | None
    ) -> ResolvedClient | None:
        try:
            _check_host_is_public(host, self._resolve_host)
            response = self._fetch(url)
            client = _parse_document(url, host, response.body)
        except CimdRejectedError:
            self._cache.delete(CACHE_KEY.format(digest=digest))
            return None
        except CimdFetchError:
            return stale
        lifetime = CIMD_CACHE_MIN_SECONDS if response.max_age is None else response.max_age
        lifetime = max(CIMD_CACHE_MIN_SECONDS, min(CIMD_CACHE_MAX_SECONDS, lifetime))
        entry = _dump(client, soft_expires_at=self._now() + lifetime)
        self._cache.setex(CACHE_KEY.format(digest=digest), lifetime + CIMD_STALE_SECONDS, entry)
        return client
