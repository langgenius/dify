from collections.abc import Sequence
from typing import cast

import pytest
from sqlalchemy.orm import Session, sessionmaker

from repositories.oauth_client_repository import SQLAlchemyOAuthClientRepository
from services.oauth_clients import OAuthClientRegistry, ResolvedClient
from services.oauth_token_contracts import GrantType


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyOAuthClientRepository:
    return SQLAlchemyOAuthClientRepository(session_factory=sqlite_session_factory)


def _create(
    repository: SQLAlchemyOAuthClientRepository,
    client_id: str = "claude-desktop",
    *,
    grant_types: Sequence[str] = (GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN),
    logo_uri: str | None = None,
) -> None:
    repository.create(
        client_id=client_id,
        display_name="Claude Desktop",
        redirect_uris=["https://example.com/cb"],
        grant_types=cast("Sequence[GrantType]", grant_types),
        logo_uri=logo_uri,
    )


def test_table_row_resolves(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository, logo_uri="https://example.com/logo.png")
    client = OAuthClientRegistry([repository]).resolve("claude-desktop")
    assert client == ResolvedClient(
        client_id="claude-desktop",
        storage_client_id="claude-desktop",
        display_name="Claude Desktop",
        logo_uri="https://example.com/logo.png",
        redirect_uris=("https://example.com/cb",),
        grant_types=frozenset({GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN}),
    )
    assert OAuthClientRegistry([repository]).resolve("difyctl") is None


def test_unknown_grant_types_in_row_are_ignored(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository, grant_types=[GrantType.AUTHORIZATION_CODE, GrantType.DEVICE_CODE, "urn:future:grant"])
    client = OAuthClientRegistry([repository]).resolve("claude-desktop")
    assert client is not None
    assert client.grant_types == frozenset({GrantType.AUTHORIZATION_CODE, GrantType.DEVICE_CODE})
