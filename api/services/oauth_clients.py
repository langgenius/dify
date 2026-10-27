"""Registry of OAuth clients allowed to use the /openapi/v1 token endpoint."""

import hmac
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from enums.oauth_client import OAuthClientKind
from libs.oauth_bearer import sha256_hex
from services.oauth_token_contracts import GrantType


@dataclass(frozen=True)
class ResolvedClient:
    client_id: str
    storage_client_id: str
    kind: OAuthClientKind
    display_name: str
    logo_uri: str | None
    redirect_uris: tuple[str, ...]
    grant_types: frozenset[GrantType]
    secret_hash: str | None


class ClientSource(Protocol):
    def resolve(self, client_id: str) -> ResolvedClient | None: ...


class OAuthClientRegistry:
    def __init__(self, sources: Sequence[ClientSource]) -> None:
        self._sources = tuple(sources)

    def resolve(self, client_id: str) -> ResolvedClient | None:
        for source in self._sources:
            client = source.resolve(client_id)
            if client is not None:
                return client
        return None

    def verify_secret(self, client: ResolvedClient, secret: str | None) -> bool:
        if client.kind == OAuthClientKind.PUBLIC:
            return secret is None
        if secret is None or client.secret_hash is None:
            return False
        return hmac.compare_digest(sha256_hex(secret), client.secret_hash)
