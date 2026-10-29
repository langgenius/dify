"""Registry of OAuth clients allowed to use the /openapi/v1 token endpoint."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from services.oauth_token_contracts import GrantType


@dataclass(frozen=True)
class ResolvedClient:
    client_id: str
    storage_client_id: str
    display_name: str
    logo_uri: str | None
    redirect_uris: tuple[str, ...]
    grant_types: frozenset[GrantType]


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
