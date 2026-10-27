from collections.abc import Sequence
from typing import cast

import pytest
from sqlalchemy.orm import Session, sessionmaker

from enums.oauth_client import OAuthClientKind
from libs.oauth_bearer import sha256_hex
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
    kind: OAuthClientKind = OAuthClientKind.CONFIDENTIAL,
    grant_types: Sequence[str] = (GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN),
    client_secret_hash: str | None = sha256_hex("s3cret"),
    logo_uri: str | None = None,
) -> None:
    repository.create(
        client_id=client_id,
        kind=kind,
        display_name="Claude Desktop",
        redirect_uris=["https://example.com/cb"],
        grant_types=cast("Sequence[GrantType]", grant_types),
        client_secret_hash=client_secret_hash,
        logo_uri=logo_uri,
    )


def test_table_row_resolves(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository, logo_uri="https://example.com/logo.png")
    client = OAuthClientRegistry([repository]).resolve("claude-desktop")
    assert client == ResolvedClient(
        client_id="claude-desktop",
        storage_client_id="claude-desktop",
        kind=OAuthClientKind.CONFIDENTIAL,
        display_name="Claude Desktop",
        logo_uri="https://example.com/logo.png",
        redirect_uris=("https://example.com/cb",),
        grant_types=frozenset({GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN}),
        secret_hash=sha256_hex("s3cret"),
    )
    assert OAuthClientRegistry([repository]).resolve("difyctl") is None


def test_unknown_grant_types_in_row_are_ignored(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository, grant_types=[GrantType.AUTHORIZATION_CODE, GrantType.DEVICE_CODE, "urn:future:grant"])
    client = OAuthClientRegistry([repository]).resolve("claude-desktop")
    assert client is not None
    assert client.grant_types == frozenset({GrantType.AUTHORIZATION_CODE, GrantType.DEVICE_CODE})


def test_verify_secret(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository)
    _create(repository, "no-hash", client_secret_hash=None)
    _create(repository, "public", kind=OAuthClientKind.PUBLIC, client_secret_hash=None)
    registry = OAuthClientRegistry([repository])
    confidential, no_hash, public = (registry.resolve(i) for i in ("claude-desktop", "no-hash", "public"))
    assert confidential is not None
    assert no_hash is not None
    assert public is not None

    assert registry.verify_secret(confidential, "s3cret") is True
    assert registry.verify_secret(confidential, "wrong") is False
    assert registry.verify_secret(confidential, None) is False
    assert registry.verify_secret(no_hash, "anything") is False
    assert registry.verify_secret(public, None) is True
    assert registry.verify_secret(public, "s3cret") is False
