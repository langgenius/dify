from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import cast

import pytest
from sqlalchemy import Engine, Table, create_engine
from sqlalchemy.orm import Session, sessionmaker

from enums.oauth_client import OAuthClientKind
from models.model import OAuthProviderApp
from models.oauth import OAuthClient
from repositories.oauth_client_repository import SQLAlchemyOAuthClientRepository
from services.oauth_clients import OAuthClientRegistry, ResolvedClient, hash_client_secret
from services.oauth_token_contracts import GrantType


@dataclass
class _FixedSource:
    client: ResolvedClient

    def resolve(self, client_id: str) -> ResolvedClient | None:  # noqa: ARG002
        return self.client


@pytest.fixture
def engine() -> Iterator[Engine]:
    engine = create_engine("sqlite://")
    cast(Table, OAuthClient.__table__).create(engine)
    cast(Table, OAuthProviderApp.__table__).create(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def repository(engine: Engine) -> SQLAlchemyOAuthClientRepository:
    return SQLAlchemyOAuthClientRepository(session_factory=sessionmaker(engine, class_=Session))


def _create(
    repository: SQLAlchemyOAuthClientRepository,
    *,
    kind: OAuthClientKind = OAuthClientKind.CONFIDENTIAL,
    display_name: str = "Claude Desktop",
    grant_types: Sequence[str] = (GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN),
    client_secret_hash: str | None = hash_client_secret("s3cret"),
    logo_uri: str | None = None,
) -> OAuthClient:
    return repository.create(
        client_id="claude-desktop",
        kind=kind,
        display_name=display_name,
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
        secret_hash=hash_client_secret("s3cret"),
    )


def test_unknown_client_resolves_to_none(repository: SQLAlchemyOAuthClientRepository) -> None:
    assert OAuthClientRegistry([repository]).resolve("nope") is None


def test_device_flow_client_id_not_in_table_resolves_to_none(repository: SQLAlchemyOAuthClientRepository) -> None:
    assert OAuthClientRegistry([repository]).resolve("difyctl") is None


def test_unknown_grant_types_in_row_are_ignored(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository, grant_types=[GrantType.AUTHORIZATION_CODE, "urn:future:grant"])
    client = OAuthClientRegistry([repository]).resolve("claude-desktop")
    assert client is not None
    assert client.grant_types == frozenset({GrantType.AUTHORIZATION_CODE})


def test_verify_secret_confidential(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository)
    registry = OAuthClientRegistry([repository])
    client = registry.resolve("claude-desktop")
    assert client is not None
    assert registry.verify_secret(client, "s3cret") is True
    assert registry.verify_secret(client, "wrong") is False
    assert registry.verify_secret(client, None) is False


def test_verify_secret_confidential_without_stored_hash(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository, client_secret_hash=None)
    registry = OAuthClientRegistry([repository])
    client = registry.resolve("claude-desktop")
    assert client is not None
    assert registry.verify_secret(client, "anything") is False


def test_verify_secret_public(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository, kind=OAuthClientKind.PUBLIC, client_secret_hash=None)
    registry = OAuthClientRegistry([repository])
    client = registry.resolve("claude-desktop")
    assert client is not None
    assert registry.verify_secret(client, None) is True
    assert registry.verify_secret(client, "s3cret") is False


def test_first_source_hit_wins(repository: SQLAlchemyOAuthClientRepository) -> None:
    _create(repository, display_name="First")
    second = ResolvedClient(
        client_id="claude-desktop",
        storage_client_id="claude-desktop",
        kind=OAuthClientKind.PUBLIC,
        display_name="Second",
        logo_uri=None,
        redirect_uris=(),
        grant_types=frozenset(),
        secret_hash=None,
    )
    client = OAuthClientRegistry([repository, _FixedSource(second)]).resolve("claude-desktop")
    assert client is not None
    assert client.display_name == "First"


def test_provider_app_exists(repository: SQLAlchemyOAuthClientRepository, engine: Engine) -> None:
    assert repository.provider_app_exists("legacy") is False
    with Session(engine) as session:
        session.add(OAuthProviderApp(app_icon="i", client_id="legacy", client_secret="s"))
        session.commit()
    assert repository.provider_app_exists("legacy") is True
