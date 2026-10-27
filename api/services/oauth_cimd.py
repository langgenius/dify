"""OAuth Client ID Metadata Document clients (draft-ietf-oauth-client-id-metadata-document).

A client uses an https URL as its ``client_id``. Dify fetches the JSON document at that URL to learn the
client's name and redirect URIs. CIMD clients are never stored; only a validated copy is cached in Redis.
"""

import ipaddress
import json
import re
import socket
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
from services.oauth_client_registration import (
    DEFAULT_GRANT_TYPES,
    MAX_CLIENT_NAME_LENGTH,
    RegistrationError,
    RegistrationErrorCode,
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
CIMD_CACHE_MIN_SECONDS = 60
CIMD_CACHE_MAX_SECONDS = 86400
CIMD_FETCH_INTERVAL_SECONDS = 10
MAX_CLIENT_ID_URL_LENGTH = 2048
STORAGE_ID_PREFIX = "cimd:"
STORAGE_ID_HASH_LENGTH = 32
CACHE_KEY = "openapi_oauth:cimd:{digest}"
FETCH_THROTTLE_KEY = "openapi_oauth:cimd_fetch:{digest}"
HTTPS_PREFIX = f"{HTTPS_SCHEME}://"
DOT_SEGMENTS = frozenset({".", ".."})
FORBIDDEN_DOCUMENT_FIELDS = ("client_secret", "client_secret_expires_at")
LOCALHOST = "localhost"
MAX_AGE_PATTERN = re.compile(r"(?:^|[\s,])max-age\s*=\s*\"?(\d+)\"?", re.IGNORECASE)


class CimdFetchError(Exception):
    pass


class CimdRejectedError(Exception):
    pass


@dataclass(frozen=True)
class CimdResponse:
    body: bytes
    max_age: int | None


class CimdCache(Protocol):
    def get(self, name: str) -> str | bytes | None: ...

    def setex(self, name: str, time: timedelta | int, value: str) -> object: ...

    def set(self, name: str, value: str, *, nx: bool, ex: int) -> object: ...


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
        )
        response = ssrf_proxy.buffer_response(streamed, max_response_bytes=CIMD_MAX_BYTES)
    except (httpx.HTTPError, ResponseLimitError, ToolSSRFError) as error:
        raise CimdFetchError(str(error)) from error
    if response.status_code != httpx.codes.OK:
        raise CimdFetchError(f"metadata document answered {response.status_code}")
    return CimdResponse(body=response.content, max_age=_max_age(response.headers))


def _checked_client_id_url(client_id: str) -> str:
    """Return the host of a client id URL that follows the draft's rules, else raise."""
    if not client_id.startswith(HTTPS_PREFIX) or len(client_id) > MAX_CLIENT_ID_URL_LENGTH:
        raise CimdRejectedError
    if any(char.isspace() or not char.isprintable() for char in client_id):
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
    if address.is_private or address.is_loopback or address.is_link_local:
        return False
    if address.is_reserved or address.is_multicast or address.is_unspecified:
        return False
    return address.is_global


def _check_host_is_public(host: str, resolve_host: Callable[[str], Sequence[str]]) -> None:
    name = host.rstrip(".").lower()
    if name == LOCALHOST or name.endswith(f".{LOCALHOST}"):
        raise CimdRejectedError
    try:
        ipaddress.ip_address(name)
    except ValueError:
        pass
    else:
        if not _is_public_address(name):
            raise CimdRejectedError
        return
    try:
        addresses = resolve_host(name)
    except OSError:
        raise CimdRejectedError from None
    if not addresses:
        raise CimdRejectedError
    if not all(_is_public_address(address) for address in addresses):
        raise CimdRejectedError


def _grant_types(document: Mapping[str, object]) -> frozenset[GrantType]:
    values = string_list(document, "grant_types", error=RegistrationErrorCode.INVALID_CLIENT_METADATA)
    if values is None:
        return frozenset(DEFAULT_GRANT_TYPES)
    allowed = {grant.value: grant for grant in DEFAULT_GRANT_TYPES}
    grants = frozenset(allowed[value] for value in values if value in allowed)
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
    except RegistrationError:
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
    except RegistrationError:
        raise CimdRejectedError from None
    return ResolvedClient(
        client_id=url,
        storage_client_id=cimd_storage_id(url),
        kind=OAuthClientKind.PUBLIC,
        display_name=(client_name or "").strip() or host,
        logo_uri=_logo_uri(document),
        redirect_uris=redirect_uris,
        grant_types=grant_types,
        secret_hash=None,
    )


def _dump(client: ResolvedClient) -> str:
    return json.dumps(
        {
            "display_name": client.display_name,
            "logo_uri": client.logo_uri,
            "redirect_uris": list(client.redirect_uris),
            "grant_types": sorted(grant.value for grant in client.grant_types),
        }
    )


def _load(url: str, raw: str | bytes) -> ResolvedClient | None:
    try:
        data = json.loads(raw)
        return ResolvedClient(
            client_id=url,
            storage_client_id=cimd_storage_id(url),
            kind=OAuthClientKind.PUBLIC,
            display_name=data["display_name"],
            logo_uri=data["logo_uri"],
            redirect_uris=tuple(data["redirect_uris"]),
            grant_types=frozenset(GrantType(value) for value in data["grant_types"]),
            secret_hash=None,
        )
    except (ValueError, KeyError, TypeError):
        return None


class CimdClientSource:
    def __init__(
        self,
        *,
        cache: CimdCache,
        fetch: Callable[[str], CimdResponse],
        resolve_host: Callable[[str], Sequence[str]],
        enabled: bool,
    ) -> None:
        self._cache = cache
        self._fetch = fetch
        self._resolve_host = resolve_host
        self._enabled = enabled

    def resolve(self, client_id: str) -> ResolvedClient | None:
        if not self._enabled:
            return None
        try:
            host = _checked_client_id_url(client_id)
        except CimdRejectedError:
            return None
        digest = sha256_hex(client_id)
        cached = self._cache.get(CACHE_KEY.format(digest=digest))
        if cached is not None:
            client = _load(client_id, cached)
            if client is not None:
                return client
        return self._fetch_and_cache(client_id, host, digest)

    def _fetch_and_cache(self, url: str, host: str, digest: str) -> ResolvedClient | None:
        if not self._cache.set(FETCH_THROTTLE_KEY.format(digest=digest), "1", nx=True, ex=CIMD_FETCH_INTERVAL_SECONDS):
            return None
        try:
            _check_host_is_public(host, self._resolve_host)
            response = self._fetch(url)
            client = _parse_document(url, host, response.body)
        except (CimdRejectedError, CimdFetchError):
            return None
        lifetime = CIMD_CACHE_MIN_SECONDS if response.max_age is None else response.max_age
        lifetime = max(CIMD_CACHE_MIN_SECONDS, min(CIMD_CACHE_MAX_SECONDS, lifetime))
        self._cache.setex(CACHE_KEY.format(digest=digest), lifetime, _dump(client))
        return client
