import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from models import Account
from models.account import AccountStatus
from models.model import OAuthProviderApp
from repositories.oauth_server_repository import RedisOAuthServerTokenRepository, SQLAlchemyOAuthServerRepository
from services.entities.oauth_server_entities import (
    OAuthProviderAccountRecord,
    OAuthProviderAccountStatus,
    OAuthProviderAppRecord,
)
from services.oauth_server_service import (
    OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    OAUTH_AUTHORIZATION_CODE_EXPIRES_IN,
    OAUTH_REFRESH_TOKEN_EXPIRES_IN,
    OAuthServerRequestError,
)


def test_get_provider_app_by_client_id_maps_record(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    provider_app = OAuthProviderApp(
        app_icon="icon",
        client_id="client-1",
        client_secret="secret",
        app_label={"en-US": "Test App"},
        redirect_uris=["https://example.com/callback"],
        scope="read",
        auto_authorize=True,
    )
    with sqlite_session_factory.begin() as session:
        session.add(provider_app)

    result = SQLAlchemyOAuthServerRepository(sqlite_session_factory).get_provider_app_by_client_id("client-1")

    assert result == OAuthProviderAppRecord(
        app_icon="icon",
        client_id="client-1",
        client_secret="secret",
        app_label={"en-US": "Test App"},
        redirect_uris=("https://example.com/callback",),
        scope="read",
        auto_authorize=True,
    )


def test_get_provider_app_by_client_id_returns_none_for_unknown_client(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyOAuthServerRepository(sqlite_session_factory)

    assert repository.get_provider_app_by_client_id("missing") is None


@pytest.mark.parametrize(
    ("status", "expected_status"),
    [
        (AccountStatus.PENDING, OAuthProviderAccountStatus.PENDING),
        (AccountStatus.UNINITIALIZED, OAuthProviderAccountStatus.UNINITIALIZED),
        (AccountStatus.ACTIVE, OAuthProviderAccountStatus.ACTIVE),
        (AccountStatus.BANNED, OAuthProviderAccountStatus.BANNED),
        (AccountStatus.CLOSED, OAuthProviderAccountStatus.CLOSED),
    ],
)
def test_get_account_by_id_maps_record(
    sqlite_session_factory: sessionmaker[Session],
    status: AccountStatus,
    expected_status: OAuthProviderAccountStatus,
) -> None:
    account = Account(
        name="Test User",
        email=f"{status.value}@example.com",
        avatar="avatar",
        interface_language="en-US",
        timezone="UTC",
        status=status,
    )
    account.created_at = datetime(2024, 1, 2, 3, 4, 5)
    with sqlite_session_factory.begin() as session:
        session.add(account)
        session.flush()
        account_id = account.id

    result = SQLAlchemyOAuthServerRepository(sqlite_session_factory).get_account_by_id(account_id)

    assert result == OAuthProviderAccountRecord(
        id=account_id,
        name="Test User",
        email=f"{status.value}@example.com",
        avatar="avatar",
        interface_language="en-US",
        timezone="UTC",
        status=expected_status,
        created_at=datetime(2024, 1, 2, 3, 4, 5),
    )


def test_get_account_by_id_returns_none_for_unknown_account(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyOAuthServerRepository(sqlite_session_factory)

    assert repository.get_account_by_id("missing") is None


def test_issue_authorization_code_stores_code_with_expiry(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    repository = RedisOAuthServerTokenRepository(redis)
    deterministic_uuid = uuid.UUID("00000000-0000-0000-0000-000000000111")

    with patch("repositories.oauth_server_repository.uuid.uuid4", return_value=deterministic_uuid):
        code = repository.issue_authorization_code("client-1", "account-1")

    assert code == str(deterministic_uuid)
    commands.assert_called_once_with(
        "SET",
        f"oauth_provider:client-1:authorization_code:{code}",
        "account-1",
        "EX",
        OAUTH_AUTHORIZATION_CODE_EXPIRES_IN,
    )


def test_exchange_authorization_code_consumes_code_and_issues_tokens(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = b"account-1"
    repository = RedisOAuthServerTokenRepository(redis)
    token_uuids = [
        uuid.UUID("00000000-0000-0000-0000-000000000201"),
        uuid.UUID("00000000-0000-0000-0000-000000000202"),
    ]

    with patch("repositories.oauth_server_repository.uuid.uuid4", side_effect=token_uuids):
        access_token, refresh_token = repository.exchange_authorization_code("client-1", "code-1")

    assert commands.call_count == 3
    commands.assert_any_call("GETDEL", "oauth_provider:client-1:authorization_code:code-1")
    commands.assert_any_call(
        "SET",
        f"oauth_provider:client-1:access_token:{access_token}",
        "account-1",
        "EX",
        OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    )
    commands.assert_any_call(
        "SET",
        f"oauth_provider:client-1:refresh_token:{refresh_token}",
        "account-1",
        "EX",
        OAUTH_REFRESH_TOKEN_EXPIRES_IN,
    )


def test_exchange_authorization_code_rejects_unknown_code(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = None
    repository = RedisOAuthServerTokenRepository(redis)

    with pytest.raises(OAuthServerRequestError, match="invalid code"):
        repository.exchange_authorization_code("client-1", "invalid")


def test_refresh_access_token_issues_access_token_and_reuses_refresh_token(
    redis_transport: tuple[RedisClientWrapper, MagicMock],
) -> None:
    redis, commands = redis_transport
    commands.return_value = "account-1"
    repository = RedisOAuthServerTokenRepository(redis)
    deterministic_uuid = uuid.UUID("00000000-0000-0000-0000-000000000301")

    with patch("repositories.oauth_server_repository.uuid.uuid4", return_value=deterministic_uuid):
        access_token, refresh_token = repository.refresh_access_token("client-1", "refresh-1")

    assert access_token == str(deterministic_uuid)
    assert refresh_token == "refresh-1"
    assert commands.call_count == 2
    commands.assert_any_call(
        "GET",
        "oauth_provider:client-1:refresh_token:refresh-1",
        keys=["oauth_provider:client-1:refresh_token:refresh-1"],
    )


def test_refresh_access_token_rejects_unknown_token(redis_transport: tuple[RedisClientWrapper, MagicMock]) -> None:
    redis, commands = redis_transport
    commands.return_value = None
    repository = RedisOAuthServerTokenRepository(redis)

    with pytest.raises(OAuthServerRequestError, match="invalid refresh token"):
        repository.refresh_access_token("client-1", "invalid")


@pytest.mark.parametrize(
    ("stored_account_id", "expected"),
    [
        (b"account-1", "account-1"),
        ("account-2", "account-2"),
        (None, None),
    ],
)
def test_resolve_account_id(
    redis_transport: tuple[RedisClientWrapper, MagicMock], stored_account_id: str | bytes | None, expected: str | None
) -> None:
    redis, commands = redis_transport
    commands.return_value = stored_account_id
    repository = RedisOAuthServerTokenRepository(redis)

    assert repository.resolve_account_id("client-1", "access-1") == expected
    commands.assert_called_once_with(
        "GET", "oauth_provider:client-1:access_token:access-1", keys=["oauth_provider:client-1:access_token:access-1"]
    )
